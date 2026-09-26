/**
 * Every number the planner leans on, in one place.
 *
 * The spec calls these starting guesses. Tune them against the demo inputs
 * before going on stage; nothing else in the codebase hardcodes a threshold.
 */
export const THRESHOLDS = {
  /** Stage 2 delete rule. All four must agree before a sentence is cut. */
  delete: {
    addsInfo: 0.2,
    specific: 0.3,
    loadBearing: 0.5,
    fillerConfidence: 0.6,
    /**
     * The off-topic rule, for goal-directed genres only.
     *
     * Measured on a recipe blog, `on_topic` splits into two clusters with a
     * wide empty gap between them: life-story sentences land at 0.08-0.45,
     * everything about the actual recipe at 0.95-0.97. Sitting in the middle
     * of that gap catches the whole life story and comes nowhere near a
     * sentence that tells the reader something.
     */
    offTopic: 0.5,
  },
  /** Below this, a sentence Jev is unsure about is flagged rather than cut. */
  flagAddsInfo: 0.5,
  /** Stage 1 structural cuts. */
  firstSubstanceConfidence: 0.7,
  /** Share of a paragraph's sentences that must qualify before the intro goes. */
  introQualifyingShare: 0.5,
  outroRestates: 0.8,
  outroSpecific: 0.5,
  /** Stage 3 redundancy groups. */
  repeatsPrev: 0.7,
  bestConfidence: 0.5,
  /** Phrase table. */
  swap: 0.8,
  /** List mode. */
  collapseSlop: 0.6,
  collapseSpecific: 0.5,
  /** Stage 4 edit check. Either one reverts the paragraph's cuts. */
  lostInfo: 0.5,
  readsOk: 0.5,
  /** Rows below this are amber in the decision panel: Jev saying "not sure". */
  lowConfidence: 0.5,
} as const;

/** Genres that get flags only. Repetition in these is usually deliberate. */
export const FLAG_ONLY_GENRES = new Set(["fiction", "poetry", "speech"]);

/**
 * Genres where the reader arrived with a goal, and a sentence about the
 * writer's history does not serve it. These get the extra `on_topic` question.
 *
 * An email is deliberately absent: there, the writer is often the point.
 */
export const GOAL_DIRECTED_GENRES = new Set([
  "recipe",
  "how_to_guide",
  "documentation",
  "news_or_explainer_article",
  "product_page",
  "blog_post",
]);

/** Jev 1.13: $0.042 per million input tokens, output free. */
export const USD_PER_INPUT_MTOK = 0.042;

/** TypeSafe's limits shift under load; the SDK retries 429s with backoff. */
export const JEV_CONCURRENCY = Number(process.env.JEV_CONCURRENCY ?? 8);

/** Jev's state limit. Stage 1 sends the whole text, so it needs a cap. */
export const STATE_CHAR_CAP = 96_000;

/** One request per 20 items in list mode. */
export const LIST_BATCH_SIZE = 20;
