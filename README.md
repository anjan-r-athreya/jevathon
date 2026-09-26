# Unslop

Strips AI slop from anything you read or write: web pages, your own drafts, and
short-form content like reviews, posts and emails.

Every judgment is made by **Jev**, TypeSafe's System One model. No LLM runs
anywhere. Jev can't generate text, so Unslop edits only by subtraction: delete,
swap from a fixed phrase table, keep the best of a redundant group, or flag.
Every word in the output came from the original or the phrase table.

**The hook: the only de-slopper that can't add slop.**

Unslop judges quality, not authorship. It asks "is this doing any work?", never
"did an AI write this?" — AI-text detectors are unreliable and produce false
positives, especially on writing by non-native English speakers. Slop is filler,
empty summaries and generic phrasing, and humans write plenty of it too.

## Three modes, one engine

| Mode | Input | What you get |
| --- | --- | --- |
| **Web** | A URL | The original screenshot beside a clean reader view. Headings, lists, tables, code and quotes are protected, so a recipe keeps its ingredients and steps. |
| **Writing** | A draft | The cleaned text, a diff, and a report. Every cut has a reason and restores with one click. Emails keep their greeting and sign-off. |
| **List** | Short items, blank-line separated | A slop score and filler label per item. Sloppy ones collapse to one line; useful ones rise to the top. |

Jev picks the mode; a toggle overrides it.

## Setup

```bash
npm install
cp .env.example .env   # add TYPESAFE_API_KEY
```

`TYPESAFE_API_KEY` is the only required key. Web mode also wants
`BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` — without them it falls back
to a plain `fetch`, which most publisher sites refuse with a 403 and which never
produces a screenshot.

```bash
npm run dev          # server on :8787, web app on :5173
```

Run one of them on its own with `npm run dev:server` or `npm run dev:web`.

### Tuning from the terminal

The thresholds in [`server/src/config.ts`](server/src/config.ts) are starting
guesses. Tune them against real inputs without the UI in the way:

```bash
npx tsx server/src/cli.ts path/to/draft.txt --verbose
```

`--verbose` prints every judgment with its confidence, which is the fastest way
to see whether a question is being read the way you meant it.

## How it works

One TypeScript server runs the whole pipeline. Inputs are normalised to plain
text, Jev makes every judgment, and ordinary code applies the edits.

```
  paste text ─┐
  URL ────────┼──▶ extract ──▶ Jev decisions ──▶ edit planner ──▶ clean text
  (Browserbase)│    and split    (4 stages,        (plain code)     and report
               │                  parallel)              │
                                       └──────────────────┴──▶ live decision panel
```

Jev never touches the text. It returns typed judgments, and the planner turns
them into edits only when confidence clears a threshold.

### The decision chain

A 600-word article takes about 200 judgments across roughly 20 requests, with
every paragraph judged in parallel. Three rules from TypeSafe's docs shape it:

- **Pack many questions into one request.** Questions sharing a state run in
  parallel, so extra questions barely add time. Each paragraph gets one request
  carrying every question about its sentences.
- **Keep state small.** Sentence judgments see only their paragraph plus its
  neighbours, never the whole article.
- **One snap judgment per question.** "Is this slop?" is broken into narrow
  questions, and code combines the answers.

| Stage | Requests | Asks |
| --- | --- | --- |
| 0 · router | 1 (pasted input only) | `input_kind` |
| 1 · page gate | 1, whole text | `genre`, `padding`, `first_substance`, `outro_restates` |
| 2 · paragraph pass | 1 per paragraph, parallel | `adds_info`, `filler_type`, `generic`, `specific`, `load_bearing`, `repeats_prev`, plus one per phrase-table hit |
| 3 · redundancy | 1 per group of adjacent repeats | `best` |
| 4 · edit check | 1 per edited paragraph | `lost_info`, `reads_ok`, `tone_kept` |
| list | 1 per 20 items | `useful`, `item_type`, `generic`, `specific` |

Sentences are referenced by path in the instructions — `` `sentences.s3` `` — so
Jev knows exactly which one to judge.

### Edit rules

The planner only cuts when several signals agree. A sentence goes when
`adds_info` is low, it names nothing concrete, nothing after it depends on it,
and `filler_type` is confidently not "substantive". Anything short of that is
flagged rather than cut.

**Never cut:** headings, list items, tables, code blocks and quotes; the
greeting and sign-off in the email preset; anything at all when the genre is
fiction, poetry or speech, where repetition is usually deliberate.

### Questions matter more than thresholds

Tuning against a slop-heavy email draft moved two questions and no thresholds:

- `adds_info` originally asked whether a sentence "states a fact or claim". A
  platitude does state a claim, so it scored 0.94 and the delete gate never
  opened. Asking whether the sentence *gives the reader* something specific
  separated it cleanly — slop landed at 0.02–0.27, substance at 0.71–0.98.
- Phrases the table deletes were asked whether they could be "replaced with
  nothing", which reads as a trick question. They now ask about removal.

Jev answers the words written, not the intent. That is the single biggest
lever in this codebase.

## Cost

At $0.042 per million input tokens with output free, a 230-word email costs
about $0.0006 — a fraction of a cent, for 113 judgments in under a second. The
counter in the UI computes this live from each response's token usage.

## Layout

```
server/src/
  pipeline.ts        the run: routing, stages, planner passes, SSE events
  planner.ts         the edit rules — plain code, no model calls
  config.ts          every threshold, in one place
  phrases.ts         the phrase table and its regex finder
  segment.ts         paragraph, sentence and item splitting with stable IDs
  jev/questions.ts   every question Jev is asked, in one file
  jev/client.ts      the only thing that talks to Jev
  fetch/             Browserbase loading and Readability extraction
web/src/
  App.tsx            three columns, the input box and the counters
  model.ts           folds the event stream into one view per unit
```

## Tests

```bash
npm test
```

Covers the parts that must not drift: the segmenter's protected blocks and
stable IDs, the phrase table's matching and capitalisation, and every branch of
the edit rules. The model is not called.
