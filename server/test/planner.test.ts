import { describe, expect, it } from "vitest";
import {
  FLAG_ONLY_GENRES,
  GOAL_DIRECTED_GENRES,
  THRESHOLDS,
} from "../src/config.js";
import {
  findRedundancyGroups,
  REASONS,
  planIntroCuts,
  planOutroCut,
  renderOutput,
  slopScore,
  verdictFor,
  type SentenceSignals,
} from "../src/planner.js";
import { segmentText } from "../src/segment.js";

/** A sentence Jev clearly condemns on all four signals. */
const slop = (
  id: string,
  over: Partial<SentenceSignals> = {},
): SentenceSignals => ({
  unitId: id,
  addsInfo: 0.05,
  fillerType: "generic_platitude",
  fillerConfidence: 0.95,
  generic: 3,
  specific: 0.02,
  loadBearing: 0.05,
  repeatsPrev: undefined,
  onTopic: undefined,
  swaps: [],
  ...over,
});

const solid = (
  id: string,
  over: Partial<SentenceSignals> = {},
): SentenceSignals => ({
  unitId: id,
  addsInfo: 0.96,
  fillerType: "substantive",
  fillerConfidence: 0.99,
  generic: 0.2,
  specific: 0.98,
  loadBearing: 0.4,
  repeatsPrev: undefined,
  onTopic: undefined,
  swaps: [],
  ...over,
});

describe("verdictFor", () => {
  it("cuts only when all four signals agree", () => {
    expect(verdictFor(slop("s0"), false).verdict).toBe("delete");
  });

  it("keeps a sentence that names something concrete", () => {
    expect(verdictFor(slop("s0", { specific: 0.9 }), false).verdict).toBe(
      "flag",
    );
  });

  it("keeps a sentence the next one depends on", () => {
    expect(verdictFor(slop("s0", { loadBearing: 0.9 }), false).verdict).toBe(
      "flag",
    );
  });

  it("will not cut on a low-confidence filler_type", () => {
    expect(
      verdictFor(slop("s0", { fillerConfidence: 0.4 }), false).verdict,
    ).toBe("flag");
  });

  it("flags rather than cuts in flag-only genres", () => {
    expect(verdictFor(slop("s0"), true).verdict).toBe("flag");
  });

  it("leaves substantive sentences alone", () => {
    expect(verdictFor(solid("s0"), false).verdict).toBe("keep");
  });

  it("flags the middle ground instead of cutting it", () => {
    expect(verdictFor(solid("s0", { addsInfo: 0.3 }), false).verdict).toBe(
      "flag",
    );
  });

  it("names the rule it cut on", () => {
    expect(verdictFor(slop("s0"), false).reason).toBe(REASONS.noNewInfo);
  });
});

describe("verdictFor, off-topic rule", () => {
  /** A dated aside about the writer: concrete, substantive, and beside the point. */
  const aside = solid("s0", { onTopic: 0.1 });

  it("cuts a concrete sentence that is not about the subject", () => {
    const ruling = verdictFor(aside, false);
    expect(ruling.verdict).toBe("delete");
    expect(ruling.reason).toBe(REASONS.offTopic);
  });

  it("never applies where on_topic was not asked", () => {
    expect(verdictFor(solid("s0"), false).verdict).toBe("keep");
  });

  it("still lets load_bearing block the cut", () => {
    expect(
      verdictFor(solid("s0", { onTopic: 0.1, loadBearing: 0.9 }), false)
        .verdict,
    ).toBe("flag");
  });

  it("flags rather than cuts in flag-only genres", () => {
    expect(verdictFor(aside, true).verdict).toBe("flag");
  });

  it("keeps a sentence that is about the subject", () => {
    expect(verdictFor(solid("s0", { onTopic: 0.95 }), false).verdict).toBe(
      "keep",
    );
  });

  it("sits the boundary exactly on the threshold", () => {
    const just_over = THRESHOLDS.delete.offTopic + 0.01;
    const just_under = THRESHOLDS.delete.offTopic - 0.01;
    expect(verdictFor(solid("s0", { onTopic: just_over }), false).verdict).toBe(
      "keep",
    );
    expect(
      verdictFor(solid("s0", { onTopic: just_under }), false).verdict,
    ).toBe("delete");
  });

  it("flags a load-bearing aside rather than silently keeping it", () => {
    const ruling = verdictFor(
      solid("s0", { onTopic: 0.1, loadBearing: 0.9 }),
      false,
    );
    expect(ruling.verdict).toBe("flag");
    expect(ruling.reason).toBe(REASONS.offTopic);
  });
});

describe("planIntroCuts", () => {
  const text =
    "Weak opener. More setup.\n\nThe survey found 62%. It rose from 48%.";
  const { blocks } = segmentText(text);
  const signals = new Map<string, SentenceSignals>([
    ["s0", slop("s0")],
    ["s1", slop("s1")],
    ["s2", solid("s2")],
    ["s3", solid("s3")],
  ]);

  it("cuts setup paragraphs before the first substance", () => {
    expect(planIntroCuts(blocks, "p1", 0.9, signals)).toEqual(["p0"]);
  });

  it("does nothing when Jev is unsure where substance starts", () => {
    expect(planIntroCuts(blocks, "p1", 0.5, signals)).toEqual([]);
  });

  it("never cuts the paragraph that holds the first substance", () => {
    expect(planIntroCuts(blocks, "p0", 0.99, signals)).toEqual([]);
  });

  it("leaves an intro whose sentences do not qualify", () => {
    const strong = new Map(signals);
    strong.set("s0", solid("s0"));
    strong.set("s1", solid("s1"));
    expect(planIntroCuts(blocks, "p1", 0.9, strong)).toEqual([]);
  });
});

describe("planOutroCut", () => {
  const { blocks } = segmentText(
    "The survey found 62%.\n\nIn short, things changed.",
  );
  const signals = new Map<string, SentenceSignals>([
    ["s0", solid("s0")],
    ["s1", slop("s1")],
  ]);

  it("cuts a closing paragraph that only restates", () => {
    expect(planOutroCut(blocks, 0.95, signals)).toBe("p1");
  });

  it("keeps a closing paragraph that names something", () => {
    const named = new Map(signals);
    named.set("s1", slop("s1", { specific: 0.9 }));
    expect(planOutroCut(blocks, 0.95, named)).toBeUndefined();
  });

  it("respects the threshold", () => {
    expect(
      planOutroCut(blocks, THRESHOLDS.outroRestates, signals),
    ).toBeUndefined();
  });
});

describe("findRedundancyGroups", () => {
  const { blocks } = segmentText(
    "Point one. The same point again. And once more. A different point.",
  );
  const signals = new Map<string, SentenceSignals>([
    ["s0", solid("s0")],
    ["s1", solid("s1", { repeatsPrev: 0.9 })],
    ["s2", solid("s2", { repeatsPrev: 0.85 })],
    ["s3", solid("s3", { repeatsPrev: 0.1 })],
  ]);

  it("groups a run of adjacent repeats", () => {
    const groups = findRedundancyGroups(blocks, signals, () => true);
    expect(groups.map((g) => g.map((u) => u.id))).toEqual([["s0", "s1", "s2"]]);
  });

  it("skips sentences already cut", () => {
    const groups = findRedundancyGroups(blocks, signals, (id) => id !== "s1");
    expect(groups).toEqual([]);
  });
});

describe("renderOutput", () => {
  it("drops cut sentences and leaves protected blocks untouched", () => {
    const { blocks } = segmentText(
      "# Recipe\n\n- 3 eggs\n\nWeak opener. The oven is at 180C.",
    );
    const signals = new Map<string, SentenceSignals>([
      ["s0", slop("s0")],
      ["s1", solid("s1")],
    ]);
    const out = renderOutput(blocks, signals, new Set(["s0"]));
    expect(out).toBe("# Recipe\n\n- 3 eggs\n\nThe oven is at 180C.");
  });

  it("removes a paragraph whose sentences all went", () => {
    const { blocks } = segmentText("Only filler here.\n\nReal content here.");
    const signals = new Map<string, SentenceSignals>([
      ["s0", slop("s0")],
      ["s1", solid("s1")],
    ]);
    expect(renderOutput(blocks, signals, new Set(["s0"]))).toBe(
      "Real content here.",
    );
  });
});

describe("slopScore", () => {
  it("scores a specific, useful item near zero", () => {
    expect(slopScore(1, 0, "substantive")).toBeCloseTo(0);
  });

  it("scores an empty generic item at one", () => {
    expect(slopScore(0, 3, "generic_praise_or_complaint")).toBeCloseTo(1);
  });

  it("puts generic praise over the collapse threshold", () => {
    expect(slopScore(0.1, 2.5, "generic_praise_or_complaint")).toBeGreaterThan(
      THRESHOLDS.collapseSlop,
    );
  });
});

describe("GOAL_DIRECTED_GENRES", () => {
  it("covers the genres where a reader arrives with a goal", () => {
    for (const genre of ["recipe", "how_to_guide", "documentation"]) {
      expect(GOAL_DIRECTED_GENRES.has(genre)).toBe(true);
    }
  });

  it("leaves email out, where the writer is often the point", () => {
    expect(GOAL_DIRECTED_GENRES.has("email")).toBe(false);
  });

  it("never overlaps the flag-only genres", () => {
    for (const genre of FLAG_ONLY_GENRES) {
      expect(GOAL_DIRECTED_GENRES.has(genre)).toBe(false);
    }
  });
});
