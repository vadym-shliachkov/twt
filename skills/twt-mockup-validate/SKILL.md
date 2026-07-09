---
name: twt-mockup-validate
category: mockup
description: (v1.2.0) Read-only critique of page mockups (token links, real content, factual integrity, responsiveness, a11y)
version: 1.2.0
accepts_arguments: false
inputs:
  - none (reads the mockup artifacts)
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/mockup/index.html
  - .twt-artifacts/design/mockup/styles.css
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/pre-design/curation/facts.md
  - .twt-artifacts/design/design-read.md
  - references/external-design-skills.md
writes:
  - .twt-artifacts/design/mockup/validation-report.md
---

# /twt-mockup-validate

## Intent

**Purpose:** Read-only critique of the page mockups — real-content usage, token/design-system fidelity, responsiveness, accessibility baseline, and visual-direction adherence — written to `validation-report.md`.

**Non-goals:**
- Doesn't modify any mockup file (read-only; rule 11)
- Doesn't fix findings — that's `/twt-mockup-define`'s job
- Doesn't re-render pages

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (7 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `pages/` is empty, aborts pointing to `/twt-mockup-define`

---

## Step 1 — Load artifacts (hard dependency)
Read every `pages/<page>.html`, plus `index.html`, `styles.css`, `layouts/`, `tokens.css`, `outlines/`, and `facts.md` (the reusable-facts + provided-assets ledger, if present). If `pages/` is empty or missing, abort: "No mockups — run /twt-mockup-define first." Do not create any file.

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Real (transformed) content used | 15 | Mockups use real content from outlines, not lorem/placeholder. |
| Token-only & design-system fidelity | 15 | Styling references tokens; matches the design system, no stray literals. |
| Responsiveness across tiers | 10 | Renders across the declared breakpoints. |
| A11y baseline | 20 | Alt text, heading order, landmarks, focusable controls. |
| Visual-direction adherence | 10 | Matches the spec's Visual Style + Motion direction (and `design-read.md` dials if present). |
| Anti-slop / design taste | 15 | Passes `design-taste-frontend` §9/§14 — **zero em-dashes**; one theme + one accent + one radius scale page-wide; hero fits viewport; eyebrow count ≤ ceil(sections/3); no three-equal-card rows; no `<div>` fake screenshots; motion-claimed = motion-shown with reduced-motion; AA button/contrast. |
| Factual integrity & claim traceability | 15 | **Consistency** — every reusable fact (from `facts.md`) reads with one value across all pages *and* within each page (no 20+/25+/"three-decades" split, no clients/engagements drift). **Traceability** — every metric, count, and named superlative traces to a `facts.md` canonical or an outline-sourced fact; no fabricated stat, no UNVERIFIED-ATTR shown without a TBD flag. **Interactive integrity** — copy promising per-input differentiation is delivered by the page JS (no required control that gates but never alters output). |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Real (transformed) content used","weight":15,"score":<s1>},{"criterion":"Token-only & design-system fidelity","weight":15,"score":<s2>},{"criterion":"Responsiveness across tiers","weight":10,"score":<s3>},{"criterion":"A11y baseline","weight":20,"score":<s4>},{"criterion":"Visual-direction adherence","weight":10,"score":<s5>},{"criterion":"Anti-slop / design taste","weight":15,"score":<s6>},{"criterion":"Factual integrity & claim traceability","weight":15,"score":<s7>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

Score **Factual integrity & claim traceability** actively, not by presence: (1) build the set of reusable facts from `facts.md` (fall back to the outlines/inventory if the ledger is absent) and check each appears with **one** value across every page and within each page — any contradiction (e.g. tenure as 20+ vs 25+ vs "three decades", or "clients" vs "engagements" for the same count) is a Finding, a **BLOCKER** when it contradicts a RESOLVED canonical; (2) check every metric / count / named superlative traces to a canonical or an outline-sourced fact — an untraceable stat, or an UNVERIFIED-ATTR shown without a TBD flag, is a Finding; (3) for each interactive module, confirm the JS makes every control the copy references actually change the output — a required-but-ignored control is a **BLOCKER**. A run with any factual-integrity BLOCKER must not land in the Pass band even if the weighted arithmetic would allow it — say so in the Summary.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. a page not linking `tokens.css` blocks the build; lorem content where real Phase-1 content exists blocks design fidelity; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the mockup files.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating all pages as mobile-first", "assuming hero section always appears first") so the user approves before it binds.

## Step 3 — Write the report
Write `.twt-artifacts/design/mockup/validation-report.md`:
```markdown
# Validation report — mockup
Generated: <ISO timestamp>  ·  Validator: /twt-mockup-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Real (transformed) content used | 15 | <0-5> | <w> | <why> |
| Token-only & design-system fidelity | 15 | <0-5> | <w> | <why> |
| Responsiveness across tiers | 10 | <0-5> | <w> | <why> |
| A11y baseline | 20 | <0-5> | <w> | <why> |
| Visual-direction adherence | 10 | <0-5> | <w> | <why> |
| Anti-slop / design taste | 15 | <0-5> | <w> | <why> |
| Factual integrity & claim traceability | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <page · section>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 4 — Report
State BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-mockup-define (or re-run /twt-design, which folds the mockup define→validate pass)."
