---
name: twt-write-as-me-analysis
category: voice
description: (v1.0.2) Extract a reproducible writing-fingerprint profile from the author's own text samples
version: 1.0.2
accepts_arguments: true
inputs:
  - Writing samples — file paths, a folder, `--from <path>`, or pasted text
  - Optional `--profile <path>` to write the profile somewhere other than the default
  - Optional `--label <name>` to name the author the profile represents
dependencies:
  hard: []
  soft:
    - twt-content-fetch
reads:
  - $ARGUMENTS
  - the writing samples the user names (project-relative paths or pasted text)
  - .twt-artifacts/write-as-me/writing-style-profile.md
  - .twt-artifacts/write-as-me/evidence-log.md
writes:
  - .twt-artifacts/write-as-me/writing-style-profile.md
  - .twt-artifacts/write-as-me/evidence-log.md
---

# /twt-write-as-me-analysis

## Intent

**Purpose:** Analyze texts written by one author and extract a detailed, operational model of how that person actually writes — the individual fingerprint, including intentional stylistic choices *and* recurring unintentional habits — so that another model can later reproduce the voice without ever seeing the original samples.

**Non-goals:**
- **Does not evaluate whether the writing is good or bad.** No quality score, no "areas for improvement", no editorial verdict.
- **Does not correct grammar.** Imperfections are evidence, not errors. They are measured and documented, never fixed.
- **Does not produce a tone-of-voice blurb.** "Friendly, casual, concise" is a failure of this skill, not an output of it.
- Does not generate or rewrite text in the author's voice — that is `/twt-write-as-me`.
- Does not fetch samples from URLs, PDFs, or Figma. Run `/twt-content-fetch` first to turn those into Markdown, then point this skill at the result.
- Does not read anything outside the current project, and never searches the disk for writing samples (CONVENTIONS §14). It reads exactly the paths the user names.

**Success criteria:**
- The profile is built **from an evidence log first** — every trait in every summary section traces back to counted observations, and no section is written before the log exists.
- Every characteristic in profile sections 1 through 8 carries four attributes: **frequency**, **consistency**, **context-dependence**, and **confidence**.
- Every measurement is one a careful reader can actually make and show: counts with a stated denominator and quoted instances. Nothing is estimated and then presented as measured.
- Recurring habits are documented as **rate-governed firing rules** (when it fires, at what rate, where it must *not* fire) — never as a vague label like "sometimes drops articles" — and every such rule is copied into the single self-contained §10 table that the generator reads.
- The profile explicitly separates **style** from **noise**, and states what a generator must **never** do.
- The final self-check in Step 7 passes all six questions before the profile is returned.

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Gather the samples

Parse `$ARGUMENTS` for:
- `--from <path>` — a project-relative file or folder holding the samples
- `--profile <path>` — write the profile there instead of the default
- `--label <name>` — what to call the author (default: `the author`)
- `subagent-collect` — this run was dispatched by another skill and **has no user to ask**
- Anything else — sample material, classified by the rules below

**Classify each remaining argument. Never silently downgrade one kind into another:**

| Shape | Action |
|-------|--------|
| A path that resolves | Read it as a sample |
| Path-shaped but does not resolve (`./nots.md`, `docs/draft.txt`) | **Stop. Report that the path was not found.** Never analyze the path string as if it were prose — a 12-character filename is not a writing sample |
| Starts `http://` or `https://` | **Stop.** Point the user at `/twt-content-fetch` to convert it to Markdown first, then re-run against the result |
| Multi-line free text | Pasted sample |

Read samples with **Read / Glob / Grep**, never a shell command (CONVENTIONS §15). If a folder is given, Glob it for `*.md`, `*.txt`, and any extension the user names, then Read each. **If the Glob returns nothing, stop and say the folder held no readable samples** — do not proceed to banding with zero samples.

If no samples arrive in `$ARGUMENTS`:
- **Dispatched (`subagent-collect` present):** **stop immediately** and report that samples must be supplied in the dispatch prompt. Do not prompt — there is no user on the other end — and above all do not write a profile from nothing. A profile built on no evidence is the worst artifact this skill can produce, because everything downstream trusts it.
- **Interactive:** ask **one plain-text question** (free-form input, so not AskUserQuestion — CONVENTIONS §4):

```
Paste your writing samples, or give me file paths / a folder.

The more you give me, the sharper the profile — and variety matters as much as volume.
Ideally 5+ separate pieces, 1500+ words total, across at least two different contexts
(e.g. emails, chat messages, docs, posts, commit messages). Raw and unedited is better
than polished — anything someone else copy-edited will blur your actual fingerprint.
```

**Sample hygiene.** Before analyzing, exclude anything not authored by this person: quoted replies, forwarded text, boilerplate signatures, pasted documentation, code blocks, and template-generated content. Note every exclusion in the evidence log — a profile built partly on someone else's prose is worse than no profile. **If hygiene removes everything** (the user pasted a forwarded thread, say), stop and explain what was excluded and why; do not write a profile.

Then band the corpus, because it caps every confidence rating downstream:

| Corpus | Band | Confidence ceiling |
|--------|------|--------------------|
| 1 sample, or under 300 words | Thin | **Low** — profile is provisional, mark it so |
| 2–4 samples, 300–1500 words | Workable | **Medium** |
| 5+ samples, 1500+ words, 2+ contexts | Solid | **High** |

Tell the user the band now, before spending effort. If **Thin**, say plainly that the profile will be provisional and offer (AskUserQuestion, header "Corpus"): **Add more samples** · **Proceed provisionally** (recommended when the user has no more to give) · **You decide**. When dispatched, skip the question, proceed provisionally, and say so in the report.

## Step 2 — Resolve paths and detect refinement mode

Resolve the profile path: `--profile <path>` if given, else `.twt-artifacts/write-as-me/writing-style-profile.md`. **The evidence log is always its sibling** — `<profile-dir>/evidence-log.md` — so an override keeps the pair together.

If the resolved path falls **outside `.twt-artifacts/`**, confirm it with the user before writing (CONVENTIONS §2 allows a user-confirmed target, not an unconfirmed one). When dispatched, refuse the override and use the default.

If a profile already exists there, Read it **and its sibling evidence log**, then ask via **AskUserQuestion** (single-select, header "Profile"):
- **Refine** (recommended) — merge the new samples into the existing evidence base
- **Rebuild** — discard the old profile and analyze the new samples alone
- **Cancel** — leave the profile untouched
- **You decide**

When dispatched (`subagent-collect`), do not ask: default to **Refine** and record the choice in the report. Never overwrite an existing profile without that consent.

**How to merge in Refine mode.** The old samples are usually gone, so do not attempt to re-derive anything from them. The surviving denominators are in profile §1 and in the evidence log:
- **Sum the columns.** An existing `14/31` plus a new `6/12` becomes `20/43` (47%). Never average the percentages, and never replace an old count with a new one.
- Promote observations that now clear the two-occurrence threshold; demote ones the new samples contradict, and say so in the log.
- Recompute consistency and confidence from the *combined* totals, against the *combined* corpus band.

**Never rewrite the `## Manual overrides` section.** That section (defined in Step 6) is the user's, and it is the only durable way to tell a hand-edited line from one a previous run wrote. If a fresh measurement contradicts an override, keep the override, apply it, and record the disagreement in the evidence log — never silently revert the user's tuning.

## Step 3 — Evidence pass (build the observation log FIRST)

**Do not jump to a summary. Do not form an impression and then hunt for support.** This step produces counts; the interpretation happens in Step 4.

Read every sample twice. On the second pass, count. Record everything into the evidence log as you go — **write that file before writing any part of the profile.**

The evidence log is the full working record: every count with its quoted instances, every hygiene exclusion, every merge disagreement, and the observations that did not survive promotion. Profile §1 is the promoted subset of it — the rows that cleared the threshold. Wherever this skill says "record it in the log", it means the evidence log.

**Quote verbatim, always.** The single largest failure mode here is silently normalizing the author's text while reading it — mentally inserting the missing article, straightening the run-on, fixing the capitalization — and then reporting the corrected version as the observation. Copy the exact characters, including the mistakes, the spacing, and the missing punctuation.

Section references below (`§2`, `§6`, `§10`, …) point at the **profile** sections defined in Step 6, not this repo's CONVENTIONS.

**Only claim measurements you can actually make and show.** You are reading, not running a tokenizer. That constrains what may appear in the profile:

- **Permitted:** counts of discrete, findable things (occurrences of a word, sentences with no terminal period, lowercase sentence openings) — each recorded as `numerator/denominator` with the instances quoted in the log so anyone can check them.
- **Permitted:** a median and a typical range computed over an **explicitly recorded set** of sentences — quote the sentences you measured in the log and state how many. Measuring 25 sentences and saying so beats claiming to have measured 200.
- **Forbidden:** percentiles, distributions, and any statistic over the whole corpus you did not actually enumerate.
- **Forbidden:** rates for features with no countable denominator — "opportunities to hedge" is not something you can count, so hedging is described qualitatively in §3 and never as a percentage.

An invented number is worse than an absent one, because the generator will target it and the self-check will bless it.

Measure at minimum:

**Sentence and paragraph metrics** — median word count and typical range over your recorded sentence set; the longest and shortest actual sentence, quoted; sentences per paragraph; count of one-sentence paragraphs; ratio of prose lines to list items.

**Rate-based features.** For anything that *could* have happened but didn't always, count **occurrences over opportunities**, not raw occurrences. "Drops the definite article 14 times" is unusable. "Drops the definite article in 14 of 31 opportunities (45%)" is a reproduction rule. This applies to article omission, contraction use, serial commas, terminal periods, capitalized sentence openings, and everything destined for §5, §6, or the §10 table.

**Candidate features to count** (not exhaustive — add what the samples actually show):
sentence openers by type · connectors and how clauses are joined · comma splices and run-ons · dash type and spacing · semicolons and colons · ellipses · terminal punctuation, including its absence · capitalization habits and lapses · list punctuation · signature words and phrases with counts **and a per-1000-words rate** · discourse markers and fillers · contractions · spelling variants and consistent misspellings · number and date formatting · emphasis mechanisms · pronoun and person preference · verb tense and voice · question forms · greetings and sign-offs · typo classes that repeat · **repetition habits** — restating the same point twice in a piece, reusing a distinctive word inside one paragraph, recurring sentence-shape parallelism.

**Promotion threshold — this is what "prefer repeated evidence" means mechanically:**

- **Trait** (goes into §2–§8): ≥2 occurrences across ≥2 samples. In a single-sample corpus, ≥3 occurrences, and confidence caps at Medium.
- **Noise** (goes into §9): exactly 1 occurrence, or explainable by the topic/medium rather than the person.

Rate each promoted trait:

- **Consistency** — `Consistent` (fires in ≥80% of opportunities) · `Variable` (20–79%) · `Rare` (<20% but repeated)
- **Context-dependent** — `No` (holds across every sample) · `Yes: <which contexts>` (name them)
- **Confidence** — `High` (≥5 occurrences across ≥3 samples, no counter-examples) · `Medium` (2–4 occurrences, or consistent within ≤2 samples) · `Low` (at threshold, or contradicted somewhere). Never exceed the Step 1 corpus ceiling.

## Step 4 — Derive the trait sections from the log

Only now, with counts in hand, write §2–§8 of the profile. Every claim must cite the log. If you catch yourself writing a trait you cannot point at a count for, delete it — that is your own impression leaking in, and it is exactly what makes these profiles produce generic output.

**Every bullet in §2, §3, §4, §5 and §8 ends with the attribute suffix** `[Frequency · Consistency · Context · Confidence — O<n>]`. This is not decoration. §3 in particular is what the generator leans on for structure, and without the suffix a one-off opening move gets imitated with the same conviction as the fingerprint core.

Two derivations need explicit method:

**Negative lexicon (§4).** Find it two ways. *Absence:* common words and constructions the author had clear opportunity to use and never did. *Contrast:* for a handful of the author's actual sentences, write how a competent generic model would have phrased the same thing, and record the differences — those are the words to ban.

**Tells of a fake (§10).** Take the standard register of LLM prose and check each item against the samples, keeping only the ones the author genuinely never does: em-dash-balanced clause pairs · "It's not just X, it's Y" · rule-of-three lists · "Let's dive in" / "In today's fast-paced world" · a tidy topic sentence opening every paragraph · uniformly even paragraph lengths · hedging softeners before every claim · a summarizing final sentence that restates the opening · flawless article and preposition use · bolded key phrases scattered through prose. Do not assume — if the author does use tricolons, that belongs in §2, not here.

## Step 5 — Registers, noise, and the calibration passage

**Registers (§7).** Group samples by context and find what shifts (length, formality, punctuation, sign-offs) versus what holds everywhere. The invariants are the fingerprint core — say so explicitly, because a generator working in an unseen context has only those to go on. If the corpus covers one context only, say that and mark every other register unknown.

**Noise (§9).** List the demoted one-offs, plus anything attributable to the medium or the topic rather than the person. This section exists so a future generator does not reproduce them.

**Calibration passage (§11).** Write one short paragraph (60–120 words) in the author's voice on a neutral topic not covered by the samples, then annotate it line by line with which rule fired where — including which imperfections you placed, why those spots, and **how you spread them across the passage**. This is the worked example that makes the profile usable once the samples are gone, and it is the generator's only guide to *placement* as opposed to *count*.

## Step 6 — Write the profile

Write to the resolved profile path, in exactly this structure:

```
# Writing style profile — <label>

Generated by: /twt-write-as-me-analysis
Last updated: <YYYY-MM-DD>
Corpus: <n> samples · ~<words> words · contexts: <list>
Corpus band: Thin | Workable | Solid
Profile confidence: High | Medium | Low — <one line: what the band and diversity support>

## Manual overrides

<Empty on a fresh run. Anything the USER writes here outranks every measured directive
below, and a later run of this skill must never rewrite it.>

## 0. Evidence base

| Sample | Context / genre | ~Words | Source |
|--------|-----------------|--------|--------|
| S1 | <e.g. Slack message> | <n> | <path or "pasted"> |

Sentences actually measured for the §2 metrics: <n> (quoted in the evidence log)
Excluded from analysis: <quoted replies, signatures, code, or "none">
Coverage gaps: <contexts NOT represented — the profile is untested there and must not be assumed to hold>

## 1. Observation log

Promoted observations only; the full working record is in the sibling evidence-log.md.

| # | Observation (verbatim where possible) | Samples | Occurrences / opportunities | Consistency | Context-dependent | Confidence |
|---|---------------------------------------|---------|------------------------------|-------------|-------------------|------------|
| O1 | <what was actually seen> | S1, S3 | 14/31 (45%) | Variable | No | High |

## 2. Sentence architecture

Every bullet ends with `[Frequency · Consistency · Context · Confidence — O<n>]`.

- **Length:** median <n> words over <n> measured sentences; typical range <n>–<n>; longest observed <n> ("<quote>"); shortest <n> ("<quote>")
- **Openings:** <how sentences start, with counts per type>
- **Clause joining:** <connectors, comma splices, run-ons, fragments — with rates>
- **Paragraph shape:** <sentences per paragraph, one-liner frequency, list-vs-prose ratio>
- **Rhythm and repetition:** <alternation, parallelism, restatement of a point, word reuse inside a paragraph — or their absence>

## 3. Reasoning and discourse flow

Same attribute suffix on every bullet.

- **Opening move:** <claim-first? context-first? question? apology? straight into the ask?>
- **Argument order:** <how the case is built and where evidence lands>
- **Assertion vs hedge:** <which claims get softened, which are stated flat — qualitative, never a percentage>
- **Disagreement and correction:** <how the author pushes back, concedes, or corrects>
- **Digression:** <parentheticals, self-interruption, asides>
- **Closing move:** <call to action, trailing thought, abrupt stop, no close at all>

## 4. Lexicon

Same attribute suffix on every bullet.

- **Signature words and phrases:** <verbatim · raw count · rate per 1000 words>
- **Discourse markers and fillers:** <verbatim · raw count · rate per 1000 words>
- **Register and jargon density:** <observed, not judged>
- **Contractions, abbreviations, casing of terms:** <rates>
- **NEGATIVE LEXICON — never uses:** <words and constructions with clear opportunity and zero occurrences>

## 5. Punctuation and typography

Same attribute suffix on every bullet.

<commas · dashes (type and spacing) · semicolons · colons · ellipses · terminal punctuation
including omission · capitalization habits and lapses · list punctuation · quotes · emoji ·
spacing · consistent misspellings — each with occurrences/opportunities>

## 6. Grammar and L1-transfer fingerprint

Rate-governed. A generator applies these at the stated rate at genuine opportunities — never uniformly, never at random, never by dice roll.

| ID | Pattern | Fires when | Rate | Example (verbatim) | Must NOT fire when |
|----|---------|-----------|------|--------------------|--------------------|
| R1 | <e.g. definite article omitted> | <before abstract singular nouns in subject position> | 45% | "<quote>" | <in fixed phrases like "the same"; after a preposition> |

## 7. Context registers

| Register | Shifts | Evidence |
|----------|--------|----------|
| <e.g. chat> | <shorter, no terminal periods, lowercase openings> | S1, S2 |

**Invariant across every register (the fingerprint core):** <list — these are the only rules that carry into an unseen context>

## 8. Formatting and document habits

Same attribute suffix on every bullet.

<headings · bolding · lists (bullets vs numbers) · code fences · links · typical document
length · how instructions or steps get structured>

## 9. Noise — explicitly NOT style

<one-off observations, and anything caused by the medium or the topic rather than the person.
Do not reproduce these.>

## 10. Reproduction directives

### Always
- <directive>

### Never
- <directive>

### Rate-governed

THE GENERATOR READS ONLY THIS TABLE. It must be self-contained: copy each rule's firing
condition and exclusion verbatim rather than cross-referencing another section, because a
paraphrase here silently breaks the exclusion guard.

One row for every §6 pattern, every §5 feature that carries a rate, and every §4 signature
phrase or filler (expressed per 1000 words). A habit that is not in this table will not be
reproduced.

Every row carries a **Class**, which is what lets the generator's `--fidelity` setting
suppress error-shaped habits without touching voice:
`grammar` (§6 L1-transfer and syntax patterns) · `punctuation` (§5 rated features) ·
`lexicon` (§4 signature phrases and fillers) · `spelling` (consistent misspellings and
repeated typo classes). Classify by what a reader would perceive, not by source section.

| ID | Class | Rule | Fires when | Rate | Opportunity type | Must NOT fire when |
|----|-------|------|-----------|------|------------------|--------------------|
| R1 | grammar | <verbatim from §6/§5/§4> | <condition> | 45% | <what counts as one opportunity> | <exclusion> |

### Tells of a fake — a generator doing any of these has failed
- <thing a generic model would do that this author demonstrably never does>

## 11. Calibration passage

<60–120 words in the author's voice on a neutral topic>

**Rules that fired:** <line-by-line annotation: which rules, where, and how they were spread
across the passage rather than clustered>

## 12. Self-check

| Question | Verdict | Where satisfied |
|----------|---------|-----------------|
| Could another model reproduce sentence structure from this alone? | PASS/FAIL | §2, §11 |
| Could it reproduce the reasoning flow? | PASS/FAIL | §3 |
| Could it reproduce the imperfections without randomly degrading the text? | PASS/FAIL | §10 table, §6 |
| Does the profile distinguish style from noise? | PASS/FAIL | §9 |
| Does it describe what NOT to do? | PASS/FAIL | §4, §10 |
| Are High-confidence claims backed by repeated evidence? | PASS/FAIL | §1 |
```

## Step 7 — Final quality check (must pass before you report)

Reread the profile **as if the samples had been deleted** — that is the actual usage condition. Answer the six questions in §12 honestly:

1. **Sentence structure reproducible?** FAIL if §2 says "varied sentence length" instead of naming a median, a range, and how many sentences were measured to get them.
2. **Reasoning flow reproducible?** FAIL if §3 describes what the author writes about rather than how they move from one idea to the next, or if its bullets lack the attribute suffix.
3. **Imperfections reproducible without random degradation?** FAIL if any row of the §10 rate-governed table lacks a class, a firing condition, a rate, an opportunity type, or a must-not-fire column — or if any §6 pattern, rated §5 feature, or §4 signature phrase is missing from that table. This is the check most likely to be skimmed, and a half-filled table makes the generator sprinkle errors at random, which is the worst possible output.
4. **Style separated from noise?** FAIL if §9 is empty on a corpus of 3+ samples. Real corpora always contain one-offs; an empty §9 means the promotion threshold was not applied.
5. **What not to do described?** FAIL if the negative lexicon or the tells-of-a-fake list is empty.
6. **High confidence earned?** FAIL if any `High` sits on fewer than 5 occurrences across 3 samples, or exceeds the Step 1 corpus ceiling.

Then one check that is not in §12, because it catches fabrication rather than omission: **every number in the profile must trace to quoted instances in the evidence log.** Any rate you cannot point at instances for gets deleted or downgraded to prose — do not keep it because it looks precise.

Fix every FAIL inline and re-check. Only report once all six read PASS — or, where the corpus genuinely cannot support one (a Thin single-context corpus cannot support §7), mark it `N/A — corpus`, state that in the profile, and say so in the report.

## Step 8 — Report

Tell the user:
- The profile path and the evidence-log path
- Corpus band, sample count, word count, contexts covered — and the coverage gaps
- The 3–5 most distinctive fingerprint traits found, each with its rate and confidence
- Anything demoted to noise that they might have expected to see as a trait
- Any §12 row marked `N/A — corpus`, and what samples would fix it
- In Refine mode: what was merged, what got promoted or demoted, and any Manual-overrides disagreement recorded
- Next step: `/twt-write-as-me <your text or file>`
