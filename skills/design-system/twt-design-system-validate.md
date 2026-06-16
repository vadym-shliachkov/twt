---
name: twt-design-system-validate
category: design-system
description: Read-only critique of tokens.md, tokens.css, and preview.html into validation-report.md
version: 1.2.1
accepts_arguments: false
inputs:
  - none (reads the design-system artifacts)
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/design-system/preview.html
  - .twt-artifacts/pre-design/brand/brand-brief.md
writes:
  - .twt-artifacts/design/design-system/validation-report.md
---

# /twt-design-system-validate

## Intent

**Purpose:** Read-only critique of the design system — token coverage across `tokens.md` / `tokens.css` / `preview.html`, WCAG contrast, scale coherence, brand fidelity, completeness for downstream build, and naming hygiene — written to `validation-report.md`.

**Non-goals:**
- Doesn't modify `tokens.md`, `tokens.css`, or `preview.html` (read-only; rule 11)
- Doesn't fix findings — that's `/twt-design-system-define`'s job
- Doesn't fabricate tokens

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `tokens.md` is missing, aborts pointing to `/twt-design-system-define`

---

## Step 1 — Load artifacts (hard dependency)
Read `.twt-artifacts/design/design-system/tokens.md`. If absent, abort: "No design system found — run /twt-design-system-define first." Do not create it. Also read `tokens.css` and `preview.html` if present, and `brand-brief.md` if present (for brand fidelity checks).

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Token contrast / accessibility | 25 | Color token pairings meet WCAG AA (compute ratios from the token hex values). |
| Scale coherence (type & space) | 20 | Type scale and spacing scale are consistent, rhythmic, not ad-hoc. |
| Brand fidelity | 20 | Tokens reflect `brand-brief.md` palette/type, not generic defaults. |
| Completeness for downstream build | 20 | Tokens cover what components/layouts/mockups will need (color, type, space, radius, shadow, motion), **and** `preview.html` renders the atomic evolution — Subatomic (tokens) → Atoms → Molecules → Organisms — with **every** atom, molecule, and organism documented in `tokens.md` Section 3 present (not just one example per level), each built only from `var(--…)` and the level below. BLOCKER if preview is token-only with no Atoms/Molecules/Organisms tiers; WARNING if a tier is present but omits documented components (list which are missing). |
| Naming / structure hygiene | 15 | Token names are systematic and namespaced; no duplicate/conflicting definitions. |

Compute `Weighted = Weight × Score / 5` per row; `Health = Σ Weighted` (0–100); `Band = Pass ≥80 / Revise 50–79 / Fail <50`.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. a text/surface color pair failing WCAG AA blocks accessible build; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing evidence from the tokens.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating the first listed surface/text pair as the primary readable combination", "assuming no dark-mode tokens are required") so the user approves before it binds.

## Step 2a — Critical assessment (is the system actually good?)
In greenfield, the derived palette/type **are the site's real colors and fonts** — so judge their quality, not just their internal coherence. As a senior design-systems designer, state plainly what is **good** and **weak**, with reasons:
- **Palette quality** — harmonious and considered or arbitrary? distinctive vs generic/dated (gradient-blue, AI-purple glow, beige+brass cliché)? accent discipline (one confident accent)? a usable neutral ramp and enough value range for an accessible UI? tints/shades present for states?
- **Type quality** — good pairing with real role separation? distinctive, or Inter-by-inertia? scale rhythm musical or ad-hoc?
- **System craft** — spacing/radius/shadow character coherent and intentional? motion tokens real (custom easings, sensible durations) or placeholder?
- **Verdict** — biggest strength · biggest weakness · the one highest-impact change before build.

Frame quality shortfalls as WARNING/SUGGESTION findings — state them, don't gloss. Source/brand fidelity scoring high does not earn an automatic Pass.

## Step 3 — Write the report
Write `.twt-artifacts/design/design-system/validation-report.md`:
```markdown
# Validation report — design-system
Generated: <ISO timestamp>  ·  Validator: /twt-design-system-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Token contrast / accessibility | 25 | <0-5> | <w> | <why> |
| Scale coherence (type & space) | 20 | <0-5> | <w> | <why> |
| Brand fidelity | 20 | <0-5> | <w> | <why> |
| Completeness for downstream build | 20 | <0-5> | <w> | <why> |
| Naming / structure hygiene | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Critical Assessment
- **Palette quality:** <good/weak + why — harmony, distinctiveness, dated?, accent discipline, neutral ramp, value range, state tints/shades>
- **Type quality:** <good/weak + why — pairing, distinctiveness, scale rhythm>
- **System craft:** <spacing/radius/shadow/motion character — intentional vs placeholder>
- **Verdict:** biggest strength · biggest weakness · the one highest-impact change before build

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <file · token/section>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 4 — Report
State BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-design-system-define (or /twt-design-system to loop automatically)."
