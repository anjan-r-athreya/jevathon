import type { Block, DonePayload, Edit, Judgment, Mode, Source, Unit } from "./api.js";

export type RunState = {
  status: "idle" | "running" | "done" | "error";
  mode: Mode | null;
  modeConfidence: number;
  source: Source | null;
  units: Unit[];
  blocks: Block[];
  judgments: Judgment[];
  edits: Edit[];
  done: DonePayload | null;
  error: string | null;
  /** Units the reader clicked back in. Restores always win over a cut. */
  restored: Set<string>;
};

export const emptyRun: RunState = {
  status: "idle",
  mode: null,
  modeConfidence: 0,
  source: null,
  units: [],
  blocks: [],
  judgments: [],
  edits: [],
  done: null,
  error: null,
  restored: new Set(),
};

export type UnitView = {
  unit: Unit;
  fillerType: string | null;
  itemType: string | null;
  /** Cut by the planner and not clicked back in. */
  cut: boolean;
  /** Cut by the planner, whether or not the reader restored it. */
  wasCut: boolean;
  flagged: boolean;
  collapsed: boolean;
  reason: string | null;
  /** How the sentence reads in the output, with approved swaps applied. */
  rendered: string;
  swaps: Array<{ from: string; to: string }>;
};

/**
 * Fold the event stream into one view per unit. A `revert` puts a paragraph's
 * cuts back, so the edits are replayed in the order they arrived.
 */
export function buildViews(run: RunState): Map<string, UnitView> {
  const views = new Map<string, UnitView>();
  for (const unit of run.units) {
    views.set(unit.id, {
      unit,
      fillerType: null,
      itemType: null,
      cut: false,
      wasCut: false,
      flagged: false,
      collapsed: false,
      reason: null,
      rendered: unit.text,
      swaps: [],
    });
  }

  for (const j of run.judgments) {
    if (!j.unitId) continue;
    const view = views.get(j.unitId);
    if (!view) continue;
    if (j.question === "filler_type") view.fillerType = String(j.answer);
    if (j.question === "item_type") view.itemType = String(j.answer);
  }

  for (const edit of run.edits) {
    for (const id of edit.unitIds) {
      const view = views.get(id);
      if (!view) continue;
      switch (edit.kind) {
        case "delete":
          view.cut = true;
          view.wasCut = true;
          view.reason = edit.reason;
          break;
        case "keep_best":
          if (id !== edit.replacement) {
            view.cut = true;
            view.wasCut = true;
            view.reason = edit.reason;
          }
          break;
        case "collapse":
          view.collapsed = true;
          view.reason = edit.reason;
          break;
        case "flag":
          view.flagged = true;
          view.reason ??= edit.reason;
          break;
        case "revert":
          view.cut = false;
          view.reason = edit.reason;
          break;
        case "swap":
          break;
      }
    }
  }

  // Swaps are reported with the exact text they matched, so they can be
  // applied to the original sentence for display.
  for (const swap of run.done?.report.swaps ?? []) {
    const view = views.get(swap.unitId);
    if (!view) continue;
    view.swaps.push({ from: swap.from, to: swap.to });
    view.rendered = applySwap(view.rendered, swap.from, swap.to);
  }

  for (const id of run.restored) {
    const view = views.get(id);
    if (view) view.cut = false;
  }

  return views;
}

function applySwap(text: string, from: string, to: string): string {
  const at = text.toLowerCase().indexOf(from.toLowerCase());
  if (at === -1) return text;
  const replacement = to === "(removed)" ? "" : to;
  const out = (text.slice(0, at) + replacement + text.slice(at + from.length))
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  const first = out[0];
  return first && first !== first.toUpperCase() ? first.toUpperCase() + out.slice(1) : out;
}

/** The output as it currently reads, including anything the reader restored. */
export function currentOutput(run: RunState, views: Map<string, UnitView>): string {
  if (run.mode === "list") {
    return run.units
      .filter((u) => !views.get(u.id)?.collapsed)
      .map((u) => u.text)
      .join("\n\n");
  }
  const out: string[] = [];
  for (const block of run.blocks) {
    if (block.kind === "protected") {
      out.push(block.text);
      continue;
    }
    const kept = block.units
      .filter((u) => !views.get(u.id)?.cut)
      .map((u) => views.get(u.id)?.rendered ?? u.text);
    if (kept.length > 0) out.push(kept.join(" "));
  }
  return out.join("\n\n");
}

/** Words Unslop may judge: sentence and item units, never protected ones. */
export function proseWordsIn(run: RunState): number {
  return run.units
    .filter((u) => u.kind !== "protected")
    .reduce((n, u) => n + wordCount(u.text), 0);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

/** Tint colours by filler type. Substantive sentences stay uncoloured. */
export const FILLER_COLORS: Record<string, string> = {
  throat_clearing_opener: "#7c5cff",
  empty_summary: "#c2410c",
  restatement: "#0e7490",
  stacked_hedging: "#7e22ce",
  hype: "#be123c",
  not_just_x_but_y: "#a16207",
  rhetorical_question: "#1d4ed8",
  signpost: "#b45309",
  generic_platitude: "#9d174d",
};

export const LABELS: Record<string, string> = {
  substantive: "substantive",
  throat_clearing_opener: "throat-clearing",
  empty_summary: "empty summary",
  restatement: "restatement",
  stacked_hedging: "stacked hedging",
  hype: "hype",
  not_just_x_but_y: "not just X but Y",
  rhetorical_question: "rhetorical question",
  signpost: "signpost",
  generic_platitude: "platitude",
  generic_praise_or_complaint: "generic praise",
  engagement_bait: "engagement bait",
  self_promotion: "self-promotion",
  restates_topic: "restates the topic",
  template_boilerplate: "boilerplate",
};

export const label = (key: string | null): string => (key ? (LABELS[key] ?? key) : "");

export function describeJudgment(j: Judgment): string {
  if (j.type === "noul") return `${Math.round(Number(j.answer) * 100)}%`;
  if (j.type === "score") return Number(j.answer).toFixed(2);
  return label(String(j.answer));
}
