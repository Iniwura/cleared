import { useEffect, useState } from "react";
import HomeTab from "./components/HomeTab";
import ScanTab from "./components/ScanTab";
import ApplyTab from "./components/ApplyTab";
import ProfileTab from "./components/ProfileTab";
import { connectWallet, disconnectWallet, friendlyError, getTransaction, getTransactionStatus } from "./lib/gl";

export default function App() {
  const [tab, setTab] = useState("home");
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [stateVersion, setStateVersion] = useState(0);
  const [transactions, setTransactions] = useState({});

  useEffect(() => {
    const pending = Object.entries(transactions).flatMap(([wallet, actions]) => (
      Object.entries(actions)
        .filter(([, transaction]) => transaction.status !== "FINALIZED")
        .map(([action, transaction]) => ({ wallet, action, transaction }))
    ));
    if (pending.length === 0) return;

    let cancelled = false;
    async function refreshStatuses() {
      const updates = await Promise.all(pending.map(async (entry) => {
        try {
          const transaction = await getTransaction(entry.transaction.hash);
          return { ...entry, status: getTransactionStatus(transaction) };
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setTransactions((current) => {
        let changed = false;
        const next = { ...current };
        for (const update of updates.filter(Boolean)) {
          const existing = next[update.wallet]?.[update.action];
          if (!existing || existing.hash !== update.transaction.hash || existing.status === update.status) continue;
          next[update.wallet] = { ...next[update.wallet], [update.action]: { ...existing, status: update.status } };
          changed = true;
        }
        return changed ? next : current;
      });
    }

    refreshStatuses();
    const interval = setInterval(refreshStatuses, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [transactions]);

  function notifyStateChanged() {
    setStateVersion((version) => version + 1);
  }

  function trackTransaction(wallet, action, hash, metadata = {}) {
    if (!wallet || !action || !hash) return;
    const walletKey = wallet.toLowerCase();
    setTransactions((current) => ({
      ...current,
      [walletKey]: {
        ...current[walletKey],
        [action]: { hash, action, status: "SUBMITTED", submittedAt: Date.now(), ...metadata },
      },
    }));
  }

  const walletTransactions = address ? transactions[address.toLowerCase()] || {} : {};

  async function handleConnect() {
    setConnecting(true);
    setConnectError("");
    try {
      const addr = await connectWallet((newAddr) => setAddress(newAddr));
      setAddress(addr);
    } catch (e) {
      console.error(e);
      setConnectError(friendlyError(e));
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    disconnectWallet();
    setAddress(null);
    setMenuOpen(false);
  }

  function shortAddress(a) {
    if (!a) return "";
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          CLEAR<span>ED</span>
        </div>
        {!address ? (
          <button className="wallet-btn" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        ) : (
          <div style={{ position: "relative" }}>
            <button className="wallet-btn connected" onClick={() => setMenuOpen((v) => !v)}>
              {shortAddress(address)}
            </button>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  padding: 6,
                  zIndex: 10,
                }}
              >
                <button
                  className="wallet-btn"
                  style={{ border: "none", whiteSpace: "nowrap" }}
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {connectError && <div className="error-box">{connectError}</div>}

      <nav className="tabs">
        <button className={`tab-btn ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>
          Home
        </button>
        <button className={`tab-btn ${tab === "apply" ? "active" : ""}`} onClick={() => setTab("apply")}>
          Apply
        </button>
        <button className={`tab-btn scan-tab ${tab === "scan" ? "active" : ""}`} onClick={() => setTab("scan")}>
          Scan
        </button>
        <button className={`tab-btn ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
          Profile
        </button>
      </nav>

      {tab === "home" && <HomeTab onNavigate={setTab} />}
      {tab === "apply" && <ApplyTab connected={Boolean(address)} address={address} transactions={walletTransactions} onTrackTransaction={trackTransaction} stateVersion={stateVersion} onStateChanged={notifyStateChanged} onRequireConnect={handleConnect} />}
      {tab === "scan" && <ScanTab connected={Boolean(address)} address={address} transactions={walletTransactions} onTrackTransaction={trackTransaction} stateVersion={stateVersion} onStateChanged={notifyStateChanged} onRequireConnect={handleConnect} />}
      {tab === "profile" && (
        <ProfileTab connected={Boolean(address)} address={address} transactions={walletTransactions} onTrackTransaction={trackTransaction} stateVersion={stateVersion} onStateChanged={notifyStateChanged} onRequireConnect={handleConnect} />
      )}
    </div>
  );
}
