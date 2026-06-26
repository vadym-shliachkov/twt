---
name: twt-layout-validate
category: layout
description: (v1.0.1) Read-only critique of per-page layout specs into validation-report.md
version: 1.0.1
accepts_arguments: false
inputs:
  - none (reads the layout artifacts)
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/design/component/components.md
writes:
  - .twt-artifacts/design/layout/validation-report.md
---

# /twt-layout-validate

## Intent

**Purpose:** Read-only critique of the page layouts — section order & hierarchy, component-slot fit, content-map completeness, responsive intent, and IA consistency — written to `validation-report.md`.

**Non-goals:**
- Doesn't modify any layout file (read-only; rule 11)
- Doesn't fix findings — that's `/twt-layout-define`'s job
- Doesn't author new layouts

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `layouts/` is empty, aborts pointing to `/twt-layout-define`

---

## Step 1 — Load artifacts (hard dependency)
Read every `layouts/<page>.md`. If `layouts/` is empty or missing, abort: "No layouts — run /twt-layout-define first." Do not create any file. Also read `sitemap.md`, `outlines/`, and `components.md` if present (coverage and slot checks).

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Section order & hierarchy | 25 | Each page's section order tells a coherent story; visual hierarchy is intentional. |
| Component-slot fit | 20 | Each section maps to real components that can fill it. |
| Content-map completeness | 20 | Every section has a mapped content source (or an explicit gap). |
| Responsive intent | 20 | Behavior across breakpoints is specified, not assumed. |
| Consistency with IA | 15 | Layouts match `sitemap.md` pages and purposes. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Section order & hierarchy","weight":25,"score":<s1>},{"criterion":"Component-slot fit","weight":20,"score":<s2>},{"criterion":"Content-map completeness","weight":20,"score":<s3>},{"criterion":"Responsive intent","weight":20,"score":<s4>},{"criterion":"Consistency with IA","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. a section referencing a component absent from `components.md` blocks the build; a page in `sitemap.md` with no layout file blocks mockup; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the layouts.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating all pages as requiring a mobile-first stacking order", "assuming hero section always appears first") so the user approves before it binds.

## Step 3 — Write the report
Write `.twt-artifacts/design/layout/validation-report.md`:
```markdown
# Validation report — layout
Generated: <ISO timestamp>  ·  Validator: /twt-layout-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Section order & hierarchy | 25 | <0-5> | <w> | <why> |
| Component-slot fit | 20 | <0-5> | <w> | <why> |
| Content-map completeness | 20 | <0-5> | <w> | <why> |
| Responsive intent | 20 | <0-5> | <w> | <why> |
| Consistency with IA | 15 | <0-5> | <w> | <why> |
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
State BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-layout-define (or re-run /twt-design, which folds the layout define→validate pass)."
