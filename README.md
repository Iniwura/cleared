# CLEARED

Loans sized by real, attested wallet evidence on GenLayer Bradbury Testnet. No self-reported financials, nothing to fake.

## Live deployment

- **Network:** GenLayer Bradbury Testnet
- **Chain ID:** `4221`
- **LendingPool contract:** `0x9a762b14558d7C7c4732B464325C05b45B0BbACA`
- **Deployment transaction:** `0x69fa09532200bbbee7c00811b97bbcdc8dcd973e60ee10ba7dac768223b7ebbe`
- **Frontend:** https://cleared-six.vercel.app
- **Contract source:** [`lending_pool.py`](./lending_pool.py)

The frontend is configured to use the Bradbury deployment above in `lending-app/src/lib/config.js`.

To independently compare the deployed Intelligent Contract source with the repository source using the GenLayer CLI:

```bash
genlayer network set testnet-bradbury
genlayer code 0x9a762b14558d7C7c4732B464325C05b45B0BbACA > deployed-lending-pool.py
diff -u lending_pool.py deployed-lending-pool.py
```

A clean diff confirms the checked-in source and deployed source are byte-for-byte equivalent.

## What this is

A wallet's balance, transaction count, activity age, and recent failure rate are read live from the chain when someone applies. That evidence sorts a wallet into a tier, GOLD, SILVER, or REJECTED, which sets a ceiling on how much GEN they can borrow. A short stated reason for the loan is rated for clarity, not truth, using one of three discrete labels: low, medium, or high. It can move the approved amount within the wallet's allowed range, but it can never override the wallet tier.

Validator equivalence requires the same tier, the same approved/declined outcome, and the exact same `approved_wei`, so validators must agree on the precise principal rather than merely a broad risk class.

## Structure

- `lending_pool.py` — GenLayer Intelligent Contract deployed on Bradbury Testnet.
- `lending-app/` — React + Vite frontend using `genlayer-js` and the live Bradbury deployment.
- `tests/test_steward_paths.py` — deterministic Direct Mode regression coverage for the steward-requested failure and overdue paths.
- `tests/test_steward_integration.py` — GLSim integration coverage for payout, insufficient liquidity, third-party default reward, and insufficient repayment.
- `TESTING.md` — test setup, coverage, and live Bradbury verification notes.

## Running the frontend

```bash
cd lending-app
npm install
npm run dev
```

Requires Rabby or MetaMask with GenLayer Bradbury Testnet available. The production contract address is already configured in `lending-app/src/lib/config.js`.

## Core flow

1. **Apply** — the connected wallet's live on-chain evidence is evaluated and an exact principal is determined. No loan principal moves yet.
2. **Claim** — the contract first checks pool liquidity, emits the payout, records the loan as claimed/active, and anchors `due_at` to deterministic claim transaction time plus seven days. If the pool is underfunded, the offer remains unclaimed and inactive.
3. **Repay** — the borrower repays principal plus 3% flat interest. Successful settlement clears the active/defaulted balance and increments the repayment count. Overpayment is refunded.
4. **Scan** — a general wallet lookup costing 0.1 GEN that works on any address.
5. **Check default** — `check_default(address)` is permissionless. Any third party can check an overdue active loan. On the first valid overdue transition, the loan becomes defaulted and an eligible third-party keeper can receive the configured one-time reward when pool liquidity allows.

## Steward-requested fixes

The current contract addresses both rounds of steward feedback:

- exact-principal validator agreement,
- failed/underfunded claims cannot create active debt,
- repayment deadlines are anchored to deterministic claim transaction time rather than borrower transaction history,
- overdue detection is permissionless and incentivized for third parties,
- one-time keeper reward protection,
- executable regression coverage for failed claims, insufficient liquidity, deterministic deadlines, overdue transitions, early checks, and repayment failures.

See `TESTING.md` for the exact tests and verification details.

## Bradbury verification

The production deployment has been exercised with real Bradbury testnet GEN through the live frontend and CLI:

- pool funding succeeded,
- a 1 GEN loan was requested and claimed,
- pool liquidity decreased by the 1 GEN payout,
- the borrower received approximately 1 GEN minus transaction fees,
- the 1.03 GEN repayment succeeded,
- pool liquidity increased by the 3% interest,
- paid 0.1 GEN wallet scans succeeded,
- frontend state updates at `ACCEPTED` without requiring a browser refresh,
- transaction hashes/status survive frontend tab navigation.

The seven-day overdue transition is covered deterministically in Direct Mode with `direct_vm.warp(...)`; it was not necessary to wait seven real days on Bradbury to exercise that state transition.

## Known limitation: this is unsecured lending, and inherits Sybil risk

This protocol deliberately does not require collateral. Real, verifiable wallet evidence — age, activity, balance, and recent failure history — replaces self-reported financial information, but it does not prove a unique human identity.

**What's covered:** a wallet under 14 days old is hard-declined regardless of other stats. Borrowing ceilings are deliberately small, and a defaulted wallet cannot borrow again until its balance is settled.

**What isn't covered:** a person can create multiple wallets and age them separately. Wallet history adds friction, but it is not strong Sybil resistance.

A production version handling material real-world value would need stronger identity/risk controls or a hybrid collateral model for larger borrowing tiers.
