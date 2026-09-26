import type { ReactNode } from "react";
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
  if (run.status === "idle") {
    return (
      <div className="col-body">
        <p className="hint">
          Paste a URL, a draft, or a list of short items separated by blank lines — or press a
          demo button. Jev picks the mode; the chips override it.
        </p>
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

  // Web mode: the screenshot, then the extracted text so sentences light up
  // here too as the judgments land. Writing mode: just the text.
  return (
    <div className="col-body prose">
      {run.mode === "web" ? (
        run.source?.screenshotUrl ? (
          <img className="shot" src={run.source.screenshotUrl} alt="The page as Browserbase loaded it" />
        ) : run.source ? (
          <p className="muted small-note">
            No screenshot for this page — set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to
            capture one.
          </p>
        ) : null
      ) : null}
      {run.blocks.map((block) => (
        <ProtectedOrProse key={block.id} block={block} views={views} hover={hover} original />
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
  showCuts,
  onRestore,
}: {
  run: RunState;
  views: Views;
  hover: Hover;
  showCuts: boolean;
  onRestore: (unitId: string) => void;
}) {
  if (run.status === "idle") {
    return (
      <div className="col-body">
        <p className="hint">The unslopped result appears here. Every cut is restorable with one click.</p>
      </div>
    );
  }

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
      {run.blocks.map((block) => (
        <ProtectedOrProse
          key={block.id}
          block={block}
          views={views}
          hover={hover}
          showCuts={showCuts}
          onRestore={onRestore}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One block, in either column                                         */
/* ------------------------------------------------------------------ */

function ProtectedOrProse({
  block,
  views,
  hover,
  original = false,
  showCuts = true,
  onRestore,
}: {
  block: RunState["blocks"][number];
  views: Views;
  hover: Hover;
  original?: boolean;
  showCuts?: boolean;
  onRestore?: (unitId: string) => void;
}) {
  if (block.kind === "protected") {
    // Web mode carries sanitised structure so a list stays a list; pasted
    // text has none and is shown as typed.
    return block.html ? (
      <div className="protected" dangerouslySetInnerHTML={{ __html: block.html }} />
    ) : (
      <p className="protected">{block.text}</p>
    );
  }

  const visible = block.units.filter((u) => original || showCuts || !views.get(u.id)?.cut);
  if (visible.length === 0) return null;

  return (
    <p>
      {visible.map((unit) => {
        const view = views.get(unit.id);
        if (!view) return null;
        const hot = unit.id === hover.hovered;
        const hoverProps = {
          onMouseEnter: () => hover.onHover(unit.id),
          onMouseLeave: () => hover.onHover(null),
        };

        if (original) {
          const tint = view.fillerType ? FILLER_COLORS[view.fillerType] : undefined;
          return (
            <span
              key={unit.id}
              className={`sentence ${hot ? "hot" : ""} ${view.cut ? "faded" : ""}`}
              style={tint ? { background: `${tint}26`, boxShadow: `inset 2px 0 0 ${tint}` } : undefined}
              title={view.fillerType ? label(view.fillerType) : undefined}
              {...hoverProps}
            >
              {unit.text}{" "}
            </span>
          );
        }

        if (view.cut) {
          return (
            <span
              key={unit.id}
              className={`cut ${hot ? "hot" : ""}`}
              title={`${view.reason ?? ""} — click to restore`}
              onClick={() => onRestore?.(unit.id)}
              {...hoverProps}
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
              hot ? "hot" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={view.flagged ? (view.reason ?? undefined) : view.wasCut ? "restored" : undefined}
            {...hoverProps}
          >
            {renderSwaps(view)}{" "}
          </span>
        );
      })}
    </p>
  );
}

/**
 * Swapped phrases are underlined with the original on hover.
 *
 * This walks the *original* sentence and replaces each matched phrase where it
 * sits. Searching the result for the replacement instead would underline the
 * wrong word: "in order to" → "to" would light up the first "to" in the
 * sentence, which is usually not the one that changed.
 */
function renderSwaps(view: UnitView): ReactNode {
  if (view.swaps.length === 0) return view.unit.text;

  const text = view.unit.text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;

  // Locate each swap in the original, left to right, so overlaps and repeats
  // resolve deterministically.
  const located = view.swaps
    .map((swap) => ({ swap, at: lower.indexOf(swap.from.toLowerCase()) }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => a.at - b.at);

  located.forEach(({ swap, at }, i) => {
    if (at < cursor) return;
    parts.push(text.slice(cursor, at));
    const removed = swap.to === "(removed)";
    parts.push(
      <span
        key={i}
        className={`swap ${removed ? "removed" : ""}`}
        title={removed ? `removed: “${swap.from}”` : `was: “${swap.from}”`}
      >
        {removed ? "✂" : matchCase(text.slice(at, at + swap.from.length), swap.to)}
      </span>,
    );
    cursor = at + swap.from.length;
    // A deletion at the start leaves the next word to carry the capital.
    if (removed && at === 0) {
      while (cursor < text.length && text[cursor] === " ") cursor++;
      const next = text.slice(cursor);
      const upper = next.charAt(0).toUpperCase() + next.slice(1);
      parts.push(upper);
      cursor = text.length;
    }
  });
  parts.push(text.slice(cursor));
  return parts;
}

function matchCase(original: string, replacement: string): string {
  const lead = original.trimStart()[0] ?? "";
  if (lead && lead === lead.toUpperCase() && lead !== lead.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
