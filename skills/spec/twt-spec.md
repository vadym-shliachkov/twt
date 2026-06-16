---
name: twt-spec
category: spec
description: Orchestrate the spec define/validate skills with a bounded improvement loop
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional starting notes or a Figma URL (forwarded to define); otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-spec-define
    - twt-spec-validate
reads:
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/spec/validation-report.md
writes: []
---

# /twt-spec

## Intent

**Purpose:** One-call spec workflow: define (interview into the north-star `specification.md`) → validate, then loop define→validate until the spec is clean or the bounded loop stops.

**Non-goals:**
- Doesn't reproduce sub-skill logic — dispatches via the Agent tool (rule 5)
- Doesn't loop unbounded or auto-downgrade severity
- Not required for standalone use — every sub-skill works on its own

**Success criteria:**
- Produces/refines `specification.md` and a current `validation-report.md`
- Honors the bounded-loop contract (CONVENTIONS §9): ≤3 iterations, no-progress break, report-and-stop on unresolved BLOCKERs
- On exit, states whether BLOCKERs remain

---

## Step 1 — Detect state
If `specification.md` exists, ask via the **AskUserQuestion** tool (single-select, header "Spec state") whether to **Use as-is** (keep the existing spec unchanged), **Refine** (address validation findings or update specific sections), **Rebuild** (start the spec over from scratch), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is). Pass the choice to the dispatched define skill. If `specification.md` is missing, proceed to define.

## Step 2 — Define → surface → validate loop (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (dispatched by a parent orchestrator). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (step 2).

Initialize `iteration = 0`, `prevHealth = null`. Repeat up to 3 times:
1. **Define (subagent):** dispatch `/twt-spec-define` (Agent tool), **always including `subagent-collect`** (plus any user answers from last pass and the refine/rebuild choice from Step 1).
2. **Surface (main thread only):** read `.twt-artifacts/pre-design/spec/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, feed them into the next Define dispatch (which finalizes → `status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` upward for the parent to surface (nested-subagent bubbling).
3. **Validate (subagent):** dispatch `/twt-spec-validate` (Agent tool); read the Scorecard **Band**, **Health**, BLOCKER count.
4. `iteration += 1`. **Stop** when Band = Pass AND `decisions.md` resolved/empty. Break early if Health did not increase vs `prevHealth`. At `iteration == 3`, stop. Set `prevHealth = Health`.

## Step 3 — Report
State the final **Band + Health** and BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). If decisions remain unresolved or Band < Pass, present them and the human-decision options (answer the open questions / accept and edit directly / defer) — never auto-fix.
