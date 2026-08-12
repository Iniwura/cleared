export default function HomeTab({ onNavigate }) {
  return (
    <div>
      <section className="hero">
        <p className="eyebrow mono">DECLASSIFIED CREDIT · GENLAYER TESTNET</p>
        <h1 className="hero-title">
          Your word isn't evidence.
          <br />
          <span className="accent-word">Your wallet is.</span>
        </h1>
        <p className="hero-sub">
          Every other loan starts with a form asking you to describe your own finances, numbers
          nobody checks, adjectives nobody verifies. This one starts by reading the chain. Balance,
          activity, age, failures, pulled live the moment you apply. There's nothing to embellish
          because there's nothing left for you to fill in.
        </p>
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <button className="btn-primary" onClick={() => onNavigate("apply")}>
            Apply for a loan
          </button>
          <button className="btn-primary scan" onClick={() => onNavigate("scan")}>
            Scan a wallet first
          </button>
        </div>
      </section>

      <section>
        <p className="eyebrow mono" style={{ marginTop: 32, marginBottom: 4 }}>THE ACTUAL DIFFERENCE</p>
        <h2 className="page-title" style={{ fontSize: "clamp(22px, 3.5vw, 30px)" }}>
          One of these can be faked in ten seconds.
        </h2>

        <div className="compare-grid">
          <div className="compare-card bad">
            <span className="compare-label bad">EVERYWHERE ELSE · SELF-REPORTED</span>
            <div className="compare-row">
              <span>Annual income</span>
              <span className="redacted-bar">whatever helps</span>
            </div>
            <div className="compare-row">
              <span>Employment status</span>
              <span className="redacted-bar">unverifiable</span>
            </div>
            <div className="compare-row">
              <span>Existing debts</span>
              <span className="redacted-bar">conveniently low</span>
            </div>
            <div className="compare-row">
              <span>Reason for loan</span>
              <span className="redacted-bar">written by an AI</span>
            </div>
          </div>

          <div className="compare-card good">
            <span className="compare-label good">HERE · READ LIVE FROM THE CHAIN</span>
            <div className="compare-row">
              <span>GEN balance</span>
              <span className="verified-tag">✓ VERIFIED</span>
            </div>
            <div className="compare-row">
              <span>Transaction count</span>
              <span className="verified-tag">✓ VERIFIED</span>
            </div>
            <div className="compare-row">
              <span>Wallet age</span>
              <span className="verified-tag">✓ VERIFIED</span>
            </div>
            <div className="compare-row">
              <span>Recent failures</span>
              <span className="verified-tag">✓ VERIFIED</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <p className="eyebrow mono" style={{ marginTop: 24, marginBottom: 4 }}>WHERE YOU LAND</p>
        <h2 className="page-title" style={{ fontSize: "clamp(22px, 3.5vw, 30px)" }}>
          Three outcomes. No appeals process, no exceptions.
        </h2>
        <div className="tier-cards">
          <div className="tier-card">
            <span className="tier-badge tier-gold">GOLD</span>
            <div className="tier-card-range">1–5 GEN</div>
            <p className="tier-card-desc">
              Nonce ≥ 500, balance ≥ 50 GEN, zero recent failures, wallet age ≥ 60 days. A real,
              established wallet.
            </p>
          </div>
          <div className="tier-card">
            <span className="tier-badge tier-silver">SILVER</span>
            <div className="tier-card-range">1–2 GEN</div>
            <p className="tier-card-desc">
              Meets some but not all of the GOLD criteria. Still eligible, sized down to match
              the risk.
            </p>
          </div>
          <div className="tier-card">
            <span className="tier-badge tier-red">REJECTED</span>
            <div className="tier-card-range">0 GEN</div>
            <p className="tier-card-desc">
              Two or more recent failed transactions, or a wallet under 14 days old. No reason
              text can talk its way out of this one.
            </p>
          </div>
        </div>
        <p className="page-lede" style={{ marginTop: 4 }}>
          Inside your tier's range, a clear, specific reason for the loan moves you toward the
          top. It's scored for how clearly it's written, never for whether it's true, and it
          can never move you into a different tier.
        </p>
      </section>

      <section className="cta-band">
        <h2>Nothing to type. Nothing to check. Just look.</h2>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button className="btn-primary" onClick={() => onNavigate("apply")}>
            Apply now
          </button>
          <button className="btn-primary scan" onClick={() => onNavigate("scan")}>
            Scan a wallet
          </button>
        </div>
      </section>
    </div>
  );
}
