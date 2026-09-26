import type { Unit } from "./types.js";

/**
 * The MVP phrase table. Code finds each phrase by regex; Jev approves or
 * rejects each swap in context. Nothing here is generated — a swap either
 * lands a word from this table or the original phrase stays.
 */
export type PhraseEntry = {
  /** Short id used in the question name, e.g. `swap_in_order_to`. */
  key: string;
  /** Shown in the report and on hover. */
  find: string;
  /** Empty string means the phrase is deleted rather than replaced. */
  replace: string;
  pattern: RegExp;
};

const e = (
  key: string,
  find: string,
  replace: string,
  pattern: RegExp,
): PhraseEntry => ({
  key,
  find,
  replace,
  pattern,
});

export const PHRASE_TABLE: PhraseEntry[] = [
  e("in_order_to", "in order to", "to", /\bin order to\b/gi),
  e(
    "due_to_the_fact_that",
    "due to the fact that",
    "because",
    /\bdue to the fact that\b/gi,
  ),
  e(
    "at_this_point_in_time",
    "at this point in time",
    "now",
    /\bat this point in time\b/gi,
  ),
  e(
    "important_to_note",
    "it is important to note that",
    "",
    /\bit(?:'s| is)(?: also)? (?:important|worth) (?:to note|noting) that\s*/gi,
  ),
  e(
    "fast_paced_world",
    "in today's fast-paced world",
    "",
    /\bin today's fast[- ]paced world,?\s*/gi,
  ),
  e(
    "wide_range_of",
    "a wide range of",
    "many",
    /\ba (?:wide range|variety) of\b/gi,
  ),
  e("utilize", "utilize", "use", /\butiliz(?:e|es|ed|ing)\b/gi),
  e("utilization", "utilization", "use", /\butili[sz]ation\b/gi),
  e("leverage", "leverage", "use", /\bleverag(?:e|es|ed|ing)\b/gi),
  e("delve_into", "delve into", "explore", /\bdelve[sd]? into\b/gi),
  e(
    "crucial_role",
    "plays a crucial role in",
    "matters for",
    /\bplays? a crucial role in\b/gi,
  ),
  e("whether_or_not", "whether or not", "whether", /\bwhether or not\b/gi),
  e("each_and_every", "each and every", "every", /\beach and every\b/gi),
  e(
    "first_and_foremost",
    "first and foremost",
    "first",
    /\bfirst and foremost\b/gi,
  ),
  e(
    "in_conclusion",
    "in conclusion,",
    "",
    /^(?:in conclusion|to sum up|overall)\s*,\s*/gi,
  ),
  e("very_unique", "very unique", "unique", /\bvery unique\b/gi),
];

export type PhraseHit = {
  key: string;
  find: string;
  /** The exact text matched in this sentence, which may differ in case. */
  matched: string;
  replace: string;
  index: number;
};

export function findPhraseHits(text: string): PhraseHit[] {
  const hits: PhraseHit[] = [];
  for (const entry of PHRASE_TABLE) {
    const re = new RegExp(entry.pattern.source, entry.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({
        key: entry.key,
        find: entry.find,
        matched: m[0],
        replace: entry.replace,
        index: m.index,
      });
      if (m[0].length === 0) break;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function hitsByUnit(units: Unit[]): Map<string, PhraseHit[]> {
  const map = new Map<string, PhraseHit[]>();
  for (const unit of units) {
    if (unit.kind === "protected") continue;
    const hits = findPhraseHits(unit.text);
    if (hits.length > 0) map.set(unit.id, hits);
  }
  return map;
}

/**
 * Apply approved swaps to one sentence, right to left so earlier indices stay
 * valid. Case is carried over from the text being replaced; when a deletion
 * strips a sentence opener the next letter is capitalised. That is a case
 * change on an existing word, not a new one.
 */
export function applySwaps(text: string, approved: PhraseHit[]): string {
  let out = text;
  for (const hit of [...approved].sort((a, b) => b.index - a.index)) {
    const before = out.slice(0, hit.index);
    const after = out.slice(hit.index + hit.matched.length);
    const replacement =
      hit.replace === "" ? "" : matchCase(hit.matched, hit.replace);
    out = before + replacement + after;
  }
  return tidy(out);
}

function matchCase(matched: string, replacement: string): string {
  const lead = matched.trimStart()[0] ?? "";
  if (lead && lead === lead.toUpperCase() && lead !== lead.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function tidy(text: string): string {
  let out = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  const first = out[0];
  if (first && first === first.toLowerCase() && first !== first.toUpperCase()) {
    out = first.toUpperCase() + out.slice(1);
  }
  return out;
}
