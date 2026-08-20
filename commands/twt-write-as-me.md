---
name: twt-write-as-me
category: voice
description: (v1.0.5) Generate or rewrite text in the author's own voice using their writing-style profile
version: 1.0.5
accepts_arguments: true
inputs:
  - What to write, or the text/file path to rewrite
  - Optional `--profile <path>` to use a profile outside the default location
  - Optional `--register <name>` to pick a context register defined in the profile
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

**Purpose:** Generate new text, or rewrite existing text, so that it reads as if it were naturally written by the author described in `writing-style-profile.md`. The single objective is **style fidelity**.

**Non-goals:** the objective is explicitly **not** any of these, and pursuing them is how this skill fails:
- perfect English
- professional editing
- maximum clarity
- maximum conciseness
- native-level phrasing
- generic "humanization"
- random imperfection

The output reproduces the author's actual writing behavior as the profile describes it — the sentence architecture, the reasoning order, the vocabulary, the rhythm, the discourse moves.

**Fidelity is to the voice, not to the error rate.** A profile built from raw chat measures how the author writes when they are typing fast and not re-reading. Replaying those rates into a piece the user is about to send produces a caricature: the reader sees the misspellings and the dropped words first, and the voice second. So by default this skill writes **the author with their English corrected** — same structure, same words, same directness, without the errors they would have caught themselves. `--fidelity full` is how you ask for the raw behavior on purpose; it is not the default.

This skill also does not build or update the profile (that is `/twt-write-as-me-analysis`), does not invent facts to fill out a draft, and does not silently drop content when rewriting.

**Success criteria:**
- No usable profile → the run stops and points the user at `/twt-write-as-me-analysis`, with concrete advice on how much text to feed it. It never quietly falls back to a generic voice.
- Usable profile → its directives bind the output; every "Never" is respected and no "tell of a fake" appears.
- Rate-governed habits land inside their stated bands, placed at genuine opportunities the profile names and **spread across the piece** — never sprinkled at random, never applied uniformly, never clustered.
- `--fidelity` scales the author's **error** behavior without weakening anything else. At every level the voice, structure, vocabulary, rhythm and discourse moves are reproduced in full; the levels differ only in how much of what a copy-editor would fix survives. The default output reads as **the author with their English corrected**, never as a simulation of the author typing fast.
- No manufactured misspellings unless the user explicitly asked for `full`. A generated typo is the one habit the reader cannot tell was deliberate, so it reads as a caricature of the author rather than as the author.
- **File in → the file is rewritten, and the response is a one-line confirmation. Text or a topic in → the response is the text, alone.** No process commentary either way unless `--report` was passed.
- Meaning, facts, names, numbers, and links survive a rewrite untouched.

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Resolve the profile (hard gate)

Resolve the path: `--profile <path>` if given, else `.twt-artifacts/write-as-me/writing-style-profile.md`. Check with **Glob/Read**, never a shell command (CONVENTIONS §15).

**Existence is not enough — check the shape.** A file at that path may be a stub, a half-written artifact from an interrupted run, or a hand-typed "friendly, casual, concise" note, which is the exact thing the analyzer's Non-goals call a failure. Grep the file for the headings `## 10. Reproduction directives` and `## 6.`. **If either is missing, treat the profile as absent** and take the branch below. A profile that passes the gate but carries no directives produces generic prose while reporting success — the worst available outcome, because it looks like it worked.

**If there is no usable profile, stop and say so.** Do not proceed with a generic voice.

Tell the user:

```
No usable writing-style profile found at <path>.

Run /twt-write-as-me-analysis first, and give it as much of your own writing as you can.
Volume and variety both matter: aim for 5+ separate pieces, 1500+ words total, across at
least two contexts (emails, chat, docs, posts, commit messages). Raw and unedited beats
polished — anything a copy-editor touched will blur the fingerprint this depends on.
```

Then offer via **AskUserQuestion** (single-select, header "Profile"):
- **Build the profile now** (recommended)
- **Point me at a profile** — plain-text prompt for a path, then re-resolve and re-check the shape
- **Cancel** — stop here
- **You decide**

**On "Build the profile now": collect the samples here, in the main thread, before dispatching.** Ask the plain-text question above and wait for the answer. Only then dispatch `/twt-write-as-me-analysis` (Agent tool, CONVENTIONS §5) with the sample paths or pasted text **embedded in the dispatch prompt**, plus `subagent-collect`. The analyzer gathers samples by asking the user, and a subagent has nobody to ask — dispatching it empty makes it stall or, worse, write a profile from nothing. When it returns, re-resolve and re-check the shape before continuing.

If the profile is usable but marked `Corpus band: Thin` or `Profile confidence: Low`, proceed — and add **one line** after the output saying fidelity will be rough and more samples would fix it. Once, one line, never before the text and never repeated on later runs in the same conversation.

## Step 2 — Determine mode and target

Read `$ARGUMENTS` and classify:

| Input | Mode | Output goes to |
|-------|------|----------------|
| A path that resolves to a **prose** file | **Rewrite file** | that file, rewritten in place |
| Pasted text to rework | **Rewrite text** | chat |
| A topic, brief, or instruction ("write a follow-up to X") | **Generate** | chat |

If `$ARGUMENTS` is empty, ask one plain-text question: what to write, or what to rewrite.

If the classification is genuinely ambiguous — say a path-like string that does not resolve — ask via **AskUserQuestion** (header "Mode") rather than guessing, because the two modes differ in whether a file gets overwritten.

**Rewrite-file mode is prose-only.** Accept `.md`, `.markdown`, `.txt`, `.rst`, and front-matter-bearing content files. **Anything else — `.js`, `.css`, `.json`, `.py`, `.html` — is not prose.** Say the target is a code or data file, and offer (AskUserQuestion, header "Target"): **Rewrite only its comments and user-facing strings** · **Cancel** · **You decide**. Never treat a source file as an essay: the instruction to preserve structure and rewrite "the prose inside" has no referent there, and a well-meaning rewrite of a `.js` file breaks it.

Read the file first. Before writing, confirm the overwrite via **AskUserQuestion** (header "Overwrite"): **Rewrite in place** (recommended) · **Write beside it as `<name>.as-me.<ext>`** · **Show in chat only** · **You decide**. Preserve the file's structure exactly — headings, list nesting, code fences, front matter, links, and any markup stay put; only the prose inside them changes. Never touch code blocks.

**Preserve substance in both rewrite modes.** Every fact, number, name, date, link, and commitment in the source must appear in the output. This skill changes how something is said, never what is said. If the source contains a claim you believe is wrong, leave it alone — and flag it in the one content-integrity line Step 6 allows, since the user is about to send it.

**Preservation outranks the §3 discourse moves — always.** The profile records how the author opens and closes a piece. In a rewrite, imitate those moves **only by reshaping sentences the source already has**. Never add a sentence that introduces a claim, recommendation, cost estimate, question, caveat, or offer the source does not make, however characteristic that closing move is. If the author habitually ends with an open question and the source ends on a flat assertion, the rewrite ends on the assertion. A "voice-accurate" ending that says something the author never said is a fabrication wearing their handwriting, and it is the single most damaging thing this skill can produce — the user will send it believing they wrote it.

The same applies in reverse: the source's own opening and closing content stays. Reshape it, do not replace it.

## Step 3 — Load the profile as binding instructions

Read the whole profile and treat it as instructions for this run, not as background reading. Section references below (`§2`, `§6`, `§10`, …) point at the **profile's** sections, not this repo's CONVENTIONS. Extract, before drafting:

- **`## Manual overrides`** — the user's own hand-written directives. These outrank everything measured below them. Apply them first; where one contradicts a measured rule, the override wins.
- **§10 Always / Never / Tells of a fake** — the hard constraints
- **§10 Rate-governed table** — the *single* source for every habit you will reproduce, with its class, firing condition, rate, opportunity type, and exclusion all in one row. Read it and nothing else for this purpose; §6 is the human-readable companion, not a second lookup you must join against.
- **§2 sentence architecture** — the target median, range, and opening-move distribution
- **§3 reasoning flow** — the opening move, argument order, and closing move to imitate. Weight each by its `[Frequency · Consistency · Context · Confidence]` suffix; a `Low` confidence move is a hint, not a rule.
- **§4 lexicon** — words to reach for at their stated per-1000-words rates, and the negative lexicon to avoid
- **§5 punctuation** and **§8 formatting**
- **§11 calibration passages** — read these last and closest. They are the worked examples, and matching their feel is a better target than satisfying the rules one at a time. **Match the one that corresponds to your fidelity level**: §11b (natural) at the default, §11a (full) only when `--fidelity full` was asked for. A profile with a single unlabelled passage predates the split — treat it as the `full` example, and at `natural` take its *shape and vocabulary* as the target while ignoring its error density. §11a's annotation is the only guide to *where* habits sit in a piece rather than how many there are, so read it at every level.

**Pick the register (§7).** Use `--register <name>` if given, otherwise infer it. If the profile has no register matching the piece, fall back to the **invariant core** the profile names — never extrapolate a register from a context the corpus never covered. Which register you picked is `--report` material; do not announce it otherwise.

**Infer the register from what the piece is doing, not from where it will be pasted.** Medium is the weaker signal of the two. A profile that splits raw from careful is splitting on *effort*, and effort tracks the rhetorical mode:

| The piece… | Register |
|---|---|
| argues, analyses, reviews, reports findings, or recommends a course of action | **careful** — even if it is going into a chat window |
| answers a client, quotes a cost, or reports a bug | the profile's named register for that context |
| dumps ideas, enumerates capabilities, or replies in two lines to a peer | **raw** |

Getting this backwards is a live failure, not a theoretical one: raw-register rates applied to an analytical argument produce run-ons and dropped words in the middle of a careful case, which is exactly what the profile's own exclusions ("must NOT fire when the message argues rather than enumerates") exist to prevent. When both readings are defensible, take the careful one — a piece that argues is almost always a piece someone will read closely.

**Note the coverage gaps** recorded in the profile's Evidence base. If the request falls into one, the output there is an extrapolation — record that for `--report`, and stay silent about it otherwise.

## Step 4 — Draft for fidelity

Write the draft applying the profile. Discipline that matters:

**Structure first, surface second.** Match §2 sentence lengths and §3 reasoning flow before worrying about vocabulary. A paragraph with the author's words in a generic shape reads more fake than the reverse — shape is what people actually recognize.

**Set the fidelity level first — it decides which rows are live and at what strength.** Read `--fidelity` from `$ARGUMENTS`; default **`natural`**. It filters the §10 table by each row's **Nature**:

- **`voice`** — a habit a copy-editor would leave alone. Which contraction the author picks, which dash, which intensifier, where the emoji goes, how estimates get formatted, how sentences open. These are the fingerprint.
- **`slip`** — a habit a copy-editor would fix. A dropped article, a missing terminal period, a run-on, an agreement error, a substituted preposition, a misspelling. These are what the author does when they are not re-reading.

| `--fidelity` | `voice` rows | `slip` rows | `spelling` class | Use it for |
|---|---|---|---|---|
| `full` | stated rate | stated rate | on | A deliberate reproduction of the author typing fast — private notes, or demonstrating the raw register |
| **`natural`** (default) | stated rate | **× 0.25 of stated rate** | **off** | Everything the user will actually send. The author after correcting their English |
| `clean` | stated rate | off | off | Formal or public writing — the voice with nothing a reader would call an error |

`habits` is accepted as a deprecated alias for `natural`.

**Why `natural` is the default.** The output is normally something the user sends under their own name. At `full` the reader meets the errors before they meet the voice, and a manufactured misspelling is the one habit nobody can tell was deliberate — it reads as the author being careless, not as the author being themselves. Reproducing measured error rates faithfully and producing a caricature are the same act here. Only pick `full` when the user asked for it, or when the requested piece genuinely *is* a fast raw-register message (a two-line DM to a peer).

**Nature is not the same as Class.** A profile written before the Nature column existed carries only `Class`. Derive Nature yourself before drafting, and write the mapping down:

| Class | Nature |
|---|---|
| `lexicon` | `voice` |
| `spelling` | `slip` |
| `grammar` | `slip` |
| `punctuation` | **judge per row** — a rule that *omits or misplaces required* punctuation (missing terminal period, capital run-on, comma splice, comma before a `that`-clause, lowercase sentence start) is a `slip`. A rule that *chooses between valid forms* (which contraction, spaced hyphen instead of an em dash, emoji position, colon-for-a-list, hyphenated hour ranges) is `voice`. |

Filtering happens **only here**. Every non-rate part of the profile still binds at every level: §2 sentence architecture, §3 reasoning flow, §4 negative lexicon, §8 formatting, §10 Always/Never, and the tells-of-a-fake list. `clean` is still the author's voice — it is not a licence to write generic prose, and at `clean` the §2/§3/§4 obligations get *stricter*, not looser, because structure and word choice are then carrying the whole fingerprint alone.

If a level suppresses every row, that is what the user asked for — produce the text without comment, and note it for `--report`.

**Stay inside the author's vocabulary.** The §4 negative lexicon lists what the corpus proves they avoid, but it cannot enumerate every word they simply never reach for. So apply the general rule too: at any slot where you are about to place an **intensifier, an evaluative adverb, or a judgment word**, use one the corpus actually attests. If the author's only intensifiers are "pretty" and "definitely", then "genuinely", "notably", "remarkably", "arguably", "surprisingly", "impressively" are all wrong — not because they are bad words, but because this person does not own them. A word the author would not recognise as theirs is as much a tell as a semicolon.

**Do the rate arithmetic; do not improvise it.** For each **live** row of the §10 rate-governed table:
1. Count the **opportunities** the draft contains, using that row's "opportunity type". For rules whose opportunity type is the text itself rather than a countable construction — typo classes, fillers, signature phrases — the denominator is **words**, and the rate is per 1000 words.
2. Pick the rate **for the register you chose in Step 3**. Where the row states both a raw and a careful rate, taking the wrong one is a bigger error than any placement mistake downstream.
3. Multiply by that rate, then by the fidelity multiplier from the table above (`1.0` for a `voice` row at any level; `1.0`/`0.25`/`0` for a `slip` row at `full`/`natural`/`clean`). Round to the nearest whole number — that is the target count.
4. Place exactly that many, at opportunities matching the row's "fires when".
5. Never place one where the row's "must NOT fire when" excludes it. **The exclusion is checked per placement, against the sentence it would land in — not once for the piece.** A rule can be live for the piece and still be illegal in the specific sentence you were about to use.

**Write the denominator down for every live rule before you place anything.** A rule you place from feel rather than from a count is not fidelity — it is the sprinkling this design exists to prevent, and it hides successfully because the output still reads plausibly. If you cannot state a denominator for a rule, you did not measure it: either count properly or leave that rule unfired and say so. The rules most likely to be improvised are exactly the ones with fuzzy opportunity types, so they need the count most.

**Opportunities are counted in the content as given. Never manufacture one.** If a rule's target lands above what the text can carry, place fewer — do not add a clause, a sentence, or an aside to create somewhere for it to go. Extending the text to hit a rate target is how invented content gets in, and the added material is exactly where it hides.

**Spread them; do not cluster.** With 8 matching opportunities and a target of 4, take them across the whole piece rather than the first four in a row — clustering is as unnatural as randomness. §11's annotation shows how the analyzer distributed them; follow that shape.

**When the arithmetic rounds to zero.** Zero is usually correct — a clean three-sentence message from an author who drops articles 20% of the time is perfectly plausible, and forcing an imperfection in to look authentic is the failure this whole design exists to prevent. One exception: if the piece contains **three or more opportunities across all live rules combined** and every row still rounds to zero, place a single instance at the highest-rate live rule — **and take that instance from a `voice` row whenever one is available.** Only when no `voice` row has an opportunity may the floor fall on a `slip` row, and never on a `spelling` row at any level. Otherwise every short output — the dominant case — comes out deterministically cleaner than the author ever writes, or worse, gets its one distinguishing mark spent on a typo.

**Never invent a habit that is not in the §10 table.** Errors outside the documented set are not fidelity, they are damage. This is the difference between reproducing a fingerprint and roughing text up.

**Never reproduce anything in §9.** Those are noise the analysis explicitly demoted.

**Explicit user instructions win.** If the user asks for something the profile contradicts — "make this one more formal", "keep it under 100 words", "no typos in this one" — follow the user, and keep every profile rule the instruction does not touch. They asked for the deviation, so do not announce it back to them — record it for `--report`.

## Step 5 — Fidelity self-check

Before delivering, audit the draft against the profile. One revision pass, then ship.

- **Never-list:** does the draft contain anything from §10 Never or the §4 negative lexicon? Remove it.
- **Tells of a fake:** walk the §10 list item by item against the actual draft. This is where generic prose survives — the em-dash clause pair, the tricolon, the tidy summarizing close. Cut what you find.
- **Rate audit:** for each **live** row of the §10 table, recount opportunities and placements in the finished draft. Inside the band, *after* the fidelity multiplier? Over-application reads as parody; under-application reads as an editor got there first. Check distribution too, not just the count.
- **Exclusion audit — per placement, not per rule.** Take every placement you made and reread the sentence it landed in against that row's "must NOT fire when". A rule whose rate is correct for the piece can still be illegal in the one sentence you used it in, and that single sentence is what the reader notices.
- **Suppression audit:** confirm no suppressed row leaked in. At `natural` or `clean`, a misspelling is a bug — including one you produced from memory of the author rather than from the table, which is the form it actually takes. Read the draft once looking *only* for words that are not spelled correctly; at anything below `full` the count must be zero.
- **Vocabulary audit:** every intensifier, evaluative adverb and judgment word in the draft — is it attested in the profile's §4, or is it a word you reached for because it fit? Replace anything the author does not own.
- **Sentence metrics:** is the median length near §2's? Is the length *variance* right? Uniform sentence length is itself a tell, even at the correct median.
- **Opening and closing:** do they use the §3 moves, or the moves a model defaults to?
- **Manual overrides:** is every one of them honoured?
- **Denominators:** does every fired rule have a stated `placed / opportunities`? A bare count means that rule was never measured — fix it or drop the rule.
- **Rewrite modes only — nothing added.** Read the draft's sentences against the source one by one. Does any sentence introduce a claim, number, recommendation, cost, question, or offer the source does not contain? Delete it. Pay closest attention to the **final one or two sentences**, which is where an imitated closing move invents content, and to any sentence that carries a rate-governed placement — a manufactured opportunity looks like style from the inside.
- **Rewrite modes only — nothing strengthened.** Adding no new sentence is not enough; a claim can be invented inside a sentence the source already had. Check every evaluative word against what the source actually said, in both directions:
  - **Ranking the source did not rank.** "well designed" → "the strongest part". "a problem" → "the biggest problem". Superlatives and "the X-est" constructions are claims, and the author's flat verdict-first voice makes them very easy to slip in.
  - **Certainty the source did not carry.** "may", "looks like", "probably" → a flat assertion. The author states constraints flat and hedges diagnoses (§3) — applying that pattern to a source that hedged is a rewrite of the meaning, not of the style.
  - **Scope the source did not claim.** "several pages" → "every page"; "one cause" → "the cause".

  This is the same failure as inventing a sentence, and it hides better, because the sentence it lives in is genuinely the source's. Where the source is vague, the rewrite stays vague.
- **Rewrite modes only:** is every fact, number, name, link, and commitment from the source still present?

## Step 6 — Deliver

**Rewrite-text and Generate modes:** the response is the finished text, and only the finished text. No preamble, no "here's your text in your voice", no framing line above it, no summary below it. Start at the first word of the piece.

**Rewrite-file mode:** write the file (Edit or Write per the Step 2 choice), then say in one or two lines what happened to it — the path, and whether it was rewritten in place or written beside the original. That confirmation *is* the response; do not also paste the text back.

### Say nothing else

**The deliverable is the writing. By default the response contains the text and nothing else.**

The audit from Step 5 is work you do, not work you show. The user called this skill to get a piece of writing, not a report on how it was made — and every line of process commentary pushes the thing they actually wanted further up the scrollback.

So, unless `--report` was passed, **do not** print: the profile path, the confidence band, the register you picked, the `--fidelity` level, which rules fired, how many opportunities there were, what rounded to zero, sentence medians, structural choices you made, what you dropped, or why any of it was right. All of that is invisible by default.

Exactly one thing still surfaces without being asked for, because it is about the content rather than the process: **if you deliberately left something the user would otherwise send unknowingly** — a factual contradiction in the source, a claim you doubted, a number that disagrees with another number — add **one line** after the text, after a blank line. One line, no header, no elaboration. Nothing else ever earns an unsolicited line.

### With `--report`

Append the audit below the text, after a `---` separator: a header line (profile · band · register · fidelity level · sentence median over n measured), then one line per fired rule — `R<n> <name> [<nature>] — <placed>/<opportunities> (<rate>% × <multiplier>)` — then one line for rules that rounded to zero and one naming what the fidelity level suppressed. Where the register was inferred rather than passed, say which one and in one clause why. No per-rule commentary, no explanation of rules that behaved normally.
