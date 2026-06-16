---
name: twt-curation
category: curation
description: Orchestrate curation define/validate with a bounded improvement loop
version: 1.2.1
accepts_arguments: true
inputs:
  - Optional; runs define then the bounded validate loop
dependencies:
  hard: []
  soft:
    - twt-curation-define
    - twt-curation-validate
    - twt-content-optimize
reads:
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/pre-design/curation/validation-report.md
  - .twt-artifacts/pre-design/curation/decisions.md
writes: []
---

# /twt-curation

## Intent

**Purpose:** One-call curation workflow: define → validate, looping until clean or the bounded loop stops.

**Non-goals:**
- Dispatches sub-skills (rule 5); no inline logic
- No unbounded loop, no auto-downgrade

**Success criteria:**
- Produces/refines `inventory.md` + `outlines/` + current `validation-report.md`
- Honors the bounded loop (§9 + §13): ≤3 iterations, stops on Band = Pass + resolved decisions, no-progress break on Health; surfaces sub-skill decisions per §13 (or bubbles them up when itself in collect mode)
- On exit, states final Band + Health and whether BLOCKERs remain

---

## Step 1 — Detect state
If `inventory.md` exists, ask via the **AskUserQuestion** tool (single-select, header "Curation state") whether to **Use as-is** (keep the existing inventory and outlines unchanged), **Refine** (address validation findings or revisit specific pages), **Rebuild** (start the curation over from scratch), **Polish copy** (keep the curation decisions; improve the outline copy's clarity and UX-writing quality via `/twt-content-optimize`), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is). Pass the choice to the dispatched define skill. Else proceed.

If **Polish copy** was chosen, skip the Step-2 define loop: pick the outline pages to polish (multi-select if ≤4 pages, else a free-form plain-text list), dispatch `/twt-content-optimize <outlines/page>.md` per page with `subagent-collect`, surface each child's open decisions (level, apply-in-place) per §13 via AskUserQuestion, and re-dispatch with the answers so the optimizer applies approved changes to the outline file. Finish with one `/twt-curation-validate` pass to refresh the report, then go to Step 3.

## Step 2 — Define → surface → validate loop (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (dispatched by a parent orchestrator). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (see sub-step 2).

Initialize `iteration = 0`, `prevHealth = null`. Repeat up to 3 times:
1. **Define (subagent):** dispatch `/twt-curation-define` (Agent tool), **always including `subagent-collect`** (plus any user answers from last pass and the refine/rebuild choice).
2. **Surface (main thread only):** read `.twt-artifacts/pre-design/curation/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, feed them into the next Define dispatch (which finalizes → `status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` upward for the parent to surface (nested-subagent bubbling).
3. **Validate (subagent):** dispatch `/twt-curation-validate`; read the Scorecard **Band**, **Health**, BLOCKER count.
4. `iteration += 1`. **Stop** when Band = Pass AND `decisions.md` resolved/empty. Break early if Health did not increase vs `prevHealth`. At `iteration == 3`, stop. Set `prevHealth = Health`.

## Step 3 — Report
State the final **Band + Health** and BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). If decisions remain unresolved or Band < Pass, present them and the human-decision options (answer the open questions / accept and edit directly / defer) — never auto-fix.
