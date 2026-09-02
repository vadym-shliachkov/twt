---
name: twt-write-as-me-analysis
surface: command
category: voice
family: voice
role: tool
unit: twt-write-as-me
description: (v1.0.6) Extract a reproducible writing-fingerprint profile from the author's own text samples
version: 1.0.6
accepts_arguments: true
inputs:
  - Writing samples — file paths, a folder, `--from <path>`, or pasted text
  - Optional **paired samples** — a source text plus the author's own rewrite of it, marked up as `## Pair N` / `### Source` / `### Author version`
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

The model has to cover three separable things, and the third is the easiest and the least valuable on its own:

```
WHAT the author chooses to say      → §3b information shaping
HOW the author organizes the thought → §3, §3b
HOW the author's sentences sound     → §2, §4, §5, §6, §10
```

A profile that measures only the third produces text that reads as someone else's composition wearing this author's vocabulary. §3b and §3c exist to stop that, and they are the sections `/twt-write-as-me` weights most heavily.

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
- **§3b information shaping is measured, not asserted** — how many claims land in a sentence, which supporting evidence survives, how metrics are treated, how abstract the language runs, whether the author ranks things explicitly. Every finding carries counts like every other section.
- **§3c transformation fingerprint is built only from paired samples.** With no pairs it reads `N/A — no source → author pairs in corpus` and nothing is inferred. A transformation rule guessed from unpaired writing is fabrication, and it sits at the top of the generator's priority order where fabrication does the most damage.
- The final self-check in Step 7 passes all nine questions before the profile is returned.

---

## Bash call shape — keep every call allowlist-matchable
The permission rules `/twt-setup` seeds match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`); a call that doesn't match forces a manual prompt even when the binary is allowlisted. So for **every** Bash call in this run: never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

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
| Text containing `### Source` and `### Author version` under a `## Pair <n>` heading | **Paired sample** — see below |

**Paired samples are the highest-value evidence this skill can receive, and the rarest.** A pair is a text the author did *not* write, plus the author's own rewrite of it. It is the only direct evidence of how this person transforms someone else's material into their own — which is exactly what `/twt-write-as-me` does on every rewrite. Everything else in the corpus shows what the author writes; only a pair shows what they *change*.

Recognise a pair in any clearly marked form. The canonical one:

```markdown
## Pair 1

### Source
<the text the author did not write>

### Author version
<what the author turned it into>
```

`Original` / `Mine`, `Before` / `After`, `Draft` / `Rewritten` are equally acceptable as long as which side is which is unambiguous. **If it is ambiguous, ask** — analyzing a pair backwards inverts every transformation rule derived from it, and the resulting profile actively teaches the generator to make text *more* formal.

Count pairs separately from samples in the evidence base. The `Author version` side also counts as an ordinary sample for §2–§8 purposes; the `Source` side is **never** analyzed as authorial writing, and must be excluded from every count, every rate, and every quoted example. Record that exclusion explicitly.

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

One thing is worth more than all of it: any text you rewrote yourself from someone
else's draft. An AI draft you fixed before sending, a colleague's paragraph you
reworked, a doc you rewrote from a template. Give me BOTH versions, marked like this:

## Pair 1
### Source
<what you started from>
### Author version
<what you sent>

Two or three of those tell me more about how you write than another 2000 words of
finished text, because they show what you change, not just what you produce.
Places to look: your sent mail, a doc's version history, a PR description you
rewrote, anything you pasted into an AI and then fixed.
```

**Sample hygiene.** Before analyzing, exclude anything not authored by this person: quoted replies, forwarded text, boilerplate signatures, pasted documentation, code blocks, and template-generated content. Note every exclusion in the evidence log — a profile built partly on someone else's prose is worse than no profile. **If hygiene removes everything** (the user pasted a forwarded thread, say), stop and explain what was excluded and why; do not write a profile.

Then band the corpus, because it caps every confidence rating downstream:

| Corpus | Band | Confidence ceiling |
|--------|------|--------------------|
| 1 sample, or under 300 words | Thin | **Low** — profile is provisional, mark it so |
| 2–4 samples, 300–1500 words | Workable | **Medium** |
| 5+ samples, 1500+ words, 2+ contexts | Solid | **High** |

**Band the pairs separately**, because the transformation fingerprint sits at the top of the generator's priority order and thin evidence there does disproportionate damage:

| Pairs | Transformation band | Confidence ceiling for §3c |
|-------|--------------------|----------------------------|
| 0 | None | §3c is `N/A` — derive nothing |
| 1 | Anecdotal | **Low** — every rule marked as a single-instance observation |
| 2–3 | Indicative | **Medium** |
| 4+ | Attested | **High**, for transformations repeated across ≥3 pairs |

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
- **Pairs accumulate too.** New pairs add to the §3c table and can promote an Anecdotal band to Indicative — recompute the transformation band from the combined pair count, and raise §3c confidence only as far as the new band allows.
- **Refining a format-1 profile is the normal way §3b and §3c get filled in.** The old profile has no information-shaping counts, so derive them from the new samples alone and say so in the log; do not back-fill them from the old profile's §2/§3 prose, which was never measured for this. Raise `Profile format:` to `2` only once the sections are actually written.

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

**Information-shaping measurements (feed §3b).** These are what stop the generator from reproducing the *source's* composition in the author's vocabulary, so they are not optional extras. Every one is countable; measure it the same way as everything else, with a denominator and quoted instances.

- **Information density** — distinct claims per sentence and per paragraph, over your recorded set. Does this author enumerate several facts in a row, select one, or compress several into a single conclusion? Count the sentences carrying 1 claim vs 2 vs 3+.
- **Detail selection** — find the places where the author had multiple pieces of evidence available for one point (a list they were reacting to, a set of numbers they had, a thread they were replying to). Record which they used: all of them · one representative · conclusion only · conclusion plus one number. This needs a visible opportunity, so it is only measurable where the source material the author was responding to is in the sample. Where it is not, say so rather than guessing.
- **Metric behavior** — every number in the corpus: kept exact, rounded, converted to a proportion ("13 of 19"), replaced by a word ("most", "basically none"), or grouped with a neighbouring metric. Count each category.
- **Abstraction level** — for each factual claim, is it stated at implementation level ("104 inline style declarations"), at summary level ("a lot of inline styles"), or at experience level ("a lot of this is still hardcoded")? Count the three. **Measure this; do not prefer one.** An author who works at implementation level is not being better or worse than one who works at experience level, and the generator needs to know which they are.
- **Technical naming** — when does this author use a selector, a class, a filename, an exact property name, versus a concept? `.hero--editorial` versus "hero block" is a real fingerprint difference and it decides how a whole rewrite reads. Record the conditions, with instances on both sides.
- **Ranking language** — does the author say *highest impact* / *primary issue* / *biggest problem* / *most important*, or do they say *I would start from…* / *the main problem is…* / *this part is more problematic* / *probably makes sense to start here*? Count both families. This one matters more than its size suggests: superlative ranking is the single most contagious thing in AI-written source text, and without a count here the generator has no basis to refuse it.
- **Compression behavior** — does the author repeat evidence, restate a conclusion at the end, collapse related observations into one, or drop context they assume the reader has? Count restatements per piece.
- **Labels and formal structure** — actual counts of `Strength`/`Weakness`, `Pros`/`Cons`, `Summary`, `Recommendation`, `Critical assessment`, numbered sections, and heading density. **Count only what the author wrote unprompted.** If a sample is a reply to a template that demanded headings, that is medium, not person — note it and demote it to §9.
- **Evidence placement** — before the conclusion, immediately after it, at the end, only when challenged? Mostly concrete examples or mostly numbers? Count position per claim.
- **Explanation granularity** — how far does a causal chain run before the author stops? "X is wrong because A causes B which results in C" versus "X is wrong because it creates B". Count the links.

Where the corpus genuinely cannot support one of these — no metrics anywhere, no visible evidence-selection opportunity — write `not measurable in this corpus` against it. That is a useful signal to the generator. A confident guess is not.

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

**Negative lexicon (§4).** Find it three ways. *Absence:* common words and constructions the author had clear opportunity to use and never did. *Contrast:* for a handful of the author's actual sentences, write how a competent generic model would have phrased the same thing, and record the differences — those are the words to ban.

*Attested sets:* a ban list can never enumerate every word the author does not use, so for the three slots where a generator reaches hardest, record the **closed set the corpus actually attests** instead of a list of prohibitions. Write them into §4 as closed sets, verbatim, with counts:

- **Intensifiers** — every word the author uses to grade an adjective ("pretty", "definitely", "really"). State the set and add: *any intensifier outside this set is out of range.*
- **Evaluative adverbs and judgment words** — how they say something is good, bad, hard, or surprising.
- **Hedges** — the exact softeners they use, since §3 tells the generator when to hedge but not with which words.

Without this, a generator picks a defensible word the author has never written in their life — "genuinely", "notably", "arguably" — and the author reads their own profile's output and does not recognise the vocabulary. That is a fidelity failure the ban list structurally cannot catch, because the word is not slop and there is nothing wrong with it except that it is not theirs.

**Information shaping (§3b).** Turn the measurements above into behavioral statements, each with its count and the standard attribute suffix. Write them as *what this author does*, never as *what good writing does* — `Keeps one representative metric and drops the rest (6 of 8 opportunities)` is a rule; `prefers concision` is the tone-of-voice blurb this skill exists not to produce.

Two guards specific to this section:
- **Never infer a shaping rule from a single piece.** A short Slack reply is compressed because it is a short Slack reply. Two occurrences across two samples, same as everywhere else.
- **Separate the person from the topic.** An author writing about a metrics dashboard uses more numbers than the same author writing about a hiring decision. If every metric observation comes from one sample, it belongs in §9, not §3b.

**Transformation fingerprint (§3c) — paired samples only.**

If the corpus has no pairs, write exactly `N/A — no source → author pairs in corpus` and move on. **Do not infer transformation rules from unpaired samples.** There is no way to know what the author would have removed from a text they never saw, and a fabricated rule here outranks almost everything else in the generator.

With pairs, analyze each one along these axes, quoting both sides:

- what information was **removed** — and was it a fact, supporting evidence, or scaffolding?
- what was **retained** verbatim or near-verbatim
- what was **merged** — two source propositions into one statement
- what was **reordered**, and toward what (conclusion-first? chronological? problem-first?)
- what was **simplified** — abstraction level up or down
- what **terminology changed** — technical → conceptual, or the reverse
- what **formality disappeared** — labels, transitions, hedges, honorifics
- which **numbers survived**, which were rounded, which were dropped
- which **examples survived**, and whether a list of examples became one
- whether **headings and section labels disappeared**
- whether source **conclusions were weakened or strengthened** — this one is critical, because it tells the generator how much liberty the author actually takes with someone else's claim
- **length ratio** — author version words ÷ source words
- **local paraphrase or full rewrite** — can the two texts be aligned sentence by sentence, or did the author start over? Check by looking for surviving spans of 6+ consecutive words. This single question is the most important output of the whole pair analysis.

Then generalize into rules — but only where a transformation repeats across pairs, or (at 1 pair) marked explicitly as a single observation:

```
- Usually removes formal section labels. [3 of 3 pairs · Consistent · No · Medium — P1,P2,P3]
- Keeps 1–2 representative metrics rather than every supporting metric. [2 of 3 pairs · Variable · No · Medium — P1,P3]
- Converts abstract evaluation into direct implementation language. [3 of 3 pairs · Consistent · No · Medium — P1,P2,P3]
- Rewrites from the conclusion first rather than preserving source order. [3 of 3 pairs · Consistent · No · Medium — P1,P2,P3]
- Frequently collapses two adjacent source sentences into one. [11 of 19 adjacent pairs · Variable · No · Medium — P1,P2]
- Author versions run 0.55× the source length (0.48, 0.61, 0.57). [3 pairs · Consistent · No · Medium]
```

Every rule needs its evidence, exactly like §1. Cap confidence at the pair band from Step 1 — a single pair can never produce a `High`.

**Tells of a fake (§10).** Take the standard register of LLM prose and check each item against the samples, keeping only the ones the author genuinely never does: em-dash-balanced clause pairs · "It's not just X, it's Y" · rule-of-three lists · "Let's dive in" / "In today's fast-paced world" · a tidy topic sentence opening every paragraph · uniformly even paragraph lengths · hedging softeners before every claim · a summarizing final sentence that restates the opening · flawless article and preposition use · bolded key phrases scattered through prose. Do not assume — if the author does use tricolons, that belongs in §2, not here.

## Step 5 — Registers, noise, and the calibration passage

**Registers and context axes (§7).** Group samples by context and find what shifts (length, formality, punctuation, sign-offs) versus what holds everywhere. The invariants are the fingerprint core — say so explicitly, because a generator working in an unseen context has only those to go on. If the corpus covers one context only, say that and mark every other register unknown.

**Then tag each sample on three independent axes**, because a single `register` dimension conflates three different things and the conflation has a specific consequence: analytical content inherits published-long-form behavior, which is wrong for an argued chat message.

| Axis | Values | What it governs |
|------|--------|-----------------|
| `medium` | slack · ticket · support · email · document · article | formatting, length, greeting and sign-off, emoji |
| `effort` | raw · normal · considered · proofread | slip rates, run-ons, self-correction, tidiness |
| `function` | explain · evaluate · recommend · ask · complain · report · brainstorm | opening move, evidence placement, hedging, closing move |

Tag every sample on all three, **inferring each separately**. A carefully argued Slack message is `slack · considered · evaluate`, and it behaves like neither an off-the-cuff Slack reply nor a published article. Deriving one axis from another is how the old failure returns.

Then record only what the corpus **actually separates**. With 8 samples you have evidence for a handful of cells out of 6×4×7 — so state the per-axis behavior you can support and the specific combinations you observed, and mark everything else unobserved. **Do not build a table of 168 cells and fill it by extrapolation**; an elaborate taxonomy of guesses is worse than a small table of measurements, because the generator cannot tell them apart.

Also state the **resolution ladder** explicitly in §7 for the generator's benefit: invariant core → closest attested medium → closest attested effort → closest attested function, and nothing beyond that. Say in one line which axis your corpus separates best and which it barely covers.

**Noise (§9).** List the demoted one-offs, plus anything attributable to the medium or the topic rather than the person. This section exists so a future generator does not reproduce them.

**Calibration passages (§11) — write two.** Both cover the same short paragraph (60–120 words) in the author's voice, on a neutral topic not covered by the samples.

1. **Full-fidelity passage.** Every live rule at its measured rate. Annotate it line by line with which rule fired where — including which imperfections you placed, why those spots, and **how you spread them across the passage**. This is the generator's only guide to *placement* as opposed to *count*.
2. **Natural-fidelity passage.** The same content, with every `slip` row scaled to a quarter of its rate and every `spelling` row off — the author with their English corrected. Then answer one question under it in a sentence or two: **what still makes this recognisably them once the errors are gone?**

The second passage is not decoration. `natural` is the generator's default, so a profile that only ever demonstrates the full-fidelity texture has left its most common output mode unworked — and the failure mode it guards against is specific: strip the errors carelessly and the voice collapses into competent generic prose, which is the same failure as never having had a profile. Naming what survives is what stops that.

**Source transformation calibration (§11c) — write this only when the corpus has pairs.**

Both passages above test *neutral generation*, and the generator's most common job is not neutral generation — it is rewriting someone else's text. A worked transformation is a better target for that job than any freshly composed paragraph, because it shows the drops and merges rather than describing them.

Build it from a **real pair**, lightly shortened if needed:

```markdown
### 11c. Source transformation calibration

**SOURCE** (not the author's writing):
<the formal/AI paragraph the author actually started from>

**AUTHOR TRANSFORMATION:**
<what the author actually produced>

**What changed:**
- Dropped: <what disappeared, and which layer it belonged to>
- Merged: <which source propositions became one statement>
- Reordered: <what moved, and toward what>
- Source rhetoric removed: <labels, ranking language, transitions>
- Replaced by: <the author's own structure that took its place>
- Length: <n> → <n> words (<ratio>×)
```

If the corpus has pairs but none are short enough to use whole, take a representative section of one — never invent a pair to demonstrate with. A synthetic pair here teaches the generator a transformation the author never made, and §11c is read closely precisely because it is concrete.

With no pairs, write `### 11c. Source transformation calibration — N/A (no pairs in corpus)` and leave it at that.

## Step 6 — Write the profile

**The `Profile format:` line is how the generator decides what to expect**, so it is not decoration and it is not a date stamp. Write `2` when the profile carries §3b, §3c, §7 axes and §11c — even where those sections read `N/A — corpus`, since "measured and found absent" is different information from "never measured". In Refine mode against an older profile, only raise the number once you have actually written those sections; a format claim the file does not honour sends the generator down the wrong branch, and it will not notice.

Write to the resolved profile path, in exactly this structure:

```
# Writing style profile — <label>

Generated by: /twt-write-as-me-analysis
Profile format: 2
Last updated: <YYYY-MM-DD>
Corpus: <n> samples · ~<words> words · contexts: <list>
Corpus band: Thin | Workable | Solid
Pairs: <n> · Transformation band: None | Anecdotal | Indicative | Attested
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

## 3b. Information shaping fingerprint

How this author turns information into a message. Same attribute suffix on every bullet;
`not measurable in this corpus` is a valid and useful value.

- **Information density:** <claims per sentence / per paragraph, with counts — enumerates
  many facts, selects the important ones, or compresses several into one conclusion>
- **Detail selection:** <given several pieces of evidence for one point: lists all · one
  representative · conclusion only · conclusion + one number — with the opportunities counted>
- **Metric behavior:** <which metrics are kept, dropped, rounded, converted to proportions,
  or grouped — counted per number in the corpus>
- **Abstraction level:** <implementation-level / summary-level / experience-level, with
  counts of each. Measured, not preferred>
- **Technical naming:** <when a selector, class, filename or exact property name is used
  versus a concept — with instances on both sides>
- **Ranking language:** <counts for the "highest impact / primary / most important" family
  versus the "I would start from / the main problem is / probably" family. The generator
  uses this to refuse ranking language inherited from a source>
- **Compression behavior:** <repeats evidence · restates the conclusion · collapses related
  observations · drops assumed context — with counts>
- **Labels and formal structure:** <actual unprompted use of Strength/Weakness, Pros/Cons,
  Summary, Recommendation, Critical assessment, numbered sections, heading density>
- **Evidence placement:** <before the conclusion · immediately after · at the end · only
  when challenged; mostly examples or mostly numbers>
- **Explanation granularity:** <how many links of a causal chain get stated before the
  author stops>

## 3c. Transformation fingerprint

<Either `N/A — no source → author pairs in corpus`, or the rules below. NOTHING here may
be derived from unpaired samples: this section sits at the top of the generator's priority
order, so an inferred rule does more damage here than anywhere else in the profile.>

Pairs analyzed: <n> · Transformation band: <Anecdotal | Indicative | Attested>

| # | Source (not the author) | Author version | Words |
|---|-------------------------|----------------|-------|
| P1 | <where it came from> | <where it went> | <n> → <n> (<ratio>×) |

- <transformation rule> [<n> of <n> pairs · Consistent/Variable · Context · Confidence — P1,P2]

**Rewrite depth:** <local paraphrase | full rewrite from scratch — with the surviving-span
evidence: longest run of consecutive words shared between source and author version>

## 4. Lexicon

Same attribute suffix on every bullet.

- **Signature words and phrases:** <verbatim · raw count · rate per 1000 words>
- **Discourse markers and fillers:** <verbatim · raw count · rate per 1000 words>
- **Register and jargon density:** <observed, not judged>
- **Contractions, abbreviations, casing of terms:** <rates>
- **ATTESTED SETS — the closed vocabulary for the three slots a generator reaches hardest.** Intensifiers: <verbatim set · counts>. Evaluative / judgment words: <verbatim set · counts>. Hedges: <verbatim set · counts>. **Anything outside a set is out of range for that slot, whether or not it appears in the negative lexicon below.**
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

### Context axes

Each sample tagged on all three, inferred independently.

| Sample | medium | effort | function |
|--------|--------|--------|----------|
| S1 | slack | raw | ask |

**Per-axis behavior the corpus supports:**

| Axis | Value | What changes | Evidence |
|------|-------|--------------|----------|
| medium | <v> | <formatting, length, sign-off, emoji> | S1, S4 |
| effort | <v> | <slip rates, run-ons, tidiness> | S2, S5 |
| function | <v> | <opening move, evidence placement, hedging, close> | S3 |

**Combinations actually observed:** <list them — everything else is unobserved, not absent>

**Resolution ladder for an unobserved combination:** invariant core → closest attested
medium → closest attested effort → closest attested function → stop. Never extrapolate a
slip rate or a formatting habit into a cell the corpus never covered.

**Best-separated axis:** <which one the corpus actually distinguishes> ·
**Barely covered:** <which one is nearly single-valued here>

**Invariant across every register and every axis (the fingerprint core):** <list — these are the only rules that carry into an unseen context>

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

Every row carries a **Class** and a **Nature**, and they do different jobs.

**Class** says where the habit lives: `grammar` (§6 L1-transfer and syntax patterns) ·
`punctuation` (§5 rated features) · `lexicon` (§4 signature phrases and fillers) ·
`spelling` (consistent misspellings and repeated typo classes). Classify by what a reader
would perceive, not by source section.

**Nature** is the axis the generator's `--fidelity` setting actually scales, and it is the
one that decides whether the output reads as the author or as a caricature of them:

- **`voice`** — a habit a copy-editor would leave alone. It is a *choice* between valid
  forms: which contraction, which dash, which intensifier, where the emoji sits, how an
  estimate is formatted, how a sentence opens.
- **`slip`** — a habit a copy-editor would fix. Something is *omitted, misplaced, or wrong*:
  a dropped article, a missing terminal period, a run-on, an agreement error, a substituted
  preposition, a misspelling.

Class does not imply Nature and must be judged separately. `punctuation` in particular
splits down the middle — "writes *it is*, never *it's*" and "omits the terminal period" are
both `punctuation`, and the first is pure `voice` while the second is pure `slip`. Every
`spelling` row is a `slip`; every `lexicon` row is `voice`; `grammar` rows are almost
always `slip`, but a construction the author *prefers* rather than *gets wrong* is `voice`.

Get this column right and a downstream `--fidelity natural` run can drop the errors and
keep the person. Get it wrong — mark a slip as voice — and the generator reproduces a
misspelling in a piece the user is about to send to a client.

**The two natures are also consumed differently, and the rate has to be written for that.**
The generator applies `slip` rates as arithmetic over counted opportunities, and `voice`
rates as a **long-run tendency** — a distribution across many pieces, never a per-document
quota. So a `voice` row's rate is describing how often this author takes an opportunity
across their whole corpus; it is not a promise that a 250-word message contains one. Where
a `voice` row's opportunity is a *rhetorical* slot rather than a countable construction,
say so in the opportunity column ("a genuine slot for a softener before a verdict"), and
resist the temptation to invent a countable proxy. A precise-looking denominator on a
rhetorical opportunity is worse than an honest description of the slot, because the
generator will hit the number and produce exactly the sprinkled text this design prevents.

**Every row needs a denominator the generator can actually count.** Where the habit
attaches to a construction (a clause, an article slot, a sentence boundary), the
opportunity type names that construction. Where it does not — typo classes, fillers,
signature phrases — the denominator is **words**, and the rate is stated **per 1000
words**. A row whose opportunity type is vague ("sometimes", "throughout") will be placed
by feel at generation time, which is the failure this table exists to prevent.

**Split the two kinds of misspelling; they reproduce differently.**
- **Fixed misspelling** — a specific word the author reliably gets wrong ("overal"). The
  generator reproduces *that word*, at its own rate. Give one row per word.
- **Typo class** — a recurring *mechanism* (transposition, dropped vowel, collapsed
  double letter). The generator produces fresh instances of the mechanism, so the row must
  state the mechanism, the per-1000-words rate, and which word shapes it favours. Rate
  these conservatively: a class rate over-set by a factor of two reads as carelessness
  rather than voice, and unlike a grammar pattern the reader has no way to tell it is
  deliberate.

| ID | Class | Nature | Rule | Fires when | Rate | Opportunity type | Must NOT fire when |
|----|-------|--------|------|-----------|------|------------------|--------------------|
| R1 | grammar | slip | <verbatim from §6/§5/§4> | <condition> | 45% | <what counts as one opportunity> | <exclusion> |

### Tells of a fake — a generator doing any of these has failed
- <thing a generic model would do that this author demonstrably never does>

## 11. Calibration passages

### 11a. Full fidelity — every rule at its measured rate

<60–120 words in the author's voice on a neutral topic>

**Rules that fired:** <line-by-line annotation: which rules, where, and how they were spread
across the passage rather than clustered>

### 11b. Natural fidelity — slip rows at ×0.25, spelling off (the generator's default)

<the same passage, errors corrected, voice intact>

**What still makes this him:** <one or two sentences naming the traits that survive the
correction — this is what the generator must not lose when it drops the errors>

### 11c. Source transformation calibration

<Either `N/A (no pairs in corpus)`, or a worked transformation taken from a REAL pair —
never a synthetic one.>

**SOURCE** (not the author's writing):

<the formal or AI-written paragraph the author actually started from>

**AUTHOR TRANSFORMATION:**

<what the author actually produced from it>

**What changed:**
- Dropped: <what disappeared, and which preservation layer it belonged to>
- Merged: <which source propositions became one statement>
- Reordered: <what moved, and toward what>
- Source rhetoric removed: <labels, ranking language, formal transitions>
- Replaced by: <the author's own structure that took its place>
- Length: <n> → <n> words (<ratio>×)

## 12. Self-check

| Question | Verdict | Where satisfied |
|----------|---------|-----------------|
| Could another model reproduce sentence structure from this alone? | PASS/FAIL | §2, §11 |
| Could it reproduce the reasoning flow? | PASS/FAIL | §3 |
| Could it decide WHAT to say and what to leave out? | PASS/FAIL | §3b |
| Could it rewrite someone else's text the way this author would? | PASS/FAIL | §3c, §11c |
| Could it reproduce the imperfections without randomly degrading the text? | PASS/FAIL | §10 table, §6 |
| Does the voice survive with the errors removed? | PASS/FAIL | §11b, §10 Nature column |
| Does the profile distinguish style from noise? | PASS/FAIL | §9 |
| Does it describe what NOT to do? | PASS/FAIL | §4, §10 |
| Are High-confidence claims backed by repeated evidence? | PASS/FAIL | §1 |
```

## Step 7 — Final quality check (must pass before you report)

Reread the profile **as if the samples had been deleted** — that is the actual usage condition. Answer the nine questions in §12 honestly:

1. **Sentence structure reproducible?** FAIL if §2 says "varied sentence length" instead of naming a median, a range, and how many sentences were measured to get them.
2. **Reasoning flow reproducible?** FAIL if §3 describes what the author writes about rather than how they move from one idea to the next, or if its bullets lack the attribute suffix.
3. **Could it decide what to say and what to leave out?** FAIL if §3b is missing, if any bullet states a preference without a count, or if it reads as a judgment about good writing ("prefers concision", "values clarity") rather than a measurement of this person. FAIL also if abstraction level is asserted rather than counted — that bullet decides how every rewritten sentence lands, and it is the one most likely to be filled in from impression. `not measurable in this corpus` on a bullet or two is a PASS; an unmarked guess is not.
4. **Could it rewrite someone else's text the way this author would?** With no pairs, `N/A — corpus` is the correct answer and it PASSES — but only if §3c actually says so. FAIL if §3c carries any rule at all while `Pairs: 0`, because that rule was invented; FAIL if a rule's confidence exceeds the pair band; FAIL if §11c holds a pair that does not appear in §3c's table, which means it was synthesized to fill the section.
5. **Imperfections reproducible without random degradation?** FAIL if any row of the §10 rate-governed table lacks a class, a **nature**, a firing condition, a rate, an opportunity type, or a must-not-fire column — or if any §6 pattern, rated §5 feature, or §4 signature phrase is missing from that table. This is the check most likely to be skimmed, and a half-filled table makes the generator sprinkle errors at random, which is the worst possible output.
   Then check the Nature column specifically, row by row, because it is new and it is the one the generator scales: does every `spelling` row read `slip`? Does every `punctuation` row get judged on its own — omission and misplacement as `slip`, choice-between-valid-forms as `voice` — rather than all being stamped the same? A `punctuation` column that is uniformly `slip` or uniformly `voice` was not judged, it was filled in.
6. **Voice survives without the errors?** FAIL if §11b is missing, if it is the full-fidelity passage with the typos deleted and nothing else considered, or if "what still makes this him" names only traits that are themselves slips. The generator's default output mode is this one; a profile that never demonstrates it is untested where it is used most.
7. **Style separated from noise?** FAIL if §9 is empty on a corpus of 3+ samples. Real corpora always contain one-offs; an empty §9 means the promotion threshold was not applied.
8. **What not to do described?** FAIL if the negative lexicon or the tells-of-a-fake list is empty.
9. **High confidence earned?** FAIL if any `High` sits on fewer than 5 occurrences across 3 samples, or exceeds the Step 1 corpus ceiling.

Then three checks that are not in §12, because they catch fabrication rather than omission:

- **Every number in the profile must trace to quoted instances in the evidence log.** Any rate you cannot point at instances for gets deleted or downgraded to prose — do not keep it because it looks precise.
- **No `Source` side of a pair may appear anywhere as authorial evidence.** Walk §1, §2, §4 and §5 for quoted examples and confirm each came from an `Author version` or an ordinary sample. A source quote counted as the author's own writing corrupts every rate it touches, and it does so invisibly.
- **The `Profile format:` line must match what the file actually contains.** If §3b, §3c, §7 axes or §11c are absent, the line reads `1`, not `2`.

Fix every FAIL inline and re-check. Only report once all nine read PASS — or, where the corpus genuinely cannot support one (a Thin single-context corpus cannot support §7), mark it `N/A — corpus`, state that in the profile, and say so in the report.

## Step 8 — Report

Tell the user:
- The profile path and the evidence-log path
- Corpus band, sample count, word count, contexts covered — and the coverage gaps
- Pair count and transformation band. **If there are no pairs, say so plainly and say what it costs:** the generator will reconstruct from the author's composition habits but has no direct evidence of how they rewrite someone else's text, which is the most common thing it is asked to do. Then say concretely where to find pairs — sent mail, a doc's version history, an AI draft they fixed — and that two or three would fill §3c.
- The 3–5 most distinctive fingerprint traits found, each with its rate and confidence
- The 2–3 most distinctive **information-shaping** behaviors from §3b, phrased as what the author does with information rather than as style
- Which context axis the corpus separates well and which it barely covers
- Anything demoted to noise that they might have expected to see as a trait
- Any §12 row marked `N/A — corpus`, and what samples would fix it
- In Refine mode: what was merged, what got promoted or demoted, whether the profile format was raised, and any Manual-overrides disagreement recorded
- Next step: `/twt-write-as-me <your text or file>`
