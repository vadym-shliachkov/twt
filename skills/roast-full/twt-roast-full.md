---
name: twt-roast-full
category: roast-full
description: Master orchestrator — run the full pre-design to QA pipeline with approval pauses between phases
version: 1.5.3
accepts_arguments: true
inputs:
  - Optional notes, a live URL, or a hint of which phase to start from
  - Optional first token `auto` — fully unattended run; everything after it is free-form context (notes, URLs, target hints)
  - Optional `--log` flag — write a hook-driven debug trace (every dispatched skill + WHY + wall-time cost %, plus boxed user choices) to `.twt-artifacts/roast-full-debug.md`
dependencies:
  hard: []
  soft:
    - twt-pre-design
    - twt-design
    - twt-develop
    - twt-roast-express
    - twt-content-approval-checklist
    - twt-qa
reads:
  - .twt-artifacts/pre-design/pre-design-brief.md
  - .twt-artifacts/design/design-brief.md
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - .twt-artifacts/qa/qa-report.md
  - .twt-artifacts/qa/gaps.md
writes:
  - .twt-artifacts/roast-full-log.md
  - .twt-artifacts/roast-full-debug.md (only with --log)
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
---

# /twt-roast-full

## Intent

**Purpose:** Run the entire twt pipeline — Pre-design → Design → Content approval checklist → Development → QA — as a single guided command. The user picks which phases to run and the build target up front, then approves (or repeats/stops) at a pause after each phase, with that phase's outstanding BLOCKERs surfaced before the decision. With the first token `auto`, the whole run is unattended: every choice is inferred from the provided input, existing artifacts, and defaults — zero questions.

**Non-goals:**
- Doesn't reproduce any phase's logic — dispatches each phase wrapper via the Agent tool (rule 5)
- Doesn't add build or QA capability — only composes the existing wrappers
- Doesn't auto-proceed past BLOCKERs in interactive mode — the human approves every phase transition (auto mode defers them to the final summary instead)
- Auto mode never grants destructive consents (in-place file replacement, overwrite of user-confirmed targets) — children keep writing to artifacts only

**Success criteria:**
- Interactive: phase set chosen via an AskUserQuestion multi-select; build target via an AskUserQuestion single-select; after each phase an AskUserQuestion gate (Proceed / Re-run / Stop) that surfaces outstanding BLOCKERs
- Auto (`auto` first token): no AskUserQuestion and no prompts anywhere — phases/target inferred, gates auto-proceed, child decisions auto-resolved and logged
- Figma-express target routes Development through `/twt-roast-express` and skips Pre-design + Design
- When Development is selected, `.twt-artifacts/content-approval/content-approval-checklist.xlsx` is created or reused as a parallel approval artifact; approved rows are applied later only when the user explicitly runs `/twt-content-approval-implement`
- Ends with a summary of phases run, artifact locations, the QA verdict, the gaps file — and, in auto mode, every auto-decision taken and every deferred BLOCKER

---

## Step 0 — Mode
If the **first token** of `$ARGUMENTS` is `auto`, enable **auto mode**: strip the token and treat everything after it as free-form context (notes, a live or Figma URL, target hints like "elementor" or "html"). In auto mode this skill asks **nothing** — no AskUserQuestion, no plain-text prompts, no approval requests; every decision comes from that context, the existing `.twt-artifacts/` state, and the defaults named below. Without the leading `auto`, run interactively as before.

## Step 0·log — Debug tracer (`--log`)
If `$ARGUMENTS` contains the token `--log`, enable the **debug tracer** and **strip the token** from `$ARGUMENTS` (so it isn't forwarded to children or parsed as context). The tracer is a project-local hook the installer seeds at `.claude/hooks/twt-debug-log.js`.

- **Arm it now** (Bash): `node "$CLAUDE_PROJECT_DIR/.claude/hooks/twt-debug-log.js" --arm "roast-full $ARGUMENTS"`. This drops a sentinel so the already-wired `PreToolUse`/`PostToolUse` hooks begin appending a live trace — every dispatched skill (at any nesting depth) with its WHY, plus boxed user choices — to `.twt-artifacts/roast-full-debug.md`. Without `--log` the hooks stay completely inert.
- **If that hook file is missing** (twt was installed globally, not into this project), tell the user `--log` needs a project install (`install.ps1 -Target .` or `bash install.sh --target .`) and continue **without** debug logging — never block the run.
- **When armed, prefix every dispatch prompt (Step 3) with a `WHY:` line** — `WHY: <one-line reason this phase/skill is being called now>` — so the trace records real intent instead of a guessed snippet.

## Step 0a — Open the session log
Start a session log at `.twt-artifacts/roast-full-log.md` (create the file/dir if missing) by **appending** a new `## Run <ISO timestamp>` section from `templates/roast-log.md` — never rewrite earlier runs. Record Command, Mode (interactive/auto), Target (tbd until Step 2), and the user's free-form Requested context. Then **keep the Timeline live for the whole run**: append one numbered entry for **every** question you ask (the phases menu, the target menu, the visual-direction surfacing, each per-phase gate, and any surfaced child `decisions.md` question) with the user's answer — or, in auto mode, the inferred `auto-decision: <value> (from <evidence|default>)` — and one entry for **every** phase wrapper you dispatch (`[step]` + the skill name + a **one-sentence** why). This logging is **not** skipped in auto mode — auto runs especially need the trail.

## Step 1 — Choose phases
**Auto mode:** run all four phases (Pre-design → Design → Development → QA), minus any the context clearly excludes (e.g. "QA only", "skip pre-design") and minus Pre-design/Design when the target resolves to Figma express. Skip the menu.

Otherwise ask via the **AskUserQuestion** tool (multi-select, header "Phases") which phases to run — all selected by default:
- **Pre-design** — raw materials → `pre-design-brief.md` (brand, positioning, IA, curation)
- **Design** — → `design-brief.md` (design system, components, layouts, mockups)
- **Development** — promote the design into a built site (HTML or Elementor)
- **QA** — audit the built output → `qa-report.md` + `gaps.md`
Record the selected, ordered set.

## Step 2 — Choose target / approach
**Auto mode:** infer the target from the context and skip the menu — a Figma URL → **Figma express**; "elementor"/"wordpress"/an existing `.twt-artifacts/elementor-theme/conventions.md` → **Elementor**; otherwise default **Static HTML**. Record the inference and its reason for the final summary.

Otherwise ask via the **AskUserQuestion** tool (single-select, header "Target") how Development should build:
- **Static HTML** — dependency-free `site/` (runs `/twt-develop --target html`)
- **Elementor** — WordPress child theme (runs `/twt-develop --target elementor`)
- **Figma express** — start from a Figma link via `/twt-roast-express` (skips Pre-design + Design)
- **You decide** — I pick the best-fit (defaults to Static HTML; Figma express only when a Figma link is present; Elementor when the context/`conventions.md` indicates WordPress)
If **Figma express** is chosen, tell the user Pre-design and Design will be skipped (express starts from Figma), drop them from the phase set, and continue.

## Step 3 — Run the selected phases in order
For each phase still selected, in pipeline order, dispatch its wrapper via the Agent tool, then run the Step 4 pause before moving on:
- **Pre-design** → `/twt-pre-design`
- **Design** → `/twt-design`
- **Content approval checklist** → `/twt-content-approval-checklist` (whenever Development is selected; for Figma express, pass the Figma URL so current design copy, lorem/placeholder text, links, and media references are captured into the workbook before build)
- **Development** → `/twt-develop` (forwarding the chosen `--target`; it builds with currently available content and leaves approval implementation for a later explicit call) **or** `/twt-roast-express` (Figma express; it reuses/refines the workbook and builds with current Figma content)
- **QA** → `/twt-qa`

Dispatch every phase wrapper with `subagent-collect` (rule 13) and forward the free-form context as notes.

**Visual-direction surfacing (interactive only, before Design).** When the Design phase is in the set, no Figma/exported design was provided, and this is **not** auto mode: after `/twt-design` returns, read `.twt-artifacts/design/decisions.md` for the open "Confirm site visual direction" decision and present it to the user via the **AskUserQuestion** tool (Approve / Adjust dials / Override / You decide — per `/twt-design` Step 1b). Then re-dispatch `/twt-design --only design-system … ` in refinement mode with the resolved direction so the confirmed `design-read.md` propagates before components/layouts/mockups bind to it. This is the rule-13 surfacing point — without it the visual direction silently stays inferred. **Auto mode skips this** (the proposed read is model-decided and logged in Step 5).

Before dispatching a phase, check its prerequisite exists: Development (non-express) needs `.twt-artifacts/design/design-brief.md`; QA needs built output (`site/` or a theme). If a prerequisite is missing, raise it at the Step 4 pause instead of dispatching blindly (in auto mode: stop the pipeline there and report — never invent the missing input).

For the **Content approval checklist** pseudo-phase, pass the design brief, layouts, mockups, design-system artifacts, asset manifest, and any user notes. If the target is **Figma express**, pass the Figma URL as the primary content source and instruct the child to extract the visible design copy into `current content`, including lorem ipsum, placeholder copy, draft links, image labels, video references, and SEO-looking text. If the workbook already exists, instruct the child to preserve approved content and fill only newly discovered scope. In interactive mode, surface this as the approval workspace before Development; the user may proceed with partial approvals, but unready rows will not be implemented.

## Step 4 — Approval pause (after each phase)
Read the just-finished phase's output and count any **outstanding BLOCKERs**:
- Pre-design / Design: the `Outstanding BLOCKERs` section of `pre-design-brief.md` / `design-brief.md` (and the sub-area `validation-report.md`s).
- Development: the builders' reported reuse/issues.
- QA: the `verdict` and BLOCKER count in `.twt-artifacts/qa/qa-report.md` (+ the `gaps.md` items).

**Auto mode — no gate:** auto-proceed to the next phase. Resolve any aggregated `decisions.md` open questions yourself: prefer an answer derivable from the free-form context, else accept the child's proposed/model-decided assumption, re-dispatch the relevant `*-define` in refinement mode with those answers (clearing `decisions.md` → resolved), and log every auto-decision for the final summary. BLOCKERs don't stop the run — record them as **deferred** and continue; stop only when the next phase's hard prerequisite is missing. Never re-run a phase more than once on the same inputs.

Otherwise ask via the **AskUserQuestion** tool (single-select, header "Next"):
- **Proceed to <next phase>** — continue the pipeline (describe as "finish" after the last phase)
- **Re-run this phase** — dispatch the same phase wrapper again (e.g. after fixing inputs)
- **Stop here** — end the workflow; report what's done and what remains
When BLOCKERs are present, the option descriptions should recommend Re-run or Stop and name the blocker count. Continue only on **Proceed**.

## Step 5 — Final summary & finalize the log
If the debug tracer was armed (`--log`), **first** run (Bash) `node "$CLAUDE_PROJECT_DIR/.claude/hooks/twt-debug-log.js" --summarize` — it appends the wall-time cost table (per-phase rollup + per-skill leaf, with shares) to `.twt-artifacts/roast-full-debug.md` and disarms the hooks. Do this even on an early stop, so a partial run still gets its trace summarized.

Then finalize the session log: ensure every question/answer and every dispatched phase wrapper is in the Timeline, then fill the run's **Outcome** block (phases completed · outstanding BLOCKERs · key artifact paths) in `.twt-artifacts/roast-full-log.md`.

Then report to the user: which phases ran, where each artifact lives (`pre-design-brief.md`, `design-brief.md`, `content-approval-checklist.xlsx`, the built `site/` or theme, `qa-report.md`, `gaps.md`), the QA verdict if QA ran, any outstanding BLOCKERs or unready content rows the user chose to defer, and **the log location** (`.twt-artifacts/roast-full-log.md`; plus `.twt-artifacts/roast-full-debug.md` with the dispatch trace + cost table when `--log` was used). Make clear that content approval is a parallel process: after stakeholders finish the workbook, run `/twt-content-approval-implement` to update the corresponding blocks/pages. In auto mode additionally list **every auto-decision** (what was decided, from what evidence, or "default") and **every deferred BLOCKER** — this list is the user's review checklist for the unattended run.
