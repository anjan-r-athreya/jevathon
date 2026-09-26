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
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [judgments.length]);

  return (
    <div className="panel">
      <div className="panel-head">
        <span>Jev decisions</span>
        <span className="muted">{judgments.length}</span>
      </div>
      <div className="panel-rows">
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
              <span className="row-q">{j.question}</span>
              <span className="row-a">{describeJudgment(j)}</span>
              <span className="row-conf">
                {j.confidence === undefined ? "" : `${Math.round(j.confidence * 100)}%`}
              </span>
              <span className="row-ms">{j.ms}ms</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
