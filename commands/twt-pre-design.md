---
name: twt-pre-design
category: pre-design
description: Run the full Phase 1 pipeline and synthesize a Phase-2-ready pre-design-brief.md
version: 1.1.6
accepts_arguments: true
inputs:
  - What's provided (URLs, PDFs, docs, brand book, Figma); optional --from/--only flags
dependencies:
  hard: []
  soft:
    - twt-content-fetch
    - twt-brand
    - twt-spec
    - twt-positioning
    - twt-ia
    - twt-curation
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

## Intent

**Purpose:** Drive the whole pre-design phase end to end — content ingest → brand → positioning → IA → curation — then synthesize everything into a single `pre-design-brief.md` that hands off to Phase 2 (Design).

**Non-goals:**
- Doesn't do design, development, or QA (later phases)
- Doesn't reproduce sub-area logic — dispatches each sub-area orchestrator (rule 5)
- The brief is a static synthesis, not a live transition skill

**Success criteria:**
- Each requested sub-area runs in order A → (B ∥ S) → D → E → C — Brand and Spec run concurrently (disjoint inputs and outputs); Positioning waits for both
- `--from <area>` resumes from a sub-area; `--only <area>` scopes to one
- `pre-design-brief.md` summarizes brand, the north-star spec/direction, positioning, IA, and curation with links to every detailed artifact

---

## Step 1 — Discovery
Parse `--from <area>` / `--only <area>` from `$ARGUMENTS` (area ∈ content/brand/spec/positioning/ia/curation).

**Collect mode** (`subagent-collect` in `$ARGUMENTS`, e.g. dispatched by `/twt-site`): do **not** ask anything — the orchestrator already ran the intake interview and forwarded the project brief in `$ARGUMENTS`. Read it: what the site is for / the audience / the goal, content sources, brand-or-design source, and stage. Use those as the discovery answers and continue.

**Standalone** (user invoked `/twt-pre-design` directly): run the intake interview here in the main thread (free-form input stays plain-text per CONVENTIONS §4):
- **What & who** — "In a sentence or two: what is this site for — the business/product, the goal, and the audience?"
- **Content sources** — "Paste site URL(s), PDF/doc paths, or `none`."
- **Brand / design source** — "A brand book, a Figma link, existing colors/fonts, or `none`."

Carry the answers forward as the project brief for the steps below.

## Step 2 — Content ingest (A)
If sources were provided (and not skipped by flags), dispatch `/twt-content-fetch` with them (Agent tool). If none, note it and continue.

## Step 3 — Brand (B) ∥ Spec (S) — in parallel
Brand reads the brand source; Spec reads the starting notes / Figma URL. Neither reads the other's output and they write to disjoint folders (`brand/` and `spec/`), so dispatch **both in a single batch of parallel Agent calls** (one message, two Agent tool uses), each working from the sources gathered in Step 1:
- **Brand (B)** → `/twt-brand`, forwarding any brand source. Dispatch with `subagent-collect`. Require the returned brand `validation-report.md` to use the full `/twt-brand-validate` structure, not a shortened collect-mode summary. After it returns, read `.twt-artifacts/pre-design/brand/decisions.md`; if `status: open`, surface its open questions / proposed rules via the **AskUserQuestion** tool here in the main thread, then re-dispatch `/twt-brand-define subagent-collect <answers>` to finalize and refresh the full folded validation report. (The same protocol will apply to Spec in a later phase.)
- **Spec (S)** → `/twt-spec`, forwarding any starting notes / Figma URL. This is the north-star intent — vision, functional must-haves, and the weighted **visual style + motion/animation** direction — that positioning, IA, and the design phase build on.

Wait for both to finish before Step 4 (Positioning depends on both). Surface any questions or BLOCKERs either raised after the batch. (Respect flags: skip whichever is excluded; if only one remains, run it alone.)

> Surfacing follows CONVENTIONS rule 13 — if `/twt-pre-design` was itself dispatched with `subagent-collect` (e.g. by `/twt-site`), bubble the merged decisions upward instead of asking.

## Step 4 — Positioning (D)
Dispatch `/twt-positioning`.

## Step 5 — IA (E)
Dispatch `/twt-ia`.

## Step 6 — Curation (C)
Dispatch `/twt-curation`.

(Respect `--from`/`--only`: skip sub-areas before `--from`; run exactly one for `--only`.)

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
