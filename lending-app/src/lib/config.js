// Paste the deployed LendingPool contract address here after deploying via Studio.
export const CONTRACT_ADDRESS = "0x1634F4B4DcC38eFd7B7aC3dA0Cbe93284c128A5E";

// Same tier boundaries as lending_pool.py's request_loan bands.
// Kept here only for display copy, the contract is the actual source of truth.
// Floor is the global minimum (1 GEN) for every eligible tier now, only the
// ceiling is tier-specific, a weak reason has real downside regardless of tier.
export const TIER_INFO = {
  low: {
    name: "GOLD",
    className: "tier-gold",
    fillColor: "var(--gold)",
    rangeMinGen: 1,
    rangeMaxGen: 5,
    description: "Nonce ≥ 500, balance ≥ 50 GEN, zero recent failures, wallet age ≥ 60 days.",
  },
  medium: {
    name: "SILVER",
    className: "tier-silver",
    fillColor: "var(--silver)",
    rangeMinGen: 1,
    rangeMaxGen: 2,
    description: "Meets some but not all of the low-risk criteria.",
  },
  high: {
    name: "REJECTED",
    className: "tier-red",
    fillColor: "var(--red)",
    rangeMinGen: 0,
    rangeMaxGen: 0,
    description: "Two or more recent failed transactions, or wallet age under 14 days.",
  },
};

export const MIN_LOAN_GEN = 1;
export const MAX_LOAN_GEN = 5;
export const INTEREST_PERCENT = 3;
export const TERM_DAYS = 7;
export const SCAN_FEE_GEN = 0.1;
