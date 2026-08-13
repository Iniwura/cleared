import { useEffect, useState } from "react";
import { writeContract, checkTransactionStatus, friendlyError, getExplorerTxUrl } from "../lib/gl";
import { useLiveTxStatus } from "../lib/useLiveTxStatus";
import { CONTRACT_ADDRESS, TIER_INFO, SCAN_FEE_GEN } from "../lib/config";
import { refreshContractState } from "../lib/contractState";

const HISTORY_KEY = "cleared_scan_history";
const MAX_HISTORY = 10;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveToHistory(address, result) {
  const history = loadHistory();
  const entry = {
    address,
    tier: result.tier,
    score: result.score,
    scannedAt: new Date().toISOString(),
    result,
  };
  const filtered = history.filter((h) => h.address.toLowerCase() !== address.toLowerCase());
  const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

export default function ScanTab({ connected, stateVersion, onStateChanged, onRequireConnect }) {
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState("form");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [liveTxHash, setLiveTxHash] = useState(null);
  const [pendingTxHash, setPendingTxHash] = useState(null);
  const [checkingAgain, setCheckingAgain] = useState(false);
  const [history, setHistory] = useState([]);
  const [retrying, setRetrying] = useState(false);
  const [poolBalance, setPoolBalance] = useState(null);
  const [lastTxHash, setLastTxHash] = useState(null);
  const liveStatus = useLiveTxStatus(liveTxHash || pendingTxHash || lastTxHash);

  function recordTxHash(hash) {
    setLiveTxHash(hash);
    setLastTxHash(hash);
  }

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!connected) return;
    refreshContractState(null, ["poolBalance"])
      .then((snapshot) => setPoolBalance(snapshot.poolBalance.balance_gen))
      .catch((e) => console.error("Could not load pool balance", e));
  }, [connected, stateVersion]);

  async function fetchAndShowResult(targetAddress, attempts = 1) {
    const snapshot = await refreshContractState(
      targetAddress,
      ["scan", "poolBalance"],
      { attempts },
    );
    const parsed = snapshot.scan;
    setPoolBalance(snapshot.poolBalance.balance_gen);
    setResult(parsed);
    setPendingTxHash(null);
    setPhase("result");
    if (!parsed.error) {
      setHistory(saveToHistory(targetAddress, parsed));
    }
  }

  async function handleScan() {
    if (!connected) {
      onRequireConnect();
      return;
    }
    if (!address.trim()) {
      setError("Enter a wallet address to look up.");
      return;
    }
    const target = address.trim();
    setError("");
    setPendingTxHash(null);
    setLiveTxHash(null);
    setPhase("scanning");
    try {
      await writeContract(CONTRACT_ADDRESS, "scan_wallet", [target], SCAN_FEE_GEN, recordTxHash);
      await fetchAndShowResult(target, 3);
      onStateChanged();
    } catch (e) {
      console.error(e);
      if (e.isPendingTimeout) {
        setPendingTxHash(e.txHash);
        setError("Submitted and the fee's been paid, consensus is just taking longer than usual. Check its status below when you're ready.");
      } else {
        setError(friendlyError(e));
      }
      setPhase("form");
    } finally {
      setLiveTxHash(null);
    }
  }

  async function handleCheckAgain() {
    if (!pendingTxHash) return;
    setCheckingAgain(true);
    setError("");
    try {
      await checkTransactionStatus(pendingTxHash);
      await fetchAndShowResult(address.trim(), 3);
      onStateChanged();
    } catch (e) {
      console.error(e);
      setError("Still not settled. This transaction is real, feel free to check it directly on the explorer, or try again shortly.");
    } finally {
      setCheckingAgain(false);
    }
  }

  function reset() {
    setResult(null);
    setError("");
    setPendingTxHash(null);
    setPhase("form");
  }

  function viewHistoryEntry(entry) {
    setAddress(entry.address);
    setResult(entry.result);
    setError("");
    setPhase("result");
  }

  async function handleRetryFetch() {
    if (!address.trim()) return;
    setRetrying(true);
    setError("");
    try {
      await fetchAndShowResult(address.trim());
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
    } finally {
      setRetrying(false);
    }
  }

  const tierInfo = result?.tier ? TIER_INFO[result.tier] : null;

  return (
    <div>
      <section className="page-head">
        <p className="eyebrow mono" style={{ color: "var(--scan-accent)" }}>WALLET LOOKUP</p>
        <h1 className="page-title">Read any wallet's real history.</h1>
        <p className="page-lede">
          Balance, activity age, recent failures, and a behavioral read, all pulled live from
          the chain. Costs {SCAN_FEE_GEN} GEN per lookup.
        </p>
      </section>

      {phase === "scanning" && liveTxHash && (
        <div className="status-line" style={{ marginBottom: 16 }}>
          {liveStatus ? `Status: ${liveStatus}` : "Submitted, waiting on the network"}, consensus can pass through several stages before finishing.{" "}
          <a href={getExplorerTxUrl(liveTxHash)} target="_blank" rel="noreferrer" style={{ color: "var(--scan-accent)" }}>
            Watch it live on the explorer
          </a>
        </div>
      )}

      {lastTxHash && !liveTxHash && !pendingTxHash && (
        <div className="status-line" style={{ marginBottom: 16 }}>
          Transaction status: {liveStatus || "Submitted"}.{" "}
          <a href={getExplorerTxUrl(lastTxHash)} target="_blank" rel="noreferrer" style={{ color: "var(--scan-accent)", wordBreak: "break-all" }}>
            {lastTxHash}
          </a>
        </div>
      )}

      {error && (
        <div className="error-box">
          {error}
          {pendingTxHash && (
            <div style={{ marginTop: 10 }}>
              {liveStatus && (
                <p className="mono" style={{ fontSize: 12, marginBottom: 6 }}>Current status: {liveStatus}</p>
              )}
              <div className="mono" style={{ fontSize: 11, wordBreak: "break-all", marginBottom: 8 }}>
                <a href={getExplorerTxUrl(pendingTxHash)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                  {pendingTxHash}
                </a>
              </div>
              <button className="btn-primary scan" onClick={handleCheckAgain} disabled={checkingAgain}>
                {checkingAgain ? "Checking…" : "Check status again"}
              </button>
            </div>
          )}
        </div>
      )}

      {phase !== "result" && (
        <section className="card">
          <div className="field">
            <label>Wallet address</label>
            <input
              type="text"
              placeholder="0x..."
              value={address}
              disabled={phase === "scanning"}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <button
            className="btn-primary scan"
            onClick={handleScan}
            disabled={phase === "scanning"}
          >
            {phase === "scanning" ? "Reading wallet…" : `Scan for ${SCAN_FEE_GEN} GEN`}
          </button>

          {history.length > 0 && (
            <div className="soon-wrap">
              <p className="soon-title mono">YOUR PREVIOUS SCANS</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {history.map((h) => (
                  <button
                    key={h.address + h.scannedAt}
                    onClick={() => viewHistoryEntry(h)}
                    className="mono"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                      padding: "8px 10px",
                      background: "var(--bg-2)",
                      border: "1px solid var(--line)",
                      borderRadius: 4,
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--text)",
                    }}
                  >
                    <span>{h.address.slice(0, 6)}…{h.address.slice(-4)}</span>
                    <span>{TIER_INFO[h.tier]?.name ?? h.tier}</span>
                    <span style={{ color: "var(--muted)" }}>{h.scannedAt.slice(0, 10)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {phase === "result" && result && (
        <section className="card">
          {result.error ? (
            <div>
              <div className="error-box">{result.error}</div>
              <button className="btn-primary scan" onClick={handleRetryFetch} disabled={retrying}>
                {retrying ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : (
            <>
              <div className="field">
                <span className={`tier-badge ${tierInfo?.className ?? "tier-red"}`}>
                  {tierInfo?.name ?? "UNKNOWN"}
                </span>
                {result.score != null && (
                  <span className="mono" style={{ marginLeft: 12, color: "var(--muted)", fontSize: 13 }}>
                    {result.score}/100
                  </span>
                )}
              </div>

              <p className="page-lede" style={{ marginBottom: 16 }}>{result.behavior_profile}</p>

              <div className="stat-grid">
                <div className="stat">
                  <div className="stat-label">Pool liquidity</div>
                  <div className="stat-value mono">{poolBalance} GEN</div>
                </div>
                <div className="stat">
                  <div className="stat-label">GEN balance</div>
                  <div className="stat-value mono">{Number(result.gen_balance).toFixed(2)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Nonce</div>
                  <div className="stat-value mono">{result.nonce}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Wallet age</div>
                  <div className="stat-value mono">{result.age_days}d</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Recent failures</div>
                  <div className="stat-value mono">{result.failed_count}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Fees paid (last 10)</div>
                  <div className="stat-value mono">{result.total_fee_gen}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Unrecognized tokens</div>
                  <div className="stat-value mono">{result.unrecognized_tokens}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Smallest tx (last 10)</div>
                  <div className="stat-value mono">{result.min_value_gen} GEN</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Largest tx (last 10)</div>
                  <div className="stat-value mono">{result.max_value_gen} GEN</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Average tx (last 10)</div>
                  <div className="stat-value mono">{result.avg_value_gen} GEN</div>
                </div>
              </div>

              <p className="status-line">{result.reasoning}</p>

              {Array.isArray(result.timeline) && result.timeline.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <p className="soon-title mono" style={{ marginBottom: 10 }}>LAST {result.timeline.length} TRANSACTIONS</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {result.timeline.map((tx, i) => (
                      <div
                        key={tx.hash || i}
                        className="mono"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          fontSize: 12,
                          padding: "8px 10px",
                          background: "var(--bg-2)",
                          border: "1px solid var(--line)",
                          borderRadius: 4,
                          color: tx.failed ? "var(--red)" : "var(--text)",
                        }}
                      >
                        <span>{tx.receivedAt?.replace("T", " ").slice(0, 16)}</span>
                        <span>{tx.status}{tx.failed ? " · failed" : ""}</span>
                        <span>{tx.value_gen} GEN</span>
                        <span style={{ color: "var(--muted)" }}>fee {tx.fee_gen}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button className="btn-primary scan" onClick={reset} style={{ marginTop: 20 }}>
                Scan another wallet
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
