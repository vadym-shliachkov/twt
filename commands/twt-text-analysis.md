---
name: twt-text-analysis
category: content
description: (v1.2.3) Block-by-block text-quality analysis (11 metrics incl. substantiation) — read-only scored report with suggested rewrites; never applies changes
version: 1.2.3
accepts_arguments: true
inputs:
  - Optional subject (file path or pasted text); optional scope hint
dependencies:
  hard: []
  soft: []
reads:
  - the subject text (user-supplied file or pasted text, or a .twt-artifacts content artifact)
  - .twt-artifacts/pre-design/brand/brand-brief.md
writes:
  - .twt-artifacts/content/text-analysis/<subject-slug>/analysis-report.md
  - .twt-artifacts/content/text-analysis/<subject-slug>/optimized.md
---

# /twt-text-analysis

## Intent

**Purpose:** Analyze text quality using Information Style and UX-writing principles — split the content into logical blocks, score each block independently on **11 metrics** (including a dedicated **Substantiation** check that punishes claims made without proof), and produce a scored, read-only report that explains every weakness and proposes an improved version where needed. This skill **only analyzes**; applying the suggestions is a separate, explicit call.

**Non-goals:**
- **Never applies changes.** It does not modify the subject file, does not ask whether to replace text with the suggestions, and does not "switch to auto-apply." Implementing the suggested copy is a **different call** — `/twt-content-optimize` (rewrite a text file) or `/twt-content-approval-implement` (push approved content into the build). This skill stops at the report.
- Doesn't invent facts, numbers, deadlines, features, or change business logic / legal wording (see Rewrite rules — these still bind the *suggested* versions it writes)
- Doesn't do the pipeline's content **curation** (keep/skip/elevate) — that's `/twt-curation-define`; this skill judges the **writing quality** of given text
- Doesn't audit IA/sitemap coverage or built-page lorem (that's `/twt-qa-content`)

**Success criteria:**
- The content is split into independently-scored **blocks** (heading, paragraph, list, CTA, button text, error message, hint text, description, feature explanation)
- Each block carries all **11 metric scores (0–100%)** + a weighted **Overall (0–100)**, a **Weaknesses** list, a **Recommendation** keyed to the rewrite threshold, and a **Suggested Version** only when a rewrite is warranted (a block scoring ≥ 85 carries **no** Suggested Version block at all)
- Slogan-style or "bold statement" copy that asserts a problem or benefit **without any proof** (mechanism, number, example, named consequence) is treated as a weakness, not as strong writing — the **Substantiation** metric makes the critique bite instead of rewarding punchy emptiness
- Two artifacts are written and **nothing else changes**: `analysis-report.md` (the scored critique) and `optimized.md` (the suggested rewrites assembled into one document, clearly labelled as *proposed, not applied*). The subject file is left untouched in every mode.
- The suggested versions honor the Rewrite rules: meaning, facts, and legal wording survive verbatim; missing facts are flagged with `> NEEDS:` markers, never invented

---

Arguments passed to this command: $ARGUMENTS

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Subject & settings
Parse `$ARGUMENTS` (strip and remember a `subagent-collect` token first — collect mode, see Step 6). The legacy `auto`/`manual` mode tokens are **accepted but ignored** — this skill never applies changes, so there is no apply mode to choose; do **not** ask a mode question.
- A path to an existing file → read it as the subject.
- Something that **looks like** a path (extension/slashes) but doesn't exist → don't analyze the path string; say the file wasn't found and prompt for a correction (in collect mode, write the question to `decisions.md` and stop).
- An `http(s)://` URL → abort with: "Fetch the page first with `/twt-content-fetch-site`, then analyze the saved markdown."
- Any other non-trivial text → treat the text itself as the subject.
- Empty → prompt (plain text, free-form): "Paste the text to analyze, or give a file path." In collect mode, write the missing-subject question to `decisions.md` and stop.

Derive a kebab-case `<subject-slug>` (file name sans extension, or the first words of pasted text). If the subject is pasted text, persist it verbatim to `.twt-artifacts/content/text-analysis/<subject-slug>/source.md` so the analysis points at a file on disk.

Read `.twt-artifacts/pre-design/brand/brand-brief.md` if present — brand voice is **context, not a metric**: copy that is intentionally on-voice isn't penalised as cliché unless it is also empty of meaning. Analyze in the subject's own language; the metrics are language-agnostic.

## Step 2 — Split into blocks

If the subject is a file on disk (not pasted text), run (Bash) to segment it deterministically:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/split-blocks.mjs" "<subject-file-path>"
```
This outputs JSON `[{n, type, text}]` segmenting by structure: Heading (ATX `#`), Paragraph, List, Code, Blockquote. Use this as the authoritative block list. For pasted text that is not a file, split by hand: **Heading · Paragraph · List · CTA · Button text · Error message · Hint text · Description · Feature explanation**. After obtaining the block list, re-type each block's type using semantic intent: a short Paragraph ending in a verb phrase is likely a CTA; ≤8-word standalone text in a button context is Button text. Keep these semantic re-classifications minimal — the structural type is correct for most blocks. Number blocks 1-indexed.

## Step 3 — Score the 11 metrics (per block)
Score **each block** on every metric. Each metric has **0–4 anchors** (0 Poor · 1 Weak · 2 Acceptable · 3 Good · 4 Excellent); report each as a **percentage 0–100** (the anchors guide judgment; interpolate for in-between quality). A metric that genuinely doesn't apply to a block type (e.g. Scanability for a 4-word button) is marked **N/A** and its weight is redistributed proportionally across the rest for that block.

| # | Metric | Weight | Question — what "good" means | Negative signals (penalise) |
|---|--------|-------:|------------------------------|------------------------------|
| 1 | **User Value** | 18 | Does the block explain value **for the user**? User benefit exists, the result is understandable, focus is not on company achievements. | "leader of the market", "innovative solutions", "professional team", "high quality services" |
| 2 | **Specificity** | 13 | Are statements measurable and concrete — numbers, deadlines, examples, limitations, exact actions? | "quickly", "efficiently", "conveniently", "quality", "reliable" used without explanation |
| 3 | **Clarity** | 13 | Can an average reader understand it immediately — simple language, short sentences, no jargon, no bureaucratic style? | complicated structures, corporate language, ambiguous terms |
| 4 | **Conciseness** | 9 | Can it be shorter without losing meaning? | filler phrases, repetitions, introductory constructions, weak adjectives, unnecessary words |
| 5 | **Active Voice** | 9 | Is the subject performing the action? ("Create account") | passive constructions ("Account should be created") |
| 6 | **Scanability** | 9 | Can users quickly scan — headings, lists, short paragraphs, highlighted key info? | large text walls |
| 7 | **Action Clarity** | 9 | Does the user know what to do next — obvious action, understandable CTA, clear next step? | vague buttons, unclear instructions |
| 8 | **Substantiation** | 10 | Is every claim **backed by proof** — a mechanism, a number, a concrete example, or a named consequence? A bold assertion the reader is simply asked to believe is the failure mode this catches. | slogan-style claims with no evidence ("Everyone optimizes a part. Nobody fixes the system.", "We think differently", "Built for the future"); sweeping generalisations ("everyone", "nobody", "always") used rhetorically; problem/benefit stated but never demonstrated |
| 9 | **Content Density** | 5 | How much useful information per block? (Bad: "world-class innovative solutions." Good: "Generate reports in less than 30 seconds.") | marketing clichés, empty claims, emotional exaggerations |
| 10 | **Transparency** | 3 | Are restrictions and important conditions explicitly stated — limitations, deadlines, pricing conditions, requirements? | hidden restrictions |
| 11 | **Information Hierarchy** | 2 | Is the most important info first? Ideal order: Result → Action → Details → Conditions → Additional info. | long introductions before the actual message |

**Substantiation is the critical-reading metric.** Do not reward copy just because it is punchy, confident, or on-brand. A line like *"Everyone optimizes a part. Nobody fixes the system."* is rhetorically strong but evidence-free — it scores **low** on Substantiation (and usually on User Value and Specificity too) and **must** appear in Weaknesses as `unsubstantiated claim — no proof (Substantiation)`. The remedy in the Suggested Version is to attach the missing proof (or a `> NEEDS:` marker for it per the Rewrite rules), never to keep the empty assertion.

**Overall (per block)** = Σ(metric% × weight) / 100, rounded — a 0–100 score. For N/A metrics, rescale the remaining weights so they still total 100 for that block. Also compute a **document Overall** = the mean of the block Overalls (note it; the per-block scores drive every rewrite decision).

## Step 4 — Recommendation per block (rewrite threshold)
Map each block's Overall to a recommendation:
- **≥ 85** → *No rewrite required.*
- **70–84** → *Minor improvements suggested.*
- **50–69** → *Rewrite recommended.*
- **< 50** → *Rewrite strongly recommended.*

For every block scoring **< 85**, generate a **Suggested Version** following the Rewrite rules (below). For 85+, emit no `Suggested Version` section at all — the block ends at its `Recommendation: No rewrite required` line (do not print a "— (no rewrite required)" placeholder).

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
Substantiation ...... <0-100>
Content Density ..... <0-100>
Transparency ........ <0-100>
Information Hierarchy <0-100>
Overall ............. <0-100>

Weaknesses:

- <specific weakness, tied to a metric — e.g. "vague statement (Specificity)", "unnecessary adjectives (Conciseness)", "value is not measurable (User Value)", "unsubstantiated claim — no proof (Substantiation)">

Recommendation:

<No rewrite required | Minor improvements suggested | Rewrite recommended | Rewrite strongly recommended>

Suggested Version:

<rewritten block>
```

**The `Suggested Version:` section is emitted only when the block scored below 85** (a rewrite is warranted). For a block scoring **≥ 85**, end the block at the `Recommendation:` line (`No rewrite required`) and **omit the `Suggested Version:` heading entirely** — never print a placeholder like "— (no rewrite required)". For a ≥ 85 block, `Weaknesses` may also be omitted or read `- none`.

Open the report with a header (subject label · mode · document Overall · block count · how many blocks scored < 85) and a one-row-per-block summary table (`| Block | Type | Overall | Recommendation |`). A block scoring ≥ 85 still appears (Scores + "No rewrite required"), but with no Weaknesses list padding and no Suggested Version section.

## Step 6 — Write the outputs (analysis only — never apply)
This skill is **read-only with respect to the subject**. In every mode — standalone, collect, or however it was invoked — it does exactly this and **never asks whether to apply or replace anything**:

1. Write the report (Step 5) to `analysis-report.md`.
2. Assemble the suggested rewrites into `optimized.md`: for each block scoring **< 85** use its Suggested Version; for blocks scoring ≥ 85 keep the original verbatim. Open the file with a clear banner — `> Proposed rewrites — NOT applied. Implement with /twt-content-optimize (file) or /twt-content-approval-implement (build).` — so it can never be mistaken for the live copy.
3. **Do not** modify the subject file. **Do not** offer to. There is no "apply" question, no "replace source file" question, and no persisted auto-apply setting.

If a previous `optimized.md` exists, just regenerate it (it is a derived artifact, safe to overwrite). The optional `auto`/`manual` tokens change nothing here.

## Step 7 — Report
State: the document Overall, how many blocks scored below 85, the two files written (`analysis-report.md`, `optimized.md`) with their paths, and — explicitly — that **no source text was changed**. End with the next-step pointer: "To implement these suggestions, run `/twt-content-optimize <file>` (to rewrite a text file) or, for built pages, approve the copy and run `/twt-content-approval-implement`."

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
