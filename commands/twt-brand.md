---
name: twt-brand
category: brand
description: (v1.2.2) Orchestrate the brand fetch/define/validate skills in a single define→validate pass
version: 1.2.2
accepts_arguments: true
inputs:
  - Optional brand source (forwarded to fetch) or none (define from scratch)
dependencies:
  hard: []
  soft:
    - twt-brand-fetch
    - twt-brand-define
    - twt-brand-validate
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/validation-report.md
  - .twt-artifacts/pre-design/brand/_coverage.md
writes: []
---

# /twt-brand

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load** (figma, design-taste-frontend, emil-design-eng, superpowers, …), run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** One-call brand workflow: fetch (always; adaptive research when no source) → define → validate in one pass (§9 — no iteration loop).

**Non-goals:**
- Doesn't reproduce sub-skill logic — dispatches via the Agent tool (rule 5)
- Doesn't loop unbounded or auto-downgrade severity
- Not required for standalone use — every sub-skill works on its own

**Success criteria:**
- Produces/refines `brand-brief.md` and a current `validation-report.md`
- Honors the §9 single-pass policy: one define + one validate (folded into define under orchestration), at most one BLOCKER-driven re-run, no score-chasing loop; reports final Band + Health and surfaces open decisions per §13 (or bubbles them up in collect mode)
- On exit, states whether BLOCKERs remain and repeats the validator's `Before design proceeds` notice; brand issues inform the user before Phase 2 but do not automatically stop the workflow

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Detect state
If `brand-brief.md` exists, ask via the **AskUserQuestion** tool (single-select, header "Brand state") whether to **Use as-is** (keep the existing brief unchanged), **Refine** (address validation findings or update specific sections), **Rebuild** (start the brief over from scratch), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is). Pass the choice to the dispatched define skill. If `brand-brief.md` is missing, proceed to fetch+define.

## Step 2 — Fetch (always; adaptive when no source)
Dispatch `/twt-brand-fetch` (Agent tool) — **even when the user provided no source**. Pass any source in `$ARGUMENTS` through; when none is given, fetch researches project artifacts (and the site if a URL is discoverable) and writes `_coverage.md`. Skip only when a current `brand-brief.md` is being used as-is (Step 1 → "Use as-is") and a `_coverage.md` already exists. Do not run `WebSearch` unless the user explicitly asked to research the brand online.

## Step 3 — Define → surface → validate · single pass (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (i.e. it was itself dispatched by /twt-pre-design or /twt-site). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (see step 2 below).

Run **one** define → validate cycle — no iteration loop (§9):
1. **Define (subagent):** dispatch `/twt-brand-define` (Agent tool), **always including `subagent-collect`** (plus the refine/rebuild choice from Step 1 and any answers already gathered). **In collect mode, fold validation in:** instruct define to self-check against the `/twt-brand-validate` rubric (§12), write the sibling `validation-report.md` in that exact full format, and record Band/Health + any BLOCKER/WARNING + open decisions in `decisions.md`. The fold-in MUST NOT write a simplified pass/fail checklist. It must include the weighted numeric Scorecard, Detailed brand component evaluation, Critical assessment, Before design proceeds, Decisions to confirm, Findings with Where/Problem/Recommendation, and Summary.
2. **Surface (main thread only):** read `.twt-artifacts/pre-design/brand/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, and re-dispatch define **once** to finalize (`status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` upward for the parent to surface (nested-subagent bubbling).
3. **Validate (standalone only):** when NOT in collect mode, dispatch `/twt-brand-validate` (Agent tool) once; read the Scorecard **Band**, **Health**, and BLOCKER count. (In collect mode the Step-1 fold-in already produced the report.)
4. **Stop — no score-chasing loop.** Only one further re-run of define is permitted, and only to fix unresolved **BLOCKERs** when new information makes them fixable; the sub-step 2 finalize counts as that re-run. Never re-run on WARNING/SUGGESTION, never more than once. A weak or sub-Pass brand is reported as known risk, not silently repaired and not used as an automatic hard stop.

## Step 5 — Report
State the final **Band + Health** and BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). Include the validator's `Before design proceeds` notice so the user sees the risk before Phase 2. If decisions remain unresolved or Band < Pass, present them and the human-decision options (provide a source / accept and edit directly / defer) — never auto-fix and never claim design is risk-free.

Also surface the **brand-book completeness** summary from the validator's `## Brand-book completeness & source coverage` section: per-tier coverage % (Core/Recommended/Optional) and the top missing parts by tier, noting for each whether it was `silent` (no source signal — user may supply more) or `not-extracted` (a capture gap). Core gaps are the ones to act on before Phase 2.
