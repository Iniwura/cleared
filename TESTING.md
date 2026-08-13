# Executable steward regression tests

Cleared now includes automated tests for the exact failure and overdue paths requested during review.

The tests use GenLayer's official `genlayer-test` Direct Mode. Direct Mode runs the contract in memory and provides deterministic transaction-time control through `direct_vm.warp(...)`, which lets the seven-day deadline path be exercised without waiting seven real days.

## Install

Python 3.12+ is recommended by the current GenLayer tooling.

```bash
python -m pip install -r requirements-dev.txt
```

## Run

From the repository root:

```bash
pytest tests/test_steward_paths.py -v
```

## Covered cases

### 1. Failed claim with insufficient pool liquidity

`test_failed_claim_with_empty_pool_preserves_offer`

The test seeds a valid unclaimed offer while the pool has zero GEN, calls `claim_loan`, and verifies that:

- the claim reports failure,
- no repayment deadline is created,
- `claimed` remains `false`,
- `active` remains `false`,
- the offer stays available for a later retry.

The contract now checks its own balance before emitting the payout message, so insufficient liquidity is rejected before loan state changes.

### 2. Deadline anchored to claim transaction time

`test_claim_deadline_is_anchored_to_claim_transaction_time`

The test warps the deterministic GenVM clock to `2026-08-12T12:00:00Z`, claims a funded offer, and verifies that the stored deadline is exactly seven days later:

`2026-08-19T12:00:00+00:00`

The contract no longer derives this deadline from the borrower's explorer transaction history. `datetime.now(timezone.utc)` inside GenVM is pinned to the transaction timestamp and is therefore identical across validator re-executions.

### 3. Third-party overdue default path

`test_third_party_can_mark_overdue_loan_defaulted`

The test seeds an active loan with a known due date, warps the GenVM transaction time past that deadline, and calls `check_default` from a different wallet.

It verifies that:

- the third party can trigger the transition,
- the loan becomes `defaulted`,
- the loan is no longer `active`,
- the caller is recorded in the result,
- the third-party keeper receives the configured one-time reward when pool liquidity is available.

The borrower is no longer required to return to their own Profile page for default detection.

### 4. Keeper reward cannot be claimed twice

`test_default_reward_can_only_be_earned_once`

After the first successful overdue transition, the loan is no longer active. A second caller therefore cannot mark it defaulted again and receives no reward.

### 5. Early default checks do nothing

`test_not_overdue_does_not_default_or_pay_keeper`

The deterministic clock is set before the due date. The loan remains active and no keeper reward is emitted.

### 6. Owner withdrawal above available liquidity

`test_withdraw_more_than_pool_balance_fails_without_changing_balance`

The pool is funded with 2 GEN and the owner attempts to withdraw 5 GEN. The method returns a clean failure response and the pool balance remains unchanged.

## Additional safety changes covered by the same contract revision

Payable repayment and wallet-scan calls now raise `gl.vm.UserError` when the payment is invalid instead of returning an error after accepting the attached GEN. Loan interest and clarity-based principal calculations also use integer arithmetic instead of floating-point fractions where the value affects persisted debt.

## Integration verification before resubmission

Direct Mode covers the deterministic state transitions and time-dependent logic quickly and reproducibly. Before sending the More Information response, the same branch should also be deployed to Studio or Bradbury and exercised through the frontend so the external EOA payout/reward messages and full GenLayer transaction lifecycle are verified in the environment the reviewer will see.
