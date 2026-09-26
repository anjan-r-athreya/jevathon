import { useEffect, useRef } from "react";
import type { Judgment } from "../api.js";
import { describeJudgment } from "../model.js";

const LOW_CONFIDENCE = 0.5;

/**
 * The live feed of Jev's decisions. One row per judgment, newest at the
 * bottom. Rows Jev was not confident about are amber, so the audience can see
 * it saying "not sure" rather than guessing.
 */
export function DecisionPanel({
  judgments,
  onHover,
  hovered,
}: {
  judgments: Judgment[];
  onHover: (unitId: string | null) => void;
  hovered: string | null;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the feed while the reader is at the bottom. The moment they scroll
  // up to read something, stop yanking it away from them — and only the
  // panel scrolls, never the page around it.
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [judgments.length]);

  const onScroll = () => {
    const el = rowsRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span>Jev decisions</span>
        <span className="muted">{judgments.length}</span>
      </div>
      <div className="panel-rows" ref={rowsRef} onScroll={onScroll}>
        {judgments.length === 0 ? (
          <p className="hint">Every question Jev answers lands here: unit, question, answer, confidence, and how long it took. Amber means Jev wasn't sure.</p>
        ) : null}
        {judgments.map((j, i) => {
          const unsure = (j.confidence ?? 1) < LOW_CONFIDENCE;
          return (
            <div
              key={`${j.unitId ?? "page"}-${j.question}-${i}`}
              className={[
                "row",
                unsure ? "row-unsure" : "",
                j.unitId && j.unitId === hovered ? "row-hot" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => onHover(j.unitId ?? null)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="row-stage">{j.stage}</span>
              <span className="row-unit">{j.unitId ?? "page"}</span>
              <span className="row-q" title={j.question}>
                {j.question}
              </span>
              <span className="row-a" title={String(j.answer)}>
                {describeJudgment(j)}
              </span>
              <span className="row-conf">
                {j.confidence === undefined ? "" : `${Math.round(j.confidence * 100)}%`}
              </span>
              <span className="row-ms">{j.ms}ms</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
