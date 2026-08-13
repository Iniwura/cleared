import json
import sys


GEN = 10**18


def _loan_class(contract):
    module = sys.modules[type(contract).__module__]
    return module.Loan, module.u256


def _address(contract, value):
    module = sys.modules[type(contract).__module__]
    if isinstance(value, module.Address):
        return value
    return module.Address(value)


def _seed_offer(contract, borrower, principal=GEN, owed=103 * 10**16):
    Loan, u256 = _loan_class(contract)
    contract.loans[_address(contract, borrower)] = Loan(
        principal_wei=u256(principal),
        owed_wei=u256(owed),
        due_at="",
        reason="Working capital for a small software project",
        tier="medium",
        claimed=False,
        active=False,
        defaulted=False,
    )


def _seed_active_loan(contract, borrower, due_at, principal=GEN, owed=103 * 10**16):
    Loan, u256 = _loan_class(contract)
    contract.loans[_address(contract, borrower)] = Loan(
        principal_wei=u256(principal),
        owed_wei=u256(owed),
        due_at=due_at,
        reason="Working capital for a small software project",
        tier="medium",
        claimed=True,
        active=True,
        defaulted=False,
    )


def test_failed_claim_with_empty_pool_preserves_offer(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("lending_pool.py")
    alice = _address(contract, direct_alice)
    direct_vm.sender = alice
    _seed_offer(contract, direct_alice)

    before = json.loads(contract.get_loan(alice.as_hex))
    result = json.loads(contract.claim_loan(alice.as_hex))
    after = json.loads(contract.get_loan(alice.as_hex))

    assert result["success"] is False
    assert "enough GEN" in result["message"]
    assert before["claimed"] is False
    assert before["active"] is False
    assert after["claimed"] is False
    assert after["active"] is False
    assert after["defaulted"] is False
    assert after["due_at"] == ""


def test_claim_deadline_is_anchored_to_claim_transaction_time(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("lending_pool.py")
    alice = _address(contract, direct_alice)
    direct_vm.sender = alice
    direct_vm.warp("2026-08-12T12:00:00Z")
    direct_vm.deal(contract.address, 5 * GEN)
    _seed_offer(contract, direct_alice)

    result = json.loads(contract.claim_loan(alice.as_hex))
    loan = json.loads(contract.get_loan(alice.as_hex))

    assert result["success"] is True
    assert result["due_at"] == "2026-08-19T12:00:00+00:00"
    assert loan["due_at"] == "2026-08-19T12:00:00+00:00"
    assert loan["claimed"] is True
    assert loan["active"] is True


def test_third_party_can_mark_overdue_loan_defaulted(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("lending_pool.py")
    alice = _address(contract, direct_alice)
    bob = _address(contract, direct_bob)
    direct_vm.deal(contract.address, GEN)
    _seed_active_loan(contract, direct_alice, "2026-08-19T12:00:00+00:00")

    direct_vm.warp("2026-08-20T12:00:00Z")
    with direct_vm.prank(bob):
        result = json.loads(contract.check_default(alice.as_hex))

    loan = json.loads(contract.get_loan(alice.as_hex))

    assert result["defaulted"] is True
    assert result["checked_by"].lower() == bob.as_hex.lower()
    assert result["reward_wei"] == 10**16
    assert loan["active"] is False
    assert loan["defaulted"] is True


def test_default_reward_can_only_be_earned_once(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("lending_pool.py")
    alice = _address(contract, direct_alice)
    bob = _address(contract, direct_bob)
    charlie = _address(contract, direct_charlie)
    direct_vm.deal(contract.address, GEN)
    _seed_active_loan(contract, direct_alice, "2026-08-19T12:00:00+00:00")
    direct_vm.warp("2026-08-20T12:00:00Z")

    with direct_vm.prank(bob):
        first = json.loads(contract.check_default(alice.as_hex))
    with direct_vm.prank(charlie):
        second = json.loads(contract.check_default(alice.as_hex))

    assert first["defaulted"] is True
    assert first["reward_wei"] == 10**16
    assert second["defaulted"] is False
    assert second["reward_wei"] == 0
    assert second["message"] == "No active loan to check."


def test_not_overdue_does_not_default_or_pay_keeper(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("lending_pool.py")
    alice = _address(contract, direct_alice)
    bob = _address(contract, direct_bob)
    direct_vm.deal(contract.address, GEN)
    _seed_active_loan(contract, direct_alice, "2026-08-19T12:00:00+00:00")
    direct_vm.warp("2026-08-18T12:00:00Z")

    with direct_vm.prank(bob):
        result = json.loads(contract.check_default(alice.as_hex))

    loan = json.loads(contract.get_loan(alice.as_hex))
    assert result["defaulted"] is False
    assert result["reward_wei"] == 0
    assert loan["active"] is True
    assert loan["defaulted"] is False


def test_insufficient_repayment_reverts_and_preserves_active_loan(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("lending_pool.py")
    alice = _address(contract, direct_alice)
    due_at = "2026-08-19T12:00:00+00:00"
    owed = 103 * 10**16
    _seed_active_loan(contract, direct_alice, due_at, owed=owed)

    before = json.loads(contract.get_loan(alice.as_hex))
    direct_vm.sender = alice
    direct_vm.value = owed - 1

    with direct_vm.expect_revert("Insufficient repayment"):
        contract.repay_loan(alice.as_hex)

    after = json.loads(contract.get_loan(alice.as_hex))
    assert after == before
    assert after["active"] is True
    assert after["defaulted"] is False


def test_withdraw_more_than_pool_balance_fails_without_changing_balance(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("lending_pool.py")
    owner = _address(contract, direct_owner)
    direct_vm.sender = owner
    direct_vm.deal(contract.address, 2 * GEN)

    before = json.loads(contract.get_pool_balance())
    result = json.loads(contract.withdraw_funds("5", owner.as_hex))
    after = json.loads(contract.get_pool_balance())

    assert before["balance_gen"] == 2
    assert result["success"] is False
    assert "Pool only holds" in result["message"]
    assert after["balance_gen"] == 2
