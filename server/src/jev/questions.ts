import { choice, noul, score } from "@typesafe-ai/sdk";
import { QuestionSet } from "./client.js";
import type { Unit } from "../types.js";

/**
 * Every question Jev is asked, in the wording the spec fixes.
 *
 * Two rules shape all of them: ask positively and concretely (Jev answers the
 * words written, not the intent, and struggles with double negatives), and keep
 * each question narrow enough for one snap judgment.
 */

const GENERIC_RUBRIC = [
  "Only fits this text",
  "Mostly specific",
  "Fairly generic",
  "Fits anywhere",
] as const;

const FILLER_CRITERIA = {
  substantive:
    "It carries information, an argument, an example or an instruction.",
  throat_clearing_opener:
    "It sets up what is coming without saying anything itself.",
  empty_summary: "It summarises without naming anything specific.",
  restatement: "It repeats a point already made in different words.",
  stacked_hedging:
    "It piles up qualifiers such as 'may sometimes potentially'.",
  hype: "It praises or dramatises without evidence.",
  not_just_x_but_y: "It uses the 'not just X but Y' formula.",
  rhetorical_question: "It asks a question it does not expect answered.",
  signpost: 'It announces the next section, such as "let\'s dive in".',
  generic_platitude:
    "It states something obvious that almost anyone would agree with.",
} as const;

const ITEM_TYPE_CRITERIA = {
  substantive: "It reports something the writer actually observed or did.",
  generic_praise_or_complaint:
    "It praises or complains without saying what about.",
  engagement_bait: "It exists to provoke replies, likes or shares.",
  self_promotion: "It promotes the writer, their product or their channel.",
  restates_topic: "It restates the topic without adding anything.",
  template_boilerplate: "It reads as a filled-in template.",
} as const;

const GENRE_CRITERIA = {
  news_or_explainer_article: null,
  recipe: null,
  how_to_guide: null,
  blog_post: null,
  documentation: null,
  email: null,
  product_page: null,
  marketing_copy: null,
  fiction: null,
  poetry: null,
  speech: null,
  other: null,
} as const;

const INPUT_KIND_CRITERIA = {
  one_continuous_piece_of_writing: "A single article, draft, post or document.",
  list_of_separate_short_items:
    "Several short items by different authors, such as reviews or comments.",
  email_or_message: "A message with a greeting and a sign-off.",
  code_or_data: "Source code, logs, JSON, CSV or similar.",
  other: null,
} as const;

/** Stage 0: router. One request, pasted input only. */
export function routerQuestions(): QuestionSet {
  return new QuestionSet().page(
    "input_kind",
    choice("What is this text?", INPUT_KIND_CRITERIA),
  );
}

/** Stage 1: page gate. One request over the whole text. */
export function pageGateQuestions(paragraphIds: string[]): QuestionSet {
  const set = new QuestionSet();
  set.page("genre", choice("What kind of writing is this?", GENRE_CRITERIA));
  set.page(
    "padding",
    score("How much of this text is filler rather than information?", [
      "Almost none",
      "Some",
      "About half",
      "Mostly filler",
    ]),
  );
  if (paragraphIds.length > 0) {
    const criteria: Record<string, null> = {};
    for (const id of paragraphIds) criteria[id] = null;
    set.page(
      "first_substance",
      choice(
        "Which paragraph is the first to give the reader real information rather than setup?",
        criteria,
      ),
    );
  }
  set.page(
    "outro_restates",
    noul(
      "Does the last paragraph only restate points made earlier in the text?",
    ),
  );
  return set;
}

/**
 * Stage 2: paragraph pass. Six questions per sentence, plus one per phrase hit.
 *
 * Swap checks are asked speculatively, even for sentences that may end up cut,
 * because questions sharing a state run in parallel and barely add time.
 */
export function paragraphQuestions(
  units: Unit[],
  phraseHits: Map<
    string,
    Array<{ key: string; find: string; replace: string }>
  >,
): QuestionSet {
  const set = new QuestionSet();
  units.forEach((unit, i) => {
    const id = unit.id;
    const s = `\`sentences.${id}\``;
    set.unit(
      id,
      "adds_info",
      noul(
        `Does ${s} state a fact, claim, example, step or detail that no other sentence here or in \`previous_paragraph\` already states?`,
      ),
    );
    set.unit(
      id,
      "filler_type",
      choice(`What kind of sentence is ${s}?`, FILLER_CRITERIA),
    );
    set.unit(
      id,
      "generic",
      score(
        `Could ${s} appear unchanged in many other texts on different topics?`,
        GENERIC_RUBRIC,
      ),
    );
    set.unit(
      id,
      "specific",
      noul(
        `Does ${s} contain a concrete number, name, date, example or instruction?`,
      ),
    );
    set.unit(
      id,
      "load_bearing",
      noul(
        `Would deleting ${s} make the next sentence unclear, for example because it refers back with "this" or "these"?`,
      ),
    );
    const prev = units[i - 1];
    if (prev) {
      set.unit(
        id,
        "repeats_prev",
        noul(`Does ${s} make the same point as \`sentences.${prev.id}\`?`),
      );
    }
    for (const hit of phraseHits.get(id) ?? []) {
      set.unit(
        id,
        `swap_${hit.key}`,
        noul(
          `In ${s}, can "${hit.find}" be replaced with "${hit.replace}" without changing the meaning or breaking the grammar?`,
        ),
      );
    }
  });
  return set;
}

/** Stage 2 variant for a phrase whose replacement is a deletion. */
export function deletionSwapQuestion(
  unitId: string,
  find: string,
): ReturnType<typeof noul> {
  return noul(
    `In \`sentences.${unitId}\`, can "${find}" be removed without changing the meaning or breaking the grammar?`,
  );
}

/** Stage 3: redundancy picks. One request per group of adjacent repeats. */
export function redundancyQuestions(group: Unit[]): QuestionSet {
  const criteria: Record<string, null> = {};
  for (const u of group) criteria[u.id] = null;
  return new QuestionSet().page(
    "best",
    choice(
      "Which sentence states this point most clearly and specifically?",
      criteria,
    ),
  );
}

/** Stage 4: edit check. One request per edited paragraph. */
export function editCheckQuestions(): QuestionSet {
  return new QuestionSet()
    .page(
      "lost_info",
      noul(
        "Does `original` contain a fact or claim that `edited` no longer contains?",
      ),
    )
    .page(
      "reads_ok",
      noul("Does `edited` read as grammatical, coherent prose?"),
    )
    .page(
      "tone_kept",
      noul("Does `edited` keep the same tone and point of view as `original`?"),
    );
}

/** List mode: item pass. Four questions per item, twenty items per request. */
export function itemQuestions(items: Unit[]): QuestionSet {
  const set = new QuestionSet();
  for (const item of items) {
    const id = item.id;
    const s = `\`items.${id}\``;
    set.unit(
      id,
      "useful",
      noul(
        `Does ${s} give specific, first-hand or factual information a reader could act on?`,
      ),
    );
    set.unit(
      id,
      "item_type",
      choice(`What kind of item is ${s}?`, ITEM_TYPE_CRITERIA),
    );
    set.unit(
      id,
      "generic",
      score(
        `Could ${s} be posted unchanged under many other products or posts?`,
        GENERIC_RUBRIC,
      ),
    );
    set.unit(
      id,
      "specific",
      noul(
        `Does ${s} mention a concrete detail, such as a measurement, a use case, a problem or a comparison?`,
      ),
    );
  }
  return set;
}

export const PADDING_LABELS = [
  "Almost none",
  "Some",
  "About half",
  "Mostly filler",
];
