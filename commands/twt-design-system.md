---
name: twt-design-system
category: design-system
description: (v1.1.2) Orchestrate design-system define/validate in a single define→validate pass
version: 1.1.2
accepts_arguments: true
inputs:
  - Optional design sources (Figma/screenshots/URL) or none (greenfield from brand-brief)
dependencies:
  hard: []
  soft:
    - twt-design-system-define
    - twt-design-system-validate
reads:
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/validation-report.md
writes: []
---

# /twt-design-system

## Intent

**Purpose:** One-call design-system workflow: define (greenfield from `brand-brief.md`, or analyse existing design sources) → validate in one pass (§9 — no iteration loop). This is the shared, cross-phase design-system spine.

**Non-goals:**
- Doesn't reproduce sub-skill logic — dispatches via the Agent tool (rule 5)
- Doesn't loop unbounded or auto-downgrade severity
- Not required for standalone use — each sub-skill works on its own

**Success criteria:**
- Produces/refines `tokens.md`, `tokens.css`, `preview.html` and a current `validation-report.md`
- Honors the §9 single-pass policy: one define + one validate (folded into define under orchestration), at most one BLOCKER-driven re-run, no score-chasing loop; reports final Band + Health and surfaces open decisions per §13 (or bubbles them up in collect mode)
- On exit, states final Band + Health and whether BLOCKERs remain

---

## Step 1 — Detect state
If `tokens.md` exists, ask via the **AskUserQuestion** tool (single-select, header "State") whether to **Use as-is**, **Refine** (address validation findings), **Rebuild** (start over), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is); pass the choice to the dispatched -define skill. If missing, proceed to define.

## Step 2 — Define → surface → validate · single pass (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (dispatched by a parent orchestrator). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (see sub-step 2).

Run **one** define → validate cycle — no iteration loop (§9):
1. **Define (subagent):** dispatch `/twt-design-system-define` (Agent tool), **always including `subagent-collect`** (plus the refine/rebuild choice from Step 1 and any answers already gathered). **In collect mode, fold validation in:** instruct define to self-check against the `/twt-design-system-validate` rubric (§12), write the sibling `validation-report.md` in that format, and record Band/Health + any BLOCKER/WARNING + open decisions in `decisions.md`.
2. **Surface (main thread only):** read `.twt-artifacts/design/design-system/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, and re-dispatch define **once** to finalize (`status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` upward for the parent to surface (nested-subagent bubbling).
3. **Validate (standalone only):** when NOT in collect mode, dispatch `/twt-design-system-validate` once; read the Scorecard **Band**, **Health**, BLOCKER count. (In collect mode the Step-1 fold-in already produced the report.)
4. **Stop — no score-chasing loop.** Only one further re-run of define is permitted, and only to fix unresolved **BLOCKERs** when new information makes them fixable; the sub-step 2 finalize counts as that re-run. Never re-run on WARNING/SUGGESTION, never more than once.

## Step 3 — Report
State the final **Band + Health** and BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). If decisions remain unresolved or Band < Pass, present them and the human-decision options (provide design sources / accept and edit directly / defer) — never auto-fix.
