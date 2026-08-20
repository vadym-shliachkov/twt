---
name: twt-write-as-me
category: voice
description: (v1.0.1) Generate or rewrite text in the author's own voice using their writing-style profile
version: 1.0.1
accepts_arguments: true
inputs:
  - What to write, or the text/file path to rewrite
  - Optional `--profile <path>` to use a profile outside the default location
  - Optional `--register <name>` to pick a context register defined in the profile
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
- No profile present → the run stops and points the user at `/twt-write-as-me-analysis`, with concrete advice on how much text to feed it. It never quietly falls back to a generic voice.
- Profile present → its directives bind the output; every "Never" is respected and no "tell of a fake" appears.
- Rate-governed imperfections land inside their stated bands, placed at genuine opportunities the profile names — never sprinkled at random, never applied uniformly.
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

**If no profile exists, stop and say so.** Do not proceed with a generic voice — the whole point of the skill is the profile, and text written without one is worse than no text, because it looks like it succeeded.

Tell the user:

```
No writing-style profile found at <path>.

Run /twt-write-as-me-analysis first, and give it as much of your own writing as you can.
Volume and variety both matter: aim for 5+ separate pieces, 1500+ words total, across at
least two contexts (emails, chat, docs, posts, commit messages). Raw and unedited beats
polished — anything a copy-editor touched will blur the fingerprint this depends on.
```

Then offer via **AskUserQuestion** (single-select, header "Profile"):
- **Run the analysis now** (recommended) — dispatch `/twt-write-as-me-analysis` (Agent tool, CONVENTIONS §5), let it collect samples, then continue this run with the profile it produced
- **Point me at a profile** — plain-text prompt for a path, then re-resolve
- **Cancel** — stop here
- **You decide**

If a profile exists but is marked `Corpus band: Thin` or `Profile confidence: Low`, proceed — but say once, up front, that fidelity will be rough and more samples would fix it. Do not repeat the warning after the output.

## Step 2 — Determine mode and target

Read `$ARGUMENTS` and classify:

| Input | Mode | Output goes to |
|-------|------|----------------|
| A path that resolves to a file | **Rewrite file** | that file, rewritten in place |
| Pasted text to rework | **Rewrite text** | chat |
| A topic, brief, or instruction ("write a follow-up to X") | **Generate** | chat |

If `$ARGUMENTS` is empty, ask one plain-text question: what to write, or what to rewrite.

If the classification is genuinely ambiguous — say a path-like string that does not resolve — ask via **AskUserQuestion** (header "Mode") rather than guessing, because the two modes differ in whether a file gets overwritten.

**Rewrite-file mode.** Read the file first. Before writing, confirm the overwrite via **AskUserQuestion** (header "Overwrite"): **Rewrite in place** (recommended) · **Write beside it as `<name>.as-me.<ext>`** · **Show in chat only** · **You decide**. Preserve the file's structure exactly — headings, list nesting, code fences, front matter, links, and any markup stay put; only the prose inside them changes. Never touch code blocks.

**Preserve substance in both rewrite modes.** Every fact, number, name, date, link, and commitment in the source must appear in the output. This skill changes how something is said, never what is said. If the source contains a claim you believe is wrong, leave it alone and mention it in the report.

## Step 3 — Load the profile as binding instructions

Read the whole profile and treat it as instructions for this run, not as background reading. Section references below (`§2`, `§6`, `§10`, …) point at the **profile's** sections, not this repo's CONVENTIONS. Extract, before drafting:

- **§10 Always / Never / Tells of a fake** — the hard constraints
- **§10 Rate-governed table** and **§6** — the firing rules, with their must-NOT-fire conditions
- **§2 sentence architecture** — the target median, range, and opening-move distribution
- **§3 reasoning flow** — the opening move, argument order, and closing move to imitate
- **§4 lexicon** — words to reach for, and the negative lexicon to avoid
- **§5 punctuation** and **§8 formatting**
- **§11 calibration passage** — read this last and closest; it is the worked example, and matching its feel is a better target than satisfying the rules one at a time

**Pick the register (§7).** Use `--register <name>` if given. Otherwise infer from the target medium and say which you chose. If the profile has no register matching the medium, use the **invariant core** the profile names and say so — do not extrapolate a register from a context the corpus never covered.

**Note the coverage gaps** recorded in the profile's Evidence base. If the request falls into a gap, flag it once in the report; the output there is an extrapolation.

## Step 4 — Draft for fidelity

Write the draft applying the profile. Discipline that matters:

**Structure first, surface second.** Match §2 sentence lengths and §3 reasoning flow before worrying about vocabulary. A paragraph with the author's words in a generic shape reads more fake than the reverse — shape is what people actually recognize.

**Do the rate arithmetic; do not improvise it.** For each rule in the §10 rate-governed table:
1. Count the **opportunities** the draft contains for that rule.
2. Multiply by the stated rate and round to the nearest whole number — that is the target count.
3. Place exactly that many, at opportunities matching the §6 "fires when" column.
4. Never place one where the "must NOT fire" column excludes it.

If the arithmetic rounds to **zero** — common in a short piece — then zero is correct. Do not force an imperfection in to make the text look authentic. A clean three-sentence message from an author who drops articles 20% of the time is a perfectly plausible three-sentence message.

**Never invent an imperfection that is not in §6.** Errors outside the documented set are not fidelity, they are damage. This is the difference between reproducing a fingerprint and roughing text up.

**Never reproduce anything in §9.** Those are noise the analysis explicitly demoted.

**Explicit user instructions win.** If the user asks for something the profile contradicts — "make this one more formal", "keep it under 100 words" — follow the user, keep every profile rule the instruction does not touch, and note the deviation in the report.

## Step 5 — Fidelity self-check

Before delivering, audit the draft against the profile. One revision pass, then ship.

- **Never-list:** does the draft contain anything from §10 Never or the §4 negative lexicon? Remove it.
- **Tells of a fake:** walk the §10 list item by item against the actual draft. This is where generic prose survives — the em-dash clause pair, the tricolon, the tidy summarizing close. Cut what you find.
- **Rate audit:** for each §6 rule, recount opportunities and placements in the finished draft. Inside the band? Over-application reads as parody; under-application reads as an editor got there first.
- **Sentence metrics:** is the median length near §2's? Is the length *variance* right? Uniform sentence length is itself a tell, even at the correct median.
- **Opening and closing:** do they use the §3 moves, or the moves a model defaults to?
- **Rewrite modes only:** is every fact, number, name, link, and commitment from the source still present?

## Step 6 — Deliver and report

**Rewrite-file mode:** write the file (Edit or Write per the Step 2 choice), then report the path and confirm whether it was rewritten in place or written beside the original.

**Rewrite-text and Generate modes:** return the text in chat, as the finished text only — no preamble, no "here's your text in your voice", no commentary above it.

Then, below the output or after the file path, report briefly:
- Profile used (path), its confidence band, and the register applied
- Which rate-governed rules fired, how many times, against how many opportunities
- Any deviation from the profile the user's own instructions caused
- Any coverage gap the request fell into
- For rewrites: anything preserved deliberately (a claim you doubted, an awkward line that is actually the author's habit)
