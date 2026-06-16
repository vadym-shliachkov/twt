---
name: twt-ia
category: ia
description: Orchestrate IA define/validate with a bounded improvement loop
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional; runs define then the bounded validate loop
dependencies:
  hard: []
  soft:
    - twt-ia-define
    - twt-ia-validate
reads:
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/ia/functional-scope.md
  - .twt-artifacts/pre-design/ia/validation-report.md
writes: []
---

# /twt-ia

## Intent

**Purpose:** One-call IA workflow: define → validate, looping until clean or the bounded loop stops.

**Non-goals:**
- Dispatches sub-skills (rule 5); no inline logic
- No unbounded loop, no auto-downgrade of severity

**Success criteria:**
- Produces/refines `sitemap.md` + `functional-scope.md` + current `validation-report.md`
- Honors the bounded loop (§9): ≤3 iterations, stops on Band = Pass + resolved decisions, no-progress break on Health, report-and-stop otherwise; surfaces sub-skill decisions per §13 (or bubbles them up when itself in collect mode)
- On exit, states whether BLOCKERs remain

---

## Step 1 — Detect state
If `sitemap.md` exists, ask via the **AskUserQuestion** tool (single-select, header "IA state") whether to **Use as-is** (keep the existing sitemap and functional-scope unchanged), **Refine** (address validation findings or update specific sections), **Rebuild** (start over from scratch), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is). Pass the choice to the dispatched define skill. Else proceed.

## Step 2 — Define → surface → validate loop (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (dispatched by a parent orchestrator). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (see sub-step 2).

Initialize `iteration = 0`, `prevHealth = null`. Repeat up to 3 times:
1. **Define (subagent):** dispatch `/twt-ia-define` (Agent tool), **always including `subagent-collect`** (plus any user answers from last pass and the refine/rebuild choice from Step 1).
2. **Surface (main thread only):** read `.twt-artifacts/pre-design/ia/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, feed them into the next Define dispatch (which finalizes → `status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` upward for the parent to surface (nested-subagent bubbling).
3. **Validate (subagent):** dispatch `/twt-ia-validate` (Agent tool); read the Scorecard **Band**, **Health**, BLOCKER count.
4. `iteration += 1`. **Stop** when Band = Pass AND `decisions.md` resolved/empty. Break early if Health did not increase vs `prevHealth`. At `iteration == 3`, stop. Set `prevHealth = Health`.

## Step 3 — Report
State the final **Band + Health** and BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). If decisions remain unresolved or Band < Pass, present them and the human-decision options (answer the open questions / accept and edit directly / defer) — never auto-fix.
