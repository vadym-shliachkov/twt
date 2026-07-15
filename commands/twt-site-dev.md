---
name: twt-site-dev
category: site-dev
description: (v1.5.8) Phase 3 express — from a Figma link, build/update the design system and jump to development, with an always-on dispatch trace
version: 1.5.8
accepts_arguments: true
inputs:
  - Figma URL (via $ARGUMENTS or prompt); optional screenshots/notes; target chosen via menu
  - Optional first token `auto` — fully unattended run; everything after it is free-form context (Figma URL required, target hints, notes)
dependencies:
  hard: []
  soft:
    - twt-design-system-define
    - twt-component-define
    - twt-elementor-theme-creator
    - twt-elementor-block-creator
    - twt-html-site-creator
    - twt-html-block-creator
    - twt-content-approval-checklist
    - figma-mcp
reads:
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - .twt-artifacts/elementor-theme/conventions.md
  - .twt-artifacts/html-site/conventions.md
writes:
  - .twt-artifacts/site-dev-log.md
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/design/design-system/component/gallery.html
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
---

# /twt-site-dev

## Intent

**Purpose:** The short path. From a Figma link, create or update the cross-phase design-system spine, create the content approval workbook as a parallel confirmation artifact, auto-scaffold the chosen target if needed, then jump straight to page/block development using current Figma content. Skips the full Phase-1/Phase-2 pipeline. With the first token `auto`, runs fully unattended — every choice inferred from the provided context, zero questions.

**Non-goals:**
- Doesn't run pre-design or design phases (use `/twt-pre-design` / `/twt-design` for those)
- Doesn't reproduce design-system / scaffold / builder logic — dispatches each via the Agent tool (rule 5)
- Doesn't replace an existing design system — extends it (tokens are never revalued)
- Auto mode never grants destructive consents (in-place replacement, overwriting user-confirmed targets) — children write to artifacts and the scaffold only

**Success criteria:**
- Target chosen (HTML or Elementor) via menu — or, in auto mode, inferred from the context/existing scaffold with the inference logged
- Auto mode asks **nothing** (no AskUserQuestion, no prompts); a missing Figma URL aborts with a clear message instead of prompting
- `/twt-design-system-define` runs in analyse-existing mode from the Figma link (spine created or updated)
- `/twt-content-approval-checklist` creates or reuses `.twt-artifacts/content-approval/content-approval-checklist.xlsx` before development
- The target's scaffold is ensured (created if its `conventions.md` is missing — theme-creator before block-creator for Elementor)
- The matching builder is dispatched to start page/block development
- Approved workbook rows are not applied automatically; after stakeholder confirmation, the user runs `/twt-content-approval-implement` to update corresponding blocks/pages

---

Arguments passed to this command: $ARGUMENTS

## Step 0 — Mode
If the **first token** of `$ARGUMENTS` is `auto`, enable **auto mode**: strip the token and treat the rest as free-form context (Figma URL, target hints like "elementor"/"html", notes). In auto mode ask **nothing** — no AskUserQuestion, no plain-text prompts; decide from the context, the existing `.twt-artifacts/` state, and the defaults below, and log every auto-decision for the final report. Without the leading `auto`, run interactively as before.

If `$ARGUMENTS` contains a Figma URL, use it; otherwise ask for one — **except in auto mode**, where a missing Figma URL aborts: "Auto mode needs the Figma URL in the arguments: /twt-site-dev auto <figma-url> [notes]".

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.

## Step 0a — Open the session log
Start a session log at `.twt-artifacts/site-dev-log.md` (create the file/dir if missing) by **appending** a new `## Run <ISO timestamp>` section in the session-log format (a `# Session log` heading, then per invocation a `## Run <ISO timestamp>` section with **Command** / **Mode** (interactive|auto) / **Target** / **Requested** (one-line context) fields, a `### Timeline` of numbered entries — each either `[question] <header>` with the asked text + answer, or `[step] <phase>` with the skill used + a one-sentence why (in auto mode record `auto-decision: <value> (from <evidence|default>)`) — and a `### Outcome` block: phases/steps completed · outstanding BLOCKERs · key artifact paths) — never rewrite earlier runs. Record Command, Mode (interactive/auto), Target (tbd until Step 1), and the user's free-form Requested context. Then **keep the Timeline live for the rest of the run**: append one numbered entry for **every** question you ask (the question text + the user's answer, or, in auto mode, the inferred `auto-decision: <value> (from <evidence|default>)`) and one for **every** skill you dispatch (`[step]` + the skill name + a **one-sentence** why). Surfaced child `decisions.md` questions and their answers are logged the same way. This logging is **not** skipped in auto mode — auto runs especially need the trail. **Append `[question]` entries via the bundled appender** (Bash): `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --timeline "<Header>: <question text> → <answer>"` — it numbers the entry and pins the exact `N. [question] Header: text → answer` shape that `wiki-harvest.mjs` parses (a freehand line that drifts is invisible to the wiki). `[step]` entries you still write by hand — the harvester deliberately ignores them. If the hook file is missing, write the `[question]` line by hand in that same shape.

## Step 0b — Arm the dispatch tracer (always)
Arm the always-on run trace (no flag): run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --arm "site-dev $ARGUMENTS"`. The label includes `site-dev`, so the tracer folds its output into `site-dev-log.md` (not `site-log.md`). The `Task|Agent|Skill|AskUserQuestion` hooks then record every dispatch — twt builders **and** any other Skill-tool call — to `.twt-artifacts/.twt-debug/events.jsonl`; it is inert in any session without the sentinel. If the hook file is missing (global install without bundled hooks), continue without the trace. **Prefix every dispatch prompt with a `WHY:` line** so the trace records real intent. There is no token column (not exposed to hooks).

## Step 1 — Target menu

**Auto mode:** infer `<target>` and skip the menu — "elementor"/"wordpress" in the context or an existing `.twt-artifacts/elementor-theme/conventions.md` → **elementor**; an existing `.twt-artifacts/html-site/conventions.md` → **html**; otherwise default **html**. Record the inference and its reason.

Otherwise ask via the **AskUserQuestion** tool (single-select, header "Target") What is the build target?:
- **Static HTML/CSS** — dependency-free static site
- **Elementor (WordPress)** — Hello Elementor child theme with widgets
- **You decide** — I pick the best-fit target from the project context (existing `conventions.md` or hints; defaults to Static HTML/CSS)

Record the choice as `<target>` and continue.

## Step 2 — Design system from Figma

Capture the Figma URL (from `$ARGUMENTS` or prompt). Dispatch `/twt-design-system-define` (Agent tool) in **analyse-existing** mode with `subagent-collect` (rule 13), passing the Figma URL as the design source, to create or update `.twt-artifacts/design/design-system/` (`tokens.md`, `tokens.css`, `preview.html`). Interactively, surface any returned `decisions.md` questions via AskUserQuestion; in auto mode, resolve them yourself — prefer answers derivable from the context, else accept the child's proposed assumption — and log each one.

Pass through the priority rule: an existing project design system is the baseline; tokens are **extended, never replaced**; use refinement mode if `tokens.md` already exists.

Wait for it to finish; confirm `.twt-artifacts/design/design-system/tokens.css` exists.

Then dispatch `/twt-component-define` (Agent tool) with `subagent-collect` to build the component catalog (`component/components.md` + `gallery.html`) from the just-written tokens. A complete design system requires all primitives, components, and modules — not just tokens. Surface any `decisions.md` questions the same way as for design-system above.

## Step 2a — Content approval workbook

Dispatch `/twt-content-approval-checklist` via the Agent tool with `subagent-collect`, passing the Figma URL, design-system output, page/screen names if known, and any notes. If `.twt-artifacts/content-approval/content-approval-checklist.xlsx` already exists, instruct the child to reuse/refine without overwriting existing approved content.

After the child returns, verify `.twt-artifacts/content-approval/content-approval-checklist.xlsx` exists. If it is missing, stop before scaffold/build work and report the child output plus the Figma/source context that was passed in. Do not silently continue without the workbook; the express build can use current Figma content only after the approval artifact exists as the stakeholder review surface.

In interactive mode, tell the user this workbook is the human approval surface for copy, links, images, videos, header/footer, and SEO. Development continues with the current Figma/design content; approved workbook rows are applied later only when `/twt-content-approval-implement` is explicitly called.

## Step 3 — Ensure scaffold

- `<target>` = **elementor**: if `.twt-artifacts/elementor-theme/conventions.md` is missing, dispatch `/twt-elementor-theme-creator` (Agent tool) first. If present, skip.
- `<target>` = **html**: if `.twt-artifacts/html-site/conventions.md` is missing, dispatch `/twt-html-site-creator` (Agent tool) first. If present, skip.

(Unlike the builders, this skill never bails on a missing scaffold — it creates it.)

## Step 4 — Build

Dispatch the matching builder (Agent tool) with `subagent-collect`, forwarding the Figma URL and any notes so it starts page/block development (in auto mode, resolve its open decisions the same way as Step 2):
- `<target>` = **elementor** → `/twt-elementor-block-creator`
- `<target>` = **html** → `/twt-html-block-creator`

## Step 5 — Report & finalize the log
**First** finalize the curated session log: ensure every question/answer and every dispatched skill is in the Timeline, then fill the run's **Outcome** block (steps completed · outstanding BLOCKERs · key artifact paths) in `.twt-artifacts/site-dev-log.md`. Do all `site-dev-log.md` edits **before** the next step (the summarizer appends to end-of-file).

**Then** regenerate the consolidated review dashboard (Bash, single command): `node "${CLAUDE_PLUGIN_ROOT}/tools/gen-report.mjs" "$CLAUDE_PROJECT_DIR"` — it gathers any `phase-review.md` and the QA report into `.twt-artifacts/reports/` (copies + an on-brand `index.html` with open decisions surfaced at the top). Convenience view, never a gate — if it errors, continue.

**Then** run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --summarize` — it folds the full dispatch trace (every Task/Agent dispatch and Skill call — twt + any other plugin/system skill, with WHY + wall-time) plus the wall-time cost tables into `.twt-artifacts/site-dev-log.md`, then disarms. Do this even on an early stop. (If never armed — hook missing — skip.) No token column (not available to hooks).

Then state to the user: target chosen, whether the spine was created or updated, whether the content approval workbook was created or reused, whether a scaffold was run, what the builder produced (with paths), and that approved workbook content was not auto-applied. **Call out the content-approval workbook explicitly** — its full path `.twt-artifacts/content-approval/content-approval-checklist.xlsx` and row count on its own line — and that approved rows apply only when `/twt-content-approval-implement` is run. Point to **the single log** at `.twt-artifacts/site-dev-log.md` (curated Timeline + auto-folded dispatch trace & cost) and, on its own line, the consolidated review dashboard **`.twt-artifacts/reports/index.html`**. In auto mode additionally list **every auto-decision** (target inference, resolved child decisions, defaults applied) — the user's review checklist for the unattended run. Point to the next call (`/twt-site-dev` for another block, `/twt-content-approval-implement` after approvals, or the builder directly).
