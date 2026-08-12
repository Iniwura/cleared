# Focused test coverage: failed transfers, insufficient liquidity, overdue-loan transitions

These are manual test scripts to run against a deployed instance via GenLayer Studio, not automated
tests, there's no established automated test framework for GenLayer Intelligent Contracts in this
project, and bolting one on for this alone risks introducing new untested assumptions on top of
everything already hardened tonight. Each script below is concrete enough to actually execute and
verify the real behavior, not just describe expected behavior.

## 1. Failed transfer during claim_loan

Goal: confirm a failed payout leaves zero phantom debt, the wallet's offer stays claimable exactly
as it was.

Setup:
1. Deploy fresh. Do NOT call `fund_pool`, leave the contract with a 0 GEN balance.
2. Call `request_loan` with a real wallet, get approved.
3. Call `get_loan`, confirm `exists: true, claimed: false, active: false`.

Test:
4. Call `claim_loan`. The transfer should fail since the pool holds nothing to send.
5. Call `get_loan` again immediately.

Pass condition: `claimed: false, active: false`, identical to step 3, not `active: true` with no
GEN actually received. The `success: false` message from `claim_loan` itself should explain the
claim failed and the offer is still available to retry, not describe a completed loan.

Cleanup: `fund_pool` a small amount, retry `claim_loan`, confirm it now succeeds and `get_loan`
shows `claimed: true, active: true`.

## 2. Insufficient pool liquidity on withdraw_funds

Goal: confirm attempting to withdraw more than the pool holds fails with a real message, not a
bare crash.

Setup:
1. Call `fund_pool` with a known amount, e.g. `2`.
2. Call `get_pool_balance`, confirm it reads `2`.

Test:
3. Call `withdraw_funds` with `amount_gen: 5`, more than the pool holds.

Pass condition: a clean `{"success": false, "message": "Pool only holds 2.0 GEN, can't withdraw 5..."}`
response, not `exit_code 1` or an undecodable failure. `get_pool_balance` afterward should still
read `2`, untouched.

4. Call `withdraw_funds` again with `amount_gen: 2`, exactly what's available.

Pass condition: succeeds, `get_pool_balance` now reads `0`.

## 3. Overdue-loan transition via check_default

Goal: confirm a genuinely overdue loan actually transitions to defaulted when checked, using the
new network-wide time reference, and confirm the UI path added for this actually triggers it.

This one can't be fully tested end to end in one sitting, `due_at` is always 7 real days out from
claim, there's no way to fast-forward that. Two ways to still get real coverage now:

**A. Verify the mechanism directly, without waiting 7 days.**
1. Claim a loan normally, note the real `due_at` returned.
2. Call `check_default` immediately.
3. Pass condition: `{"defaulted": false, "message": "Not yet past due.", "detail": {...}}`, and the
   `detail.now_ts` field should show a recent, real timestamp, confirming the network-wide feed (or
   its fallback) is actually returning usable data, not silently failing.

**B. Verify the transition logic directly by temporarily testing against a due date already in the
past.** Since `due_at` isn't settable through normal flow, the only way to see the actual
`defaulted: true` transition without a real 7-day wait is a throwaway test deploy with the
`timedelta(days=7)` in `claim_loan` changed to `timedelta(minutes=1)` for testing purposes only,
never deployed as the real contract. Claim a loan, wait a minute, call `check_default`, confirm
`defaulted: true` and that a follow-up `request_loan` from the same wallet is correctly declined
for being unsettled. Revert the change before any real deploy.

**C. Confirm the UI path itself is wired correctly**, independent of real timing: open Profile with
an active, non-overdue loan, confirm the "check for default" button does not appear. This proves
the trigger is conditioned on the client's own due-date comparison, not always visible, which is
the actual UI-wiring gap the steward flagged as missing before tonight's fix.

Genuinely confirmed by these three: default detection is reachable from the app, not orphaned code,
the underlying time reference returns real data on a normal call, and the transition logic itself
is exercised at least once under a controlled short window, even though the real 7-day path can
only be watched, not compressed, in a live environment.
