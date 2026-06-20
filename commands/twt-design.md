---
name: twt-design
category: design
description: Run the full Phase 2 pipeline and synthesize a Phase-3-ready design-brief.md
version: 1.2.4
accepts_arguments: true
inputs:
  - Optional design sources; optional --from/--only flags (area ∈ design-system/component/layout/mockup)
dependencies:
  hard: []
  soft:
    - twt-design-system
    - twt-component
    - twt-layout
    - twt-mockup
reads:
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/component/components.md
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/mockup/index.html
  - .twt-artifacts/design/design-system/validation-report.md
  - .twt-artifacts/design/component/validation-report.md
  - .twt-artifacts/design/layout/validation-report.md
  - .twt-artifacts/design/mockup/validation-report.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - references/external-design-skills.md
writes:
  - .twt-artifacts/design/design-brief.md
  - .twt-artifacts/design/design-read.md
  - .twt-artifacts/design/decisions.md
---

# /twt-design

## Intent

**Purpose:** Drive the whole design phase end to end — design-system → component → layout → mockup — then synthesize a single `design-brief.md` that hands off to Phase 3 (Development).

**Non-goals:**
- Doesn't do development or QA (later phases)
- Doesn't reproduce sub-area logic — dispatches each sub-area orchestrator (rule 5)
- The brief is a static synthesis, not a live transition skill

**Success criteria:**
- Each requested sub-area runs in order: design-system → component → layout → mockup
- `--from <area>` resumes from a sub-area; `--only <area>` scopes to one
- `design-brief.md` summarizes the system, components, layouts, and mockups with links to every artifact, and surfaces any outstanding BLOCKERs

---

## Step 1 — Discovery
Ask what's provided (brand-brief already exists from Phase 1; optional Figma/screenshots for analyse-existing mode). Parse `--from <area>` / `--only <area>` from `$ARGUMENTS` (area ∈ design-system/component/layout/mockup). Record whether a **Figma/exported-design source** was provided as `<has_figma>`.

## Step 1a — No-Figma gate: external design skills + Design Read
**Run only when `<has_figma>` is false** (greenfield, designing from the brand-brief rather than an existing design). When a Figma/exported design is provided, that design is authoritative — skip this step.

1. **Ensure the two external design skills are installed** per `references/external-design-skills.md` Step A — `design-taste-frontend` (anti-slop direction) and `emil-design-eng` (motion polish). If either is missing, **auto-install it into the *project's* `.claude/skills/` directory** (never global) by fetching from its source. If a fetch fails, don't block — note it and fall back to the inlined discipline.
2. **Produce the *proposed* Design Read once** (reference Step B): run `design-taste-frontend` §0 (the one-line Design Read) and §1 (the three dials — DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY) against `brand-brief.md`, `specification.md`, and `positioning.md`, and write `.twt-artifacts/design/design-read.md` in the design-read.md format (frontmatter `status: <proposed|confirmed|model-decided>` + `visual_decision`; then `# Design Read`; a one-line read — "Reading this as <page kind> for <audience>, <vibe> language, leaning <aesthetic family>"; a **Dials** table for DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY (1–10 + why); **Direction notes** for Type / Color / Layout / Motion; **Constraints carried from Phase 1**; and a **User decisions** block — Choice / reference sites to emulate-or-avoid / adjusted dials) with `status: proposed`. Every design sub-area below inherits this file instead of re-deriving the direction.

## Step 1b — Visual-direction gate (user sets the requirements)
The brand-brief fixes *brand* facts (logo, core palette, voice). It does **not** decide the **site's visual design** — aesthetic family, layout paradigm, type pairing, accent usage, density, motion. When no Figma is provided, that direction must be **set with the user**, not silently inferred.

- **Collect mode** (`subagent-collect` in `$ARGUMENTS`, e.g. dispatched by `/twt-site`): do **not** ask. Leave `design-read.md` at `status: proposed` and record the visual direction as an **open decision** in `.twt-artifacts/design/decisions.md` (`## Open questions` → "Confirm site visual direction", with the proposed Design Read + dials as the leaning, and the four resolution options below). The orchestrator surfaces it (rule 13).
- **Auto / unattended** (the run was started in a fully-unattended mode, e.g. site `auto`): do not ask — accept the proposed read, set `status: model-decided`, and log it for the final summary.
- **Interactive** (user-invoked, not collect): present the proposed Design Read (one-line read + the three dials + the type/color/layout/motion direction notes) and ask via the **AskUserQuestion** tool (single-select, header "Visual direction"):
  - **Approve** — accept the proposed direction as-is
  - **Adjust dials** — open follow-up questions for DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY (and, if the user wants, type feel / color approach), then re-render the read
  - **Override** — run the full requirements interview: aesthetic direction (e.g. editorial / minimal-Linear / bold-brand / premium), reference sites to **emulate** and to **avoid** (free-text URLs), density, motion intensity, type feel, color/accent approach — then rebuild the read from the answers
  - **You decide** — accept the proposed direction; the model owns this choice. (Per CONVENTIONS §4 this resolves *only* the visual-direction question — it does not auto-decide later questions.)

  Apply the answer, then **write `design-read.md` with `status: confirmed`** (record the chosen option and any interview answers under "Constraints carried from Phase 1" / a new "User decisions" note). Every design sub-area below inherits the confirmed file.

A real brand-brief/spec decision still wins over taste defaults — the gate is about the **site design** choices the brief leaves open, never about overriding a provided brand fact.

## Step 2 — Design system
Dispatch `/twt-design-system` (Agent tool) **with `subagent-collect`**, forwarding any design sources. (Skip if excluded by flags.) Then **surface** per the protocol below.

## Step 3 — Components
Dispatch `/twt-component` (Agent tool) **with `subagent-collect`**, then surface.

## Step 4 — Layouts
Dispatch `/twt-layout` (Agent tool) **with `subagent-collect`**, then surface.

## Step 5 — Mockups
Dispatch `/twt-mockup` (Agent tool) **with `subagent-collect`**, then surface.

(Respect `--from`/`--only`: skip sub-areas before `--from`; run exactly one for `--only`.)

**Surfacing protocol (CONVENTIONS rule 13):** After each sub-area returns, read its `.twt-artifacts/design/<area>/decisions.md`. If `status: open` and this wrapper is NOT in collect mode (no `subagent-collect` in its own `$ARGUMENTS`), present the open questions / proposed rules via the **AskUserQuestion** tool in the main thread, then re-dispatch that sub-area's define in refinement mode with the answers to finalize (`status: resolved`). If `/twt-design` was itself dispatched with `subagent-collect` (e.g. by `/twt-site`), bubble the merged decisions upward instead of asking (nested-subagent bubbling).

## Step 6 — Synthesize the brief (thin pointer-index)
The brief is an **index, not a copy**. Read **only** each sub-area's `validation-report.md` (for its Band + outstanding BLOCKERs) — do **not** re-summarize tokens, components, layouts, or mockups. **Use the file tools, never a shell command:** Glob `.twt-artifacts/design/*/validation-report.md` to list the reports, then Read each (or Grep across them) — do **not** `cd` into the folder or run a `cat`/`grep`/`for` loop, which forces a permission prompt every run. Same for gathering sibling `decisions.md` files. Phase 3 reads the canonical files directly, so a prose re-summary just burns tokens and drifts from source. Write `.twt-artifacts/design/design-brief.md`:
```
---
generated: <YYYY-MM-DD>
phase: design
---

# Design brief

Thin index — canonical detail lives in the linked artifacts; this file is links + status, not a restatement.

## Source
<pre-design-brief reference + which entry mode design-system used>

## Artifacts
| Area | Canonical file(s) | Band |
|------|-------------------|------|
| Design system | [tokens](design-system/tokens.md) · [preview](design-system/preview.html) | <Band, or — if no report> |
| Components | [components](component/components.md) · [gallery](component/gallery.html) | <Band> |
| Layouts | layout/layouts/ | <Band> |
| Mockups | [index](mockup/index.html) | <Band> |

## Outstanding BLOCKERs
<aggregate unresolved BLOCKERs from each sub-area's validation-report.md, each linked to its source file — or "none">
```
Keep it short: the value is the link table + the aggregated BLOCKERs, never prose restating the artifacts. Never mask a sub-area's BLOCKERs.

## Step 7 — Report
Which sub-areas ran, where the brief is, and any outstanding BLOCKERs the user should resolve before Phase 3.
