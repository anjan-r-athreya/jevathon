# Unslop — two-minute demo script

Three inputs, one per mode, ending on the "can't add slop" line. Numbers below
are from real runs on 26 Sep 2026; they move a little between runs, so read
them off the screen, not off this page.

## Pre-flight (five minutes before)

- [ ] `npm run dev` — both servers up, `http://localhost:5173` open.
- [ ] Window at least 1,100px wide, so the three columns are side by side.
- [ ] Press **Padded recipe page** once now. This warms the Browserbase cache,
      so if the network dies on stage the replay is ready and instant.
- [ ] Reload the page so the columns are empty when you start.
- [ ] "Clean view" unchecked (it is by default).
- [ ] Have `data/demo/2-writing.json` and `3-list.json` open somewhere in case
      you want to paste by hand instead of pressing the demo button.

## The script

### 0:00 — Title screen (15s)

> The internet is filling up with slop. Everyone's answer is another LLM to
> rewrite it — which adds more. We used a model that can't write.
>
> Every judgment you're about to see is Jev, TypeSafe's System One model.
> No LLM runs anywhere. Jev can't generate a word, so Unslop can only
> *subtract*: delete, swap from a fixed table, keep the best of a redundant
> group, or flag. Every word in the output came from the input.

### 0:15 — Web mode (40s)

**Click:** `Padded recipe page`.

While Browserbase loads (10–13 seconds — this is the only wait in the demo,
so fill it):

> That's Browserbase loading a real recipe blog, the kind where the recipe is
> at the bottom of a life story. The chip says **live** — it's happening now.
> Ingredients, steps, and reader quotes are protected: Jev never sees them.
> Only the prose gets judged.

The moment the panel starts scrolling, point at it:

> Every row is one snap judgment — which sentence, which question, the
> answer, how sure Jev was, and how long it took. Amber means Jev said
> "not sure". About 270 decisions in around ten seconds.

Point at the left column as it tints:

> Sentences colour by what kind of filler they are, then fade as the
> planner cuts them.

Point at the result once it lands:

> The life story is gone. The list is still a list. Read the counter:
> six hundred prose words down to four hundred forty — a quarter cut — and
> 1,200 protected words that were never touched.

Open **Report**, point at the cut reasons:

> Every cut has a reason from a fixed list. "About the writer rather than the
> subject the reader came for." That reason was never generated — it's a
> label the code chose.

If a paragraph shows under **Reverted by the edit check**, use it — it's a
feature:

> And here Jev's own edit check thought a cut lost something the reader
> needed, so it put the sentences back as flags instead. Over-cutting is the
> one thing that would sink this on stage, so several signals have to agree
> before anything goes.

### 0:55 — Writing mode (30s)

**Click:** `Slop-heavy email draft`.

It finishes in about a second, so narrate over the result:

> Same engine, a draft instead of a page. Watch the phrase table: "in order
> to" becomes "to", "In today's fast-paced world" is gone, "In conclusion" is
> gone. Those replacements come from a sixteen-entry table, not from a model.

Hover the underlined "to":

> Hover shows what it was.

Click a struck-through sentence:

> One click brings any cut back, and the counter moves with it.

Point at an amber-underlined sentence:

> Amber underline is a flag: Jev wasn't sure, so we didn't cut. We flag
> instead of guess.

Point at the greeting and sign-off:

> Email preset — the greeting and the sign-off are never touched.

### 1:25 — List mode (20s)

**Click:** `15 product reviews`.

> Fifteen reviews, eight generic, seven specific. Two requests, under a
> second.

Point at the top of the result:

> "The strap broke after three weeks" rises. "Great product, highly
> recommend" collapses. Each one gets a slop score from four questions and a
> label.

Click a collapsed row to expand it:

> Nothing is deleted — collapsed items are one click away.

### 1:45 — Close (15s)

Point at the bottom bar on whichever run is showing, then say the totals:

> Across those three runs: about four hundred fifty decisions, fifteen
> seconds, a quarter of a cent. And zero generated words.
>
> It's the only de-slopper that can't add slop.

## If something goes wrong

**Web mode is slow or fails.** The demo button already handles it: after
18 seconds without a live page it replays the cached fetch and the chip turns
to **replay**. Say so, don't hide it:

> That's a replay of a fetch from earlier — the network's slow. Everything
> Jev does from here is live.

Jev's judgments are *always* live; only the page fetch replays.

**Jev is rate-limited (rows stop, then resume).** The SDK is retrying with
backoff. Say: "TypeSafe's limits are shifting under demand this week — it's
retrying." Requests run eight at a time behind a gate.

**Someone asks you to paste their own URL.** Fine, but a page behind a cookie
wall or bot check will refuse with a clear message rather than judge the
wall. A 404 says "that page is an error page, not an article". If it's a
blank page, you'll get "no article on it". None of these are crashes.

**Someone pastes code.** It's refused: "Unslop only judges prose."

## Questions you'll get

**"Isn't this just an AI detector?"**
No — it never asks "did an AI write this". It asks "is this sentence doing
any work". Detectors are unreliable and flag non-native English; humans write
plenty of slop too. Quality, not authorship.

**"How do you know it didn't lose a fact?"**
Four signals must agree before a cut, `specific` and `load_bearing` each veto
alone, and then Stage 4 re-reads every edited paragraph and reverts if
something the reader needed is missing. You saw one revert live.

**"What did tuning look like?"**
Honest answer: thresholds barely moved. Every fix that mattered was a
question wording. `adds_info` asked whether a sentence "states a fact" — a
platitude does, so it scored 0.94. Asking whether it *gives the reader*
something specific separated slop from substance cleanly. Jev answers the
words written, not the intent.

**"Why is it fast / cheap?"**
Each paragraph is one request carrying every question about its sentences,
and they run in parallel. Jev prices at $0.042 per million input tokens,
output free. A 600-word article is about two thousandths of a cent.

**"Does it work on other languages?"**
English is Jev's strongest language. We demo in English and say so.

**"What's next?"**
Text a link or a draft over iMessage and get the clean version back
(Photon). Run list mode on a reviews page directly. A strictness slider.
