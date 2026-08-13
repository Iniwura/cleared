import { CONTRACT_ADDRESS } from "./config";
import { parseResult, readContract } from "./gl";

const READERS = {
  decision: (address) => readContract(CONTRACT_ADDRESS, "get_last_decision", [address]),
  loan: (address) => readContract(CONTRACT_ADDRESS, "get_loan", [address]),
  repaymentCount: (address) => readContract(CONTRACT_ADDRESS, "get_repayment_count", [address]),
  poolBalance: () => readContract(CONTRACT_ADDRESS, "get_pool_balance", []),
  scan: (address) => readContract(CONTRACT_ADDRESS, "get_last_scan", [address]),
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function refreshContractState(address, fields, { attempts = 1, delayMs = 500 } = {}) {
  let snapshot;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const values = await Promise.all(fields.map((field) => READERS[field](address)));
    snapshot = Object.fromEntries(fields.map((field, index) => [field, parseResult(values[index])]));
    if (attempt + 1 < attempts) await wait(delayMs);
  }
  return snapshot;
}
