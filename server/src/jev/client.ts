import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Question, Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { JEV_CONCURRENCY, USD_PER_INPUT_MTOK } from "../config.js";
import type { Judgment, Stats } from "../types.js";

type Meta = { unitId?: string; question: string };

/**
 * Builds one request's questions alongside the metadata needed to turn each
 * answer back into a `Judgment` row. Names are `${unitId}_${question}` so the
 * instructions can reference a sentence by path and the panel can still say
 * which unit an answer belongs to.
 */
export class QuestionSet {
  readonly questions: Questions = {};
  readonly meta: Record<string, Meta> = {};

  page(question: string, q: Question): this {
    this.questions[question] = q;
    this.meta[question] = { question };
    return this;
  }

  unit(unitId: string, question: string, q: Question): this {
    const name = `${unitId}_${question}`;
    this.questions[name] = q;
    this.meta[name] = { unitId, question };
    return this;
  }

  get size(): number {
    return Object.keys(this.questions).length;
  }
}

export type AskResult = {
  /** Answers keyed by the names given to `QuestionSet`. */
  answers: SystemOneResult<Questions>["answers"];
  judgments: Judgment[];
  ms: number;
};

type Emit = (judgment: Judgment) => void;

/** A counting semaphore, so paragraph requests run wide but not unbounded. */
class Gate {
  #active = 0;
  #queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#active >= this.limit) {
      await new Promise<void>((resolve) => this.#queue.push(resolve));
    }
    this.#active++;
    try {
      return await fn();
    } finally {
      this.#active--;
      this.#queue.shift()?.();
    }
  }
}

/**
 * The only thing in Unslop that talks to Jev. It runs every request, records
 * what each one cost, and turns the answers into judgment rows for the panel.
 *
 * Jev never sees an instruction to rewrite anything — it only answers
 * questions, and code decides what to do with the answers.
 */
export class Jev {
  readonly #client: TypeSafeClient;
  readonly #gate = new Gate(JEV_CONCURRENCY);
  readonly #emit: Emit;

  requests = 0;
  judgmentCount = 0;
  inputTokens = 0;
  outputTokens = 0;
  totalMs = 0;

  constructor(emit: Emit, client?: TypeSafeClient) {
    this.#emit = emit;
    this.#client = client ?? new TypeSafeClient({ timeout: 30_000 });
  }

  async ask(
    stage: Judgment["stage"],
    state: unknown,
    set: QuestionSet,
    signal?: AbortSignal,
  ): Promise<AskResult> {
    if (set.size === 0) return { answers: {}, judgments: [], ms: 0 };

    return this.#gate.run(async () => {
      const started = Date.now();
      const res = await this.#client.systemOne(
        { state: state as never, questions: set.questions },
        signal ? { signal } : undefined,
      );
      const ms = Date.now() - started;

      this.requests++;
      this.totalMs += ms;
      this.inputTokens += res.usage.input_tokens;
      this.outputTokens += res.usage.output_tokens;

      const judgments: Judgment[] = [];
      for (const [name, answer] of Object.entries(res.answers)) {
        const meta = set.meta[name];
        if (!meta) continue;
        const judgment = toJudgment(stage, meta, answer, ms);
        judgments.push(judgment);
        this.judgmentCount++;
        this.#emit(judgment);
      }
      return { answers: res.answers, judgments, ms };
    });
  }

  stats(
    counts: Pick<
      Stats,
      | "wordsIn"
      | "wordsOut"
      | "proseWordsIn"
      | "proseWordsOut"
      | "protectedWords"
    >,
    wallMs: number,
  ): Stats {
    return {
      ...counts,
      judgments: this.judgmentCount,
      requests: this.requests,
      totalMs: wallMs,
      inputTokens: this.inputTokens,
      costUsd: (this.inputTokens / 1_000_000) * USD_PER_INPUT_MTOK,
    };
  }
}

function toJudgment(
  stage: Judgment["stage"],
  meta: Meta,
  answer: unknown,
  ms: number,
): Judgment {
  const a = answer as
    | { type: "noul"; noul: number }
    | { type: "choice"; choice: string; confidence: number }
    | { type: "score"; score: number; confidence: number };

  const base = {
    stage,
    question: meta.question,
    ms,
    ...(meta.unitId ? { unitId: meta.unitId } : {}),
  };
  if (a.type === "noul") return { ...base, type: "noul", answer: a.noul };
  if (a.type === "choice")
    return {
      ...base,
      type: "choice",
      answer: a.choice,
      confidence: a.confidence,
    };
  return { ...base, type: "score", answer: a.score, confidence: a.confidence };
}

/** Narrowing helpers for reading answers back out of `AskResult`. */
export const readNoul = (answers: AskResult["answers"], name: string): number =>
  (answers[name] as { noul?: number } | undefined)?.noul ?? 0;

export const readChoice = (
  answers: AskResult["answers"],
  name: string,
): { choice: string; confidence: number } => {
  const a = answers[name] as
    { choice?: string; confidence?: number } | undefined;
  return { choice: a?.choice ?? "other", confidence: a?.confidence ?? 0 };
};

export const readScore = (
  answers: AskResult["answers"],
  name: string,
): { score: number; confidence: number } => {
  const a = answers[name] as
    { score?: number; confidence?: number } | undefined;
  return { score: a?.score ?? 0, confidence: a?.confidence ?? 0 };
};
