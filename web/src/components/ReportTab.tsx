import type { RunState } from "../model.js";
import { label } from "../model.js";

/**
 * Counts of each filler type, every cut with its reason, and any paragraph the
 * edit check put back.
 */
export function ReportTab({ run }: { run: RunState }) {
  const report = run.done?.report;
  if (!report) {
    return (
      <div className="col-body">
        <p className="hint">
          {run.status === "running" ? "The report appears when the run finishes." : "Run something to get a report."}
        </p>
      </div>
    );
  }

  const counts = Object.entries(report.fillerCounts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="col-body report">
      {report.genre ? (
        <p className="muted">
          Genre: <strong>{label(report.genre)}</strong>
          {report.paddingLabel ? ` · filler: ${report.paddingLabel}` : ""}
        </p>
      ) : null}

      <h3>{run.mode === "list" ? "Item types" : "Filler types"}</h3>
      <ul className="counts">
        {counts.map(([key, n]) => (
          <li key={key}>
            <span>{label(key)}</span>
            <span className="muted">{n}</span>
          </li>
        ))}
      </ul>

      <h3>{run.mode === "list" ? "Collapsed" : "Cuts"} ({report.cuts.length})</h3>
      {report.cuts.length === 0 ? (
        <p className="muted">Nothing was cut.</p>
      ) : (
        <ul className="cuts">
          {report.cuts.map((cut) => (
            <li key={cut.unitId}>
              <div className="cut-text">{cut.text}</div>
              <div className="muted">
                {cut.reason}
                {cut.fillerType && cut.fillerType !== "substantive" ? ` · ${label(cut.fillerType)}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}

      {report.flags.length > 0 ? (
        <>
          <h3>Flagged, not cut ({report.flags.length})</h3>
          <ul className="cuts">
            {report.flags.map((flag, i) => (
              <li key={`${flag.unitId}-${i}`}>
                <div className="flag-text">{flag.text}</div>
                <div className="muted">{flag.reason}</div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {report.swaps.length > 0 ? (
        <>
          <h3>Phrase swaps ({report.swaps.length})</h3>
          <ul className="counts">
            {report.swaps.map((swap, i) => (
              <li key={i}>
                <span>
                  <s>{swap.from}</s> → {swap.to}
                </span>
                <span className="muted">{swap.unitId}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {report.revertedParagraphs.length > 0 ? (
        <>
          <h3>Reverted by the edit check</h3>
          <p className="muted">
            {report.revertedParagraphs.join(", ")} — the cuts came back as flags because something the
            reader needed would have gone with them.
          </p>
        </>
      ) : null}
    </div>
  );
}
