---
name: twt-write-as-me-analysis
category: voice
description: (v1.0.1) Extract a reproducible writing-fingerprint profile from the author's own text samples
version: 1.0.1
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
- Every important characteristic carries four attributes: **frequency**, **consistency**, **context-dependence**, and **confidence**.
- Recurring grammatical imperfections are documented as **rate-governed firing rules** (when it fires, at what rate, where it must *not* fire) — never as a vague label like "sometimes drops articles".
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
- Anything else — treat as file paths if they resolve, otherwise as pasted sample text

Read samples with **Read / Glob / Grep**, never a shell command (CONVENTIONS §15). If a folder is given, Glob it for `*.md`, `*.txt`, and any extension the user names, then Read each.

If no samples arrive in `$ARGUMENTS`, ask **one plain-text question** (free-form input, so not AskUserQuestion — CONVENTIONS §4):

```
Paste your writing samples, or give me file paths / a folder.

The more you give me, the sharper the profile — and variety matters as much as volume.
Ideally 5+ separate pieces, 1500+ words total, across at least two different contexts
(e.g. emails, chat messages, docs, posts, commit messages). Raw and unedited is better
than polished — anything someone else copy-edited will blur your actual fingerprint.
```

**Sample hygiene.** Before analyzing, exclude anything not authored by this person: quoted replies, forwarded text, boilerplate signatures, pasted documentation, code blocks, and template-generated content. Note every exclusion in the evidence log — a profile built partly on someone else's prose is worse than no profile.

Then band the corpus, because it caps every confidence rating downstream:

| Corpus | Band | Confidence ceiling |
|--------|------|--------------------|
| 1 sample, or under 300 words | Thin | **Low** — profile is provisional, mark it so |
| 2–4 samples, 300–1500 words | Workable | **Medium** |
| 5+ samples, 1500+ words, 2+ contexts | Solid | **High** |

Tell the user the band now, before spending effort. If **Thin**, say plainly that the profile will be provisional and offer (AskUserQuestion, header "Corpus"): **Add more samples** · **Proceed provisionally** (recommended when the user has no more to give) · **You decide**.

## Step 2 — Detect refinement mode

Resolve the profile path: `--profile <path>` if given, else `.twt-artifacts/write-as-me/writing-style-profile.md`.

If a profile already exists there, Read it and ask via **AskUserQuestion** (single-select, header "Profile"):
- **Refine** (recommended) — merge the new samples into the existing evidence base, recompute every frequency and rate across the combined corpus, promote traits that now clear the threshold, demote ones the new samples contradict
- **Rebuild** — discard the old profile and analyze the new samples alone
- **Cancel** — leave the profile untouched
- **You decide**

Never overwrite an existing profile without that consent. In **Refine**, preserve any section the user has hand-edited: if a directive in §10 contradicts your fresh measurement, keep the user's line and record the disagreement in the evidence log rather than silently reverting it.

## Step 3 — Evidence pass (build the observation log FIRST)

**Do not jump to a summary. Do not form an impression and then hunt for support.** This step produces counts; the interpretation happens in Step 4.

Read every sample twice. On the second pass, count. Record everything into `.twt-artifacts/write-as-me/evidence-log.md` as you go.

**Quote verbatim, always.** The single largest failure mode here is silently normalizing the author's text while reading it — mentally inserting the missing article, straightening the run-on, fixing the capitalization — and then reporting the corrected version as the observation. Copy the exact characters, including the mistakes, the spacing, and the missing punctuation.

Measure at minimum:

Section references below (`§2`, `§6`, `§10`, …) point at the **profile** sections defined in Step 6, not this repo's CONVENTIONS.

**Sentence and paragraph metrics** — total sentences; word-count median, 10th and 90th percentile, and the longest and shortest actual sentence (quoted); sentences per paragraph; count of one-sentence paragraphs; ratio of prose lines to list items.

**Rate-based features.** For anything that *could* have happened but didn't always, count **occurrences over opportunities**, not raw occurrences. "Drops the definite article 14 times" is unusable. "Drops the definite article in 14 of 31 opportunities (45%)" is a reproduction rule. This applies to article omission, contraction use, serial commas, terminal periods, capitalized sentence openings, hedges, and every item in §6.

**Candidate features to count** (not exhaustive — add what the samples actually show):
sentence openers by type · connectors and how clauses are joined · comma splices and run-ons · dash type and spacing · semicolons and colons · ellipses · terminal punctuation, including its absence · capitalization habits and lapses · list punctuation · signature words and phrases with raw counts · discourse markers and fillers · contractions · spelling variants and consistent misspellings · number and date formatting · emphasis mechanisms · pronoun and person preference · verb tense and voice · question forms · greetings and sign-offs · typo classes that repeat.

**Promotion threshold — this is what "prefer repeated evidence" means mechanically:**

- **Trait** (goes into §2–§8): ≥2 occurrences across ≥2 samples. In a single-sample corpus, ≥3 occurrences, and confidence caps at Medium.
- **Noise** (goes into §9): exactly 1 occurrence, or explainable by the topic/medium rather than the person.

Rate each promoted trait:

- **Consistency** — `Consistent` (fires in ≥80% of opportunities) · `Variable` (20–79%) · `Rare` (<20% but repeated)
- **Context-dependent** — `No` (holds across every sample) · `Yes: <which contexts>` (name them)
- **Confidence** — `High` (≥5 occurrences across ≥3 samples, no counter-examples) · `Medium` (2–4 occurrences, or consistent within ≤2 samples) · `Low` (at threshold, or contradicted somewhere). Never exceed the Step 1 corpus ceiling.

## Step 4 — Derive the trait sections from the log

Only now, with counts in hand, write §2–§8 of the profile. Every claim must cite the log. If you catch yourself writing a trait you cannot point at a count for, delete it — that is your own impression leaking in, and it is exactly what makes these profiles produce generic output.

Two derivations need explicit method:

**Negative lexicon (§4).** Find it two ways. *Absence:* common words and constructions the author had clear opportunity to use and never did. *Contrast:* for a handful of the author's actual sentences, write how a competent generic model would have phrased the same thing, and record the differences — those are the words to ban.

**Tells of a fake (§10).** Take the standard register of LLM prose and check each item against the samples, keeping only the ones the author genuinely never does: em-dash-balanced clause pairs · "It's not just X, it's Y" · rule-of-three lists · "Let's dive in" / "In today's fast-paced world" · a tidy topic sentence opening every paragraph · uniformly even paragraph lengths · hedging softeners before every claim · a summarizing final sentence that restates the opening · flawless article and preposition use · bolded key phrases scattered through prose. Do not assume — if the author does use tricolons, that belongs in §2, not here.

## Step 5 — Registers, noise, and the calibration passage

**Registers (§7).** Group samples by context and find what shifts (length, formality, punctuation, sign-offs) versus what holds everywhere. The invariants are the fingerprint core — say so explicitly, because a generator working in an unseen context has only those to go on. If the corpus covers one context only, say that and mark every other register unknown.

**Noise (§9).** List the demoted one-offs, plus anything attributable to the medium or the topic rather than the person. This section exists so a future generator does not reproduce them.

**Calibration passage (§11).** Write one short paragraph (60–120 words) in the author's voice on a neutral topic not covered by the samples, then annotate it line by line with which rule fired where — including which §6 imperfections you placed and why those spots. This is the worked example that makes the profile usable once the samples are gone.

## Step 6 — Write the profile

Write to the resolved profile path, in exactly this structure:

```
# Writing style profile — <label>

Generated by: /twt-write-as-me-analysis
Last updated: <YYYY-MM-DD>
Corpus: <n> samples · ~<words> words · contexts: <list>
Corpus band: Thin | Workable | Solid
Profile confidence: High | Medium | Low — <one line: what the band and diversity support>

## 0. Evidence base

| Sample | Context / genre | ~Words | Source |
|--------|-----------------|--------|--------|
| S1 | <e.g. Slack message> | <n> | <path or "pasted"> |

Excluded from analysis: <quoted replies, signatures, code, or "none">
Coverage gaps: <contexts NOT represented — the profile is untested there and must not be assumed to hold>

## 1. Observation log

| # | Observation (verbatim where possible) | Samples | Occurrences / opportunities | Consistency | Context-dependent | Confidence |
|---|---------------------------------------|---------|------------------------------|-------------|-------------------|------------|
| O1 | <what was actually seen> | S1, S3 | 14/31 (45%) | Variable | No | High |

## 2. Sentence architecture

- **Length:** median <n> words; typical range <n>–<n>; longest observed <n> ("<quote>"); shortest <n> ("<quote>")
- **Openings:** <how sentences start, with % of each type>
- **Clause joining:** <connectors, comma splices, run-ons, fragments — with rates>
- **Paragraph shape:** <sentences per paragraph, one-liner frequency, list-vs-prose ratio>
- **Rhythm:** <alternation, repetition, parallelism — or its absence>

Each bullet ends with: `[Frequency · Consistency · Context · Confidence — O<n>]`

## 3. Reasoning and discourse flow

- **Opening move:** <claim-first? context-first? question? apology? straight into the ask?>
- **Argument order:** <how the case is built and where evidence lands>
- **Assertion vs hedge:** <which claims get softened, which are stated flat>
- **Disagreement and correction:** <how the author pushes back, concedes, or corrects>
- **Digression:** <parentheticals, self-interruption, asides>
- **Closing move:** <call to action, trailing thought, abrupt stop, no close at all>

## 4. Lexicon

- **Signature words and phrases:** <verbatim, with counts>
- **Discourse markers and fillers:** <verbatim, with counts>
- **Register and jargon density:** <observed, not judged>
- **Contractions, abbreviations, casing of terms:** <rates>
- **NEGATIVE LEXICON — never uses:** <words and constructions with clear opportunity and zero occurrences>

## 5. Punctuation and typography

<commas · dashes (type and spacing) · semicolons · colons · ellipses · terminal punctuation
including omission · capitalization habits and lapses · list punctuation · quotes · emoji ·
spacing · consistent misspellings — each with a rate>

## 6. Grammar and L1-transfer fingerprint

Rate-governed. A generator applies these at the stated rate at genuine opportunities — never uniformly, never at random, never by dice roll.

| Pattern | Fires when | Rate | Example (verbatim) | Must NOT fire when |
|---------|-----------|------|--------------------|--------------------|
| <e.g. definite article omitted> | <before abstract singular nouns in subject position> | 45% | "<quote>" | <in fixed phrases like "the same"; after a preposition> |

## 7. Context registers

| Register | Shifts | Evidence |
|----------|--------|----------|
| <e.g. chat> | <shorter, no terminal periods, lowercase openings> | S1, S2 |

**Invariant across every register (the fingerprint core):** <list — these are the only rules that carry into an unseen context>

## 8. Formatting and document habits

<headings · bolding · lists (bullets vs numbers) · code fences · links · typical document
length · how instructions or steps get structured>

## 9. Noise — explicitly NOT style

<one-off observations, and anything caused by the medium or topic rather than the person.
Do not reproduce these.>

## 10. Reproduction directives

### Always
- <directive>

### Never
- <directive>

### Rate-governed
| Rule | Rate | Applies to |
|------|------|-----------|
| <from §6> | <n>% | <opportunity type> |

### Tells of a fake — a generator doing any of these has failed
- <thing a generic model would do that this author demonstrably never does>

## 11. Calibration passage

<60–120 words in the author's voice on a neutral topic>

**Rules that fired:** <line-by-line annotation, including which §6 imperfections were placed and why there>

## 12. Self-check

| Question | Verdict | Where satisfied |
|----------|---------|-----------------|
| Could another model reproduce sentence structure from this alone? | PASS/FAIL | §2, §11 |
| Could it reproduce the reasoning flow? | PASS/FAIL | §3 |
| Could it reproduce the imperfections without randomly degrading the text? | PASS/FAIL | §6, §10 |
| Does the profile distinguish style from noise? | PASS/FAIL | §9 |
| Does it describe what NOT to do? | PASS/FAIL | §4, §10 |
| Are High-confidence claims backed by repeated evidence? | PASS/FAIL | §1 |
```

## Step 7 — Final quality check (must pass before you report)

Reread the profile **as if the samples had been deleted** — that is the actual usage condition. Answer the six questions in §12 honestly:

1. **Sentence structure reproducible?** FAIL if §2 says "varied sentence length" instead of naming a median and a range.
2. **Reasoning flow reproducible?** FAIL if §3 describes what the author writes about rather than how they move from one idea to the next.
3. **Imperfections reproducible without random degradation?** FAIL if any §6 row lacks a firing condition, a rate, or a must-not-fire column. This is the row most likely to be half-filled, and a half-filled row makes the generator sprinkle errors at random — the worst possible output.
4. **Style separated from noise?** FAIL if §9 is empty on a corpus of 3+ samples. Real corpora always contain one-offs; an empty §9 means the promotion threshold was not applied.
5. **What not to do described?** FAIL if the negative lexicon or the tells-of-a-fake list is empty.
6. **High confidence earned?** FAIL if any `High` sits on fewer than 5 occurrences across 3 samples, or exceeds the Step 1 corpus ceiling.

Fix every FAIL inline and re-check. Only report once all six read PASS — or, where the corpus genuinely cannot support one (a Thin single-context corpus cannot support §7), mark it `N/A — corpus`, state that in the profile, and say so in the report.

## Step 8 — Report

Tell the user:
- The profile path and the evidence-log path
- Corpus band, sample count, word count, contexts covered — and the coverage gaps
- The 3–5 most distinctive fingerprint traits found, each with its rate and confidence
- Anything demoted to noise that they might have expected to see as a trait
- Any §12 row marked `N/A — corpus`, and what samples would fix it
- Next step: `/twt-write-as-me <your text or file>`
