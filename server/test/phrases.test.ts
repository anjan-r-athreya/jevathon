import { describe, expect, it } from "vitest";
import { applySwaps, findPhraseHits } from "../src/phrases.js";

describe("findPhraseHits", () => {
  it("finds table phrases regardless of case, in reading order", () => {
    const hits = findPhraseHits(
      "In order to ship, we utilize a wide range of tools.",
    );
    expect(hits.map((h) => h.key)).toEqual([
      "in_order_to",
      "utilize",
      "wide_range_of",
    ]);
    expect(hits[0]!.matched).toBe("In order to");
  });

  it("only matches sentence-opening closers", () => {
    expect(
      findPhraseHits("In conclusion, we shipped.").map((h) => h.key),
    ).toContain("in_conclusion");
    expect(
      findPhraseHits("We reached no conclusion, overall, that day.").map(
        (h) => h.key,
      ),
    ).not.toContain("in_conclusion");
  });
});

describe("applySwaps", () => {
  it("carries the original capitalisation onto the replacement", () => {
    const text = "Whether or not we act, it matters.";
    const hits = findPhraseHits(text).filter((h) => h.key === "whether_or_not");
    expect(applySwaps(text, hits)).toBe("Whether we act, it matters.");
  });

  it("capitalises the next word when a deletion strips the opener", () => {
    const text = "It is important to note that the survey found 62%.";
    const hits = findPhraseHits(text).filter(
      (h) => h.key === "important_to_note",
    );
    expect(applySwaps(text, hits)).toBe("The survey found 62%.");
  });

  it("applies several swaps in one sentence without shifting indices", () => {
    const text = "In order to grow, each and every team must utilize the data.";
    expect(applySwaps(text, findPhraseHits(text))).toBe(
      "To grow, every team must use the data.",
    );
  });

  it("leaves text alone when nothing is approved", () => {
    const text = "In order to grow, we hired.";
    expect(applySwaps(text, [])).toBe(text);
  });
});
