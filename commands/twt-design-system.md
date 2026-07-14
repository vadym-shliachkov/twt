---
name: twt-design-system
category: design-system
description: (v1.3.1) Orchestrate design-system define/validate in a single define→validate pass, then always build the full component catalog (primitives/components/modules)
version: 1.3.1
accepts_arguments: true
inputs:
  - Optional design sources (Figma/screenshots/URL) or none (greenfield from brand-brief)
dependencies:
  hard: []
  soft:
    - twt-design-system-define
    - twt-design-system-validate
    - twt-component-define
    - twt-component-validate
reads:
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/validation-report.md
writes:
  - .twt-artifacts/design/design-system/tokens.md                # via /twt-design-system-define
  - .twt-artifacts/design/design-system/tokens.css               # via /twt-design-system-define
  - .twt-artifacts/design/design-system/preview.html             # via /twt-design-system-define
  - .twt-artifacts/design/design-system/decisions.md             # via /twt-design-system-define (collect mode)
  - .twt-artifacts/design/design-system/validation-report.md     # via /twt-design-system-validate
  - .twt-artifacts/design/design-system/component/components.md  # via /twt-component-define (always)
  - .twt-artifacts/design/design-system/component/gallery.html   # via /twt-component-define (always)
  - .twt-artifacts/design/design-system/component/validation-report.md  # via /twt-component-validate
---

# /twt-design-system

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by `/twt-site` or another orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch in the steps below** — twt sub-skills **and** any external skill you load (figma, design-taste-frontend, emil-design-eng, superpowers, …) — run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** One-call design-system workflow: define (greenfield from `brand-brief.md`, or analyse existing design sources) → validate in one pass (§9 — no iteration loop). This is the shared, cross-phase design-system spine.

**Non-goals:**
- Doesn't reproduce sub-skill logic — dispatches via the Agent tool (rule 5)
- Doesn't loop unbounded or auto-downgrade severity
- Not required for standalone use — each sub-skill works on its own

**Success criteria:**
- Produces/refines `tokens.md`, `tokens.css`, a **tokens-only** `preview.html` (the component catalog lives in the gallery, linked from preview) and a current `validation-report.md`
- Always builds the full component catalog (`component/components.md` + `gallery.html`) via `/twt-component-define` — in every mode, standalone or collect — and validates it (`/twt-component-validate`, or the collect-mode self-check) into `component/validation-report.md`. A complete design system includes tokens, preview, AND the full catalog of all primitives, components, and modules.
- Honors the §9 single-pass policy: one define + one validate (folded into define under orchestration), at most one BLOCKER-driven re-run, no score-chasing loop; reports final Band + Health and surfaces open decisions per §13 (or bubbles them up in collect mode)
- On exit, states final Band + Health and whether BLOCKERs remain

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.

## Step 1 — Detect state
If `tokens.md` exists, ask via the **AskUserQuestion** tool (single-select, header "State") whether to **Use as-is**, **Refine** (address validation findings), **Rebuild** (start over), or **You decide** (I pick: Refine if a validation-report flags findings, else Use as-is); pass the choice to the dispatched -define skill. If missing, proceed to define.

## Step 2 — Define → surface → validate · single pass (CONVENTIONS §9 + §13)
Detect whether THIS orchestrator is in **collect mode**: `$ARGUMENTS` contains `subagent-collect` (dispatched by a parent orchestrator). In collect mode it must NOT call AskUserQuestion — it bubbles decisions upward (see sub-step 2).

Run **one** define → validate cycle — no iteration loop (§9):
1. **Define (subagent):** dispatch `/twt-design-system-define` (Agent tool), **always including `subagent-collect`** (plus the refine/rebuild choice from Step 1 and any answers already gathered). **In collect mode, fold validation in:** instruct define to self-check against the `/twt-design-system-validate` rubric (§12), write the sibling `validation-report.md` in that format, and record Band/Health + any BLOCKER/WARNING + open decisions in `decisions.md`.
2. **Surface (main thread only):** read `.twt-artifacts/design/design-system/decisions.md`. If `status: open` with entries AND this orchestrator is NOT in collect mode, present each open question / proposed rule via the **AskUserQuestion** tool, collect answers, and re-dispatch define **once** to finalize (`status: resolved`). If this orchestrator IS in collect mode, do NOT ask — merge the child `decisions.md` upward for the parent to surface (nested-subagent bubbling).
3. **Validate (standalone only):** when NOT in collect mode, dispatch `/twt-design-system-validate` once; read the Scorecard **Band**, **Health**, BLOCKER count. (In collect mode the Step-1 fold-in already produced the report.)
4. **Stop — no score-chasing loop.** Only one further re-run of define is permitted, and only to fix unresolved **BLOCKERs** when new information makes them fixable; the sub-step 2 finalize counts as that re-run. Never re-run on WARNING/SUGGESTION, never more than once.

## Step 2b — Build the component catalog (always)
A complete design system includes its component catalog, not just tokens. `preview.html` is **tokens-only**; the full Primitives/Components/Modules catalog (breadth + variant × state depth) lives in `component/gallery.html`, which preview links to.

After the design system is finalized, always dispatch `/twt-component-define` (Agent tool) — regardless of mode, standalone or collect — so `component/components.md` + `gallery.html` are produced from the just-written tokens. Pass `subagent-collect` when this orchestrator is itself in collect mode. It reuses the `tokens.md §3` Primitive/Component/Module names so the catalog and the design system agree. Best-effort — if it cannot run, note it and continue; never block the design-system result on it.

**Then validate the catalog too** — the catalog is half the deliverable, and its defect classes (unfilled slots, dark-on-dark modules, inventory drift) live there, not in tokens:
- **Standalone:** dispatch `/twt-component-validate` once (Agent tool) after component-define returns; read its Band/Health/BLOCKER count.
- **Collect mode:** instruct the component-define dispatch to self-check against the `/twt-component-validate` rubric (including the `gen-gallery.mjs --check` evidence) and write the sibling `component/validation-report.md` in that format, bubbling open decisions in its `decisions.md`.
Same §9 policy as Step 2: at most one BLOCKER-driven re-dispatch of component-define, never on WARNING/SUGGESTION. Best-effort like the define leg — never block the design-system result on it.

## Step 3 — Report
State **both** final Bands + Healths — design system (tokens) and component catalog — with their BLOCKER/WARNING/SUGGESTION counts, plus the exit reason (Pass+resolved / cap reached / no-progress). Name `component/gallery.html` + `components.md` as part of the delivered design system (always built and validated in Step 2b), and point to the tokens-only `preview.html` (which links the gallery). If decisions remain unresolved or either Band < Pass, present them and the human-decision options (provide design sources / accept and edit directly / defer) — never auto-fix.
