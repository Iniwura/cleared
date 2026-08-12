import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

let client = null;
let connectedAddress = null;
let onAccountChange = null;

export async function connectWallet(onChangeCallback) {
  if (!window.ethereum) {
    throw new Error("No wallet extension found. Install Rabby or MetaMask, then reload this page.");
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  connectedAddress = accounts[0];

  client = createClient({
    chain: testnetBradbury,
    account: connectedAddress,
  });

  if (onChangeCallback) {
    onAccountChange = onChangeCallback;
    window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
  }

  return connectedAddress;
}

function handleAccountsChanged(accounts) {
  if (!accounts || accounts.length === 0) {
    disconnectWallet();
    onAccountChange?.(null);
    return;
  }
  connectedAddress = accounts[0];
  client = createClient({ chain: testnetBradbury, account: connectedAddress });
  onAccountChange?.(connectedAddress);
}

export function disconnectWallet() {
  client = null;
  connectedAddress = null;
}

export function getConnectedAddress() {
  return connectedAddress;
}

function requireClient() {
  if (!client) throw new Error("Wallet not connected yet.");
  return client;
}

// Translates raw viem/wallet errors into something a person can act on,
// instead of dumping SDK internals onto the screen.
export function friendlyError(e) {
  const msg = String(e?.message || e || "");

  if (/chain\s*\d+.*chain\s*\d+/is.test(msg) || /wrong network|unsupported chain/i.test(msg)) {
    return "Wrong network selected in your wallet. Switch to GenLayer Bradbury Testnet and try again.";
  }
  if (/user rejected|user denied|rejected the request/i.test(msg)) {
    return "Transaction cancelled in your wallet.";
  }
  if (/insufficient funds|exceeds balance/i.test(msg)) {
    return "Not enough GEN in your wallet to cover this, including gas.";
  }
  if (/no wallet extension|install rabby/i.test(msg)) {
    return msg;
  }
  if (/timeout|timed out/i.test(msg)) {
    return "This is taking longer than expected. GenLayer consensus can take a minute or more, check the transaction on the explorer before retrying.";
  }
  if (/undetermined|leader timeout|validator timeout/i.test(msg)) {
    return "Validators couldn't reach consensus in time. This is a known network condition, not your wallet, try again in a moment.";
  }
  if (!msg) {
    return "Something went wrong and no error message came back. Check your wallet and the network tab.";
  }
  return msg;
}

export async function readContract(contractAddress, functionName, args = []) {
  const c = requireClient();
  return await c.readContract({
    address: contractAddress,
    functionName,
    args,
  });
}

export async function getTransaction(txHash) {
  const c = requireClient();
  return await c.getTransaction({ hash: txHash });
}

export function getExplorerTxUrl(txHash) {
  return `https://explorer-bradbury.genlayer.com/tx/${txHash}`;
}

export async function writeContract(contractAddress, functionName, args = [], valueGen = 0, onHash = null) {
  const c = requireClient();
  const valueWei = BigInt(Math.round(valueGen * 1e18));

  const txHash = await c.writeContract({
    address: contractAddress,
    functionName,
    args,
    value: valueWei,
  });

  onHash?.(txHash);

  try {
    const receipt = await c.waitForTransactionReceipt({
      hash: txHash,
      status: "ACCEPTED",
      retries: 90,
      interval: 4000,
    });
    return receipt;
  } catch (e) {
    // The transaction is real and submitted, we just gave up waiting for it.
    // Attach the hash so the caller can offer a "check again" path instead
    // of a dead end.
    const err = new Error(e?.message || "Timed out waiting for consensus.");
    err.txHash = txHash;
    err.isPendingTimeout = true;
    throw err;
  }
}

// Re-checks an already-submitted transaction by hash, no new transaction sent.
export async function checkTransactionStatus(txHash) {
  const c = requireClient();
  const receipt = await c.waitForTransactionReceipt({
    hash: txHash,
    status: "ACCEPTED",
    retries: 20,
    interval: 3000,
  });
  return receipt;
}

// Contract methods return JSON strings, parse them consistently in one place.
export function parseResult(raw) {
  console.log("Raw contract result:", raw);
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    console.error("JSON.parse failed on:", raw, parseErr);
    return { error: "Could not parse contract response", raw };
  }
}
