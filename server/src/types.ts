/** The wire types shared by the server, the SSE stream and the web app. */

export type Mode = "web" | "writing" | "list";

/** A span of the input the pipeline can act on. `protected` units are never cut. */
export type Unit = {
  id: string;
  kind: "sentence" | "item" | "protected";
  paragraphId?: string;
  text: string;
};

/** One answer from Jev. Every judgment in a run is streamed to the UI as one of these. */
export type Judgment = {
  stage: 0 | 1 | 2 | 3 | 4 | "list";
  unitId?: string; // absent for page-level questions
  question: string; // e.g. "adds_info"
  type: "choice" | "score" | "noul";
  answer: string | number; // choice label, expected score, or yes-probability
  confidence?: number; // Choice and Score only
  ms: number; // latency of the request that carried it
};

/** One change the planner made. Reasons come from a fixed list; none of this text is generated. */
export type Edit = {
  kind: "delete" | "swap" | "keep_best" | "flag" | "collapse" | "revert";
  unitIds: string[];
  reason: string;
  replacement?: string; // phrase-table entry for swaps
};

export type Stats = {
  wordsIn: number;
  wordsOut: number;
  judgments: number;
  requests: number;
  totalMs: number;
  inputTokens: number;
  costUsd: number;
};

/** Where the text came from. Web mode fills in the URL and screenshot. */
export type Source = {
  title?: string;
  url?: string;
  screenshotUrl?: string;
  /** False when the demo button replayed a cached fetch instead of loading live. */
  live?: boolean;
};

/** A paragraph of prose, or a protected block (heading, list, table, code, quote). */
export type Block = {
  id: string;
  kind: "prose" | "protected";
  /** Original block text, used for protected blocks and for the diff view. */
  text: string;
  /** Sentence units, for prose blocks only. */
  units: Unit[];
  /** Set when the block is a list or table so the UI can render it back. */
  html?: string;
};

export type Report = {
  genre?: string;
  padding?: number;
  paddingLabel?: string;
  fillerCounts: Record<string, number>;
  cuts: Array<{ unitId: string; text: string; reason: string }>;
  flags: Array<{ unitId: string; text: string; reason: string }>;
  swaps: Array<{ unitId: string; from: string; to: string }>;
  revertedParagraphs: string[];
};

export type DonePayload = {
  output: string;
  stats: Stats;
  report: Report;
};

/** Events on the SSE stream, in the order the UI expects them. */
export type UnslopEvent =
  | { event: "mode"; data: { mode: Mode; confidence: number } }
  | { event: "source"; data: Source }
  | { event: "units"; data: { units: Unit[]; blocks: Block[] } }
  | { event: "judgment"; data: Judgment }
  | { event: "edit"; data: Edit }
  | { event: "done"; data: DonePayload }
  | { event: "error"; data: { message: string } };

export type UnslopRequest = {
  input: string;
  mode?: "auto" | Mode;
  demo?: boolean;
};

export const FILLER_LABELS = [
  "substantive",
  "throat_clearing_opener",
  "empty_summary",
  "restatement",
  "stacked_hedging",
  "hype",
  "not_just_x_but_y",
  "rhetorical_question",
  "signpost",
  "generic_platitude",
] as const;
export type FillerLabel = (typeof FILLER_LABELS)[number];

export const ITEM_TYPE_LABELS = [
  "substantive",
  "generic_praise_or_complaint",
  "engagement_bait",
  "self_promotion",
  "restates_topic",
  "template_boilerplate",
] as const;
export type ItemTypeLabel = (typeof ITEM_TYPE_LABELS)[number];
