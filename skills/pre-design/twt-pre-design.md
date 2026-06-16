---
name: twt-pre-design
category: pre-design
description: Run the full Phase 1 pipeline and synthesize a Phase-2-ready pre-design-brief.md
version: 1.1.1
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
Ask what's provided: site URLs, PDFs, docs, brand book/Figma, anything else. Parse `--from <area>` / `--only <area>` from `$ARGUMENTS` (area ∈ content/brand/spec/positioning/ia/curation).

## Step 2 — Content ingest (A)
If sources were provided (and not skipped by flags), dispatch `/twt-content-fetch` with them (Agent tool). If none, note it and continue.

## Step 3 — Brand (B) ∥ Spec (S) — in parallel
Brand reads the brand source; Spec reads the starting notes / Figma URL. Neither reads the other's output and they write to disjoint folders (`brand/` and `spec/`), so dispatch **both in a single batch of parallel Agent calls** (one message, two Agent tool uses), each working from the sources gathered in Step 1:
- **Brand (B)** → `/twt-brand`, forwarding any brand source. Dispatch with `subagent-collect`. After it returns, read `.twt-artifacts/pre-design/brand/decisions.md`; if `status: open`, surface its open questions / proposed rules via the **AskUserQuestion** tool here in the main thread, then re-dispatch `/twt-brand-define subagent-collect <answers>` to finalize. (The same protocol will apply to Spec in a later phase.)
- **Spec (S)** → `/twt-spec`, forwarding any starting notes / Figma URL. This is the north-star intent — vision, functional must-haves, and the weighted **visual style + motion/animation** direction — that positioning, IA, and the design phase build on.

Wait for both to finish before Step 4 (Positioning depends on both). Surface any questions or BLOCKERs either raised after the batch. (Respect flags: skip whichever is excluded; if only one remains, run it alone.)

> Surfacing follows CONVENTIONS rule 13 — if `/twt-pre-design` was itself dispatched with `subagent-collect` (e.g. by `/twt-roast-full`), bubble the merged decisions upward instead of asking.

## Step 4 — Positioning (D)
Dispatch `/twt-positioning`.

## Step 5 — IA (E)
Dispatch `/twt-ia`.

## Step 6 — Curation (C)
Dispatch `/twt-curation`.

(Respect `--from`/`--only`: skip sub-areas before `--from`; run exactly one for `--only`.)

## Step 7 — Synthesize the brief
Read the canonical artifacts that exist and write `.twt-artifacts/pre-design/pre-design-brief.md`:
```
---
generated: <YYYY-MM-DD>
phase: pre-design
---

# Pre-design brief

## Project
<metadata: name, sources ingested>

## Brand
<palette + top voice attributes>  → [brand-brief](brand/brand-brief.md)

## Direction (north-star spec)
<one-line vision + the visual-style and motion/animation headline>  → [specification](spec/specification.md)

## Positioning
<primary audience + top value props>  → [positioning](positioning/positioning.md)

## Information architecture
<page count + sitemap snapshot>  → [sitemap](ia/sitemap.md) · [functional-scope](ia/functional-scope.md)

## Curation
<kept/skipped/elevated counts + content-health note>  → [inventory](curation/inventory.md) · outlines/

## Outstanding BLOCKERs
<aggregate any unresolved BLOCKERs from each sub-area's validation-report.md>
```
For each sub-area, if its `validation-report.md` still lists BLOCKERs, surface them under "Outstanding BLOCKERs" rather than masking them.

## Step 8 — Report
Which sub-areas ran, where the brief is, and any outstanding BLOCKERs the user should resolve before Phase 2.
