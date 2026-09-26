import type { RunState, UnitView } from "../model.js";
import { FILLER_COLORS, label } from "../model.js";

type Views = Map<string, UnitView>;
type Hover = { hovered: string | null; onHover: (id: string | null) => void };

/* ------------------------------------------------------------------ */
/* Left column: the original                                           */
/* ------------------------------------------------------------------ */

export function OriginalColumn({
  run,
  views,
  hover,
}: {
  run: RunState;
  views: Views;
  hover: Hover;
}) {
  if (run.mode === "web") {
    return (
      <div className="col-body">
        {run.source?.screenshotUrl ? (
          <img className="shot" src={run.source.screenshotUrl} alt="The page as Browserbase loaded it" />
        ) : (
          <p className="muted pad">
            No screenshot for this page. Set BROWSERBASE_API_KEY and
            BROWSERBASE_PROJECT_ID to capture one.
          </p>
        )}
      </div>
    );
  }

  if (run.mode === "list") {
    return (
      <div className="col-body">
        {run.units.map((unit) => {
          const view = views.get(unit.id);
          return (
            <div
              key={unit.id}
              className={`card ${unit.id === hover.hovered ? "hot" : ""}`}
              onMouseEnter={() => hover.onHover(unit.id)}
              onMouseLeave={() => hover.onHover(null)}
            >
              <span className="card-id">{unit.id}</span>
              {unit.text}
              {view?.itemType ? <span className="chip small">{label(view.itemType)}</span> : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="col-body prose">
      {run.blocks.map((block) => (
        <p key={block.id} className={block.kind === "protected" ? "protected" : ""}>
          {block.units.map((unit) => {
            const view = views.get(unit.id);
            const tint = view?.fillerType ? FILLER_COLORS[view.fillerType] : undefined;
            return (
              <span
                key={unit.id}
                className={`sentence ${unit.id === hover.hovered ? "hot" : ""}`}
                style={tint ? { background: `${tint}26`, boxShadow: `inset 2px 0 0 ${tint}` } : undefined}
                title={view?.fillerType ? label(view.fillerType) : undefined}
                onMouseEnter={() => hover.onHover(unit.id)}
                onMouseLeave={() => hover.onHover(null)}
              >
                {unit.text}{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Middle column: the result                                           */
/* ------------------------------------------------------------------ */

export function ResultColumn({
  run,
  views,
  hover,
  showDiff,
  onRestore,
}: {
  run: RunState;
  views: Views;
  hover: Hover;
  showDiff: boolean;
  onRestore: (unitId: string) => void;
}) {
  if (run.mode === "list") {
    const ranked = [...run.units].sort((a, b) => {
      const ac = views.get(a.id)?.collapsed ? 1 : 0;
      const bc = views.get(b.id)?.collapsed ? 1 : 0;
      return ac - bc;
    });
    return (
      <div className="col-body">
        {ranked.map((unit) => {
          const view = views.get(unit.id);
          if (view?.collapsed) {
            return (
              <details key={unit.id} className="collapsed">
                <summary>
                  <span className="chip small">{label(view.itemType)}</span>
                  <span className="muted">collapsed · show</span>
                </summary>
                <div className="collapsed-body">{unit.text}</div>
              </details>
            );
          }
          return (
            <div
              key={unit.id}
              className={`card ${unit.id === hover.hovered ? "hot" : ""}`}
              onMouseEnter={() => hover.onHover(unit.id)}
              onMouseLeave={() => hover.onHover(null)}
            >
              {unit.text}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="col-body prose">
      {run.blocks.map((block) => {
        if (block.kind === "protected") {
          return (
            <p key={block.id} className="protected">
              {block.text}
            </p>
          );
        }
        const visible = block.units.filter((u) => showDiff || !views.get(u.id)?.cut);
        if (visible.length === 0) return null;
        return (
          <p key={block.id}>
            {visible.map((unit) => {
              const view = views.get(unit.id);
              if (!view) return null;
              if (view.cut) {
                return (
                  <span
                    key={unit.id}
                    className="cut"
                    title={`${view.reason ?? ""} — click to restore`}
                    onClick={() => onRestore(unit.id)}
                    onMouseEnter={() => hover.onHover(unit.id)}
                    onMouseLeave={() => hover.onHover(null)}
                  >
                    {unit.text}{" "}
                  </span>
                );
              }
              return (
                <span
                  key={unit.id}
                  className={[
                    "sentence",
                    view.flagged ? "flagged" : "",
                    view.wasCut ? "restored" : "",
                    unit.id === hover.hovered ? "hot" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={view.flagged ? (view.reason ?? undefined) : undefined}
                  onMouseEnter={() => hover.onHover(unit.id)}
                  onMouseLeave={() => hover.onHover(null)}
                >
                  {renderSwaps(view)}{" "}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

/** Swapped phrases are underlined, with the original phrase on hover. */
function renderSwaps(view: UnitView) {
  if (view.swaps.length === 0) return view.unit.text;
  const parts: Array<string | JSX.Element> = [];
  let rest = view.rendered;
  view.swaps.forEach((swap, i) => {
    if (swap.to === "(removed)") return;
    const at = rest.toLowerCase().indexOf(swap.to.toLowerCase());
    if (at === -1) return;
    parts.push(rest.slice(0, at));
    parts.push(
      <span className="swap" key={i} title={`was: ${swap.from}`}>
        {rest.slice(at, at + swap.to.length)}
      </span>,
    );
    rest = rest.slice(at + swap.to.length);
  });
  parts.push(rest);
  const removed = view.swaps.filter((s) => s.to === "(removed)");
  if (removed.length > 0) {
    parts.push(
      <span className="swap removed" key="removed" title={`removed: ${removed.map((r) => r.from).join(", ")}`}>
        {" ✂"}
      </span>,
    );
  }
  return parts;
}
