---
name: twt-write-as-me
category: voice
description: (v1.0.3) Generate or rewrite text in the author's own voice using their writing-style profile
version: 1.0.3
accepts_arguments: true
inputs:
  - What to write, or the text/file path to rewrite
  - Optional `--profile <path>` to use a profile outside the default location
  - Optional `--register <name>` to pick a context register defined in the profile
  - Optional `--fidelity full|habits|clean` to control which classes of habit get reproduced (default `full`)
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

The output reproduces the author's actual writing behavior as the profile describes it — including the parts a copy-editor would flag. This skill also does not build or update the profile (that is `/twt-write-as-me-analysis`), does not invent facts to fill out a draft, and does not silently drop content when rewriting.

**Success criteria:**
- No usable profile → the run stops and points the user at `/twt-write-as-me-analysis`, with concrete advice on how much text to feed it. It never quietly falls back to a generic voice.
- Usable profile → its directives bind the output; every "Never" is respected and no "tell of a fake" appears.
- Rate-governed habits land inside their stated bands, placed at genuine opportunities the profile names and **spread across the piece** — never sprinkled at random, never applied uniformly, never clustered.
- `--fidelity` filters which classes of habit fire without weakening anything else: `clean` still writes in the author's voice, structure, and vocabulary — it only stops reproducing what a reader would call an error.
- **File in → the file is rewritten. Text or a topic in → the text comes back in chat.**
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

If the profile is usable but marked `Corpus band: Thin` or `Profile confidence: Low`, proceed — but say once, up front, that fidelity will be rough and more samples would fix it. Do not repeat the warning after the output.

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

**Preserve substance in both rewrite modes.** Every fact, number, name, date, link, and commitment in the source must appear in the output. This skill changes how something is said, never what is said. If the source contains a claim you believe is wrong, leave it alone and mention it in the report.

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
- **§11 calibration passage** — read this last and closest. It is the worked example, and matching its feel is a better target than satisfying the rules one at a time. Its annotation is also the only guide to *where* habits sit in a piece rather than how many there are.

**Pick the register (§7).** Use `--register <name>` if given. Otherwise infer from the target medium and say which you chose. If the profile has no register matching the medium, use the **invariant core** the profile names and say so — do not extrapolate a register from a context the corpus never covered.

**Note the coverage gaps** recorded in the profile's Evidence base. If the request falls into a gap, flag it once in the report; the output there is an extrapolation.

## Step 4 — Draft for fidelity

Write the draft applying the profile. Discipline that matters:

**Structure first, surface second.** Match §2 sentence lengths and §3 reasoning flow before worrying about vocabulary. A paragraph with the author's words in a generic shape reads more fake than the reverse — shape is what people actually recognize.

**Set the fidelity level first — it decides which rows are live.** Read `--fidelity` from `$ARGUMENTS`; default `full`. It filters the §10 table by each row's **Class**:

| `--fidelity` | Live classes | Use it for |
|--------------|--------------|-----------|
| `full` (default) | `grammar` · `punctuation` · `lexicon` · `spelling` | Anything meant to read exactly like the author |
| `habits` | `grammar` · `punctuation` · `lexicon` | Their voice without reinserted misspellings — client email, anything public |
| `clean` | `lexicon` | Their vocabulary and structure with nothing a reader would call an error |

Filtering happens **only here**. Every non-rate part of the profile still binds at every level: §2 sentence architecture, §3 reasoning flow, §4 negative lexicon, §8 formatting, §10 Always/Never, and the tells-of-a-fake list. `clean` is still the author's voice — it is not a licence to write generic prose.

If a level suppresses every row, say so in the report rather than silently producing flat output.

**Do the rate arithmetic; do not improvise it.** For each **live** row of the §10 rate-governed table:
1. Count the **opportunities** the draft contains, using that row's "opportunity type". For rules whose opportunity type is the text itself rather than a countable construction — typo classes, fillers, signature phrases — the denominator is **words**, and the rate is per 1000 words.
2. Multiply by the stated rate and round to the nearest whole number — that is the target count.
3. Place exactly that many, at opportunities matching the row's "fires when".
4. Never place one where the row's "must NOT fire when" excludes it.

**Write the denominator down for every live rule before you place anything.** A rule you place from feel rather than from a count is not fidelity — it is the sprinkling this design exists to prevent, and it hides successfully because the output still reads plausibly. If you cannot state a denominator for a rule, you did not measure it: either count properly or leave that rule unfired and say so. The rules most likely to be improvised are exactly the ones with fuzzy opportunity types, so they need the count most.

**Opportunities are counted in the content as given. Never manufacture one.** If a rule's target lands above what the text can carry, place fewer — do not add a clause, a sentence, or an aside to create somewhere for it to go. Extending the text to hit a rate target is how invented content gets in, and the added material is exactly where it hides.

**Spread them; do not cluster.** With 8 matching opportunities and a target of 4, take them across the whole piece rather than the first four in a row — clustering is as unnatural as randomness. §11's annotation shows how the analyzer distributed them; follow that shape.

**When the arithmetic rounds to zero.** Zero is usually correct — a clean three-sentence message from an author who drops articles 20% of the time is perfectly plausible, and forcing an imperfection in to look authentic is the failure this whole design exists to prevent. One exception: if the piece contains **three or more opportunities across all live rules combined** and every row still rounds to zero, place a single instance at the highest-rate live rule. Otherwise every short output — the dominant case — comes out deterministically cleaner than the author ever writes.

**Never invent a habit that is not in the §10 table.** Errors outside the documented set are not fidelity, they are damage. This is the difference between reproducing a fingerprint and roughing text up.

**Never reproduce anything in §9.** Those are noise the analysis explicitly demoted.

**Explicit user instructions win.** If the user asks for something the profile contradicts — "make this one more formal", "keep it under 100 words", "no typos in this one" — follow the user, keep every profile rule the instruction does not touch, and note the deviation in the report.

## Step 5 — Fidelity self-check

Before delivering, audit the draft against the profile. One revision pass, then ship.

- **Never-list:** does the draft contain anything from §10 Never or the §4 negative lexicon? Remove it.
- **Tells of a fake:** walk the §10 list item by item against the actual draft. This is where generic prose survives — the em-dash clause pair, the tricolon, the tidy summarizing close. Cut what you find.
- **Rate audit:** for each **live** row of the §10 table, recount opportunities and placements in the finished draft. Inside the band? Over-application reads as parody; under-application reads as an editor got there first. Check distribution too, not just the count. Then confirm no *suppressed* class leaked in — at `habits` or `clean`, a misspelling you produced from memory rather than from the table is a bug.
- **Sentence metrics:** is the median length near §2's? Is the length *variance* right? Uniform sentence length is itself a tell, even at the correct median.
- **Opening and closing:** do they use the §3 moves, or the moves a model defaults to?
- **Manual overrides:** is every one of them honoured?
- **Denominators:** does every fired rule have a stated `placed / opportunities`? A bare count means that rule was never measured — fix it or drop the rule.
- **Rewrite modes only — nothing added.** Read the draft's sentences against the source one by one. Does any sentence introduce a claim, number, recommendation, cost, question, or offer the source does not contain? Delete it. Pay closest attention to the **final one or two sentences**, which is where an imitated closing move invents content, and to any sentence that carries a rate-governed placement — a manufactured opportunity looks like style from the inside.
- **Rewrite modes only:** is every fact, number, name, link, and commitment from the source still present?

## Step 6 — Deliver and report

**Rewrite-file mode:** write the file (Edit or Write per the Step 2 choice), then report the path and confirm whether it was rewritten in place or written beside the original.

**Rewrite-text and Generate modes:** return the text in chat, as the finished text only — no preamble, no "here's your text in your voice", no commentary above it.

Then report — and **keep the report shorter than the text it describes.** The deliverable is the writing; a rate audit longer than the draft buries it. Two compact parts, nothing else:

**One header line:** profile path · confidence band · register · `--fidelity` level (name it even at the `full` default, so the user learns the lever exists) · sentence median over n measured.

**One line per fired rule**, in a single list — `R<n> <name> — <placed>/<opportunities> (<rate>%)`. Nothing per rule beyond that; no per-rule commentary, no ASCII rules between entries. Then one short line naming the rules that rounded to zero, and one for any class the fidelity level suppressed.

Then, only when there is something to say, at most one sentence each:
- A deviation the user's own instructions caused, or a Manual override applied
- A coverage gap the request fell into
- **For rewrites: anything you deliberately left alone** — a claim you doubted, an internal contradiction you carried through rather than reconciling, an awkward line that is actually the author's habit. Flag these; they are the ones the user must check before sending.

Say nothing about structural choices that went well, and do not explain your reasoning for rules that behaved normally. If every part is unremarkable, the header line and the rule list are the whole report.
