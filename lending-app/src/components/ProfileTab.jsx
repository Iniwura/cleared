import { useCallback, useEffect, useRef, useState } from "react";
import { readContract, writeContract, checkTransactionStatus, parseResult, friendlyError, getExplorerTxUrl } from "../lib/gl";
import { useLiveTxStatus } from "../lib/useLiveTxStatus";
import { CONTRACT_ADDRESS } from "../lib/config";
import { refreshContractState } from "../lib/contractState";

export default function ProfileTab({ connected, address, stateVersion, onStateChanged, onRequireConnect }) {
  const [loan, setLoan] = useState(null);
  const [repaymentCount, setRepaymentCount] = useState(null);
  const [poolBalance, setPoolBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [liveTxHash, setLiveTxHash] = useState(null);
  const [pendingTxHash, setPendingTxHash] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // "claim" | "repay"
  const [checkingAgain, setCheckingAgain] = useState(false);
  const [lastTxHash, setLastTxHash] = useState(null);
  const refreshId = useRef(0);
  const liveStatus = useLiveTxStatus(liveTxHash || pendingTxHash || lastTxHash);

  function recordTxHash(hash) {
    setLiveTxHash(hash);
    setLastTxHash(hash);
  }

  const loadProfile = useCallback(async (attempts = 1) => {
    if (!connected || !address) return;
    const requestId = ++refreshId.current;
    setLoading(true);
    setError("");
    try {
      const contractState = await refreshContractState(
        address,
        ["loan", "repaymentCount", "poolBalance"],
        { attempts },
      );
      const snapshot = {
        loan: contractState.loan,
        repaymentCount: contractState.repaymentCount.repayment_count,
        poolBalance: contractState.poolBalance.balance_gen,
      };
      if (requestId === refreshId.current) {
        setLoan(snapshot.loan);
        setRepaymentCount(snapshot.repaymentCount);
        setPoolBalance(snapshot.poolBalance);
      }
      return snapshot;
    } catch (e) {
      console.error(e);
      if (requestId === refreshId.current) setError(friendlyError(e));
      return null;
    } finally {
      if (requestId === refreshId.current) setLoading(false);
    }
  }, [connected, address]);

  useEffect(() => {
    refreshId.current += 1;
    setLoan(null);
    setRepaymentCount(null);
    setPoolBalance(null);
    setError("");
    setSuccessMsg("");
    setLiveTxHash(null);
    setPendingTxHash(null);
    setPendingAction(null);
    setLastTxHash(null);
  }, [connected, address]);

  useEffect(() => {
    loadProfile();
    return () => {
      refreshId.current += 1;
    };
  }, [connected, address, stateVersion, loadProfile]);

  async function fetchDecisionAndReload() {
    const contractState = await refreshContractState(
      address,
      ["decision", "loan", "repaymentCount", "poolBalance"],
      { attempts: 3 },
    );
    const decision = contractState.decision;
    if (decision.success === false) {
      setError(decision.message || "That didn't go through.");
    } else if (decision.success === true) {
      const refundGen = decision.refunded_wei ? decision.refunded_wei / 1e18 : 0;
      setSuccessMsg(refundGen > 0 ? `${decision.message} ${refundGen} GEN overpayment refunded.` : decision.message);
    }
    setLoan(contractState.loan);
    setRepaymentCount(contractState.repaymentCount.repayment_count);
    setPoolBalance(contractState.poolBalance.balance_gen);
  }

  async function verifyClaimAndReload() {
    const snapshot = await loadProfile(3);
    if (!snapshot) return;
    const currentLoan = snapshot.loan;
    if (!currentLoan.claimed || !currentLoan.active) {
      const decisionRaw = await readContract(CONTRACT_ADDRESS, "get_last_decision", [address]);
      const decision = parseResult(decisionRaw);
      setError(decision.message || "Claim finalized, but the loan is not active.");
      return;
    }
    setLoan(currentLoan);
    setSuccessMsg(`Claim finalized. ${currentLoan.principal_gen} GEN is active and due ${currentLoan.due_at?.slice(0, 10)}.`);
  }

  async function handleClaim() {
    if (busy || pendingTxHash) return;
    setBusy(true);
    setError("");
    setSuccessMsg("");
    setPendingTxHash(null);
    setLiveTxHash(null);
    setPendingAction("claim");
    try {
      await writeContract(CONTRACT_ADDRESS, "claim_loan", [address], 0, recordTxHash);
      await verifyClaimAndReload();
      onStateChanged();
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
      await writeContract(CONTRACT_ADDRESS, "repay_loan", [address], loan.owed_gen, recordTxHash);
      await fetchDecisionAndReload();
      onStateChanged();
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
      if (pendingAction === "claim") {
        await verifyClaimAndReload();
      } else if (pendingAction === "default-check") {
        await loadProfile();
        setSuccessMsg("Default check finalized against live contract state.");
      } else {
        await fetchDecisionAndReload();
      }
      onStateChanged();
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
      await writeContract(CONTRACT_ADDRESS, "check_default", [address], 0, recordTxHash);
      await loadProfile(3);
      setSuccessMsg("Default check ran against live network data.");
      onStateChanged();
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
  const awaitingFinality = lastTxHash && String(liveStatus || "").toUpperCase() !== "FINALIZED";
  const claimAwaitingFinality = awaitingFinality && pendingAction === "claim";
  const repaymentAwaitingFinality = awaitingFinality && pendingAction === "repay";

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

      {lastTxHash && !liveTxHash && !pendingTxHash && (
        <div className="status-line" style={{ marginBottom: 16 }}>
          Transaction status: {liveStatus || "Submitted"}.{" "}
          <a href={getExplorerTxUrl(lastTxHash)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
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
          <div className="stat">
            <div className="stat-label">Pool liquidity</div>
            <div className="stat-value mono">{loading ? "…" : `${poolBalance ?? 0} GEN`}</div>
          </div>
        </div>

        {!loading && hasUnclaimedOffer && (
          <>
            <p className="status-line" style={{ marginBottom: 16 }}>
              Approved for {loan.principal_gen} GEN, not yet claimed · "{loan.reason || "no reason given"}"
            </p>
            <button className="btn-primary" onClick={handleClaim} disabled={busy || Boolean(pendingTxHash) || claimAwaitingFinality}>
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
              <button className="btn-primary" onClick={handleRepay} disabled={busy || Boolean(pendingTxHash) || repaymentAwaitingFinality}>
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
