# Every question Jev is asked

Unslop never asks Jev to rewrite anything. It asks narrow questions, and plain
code turns the answers into edits. This is the full catalog, in the wording
that ships. The source of truth is [`server/src/jev/questions.ts`](server/src/jev/questions.ts);
the thresholds that act on the answers are in [`server/src/config.ts`](server/src/config.ts).

Three shapes of question:

| Shape | Answer | Used as |
| --- | --- | --- |
| **yes/no** (`noul`) | a probability from 0 to 1 | a signal compared to a threshold |
| **choice** | a label, plus confidence and per-label probabilities | a category, gated on confidence |
| **score** | an expected position on an ordered rubric, plus confidence | a number on a 0–3 scale |

Sentences are named by path — `` `sentences.s3` `` — so Jev knows exactly which
one to judge. Sentence IDs are global across the text, so a redundancy group
spanning a paragraph still reads as `sentences.s4`.

Three rules from TypeSafe's docs shape the design: pack many questions into
one request (they share state and run in parallel), keep state small (a
paragraph and its neighbours, never the whole article), and ask one snap
judgment per question — "is this slop?" is never asked directly.

---

## Stage 0 — router

*One request. Pasted text only; a URL is detected by regex and skips this.
State is the first 2,000 characters.*

**`input_kind`** · choice

> What is this text?

| Option | Description given to Jev |
| --- | --- |
| `one_continuous_piece_of_writing` | A single article, draft, post or document. |
| `list_of_separate_short_items` | Several short items by different authors, such as reviews or comments. |
| `email_or_message` | A message with a greeting and a sign-off. |
| `code_or_data` | Source code, logs, JSON, CSV or similar. |
| `other` | — |

Picks writing mode, list mode or the email preset. Code or data is refused.

---

## Stage 1 — page gate

*One request over the whole text. State is `{ title, paragraphs: { p0, p1, … } }`.*

**`genre`** · choice

> What kind of writing is this?

Options: `news_or_explainer_article`, `recipe`, `how_to_guide`, `blog_post`,
`documentation`, `email`, `product_page`, `marketing_copy`, `fiction`,
`poetry`, `speech`, `other`.

Fiction, poetry and speech get flags only — repetition there is usually
deliberate. Recipe, how-to, documentation, explainer, product page and blog
post are *goal-directed*: the reader arrived wanting something, and they get
the extra `on_topic` question in Stage 2. Email is deliberately not in that
set, because in an email the writer is often the point.

**`padding`** · score

> How much of this text is filler rather than information?

Rubric: `Almost none` · `Some` · `About half` · `Mostly filler`. Shown as the
headline in the report.

**`first_substance`** · choice

> Which paragraph is the first to give the reader real information rather than setup?

Options are the paragraph IDs. Paragraphs before it become intro-cut
candidates, if Jev is at least 70% confident and most of their sentences
qualify for deletion on their own.

**`outro_restates`** · yes/no

> Does the last paragraph only restate points made earlier in the text?

Above 0.8, and with nothing specific in it, the closing paragraph is cut.

---

## Stage 2 — paragraph pass

*One request per paragraph, all in parallel behind a concurrency gate of eight.
State is `{ title, previous_paragraph, sentences: { s4, s5, … }, next_paragraph }`.
Every question below is asked about every sentence in the paragraph, in the
same request.*

**`adds_info`** · yes/no · *the main signal for deletion*

> Does `sentences.sN` give the reader a specific fact, number, name, example, step or instruction that no other sentence here or in `previous_paragraph` already gives?

| Outcome | Description given to Jev |
| --- | --- |
| yes | It names something concrete the reader did not already have. |
| no | It is setup, summary, hedging or a general observation that leaves the reader knowing nothing new. |

**`filler_type`** · choice · *tint colour and report label*

> What kind of sentence is `sentences.sN`?

| Option | Description given to Jev |
| --- | --- |
| `substantive` | It carries information, an argument, an example or an instruction. |
| `throat_clearing_opener` | It sets up what is coming without saying anything itself. |
| `empty_summary` | It summarises without naming anything specific. |
| `restatement` | It repeats a point already made in different words. |
| `stacked_hedging` | It piles up qualifiers such as 'may sometimes potentially'. |
| `hype` | It praises or dramatises without evidence. |
| `not_just_x_but_y` | It uses the 'not just X but Y' formula. |
| `rhetorical_question` | It asks a question it does not expect answered. |
| `signpost` | It announces the next section, such as "let's dive in". |
| `generic_platitude` | It states something obvious that almost anyone would agree with. |

**`generic`** · score · *tiebreaker*

> Could `sentences.sN` appear unchanged in many other texts on different topics?

Rubric: `Only fits this text` · `Mostly specific` · `Fairly generic` · `Fits anywhere`.

**`specific`** · yes/no · *protects a sentence from cuts*

> Does `sentences.sN` contain a concrete number, name, date, example or instruction?

**`load_bearing`** · yes/no · *blocks cuts that would break the flow*

> Would deleting `sentences.sN` make the next sentence unclear, for example because it refers back with "this" or "these"?

**`repeats_prev`** · yes/no · *builds the redundancy groups for Stage 3*

> Does `sentences.sN` make the same point as `sentences.sN−1`?

Asked for every sentence except the first in a paragraph.

**`on_topic`** · yes/no · *goal-directed genres only*

> Does `sentences.sN` tell the reader something about the subject of `title` itself, rather than about the writer, their history, or their feelings?

| Outcome | Description given to Jev |
| --- | --- |
| yes | It describes the subject, or tells the reader how to do something. |
| no | It is about the writer, their past, their opinions or their enthusiasm. |

This is the question that clears a recipe blog's life story. "I originally
published this recipe in 2013" passes every other test — it states a fact, it
names a date, Jev calls it substantive — and it is still not what the reader
opened the page for.

**`swap_K`** · yes/no · *one per phrase-table hit*

Code finds each phrase by regex first; Jev only approves or rejects the swap in
context. Two wordings, depending on whether the table replaces or deletes:

> In `sentences.sN`, can "in order to" be replaced with "to" without changing the meaning or breaking the grammar?

> In `sentences.sN`, can "in today's fast-paced world" be removed without changing the meaning or breaking the grammar?

Swap checks are asked speculatively, even for sentences that may be cut,
because extra questions in a request are nearly free.

### The delete rule, for reference

A sentence is cut when **all four** agree: `adds_info` < 0.2, `specific` < 0.3,
`load_bearing` < 0.5, and `filler_type` is not `substantive` with confidence
≥ 0.6. On a goal-directed page it is also cut when `on_topic` < 0.5 and
`load_bearing` < 0.5. Anything short of either rule with `adds_info` < 0.5 is
flagged, never cut. A swap lands when `swap_K` > 0.8.

---

## Stage 3 — redundancy picks

*One request per group of two or more adjacent sentences with `repeats_prev` > 0.7.
State is `{ sentences: { s2, s3, s4 } }` for the group.*

**`best`** · choice

> Which sentence states this point most clearly and specifically?

Options are the group's sentence IDs. Above 0.5 confidence the winner stays
and the rest are cut; below it the whole group is kept and flagged.

---

## Stage 4 — edit check

*One request per paragraph that changed. State is `{ title, original, edited }`.
Paragraphs a Stage 1 rule removed wholesale, and paragraphs nothing survived
in, are skipped — comparing against an empty string loses every fact by
definition.*

**`lost_info`** · yes/no

> Does `original` contain a fact or claim that `edited` no longer contains?

On a goal-directed page the wording is scoped to what the reader came for:

> Does `original` tell the reader something they need in order to make or use `title`, that `edited` no longer tells them?

**`reads_ok`** · yes/no

> Does `edited` read as grammatical, coherent prose?

**`tone_kept`** · yes/no

> Does `edited` keep the same tone and point of view as `original`?

If `lost_info` > 0.5 or `reads_ok` < 0.5, the paragraph's cuts come back —
and become flags, so the reader still sees what Jev doubted. `tone_kept` is
shown in the report.

---

## List mode — item pass

*One request per 20 items. Items are split on blank lines in code. State is
`{ items: { i0, i1, … } }`.*

**`useful`** · yes/no · *the main signal for ranking*

> Does `items.iN` give specific, first-hand or factual information a reader could act on?

**`item_type`** · choice · *the label on collapsed items*

> What kind of item is `items.iN`?

| Option | Description given to Jev |
| --- | --- |
| `substantive` | It reports something the writer actually observed or did. |
| `generic_praise_or_complaint` | It praises or complains without saying what about. |
| `engagement_bait` | It exists to provoke replies, likes or shares. |
| `self_promotion` | It promotes the writer, their product or their channel. |
| `restates_topic` | It restates the topic without adding anything. |
| `template_boilerplate` | It reads as a filled-in template. |

**`generic`** · score

> Could `items.iN` be posted unchanged under many other products or posts?

Rubric: `Only fits here` · `Mostly specific` · `Fairly generic` · `Fits anywhere`.

**`specific`** · yes/no · *protects specific items from collapsing*

> Does `items.iN` mention a concrete detail, such as a measurement, a use case, a problem or a comparison?

### The slop score, for reference

Computed in code: `0.5 × (1 − useful) + 0.3 × (generic ÷ 3) + 0.2 × (item_type ≠ substantive ? 1 : 0)`.
An item collapses when the score is ≥ 0.6 and `specific` < 0.5.

---

## Budget

A 600-word article takes about 200 judgments in about 20 requests. A
230-word email took 113 judgments in 12 requests; an 1,800-word recipe page
took 272 in 21. Every question in a request shares its state, so adding a
question costs tokens but almost no time.

## What tuning taught

The thresholds above barely moved. Every change that mattered was a question
wording, because Jev answers the words written, not the intent:

- **`adds_info`** originally asked whether a sentence "states a fact, claim,
  example, step or detail". A platitude does state a claim, so it scored 0.94
  and the delete gate never opened. Asking whether it *gives the reader*
  something specific separated slop (0.02–0.27) from substance (0.71–0.98).
- **Deletion swaps** were asked as "can X be replaced with nothing", which
  reads as a trick question. Asking whether X can be *removed* lands.
- **`lost_info`** reverted every off-topic cut, because dropping "I published
  this in 2013" does lose a fact. Scoping it to "the subject" changed nothing
  — 0.95 either way. Asking what the reader *needs in order to make the thing*
  gives 0.29–0.40 on those paragraphs against 0.97 on one that really had lost
  its oven temperature.
- **`on_topic`** did not exist. No threshold on the existing questions could
  separate a recipe's life story from its method; only a new question could.
  It splits into two clusters with a wide gap: 0.08–0.45 for the life story,
  0.95–0.97 for the recipe.

Phrase every question positively and concretely. Jev struggles with double
negatives, and "not X" questions were the ones that misfired.
