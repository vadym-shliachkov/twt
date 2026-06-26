---
name: twt-ia-validate
category: ia
description: (v1.0.1) Critique sitemap.md + functional-scope.md against positioning and content; write report
version: 1.0.1
accepts_arguments: false
inputs:
  - (none — reads IA artifacts and upstream)
dependencies:
  hard:
    - twt-ia-define
  soft: []
reads:
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/ia/functional-scope.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/content-fetch/
writes:
  - .twt-artifacts/pre-design/ia/validation-report.md
---

# /twt-ia-validate

## Intent

**Purpose:** Act as an IA critic — read `sitemap.md` and `functional-scope.md`, score them against a weighted rubric, find coverage gaps, navigation problems, unclear page purposes, scope omissions, and positioning misalignment, and write a structured `validation-report.md` recommending fixes.

**Non-goals:**
- Writes only its own `validation-report.md` (rule 11); never edits sitemap.md or functional-scope.md
- Recommends fixes, doesn't apply them
- Doesn't redesign the sitemap or rewrite the functional scope

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If BOTH `sitemap.md` and `functional-scope.md` are missing, aborts pointing to `/twt-ia-define`

---

## Step 1 — Load the artifacts (hard dependency)
Read `.twt-artifacts/pre-design/ia/sitemap.md` and `.twt-artifacts/pre-design/ia/functional-scope.md`. If **both** are absent, abort: "No IA artifacts found — run /twt-ia-define first." Do not create them. If only one is missing, note it as a BLOCKER finding and proceed with what is available. Also read `positioning.md` and content-fetch outputs if present (for alignment and grounding checks).

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Sitemap coverage vs scope | 25 | Every functional-scope capability maps to a page; no orphan scope, no orphan page. |
| Navigation logic & depth | 20 | Nav hierarchy is logical; depth is sensible (no deep burial, no flat dump). |
| Page-purpose clarity | 20 | Each page has one clear purpose, not overlapping/ambiguous. |
| Functional-scope completeness | 20 | `functional-scope.md` covers the must-haves from the spec without gaps. |
| Consistency with positioning | 15 | IA emphasis reflects the positioning's audience + priorities. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Sitemap coverage vs scope","weight":25,"score":<s1>},{"criterion":"Navigation logic & depth","weight":20,"score":<s2>},{"criterion":"Page-purpose clarity","weight":20,"score":<s3>},{"criterion":"Functional-scope completeness","weight":20,"score":<s4>},{"criterion":"Consistency with positioning","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. orphan scope blocks development; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the IA artifacts.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating the blog as a secondary nav item", "assuming the contact page doubles as the lead-capture page") so the user approves before it binds.

## Step 3 — Write the report
Write `.twt-artifacts/pre-design/ia/validation-report.md`:
```markdown
# Validation report — ia
Generated: <ISO timestamp>  ·  Validator: /twt-ia-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Sitemap coverage vs scope | 25 | <0-5> | <w> | <why> |
| Navigation logic & depth | 20 | <0-5> | <w> | <why> |
| Page-purpose clarity | 20 | <0-5> | <w> | <why> |
| Functional-scope completeness | 20 | <0-5> | <w> | <why> |
| Consistency with positioning | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <section / line in sitemap.md or functional-scope.md>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 4 — Report
Print BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-ia-define (or re-run /twt-pre-design, which folds the IA define→validate pass)."
