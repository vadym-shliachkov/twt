---
name: twt-curation-validate
category: curation
description: (v1.1.1) Critique curation against brand voice and IA; write validation-report.md
version: 1.1.1
accepts_arguments: false
inputs:
  - (none — reads curation artifacts and upstream)
dependencies:
  hard:
    - twt-curation-define
  soft:
    - twt-content-validate
reads:
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/ia/sitemap.md
writes:
  - .twt-artifacts/pre-design/curation/validation-report.md
---

# /twt-curation-validate

## Intent

**Purpose:** Act as a curation critic — read `inventory.md` and all `outlines/*.md`, score them against a weighted rubric, find coverage gaps, voice mismatches, invented content, and missing gap markers, and write a structured `validation-report.md` recommending fixes.

**Non-goals:**
- Writes only its own `validation-report.md` (rule 11); never edits inventory.md or any outline
- Recommends fixes, doesn't apply them
- Doesn't re-curate or rewrite outlines

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- Aborts to `/twt-curation-define` if `inventory.md` is missing

---

## Step 1 — Load the artifacts (hard dependency)
Read `.twt-artifacts/pre-design/curation/inventory.md` and all `outlines/*.md`. If `inventory.md` is absent, abort: "No curation artifacts found — run /twt-curation-define first." Do not create them. Also read `brand-brief.md`, `positioning.md`, and `sitemap.md` if present (for voice, priority, and coverage checks).

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Copy transformed not mirrored | 30 | Outline copy is rewritten in brand voice, not near-identical to the fetched source. (NOTE: the full rewrite feature lands in Phase 4 — until then this criterion will often score low / flag "mirrored"; score it honestly now.) |
| Brand-voice fidelity | 20 | Kept/elevated copy matches `brand-brief.md` voice. |
| IA/section coverage | 20 | Every sitemap page has an outline; every section maps to a KEEP/ELEVATE item or a GAP. |
| Fact-faithfulness / no invention | 20 | No facts/claims/numbers invented beyond the source. |
| Gap honesty | 10 | Missing content is marked `> GAP`, not faked. |

Compute `Weighted = Weight × Score / 5` per row; `Health = Σ Weighted` (0–100); `Band = Pass ≥80 / Revise 50–79 / Fail <50`.

Judge **Copy transformed not mirrored** and **Brand-voice fidelity** with the `/twt-content-validate` anchors in miniature — clarity, conciseness, user value, active voice — citing verbatim outline quotes as evidence; for a deep per-criterion evaluation of any single page's copy, recommend running `/twt-content-validate` on that outline (soft dependency).

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. a missing outline for a sitemap page blocks development; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the artifacts.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating a page's hero copy as transformed because tone differs slightly", "assuming a GAP section is intentional") so the user approves before it binds.

## Step 3 — Write the report
Write `.twt-artifacts/pre-design/curation/validation-report.md`:
```markdown
# Validation report — curation
Generated: <ISO timestamp>  ·  Validator: /twt-curation-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Copy transformed not mirrored | 30 | <0-5> | <w> | <why> |
| Brand-voice fidelity | 20 | <0-5> | <w> | <why> |
| IA/section coverage | 20 | <0-5> | <w> | <why> |
| Fact-faithfulness / no invention | 20 | <0-5> | <w> | <why> |
| Gap honesty | 10 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <section / line in inventory.md or outlines/>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 4 — Report
Print BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-curation-define (or re-run /twt-pre-design, which folds the curation define→validate pass)."
