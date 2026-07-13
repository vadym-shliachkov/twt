---
name: twt-content-optimize
category: content
description: (v1.2.2) Score then rewrite text for clarity, brevity, and UX-writing quality — auto or per-suggestion
version: 1.2.2
accepts_arguments: true
inputs:
  - Optional subject (file path or pasted text); optional mode (auto|manual) and level (light|standard|aggressive)
dependencies:
  hard:
    - twt-content-validate
  soft: []
reads:
  - the subject text (user-supplied file or pasted text, or a .twt-artifacts content artifact)
  - .twt-artifacts/content-quality/content-config.md
  - .twt-artifacts/content-quality/validation/<subject-slug>/validation-report.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
writes:
  - .twt-artifacts/content-quality/subject/<subject-slug>.md
  - .twt-artifacts/content-quality/optimized/<subject-slug>.md
  - .twt-artifacts/content-quality/validation/<subject-slug>/validation-report-before.md
  - .twt-artifacts/content-quality/validation/<subject-slug>/validation-report-after.md
  - .twt-artifacts/content-quality/optimization-report.md
  - .twt-artifacts/content-quality/content-config.md
  - the subject file in place (only with explicit user consent)
---

# /twt-content-optimize

## Intent

**Purpose:** Improve a text using the `/twt-content-validate` rubric as the rating engine — score before, rewrite (whole-text in auto mode, or per-suggestion with user review in manual mode), score after, and report the delta with the reasoning behind every change.

**Non-goals:**
- Doesn't invent facts, change business logic, or alter numbers/dates/prices/legal wording without explicit instruction
- Doesn't replace the source file silently — in-place writes require explicit consent; the optimized copy always lands in `.twt-artifacts/content-quality/optimized/` first
- Doesn't re-implement the rubric — scoring is dispatched to `/twt-content-validate` (rule 5)

**Success criteria:**
- `optimization-report.md` shows a before/after Scorecard delta (per criterion and total Health) plus a change log explaining each edit and the criterion it serves
- In manual mode, nothing is applied before the user decides (keep / apply all / apply selected / apply + switch to auto), via `AskUserQuestion`
- "Switch to auto" persists `content_review_mode: auto` to `.twt-artifacts/content-quality/content-config.md` and later runs honor it
- Guardrails hold: meaning, facts, and legal/compliance wording survive verbatim unless the user explicitly allowed changes

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Subject & settings
Parse `$ARGUMENTS` (strip and remember a `subagent-collect` token — rule 13): an existing file path or pasted text is the subject; the tokens `auto`/`manual` set the mode; `light`/`standard`/`aggressive` set the level. A path-looking argument that doesn't exist is an error to surface, not subject text. Read `.twt-artifacts/content-quality/content-config.md` for persisted settings. Precedence: arguments > config > ask.

The config file holds exactly one YAML block (create it in this shape, parse it leniently):
```yaml
content_review_mode: auto | manual
optimization_level: light | standard | aggressive
```

Derive a kebab-case `<subject-slug>` (from the file name sans extension, or the first words of pasted text). If the subject is pasted text, persist it verbatim to `.twt-artifacts/content-quality/subject/<subject-slug>.md` — every validator dispatch below points at a file on disk, never at text inside a prompt.

If the subject is missing, prompt for it (plain text, free-form). If mode or level is still undetermined, ask via `AskUserQuestion`:
- **Mode** (single-select): `Auto` — optimize and show before/after, no per-change approval; `Manual` — review each suggestion before anything is applied; **You decide** — I pick the mode (defaults to Manual).
- **Level** (single-select): `Light` — fix only obvious issues, preserve tone and structure (for stakeholder review); `Standard` (default) — Information Style + UX-writing best practice, balanced; `Aggressive` — maximize clarity and brevity, strip marketing language («Пиши и сокращай» style); **You decide** — I pick the level (defaults to Standard).

In collect mode: never ask — default to manual + standard, produce the draft to artifacts only, and write open questions (mode, level, "apply to source?") to a sibling `decisions.md`.

## Step 2 — Baseline score (hard dependency)
Dispatch `/twt-content-validate` via the Agent tool on the subject's file path (pass `subagent-collect`). It writes `.twt-artifacts/content-quality/validation/<subject-slug>/validation-report.md`; copy that to `validation-report-before.md` in the same folder so the baseline reasoning survives the after-run. Record per-criterion scores and **before Health**, and carry its findings into Step 3.

## Step 3 — Generate suggestions
From the validator's findings plus your own pass at the chosen level, build a numbered suggestion list. Each suggestion:
- **Original:** <verbatim quote>
- **Problem:** <criterion + why, one or two sentences>
- **Suggested version:** <rewritten text>
- **Expected impact:** contributes toward <criterion a→b on the 0–5 scale> — several suggestions usually share one criterion's uplift; never let each claim the full point

Guardrails (binding at every level): preserve factual meaning; never invent facts, numbers, dates, prices, or claims; leave legal/compliance statements verbatim unless the user explicitly allowed edits; respect `brand-brief.md` voice at Light/Standard (Aggressive may flatten marketing tone — but still never legal text).

## Step 4 — Decide & apply
**Auto mode:** apply all suggestions and **write the optimized text to `.twt-artifacts/content-quality/optimized/<subject-slug>.md` first**, then re-dispatch `/twt-content-validate` on that file → **after Health** (the validator can only read what's on disk). If after ≤ before, revise once more (max 2 rewrite passes total) and keep the better version. No user approval is required for the rewrite itself (in-place source replacement still asks — Step 5).

**Manual mode:** present every suggestion (numbered, in the Step-3 format), then ask via `AskUserQuestion` (single-select):
- **Keep original** — reject all; nothing changes, report only.
- **Apply all** — accept every suggestion.
- **Apply selected** — if there are ≤4 suggestions, follow up with a multi-select `AskUserQuestion` listing them by number + title; with more than 4 (AskUserQuestion caps at 4 options), use a free-form plain-text prompt instead: "Type the numbers to apply (e.g. 2 5 7)" — free-form input stays plain text per CONVENTIONS §4.
- **Apply all & switch to auto** — accept everything and persist `content_review_mode: auto` to `content-config.md` for future runs.
- **You decide** — I apply the suggestions I'm confident improve the text (skipping risky/ambiguous ones) and report exactly what changed.

A free-typed answer is treated as custom instructions (e.g. "keep marketing tone", "don't shorten headings") — regenerate the suggestions under those constraints and ask again (max 2 such loops, then report and stop). After applying, write the result to `optimized/<subject-slug>.md` and re-dispatch the validator on that file for the after score; copy its report to `validation/<subject-slug>/validation-report-after.md`.

## Step 5 — Write outputs
- The optimized text is already at `.twt-artifacts/content-quality/optimized/<subject-slug>.md` (written in Step 4 before re-validation) and the after-report copied to `validation/<subject-slug>/validation-report-after.md`. If a previous run's optimized copy existed before this run, confirm before the Step-4 overwrite (rule 10 spirit).
- If the subject was a file and suggestions were applied, ask via `AskUserQuestion` whether to also replace the source file in place (never in collect mode; never default to yes).
- Persist any settings change to `.twt-artifacts/content-quality/content-config.md` (`content_review_mode`, `optimization_level`).
- Write `.twt-artifacts/content-quality/optimization-report.md`:
```markdown
# Optimization report — content
Generated: <ISO>  ·  Mode: <auto|manual>  ·  Level: <light|standard|aggressive>  ·  Subject: <label>

## Score delta
| Criterion | Before | After | Δ |
|-----------|-------:|------:|--:|
| Clarity | <0-5> | <0-5> | <±n> |
| <…all 8 criteria…> |
| **Health** | **<0-100>** | **<0-100>** | **<±n>** |

## Changes applied
1. <criterion> — "<original>" → "<new>" — <why>
<…>

## Suggestions skipped
- <n>. <title> — <kept original because…>  (or: none)
```

## Step 6 — Report
State mode and level used **and where each came from** (argument / config / asked), before → after Health, suggestions applied/skipped, files written (paths), whether the source file was replaced in place, and any persisted settings. If the mode came from a persisted `content_review_mode: auto`, always add: "Auto mode is persisted in `.twt-artifacts/content-quality/content-config.md` — pass `manual` to override once, or edit the file to switch back." If Band is still below Pass, suggest re-running `/twt-content-optimize` or escalating the level.
