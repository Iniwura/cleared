import { MAX_LOAN_GEN } from "../lib/config";

export default function RangeGauge({ tierInfo, approvedGen, clarity }) {
  if (tierInfo.rangeMaxGen === 0) {
    return (
      <div className="gauge-wrap">
        <div className="gauge-label">
          <span>Tier range</span>
          <span>No loan available at this tier</span>
        </div>
        <div className="gauge-track">
          <div
            className="gauge-fill"
            style={{ width: "100%", background: "var(--red)", opacity: 0.35 }}
          />
        </div>
      </div>
    );
  }

  const fillStart = (tierInfo.rangeMinGen / MAX_LOAN_GEN) * 100;
  const fillWidth = ((tierInfo.rangeMaxGen - tierInfo.rangeMinGen) / MAX_LOAN_GEN) * 100;
  const markerPos = approvedGen != null ? (approvedGen / MAX_LOAN_GEN) * 100 : null;

  return (
    <div className="gauge-wrap">
      <div className="gauge-label mono">
        <span>{tierInfo.rangeMinGen} GEN</span>
        <span>{tierInfo.rangeMaxGen} GEN tier ceiling</span>
      </div>
      <div className="gauge-track">
        <div
          className="gauge-fill"
          style={{
            position: "absolute",
            left: `${fillStart}%`,
            width: `${fillWidth}%`,
            height: "100%",
            background: tierInfo.fillColor,
            opacity: 0.3,
          }}
        />
        {markerPos != null && (
          <div
            className="gauge-marker"
            style={{ left: `${markerPos}%` }}
            data-value={`${approvedGen} GEN`}
          />
        )}
      </div>
      {clarity && (
        <p className="status-line">
          Reason clarity rated {clarity} placed you at this point in the range.
        </p>
      )}
    </div>
  );
}
