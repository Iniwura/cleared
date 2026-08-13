import { useState } from "react";
import HomeTab from "./components/HomeTab";
import ScanTab from "./components/ScanTab";
import ApplyTab from "./components/ApplyTab";
import ProfileTab from "./components/ProfileTab";
import { connectWallet, disconnectWallet, friendlyError } from "./lib/gl";

export default function App() {
  const [tab, setTab] = useState("home");
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [stateVersion, setStateVersion] = useState(0);

  function notifyStateChanged() {
    setStateVersion((version) => version + 1);
  }

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
      {tab === "apply" && <ApplyTab connected={Boolean(address)} address={address} stateVersion={stateVersion} onStateChanged={notifyStateChanged} onRequireConnect={handleConnect} />}
      {tab === "scan" && <ScanTab connected={Boolean(address)} stateVersion={stateVersion} onStateChanged={notifyStateChanged} onRequireConnect={handleConnect} />}
      {tab === "profile" && (
        <ProfileTab connected={Boolean(address)} address={address} stateVersion={stateVersion} onStateChanged={notifyStateChanged} onRequireConnect={handleConnect} />
      )}
    </div>
  );
}
