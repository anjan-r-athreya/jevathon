import { useEffect, useState } from "react";
import type { Stats } from "../../../server/src/types.js";

/**
 * The numbers to point at during the demo. They tick while the run is in
 * flight — judgments as they land, elapsed time, words as cuts fade — and
 * settle on the server's figures when it finishes.
 *
 * The headline is prose words, not page words: on a recipe page the protected
 * ingredients and steps are most of the text and Unslop never touches them.
 * Counting them in the denominator reports a 6% cut for a run that removed a
 * quarter of the prose. The protected count is shown beside it, so the number
 * is honest in both directions.
 */
export function Counters({
  stats,
  live,
  running,
  startedAt,
}: {
  stats: Stats | null;
  live: { proseWordsIn: number; proseWordsOut: number; judgments: number };
  running: boolean;
  startedAt: number | null;
}) {
  const elapsed = useElapsed(running, startedAt);

  const proseIn = stats?.proseWordsIn ?? live.proseWordsIn;
  const proseOut = live.proseWordsOut;
  const cut = proseIn > 0 ? Math.round((1 - proseOut / proseIn) * 100) : 0;
  const protectedWords = stats?.protectedWords ?? 0;
  const seconds = stats ? stats.totalMs / 1000 : elapsed;
  const started = running || stats !== null;

  return (
    <div className="counters">
      <Counter
        label="prose words"
        value={proseIn ? `${fmt(proseIn)} → ${fmt(proseOut)}` : "—"}
        note={
          proseIn
            ? [`${cut}% cut`, protectedWords > 0 ? `${fmt(protectedWords)} protected` : ""]
                .filter(Boolean)
                .join(" · ")
            : ""
        }
      />
      <Counter label="judgments" value={started ? fmt(stats?.judgments ?? live.judgments) : "—"} />
      <Counter label="requests" value={stats ? fmt(stats.requests) : started ? "…" : "—"} />
      <Counter label="time" value={started ? `${seconds.toFixed(1)}s` : "—"} />
      <Counter
        label="cost"
        value={stats ? `$${stats.costUsd.toFixed(5)}` : started ? "…" : "—"}
        note={stats ? `${fmt(stats.inputTokens)} tokens` : ""}
      />
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

const fmt = (n: number) => n.toLocaleString();

/** Seconds since the run started, ticking ten times a second while it runs. */
function useElapsed(running: boolean, startedAt: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  if (!startedAt) return 0;
  return ((running ? now : Date.now()) - startedAt) / 1000;
}
