---
name: twt-write-as-me
category: voice
description: (v1.0.6) Generate or rewrite text in the author's own voice using their writing-style profile
version: 1.0.6
accepts_arguments: true
inputs:
  - What to write, or the text/file path to rewrite
  - Optional `--profile <path>` to use a profile outside the default location
  - Optional `--mode preserve|author|free` to control how much of the source's own structure survives a rewrite (default `author`)
  - Optional `--register <name>` to pick a context register defined in the profile
  - Optional `--medium`, `--effort`, `--function` to set a context axis explicitly instead of inferring it
  - Optional `--fidelity full|natural|clean` to control how much of the author's error behavior gets reproduced (default `natural`)
  - Optional `--report` to append the style audit; without it the response is the text alone
dependencies:
  hard: []
  soft:
    - twt-write-as-me-analysis
reads:
  - $ARGUMENTS
  - .twt-artifacts/write-as-me/writing-style-profile.md
  - the file to rewrite, when one is given
writes:
  - the file given as input, when the input is a file (rewritten in place)
  - a sibling `<name>.as-me.<ext>` beside the input file, when the user picks that option
---

# /twt-write-as-me

## Intent

**Purpose:** Produce text that reads as if the author described in `writing-style-profile.md` wrote it themselves. When there is a source text, the target is **author reconstruction**, not sentence-by-sentence paraphrase:

> The author read the source, understood it, and then wrote the same idea themselves.

Not:

> The source was paraphrased sentence by sentence and then decorated with the author's stylistic markers.

The second is the failure this skill is built to avoid, and it is the *comfortable* failure — it passes every surface metric. Sentence median matches, signature words appear, punctuation matches, rates land inside their bands, every fact survives — and the piece still reads as the original AI text wearing the author's clothes. Matching the surface is necessary and nowhere near sufficient.

**Non-goals:** the objective is explicitly **not** any of these, and pursuing them is how this skill fails:
- perfect English
- professional editing
- maximum clarity
- maximum conciseness
- native-level phrasing
- generic "humanization" — nothing is stripped because it "sounds like AI"; things are stripped because the profile shows this author does not do them
- random imperfection
- local paraphrase of the source

This skill also does not build or update the profile (that is `/twt-write-as-me-analysis`), does not invent facts to fill out a draft, and does not silently drop content the reader needs.

**Fidelity is to the voice, not to the error rate.** A profile built from raw chat measures how the author writes when they are typing fast and not re-reading. Replaying those rates into a piece the user is about to send produces a caricature: the reader sees the misspellings and the dropped words first, and the voice second. So by default this skill writes **the author with their English corrected** — same composition, same words, same directness, without the errors they would have caught themselves. `--fidelity full` is how you ask for the raw behavior on purpose; it is not the default.

**Success criteria** — the first two outrank everything below them:

- **The reconstruction test.** Put the source and the output side by side. The output should look like the author independently wrote about the same information — not like the source was locally paraphrased. If a reader could align the two texts paragraph by paragraph, the run failed.
- **The stripped-markers test.** Delete every surface marker from the output — the signature words, the punctuation habits, the contractions. What is left must still resemble the author in *what it chose to say*, *what order it said it in*, *how abstract it is*, and *how far it explains*. If what is left is the source's composition in neutral prose, the run failed.
- No usable profile → the run stops and points the user at `/twt-write-as-me-analysis`, with concrete advice on how much text to feed it. It never quietly falls back to a generic voice.
- Usable profile → its directives bind the output; every "Never" is respected and no "tell of a fake" appears. A word from the negative lexicon in the delivered text is a **failed run**, not a blemish.
- Semantic invariants survive every mode: the core conclusion, the recommendations, material constraints, important numbers, names, links, dates, commitments, and meaningful uncertainty.
- Nothing is invented. No fact, number, ranking, recommendation, or certainty appears in the output that the source did not carry.
- `--fidelity` scales the author's **error** behavior without weakening anything else. The default output reads as **the author with their English corrected**, never as a simulation of the author typing fast.
- No manufactured misspellings unless the user explicitly asked for `full`. A generated typo is the one habit the reader cannot tell was deliberate, so it reads as a caricature of the author rather than as the author.
- **File in → the file is rewritten, and the response is a one-line confirmation. Text or a topic in → the response is the text, alone.** No process commentary either way unless `--report` was passed.

---

## What gets reproduced

Three separable things, and this skill has historically only been good at the third:

```
WHAT the author chooses to say      ← information selection, detail retention, abstraction
HOW the author organizes the thought ← reasoning order, evidence placement, paragraphing
HOW the author's sentences sound     ← vocabulary, punctuation, rhythm, slips
```

**The fidelity hierarchy.** When two profile-derived rules pull in different directions, the higher level wins:

```
1. Transformation fingerprint     (profile §3c — how this author rewrites someone else's text)
2. Information shaping            (profile §3b — what they keep, drop, merge, and how abstractly)
3. Reasoning / discourse flow     (profile §3)
4. Register / context axes        (profile §7)
5. Sentence architecture          (profile §2)
6. Vocabulary constraints         (profile §4 — attested sets and negative lexicon)
7. Punctuation preferences        (profile §5)
8. Rate-governed lexical markers  (profile §10 table, voice rows)
9. Slips and errors               (profile §10 table, slip rows)
```

Read that as an override order, not a checklist order. If placing `pretty` would force you to keep an AI-shaped construction, or would make the sentence less natural, **omit `pretty`** — level 2 beat level 8. Structural fidelity is always worth more than hitting a lexical frequency, because structure is what a reader recognises and frequency is what a metric recognises.

Levels 1 and 2 are also **evidence-gated like everything else in the profile**. A transformation fingerprint built on two sample pairs is Thin-band evidence; it sits at the top of the hierarchy but it is still a hint at Low confidence, not a rule. Weight each by the `[Frequency · Consistency · Context · Confidence]` suffix the profile carries, exactly as you do for §3.

---

## Bash call shape — keep every call allowlist-matchable
The permission rules `/twt-setup` seeds match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`); a call that doesn't match forces a manual prompt even when the binary is allowlisted. So for **every** Bash call in this run: never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Resolve the profile (hard gate)

Resolve the path: `--profile <path>` if given, else `.twt-artifacts/write-as-me/writing-style-profile.md`. Check with **Glob/Read**, never a shell command (CONVENTIONS §15).

**Existence is not enough — check the shape.** A file at that path may be a stub, a half-written artifact from an interrupted run, or a hand-typed "friendly, casual, concise" note, which is the exact thing the analyzer's Non-goals call a failure. Grep the file for the headings `## 10. Reproduction directives` and `## 6.`. **If either is missing, treat the profile as absent** and take the branch below. A profile that passes the gate but carries no directives produces generic prose while reporting success — the worst available outcome, because it looks like it worked.

**Then read the format line, not the headings.** A `Profile format: <n>` line sits in the profile header. Branch on that number and record it for `--report`; do not infer capability by grepping for each new heading, because every future section makes that check more brittle.

| `Profile format:` | What is available | How to run |
|---|---|---|
| `2` or higher | §3b information shaping, §3c transformation fingerprint, §7 context axes, §11c transformation calibration | Full hierarchy |
| `1`, or the line is absent | §0–§12 only | **Compatibility path** below — the run still proceeds |

**Compatibility path for a format-1 profile.** These profiles are valid and must keep working. Do not fabricate the missing sections and do not degrade to generic prose. Instead:
- **Transformation fingerprint: unavailable.** Levels 1 of the hierarchy is simply empty; level 2 becomes the top. Say so in `--report`.
- **Information shaping: inferred conservatively** from what is there — §2 paragraph shape and sentence architecture, §3 argument order and evidence placement, §8 formatting habits. Infer *tendencies* (does this author write in short paragraphs with one claim each, or long ones stacking evidence?) and nothing more. Do not invent a detail-selection rule, a metric-retention rule, or a ranking-language rule from a corpus that was never measured for them.
- Where a shaping decision has no support either way, **prefer the more compressed, less labelled option** — the untested direction is the one that recreates the source's scaffolding, and that is the failure mode this update exists to fix.
- Suggest once, in `--report` only, that re-running `/twt-write-as-me-analysis` on the same corpus would fill in §3b.

**If there is no usable profile, stop and say so.** Do not proceed with a generic voice.

Tell the user:

```
No usable writing-style profile found at <path>.

Run /twt-write-as-me-analysis first, and give it as much of your own writing as you can.
Volume and variety both matter: aim for 5+ separate pieces, 1500+ words total, across at
least two contexts (emails, chat, docs, posts, commit messages). Raw and unedited beats
polished — anything a copy-editor touched will blur the fingerprint this depends on.

If you have any text you rewrote yourself from someone else's draft — an AI draft you
fixed, a colleague's paragraph you reworked — include both versions. Those pairs are the
single most valuable thing you can give it.
```

Then offer via **AskUserQuestion** (single-select, header "Profile"):
- **Build the profile now** (recommended)
- **Point me at a profile** — plain-text prompt for a path, then re-resolve and re-check the shape
- **Cancel** — stop here
- **You decide**

**On "Build the profile now": collect the samples here, in the main thread, before dispatching.** Ask the plain-text question above and wait for the answer. Only then dispatch `/twt-write-as-me-analysis` (Agent tool, CONVENTIONS §5) with the sample paths or pasted text **embedded in the dispatch prompt**, plus `subagent-collect`. The analyzer gathers samples by asking the user, and a subagent has nobody to ask — dispatching it empty makes it stall or, worse, write a profile from nothing. When it returns, re-resolve and re-check the shape before continuing.

If the profile is usable but marked `Corpus band: Thin` or `Profile confidence: Low`, proceed — and add **one line** after the output saying fidelity will be rough and more samples would fix it. Once, one line, never before the text and never repeated on later runs in the same conversation.

## Step 2 — Determine input mode, transformation mode, and target

### 2a — What kind of input is this

Read `$ARGUMENTS` and classify:

| Input | Input mode | Output goes to |
|-------|------------|----------------|
| A path that resolves to a **prose** file | **Rewrite file** | that file, rewritten in place |
| Pasted text to rework | **Rewrite text** | chat |
| A topic, brief, or instruction ("write a follow-up to X") | **Generate** | chat |

If `$ARGUMENTS` is empty, ask one plain-text question: what to write, or what to rewrite.

If the classification is genuinely ambiguous — say a path-like string that does not resolve — ask via **AskUserQuestion** (header "Mode") rather than guessing, because the two modes differ in whether a file gets overwritten.

**Rewrite-file mode is prose-only.** Accept `.md`, `.markdown`, `.txt`, `.rst`, and front-matter-bearing content files. **Anything else — `.js`, `.css`, `.json`, `.py`, `.html` — is not prose.** Say the target is a code or data file, and offer (AskUserQuestion, header "Target"): **Rewrite only its comments and user-facing strings** · **Cancel** · **You decide**. Never treat a source file as an essay: the instruction to reconstruct "the prose inside" has no referent there, and a well-meaning rewrite of a `.js` file breaks it.

Read the file first. Before writing, confirm the overwrite via **AskUserQuestion** (header "Overwrite"): **Rewrite in place** (recommended) · **Write beside it as `<name>.as-me.<ext>`** · **Show in chat only** · **You decide**.

### 2b — How much of the source survives: `--mode`

Read `--mode` from `$ARGUMENTS`; default **`author`**.

| `--mode` | Treats the source as | Use it for |
|---|---|---|
| `preserve` | prose whose every proposition must survive at its original prominence | contracts · client commitments · technical specifications · factual reports where every detail must survive · anything going to a lawyer |
| **`author`** (default) | **source material** — facts and conclusions to be re-expressed by someone who understood them | everything else: rewriting an AI draft, a report, an analysis, a message |
| `free` | reference material only | explicit request only; the author's natural composition outranks source detail retention entirely |

`--mode` is about **structure and detail retention**. It never licenses inventing anything, and it never overrides `--fidelity`, which is a separate axis about error behavior. The two combine freely (`--mode preserve --fidelity full` is coherent).

**Generate mode ignores `--mode`** — there is no source to be faithful to. If the user supplies reference material inside a generate brief, treat that material under `author` rules.

**Never auto-escalate to `free`.** If the source resists reconstruction, that is a signal to think harder about the author's message plan, not to discard the source.

### 2c — The three preservation layers

This is the distinction the previous version of this skill collapsed, and collapsing it is what forced sentence-level paraphrase: if every proposition must survive **and** the structure is frozen, the only free variable left is wording.

**Layer 1 — Semantic invariants. Survive in every mode, always.**

The core conclusion · every recommendation · material constraints · important factual claims · important numbers · names · links · dates · commitments · meaningful uncertainty.

"Material" means: a reader acting on the output would act differently without it.

**Layer 2 — Supporting evidence. Compressible in `author`, heavily compressible in `free`, intact in `preserve`.**

The second, third and fourth data points backing a conclusion the reader has already accepted. Repeated justification. Parallel examples that make the same point.

```
Source:
  Type is 0% tokenized, there are 19 font sizes, the system defines a 10-step
  scale, and 13 values are outside the scale.

Author reconstruction:
  Type is basically not tokenized at all - 13 of 19 sizes are outside the scale.
```

Nothing was fabricated, and the reader loses nothing they would act on — even though three of the four original propositions are not stated separately. **This is allowed. It is the point.**

**Layer 3 — Rhetorical scaffolding. Normally does NOT survive `author` mode.**

Executive-summary labels · symmetrical Strength/Weakness structure · "highest-impact" · "single highest-leverage" · "most important issue" · formal transitions · a conclusion restating the conclusion · polished report parallelism · any rhetorical hierarchy the *source* introduced.

This layer gets **rebuilt from the profile**, not carried across. It survives only where the profile independently shows the author uses it (§3b's labels-and-formal-structure finding, or §8 formatting). The source is never evidence about the author.

**What every mode forbids, without exception:**
- changing the main conclusion
- inventing a fact, a number, or an example
- reversing or softening a recommendation
- removing a qualification that materially changes a claim
- turning uncertainty into certainty
- introducing a ranking the source did not make
- adding a claim, cost, question, caveat, or offer the source does not contain

That last one deserves its old warning, because it is still the most damaging thing this skill can produce. The profile records how the author *closes* a piece. Imitate that move only with material the source already carries. If the author habitually ends on an open question and the source ends on a flat assertion, the output ends on the assertion. A voice-accurate ending that says something the author never said is a fabrication wearing their handwriting, and the user will send it believing they wrote it.

The difference from the old rule is narrow and deliberate:

```
preserve meaning  ≠  preserve every sentence-level fact at equal prominence
```

An author who knows fifteen facts naturally mentions the five that carry their argument. `author` mode reproduces that selection behavior. It does not reproduce amnesia.

## Step 3 — Load the profile as binding instructions

Read the whole profile and treat it as instructions for this run, not as background reading. Section references below (`§2`, `§3b`, `§10`, …) point at the **profile's** sections, not this repo's CONVENTIONS. Extract, before drafting:

- **`## Manual overrides`** — the user's own hand-written directives. These outrank everything measured below them, including the hierarchy. Apply them first.
- **§3c transformation fingerprint** (format 2) — how this author rewrites someone else's text. Top of the hierarchy where it exists, weighted by its confidence suffix. `N/A — no pairs in corpus` is a normal and common value.
- **§3b information shaping** (format 2) — density, detail selection, metric behavior, abstraction level, technical naming, ranking language, compression, labels, evidence placement, explanation granularity.
- **§3 reasoning flow** — opening move, argument order, closing move. Weight each by its `[Frequency · Consistency · Context · Confidence]` suffix; a `Low`-confidence move is a hint, not a rule.
- **§10 Always / Never / Tells of a fake** — the hard constraints.
- **§10 rate-governed table** — the *single* source for every habit you will reproduce, with its class, nature, firing condition, rate, opportunity type, and exclusion all in one row. Read it and nothing else for this purpose.
- **§2 sentence architecture** — target median, range, opening-move distribution.
- **§4 lexicon** — the attested closed sets, the signature words with their rates, and the negative lexicon.
- **§5 punctuation** and **§8 formatting.**
- **§11 calibration passages** — read these last and closest. They are the worked examples, and matching their feel beats satisfying the rules one at a time. Match the one for your fidelity level: §11b (natural) at the default, §11a (full) only when asked. §11a's annotation is the only guide to *where* habits sit in a piece rather than how many, so read it at every level. **§11c, where it exists, is the most useful passage in the profile for a rewrite** — it is a worked source→author transformation with the drops, merges and reorderings annotated. Read it before Pass 2 and again before Pass 5.

### Pick the context: three axes, not one

The old single `register` dimension conflated *where a piece is going* with *how hard the author worked on it* and *what it is doing*. That conflation had a specific consequence: analytical content automatically inherited published-long-form behavior. Split it.

| Axis | Values the profile may define | What it governs |
|---|---|---|
| `medium` | slack · ticket · support · email · document · article | formatting, length, greeting/sign-off, emoji |
| `effort` | raw · normal · considered · proofread | slip rates, run-ons, self-correction, sentence tidiness |
| `function` | explain · evaluate · recommend · ask · complain · report · brainstorm | opening move, evidence placement, hedging, closing move |

A piece can be `medium: slack · effort: considered · function: evaluate` — an argued Slack message — and that combination behaves nothing like an off-the-cuff Slack reply or like a published article.

Use `--medium`, `--effort`, `--function` when given; `--register <name>` still works and selects a named §7 register directly. Otherwise infer each axis **separately** — inferring one from another is how the old failure came back.

**Resolution ladder when the exact combination has no evidence** (it usually will not — a real corpus cannot cover 6×4×7 cells, and the profile is required to record only the axes its samples actually separate):

1. the **invariant author core** — the §7 traits that hold in every sample. These always apply.
2. the closest attested **medium**
3. the closest attested **effort**
4. the closest attested **function**

Take supported behavior from each, and **stop there**. Never extrapolate a surface error, a slip rate, or a formatting habit into a cell the corpus never covered — an unattested cell gets the invariant core and nothing else. Which cell you resolved to, and how much of it was extrapolated, is `--report` material.

**When two readings are defensible, take the higher-effort one.** A piece that argues is almost always a piece someone will read closely, and raw-effort rates applied to a careful argument produce run-ons and dropped words in the middle of a serious case.

**Note the coverage gaps** recorded in §0. If the request falls into one, the output there is an extrapolation — record it for `--report`, and stay silent about it otherwise.

## Step 4 — Compose

### 4a — Set the fidelity level

Read `--fidelity` from `$ARGUMENTS`; default **`natural`**. It filters the §10 table by each row's **Nature**:

- **`voice`** — a habit a copy-editor would leave alone: which contraction, which dash, which intensifier, where the emoji goes, how estimates are formatted, how sentences open. The fingerprint.
- **`slip`** — a habit a copy-editor would fix: a dropped article, a missing terminal period, a run-on, an agreement error, a substituted preposition, a misspelling.

| `--fidelity` | `voice` rows | `slip` rows | `spelling` class | Use it for |
|---|---|---|---|---|
| `full` | measured tendency | stated rate | on | A deliberate reproduction of the author typing fast — private notes, or demonstrating the raw register |
| **`natural`** (default) | measured tendency | **× 0.25 of stated rate** | **off** | Everything the user will actually send. The author after correcting their English |
| `clean` | measured tendency | off | off | Formal or public writing — the voice with nothing a reader would call an error |

`habits` is accepted as a deprecated alias for `natural`.

**Why `natural` is the default.** At `full` the reader meets the errors before they meet the voice, and a manufactured misspelling is the one habit nobody can tell was deliberate. Reproducing measured error rates faithfully and producing a caricature are the same act here.

**Nature is not the same as Class.** A format-1 profile may carry only `Class`. Derive Nature yourself before drafting and write the mapping down: `lexicon` → `voice`; `spelling` → `slip`; `grammar` → `slip`; `punctuation` → **judge per row** (omitting or misplacing *required* punctuation is a `slip`; choosing between valid forms is `voice`).

Filtering happens **only here**. Everything above level 8 of the hierarchy binds at every level, and at `clean` the level 1–7 obligations get *stricter*, not looser, because composition is then carrying the whole fingerprint alone.

### 4b — The six passes

For `author` and `free` mode with a source, run all six in order. **Do not edit the source sentence by sentence at any point.**

For `preserve` mode, run passes 1, 4, 5 and 6, and in pass 3 rebuild from the ledger with every proposition retained. For `generate` mode with no source, run passes 2, 3, 4 and 6 — there is nothing to extract from and nothing to be contaminated by.

**Scale the machinery to the piece.** A two-line reply does not need six annotated passes; do them as one quick mental sweep and move on. A 400-word rewrite of an AI-written analysis is exactly what the full sequence is for. The audits in Step 5 are not optional at any length.

---

**PASS 1 — Extract meaning.** Read the source and write down, as a working note you do not show the user:

```
Core conclusion:
Important supporting facts:
Secondary evidence:
Numbers:            (every one, verbatim, with what it measures)
Names / links / dates:
Constraints:
Recommendations:
Uncertainty:        (every hedge, and what it attaches to)
```

Extract **propositions, not sentences**. Do not copy source phrasing into the ledger — if the ledger inherits the source's wording, pass 3 will too, and the whole sequence collapses back into paraphrase. Count the propositions; you need the number for `--report`.

This ledger is also the checklist Pass 6 audits against. That is why it gets written down rather than held in mind: an audit against recollection is an audit that passes.

**PASS 2 — Build the author's message plan.** Close the source. Using the profile *only* — §3c, §3b, §3, §7 — decide:

```
What would this author say first?
Which of these facts would they actually mention?
Which would they group into one statement?
What terminology would they use — implementation-level, or conceptual?
How much of the causal chain would they spell out?
How would they end?
```

Answer from the profile, not from what the source emphasised. If the source's structure is still visible in the plan, you did not close the source.

The single sharpest question, and the one that catches contamination before it happens:

> If the source's wording had disappeared and only its facts remained, would I have produced approximately this plan from the author's profile alone?

If no, plan again.

**PASS 3 — Draft from a blank page.** Write from the message plan. Not from the source, not beside the source, not by editing the source. If you find yourself looking back at the source to see how a sentence went, stop and go back to the ledger — the ledger is the only permitted input to this pass.

**PASS 4 — Apply the surface fingerprint.** Only now: punctuation preferences, contractions, casing, signature vocabulary, formatting habits, and fidelity-level slips.

**Surface fingerprint never determines information structure.** If a marker will not fit the composition you built, the composition wins and the marker is dropped. This is levels 1–3 over level 8, and it is the rule most likely to get quietly inverted, because placing markers feels like progress.

**Rate-governed lexical markers are tendencies, not quotas.** A corpus rate describes a distribution across a body of writing. It is not a per-document allocation, and treating it as one is exactly what produces text that reads as decorated rather than written. For every **`voice`** row:

1. Is there a genuine rhetorical opportunity here — a real slot where this author would reach for the word?
2. Is the word natural in *that exact sentence*?
3. Use the measured rate only as a tendency: roughly how often, across many pieces, this slot gets taken.
4. **Zero occurrences in a short or medium piece is always acceptable.** A measured `Like = 4.6/1000 words` does not mean a 250-word output owes you one.
5. **Never create a sentence, a clause, or a thought to give a signature word somewhere to live.** Manufactured opportunities are how invented content gets in, and the added material is exactly where it hides.

Across many outputs, `0, 0, 2, 0, 1, 0` is a more realistic distribution than `1, 1, 1, 1, 1, 1`. The second is what arithmetic produces; the first is what a person produces.

**`slip` rows keep stricter arithmetic**, because mechanical habits — article omission, terminal punctuation, typo classes, agreement errors, capitalization — genuinely do track opportunity counts. For each live `slip` row: count the opportunities the draft contains using that row's opportunity type, pick the rate for the resolved effort axis, multiply by the fidelity multiplier (`1.0`/`0.25`/`0`), round, and place that many at genuine opportunities. Then the same three guards: **never manufacture an opportunity**; **never force one because the expected count rounded below 1**; **short outputs may legitimately contain zero**. Rates converge over a corpus of generated text, not inside every response.

Check each row's "must NOT fire when" **per placement, against the sentence it would land in** — not once for the piece. A rule can be live for the piece and still be illegal in the specific sentence you were about to use.

**Spread placements; do not cluster.** With 8 opportunities and 4 placements, take them across the whole piece. §11a's annotation shows the shape the analyzer used.

**There is no minimum-one floor.** Earlier versions of this skill placed one marker whenever the arithmetic rounded to zero across the piece, so that short outputs would not come out sterile. That floor is **removed**: it was compensating for composition that was not being reproduced, and now that levels 1–3 carry the fingerprint, a clean short message with the author's shape and selection is fully recognisable without a marker in it. Forcing one in is the sprinkling this design exists to prevent.

**Stay inside the author's vocabulary.** §4's negative lexicon lists what the corpus proves they avoid, but it cannot enumerate every word they simply never reach for. So at any slot where you are about to place an **intensifier, an evaluative adverb, or a judgment word**, use one §4 actually attests. If the author's only intensifiers are "pretty" and "definitely", then "genuinely", "notably", "remarkably", "arguably", "surprisingly", "impressively" are all wrong — not because they are bad words, but because this person does not own them.

**Never invent a habit that is not in the §10 table**, and **never reproduce anything in §9** — those are noise the analysis explicitly demoted.

**PASS 5 — Source-contamination audit.** See Step 5b. Rewrite whatever it catches.

**PASS 6 — Meaning-integrity audit.** See Step 5c.

**Explicit user instructions win over all of this.** If the user asks for something the profile contradicts — "make this one more formal", "keep it under 100 words", "no typos" — follow the user and keep every rule the instruction does not touch. They asked for the deviation, so do not announce it back to them; record it for `--report`.

## Step 5 — Audits

Three audits, in order. One revision pass each, then ship.

### 5a — Voice audit

- **Never-list:** anything from §10 Never or the §4 negative lexicon? Remove it. **A negative-lexicon word surviving into the delivered text is a failed run** — treat it as a blocker and redraft the sentence, not as a note.
- **Tells of a fake:** walk the §10 list item by item against the actual draft — the em-dash clause pair, the tricolon, the tidy summarizing close. Cut what you find.
- **Vocabulary audit:** every intensifier, evaluative adverb and judgment word — attested in §4, or reached for because it fit? Replace anything the author does not own. Apply this to **phrases as well as words**: "single highest-leverage fix", "largest single share", "most important accessibility decision", "breaks down worst", "genuinely good". For each distinctive evaluative phrase, ask **would this author independently reach for this?** If it is not supported by the attested sets, the transformation fingerprint, or repeated samples, replace it with a construction they actually use. A source phrase must not survive merely because it is valid English.
- **Rate audit:** for each live `slip` row, recount opportunities and placements. Inside the band after the multiplier? For `voice` rows, check the weaker question instead: does every placement sit at a genuine opportunity in a sentence that reads naturally with it? A `voice` marker that is defensible only by arithmetic gets cut.
- **Exclusion audit — per placement.** Reread the sentence each placement landed in against that row's "must NOT fire when".
- **Suppression audit:** at `natural` or `clean`, read the draft once looking *only* for misspelled words. The count must be zero — including a misspelling you produced from memory of the author rather than from the table, which is the form it actually takes.
- **Sentence metrics:** median near §2's? Is the *variance* right? Uniform sentence length is itself a tell.
- **Manual overrides:** every one honoured?

### 5b — Source-contamination audit (`author` and `free` modes with a source)

Compare the draft **against the source**, not only against the profile. A rewrite can be grammatically unrecognisable and still carry the source's stylistic fingerprint — and when the source is AI-generated, that fingerprint is the thing the user asked you to remove.

Flag and rewrite anything that survived only because it was in the source:

- the same paragraph count, or paragraphs that align one-to-one
- the same sentence order
- the same opening phrase or opening move
- the same rhetorical labels (`Strength`, `Weakness`, `Critical assessment`, `Key takeaway`, `Highest-impact fix`)
- the same sequence of supporting arguments
- the same distinctive abstract nouns
- the same ranking language
- the same conclusion structure, or a conclusion restating an already-stated conclusion
- the same repeated emphasis
- the same unusual phrase combinations

**Run the mechanical check.** It measures what judgment is worst at:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/write-as-me-contamination.mjs" --source <source-path> --output <draft-path>
```

Write both to the scratchpad first if they are not already files. It reports shared n-grams with examples, paragraph and sentence counts on both sides, numbers in the output that are absent from the source, numbers in the source that the output dropped, and any source rhetorical labels that survived. A non-zero exit means at least one hard signal fired. Treat every shared 6-gram that is not a proper noun, a quoted phrase, or a fixed technical term as contamination and rewrite that sentence. If the tool is unavailable (a global install without bundled tools), do the audit by reading — do not skip it.

**Then the self-check question**, which catches what the tool cannot:

> If the source wording had disappeared and only its facts remained, would I still have produced approximately this structure from the author's profile?

If no, go back to Pass 2 and reconstruct again. Not to Pass 4 — a contaminated structure cannot be fixed at the surface.

### 5c — AI-rhetoric pass

Where the source was AI-generated, specific patterns survive reconstruction because they feel like content rather than style. Inspect for:

`Critical assessment` · `Crucially` · `Highest-impact fix` · `single highest-leverage` · `largest single share` · `where it breaks down worst` · tidy Strength/Weakness symmetry · repeated superlative ranking · executive-summary compression · abstract noun stacking · polished three-part parallelism · a conclusion restating the conclusion.

**This is an inspection list, not a ban list, and the distinction is load-bearing.** Remove a pattern only when the profile gives no support for it. The source is *never* evidence that the author uses a phrase. Equally, if §3b or §8 shows the author does use numbered sections or does rank things explicitly, those stay — this pass is not generic de-AI-ing, and turning it into a global blocklist would break the same evidence discipline the rest of the skill runs on.

### 5d — Meaning-integrity audit (every mode with a source)

Audit the draft **against the Pass 1 ledger**, item by item — not against your memory of the source, and not by rereading the source, which invites re-contamination.

- **Layer-1 invariants:** walk the ledger's conclusion, recommendations, constraints, numbers, names, links, dates, commitments and uncertainty. Is each one either present in the draft, or *deliberately* compressed into a statement that carries it? Anything neither present nor carried is a **drop**, and a Layer-1 drop is a blocker.
- **Nothing invented:** does any sentence introduce a claim, number, recommendation, cost, question or offer the ledger does not contain? Delete it. Pay closest attention to the **final one or two sentences**, where an imitated closing move invents content.
- **Nothing strengthened.** A claim can be invented inside a sentence whose substance is genuinely the source's, and it hides better there. Check every evaluative word in both directions:
  - **Ranking the source did not make.** "well designed" → "the strongest part"; "a problem" → "the biggest problem". Superlatives are claims.
  - **Certainty the source did not carry.** "may", "looks like", "probably" → a flat assertion. Where the source hedged, the output hedges.
  - **Scope the source did not claim.** "several pages" → "every page"; "one cause" → "the cause".
  - **Compression that changes force.** Merging two hedged findings into one flat statement strengthens both. Layer-2 compression must preserve the modality of what it compresses.
- **Contradiction check:** does the compression imply anything the source contradicts elsewhere?

Record for `--report`: propositions in the ledger, retained explicitly, merged, dropped as redundant supporting evidence.

**If a Layer-1 invariant cannot be fitted into the author's natural composition, the invariant wins.** Say it the author's way at whatever length that takes. Losing a commitment to fit a rhythm is the worst trade available here.

### 5e — The two success tests

Last, and above every check before them:

1. **Reconstruction.** Source and output side by side — does the output look like the author wrote independently about the same information, or like the source paraphrased? If a reader could align them paragraph by paragraph, go back to Pass 2.
2. **Stripped markers.** Mentally delete every signature word, punctuation habit and contraction. Does what remains still resemble the author in selection, ordering, abstraction and reasoning? If what remains is the source's composition in neutral prose, go back to Pass 2.

Both failures are Pass-2 failures. Neither is fixable in Pass 4, and attempting to fix them there produces exactly the decorated paraphrase this skill exists to prevent.

## Step 6 — Deliver

**Rewrite-text and Generate modes:** the response is the finished text, and only the finished text. No preamble, no "here's your text in your voice", no framing line above it, no summary below it. Start at the first word of the piece.

**Rewrite-file mode:** write the file (Edit or Write per the Step 2 choice), then say in one or two lines what happened to it — the path, and whether it was rewritten in place or written beside the original. That confirmation *is* the response; do not also paste the text back.

### Say nothing else

**The deliverable is the writing. By default the response contains the text and nothing else.**

The audits are work you do, not work you show. The user called this skill to get a piece of writing, not a report on how it was made — and every line of process commentary pushes the thing they actually wanted further up the scrollback.

So, unless `--report` was passed, **do not** print: the profile path, the format number, the confidence band, the resolved axes, the `--mode`, the `--fidelity` level, which rules fired, how many opportunities there were, what rounded to zero, sentence medians, structural choices, or why any of it was right.

Two things still surface without being asked for, because both are about the content rather than the process. Each is **one line**, after the text, after a blank line — no header, no elaboration:

- **A content-integrity flag** — you deliberately left something the user would otherwise send unknowingly: a factual contradiction in the source, a claim you doubted, a number that disagrees with another number.
- **A material-drop flag** — `author` or `free` mode dropped or merged something a reader might have expected to survive. Name what, in a clause. Compression is the point of `author` mode, but the user is about to send this under their own name and silent removal is not theirs to discover later. Routine Layer-2 compression does not earn a line; something a careful reader would miss does.

Nothing else ever earns an unsolicited line.

### With `--report`

Append the audit below the text, after a `---` separator.

**Header block:**

```
profile: <path> · format <1|2> · corpus band <Thin|Workable|Solid> · confidence <High|Medium|Low>
mode: <preserve|author|free>          fidelity: <full|natural|clean>
medium: <v> (given|inferred|invariant-core only)
effort: <v> (given|inferred|invariant-core only)
function: <v> (given|inferred|invariant-core only)
transformation fingerprint: used (<confidence>) | unavailable — format 1 profile | N/A — no pairs in corpus
information shaping: measured | inferred conservatively from §2/§3/§8
sentence median: <n> over <n> measured
```

**Transformation block** (`author` and `free` modes only):

```
Source propositions: 18
Retained explicitly: 10
Merged: 6
Dropped as redundant supporting evidence: 2
Core semantic invariants preserved: PASS
Source-style contamination audit: PASS (shared 6-grams: 0)
Negative-lexicon audit: PASS
```

**Rules block:** one line per fired rule — `R<n> <name> [<nature>] — <placed>/<opportunities>` for `slip` rows with their multiplier, `R<n> <name> [voice] — <placed> (tendency <rate>/1000)` for `voice` rows. Then one line naming what the fidelity level suppressed, and one naming rules with opportunities that were deliberately left untaken.

No per-rule commentary and no explanation of rules that behaved normally. **Do not expose internal reasoning** — the report states observable transformation decisions and validation results, never the deliberation behind them.
