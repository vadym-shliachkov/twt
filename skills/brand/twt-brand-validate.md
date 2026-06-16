---
name: twt-brand-validate
category: brand
description: Critique brand-brief.md and write a validation-report.md (read-only critic)
version: 1.1.1
accepts_arguments: false
inputs:
  - (none — reads the canonical brand-brief.md)
dependencies:
  hard:
    - twt-brand-define
  soft: []
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
writes:
  - .twt-artifacts/pre-design/brand/validation-report.md
---

# /twt-brand-validate

## Intent

**Purpose:** Act as a brand critic — read `brand-brief.md`, find consistency problems, missing fields, vagueness, and internal contradictions, and write a structured `validation-report.md` recommending fixes.

**Non-goals:**
- Doesn't edit `brand-brief.md` or any file other than its own `validation-report.md` (CONVENTIONS rule 11)
- Doesn't apply fixes — recommends only
- Doesn't fetch or invent brand data

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (criteria summing to 100) yielding a **Health 0–100 + Band**
- At least the contrast criterion is computed from actual hex values; AA failures on body text are BLOCKERs
- A `## Critical Assessment` section delivers genuine design judgment on whether the palette, type, and voice are actually **good** (not just faithfully transcribed) — strengths, weaknesses, and what a top studio would change — even when the brand is already in production
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Findings keep BLOCKER/WARNING/SUGGESTION with Where/Problem/Recommendation, Problem citing evidence
- If `brand-brief.md` is missing, aborts pointing to `/twt-brand-define`

---

## Step 1 — Load the artifact (hard dependency)
Read `.twt-artifacts/pre-design/brand/brand-brief.md`. If absent, abort: "No brand-brief.md found — run /twt-brand-define first." Do not create it.

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Palette contrast / WCAG AA on key pairings | 25 | Text/background and primary-on-surface pairings meet AA (4.5:1 body, 3:1 large/UI). Compute actual ratios from the hex values. |
| Palette fit to context & audience | 20 | Hues/temperature/saturation suit the sector and audience implied by content + positioning. |
| Voice distinctiveness & consistency | 20 | ≥3 concrete, non-generic voice attributes; examples are consistent with them. |
| Positioning/message clarity | 20 | The brand statement says something specific and defensible, not vague. |
| Completeness & internal coherence | 15 | No TBD/missing required fields; no internal contradictions. |

Compute `Weighted = Weight × Score / 5` per row; `Health = Σ Weighted` (0–100); `Band = Pass ≥80 / Revise 50–79 / Fail <50`.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. AA failure on body text; WARNING if it degrades; SUGGESTION otherwise). Findings must explain *why*, citing evidence (e.g. "primary #1DB89C on #FFFFFF = 2.1:1, fails AA 4.5:1 for body").

**Source fidelity is not the goal — quality is.** Scoring high on "the tokens match the brand guide exactly" is necessary but not sufficient. A brand can be perfectly transcribed and still be mediocre. Do **not** give an in-production or internally-consistent brand an automatic Pass; judge whether the choices are *good*.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating teal as the only CTA color", "assuming light-mode only") so the user approves before it binds.

## Step 2a — Critical assessment (genuine design judgment)
Beyond the rubric scores, render an opinionated critique as a senior brand/visual designer would — say plainly what is **good** and what is **weak**, with reasons:
- **Palette** — Is it harmonious and considered, or arbitrary? Distinctive in its sector or generic? Dated (e.g. 2010s gradient-blue, the AI-purple glow, beige+brass premium-consumer cliché)? Is the accent disciplined (one confident accent vs. a confetti of hues)? Enough contrast/value range to build an accessible, legible UI? Does it give the design phase room (tints/shades, a usable neutral ramp)?
- **Typography** — Is the pairing good (clear role separation, not two near-identical sans)? Is there a real hierarchy? Distinctive or default-Arial/Inter-by-inertia? Suited to the audience and tone?
- **Voice** — Distinctive and ownable, or templated marketing-speak? Do the example lines actually sound like the stated attributes?
- **Coherence** — Do palette + type + voice cohere into one identity, or pull in different directions?

End with a one-line **verdict**: the brand's biggest strength, its biggest weakness, and the single highest-impact change a top studio would make. Frame quality shortfalls as WARNING/SUGGESTION findings (they rarely BLOCK on their own, but they must be stated, not glossed).

## Step 3 — Write the report
Write `.twt-artifacts/pre-design/brand/validation-report.md`:
```markdown
# Validation report — brand
Generated: <ISO timestamp>  ·  Validator: /twt-brand-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Palette contrast / WCAG AA | 25 | <0-5> | <w> | <ratios computed> |
| Palette fit to context & audience | 20 | <0-5> | <w> | <why> |
| Voice distinctiveness & consistency | 20 | <0-5> | <w> | <why> |
| Positioning/message clarity | 20 | <0-5> | <w> | <why> |
| Completeness & internal coherence | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Critical Assessment
- **Palette:** <good/weak + why — harmony, distinctiveness, dated?, accent discipline, contrast/value range, headroom for UI>
- **Typography:** <good/weak + why — pairing, hierarchy, distinctiveness, audience fit>
- **Voice:** <good/weak + why — ownable vs templated; do examples match the attributes?>
- **Coherence:** <do palette + type + voice form one identity?>
- **Verdict:** biggest strength · biggest weakness · the one highest-impact change a top studio would make

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <section / line in brand-brief.md>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 4 — Report
Print BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-brand-define (or /twt-brand to loop automatically)."
