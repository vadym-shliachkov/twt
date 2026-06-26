---
name: twt-spec-validate
category: spec
description: (v1.0.2) Critique specification.md and write a validation-report.md (read-only critic)
version: 1.0.2
accepts_arguments: false
inputs:
  - (none — reads the canonical specification.md)
dependencies:
  hard:
    - twt-spec-define
  soft: []
reads:
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
writes:
  - .twt-artifacts/pre-design/spec/validation-report.md
---

# /twt-spec-validate

## Intent

**Purpose:** Act as a spec critic — read `specification.md`, find vagueness, blank fields, weak visual/motion direction, and contradictions with `brand-brief.md`, and write a structured `validation-report.md` recommending fixes.

**Non-goals:**
- Doesn't edit `specification.md` or any file other than its own `validation-report.md` (CONVENTIONS rule 11)
- Doesn't apply fixes — recommends only
- Doesn't invent project direction

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `specification.md` is missing, aborts pointing to `/twt-spec-define`
- Enforces the no-Figma visual-direction gate (BLOCKER when `figma: none` and `visual_direction: model-assumed`)

---

## Step 1 — Load the artifact (hard dependency)
Read `.twt-artifacts/pre-design/spec/specification.md`. If absent, abort: "No specification.md found — run /twt-spec-define first." Do not create it. Also read `brand-brief.md` if present (for contradiction checks).

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Visual direction concreteness & renderability | 25 | The Visual Style is specific and renderable (not "modern/clean") — a designer could build from it. |
| Motion direction concreteness incl. reduced-motion | 15 | Motion personality, key interactions, and a reduced-motion stance are concrete. |
| Vision/goals clarity & measurability | 20 | Vision is one clear line; goals have measurable success signals. |
| Functional scope realism | 20 | Must-have capabilities are realistic and scoped, not a wishlist. |
| Non-contradiction with brand | 20 | Nothing contradicts `brand-brief.md` (voice, palette, audience). |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Visual direction concreteness & renderability","weight":25,"score":<s1>},{"criterion":"Motion direction concreteness incl. reduced-motion","weight":15,"score":<s2>},{"criterion":"Vision/goals clarity & measurability","weight":20,"score":<s3>},{"criterion":"Functional scope realism","weight":20,"score":<s4>},{"criterion":"Non-contradiction with brand","weight":20,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

**No-Figma visual-direction gate (hard BLOCKER):** Read `specification.md` frontmatter `figma:` and `visual_direction:`. If `figma: none` AND `visual_direction: model-assumed`, raise a **BLOCKER** finding: "Visual direction unconfirmed — no Figma was provided and the direction was model-assumed; the user must pick/confirm an art direction before the design phase proceeds." This caps the "Visual direction concreteness" criterion at ≤2 regardless of how concrete the prose is (an unconfirmed direction is not a usable direction). If `figma: used` OR `visual_direction: user-confirmed`, no gate.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. missing reduced-motion stance blocks accessible build; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the spec.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating light-mode as the only stance", "assuming motion is optional") so the user approves before it binds.

## Step 3 — Write the report
Write `.twt-artifacts/pre-design/spec/validation-report.md`:
```markdown
# Validation report — spec
Generated: <ISO timestamp>  ·  Validator: /twt-spec-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Visual direction concreteness & renderability | 25 | <0-5> | <w> | <why> |
| Motion direction concreteness incl. reduced-motion | 15 | <0-5> | <w> | <why> |
| Vision/goals clarity & measurability | 20 | <0-5> | <w> | <why> |
| Functional scope realism | 20 | <0-5> | <w> | <why> |
| Non-contradiction with brand | 20 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <section / line in specification.md>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 4 — Report
Print BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-spec-define (or /twt-spec to loop automatically)."
