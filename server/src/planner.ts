import { THRESHOLDS } from "./config.js";
import type { PhraseHit } from "./phrases.js";
import { applySwaps } from "./phrases.js";
import type { Block, Edit, Unit } from "./types.js";

/**
 * The edit planner: plain code that turns Jev's answers into edits.
 *
 * It only cuts when several signals agree, and every reason it gives comes
 * from the fixed list below. No reason text, and no replacement text, is ever
 * generated — replacements come from the phrase table and nowhere else.
 */
export const REASONS = {
  noNewInfo: "adds nothing the surrounding text does not already say",
  offTopic: "about the writer rather than the subject the reader came for",
  intro: "setup before the first paragraph with real information",
  outro: "closing paragraph only restates earlier points",
  repeats: "repeats a point another sentence states more clearly",
  unsure: "Jev was not confident, so this is flagged rather than cut",
  groupUnsure: "these sentences repeat each other, but Jev had no clear pick",
  swap: "phrase table swap",
  collapse: "low signal and no specifics",
  lostInfo: "edit check found a fact missing from the edited paragraph",
  readsBadly: "edit check found the edited paragraph did not read cleanly",
} as const;

export type SentenceSignals = {
  unitId: string;
  addsInfo: number;
  fillerType: string;
  fillerConfidence: number;
  generic: number;
  specific: number;
  loadBearing: number;
  repeatsPrev: number | undefined;
  /** Asked only for goal-directed genres; undefined elsewhere. */
  onTopic: number | undefined;
  /** Phrase hits with the yes-probability Jev gave each swap. */
  swaps: Array<{ hit: PhraseHit; approval: number }>;
};

export type Verdict = "keep" | "delete" | "flag";
export type Ruling = { verdict: Verdict; reason: string };

/**
 * The Stage 2 rule, which is really two rules.
 *
 * **Filler.** All four signals must agree before a sentence is cut: it adds
 * nothing, names nothing concrete, nothing after it depends on it, and Jev is
 * confident it is not substantive.
 *
 * **Off topic.** On a page the reader came to for something, a sentence about
 * the writer instead of the subject goes even when it is concrete. "I first
 * published this recipe in 2013" clears every filler test — it states a fact,
 * it names a date, Jev calls it substantive — and it is still not what the
 * reader opened the page for. `load_bearing` still protects the flow.
 *
 * Anything short of either rule is flagged rather than cut.
 */
export function verdictFor(sig: SentenceSignals, flagOnly: boolean): Ruling {
  const t = THRESHOLDS.delete;
  const cut = (reason: string): Ruling => ({
    verdict: flagOnly ? "flag" : "delete",
    reason,
  });

  const isFiller =
    sig.addsInfo < t.addsInfo &&
    sig.specific < t.specific &&
    sig.loadBearing < t.loadBearing &&
    sig.fillerType !== "substantive" &&
    sig.fillerConfidence >= t.fillerConfidence;
  if (isFiller) return cut(REASONS.noNewInfo);

  if (sig.onTopic !== undefined && sig.onTopic < t.offTopic) {
    // Off topic, but the next sentence may still lean on it. Say so rather
    // than cutting — otherwise a load-bearing aside would fall through to
    // "keep" and the reader would never learn Jev doubted it.
    return sig.loadBearing < t.loadBearing
      ? cut(REASONS.offTopic)
      : { verdict: "flag", reason: REASONS.offTopic };
  }

  if (sig.addsInfo < THRESHOLDS.flagAddsInfo) {
    return { verdict: "flag", reason: REASONS.unsure };
  }
  return { verdict: "keep", reason: "" };
}

/** A sentence qualifies for deletion on the Stage 2 rules alone, ignoring genre. */
export function qualifiesForDeletion(sig: SentenceSignals): boolean {
  return verdictFor(sig, false).verdict === "delete";
}

/**
 * Intro cut: paragraphs before `first_substance` whose sentences mostly qualify
 * for deletion anyway. One weak opener survives; three in a row do not.
 */
export function planIntroCuts(
  blocks: Block[],
  firstSubstanceId: string | undefined,
  confidence: number,
  signals: Map<string, SentenceSignals>,
): string[] {
  if (!firstSubstanceId || confidence < THRESHOLDS.firstSubstanceConfidence)
    return [];
  const prose = blocks.filter((b) => b.kind === "prose");
  const boundary = prose.findIndex((b) => b.id === firstSubstanceId);
  if (boundary <= 0) return [];

  const cut: string[] = [];
  for (const block of prose.slice(0, boundary)) {
    const sigs = block.units
      .filter((u) => u.kind === "sentence")
      .map((u) => signals.get(u.id))
      .filter((s): s is SentenceSignals => Boolean(s));
    if (sigs.length === 0) continue;
    const share = sigs.filter(qualifiesForDeletion).length / sigs.length;
    if (share >= THRESHOLDS.introQualifyingShare) cut.push(block.id);
  }
  return cut;
}

/** Closing cut: the last prose paragraph, when it only restates and names nothing. */
export function planOutroCut(
  blocks: Block[],
  outroRestates: number,
  signals: Map<string, SentenceSignals>,
): string | undefined {
  if (outroRestates <= THRESHOLDS.outroRestates) return undefined;
  const prose = blocks.filter((b) => b.kind === "prose");
  const last = prose[prose.length - 1];
  if (!last || prose.length < 2) return undefined;
  const hasSpecific = last.units.some(
    (u) => (signals.get(u.id)?.specific ?? 0) > THRESHOLDS.outroSpecific,
  );
  return hasSpecific ? undefined : last.id;
}

/**
 * Runs of adjacent sentences making the same point. Only surviving sentences
 * are grouped — a sentence already cut cannot win its group.
 */
export function findRedundancyGroups(
  blocks: Block[],
  signals: Map<string, SentenceSignals>,
  survives: (unitId: string) => boolean,
): Unit[][] {
  const groups: Unit[][] = [];
  for (const block of blocks) {
    if (block.kind !== "prose") continue;
    const live = block.units.filter(
      (u) => u.kind === "sentence" && survives(u.id),
    );
    let run: Unit[] = [];
    for (let i = 0; i < live.length; i++) {
      const unit = live[i]!;
      const prev = live[i - 1];
      const repeats =
        (signals.get(unit.id)?.repeatsPrev ?? 0) > THRESHOLDS.repeatsPrev;
      // `repeats_prev` was asked against the immediate neighbour, so a gap
      // created by an earlier cut breaks the run.
      const adjacent =
        prev !== undefined &&
        block.units.indexOf(unit) === block.units.indexOf(prev) + 1;
      if (repeats && adjacent) {
        if (run.length === 0) run = [prev];
        run.push(unit);
      } else {
        if (run.length >= 2) groups.push(run);
        run = [];
      }
    }
    if (run.length >= 2) groups.push(run);
  }
  return groups;
}

/** Swaps Jev approved above the threshold, ready to apply to a sentence. */
export function approvedSwaps(sig: SentenceSignals): PhraseHit[] {
  return sig.swaps
    .filter((s) => s.approval > THRESHOLDS.swap)
    .map((s) => s.hit);
}

/** The text of one unit as it will appear in the output, with swaps applied. */
export function renderUnit(
  unit: Unit,
  sig: SentenceSignals | undefined,
): string {
  if (!sig || unit.kind === "protected") return unit.text;
  const approved = approvedSwaps(sig);
  return approved.length > 0 ? applySwaps(unit.text, approved) : unit.text;
}

/**
 * Rebuild the document from the units that survived. Protected blocks come
 * through untouched; a prose block whose sentences all went disappears.
 */
export function renderOutput(
  blocks: Block[],
  signals: Map<string, SentenceSignals>,
  deleted: Set<string>,
): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "protected") {
      out.push(block.text);
      continue;
    }
    const kept = block.units
      .filter((u) => !deleted.has(u.id))
      .map((u) => renderUnit(u, signals.get(u.id)))
      .filter((t) => t.length > 0);
    if (kept.length > 0) out.push(kept.join(" "));
  }
  return out.join("\n\n");
}

/** List-mode slop score, straight from the spec. */
export function slopScore(
  useful: number,
  generic: number,
  itemType: string,
): number {
  return (
    0.5 * (1 - useful) +
    0.3 * (generic / 3) +
    0.2 * (itemType !== "substantive" ? 1 : 0)
  );
}

export function makeEdit(
  kind: Edit["kind"],
  unitIds: string[],
  reason: string,
  replacement?: string,
): Edit {
  return replacement === undefined
    ? { kind, unitIds, reason }
    : { kind, unitIds, reason, replacement };
}
