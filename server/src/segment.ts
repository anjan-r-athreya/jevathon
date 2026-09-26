import type { Block, Unit } from "./types.js";

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

export function countWords(text: string): number {
  let n = 0;
  for (const s of wordSegmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}

/**
 * Lines that must survive untouched: headings, list items, tables, code fences
 * and block quotes. In web mode this is what keeps recipe ingredients and steps
 * intact — only prose paragraphs are ever sent to Jev for cutting.
 */
const PROTECTED_LINE =
  /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||```|~~~|\t| {4,}\S)/;

function isProtectedChunk(chunk: string): boolean {
  const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return true;
  const protectedLines = lines.filter((l) => PROTECTED_LINE.test(l)).length;
  if (protectedLines / lines.length >= 0.5) return true;
  // A lone short line with no terminal punctuation reads as a heading.
  if (lines.length === 1) {
    const only = lines[0]!.trim();
    if (only.length <= 80 && !/[.!?:;]$/.test(only) && countWords(only) <= 12) {
      return true;
    }
  }
  return false;
}

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const seg of sentenceSegmenter.segment(text)) {
    const s = seg.segment.trim();
    if (s.length > 0) out.push(s);
  }
  return out;
}

export function splitChunks(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Split pasted text into blocks with stable IDs. Sentence IDs are global
 * (`s0`..`sN`) so a Stage 3 group spanning a paragraph still reads as
 * `sentences.s4`, exactly as the question instructions reference it.
 */
export function segmentText(text: string): { blocks: Block[]; units: Unit[] } {
  const blocks: Block[] = [];
  const units: Unit[] = [];
  let sentenceIndex = 0;

  splitChunks(text).forEach((chunk, i) => {
    const id = `p${i}`;
    if (isProtectedChunk(chunk)) {
      const unit: Unit = {
        id: `${id}x`,
        kind: "protected",
        paragraphId: id,
        text: chunk,
      };
      units.push(unit);
      blocks.push({ id, kind: "protected", text: chunk, units: [unit] });
      return;
    }
    const sentences = splitSentences(chunk);
    const blockUnits = sentences.map((s) => {
      const unit: Unit = {
        id: `s${sentenceIndex++}`,
        kind: "sentence",
        paragraphId: id,
        text: s,
      };
      units.push(unit);
      return unit;
    });
    blocks.push({ id, kind: "prose", text: chunk, units: blockUnits });
  });

  return { blocks, units };
}

/** List mode: one item per blank-line-separated chunk, IDs `i0`..`iN`. */
export function segmentItems(text: string): Unit[] {
  return splitChunks(text).map((chunk, i) => ({
    id: `i${i}`,
    kind: "item" as const,
    text: chunk,
  }));
}

const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b/i;
const SIGN_OFF =
  /^(thanks|thank you|best|best regards|regards|sincerely|cheers|kind regards|all the best|warmly|yours)\b[,.!]?$/i;

/**
 * Email preset: the greeting and the sign-off are never cut. Marking them
 * protected is enough — the planner skips every protected unit.
 */
export function applyEmailPreset(blocks: Block[], units: Unit[]): void {
  const prose = blocks.filter((b) => b.kind === "prose");
  const first = prose[0];
  if (first && first.units.length > 0 && GREETING.test(first.units[0]!.text)) {
    protectBlockOrSentence(first, first.units[0]!, units);
  }
  // The sign-off is the last prose block, or the line above a bare name.
  for (let i = prose.length - 1; i >= Math.max(0, prose.length - 3); i--) {
    const block = prose[i]!;
    const line = block.units[0]?.text ?? block.text;
    if (SIGN_OFF.test(line.trim())) {
      for (const u of block.units) protectBlockOrSentence(block, u, units);
      // Everything after the sign-off is the signature.
      for (let j = i + 1; j < prose.length; j++) {
        for (const u of prose[j]!.units)
          protectBlockOrSentence(prose[j]!, u, units);
      }
      break;
    }
  }
}

function protectBlockOrSentence(block: Block, unit: Unit, units: Unit[]): void {
  unit.kind = "protected";
  const mirror = units.find((u) => u.id === unit.id);
  if (mirror) mirror.kind = "protected";
  if (block.units.every((u) => u.kind === "protected"))
    block.kind = "protected";
}
