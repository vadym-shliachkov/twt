---
name: twt-positioning-validate
category: positioning
description: (v1.0.2) Critique positioning.md against brand and content signal; write validation-report.md
version: 1.0.2
accepts_arguments: false
inputs:
  - (none — reads positioning.md and upstream artifacts)
dependencies:
  hard:
    - twt-positioning-define
  soft: []
reads:
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/content/fetched/
writes:
  - .twt-artifacts/pre-design/positioning/validation-report.md
---

# /twt-positioning-validate

## Intent

**Purpose:** Act as a positioning critic — read `positioning.md`, find vague audiences, weak or unranked value props, unsupported claims, contradictions with brand voice, and incoherent promotion priorities, and write a structured `validation-report.md` recommending fixes.

**Non-goals:**
- Writes only its own `validation-report.md` (rule 11); never edits positioning.md
- Recommends fixes, doesn't apply them
- Doesn't invent market data or project direction

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `positioning.md` is missing, aborts pointing to `/twt-positioning-define`

---

## Step 1 — Load the artifact (hard dependency)
Read `.twt-artifacts/pre-design/positioning/positioning.md`. If absent, abort: "No positioning.md found — run /twt-positioning-define first." Do not create it. Also read `brand-brief.md` and content-fetch outputs if present (for contradiction and grounding checks).

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Audience specificity | 25 | Primary audience is concrete (role, context, need) — not "everyone". |
| Value-prop differentiation | 25 | Value props are differentiated and defensible, not generic claims. |
| Evidence/proof grounding | 20 | Claims are grounded in real proof points from content, not invented. |
| Consistency with brand voice | 15 | Tone/wording aligns with `brand-brief.md` voice. |
| Promotion-priority coherence | 15 | Promotion priorities follow logically from audience + value props. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Audience specificity","weight":25,"score":<s1>},{"criterion":"Value-prop differentiation","weight":25,"score":<s2>},{"criterion":"Evidence/proof grounding","weight":20,"score":<s3>},{"criterion":"Consistency with brand voice","weight":15,"score":<s4>},{"criterion":"Promotion-priority coherence","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. vague audience blocks IA and copy direction; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the positioning doc.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating the enterprise buyer as the only audience", "assuming differentiation from incumbents is implicit") so the user approves before it binds.

## Step 3 — Write the report
Write `.twt-artifacts/pre-design/positioning/validation-report.md`:
```markdown
# Validation report — positioning
Generated: <ISO timestamp>  ·  Validator: /twt-positioning-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Audience specificity | 25 | <0-5> | <w> | <why> |
| Value-prop differentiation | 25 | <0-5> | <w> | <why> |
| Evidence/proof grounding | 20 | <0-5> | <w> | <why> |
| Consistency with brand voice | 15 | <0-5> | <w> | <why> |
| Promotion-priority coherence | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <section / line in positioning.md>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

Then verify its structure (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-validation-report.mjs" --file <the report path written above>` — if it fails, fix the report until it passes. The check is structural (scorecard arithmetic, band consistency, finding format, required sections); passing it never replaces this rubric's judgment.

## Step 4 — Report
Print BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-positioning-define (or /twt-positioning to loop automatically)."
