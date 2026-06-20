---
name: twt-brand-define
category: brand
description: (v1.0.4) Build or refine the canonical brand-brief.md through guided dialogue
version: 1.0.4
accepts_arguments: true
inputs:
  - Optional starting notes or answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-brand-fetch
reads:
  - .twt-artifacts/pre-design/brand/_fetched-brand.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/validation-report.md
  - skills/brand/twt-brand-validate.md
writes:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/decisions.md
  - .twt-artifacts/pre-design/brand/validation-report.md
---

# /twt-brand-define

## Intent

**Purpose:** Produce the canonical `brand-brief.md` — palette, typography, voice/tone, values, audience signals — either from scratch via interview or by refining an existing brief (including addressing validation findings).

**Non-goals:**
- Doesn't fetch from external sources (that's `/twt-brand-fetch`)
- Doesn't critique its own output in standalone mode (that's `/twt-brand-validate`); collect mode has the explicit folded-validation exception below
- Never overwrites `brand-brief.md` without explicit user consent

**Success criteria:**
- `brand-brief.md` exists with all canonical sections populated or explicitly marked TBD
- On re-run with an existing brief, enters refinement mode rather than starting over
- Voice section has at least 3 attributes with do/don't examples
- In `subagent-collect` mode, writes the full sibling `validation-report.md` using the `/twt-brand-validate` report skeleton, not a compact pass/fail summary

---

## Step 1 — Detect mode (idempotency, CONVENTIONS rule 10)
If `brand-brief.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them and ask which to address. If it does not exist → **from-scratch mode**: read `_fetched-brand.md` if present to seed answers.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the brand-brief from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/brand/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`.

Then write the draft brand-brief and perform the **folded validation exception** required by the orchestrator: write `.twt-artifacts/pre-design/brand/validation-report.md` as if `/twt-brand-validate` had run, using the full validation skeleton and rubric from `skills/brand/twt-brand-validate.md`. Do not replace it with a compact pass/fail, green/yellow/red, or checklist-only report.

The folded validation report MUST include all of these sections in this order:

1. `# Validation report — brand`
2. `## Scorecard` with the five fixed weighted criteria from `/twt-brand-validate`: weights summing to 100, `Score (0-5)`, `Weighted`, evidence, numeric `Health 0-100`, and Band `Pass ≥80 / Revise 50-79 / Fail <50`
3. `## Detailed brand component evaluation` with every available brand item evaluated item-by-item, including status, evaluation method, item health, metric values, pros, cons/risks, severity, and design handoff note. Every item block must include all eight metric rows from `/twt-brand-validate`: Clarity, Relevance, Distinctiveness, Consistency, Actionability, Evidence quality, Accessibility / usability, and Governance readiness. Use `N/A — not applicable because <reason>` for a metric only when it truly does not apply; do not omit the metric row.
4. `## Critical assessment` with direct senior-designer judgment on palette, typography, voice, coherence, and a one-line verdict
5. `## Before design proceeds` with proceed status, user-facing notice, design-safe defaults, and unresolved brand risks
6. `## Decisions to confirm`
7. `## Findings` using numbered findings with severity in the heading and `Where / Problem / Recommendation`
8. `## Summary`

For palette evaluation, compute actual WCAG contrast ratios from provided hex values whenever hex values exist. If a value is missing or only described, mark the metric as `Missing / not evaluable`; do not convert that absence into a Pass.

Return the decisions block and the validation Band/Health in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill and the sibling validator rubric.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Interview / refine
**(Skipped in collect mode — see Step 1b.)** Walk the canonical sections one at a time (Identity → Palette → Typography → Voice & Tone → Audience signals). Ask focused questions; pre-fill from fetched notes where available and confirm rather than re-ask. In refinement mode, only touch the sections the user chose.

## Step 3 — Write the brief
Write/update `.twt-artifacts/pre-design/brand/brand-brief.md` with sections: `# Brand Brief`, `## Identity`, `## Palette` (table: name | hex | usage), `## Typography`, `## Voice & Tone` (attributes + do/don't), `## Audience signals`, `## Sources`. Mark unknowns `TBD` rather than guessing. Confirm before overwriting.

## Step 4 — Report
Sections written/changed, any remaining TBDs, and suggest `/twt-brand-validate` next.
