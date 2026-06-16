---
name: twt-component
category: component
description: Orchestrate component define/validate with a bounded improvement loop
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional: which components to scope to
dependencies:
  hard: []
  soft:
    - twt-component-define
    - twt-component-validate
reads:
  - .twt-artifacts/design/component/components.md
  - .twt-artifacts/design/component/validation-report.md
writes: []
---

# /twt-component

## Intent

**Purpose:** One-call component workflow: define → validate, then loop define→validate until the library is clean or the bounded loop stops.

**Non-goals:**
- Doesn't reproduce sub-skill logic — dispatches via the Agent tool (rule 5)
- Doesn't loop unbounded or auto-downgrade severity
- Not required for standalone use — each sub-skill works on its own

**Success criteria:**
- Produces/refines `components.md` + `gallery.html` and a current `validation-report.md`
- Honors the bounded-loop contract (CONVENTIONS §9): ≤3 iterations, Band-based stop, no-progress break, report-and-stop on unresolved BLOCKERs; surfaces open decisions per §13
- On exit, states final Band + Health and whether BLOCKERs remain

---

## Step 1 — Detect state
If `components.md` exists, ask via the **AskUserQuestion** tool (single-select, header "State") whether to **Use as-is**, **Refine** (address validation findings), **Rebuild** (start over), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is); pass the choice to the dispatched -define skill. If missing, proceed to define.

## Step 2 — Define → surface → validate loop (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (dispatched by a parent orchestrator). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (see sub-step 2).

Initialize `iteration = 0`, `prevHealth = null`. Repeat up to 3 times:
1. **Define (subagent):** dispatch `/twt-component-define` (Agent tool), **always including `subagent-collect`** (plus any user answers from last pass and the refine/rebuild choice from Step 1).
2. **Surface (main thread only):** read `.twt-artifacts/design/component/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, feed them into the next Define dispatch (which finalizes → `status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` upward for the parent to surface (nested-subagent bubbling).
3. **Validate (subagent):** dispatch `/twt-component-validate`; read the Scorecard **Band**, **Health**, BLOCKER count.
4. `iteration += 1`. **Stop** when Band = Pass AND `decisions.md` resolved/empty. Break early if Health did not increase vs `prevHealth`. At `iteration == 3`, stop. Set `prevHealth = Health`.

## Step 3 — Report
State the final **Band + Health** and BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). If decisions remain unresolved or Band < Pass, present them and the human-decision options (refine specs / accept and edit directly / defer) — never auto-fix.
