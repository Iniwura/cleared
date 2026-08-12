# CLEARED

Loans sized by real, attested wallet evidence on GenLayer Bradbury Testnet. No self-reported financials, nothing to fake.

## What this is

A wallet's balance, transaction count, activity age, and recent failure rate are read live from the chain the moment someone applies. That evidence sorts a wallet into a tier, GOLD, SILVER, or REJECTED, which sets a ceiling on how much GEN they can borrow. A short stated reason for the loan is rated for clarity, not truth, one of three discrete labels, low, medium, or high, and can move the approved amount within that ceiling, but it can never override the tier itself. Validators are required to agree on the exact same approved amount, not just the same tier, the discrete clarity label is specifically what makes that achievable across independent evaluations.

## Structure

- `lending_pool.py`, the GenLayer Intelligent Contract, deployed on Bradbury Testnet via GenLayer Studio.
- `lending-app/`, the React + Vite frontend, talks to the deployed contract through `genlayer-js`.
- `TESTING.md`, manual test scripts for the failure-mode paths that matter most: failed transfers, insufficient pool liquidity, and overdue-loan transitions. All three have been run against a live deployment and confirmed working.

## Running the frontend

```
cd lending-app
npm install
npm run dev
```

Requires a browser wallet (Rabby or MetaMask) connected to GenLayer Bradbury Testnet, and the deployed contract address pasted into `lending-app/src/lib/config.js`.

## Core flow

1. **Apply**, wallet evidence gets evaluated live, no GEN moves yet, just a review of the tier and the amount you'd get.
2. **Claim**, a separate transaction, only now does the GEN actually disburse and the 7-day repayment clock start. The transfer is attempted before any state is committed, a failed claim leaves the original offer completely untouched, confirmed by direct testing, not just code review.
3. **Repay**, principal plus 3% flat interest. A defaulted loan can still be settled later to clear the ban, it isn't permanent. Overpaying refunds the difference automatically.
4. **Scan**, a general wallet lookup, 0.1 GEN, works on any address, not just your own.
5. **Check for default**, reachable from the Profile page once a loan is actually overdue by the viewer's own clock. Uses a network-wide transaction feed as its time reference, falling back to the contract's own history only if that feed is empty.

## Known limitation: this is unsecured lending, and inherits Sybil risk

This protocol deliberately does not require collateral. The whole premise is that real, verifiable wallet evidence, age, activity, balance, failure history, stands in for the self-reported financials a traditional loan application asks for. That's a real, different design choice, not an oversight, but it's worth being explicit about what it does and doesn't protect against.

**What's covered**: a wallet under 14 days old is hard-declined regardless of any other stat, closing the obvious "pad a fresh wallet's activity and borrow immediately" attack. Ceilings are deliberately small, medium tier tops out at 2 GEN before the reason label narrows it further, so the maximum single-attempt exposure is bounded on purpose. A defaulted wallet is locked out of borrowing again until it settles what it owes, so the same identity can't repeat the attempt.

**What isn't covered**: identity itself is cheap. Nothing stops someone from creating a new wallet, waiting out the 14-day age requirement, doing enough real activity to clear a tier, borrowing the small capped amount, and simply defaulting, then repeating the same pattern from a fresh address. Wallet-age and activity requirements are real friction, they are not a hard Sybil-resistance guarantee.

**Why this isn't patched with collateral**: requiring collateral would close the gap, but it would also delete the actual premise of the project, evidence replacing self-report, and turn this into an ordinary over-collateralized lending protocol with extra steps. The mitigation here is intentionally bounded loss through small per-wallet ceilings, not elimination of the risk. On testnet GEN, the real-world stakes of this gap are close to zero. A production version handling real value would need a different answer, most plausibly a hybrid: keep the uncollateralized tier as-is for small amounts, and require real collateral for a second, larger tier above the current ceiling.
