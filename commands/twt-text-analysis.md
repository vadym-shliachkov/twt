---
name: twt-text-analysis
category: content
description: (v1.0.0) Block-by-block text-quality analysis (10 metrics) with a scored report and optional rewrite — manual review or automatic
version: 1.0.0
accepts_arguments: true
inputs:
  - Optional subject (file path or pasted text); optional mode (auto|manual); optional scope hint
dependencies:
  hard: []
  soft: []
reads:
  - the subject text (user-supplied file or pasted text, or a .twt-artifacts content artifact)
  - .twt-artifacts/content/text-analysis/config.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
writes:
  - .twt-artifacts/content/text-analysis/<subject-slug>/analysis-report.md
  - .twt-artifacts/content/text-analysis/<subject-slug>/optimized.md
  - .twt-artifacts/content/text-analysis/<subject-slug>/decisions.md
  - .twt-artifacts/content/text-analysis/config.md
  - the subject file in place (only with explicit user consent)
---

# /twt-text-analysis

## Intent

**Purpose:** Analyze text quality using Information Style and UX-writing principles — split the content into logical blocks, score each block independently on **10 metrics**, produce a scored report that explains every weakness, suggest improved versions where needed, and (optionally) rewrite the content automatically.

**Non-goals:**
- Doesn't invent facts, numbers, deadlines, features, or change business logic / legal wording (see Rewrite rules)
- Doesn't replace the source file silently — in-place writes require explicit consent; the optimized copy always lands in `.twt-artifacts/content/text-analysis/<subject-slug>/optimized.md` first
- Doesn't do the pipeline's content **curation** (keep/skip/elevate) — that's `/twt-curation`; this skill judges and improves the **writing quality** of given text
- Doesn't audit IA/sitemap coverage or built-page lorem (that's `/twt-qa-content`)

**Success criteria:**
- The content is split into independently-scored **blocks** (heading, paragraph, list, CTA, button text, error message, hint text, description, feature explanation)
- Each block carries all **10 metric scores (0–100%)** + a weighted **Overall (0–100)**, a **Weaknesses** list, a **Recommendation** keyed to the rewrite threshold, and a **Suggested Version** when a rewrite is warranted
- **Manual mode** shows every block needing change and waits for the user's action (KEEP_ORIGINAL / USE_SUGGESTED / USE_AND_ENABLE_AUTO / CUSTOM) before applying anything
- **Automatic mode** rewrites every block scoring below 85 and outputs the report, per-block scores, a change summary, and the final optimized content — no approval required
- Rewrite guardrails hold: meaning, facts, and legal wording survive verbatim unless the user explicitly allowed changes

---

Arguments passed to this command: $ARGUMENTS

---

## Step 1 — Subject, mode & settings
Parse `$ARGUMENTS` (strip and remember a `subagent-collect` token first — collect mode, see Step 6):
- A path to an existing file → read it as the subject.
- Something that **looks like** a path (extension/slashes) but doesn't exist → don't analyze the path string; say the file wasn't found and prompt for a correction (in collect mode, write the question to `decisions.md` and stop).
- An `http(s)://` URL → abort with: "Fetch the page first with `/twt-content-fetch-site`, then analyze the saved markdown."
- Any other non-trivial text → treat the text itself as the subject.
- Empty → prompt (plain text, free-form): "Paste the text to analyze, or give a file path." In collect mode, write the missing-subject question to `decisions.md` and stop.

Derive a kebab-case `<subject-slug>` (file name sans extension, or the first words of pasted text). If the subject is pasted text, persist it verbatim to `.twt-artifacts/content/text-analysis/<subject-slug>/source.md` so the analysis points at a file on disk.

Read `.twt-artifacts/content/text-analysis/config.md` for persisted settings (create it in this shape if absent; parse leniently):
```yaml
auto_optimize: true | false   # set true by USE_AND_ENABLE_AUTO; auto mode applies rewrites without approval
```

Resolve the **mode** — precedence: arguments > config > ask:
- `auto` in `$ARGUMENTS`, or `auto_optimize: true` in config → **Automatic mode**.
- `manual` in `$ARGUMENTS` → **Manual review mode**.
- Otherwise ask via the **AskUserQuestion** tool (single-select, header "Mode"):
  - **Manual review** — score every block, show suggestions, and wait for my action before changing anything (default).
  - **Automatic** — score and auto-rewrite every block below 85, then report; no approval.
  - **You decide** — I pick (defaults to Manual review).

Read `.twt-artifacts/pre-design/brand/brand-brief.md` if present — brand voice is **context, not a metric**: copy that is intentionally on-voice isn't penalised as cliché unless it is also empty of meaning. Analyze in the subject's own language; the metrics are language-agnostic.

## Step 2 — Split into blocks
Split the subject into **logical blocks**, each analyzed separately. A block is one of: **Heading · Paragraph · List · CTA · Button text · Error message · Hint text · Description · Feature explanation**. Use document structure (markdown headings, list markers, link/button labels, paragraph breaks) to segment. Number the blocks (Block 1, Block 2, …) and record each block's **type** and **verbatim original text**. Keep blocks at natural boundaries — do not merge a heading with the paragraph beneath it, and do not split a single list into per-item blocks.

## Step 3 — Score the 10 metrics (per block)
Score **each block** on every metric. Each metric has **0–4 anchors** (0 Poor · 1 Weak · 2 Acceptable · 3 Good · 4 Excellent); report each as a **percentage 0–100** (the anchors guide judgment; interpolate for in-between quality). A metric that genuinely doesn't apply to a block type (e.g. Scanability for a 4-word button) is marked **N/A** and its weight is redistributed proportionally across the rest for that block.

| # | Metric | Weight | Question — what "good" means | Negative signals (penalise) |
|---|--------|-------:|------------------------------|------------------------------|
| 1 | **User Value** | 20 | Does the block explain value **for the user**? User benefit exists, the result is understandable, focus is not on company achievements. | "leader of the market", "innovative solutions", "professional team", "high quality services" |
| 2 | **Specificity** | 15 | Are statements measurable and concrete — numbers, deadlines, examples, limitations, exact actions? | "quickly", "efficiently", "conveniently", "quality", "reliable" used without explanation |
| 3 | **Clarity** | 15 | Can an average reader understand it immediately — simple language, short sentences, no jargon, no bureaucratic style? | complicated structures, corporate language, ambiguous terms |
| 4 | **Conciseness** | 10 | Can it be shorter without losing meaning? | filler phrases, repetitions, introductory constructions, weak adjectives, unnecessary words |
| 5 | **Active Voice** | 10 | Is the subject performing the action? ("Create account") | passive constructions ("Account should be created") |
| 6 | **Scanability** | 10 | Can users quickly scan — headings, lists, short paragraphs, highlighted key info? | large text walls |
| 7 | **Action Clarity** | 10 | Does the user know what to do next — obvious action, understandable CTA, clear next step? | vague buttons, unclear instructions |
| 8 | **Content Density** | 5 | How much useful information per block? (Bad: "world-class innovative solutions." Good: "Generate reports in less than 30 seconds.") | marketing clichés, empty claims, emotional exaggerations |
| 9 | **Transparency** | 3 | Are restrictions and important conditions explicitly stated — limitations, deadlines, pricing conditions, requirements? | hidden restrictions |
| 10 | **Information Hierarchy** | 2 | Is the most important info first? Ideal order: Result → Action → Details → Conditions → Additional info. | long introductions before the actual message |

**Overall (per block)** = Σ(metric% × weight) / 100, rounded — a 0–100 score. For N/A metrics, rescale the remaining weights so they still total 100 for that block. Also compute a **document Overall** = the mean of the block Overalls (note it; the per-block scores drive every rewrite decision).

## Step 4 — Recommendation per block (rewrite threshold)
Map each block's Overall to a recommendation:
- **≥ 85** → *No rewrite required.*
- **70–84** → *Minor improvements suggested.*
- **50–69** → *Rewrite recommended.*
- **< 50** → *Rewrite strongly recommended.*

For every block scoring **< 85**, generate a **Suggested Version** following the Rewrite rules (below). For 85+, no suggested version (note "No rewrite required").

## Step 5 — Report
Write `.twt-artifacts/content/text-analysis/<subject-slug>/analysis-report.md`. Per block, use exactly this structure:

```markdown
## Block <n> — <type>

Original:

<verbatim text>

Scores:

User Value .......... <0-100>
Specificity ......... <0-100>
Clarity ............. <0-100>
Conciseness ......... <0-100>
Active Voice ........ <0-100>
Scanability ......... <0-100>
Action Clarity ...... <0-100>
Content Density ..... <0-100>
Transparency ........ <0-100>
Information Hierarchy <0-100>
Overall ............. <0-100>

Weaknesses:

- <specific weakness, tied to a metric — e.g. "vague statement (Specificity)", "unnecessary adjectives (Conciseness)", "value is not measurable (User Value)">

Recommendation:

<No rewrite required | Minor improvements suggested | Rewrite recommended | Rewrite strongly recommended>

Suggested Version:

<rewritten block, or "— (no rewrite required)">
```

Open the report with a header (subject label · mode · document Overall · block count · how many blocks scored < 85) and a one-row-per-block summary table (`| Block | Type | Overall | Recommendation |`). A block scoring ≥ 85 still appears (Scores + "No rewrite required"), without a Suggested Version.

## Step 6 — Apply (mode-dependent)

### Collect mode (`subagent-collect` in `$ARGUMENTS`)
Never call AskUserQuestion. Produce the report (Step 5) and write the **optimized** content to `optimized.md` (apply suggested versions for every block < 85; keep 85+ blocks verbatim). Record the open decisions — mode, and "apply optimized copy to the source file?" — in `.twt-artifacts/content/text-analysis/<subject-slug>/decisions.md` (frontmatter `status: open`; `## Open questions` with options + model-leaning), and return the summary. Do not loop on the user.

### Manual review mode
Show **every block requiring a change** (Overall < 85): its Original, Problems (weaknesses), Metrics, and Suggested Version. After showing all of them, ask via the **AskUserQuestion** tool (single-select, header "Apply"):
- **KEEP_ORIGINAL** — leave all text unchanged; write the report only.
- **USE_SUGGESTED** — apply all suggested versions.
- **USE_AND_ENABLE_AUTO** — apply all suggested versions **and** persist `auto_optimize: true` to `config.md` so future runs optimize automatically.
- **CUSTOM** — I'll take additional instructions.
- **You decide** — I apply the suggestions I'm confident improve the text (skipping risky/ambiguous ones) and report exactly what changed.

A free-typed answer (or **CUSTOM**) is treated as constraints — examples: "keep marketing tone", "rewrite only headings", "do not shorten", "keep formal language", "apply only block 2 and 4". **Re-run the analysis under those restrictions** (re-score and regenerate suggested versions honoring them), then show the blocks and ask again (max 2 such loops, then report and stop).

After applying, write the result to `optimized.md`. Then ask via **AskUserQuestion** (single-select, header "Source file") whether to **also replace the source file in place** — only when the subject was a file, never in collect mode, never defaulting to yes.

### Automatic mode
Automatically rewrite every block scoring **< 85** (Rewrite rules apply), leave 85+ blocks unchanged, and write `optimized.md`. Output, with **no approval**: (1) the overall report, (2) per-block scores, (3) a summary of changes, (4) the final optimized content. In-place source replacement is still **not** automatic — if the subject was a file, mention the optimized path and that `/twt-text-analysis <file> manual` (or an explicit consent) is needed to overwrite the source.

## Step 7 — Write outputs & persist settings
- `analysis-report.md` and (when any rewrite was applied) `optimized.md` live under `.twt-artifacts/content/text-analysis/<subject-slug>/`. If a previous run's `optimized.md` exists, confirm before overwriting (rule 10 spirit) — except in collect/auto where it is regenerated.
- Persist any settings change (`auto_optimize`) to `.twt-artifacts/content/text-analysis/config.md`.

## Step 8 — Report
State: mode used **and where it came from** (argument / config / asked), the document Overall, how many blocks were below 85 and how many were rewritten, the files written (paths), whether the source file was replaced in place, and any persisted setting. If the mode came from `auto_optimize: true`, add: "Automatic optimization is persisted in `.twt-artifacts/content/text-analysis/config.md` — pass `manual` to override once, or edit the file to switch back."

---

## Rewrite rules
When generating suggested versions, the skill **must**:
- preserve the original meaning
- prefer simple words
- remove filler
- replace abstractions with facts (only facts already present in the source — never invented)
- use active voice
- focus on user benefit
- improve scanability
- shorten text when possible
- preserve legal meaning

The skill **must not**:
- invent numbers
- invent deadlines
- invent features
- change business logic
- remove important conditions

These guardrails are binding in every mode and at every rewrite. Where a low score is caused by **missing** information (e.g. Specificity needs a number the source doesn't contain), do **not** fabricate it — note it as a Weakness and, in the Suggested Version, leave a `> NEEDS: <what fact is missing>` marker instead of a made-up value.
