# Executable steward regression tests

Cleared includes automated tests for the failure and overdue paths requested during steward review.

## Canonical Bradbury deployment

- **Network:** GenLayer Bradbury Testnet
- **Chain ID:** `4221`
- **Contract:** `0x9a762b14558d7C7c4732B464325C05b45B0BbACA`
- **Deployment transaction:** `0x69fa09532200bbbee7c00811b97bbcdc8dcd973e60ee10ba7dac768223b7ebbe`
- **Frontend:** https://cleared-six.vercel.app

The repository source is `lending_pool.py`. To independently compare it with the source returned by Bradbury:

```bash
genlayer network set testnet-bradbury
genlayer code 0x9a762b14558d7C7c4732B464325C05b45B0BbACA > deployed-lending-pool.py
diff -u lending_pool.py deployed-lending-pool.py
```

A clean diff is the strongest direct confirmation that the checked-in and deployed source are byte-for-byte equivalent.

## Direct Mode

The deterministic regression suite uses GenLayer's `genlayer-test` Direct Mode. Direct Mode runs the contract in memory and provides transaction-time control through `direct_vm.warp(...)`, allowing the seven-day deadline path to be exercised without waiting seven real days.

### Install

Python 3.12+ is recommended by the current GenLayer tooling.

```bash
python -m pip install -r requirements-dev.txt
```

### Run

From the repository root:

```bash
pytest tests/test_steward_paths.py -v
```

### Covered cases

#### 1. Failed claim with insufficient pool liquidity

`test_failed_claim_with_empty_pool_preserves_offer`

The test seeds a valid unclaimed offer while the pool has zero GEN, calls `claim_loan`, and verifies that:

- the claim reports failure,
- no repayment deadline is created,
- `claimed` remains `false`,
- `active` remains `false`,
- the offer stays available for a later retry.

The contract checks its own balance before the payout/state transition, so insufficient liquidity is rejected before active debt can be created.

#### 2. Deadline anchored to claim transaction time

`test_claim_deadline_is_anchored_to_claim_transaction_time`

The test warps deterministic GenVM time to `2026-08-12T12:00:00Z`, claims a funded offer, and verifies the stored deadline is exactly seven days later:

`2026-08-19T12:00:00+00:00`

The deadline no longer comes from the borrower's explorer transaction history. `datetime.now(timezone.utc)` inside GenVM is pinned to deterministic transaction time for validator re-execution.

#### 3. Third-party overdue default path

`test_third_party_can_mark_overdue_loan_defaulted`

The test seeds an active loan with a known due date, warps transaction time past the deadline, and calls `check_default` from a different wallet.

It verifies that:

- a third party can trigger the transition,
- the loan becomes `defaulted`,
- the loan is no longer `active`,
- the caller is recorded,
- an eligible third-party keeper receives the configured one-time reward when pool liquidity is available.

The borrower is not required to return to their own Profile page for default detection.

#### 4. Keeper reward cannot be claimed twice

`test_default_reward_can_only_be_earned_once`

After the first successful overdue transition, a second caller cannot mark the same loan defaulted again or earn another reward.

#### 5. Early default checks do nothing

`test_not_overdue_does_not_default_or_pay_keeper`

The deterministic clock is set before the due date. The loan remains active and no keeper reward is emitted.

#### 6. Insufficient repayment preserves the loan

The Direct Mode suite verifies that an insufficient repayment cannot settle the loan or corrupt its state.

#### 7. Owner withdrawal above available liquidity

`test_withdraw_more_than_pool_balance_fails_without_changing_balance`

The owner attempts to withdraw more GEN than the pool holds. The call fails cleanly and the pool balance remains unchanged.

## GLSim integration coverage

`tests/test_steward_integration.py` exercises the contract through the network-style test client and covers:

- successful external loan payout,
- insufficient-liquidity claim preserving the offer,
- third-party overdue default plus one-time keeper reward,
- insufficient payable repayment reverting without settlement.

The local GLSim version used during development had limitations around native value accounting on some paths, so the actual payable/value-transfer behavior was also verified on Bradbury.

## Live Bradbury verification

The production deployment was exercised end-to-end with real Bradbury testnet GEN:

- `fund_pool()` successfully funded the contract,
- pool balance was observed at 5 GEN,
- an eligible wallet requested a 1 GEN loan,
- `claim_loan()` paid out the 1 GEN principal,
- pool liquidity dropped from 5 GEN to 4 GEN,
- the borrower balance increased by approximately 1 GEN minus transaction fees,
- `repay_loan()` successfully repaid 1.03 GEN,
- repayment count incremented and the loan cleared,
- pool liquidity increased to 5.03 GEN from the 3% flat interest,
- paid `scan_wallet()` calls succeeded with 0.1 GEN,
- production frontend reads and writes succeeded against the Bradbury deployment,
- accepted transaction state appears in the UI without requiring a manual browser refresh,
- transaction hash/status persists across frontend tab navigation.

The real seven-day overdue wait was not performed on Bradbury. That transition is exercised deterministically with `direct_vm.warp(...)`, which is the executable regression proof for the steward-requested overdue path.

## Additional safety changes

Payable repayment and wallet-scan calls raise `gl.vm.UserError` for invalid payment instead of returning a normal result after attached GEN has been accepted. Loan interest and principal calculations that affect persisted debt use integer arithmetic.
