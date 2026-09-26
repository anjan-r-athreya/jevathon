import type { Stats } from "../../../server/src/types.js";

/**
 * The numbers to point at during the demo. They keep updating while the run is
 * in flight, so the bar is never empty.
 */
export function Counters({
  stats,
  wordsOut,
  running,
}: {
  stats: Stats | null;
  wordsOut: number;
  running: boolean;
}) {
  const wordsIn = stats?.wordsIn ?? 0;
  const cut = wordsIn > 0 ? Math.round((1 - wordsOut / wordsIn) * 100) : 0;
  return (
    <div className="counters">
      <Counter label="words" value={wordsIn ? `${wordsIn} → ${wordsOut}` : "—"} note={wordsIn ? `${cut}% cut` : ""} />
      <Counter label="judgments" value={stats ? String(stats.judgments) : "—"} />
      <Counter label="requests" value={stats ? String(stats.requests) : "—"} />
      <Counter label="time" value={stats ? `${(stats.totalMs / 1000).toFixed(1)}s` : "—"} />
      <Counter label="cost" value={stats ? `$${stats.costUsd.toFixed(5)}` : "—"} note={stats ? `${stats.inputTokens} tokens` : ""} />
      <div className="counters-note">{running ? "Jev is deciding…" : "zero generated words"}</div>
    </div>
  );
}

function Counter({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="counter">
      <div className="counter-value">{value}</div>
      <div className="counter-label">
        {label}
        {note ? <span className="counter-note"> · {note}</span> : null}
      </div>
    </div>
  );
}
