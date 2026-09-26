import {
  LIST_BATCH_SIZE,
  FLAG_ONLY_GENRES,
  GOAL_DIRECTED_GENRES,
  STATE_CHAR_CAP,
} from "./config.js";
import {
  Jev,
  readChoice,
  readNoul,
  readScore,
  type AskResult,
} from "./jev/client.js";
import {
  editCheckQuestions,
  itemQuestions,
  pageGateQuestions,
  paragraphQuestions,
  PADDING_LABELS,
  redundancyQuestions,
  routerQuestions,
} from "./jev/questions.js";
import { hitsByUnit, type PhraseHit } from "./phrases.js";
import {
  approvedSwaps,
  findRedundancyGroups,
  makeEdit,
  planIntroCuts,
  planOutroCut,
  REASONS,
  renderOutput,
  renderUnit,
  slopScore,
  verdictFor,
  type SentenceSignals,
} from "./planner.js";
import {
  applyEmailPreset,
  countWords,
  segmentItems,
  segmentText,
} from "./segment.js";
import { THRESHOLDS } from "./config.js";
import type {
  Block,
  Edit,
  Mode,
  Report,
  Source,
  Unit,
  UnslopEvent,
  UnslopRequest,
} from "./types.js";

export type Emit = (event: UnslopEvent) => void;

/** Anything that looks like a bare URL goes straight to web mode, no request needed. */
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

export type FetchPage = (
  url: string,
  demo: boolean,
) => Promise<{ source: Source; blocks: Block[]; units: Unit[] }>;

export type RunOptions = {
  emit: Emit;
  signal?: AbortSignal;
  fetchPage?: FetchPage;
};

export async function runUnslop(
  req: UnslopRequest,
  opts: RunOptions,
): Promise<void> {
  const { emit, signal } = opts;
  const startedAt = Date.now();
  const jev = new Jev((judgment) =>
    emit({ event: "judgment", data: judgment }),
  );
  const input = req.input.trim();

  try {
    const routed = await detectMode(input, req.mode ?? "auto", jev, signal);
    if (routed.mode === null) {
      emit({
        event: "error",
        data: {
          message: "That looks like code or data. Unslop only judges prose.",
        },
      });
      return;
    }
    emit({
      event: "mode",
      data: { mode: routed.mode, confidence: routed.confidence },
    });

    if (routed.mode === "web") {
      if (!opts.fetchPage) {
        emit({
          event: "error",
          data: { message: "Web mode is not configured on this server." },
        });
        return;
      }
      const page = await opts.fetchPage(input, req.demo ?? false);
      emit({ event: "source", data: page.source });
      emit({
        event: "units",
        data: { units: page.units, blocks: page.blocks },
      });
      await runWriting(page.blocks, page.units, jev, emit, startedAt, signal);
      return;
    }

    if (routed.mode === "list") {
      const units = segmentItems(input);
      emit({ event: "units", data: { units, blocks: [] } });
      await runList(units, jev, emit, startedAt, signal);
      return;
    }

    const { blocks, units } = segmentText(input);
    if (routed.isEmail) applyEmailPreset(blocks, units);
    emit({ event: "source", data: {} });
    emit({ event: "units", data: { units, blocks } });
    await runWriting(blocks, units, jev, emit, startedAt, signal);
  } catch (err) {
    emit({ event: "error", data: { message: describe(err) } });
  }
}

/* ------------------------------------------------------------------ */
/* Stage 0: router                                                     */
/* ------------------------------------------------------------------ */

async function detectMode(
  input: string,
  override: "auto" | Mode,
  jev: Jev,
  signal?: AbortSignal,
): Promise<{ mode: Mode | null; confidence: number; isEmail: boolean }> {
  if (URL_RE.test(input)) return { mode: "web", confidence: 1, isEmail: false };
  if (override !== "auto")
    return { mode: override, confidence: 1, isEmail: false };

  const { answers } = await jev.ask(
    0,
    input.slice(0, 2000),
    routerQuestions(),
    signal,
  );
  const { choice, confidence } = readChoice(answers, "input_kind");
  switch (choice) {
    case "list_of_separate_short_items":
      return { mode: "list", confidence, isEmail: false };
    case "email_or_message":
      return { mode: "writing", confidence, isEmail: true };
    case "code_or_data":
      return { mode: null, confidence, isEmail: false };
    default:
      return { mode: "writing", confidence, isEmail: false };
  }
}

/* ------------------------------------------------------------------ */
/* Writing and web modes                                               */
/* ------------------------------------------------------------------ */

async function runWriting(
  blocks: Block[],
  units: Unit[],
  jev: Jev,
  emit: Emit,
  startedAt: number,
  signal?: AbortSignal,
): Promise<void> {
  const wordsIn = countWords(units.map((u) => u.text).join(" "));
  const prose = blocks.filter((b) => b.kind === "prose" && b.units.length > 0);
  const edits: Edit[] = [];
  const pushEdit = (edit: Edit) => {
    edits.push(edit);
    emit({ event: "edit", data: edit });
  };

  // Stage 1: page gate, one request over the whole text.
  const gate = await jev.ask(
    1,
    pageGateState(blocks),
    pageGateQuestions(prose.map((b) => b.id)),
    signal,
  );
  const genre = readChoice(gate.answers, "genre");
  const padding = readScore(gate.answers, "padding");
  const firstSubstance = readChoice(gate.answers, "first_substance");
  const outroRestates = readNoul(gate.answers, "outro_restates");
  const flagOnly = FLAG_ONLY_GENRES.has(genre.choice);

  // Stage 2: one request per paragraph, all in parallel behind the gate.
  const phraseHits = hitsByUnit(units);
  const signals = new Map<string, SentenceSignals>();
  // On a page the reader came to for something, ask whether each sentence is
  // about the subject at all. The title goes into the state so the question
  // has something concrete to point at.
  const askOnTopic = GOAL_DIRECTED_GENRES.has(genre.choice);
  const title = pageTitle(blocks);
  await Promise.all(
    prose.map(async (block, i) => {
      const sentences = block.units.filter((u) => u.kind === "sentence");
      if (sentences.length === 0) return;
      const state = {
        title,
        previous_paragraph: prose[i - 1]?.text ?? "",
        sentences: Object.fromEntries(sentences.map((u) => [u.id, u.text])),
        next_paragraph: prose[i + 1]?.text ?? "",
      };
      const set = paragraphQuestions(
        sentences,
        hitsForQuestions(sentences, phraseHits),
        askOnTopic,
      );
      const { answers } = await jev.ask(2, state, set, signal);
      for (const unit of sentences) {
        signals.set(
          unit.id,
          readSentenceSignals(answers, unit.id, phraseHits.get(unit.id) ?? []),
        );
      }
    }),
  );

  // Planner pass: the Stage 2 rule, then the two structural cuts.
  const deleted = new Set<string>();
  const flagged: Edit[] = [];
  /** Paragraphs a Stage 1 rule removed wholesale, which Stage 4 skips. */
  const structural = new Set<string>();
  for (const unit of units) {
    const sig = signals.get(unit.id);
    if (!sig || unit.kind === "protected") continue;
    const { verdict, reason } = verdictFor(sig, flagOnly);
    if (verdict === "delete") {
      deleted.add(unit.id);
      pushEdit(makeEdit("delete", [unit.id], reason));
    } else if (verdict === "flag") {
      const edit = makeEdit("flag", [unit.id], reason);
      flagged.push(edit);
      pushEdit(edit);
    }
    for (const hit of approvedSwaps(sig)) {
      pushEdit(
        makeEdit(
          "swap",
          [unit.id],
          REASONS.swap,
          hit.replace === "" ? "(removed)" : hit.replace,
        ),
      );
    }
  }

  for (const blockId of planIntroCuts(
    blocks,
    firstSubstance.choice,
    firstSubstance.confidence,
    signals,
  )) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block || flagOnly) continue;
    const ids = block.units
      .filter((u) => u.kind === "sentence")
      .map((u) => u.id);
    if (ids.length === 0) continue;
    ids.forEach((id) => deleted.add(id));
    structural.add(block.id);
    pushEdit(makeEdit("delete", ids, REASONS.intro));
  }

  const outroId = flagOnly
    ? undefined
    : planOutroCut(blocks, outroRestates, signals);
  if (outroId) {
    const block = blocks.find((b) => b.id === outroId)!;
    const ids = block.units
      .filter((u) => u.kind === "sentence")
      .map((u) => u.id);
    ids.forEach((id) => deleted.add(id));
    structural.add(block.id);
    pushEdit(makeEdit("delete", ids, REASONS.outro));
  }

  // Stage 3: one request per redundancy group.
  const groups = findRedundancyGroups(
    blocks,
    signals,
    (id) => !deleted.has(id),
  );
  await Promise.all(
    groups.map(async (group) => {
      const { answers } = await jev.ask(
        3,
        groupState(group),
        redundancyQuestions(group),
        signal,
      );
      const best = readChoice(answers, "best");
      const ids = group.map((u) => u.id);
      if (
        best.confidence < THRESHOLDS.bestConfidence ||
        !ids.includes(best.choice) ||
        flagOnly
      ) {
        pushEdit(makeEdit("flag", ids, REASONS.groupUnsure));
        return;
      }
      const losers = ids.filter((id) => id !== best.choice);
      losers.forEach((id) => deleted.add(id));
      pushEdit(makeEdit("keep_best", ids, REASONS.repeats, best.choice));
    }),
  );

  // Stage 4: edit check, one request per paragraph that actually changed.
  //
  // Two kinds of paragraph are left out. A paragraph a Stage 1 rule removed
  // wholesale was a paragraph-level decision with its own confidence gate, and
  // a paragraph nothing survived in has nothing to compare against: `edited`
  // would be the empty string, which loses every fact by definition.
  const changed = prose.filter(
    (b) =>
      !structural.has(b.id) &&
      b.units.some(
        (u) =>
          deleted.has(u.id) ||
          approvedSwaps(signals.get(u.id) ?? emptySignals(u.id)).length > 0,
      ),
  );
  const reverted: string[] = [];
  await Promise.all(
    changed.map(async (block) => {
      const survivors = block.units.filter((u) => !deleted.has(u.id));
      if (survivors.length === 0) return;
      const edited = survivors
        .map((u) => renderUnit(u, signals.get(u.id)))
        .join(" ");
      const { answers } = await jev.ask(
        4,
        { title, original: block.text, edited },
        editCheckQuestions(askOnTopic),
        signal,
      );
      const lostInfo = readNoul(answers, "lost_info");
      const readsOk = readNoul(answers, "reads_ok");
      if (lostInfo <= THRESHOLDS.lostInfo && readsOk >= THRESHOLDS.readsOk)
        return;

      // The cuts come back and become flags, so the reader still sees which
      // sentences Jev thought were weak without losing anything.
      const restored = block.units
        .filter((u) => deleted.has(u.id))
        .map((u) => u.id);
      if (restored.length === 0) return;
      restored.forEach((id) => deleted.delete(id));
      reverted.push(block.id);
      const reason =
        lostInfo > THRESHOLDS.lostInfo ? REASONS.lostInfo : REASONS.readsBadly;
      pushEdit(makeEdit("revert", restored, reason));
      const flag = makeEdit("flag", restored, reason);
      flagged.push(flag);
      pushEdit(flag);
    }),
  );

  const output = renderOutput(blocks, signals, deleted);
  emit({
    event: "done",
    data: {
      output,
      stats: jev.stats(wordsIn, countWords(output), Date.now() - startedAt),
      report: buildReport({
        genre: genre.choice,
        padding: padding.score,
        signals,
        units,
        deleted,
        flagged,
        reverted,
      }),
    },
  });
}

/* ------------------------------------------------------------------ */
/* List mode                                                           */
/* ------------------------------------------------------------------ */

async function runList(
  units: Unit[],
  jev: Jev,
  emit: Emit,
  startedAt: number,
  signal?: AbortSignal,
): Promise<void> {
  const wordsIn = countWords(units.map((u) => u.text).join(" "));
  const batches: Unit[][] = [];
  for (let i = 0; i < units.length; i += LIST_BATCH_SIZE) {
    batches.push(units.slice(i, i + LIST_BATCH_SIZE));
  }

  const scored = new Map<
    string,
    { slop: number; itemType: string; specific: number }
  >();
  await Promise.all(
    batches.map(async (batch) => {
      const state = {
        items: Object.fromEntries(batch.map((u) => [u.id, u.text])),
      };
      const { answers } = await jev.ask(
        "list",
        state,
        itemQuestions(batch),
        signal,
      );
      for (const unit of batch) {
        const useful = readNoul(answers, `${unit.id}_useful`);
        const itemType = readChoice(answers, `${unit.id}_item_type`).choice;
        const generic = readScore(answers, `${unit.id}_generic`).score;
        const specific = readNoul(answers, `${unit.id}_specific`);
        scored.set(unit.id, {
          slop: slopScore(useful, generic, itemType),
          itemType,
          specific,
        });
      }
    }),
  );

  const collapsed: string[] = [];
  for (const unit of units) {
    const s = scored.get(unit.id);
    if (!s) continue;
    if (
      s.slop >= THRESHOLDS.collapseSlop &&
      s.specific < THRESHOLDS.collapseSpecific
    ) {
      collapsed.push(unit.id);
      emit({
        event: "edit",
        data: makeEdit("collapse", [unit.id], REASONS.collapse, s.itemType),
      });
    }
  }

  // Useful items rise to the top; collapsed ones keep their order below.
  const ranked = [...units].sort(
    (a, b) => (scored.get(a.id)?.slop ?? 1) - (scored.get(b.id)?.slop ?? 1),
  );
  const output = ranked
    .filter((u) => !collapsed.includes(u.id))
    .map((u) => u.text)
    .join("\n\n");

  const fillerCounts: Record<string, number> = {};
  for (const [, s] of scored)
    fillerCounts[s.itemType] = (fillerCounts[s.itemType] ?? 0) + 1;

  emit({
    event: "done",
    data: {
      output,
      stats: jev.stats(wordsIn, countWords(output), Date.now() - startedAt),
      report: {
        fillerCounts,
        cuts: collapsed.map((id) => ({
          unitId: id,
          text: units.find((u) => u.id === id)?.text ?? "",
          reason: REASONS.collapse,
        })),
        flags: [],
        swaps: [],
        revertedParagraphs: [],
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The page's own heading: the first protected block's first line. */
function pageTitle(blocks: Block[]): string {
  return (
    blocks
      .find((b) => b.kind === "protected")
      ?.text.split("\n")[0]
      ?.slice(0, 200) ?? ""
  );
}

function pageGateState(blocks: Block[]): {
  title: string;
  paragraphs: Record<string, string>;
} {
  const title = pageTitle(blocks);
  const paragraphs: Record<string, string> = {};
  let budget = STATE_CHAR_CAP;
  for (const block of blocks) {
    if (budget <= 0) break;
    const text = block.text.slice(0, budget);
    paragraphs[block.id] = text;
    budget -= text.length;
  }
  return { title, paragraphs };
}

function groupState(group: Unit[]): { sentences: Record<string, string> } {
  return { sentences: Object.fromEntries(group.map((u) => [u.id, u.text])) };
}

function hitsForQuestions(
  units: Unit[],
  phraseHits: Map<string, PhraseHit[]>,
): Map<string, Array<{ key: string; find: string; replace: string }>> {
  const map = new Map<
    string,
    Array<{ key: string; find: string; replace: string }>
  >();
  for (const unit of units) {
    const hits = phraseHits.get(unit.id);
    if (!hits) continue;
    // One question per distinct phrase, even when it appears twice.
    const seen = new Set<string>();
    const distinct = hits.filter((h) => !seen.has(h.key) && seen.add(h.key));
    map.set(
      unit.id,
      // An empty `replace` is passed through: the question builder asks whether
      // the phrase can be removed rather than replaced.
      distinct.map((h) => ({ key: h.key, find: h.find, replace: h.replace })),
    );
  }
  return map;
}

function readSentenceSignals(
  answers: AskResult["answers"],
  unitId: string,
  hits: PhraseHit[],
): SentenceSignals {
  const filler = readChoice(answers, `${unitId}_filler_type`);
  const repeats = answers[`${unitId}_repeats_prev`]
    ? readNoul(answers, `${unitId}_repeats_prev`)
    : undefined;
  return {
    unitId,
    addsInfo: readNoul(answers, `${unitId}_adds_info`),
    fillerType: filler.choice,
    fillerConfidence: filler.confidence,
    generic: readScore(answers, `${unitId}_generic`).score,
    specific: readNoul(answers, `${unitId}_specific`),
    loadBearing: readNoul(answers, `${unitId}_load_bearing`),
    repeatsPrev: repeats,
    onTopic: answers[`${unitId}_on_topic`]
      ? readNoul(answers, `${unitId}_on_topic`)
      : undefined,
    swaps: hits.map((hit) => ({
      hit,
      approval: readNoul(answers, `${unitId}_swap_${hit.key}`),
    })),
  };
}

function emptySignals(unitId: string): SentenceSignals {
  return {
    unitId,
    addsInfo: 1,
    fillerType: "substantive",
    fillerConfidence: 0,
    generic: 0,
    specific: 1,
    loadBearing: 1,
    repeatsPrev: undefined,
    onTopic: undefined,
    swaps: [],
  };
}

function buildReport(input: {
  genre: string;
  padding: number;
  signals: Map<string, SentenceSignals>;
  units: Unit[];
  deleted: Set<string>;
  flagged: Edit[];
  reverted: string[];
}): Report {
  const fillerCounts: Record<string, number> = {};
  const swaps: Report["swaps"] = [];
  for (const [id, sig] of input.signals) {
    fillerCounts[sig.fillerType] = (fillerCounts[sig.fillerType] ?? 0) + 1;
    for (const hit of approvedSwaps(sig)) {
      swaps.push({
        unitId: id,
        from: hit.matched.trim(),
        to: hit.replace || "(removed)",
      });
    }
  }
  const textOf = (id: string) =>
    input.units.find((u) => u.id === id)?.text ?? "";
  return {
    genre: input.genre,
    padding: input.padding,
    paddingLabel: PADDING_LABELS[Math.round(input.padding)] ?? "",
    fillerCounts,
    cuts: [...input.deleted].map((id) => ({
      unitId: id,
      text: textOf(id),
      reason: input.signals.get(id)?.fillerType ?? REASONS.noNewInfo,
    })),
    flags: input.flagged.flatMap((e) =>
      e.unitIds.map((id) => ({
        unitId: id,
        text: textOf(id),
        reason: e.reason,
      })),
    ),
    swaps,
    revertedParagraphs: input.reverted,
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
