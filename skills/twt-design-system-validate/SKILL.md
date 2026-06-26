---
name: twt-design-system-validate
category: design-system
description: (v1.4.1) Read-only critique of tokens.md, tokens.css, and preview.html into validation-report.md (deterministic WCAG contrast gate via gen-preview --check)
version: 1.4.1
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

### Step 1a — Deterministic contrast evidence (read-only)
If `tokens.css` exists, run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/tools/gen-preview.mjs" "$CLAUDE_PROJECT_DIR" --check`. The `--check` flag computes the WCAG contrast matrix and prints a ` ```json ` block **without writing any file** (stays within rule 11 read-only). Parse `contrast_failures[]` — each entry is an **intended** text/surface pairing below AA 4.5:1 for normal text. Use this as the authoritative contrast evidence for the rubric's accessibility criterion instead of estimating ratios by eye. If the script is unavailable (global install), fall back to computing ratios from the token hex values yourself.

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Token contrast / accessibility | 25 | Intended text/surface token pairings meet WCAG AA (use the `gen-preview --check` `contrast_failures[]` from Step 1a). **BLOCKER** if any intended text-on-surface pair fails AA 4.5:1 for normal text — this is the gate that must stop a low-contrast system reaching QA. Score ≤2 when failures exist. |
| Scale coherence (type & space) | 20 | Type scale and spacing scale are consistent, rhythmic, not ad-hoc. |
| Brand fidelity | 20 | Tokens reflect `brand-brief.md` palette/type, not generic defaults. |
| Completeness for downstream build | 20 | Tokens cover what components/layouts/mockups will need (color, type, space, radius, shadow, motion), **and** `preview.html` renders the evolution — Tokens → Primitives → Components → Modules — with **every** Primitive, Component, and Module documented in `tokens.md` Section 3 present (not just one example per level), each built only from `var(--…)` and the level below. The preview is `gen-preview.mjs`-generated, so check that **no `<!-- gp:fill … -->` slots remain unfilled** (any left = incomplete) and specimen counts match §3.2/§3.3/§3.4. BLOCKER if preview is token-only with no Primitives/Components/Modules tiers, or if any `gp:fill` slot is still empty; WARNING if a tier omits documented components. **Also a BLOCKER if the preview is a marketing landing page / homepage mockup instead of a neutral specimen sheet** — i.e. it uses real project copy (real hero headline, value props, case-study/stat numbers, testimonials, CTA messaging), assembles a running homepage rather than an inventory of captioned specimens, wires a real nav, or includes `<script>`/GSAP/auto-advancing/scroll-triggered demos of "the site." The fix is to re-render Modules as isolated, neutrally-labeled specimens. |
| Naming / structure hygiene | 15 | Token names are systematic and namespaced; no duplicate/conflicting definitions. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Token contrast / accessibility","weight":25,"score":<s1>},{"criterion":"Scale coherence (type & space)","weight":20,"score":<s2>},{"criterion":"Brand fidelity","weight":20,"score":<s3>},{"criterion":"Completeness for downstream build","weight":20,"score":<s4>},{"criterion":"Naming / structure hygiene","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

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
