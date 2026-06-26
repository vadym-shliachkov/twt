---
name: twt-component-validate
category: component
description: (v1.0.2) Read-only critique of components.md and gallery.html into validation-report.md
version: 1.0.2
accepts_arguments: false
inputs:
  - none (reads the component artifacts)
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/component/components.md
  - .twt-artifacts/design/component/gallery.html
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/pre-design/ia/sitemap.md
writes:
  - .twt-artifacts/design/component/validation-report.md
---

# /twt-component-validate

## Intent

**Purpose:** Read-only critique of the component library — token-only styling, reuse/composition quality, state/variant coverage, accessibility affordances, and spec clarity — written to `validation-report.md`.

**Non-goals:**
- Doesn't modify `components.md` or `gallery.html` (read-only; rule 11)
- Doesn't fix findings — that's `/twt-component-define`'s job
- Doesn't invent missing components, only flags them

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `components.md` is missing, aborts pointing to `/twt-component-define`

---

## Step 1 — Load artifacts (hard dependency)
Read `.twt-artifacts/design/component/components.md`. If absent, abort: "No component library — run /twt-component-define first." Do not create it. Also read `gallery.html` and `tokens.css` if present, and `sitemap.md` if present (coverage check).

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Token-only styling | 25 | Component styles reference design-system tokens only — no hex/px/font literals. |
| Reuse / composition quality | 20 | Components compose well and avoid duplication; shared patterns are factored. |
| State / variant coverage | 20 | Needed states/variants (hover, focus, disabled, sizes) are specified. |
| A11y affordances | 20 | Focus states, semantics, labels, contrast considered. |
| Spec clarity | 15 | Each component's spec is unambiguous and buildable. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Token-only styling","weight":25,"score":<s1>},{"criterion":"Reuse / composition quality","weight":20,"score":<s2>},{"criterion":"State / variant coverage","weight":20,"score":<s3>},{"criterion":"A11y affordances","weight":20,"score":<s4>},{"criterion":"Spec clarity","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. a component using hardcoded values where tokens exist blocks accessible build; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the components.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating all interactive components as requiring keyboard focus styles", "assuming no dark-mode variant is required") so the user approves before it binds.

## Step 3 — Write the report
Write `.twt-artifacts/design/component/validation-report.md`:
```markdown
# Validation report — component
Generated: <ISO timestamp>  ·  Validator: /twt-component-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Token-only styling | 25 | <0-5> | <w> | <why> |
| Reuse / composition quality | 20 | <0-5> | <w> | <why> |
| State / variant coverage | 20 | <0-5> | <w> | <why> |
| A11y affordances | 20 | <0-5> | <w> | <why> |
| Spec clarity | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <component · section>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 4 — Report
State BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-component-define (or re-run /twt-design, which folds the component define→validate pass)."
