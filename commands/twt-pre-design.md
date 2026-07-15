---
name: twt-pre-design
category: pre-design
description: (v1.2.6) Run the full Phase 1 pipeline and synthesize a Phase-2-ready pre-design-brief.md
version: 1.2.6
accepts_arguments: true
inputs:
  - What's provided (URLs, PDFs, docs, brand book, Figma); optional --from/--only flags
dependencies:
  hard: []
  soft:
    - twt-content-fetch
    - twt-brand-fetch
    - twt-brand-define
    - twt-brand-validate
    - twt-spec-define
    - twt-spec-validate
    - twt-positioning-define
    - twt-positioning-validate
    - twt-ia-define
    - twt-ia-validate
    - twt-curation-define
    - twt-curation-validate
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/ia/functional-scope.md
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/pre-design/brand/validation-report.md
  - .twt-artifacts/pre-design/spec/validation-report.md
  - .twt-artifacts/pre-design/positioning/validation-report.md
  - .twt-artifacts/pre-design/ia/validation-report.md
  - .twt-artifacts/pre-design/curation/validation-report.md
writes:
  - .twt-artifacts/pre-design/pre-design-brief.md
---

# /twt-pre-design

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by `/twt-site` or another orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch in the steps below** — twt sub-skills **and** any external skill you load (figma, design-taste-frontend, emil-design-eng, superpowers, …) — run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Drive the whole pre-design phase end to end — content ingest → brand → positioning → IA → curation — then synthesize everything into a single `pre-design-brief.md` that hands off to Phase 2 (Design).

**Non-goals:**
- Doesn't do design, development, or QA (later phases)
- Doesn't reproduce sub-area logic — dispatches every sub-area's `*-fetch` / `*-define` / `*-validate` sub-skills directly (rule 5); the standalone category wrappers (`/twt-brand`, `/twt-spec`, `/twt-positioning`) are for direct use, not for routing through (an orchestrator-to-orchestrator hop only relays)
- The brief is a static synthesis, not a live transition skill

**Success criteria:**
- Each requested sub-area runs in order A → (B ∥ S) → D → E → C — Brand and Spec run concurrently (disjoint inputs and outputs); Positioning waits for both
- `--from <area>` resumes from a sub-area; `--only <area>` scopes to one
- `pre-design-brief.md` summarizes brand, the north-star spec/direction, positioning, IA, and curation with links to every detailed artifact

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.

## Step 1 — Discovery
Parse `--from <area>` / `--only <area>` from `$ARGUMENTS` (area ∈ content/brand/spec/positioning/ia/curation).

**Collect mode** (`subagent-collect` in `$ARGUMENTS`, e.g. dispatched by `/twt-site`): do **not** ask anything — the orchestrator already ran the intake interview and forwarded the project brief in `$ARGUMENTS`. Read it: what the site is for / the audience / the goal, content sources, brand-or-design source, and stage. Use those as the discovery answers and continue.

**Standalone** (user invoked `/twt-pre-design` directly): run the intake interview here in the main thread (free-form input stays plain-text per CONVENTIONS §4):
- **What & who** — "In a sentence or two: what is this site for — the business/product, the goal, and the audience?"
- **Content sources** — "Paste site URL(s), PDF/doc paths, or `none`."
- **Brand / design source** — "A brand book, a Figma link, existing colors/fonts, or `none`."

Carry the answers forward as the project brief for the steps below.

## Step 2 — Content ingest (A)
If sources were provided (and not skipped by flags), dispatch `/twt-content-fetch` with them (Agent tool). If none, note it and continue. _Script-driven extraction, no design judgment — if your Agent tool supports a `model` parameter, dispatch on a fast/economical model (e.g. `haiku`)._

## Step 3 — Brand (B) ∥ Spec (S) — in parallel
Run both areas' single define→validate passes inline, per the IA/curation pattern below (the standalone `/twt-brand` and `/twt-spec` wrappers remain for direct use — routing through them here would add two agent hops that only relay). Brand reads the brand source; Spec reads the starting notes / Figma URL; they write to disjoint folders (`brand/` and `spec/`), so batch each wave's independent dispatches as **parallel Agent calls in one message**:

**Wave 1 (parallel):**
- `/twt-brand-fetch` (Agent tool) with the brand source → `_fetched-brand.md` + `_coverage.md`. *Only when a brand source was provided* — otherwise skip it; define works from fetched-content signals.
- `/twt-spec-define` (Agent tool) with `subagent-collect`, forwarding starting notes / Figma URL → `specification.md` + `decisions.md`. This is the north-star intent — vision, functional must-haves, and the weighted **visual style + motion/animation** direction — that positioning, IA, and the design phase build on.

**Wave 2 (parallel):**
- `/twt-brand-define` (Agent tool) with `subagent-collect` → `brand-brief.md` + `decisions.md`.
- `/twt-spec-validate` (Agent tool) → `spec/validation-report.md`.

**Wave 3:** `/twt-brand-validate` (Agent tool) → the **full** `/twt-brand-validate` report structure, never a shortened collect-mode summary.

After the waves, read `.twt-artifacts/pre-design/brand/decisions.md`; if `status: open`, surface its open questions / proposed rules via the **AskUserQuestion** tool here in the main thread, then re-dispatch `/twt-brand-define subagent-collect <answers>` to finalize and re-dispatch `/twt-brand-validate` once to refresh the report. (Spec's `decisions.md` — notably the art-direction open question — is deliberately left for the later visual-direction gate; do not surface it here.)

Wait for the waves to finish before Step 4 (Positioning depends on both). Surface any BLOCKERs raised. (Respect flags: skip whichever area is excluded; if only one remains, run its dispatches alone.)

> Surfacing follows CONVENTIONS rule 13 — if `/twt-pre-design` was itself dispatched with `subagent-collect` (e.g. by `/twt-site`), bubble the merged decisions upward instead of asking.

## Step 4 — Positioning (D)
Run positioning's single define→validate pass inline (same pattern; `/twt-positioning` remains for standalone use):
1. Dispatch `/twt-positioning-define` (Agent tool) with `subagent-collect`, forwarding the project brief → `positioning.md` + `decisions.md`.
2. Dispatch `/twt-positioning-validate` (Agent tool) → `.twt-artifacts/pre-design/positioning/validation-report.md`.
Surface open positioning decisions per the rule-13 protocol above (ask here, or bubble upward when this command itself runs in collect mode); at most one BLOCKER-driven re-run.

## Step 5 — IA (E)
IA and curation have **no standalone command** — run their single define→validate pass inline here (the same one-pass policy the former `twt-ia` / `twt-curation` wrappers applied, CONVENTIONS §9):
1. Dispatch `/twt-ia-define` (Agent tool) with `subagent-collect`, forwarding the project brief. It writes `sitemap.md` + `functional-scope.md`, plus a `decisions.md` (`status: open`) for any choice it had to make.
2. Dispatch `/twt-ia-validate` (Agent tool) with `subagent-collect` → it writes `.twt-artifacts/pre-design/ia/validation-report.md` (Band/Health + findings). Required: Step 7 reads this report.
3. **Surface (rule 13):** if `decisions.md` is `status: open` **and** `/twt-pre-design` is **not** itself in collect mode, present the open questions / proposed rules via the **AskUserQuestion** tool here, then re-dispatch `/twt-ia-define subagent-collect <answers>` to finalize (`status: resolved`) and re-run `/twt-ia-validate` to refresh the report. If `/twt-pre-design` **is** in collect mode (dispatched by `/twt-site`), **bubble** the merged decisions upward instead of asking. At most **one** BLOCKER-driven re-run — no score-chasing loop.

## Step 6 — Curation (C)
Curation depends on IA's `sitemap.md`, so it runs after Step 5. Same inline single define→validate pass:
1. Dispatch `/twt-curation-define` (Agent tool) with `subagent-collect`, forwarding the project brief → it writes `inventory.md` + `outlines/<page-slug>.md` and a `decisions.md`.
2. Dispatch `/twt-curation-validate` (Agent tool) with `subagent-collect` → `.twt-artifacts/pre-design/curation/validation-report.md`.
3. **Surface / bubble** exactly as Step 5 sub-step 3 (rule 13); at most one BLOCKER-driven re-run.

(Respect `--from`/`--only`: skip sub-areas before `--from`; run exactly one for `--only`. `--only ia` / `--only curation` runs just that inline pass.)

## Step 7 — Synthesize the brief (thin pointer-index)
The brief is an **index, not a copy**. Read **only** each sub-area's `validation-report.md` (for its Band + outstanding BLOCKERs) — do **not** re-summarize the artifacts. **Use the file tools, never a shell command:** Glob `.twt-artifacts/pre-design/*/validation-report.md` to list the reports, then Read each (or Grep across them for verdict/BLOCKER lines) — do **not** `cd` into the folder or run a `cat`/`grep`/`for` loop, which forces a permission prompt on every run. The same applies wherever you gather a set of sibling `decisions.md` files. Downstream skills read the canonical files directly, so a prose re-summary just burns tokens and drifts from source. Write `.twt-artifacts/pre-design/pre-design-brief.md`:
```
---
generated: <YYYY-MM-DD>
phase: pre-design
---

# Pre-design brief

Thin index — canonical detail lives in the linked artifacts; this file is links + status, not a restatement.

## Project
<name · sources ingested>

## Artifacts
| Area | Canonical file(s) | Band |
|------|-------------------|------|
| Brand | [brand-brief](brand/brand-brief.md) | <Band, or — if no report> |
| Direction (spec) | [specification](spec/specification.md) | <Band> |
| Positioning | [positioning](positioning/positioning.md) | <Band> |
| IA | [sitemap](ia/sitemap.md) · [functional-scope](ia/functional-scope.md) | <Band> |
| Curation | [inventory](curation/inventory.md) · outlines/ | <Band> |

## Outstanding BLOCKERs
<aggregate unresolved BLOCKERs from each sub-area's validation-report.md, each linked to its source file — or "none">
```
Keep it short: the value is the link table + the aggregated BLOCKERs, never prose restating the artifacts. Never mask a sub-area's BLOCKERs.

## Step 8 — Report
Which sub-areas ran, where the brief is, and any outstanding BLOCKERs the user should review before Phase 2. If brand validation produced a `## Before design proceeds` notice, quote it directly: Phase 2 may continue with explicit caveats, but the user must be informed before brand choices are bound into design tokens, components, layouts, or copy.
