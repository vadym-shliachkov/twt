---
name: twt-brand
category: brand
description: Orchestrate the brand fetch/define/validate skills with a bounded improvement loop
version: 1.1.1
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
writes: []
---

# /twt-brand

## Intent

**Purpose:** One-call brand workflow: fetch (if a source is given) → define → validate, then loop define→validate until the brief is clean or the bounded loop stops.

**Non-goals:**
- Doesn't reproduce sub-skill logic — dispatches via the Agent tool (rule 5)
- Doesn't loop unbounded or auto-downgrade severity
- Not required for standalone use — every sub-skill works on its own

**Success criteria:**
- Produces/refines `brand-brief.md` and a current `validation-report.md`
- Honors the bounded loop (§9): ≤3 iterations, stops on Band = Pass + resolved decisions, no-progress break on Health, report-and-stop otherwise; surfaces sub-skill decisions per §13 (or bubbles them up when itself in collect mode)
- On exit, states whether BLOCKERs remain

---

## Step 1 — Detect state
If `brand-brief.md` exists, ask via the **AskUserQuestion** tool (single-select, header "Brand state") whether to **Use as-is** (keep the existing brief unchanged), **Refine** (address validation findings or update specific sections), **Rebuild** (start the brief over from scratch), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is). Pass the choice to the dispatched define skill. If `brand-brief.md` is missing, proceed to fetch+define.

## Step 2 — Fetch (conditional)
If the user provided a source (in `$ARGUMENTS` or when asked), dispatch `/twt-brand-fetch` with it (Agent tool). Otherwise skip.

## Step 3 — Define → surface → validate loop (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (i.e. it was itself dispatched by /twt-pre-design or /twt-roast-full). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (see step 2 below).

Initialize `iteration = 0`, `prevHealth = null`. Repeat up to 3 times:

1. **Define (subagent):** dispatch `/twt-brand-define` (Agent tool), **always including `subagent-collect`** in the prompt (plus any user answers gathered last pass, and the refine/rebuild choice from Step 1).
2. **Surface (main thread only):** read `.twt-artifacts/pre-design/brand/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, and feed them into the next Define dispatch (which finalizes and sets `status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` into the brand `decisions.md` and return it upward for the parent orchestrator to surface (nested-subagent bubbling).
3. **Validate (subagent):** dispatch `/twt-brand-validate` (Agent tool); read the Scorecard **Band**, **Health**, and BLOCKER count.
4. `iteration += 1`. **Stop** when Band = Pass AND `decisions.md` is resolved/empty. Break early if Health did not increase vs `prevHealth` (no-progress). At `iteration == 3`, stop. Set `prevHealth = Health` before looping.

## Step 5 — Report
State the final **Band + Health** and BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). If decisions remain unresolved or Band < Pass, present them and the human-decision options (provide a source / accept and edit directly / defer) — never auto-fix.
