---
name: twt-audience-validate
category: audience
description: (v1.0.1) Critique personas.md — segment traceability, value-prop linkage, journey actionability; write validation-report.md
version: 1.0.1
accepts_arguments: false
inputs:
  - (none — reads personas.md and upstream artifacts)
dependencies:
  hard:
    - twt-audience-define
  soft: []
reads:
  - .twt-artifacts/pre-design/audience/personas.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/ia/sitemap.md
writes:
  - .twt-artifacts/pre-design/audience/validation-report.md
---

# /twt-audience-validate

## Intent

**Purpose:** Act as a persona critic — verify every persona traces to a real positioning segment and value prop, journeys end in concrete conversion actions, page bindings reference real sitemap pages, and tone preferences don't contradict brand voice — and write a structured `validation-report.md`.

**Non-goals:**
- Writes only its own `validation-report.md` (rule 11); never edits personas.md
- Recommends fixes, doesn't apply them
- Doesn't judge whether the *positioning segments themselves* are right (that's `/twt-positioning-validate`)

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- Traceability is checked mechanically: each persona's named segment is matched against positioning.md's actual segment list
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `personas.md` is missing, aborts pointing to `/twt-audience-define`

---

## Step 1 — Load the artifact (hard dependency)
Read `.twt-artifacts/pre-design/audience/personas.md`. If absent, abort: "No personas.md found — run /twt-audience-define first." Do not create it. Also read `positioning/positioning.md` (segment + value-prop baselines — if *it* is missing, every traceability check fails as a BLOCKER), `brand/brand-brief.md` (voice bounds), and `ia/sitemap.md` if present (page-binding baseline).

## Step 2 — Mechanical checks
Before scoring, verify (Read/Grep):
- every persona's `(segment: …)` names a segment that actually appears in positioning.md — flag inventions
- every persona's `Value props addressed` names value props that exist in positioning.md
- every journey table has all four stages and ends with a `Conversion action:` line naming a concrete action (a verb + object, not "converts"/"engages")
- when the Page column is bound, every named page exists in `sitemap.md`; unbound `—` cells are valid while no sitemap exists **or** while `sitemap.md` carries the mapping instead (its `serves: <persona> — <stage>` notes) — flag only when neither side maps a stage
- persona count is 2–4; flag a single persona (too thin to differentiate) or 5+ (dilution)

## Step 3 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Segment traceability | 25 | Every persona maps 1:1 onto a real positioning segment; nothing invented. |
| Value-prop linkage | 20 | Each persona names the value prop(s) it responds to, and each primary value prop has at least one persona. |
| Persona concreteness | 20 | Goals/jobs/objections are specific and grounded (or honestly TBD) — no horoscope traits. |
| Journey actionability | 20 | Stages carry real information needs a page can satisfy; conversion actions are concrete and observable. |
| Voice & binding consistency | 15 | Tone preferences fit brand-brief voice; page bindings (when present) resolve to real sitemap pages. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Segment traceability","weight":25,"score":<s1>},{"criterion":"Value-prop linkage","weight":20,"score":<s2>},{"criterion":"Persona concreteness","weight":20,"score":<s3>},{"criterion":"Journey actionability","weight":20,"score":<s4>},{"criterion":"Voice & binding consistency","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. an invented segment misdirects IA priorities and copy tone; a journey with no conversion action leaves layout without a page goal; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing the persona/journey line.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating the returning-client persona as secondary everywhere", "assuming mobile-first for the on-site persona").

## Step 4 — Write the report
Write `.twt-artifacts/pre-design/audience/validation-report.md`:
```markdown
# Validation report — audience
Generated: <ISO timestamp>  ·  Validator: /twt-audience-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Segment traceability | 25 | <0-5> | <w> | <why> |
| Value-prop linkage | 20 | <0-5> | <w> | <why> |
| Persona concreteness | 20 | <0-5> | <w> | <why> |
| Journey actionability | 20 | <0-5> | <w> | <why> |
| Voice & binding consistency | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <persona / journey row in personas.md>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

Then verify its structure (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-validation-report.mjs" --file <the report path written above>` — if it fails, fix the report until it passes. The check is structural (scorecard arithmetic, band consistency, finding format, required sections); passing it never replaces this rubric's judgment.

## Step 5 — Report
Print BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-audience-define (or /twt-audience for the one-pass workflow)."
