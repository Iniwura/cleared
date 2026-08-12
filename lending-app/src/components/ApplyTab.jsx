import { useEffect, useState } from "react";
import RangeGauge from "./RangeGauge";
import { writeContract, readContract, checkTransactionStatus, parseResult, getConnectedAddress, friendlyError, getExplorerTxUrl } from "../lib/gl";
import { useLiveTxStatus } from "../lib/useLiveTxStatus";
import { CONTRACT_ADDRESS, MIN_LOAN_GEN, MAX_LOAN_GEN, INTEREST_PERCENT, TERM_DAYS, TIER_INFO } from "../lib/config";

export default function ApplyTab({ connected, onRequireConnect }) {
  const [amount, setAmount] = useState(3);
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState("form"); // form | submitting | review | claiming | claimed
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [liveTxHash, setLiveTxHash] = useState(null);
  const [pendingTxHash, setPendingTxHash] = useState(null);
  const [checkingAgain, setCheckingAgain] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [poolBalance, setPoolBalance] = useState(null);
  const liveStatus = useLiveTxStatus(liveTxHash || pendingTxHash);

  useEffect(() => {
    if (!connected) return;
    readContract(CONTRACT_ADDRESS, "get_pool_balance", [])
      .then((raw) => setPoolBalance(parseResult(raw).balance_gen))
      .catch((e) => console.error("Could not load pool balance", e));
  }, [connected]);

  async function fetchDecision(targetAddress) {
    const raw = await readContract(CONTRACT_ADDRESS, "get_last_decision", [targetAddress]);
    return parseResult(raw);
  }

  async function handleSubmit() {
    if (!connected) {
      onRequireConnect();
      return;
    }
    const address = getConnectedAddress();
    setError("");
    setPendingTxHash(null);
    setLiveTxHash(null);
    setPhase("submitting");
    try {
      await writeContract(CONTRACT_ADDRESS, "request_loan", [address, String(amount), reason], 0, setLiveTxHash);
      const parsed = await fetchDecision(address);
      setResult(parsed);
      setPhase("review");
    } catch (e) {
      console.error(e);
      if (e.isPendingTimeout) {
        setPendingTxHash(e.txHash);
        setError("Submitted, consensus is taking longer than usual. Your application is real and on-chain, check its status below when you're ready.");
      } else {
        setError(friendlyError(e));
      }
      setPhase("form");
    } finally {
      setLiveTxHash(null);
    }
  }

  // The read right after a write can occasionally land a beat before state
  // has fully settled, "no decision found" here usually just means try the
  // read again, not that anything actually failed.
  async function handleRetryFetch() {
    setRetrying(true);
    setError("");
    try {
      const parsed = await fetchDecision(getConnectedAddress());
      setResult(parsed);
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
    } finally {
      setRetrying(false);
    }
  }

  async function handleCheckAgain() {
    if (!pendingTxHash) return;
    setCheckingAgain(true);
    setError("");
    try {
      await checkTransactionStatus(pendingTxHash);
      const parsed = await fetchDecision(getConnectedAddress());
      setResult(parsed);
      setPendingTxHash(null);
      setPhase("review");
    } catch (e) {
      console.error(e);
      setError("Still not settled yet. This transaction is real, feel free to check it directly on the explorer, or try again in a bit.");
    } finally {
      setCheckingAgain(false);
    }
  }

  async function handleClaim() {
    const address = getConnectedAddress();
    setError("");
    setPendingTxHash(null);
    setLiveTxHash(null);
    setPhase("claiming");
    try {
      await writeContract(CONTRACT_ADDRESS, "claim_loan", [address], 0, setLiveTxHash);
      const raw = await readContract(CONTRACT_ADDRESS, "get_last_decision", [address]);
      const claimResult = parseResult(raw);
      if (claimResult.success === false) {
        setError(claimResult.message || "Claim did not go through.");
        setPhase("review");
        return;
      }
      setResult((prev) => ({ ...prev, ...claimResult }));
      setPhase("claimed");
    } catch (e) {
      console.error(e);
      if (e.isPendingTimeout) {
        setPendingTxHash(e.txHash);
        setError("Claim submitted, consensus is taking longer than usual. Check its status below before trying again, don't claim twice.");
      } else {
        setError(friendlyError(e));
      }
      setPhase("review");
    } finally {
      setLiveTxHash(null);
    }
  }

  async function handleCheckClaimAgain() {
    if (!pendingTxHash) return;
    setCheckingAgain(true);
    setError("");
    try {
      await checkTransactionStatus(pendingTxHash);
      const address = getConnectedAddress();
      const raw = await readContract(CONTRACT_ADDRESS, "get_last_decision", [address]);
      const claimResult = parseResult(raw);
      setResult((prev) => ({ ...prev, ...claimResult }));
      setPendingTxHash(null);
      setPhase(claimResult.success === false ? "review" : "claimed");
    } catch (e) {
      console.error(e);
      setError("Still not settled. Check the explorer directly if you want certainty before trying again.");
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

  const tierKey = result?.tier;
  const tierInfo = tierKey ? TIER_INFO[tierKey] : null;
  const approvedGen = result?.approved_wei != null ? result.approved_wei / 1e18 : null;
  const owedGen = result?.owed_wei != null ? result.owed_wei / 1e18 : null;

  return (
    <div>
      <section className="page-head">
        <p className="eyebrow mono">APPLICATION</p>
        <h1 className="page-title">Request without a story to sell.</h1>
        <p className="page-lede">
          Balance, activity, and history are read straight from the chain the moment you apply.
          The only things you provide are how much you want, and why, neither is something you
          can fake your way past.
        </p>
      </section>

      {(phase === "submitting" || phase === "claiming") && liveTxHash && (
        <div className="status-line" style={{ marginBottom: 16 }}>
          {liveStatus ? `Status: ${liveStatus}` : "Submitted, waiting on the network"}, consensus can pass through several stages before finishing.{" "}
          <a href={getExplorerTxUrl(liveTxHash)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            Watch it live on the explorer
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
              <button
                className="btn-primary"
                onClick={phase === "claiming" ? handleCheckClaimAgain : handleCheckAgain}
                disabled={checkingAgain}
              >
                {checkingAgain ? "Checking…" : "Check status again"}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "form" && (
        <section className="card">
          <div className="field">
            <label>
              Amount requested
              <span className="not-scored-badge">YOUR CHOICE</span>
            </label>
            <input
              type="range"
              className="slider"
              min={MIN_LOAN_GEN}
              max={MAX_LOAN_GEN}
              step={0.5}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, var(--accent) ${((amount - MIN_LOAN_GEN) / (MAX_LOAN_GEN - MIN_LOAN_GEN)) * 100}%, var(--line) 0%)`,
              }}
            />
            <div className="slider-meta">
              <span>{MIN_LOAN_GEN} GEN</span>
              <span className="mono">{amount} GEN</span>
              <span>{MAX_LOAN_GEN} GEN</span>
            </div>
          </div>

          <div className="field">
            <label>
              Reason for borrowing
              <span className="attested-badge">SCORED FOR CLARITY, NOT TRUTH</span>
            </label>
            <textarea
              rows={3}
              maxLength={280}
              placeholder="What's this for? A specific, concrete reason moves you toward the top of your tier's range. It can never change your tier or turn a decline into an approval, only your wallet's real history does that."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Pool liquidity</div>
              <div className="stat-value mono">{poolBalance != null ? `${poolBalance} GEN` : "…"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Interest</div>
              <div className="stat-value mono">{INTEREST_PERCENT}% flat</div>
            </div>
            <div className="stat">
              <div className="stat-label">Term</div>
              <div className="stat-value mono">{TERM_DAYS} days from claim</div>
            </div>
            <div className="stat">
              <div className="stat-label">Evaluated from</div>
              <div className="stat-value mono">live wallet data</div>
            </div>
          </div>

          <button className="btn-primary" onClick={handleSubmit}>
            Submit application
          </button>

          <div className="soon-wrap">
            <p className="soon-title mono">EVALUATION ROADMAP</p>
            <div className="soon-chips">
              <span className="soon-chip">Stuck-GEN detection as collateral signal · IN PROGRESS</span>
              <span className="soon-chip">Mainnet wallet evidence · PLANNED</span>
            </div>
          </div>
        </section>
      )}

      {phase === "submitting" && (
        <section className="card center">
          <p className="page-lede" style={{ margin: "0 auto" }}>Reading your wallet…</p>
        </section>
      )}

      {(phase === "review" || phase === "claiming") && result && (
        <section className="card">
          {result.error ? (
            <div>
              <div className="error-box">{result.error}</div>
              <button className="btn-primary" onClick={handleRetryFetch} disabled={retrying}>
                {retrying ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : (
            <>
              <div className="field">
                <span className={`tier-badge ${tierInfo?.className ?? "tier-red"}`}>
                  {tierInfo?.name ?? "DECLINED"}
                </span>
              </div>

              <p className="page-lede" style={{ marginBottom: 8 }}>
                {result.reason_out}
              </p>

              {result.approved && (
                <>
                  <RangeGauge tierInfo={tierInfo} approvedGen={approvedGen} clarity={result.clarity} />
                  {result.repay_count > 0 && (
                    <p className="status-line">
                      Lifted by {result.repay_count} prior repayment{result.repay_count === 1 ? "" : "s"}.
                    </p>
                  )}
                  <div className="stat-grid">
                    <div className="stat">
                      <div className="stat-label">You'd receive</div>
                      <div className="stat-value mono">{approvedGen} GEN</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">You'd owe</div>
                      <div className="stat-value mono">{owedGen} GEN</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Deadline</div>
                      <div className="stat-value mono">7 days from claim</div>
                    </div>
                  </div>

                  <button className="btn-primary" onClick={handleClaim} disabled={phase === "claiming"}>
                    {phase === "claiming" ? "Claiming…" : `Claim ${approvedGen} GEN`}
                  </button>
                  <p className="status-line" style={{ marginTop: 10 }}>
                    Nothing has moved yet. This is a review of what you'd get, claiming is a separate step.
                  </p>
                </>
              )}

              {!result.approved && (
                <button className="btn-primary" onClick={reset} style={{ marginTop: 12 }}>
                  New application
                </button>
              )}
            </>
          )}
        </section>
      )}

      {phase === "claimed" && result && (
        <section className="card">
          <div className="field">
            <span className={`tier-badge ${tierInfo?.className ?? "tier-red"}`}>
              {tierInfo?.name}
            </span>
          </div>
          <p className="page-lede" style={{ marginBottom: 16 }}>
            Claimed. {approvedGen} GEN is in your wallet now.
          </p>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Received</div>
              <div className="stat-value mono">{approvedGen} GEN</div>
            </div>
            <div className="stat">
              <div className="stat-label">Owed</div>
              <div className="stat-value mono">{owedGen} GEN</div>
            </div>
            <div className="stat">
              <div className="stat-label">Due</div>
              <div className="stat-value mono">{result.due_at?.slice(0, 10)}</div>
            </div>
          </div>
          <button className="btn-primary" onClick={reset} style={{ marginTop: 20 }}>
            Done
          </button>
        </section>
      )}
    </div>
  );
}
