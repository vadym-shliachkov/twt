---
name: twt-text-analysis
category: content
description: (v1.3.1) Block-type-aware text-quality audit with class-tagged validated suggestions only; never applies changes
version: 1.3.1
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
  - .twt-artifacts/pre-design/content/text-analysis/<subject-slug>/analysis-report.md
  - .twt-artifacts/pre-design/content/text-analysis/<subject-slug>/analysis-report.xlsx
  - .twt-artifacts/pre-design/content/text-analysis/<subject-slug>/optimized.md
---

# /twt-text-analysis

## Intent

**Purpose:** Analyze text quality block by block using Information Style, UX-writing, and critical-reading principles. Claude must separate analysis from rewriting: first score the block, then decide whether a safe improvement is possible, and only then suggest wording if the rewrite clearly fixes a detected weakness.

**Non-goals:**
- **Never applies changes.** It does not modify the subject file, does not ask whether to replace text with the suggestions, and does not "switch to auto-apply." Implementing suggested copy is a different call: `/twt-content-optimize` (rewrite a text file) or `/twt-content-approval-implement` (push approved content into the build). This skill stops at the report.
- Does not invent facts, numbers, deadlines, features, proof points, source labels, or change business logic / legal wording.
- Does not rewrite protected content automatically: mission statements, vision statements, slogans, legal text, quotations, product names, company names, or brand positioning statements.
- Does not do the pipeline's content curation (keep/skip/elevate) - that's `/twt-curation-define`; this skill judges the writing quality of given text.
- Does not audit IA/sitemap coverage or built-page lorem - that's `/twt-qa-content`.

**Success criteria:**
- The content is split into independently scored blocks and each block is assigned a semantic type: heading, paragraph, mission/vision/brand positioning, CTA, caption, error message, list, hint text, description, or feature explanation.
- Each block is scored only on metrics that apply to its type; irrelevant metrics are marked N/A and never used as a reason to rewrite.
- Every finding is classified as **Problem**, **Opportunity**, or **No issue**, with a confidence score and a clear reason.
- A rewrite appears only when it safely fixes at least one detected weakness, improves at least one relevant metric by 10+ points, does not worsen any relevant metric, preserves meaning, avoids invented facts, sounds natural, and is not merely a stylistic preference.
- When no better wording is available, the report says exactly: `Suggested Version: No better wording found.` and `Decision: Keep original.` This is a valid successful outcome.
- Three derived artifacts are written and nothing else changes: `analysis-report.md` (the scored critique), `analysis-report.xlsx` (the same per-block findings as a sortable/filterable spreadsheet), and `optimized.md` (validated proposed rewrites assembled into one document, clearly labelled as proposed, not applied). The subject file is left untouched in every mode.

---

Arguments passed to this command: $ARGUMENTS

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.

## Step 1 - Subject and settings

Parse `$ARGUMENTS`:

- Strip and remember `subagent-collect` first. In collect mode, do not prompt; write unresolved input questions to `decisions.md` and stop.
- Strip and remember a leading `auto` or `manual` token if present. These tokens never allow source edits. `auto` uses the strictest suggestion gate; `manual` may report lower-confidence opportunities, but still must not invent a rewrite.
- A path to an existing file -> read it as the subject.
- Something that looks like a path (extension/slashes) but does not exist -> do not analyze the path string; say the file was not found and prompt for a correction. In collect mode, write the question to `decisions.md` and stop.
- An `http(s)://` URL -> abort with: "Fetch the page first with `/twt-content-fetch-site`, then analyze the saved markdown."
- Any other non-trivial text -> treat the text itself as the subject.
- Empty -> prompt (plain text, free-form): "Paste the text to analyze, or give a file path." In collect mode, write the missing-subject question to `decisions.md` and stop.

Derive a kebab-case `<subject-slug>` from the file name or the first words of pasted text. If the subject is pasted text, persist it verbatim to `.twt-artifacts/pre-design/content/text-analysis/<subject-slug>/source.md` so the analysis points at a file on disk.

Read `.twt-artifacts/pre-design/brand/brand-brief.md` if present. Brand voice is context, not a metric: copy that is intentionally on-voice is not penalized as cliche unless it is also empty of meaning. Analyze in the subject's own language; the metrics are language-agnostic.

## Step 2 - Split into blocks

If the subject is a file on disk, run Bash to segment it deterministically:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/split-blocks.mjs" "<subject-file-path>"
```

This outputs JSON `[{n, type, text}]` segmenting by structure: Heading, Paragraph, List, Code, Blockquote. Use it as the authoritative starting block list.

For pasted text that is not a file, split by hand into logical blocks. After obtaining the block list, re-type each block by semantic intent:

- **Heading:** page headings, section headings, card headings.
- **Paragraph:** body paragraphs, descriptions, explanatory text.
- **Mission / Vision / Brand positioning:** mission statements, vision statements, slogans, company principles, brand positioning lines.
- **CTA:** text links, buttons, call-to-action headings.
- **Caption:** image captions, credits, source labels.
- **Error message:** errors, warnings, validation messages.
- **List / hint / description / feature explanation:** use the closest evaluator below, usually Paragraph unless the block clearly behaves as CTA, Caption, or Error message.

Number blocks 1-indexed. Keep semantic re-classifications minimal and explain any judgment call in the block's `Purpose`.

## Step 3 - Analyze with block-type-specific metrics

Score only the metrics that apply to the block type. Each metric is 0-100; use N/A for metrics that do not apply. Compute **Overall** as the weighted average of applicable metrics only. A low score is evidence for analysis, not permission to rewrite.

### Evaluators

| Block type | Applicable metrics | Special scoring rules |
|---|---|---|
| Heading | Clarity, Scanability, Information Hierarchy, Discoverability, Expectation Match | Do not score Active Voice, Transparency, Substantiation, or User Value unless the heading is also a CTA. |
| Paragraph | User Value, Clarity, Conciseness, Specificity, Content Density, Credibility, Transparency, Information Hierarchy; optional Active Voice; optional Action Clarity | Use Active Voice only when passive construction hurts clarity. Use Action Clarity only when the paragraph asks the reader to do something. |
| Mission / Vision / Brand positioning | Clarity, Memorability, Credibility, Conciseness, Brand Fit, Meaning Preservation | Do not heavily penalize broad goals, aspirational wording, lack of numbers, or lack of proof points. Specificity is N/A or low-weight unless the sentence makes a concrete factual claim. |
| CTA | Action Clarity, Destination Clarity, Motivation, Conciseness, Accessibility | Heavily penalize vague labels such as "Read more", "Learn more", and "Get started" when the destination is not predictable from context. |
| Caption | Accuracy, Clarity, Conciseness, Attribution Completeness | Do not rewrite unless the caption is inaccurate, unclear, or unnecessarily long. |
| Error message | Problem Clarity, Recovery Guidance, Tone, Actionability, Specificity | Penalize messages that do not explain what went wrong, how to fix it, or that blame the user. |

### Metric anchors

Use these anchors for every applicable metric:

- **0-39:** Problem prevents understanding, trust, or action.
- **40-59:** Weak; reader can infer meaning, but effort or ambiguity is high.
- **60-79:** Acceptable; meaning is clear enough, but a concrete improvement exists.
- **80-89:** Good; only small opportunities remain.
- **90-100:** Excellent for the block's purpose.

Substantiation and Credibility are critical-reading metrics. Do not reward copy just because it is punchy, confident, or on-brand. A slogan-style claim with no mechanism, example, named consequence, or proof may be a weakness in a paragraph or feature explanation. In a mission statement, broad aspirational language is often acceptable; do not rewrite it merely because it is broad.

## Step 4 - Decide whether a rewrite is possible

For each block, classify the finding:

- **Problem:** a real usability, clarity, trust, or comprehension issue that should usually be fixed, such as an unclear CTA, vague recovery path, ambiguous wording, hidden condition, or sentence too long to understand.
- **Opportunity:** a possible improvement that is not required, such as slightly shorter wording, a more direct heading, or an acceptable but broad brand phrase.
- **No issue:** no relevant weakness for this block type.

Then assign **Confidence**:

- **90-100:** Objective issue. Rewrite recommended if it passes validation.
- **70-89:** Strong recommendation.
- **50-69:** Possible improvement. Manual review only.
- **Below 50:** Subjective preference. Keep original.

### Rewrite eligibility rule

A block is eligible for a suggested rewrite only if all conditions are true:

1. At least one detected weakness is fixable.
2. The fix does not require invented information.
3. The rewrite improves at least one relevant metric by 10+ points.
4. The rewrite does not make any relevant metric worse.
5. The rewrite sounds natural to a native speaker.
6. The rewrite preserves the original meaning.
7. The rewrite is not only a stylistic preference.

If any condition fails, output:

```text
Suggested Version: No better wording found.
Decision: Keep original.
Reason: The detected issue cannot be fixed safely without additional information or would only produce a stylistic preference.
```

### Decision tree

Use this exact logic:

```text
if no relevant weakness:
    Decision = Keep original
    Suggested Version = No better wording found
else if weakness cannot be fixed without inventing facts:
    Decision = Keep original
    Suggested Version = No better wording found
else if block is mission/vision/brand positioning and weakness is only broadness:
    Decision = Keep original
    Suggested Version = No better wording found
else if confidence < 70:
    Decision = Keep original or Manual review only
    Suggested Version = No better wording found
else if rewrite fails validation:
    Decision = Keep original
    Suggested Version = No better wording found
else:
    Decision = Rewrite recommended
    Suggested Version = [validated rewrite]
```

In `auto` mode and collect-mode pipeline runs, be stricter: write a suggested version only when Finding Type is **Problem**, Confidence is 70+, the rewrite passes validation, at least one applicable metric improves by 10+ points, no metric gets worse, and the block is not protected content. In `manual` mode, lower-confidence opportunities may be described, but the original remains acceptable and the suggested version must still be omitted unless validated.

## Step 5 - Validate every suggested rewrite

Before outputting a suggested version, validate it against all checks:

- Solves at least one reported weakness.
- Preserves original meaning.
- Avoids invented facts.
- Sounds natural to a native speaker.
- Is at least as clear as the original.
- Is at least as concise as the original, unless extra clarity is needed.
- Avoids replacing good brand voice with generic wording.
- Would most UX writers likely agree it is an improvement.

If two or more checks fail, do not suggest the rewrite. If Claude cannot write a clear weakness-to-fix mapping, do not suggest the rewrite.

Every suggested rewrite must include:

```markdown
Weakness-To-Fix Mapping:

- Weakness: <detected weakness>
  Rewrite Action: <what changed>
  Expected Metric Improvement: <metric name> +<points>
```

Do not use `> NEEDS:` markers as a fake rewrite. Missing facts belong in `Weaknesses` and `Reason`; the suggested version remains `No better wording found.`

## Step 6 - Write the report

Write `.twt-artifacts/pre-design/content/text-analysis/<subject-slug>/analysis-report.md`. Open with a header containing subject label, mode (`auto`, `manual`, `collect`, or default), document Overall, block count, how many Problems, how many Opportunities, and how many validated suggested versions. Add a one-row-per-block summary table:

```markdown
| Block | Type | Overall | Finding Type | Decision | Class | Confidence |
```

For each block, use exactly this structure:

```markdown
## Block <n> -- <type>

Purpose:
<what this block is supposed to do>

Original:
<verbatim text>

Applicable Metrics:
- <Metric>: <0-100 or N/A> - <one-line evidence>

Overall:
<number>/100

Finding Type:
Problem | Opportunity | No issue

Decision:
Rewrite recommended | Minor improvement suggested | Manual review only | Keep original

Class:
consistency | factual | style | none

Weaknesses:
- <weakness tied to a metric, or "none">

Can Fix Safely:
Yes | No

Reason:
<why rewrite is or is not safe/useful>

Suggested Version:
<new version OR "No better wording found.">

Rewrite Validation:
- Solves reported weakness: Yes/No
- Preserves meaning: Yes/No
- Avoids invented facts: Yes/No
- Sounds natural: Yes/No
- Meaningful improvement: Yes/No

Confidence:
<number>%
```

If `Suggested Version` contains a new version, immediately follow it with the `Weakness-To-Fix Mapping` block from Step 5. If there is no validated rewrite, `Rewrite Validation` may use `N/A` for checks that were not attempted, but it must still explain the gate failure in `Reason`.

For opportunities, use this wording in `Reason`: `Optional improvement. Original is acceptable.`

**Class** tags what kind of fix a validated rewrite is, so downstream can decide whether to apply it automatically:
- `consistency` — resolves an internal inconsistency: the same fact, term, or figure stated two different ways (e.g. "2,000+ clients" one place and "2,000+ engagements" another).
- `factual` — corrects a claim that contradicts the source or the `facts.md` ledger, or an unsupported / fabricated number.
- `style` — a clarity, brevity, or voice improvement that is a preference, not a defect.
- `none` — Decision is Keep original (no rewrite).

`consistency` and `factual` rewrites fix defects and are **apply-by-default** when an applying skill runs (`/twt-content-optimize`, `/twt-content-approval-implement`, or an orchestrator's post-Design pass); `style` rewrites stay opt-in. This skill still only *reports* — it never edits the subject — but the class tells the applier what to do.

## Step 7 - Write optimized.md (analysis only, never apply)

This skill is read-only with respect to the subject. In every mode, it does exactly this and never asks whether to apply or replace anything:

1. Write the report from Step 6 to `analysis-report.md`.
2. Assemble `optimized.md`: for each block with `Decision: Rewrite recommended` and a validated new `Suggested Version`, use that suggested version; for every other block, keep the original verbatim.
3. Open `optimized.md` with this banner: `> Proposed rewrites - NOT applied. Only blocks with validated, high-confidence improvements were changed. Implement with /twt-content-optimize (file) or /twt-content-approval-implement (build).`
4. Do not modify the subject file. Do not offer to. There is no source replacement question.

If a previous `optimized.md` exists, regenerate it; it is a derived artifact, safe to overwrite.

## Step 7b - Write the analysis workbook (analysis-report.xlsx)

Always emit a spreadsheet mirror of the report so reviewers can sort, filter, and colour-scan the findings. Do not build the workbook by hand — run the deterministic generator, which parses the `analysis-report.md` you just wrote:

```bash
python "${CLAUDE_PLUGIN_ROOT}/tools/analysis-to-xlsx.py" --input ".twt-artifacts/pre-design/content/text-analysis/<subject-slug>/analysis-report.md"
```

It writes `.twt-artifacts/pre-design/content/text-analysis/<subject-slug>/analysis-report.xlsx` — one row per block, with columns: **Block · Type · Score · Finding Type · Original · Suggested Version · Weaknesses · Can Fix Safely · Reason · Rewrite Validation · Confidence**. The `Finding Type` cell is colour-coded (green No issue · amber Opportunity · red Problem), the header row is frozen, and an auto-filter is applied. Because it reads the report, it must run after Step 6.

Environment notes (mirror `/twt-content-approval-checklist`): the script needs `openpyxl`. If it prints the missing-dependency hint, run `python -m pip install openpyxl` once and re-run; on Windows where `python` is unavailable but `py` exists, use `py`. If Python is unavailable entirely, note it and continue — the markdown artifacts remain the source of truth.

## Step 8 - Report back

State the document Overall, counts for Problems / Opportunities / validated suggested versions, the three files written (`analysis-report.md`, `analysis-report.xlsx`, `optimized.md`) with their paths, and explicitly that no source text was changed. End with the next-step pointer: "To implement validated suggestions, run `/twt-content-optimize <file>` or, for built pages, approve the copy and run `/twt-content-approval-implement`."

---

## Rewrite guardrails

Claude must preserve original meaning, facts, names, legal meaning, and brand voice. Claude may simplify wording, remove filler, clarify a vague CTA, improve recovery guidance, or shorten text only when the change directly fixes a detected weakness.

Claude must not invent numbers, proof points, dates, deadlines, testimonials, source labels, features, product behavior, or business logic. Claude must not replace strong original voice with generic copy. Claude must not produce a rewrite merely because the block scored below a threshold.

The goal is not to rewrite more text. The goal is to identify where content quality actually harms understanding, trust, or action. A good result can be: `No better wording found. Keep original.`
