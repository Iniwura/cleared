import { useEffect, useState } from "react";
import { readContract, writeContract, checkTransactionStatus, parseResult, friendlyError, getExplorerTxUrl } from "../lib/gl";
import { useLiveTxStatus } from "../lib/useLiveTxStatus";
import { CONTRACT_ADDRESS } from "../lib/config";

export default function ProfileTab({ connected, address, onRequireConnect }) {
  const [loan, setLoan] = useState(null);
  const [repaymentCount, setRepaymentCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [liveTxHash, setLiveTxHash] = useState(null);
  const [pendingTxHash, setPendingTxHash] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // "claim" | "repay"
  const [checkingAgain, setCheckingAgain] = useState(false);
  const liveStatus = useLiveTxStatus(liveTxHash || pendingTxHash);

  async function loadProfile() {
    if (!connected || !address) return;
    setLoading(true);
    setError("");
    try {
      const [loanRaw, repayRaw] = await Promise.all([
        readContract(CONTRACT_ADDRESS, "get_loan", [address]),
        readContract(CONTRACT_ADDRESS, "get_repayment_count", [address]),
      ]);
      setLoan(parseResult(loanRaw));
      setRepaymentCount(parseResult(repayRaw).repayment_count);
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, address]);

  async function fetchDecisionAndReload() {
    const raw = await readContract(CONTRACT_ADDRESS, "get_last_decision", [address]);
    const decision = parseResult(raw);
    if (decision.success === false) {
      setError(decision.message || "That didn't go through.");
    } else if (decision.success === true) {
      const refundGen = decision.refunded_wei ? decision.refunded_wei / 1e18 : 0;
      setSuccessMsg(refundGen > 0 ? `${decision.message} ${refundGen} GEN overpayment refunded.` : decision.message);
    }
    await loadProfile();
  }

  async function handleClaim() {
    setBusy(true);
    setError("");
    setSuccessMsg("");
    setPendingTxHash(null);
    setLiveTxHash(null);
    setPendingAction("claim");
    try {
      await writeContract(CONTRACT_ADDRESS, "claim_loan", [address], 0, setLiveTxHash);
      await fetchDecisionAndReload();
    } catch (e) {
      console.error(e);
      if (e.isPendingTimeout) {
        setPendingTxHash(e.txHash);
        setError("Claim submitted, consensus is taking longer than usual. Check status below, don't claim again in the meantime.");
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setBusy(false);
      setLiveTxHash(null);
    }
  }

  async function handleRepay() {
    if (!loan?.owed_gen) return;
    setBusy(true);
    setError("");
    setSuccessMsg("");
    setPendingTxHash(null);
    setLiveTxHash(null);
    setPendingAction("repay");
    try {
      await writeContract(CONTRACT_ADDRESS, "repay_loan", [address], loan.owed_gen, setLiveTxHash);
      await fetchDecisionAndReload();
    } catch (e) {
      console.error(e);
      if (e.isPendingTimeout) {
        setPendingTxHash(e.txHash);
        setError("Your GEN has already been sent, consensus is just taking longer than usual to confirm it. Do not repay again, check the status below instead.");
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setBusy(false);
      setLiveTxHash(null);
    }
  }

  async function handleCheckAgain() {
    if (!pendingTxHash) return;
    setCheckingAgain(true);
    setError("");
    try {
      await checkTransactionStatus(pendingTxHash);
      setPendingTxHash(null);
      await fetchDecisionAndReload();
    } catch (e) {
      console.error(e);
      setError("Still not settled. Check the explorer directly if you want certainty before trying again.");
    } finally {
      setCheckingAgain(false);
    }
  }

  async function handleCheckDefault() {
    setBusy(true);
    setError("");
    setSuccessMsg("");
    setPendingTxHash(null);
    setLiveTxHash(null);
    setPendingAction("default-check");
    try {
      await writeContract(CONTRACT_ADDRESS, "check_default", [address], 0, setLiveTxHash);
      await loadProfile();
      setSuccessMsg("Default check ran against live network data.");
    } catch (e) {
      console.error(e);
      if (e.isPendingTimeout) {
        setPendingTxHash(e.txHash);
        setError("Check submitted, consensus is taking longer than usual.");
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setBusy(false);
      setLiveTxHash(null);
    }
  }

  if (!connected) {
    return (
      <div>
        <section className="page-head">
          <p className="eyebrow mono">PROFILE</p>
          <h1 className="page-title">Your record on this contract.</h1>
        </section>
        <section className="card center">
          <p className="page-lede" style={{ margin: "0 auto 16px" }}>Connect a wallet to see your loan status and repayment history.</p>
          <button className="btn-primary" onClick={onRequireConnect}>Connect wallet</button>
        </section>
      </div>
    );
  }

  const hasUnclaimedOffer = loan?.exists && !loan.claimed && !loan.active && !loan.defaulted;
  const hasOpenBalance = loan?.exists && (loan.active || loan.defaulted);

  return (
    <div>
      <section className="page-head">
        <p className="eyebrow mono">PROFILE</p>
        <h1 className="page-title">Your record on this contract.</h1>
      </section>

      {successMsg && <div className="success-box">{successMsg}</div>}

      {busy && liveTxHash && (
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
              <button className="btn-primary" onClick={handleCheckAgain} disabled={checkingAgain}>
                {checkingAgain ? "Checking…" : "Check status again"}
              </button>
            </div>
          )}
        </div>
      )}

      <section className="card">
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Loans repaid</div>
            <div className="stat-value mono">{loading ? "…" : repaymentCount ?? 0}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Current loan balance</div>
            <div className="stat-value mono">
              {loading ? "…" : hasOpenBalance ? `${loan.owed_gen} GEN` : "0 GEN"}
            </div>
          </div>
        </div>

        {!loading && hasUnclaimedOffer && (
          <>
            <p className="status-line" style={{ marginBottom: 16 }}>
              Approved for {loan.principal_gen} GEN, not yet claimed · "{loan.reason || "no reason given"}"
            </p>
            <button className="btn-primary" onClick={handleClaim} disabled={busy || Boolean(pendingTxHash)}>
              {busy && pendingAction === "claim" ? "Claiming…" : pendingTxHash ? "Awaiting confirmation, check above" : `Claim ${loan.principal_gen} GEN`}
            </button>
          </>
        )}

        {!loading && hasOpenBalance && (
          <>
            <p className="status-line" style={{ marginBottom: 16 }}>
              {loan.defaulted ? "Defaulted, past due" : `Due ${loan.due_at?.slice(0, 10)}`} · "{loan.reason || "no reason given"}"
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn-primary" onClick={handleRepay} disabled={busy || Boolean(pendingTxHash)}>
                {busy && pendingAction === "repay" ? "Repaying…" : pendingTxHash ? "Awaiting confirmation, check above" : `Repay ${loan.owed_gen} GEN`}
              </button>
              {loan.active && !loan.defaulted && loan.due_at && new Date(loan.due_at) < new Date() && (
                <button className="btn-primary" onClick={handleCheckDefault} disabled={busy || Boolean(pendingTxHash)}>
                  {busy && pendingAction === "default-check" ? "Checking…" : "This looks overdue, check for default"}
                </button>
              )}
            </div>
          </>
        )}

        {!loading && !hasUnclaimedOffer && !hasOpenBalance && (
          <p className="page-lede">No active loan right now.</p>
        )}

        {loan?.defaulted && (
          <div className="error-box" style={{ marginTop: 16 }}>
            This wallet defaulted on a previous loan and can't borrow again until it's settled.
            The repay button above will clear it.
          </div>
        )}
      </section>
    </div>
  );
}
