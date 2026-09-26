import { describe, expect, it } from "vitest";
import {
  countWords,
  segmentItems,
  segmentText,
  splitSentences,
} from "../src/segment.js";

describe("segmentText", () => {
  it("gives sentences global IDs across paragraphs", () => {
    const { blocks, units } = segmentText(
      "One thing. Two things.\n\nThree things. Four things.",
    );
    expect(blocks.map((b) => b.id)).toEqual(["p0", "p1"]);
    expect(units.map((u) => u.id)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(units[2]!.paragraphId).toBe("p1");
  });

  it("protects headings, lists, tables, code and quotes", () => {
    const text = [
      "# Chocolate cake",
      "- 200g flour\n- 3 eggs",
      "| step | time |\n| --- | --- |",
      "```\nnpm install\n```",
      "> Someone said this.",
      "This is an ordinary paragraph of prose that should be judged.",
    ].join("\n\n");
    const { blocks } = segmentText(text);
    expect(blocks.slice(0, 5).every((b) => b.kind === "protected")).toBe(true);
    expect(blocks[5]!.kind).toBe("prose");
  });

  it("treats a short unpunctuated line as a heading", () => {
    const { blocks } = segmentText(
      "Why this matters\n\nBecause it saves money every month.",
    );
    expect(blocks[0]!.kind).toBe("protected");
    expect(blocks[1]!.kind).toBe("prose");
  });
});

describe("segmentItems", () => {
  it("splits on blank lines with i-prefixed IDs", () => {
    const units = segmentItems(
      "Great product!\n\nThe strap broke after 3 weeks.\n\nLove it.",
    );
    expect(units.map((u) => u.id)).toEqual(["i0", "i1", "i2"]);
    expect(units.every((u) => u.kind === "item")).toBe(true);
  });
});

describe("splitSentences", () => {
  it("keeps abbreviations and decimals in one sentence", () => {
    expect(
      splitSentences("It cost $18,400 in Q3. That is a lot."),
    ).toHaveLength(2);
  });
});

describe("countWords", () => {
  it("counts word-like segments only", () => {
    expect(countWords("Two words, plus punctuation!")).toBe(4);
  });
});
