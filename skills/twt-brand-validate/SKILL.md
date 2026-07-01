---
name: twt-brand-validate
category: brand
description: (v1.2.1) Critique brand-brief.md and write a validation-report.md (read-only critic)
version: 1.2.1
accepts_arguments: false
inputs:
  - (none — reads the canonical brand-brief.md)
dependencies:
  hard:
    - twt-brand-define
  soft: []
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - tools/check-brand-validation-report.mjs
  - references/brand-book-checklist.md
  - .twt-artifacts/pre-design/brand/_coverage.md
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
- A `## Detailed brand component evaluation` section evaluates every available brand component item-by-item, with pros, cons, all eight metric scores/evidence rows, and design handoff impact
- A `## Critical assessment` section delivers genuine design judgment on whether the palette, type, and voice are actually **good** (not just faithfully transcribed) — strengths, weaknesses, and what a top studio would change — even when the brand is already in production
- A `## Brand-book completeness & source coverage` section maps the brief onto `references/brand-book-checklist.md`, reports per-tier coverage % (Core/Recommended/Optional) and per-part status with source-coverage attribution (`silent` vs `not-extracted`), and passes the checker's new required-heading assertion
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Findings keep BLOCKER/WARNING/SUGGESTION with Where/Problem/Recommendation, Problem citing evidence
- Brand problems do not stop the workflow by themselves; the report must clearly inform the user before design proceeds, with BLOCKERs carried forward as known design risks
- The report passes `node "${CLAUDE_PLUGIN_ROOT}/tools/check-brand-validation-report.mjs" --file .twt-artifacts/pre-design/brand/validation-report.md`
- If `brand-brief.md` is missing, aborts pointing to `/twt-brand-define`

---

## Step 1 — Load the artifact (hard dependency)
Read `.twt-artifacts/pre-design/brand/brand-brief.md`. If absent, abort: "No brand-brief.md found — run /twt-brand-define first." Do not create it.

## Step 2 — Score the top-level rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Palette contrast / WCAG AA on key pairings | 25 | Text/background and primary-on-surface pairings meet AA (4.5:1 body, 3:1 large/UI). Compute actual ratios from the hex values. |
| Palette fit to context & audience | 20 | Hues/temperature/saturation suit the sector and audience implied by content + positioning. |
| Voice distinctiveness & consistency | 20 | ≥3 concrete, non-generic voice attributes; examples are consistent with them. |
| Positioning/message clarity | 20 | The brand statement says something specific and defensible, not vague. |
| Completeness & internal coherence | 15 | No TBD/missing required fields; no internal contradictions. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Palette contrast / WCAG AA on key pairings","weight":25,"score":<s1>},{"criterion":"Palette fit to context & audience","weight":20,"score":<s2>},{"criterion":"Voice distinctiveness & consistency","weight":20,"score":<s3>},{"criterion":"Positioning/message clarity","weight":20,"score":<s4>},{"criterion":"Completeness & internal coherence","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. AA failure on body text; WARNING if it degrades; SUGGESTION otherwise). Findings must explain *why*, citing evidence (e.g. "primary #1DB89C on #FFFFFF = 2.1:1, fails AA 4.5:1 for body").

**Source fidelity is not the goal — quality is.** Scoring high on "the tokens match the brand guide exactly" is necessary but not sufficient. A brand can be perfectly transcribed and still be mediocre. Do **not** give an in-production or internally-consistent brand an automatic Pass; judge whether the choices are *good*.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating teal as the only CTA color", "assuming light-mode only") so the user approves before it binds.

## Step 2a — Detailed brand component evaluation
Evaluate the brand brief at the item level. Include every item present in `brand-brief.md`, and explicitly mark missing but expected items as `Missing / not evaluable` rather than inventing values. This section is intentionally detailed: it should give the user enough context to decide whether to proceed, refine the brand, or accept known risk before design.

Use these eight evaluation dimensions for every item block. If a dimension truly does not apply to an item, still include the row and write `N/A — not applicable because <reason>` instead of omitting it:
- **Clarity** — how easily a designer, writer, stakeholder, or user could understand the item
- **Relevance** — how well it fits the audience, category, offer, and business context
- **Distinctiveness** — how hard it is to confuse with competitors or generic category language
- **Consistency** — whether it aligns with the rest of the brand brief and likely touchpoints
- **Actionability** — whether it gives enough instruction to produce design, copy, or experience decisions
- **Evidence quality** — whether the item is sourced, proven, or only inferred
- **Accessibility / usability** — for palette, typography, layout, motion, UX, and touchpoint rules
- **Governance readiness** — whether teams can apply the rule repeatedly without guessing

Score each non-`N/A` dimension 0–5 and compute an **Item health** as the unweighted average of the scored dimensions. Do not blend these item scores into the top-level Health unless the item also affects a weighted Scorecard row; the detailed section is diagnostic depth, not a second competing total.

For each item, write:
- **Evaluation method:** the best way to evaluate that item in practice (for example: strategic fit test, competitor differentiation, recall/comprehension test, WCAG contrast check, readability test, voice consistency audit, touchpoint audit, governance usability test)
- **Metric values:** all eight dimension rows with concise evidence, including justified `N/A` rows where a dimension is not applicable
- **Pros:** concrete strengths that should be preserved
- **Cons / risks:** concrete weaknesses, gaps, contradictions, unsupported assumptions, or downstream design risks
- **Severity:** `BLOCKER`, `WARNING`, `SUGGESTION`, or `OK`; use BLOCKER only when proceeding would likely cause inaccessible, misleading, contradictory, legally risky, or unusable design decisions
- **Design handoff note:** what the design phase should do with the item: use as binding, use with caution, ask user before binding, or treat as unresolved

Use this item inventory as the default checklist. If the brief uses different headings, map its content into the closest item; if an item is absent, keep it in the report as a gap when it matters for downstream design:

| Area | Items to evaluate | Primary evaluation method |
|------|-------------------|---------------------------|
| Core brand | brand name, mission, vision, purpose, values, positioning, target audience, brand promise, differentiators, personality/archetype | strategic fit, clarity, competitive differentiation, behavior/proof audit |
| Verbal identity | tagline, voice attributes, tone rules, messaging pillars, elevator pitch, key phrases, do/don't language, brand story | recall/comprehension, voice consistency, context fit, evidence/relevance test |
| Visual identity | logo system, palette, typography, imagery, illustration, iconography, graphic elements, layout principles, motion | recognition/scalability, WCAG contrast, readability, semantic fit, system consistency |
| Experience identity | website/product UI, support, onboarding, packaging/materials, social, sales materials, community/events, sound/sensory identity | touchpoint audit, UX testing, expectation-delivery gap, channel-fit evaluation |
| Governance | brand guidelines, templates, asset library, accessibility rules, legal/trademark/licensing, consistency checklist | governance usability, adoption readiness, compliance and rights check |

## Step 2a′ — Brand-book completeness & source coverage
Load `references/brand-book-checklist.md` (the canonical tiered TOC). For every part, decide its presence in `brand-brief.md`: `Complete | Partial | Missing`. Then attribute *why* a part is Partial/Missing using the fetch coverage manifest `.twt-artifacts/pre-design/brand/_coverage.md` when it exists:
- `silent` — the sources genuinely had nothing (do not fault the pipeline).
- `not-extracted` — signal existed but capture failed (a fetch/define gap to fix).
- `n/a` — the part is Complete, or its tier makes it out of scope for this project.

If `_coverage.md` is absent (e.g. the brief was authored by hand), attribute from the brief + `## Sources` alone and mark attribution `unknown` rather than guessing.

Compute per-tier coverage %: for each tier, `(Complete + 0.5·Partial) / parts-in-tier · 100`, rounded. **Core** gaps become WARNING findings (BLOCKER only when a Core part is both Missing *and* downstream-blocking — e.g. no palette at all, so tokens cannot be derived). Recommended/Optional gaps are informational and never BLOCK. This section is additive — it does not change the weighted Scorecard or the 8-dimension item evaluation.

## Step 2b — Critical assessment
Beyond the rubric scores, render an opinionated critique as a senior brand/visual designer would — say plainly what is **good** and what is **weak**, with reasons:
- **Palette** — Is it harmonious and considered, or arbitrary? Distinctive in its sector or generic? Dated (e.g. 2010s gradient-blue, the AI-purple glow, beige+brass premium-consumer cliché)? Is the accent disciplined (one confident accent vs. a confetti of hues)? Enough contrast/value range to build an accessible, legible UI? Does it give the design phase room (tints/shades, a usable neutral ramp)?
- **Typography** — Is the pairing good (clear role separation, not two near-identical sans)? Is there a real hierarchy? Distinctive or default-Arial/Inter-by-inertia? Suited to the audience and tone?
- **Voice** — Distinctive and ownable, or templated marketing-speak? Do the example lines actually sound like the stated attributes?
- **Coherence** — Do palette + type + voice cohere into one identity, or pull in different directions?

End with a one-line **verdict**: the brand's biggest strength, its biggest weakness, and the single highest-impact change a top studio would make. Frame quality shortfalls as WARNING/SUGGESTION findings (they rarely BLOCK on their own, but they must be stated, not glossed).

## Step 2c — Workflow continuation rule
Validation is an informed-risk gate, not an automatic stop sign. Do **not** halt or suppress later workflow steps just because the brand is weak, incomplete, or sub-Pass. Instead:
- Report every BLOCKER/WARNING/SUGGESTION clearly in `validation-report.md`
- Include a `## Before design proceeds` section that tells the user what must be known before Phase 2 binds brand choices into design tokens, components, layouts, or copy
- For unresolved brand risks, state the safest downstream behavior: keep placeholders, ask the user, preserve source values without improving them, or proceed with explicit caveats
- Only describe an item as blocking design when it would make downstream work inaccessible, contradictory, legally unsafe, or impossible to execute responsibly

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

## Detailed brand component evaluation
### Core brand
#### <Item name>
- **Status:** <Present | Partial | Missing / not evaluable>
- **Evaluation method:** <method>
- **Item health:** <0-5> / 5
- **Metric values:**
  - Clarity: <0-5> — <evidence>
  - Relevance: <0-5> — <evidence>
  - Distinctiveness: <0-5> — <evidence>
  - Consistency: <0-5> — <evidence>
  - Actionability: <0-5> — <evidence>
  - Evidence quality: <0-5> — <evidence>
  - Accessibility / usability: <0-5 | N/A> — <evidence or why not applicable>
  - Governance readiness: <0-5 | N/A> — <evidence or why not applicable>
- **Pros:** <specific strengths>
- **Cons / risks:** <specific weaknesses or gaps>
- **Severity:** <OK | SUGGESTION | WARNING | BLOCKER>
- **Design handoff note:** <binding / caution / ask user / unresolved>

### Verbal identity
<repeat the item block for tagline, voice, tone, messaging pillars, elevator pitch, key phrases, do/don't language, brand story, as applicable>

### Visual identity
<repeat the item block for logo, palette, typography, imagery, illustration, iconography, graphic elements, layout principles, motion, as applicable; include actual contrast ratios for palette pairings and readability/accessibility evidence for type>

### Experience identity
<repeat the item block for product/UI, support, onboarding, packaging/materials, social, sales materials, community/events, sound/sensory identity, as applicable>

### Governance
<repeat the item block for guidelines, templates, asset library, accessibility rules, legal/trademark/licensing, consistency checklist, as applicable>

## Critical assessment
- **Palette:** <good/weak + why — harmony, distinctiveness, dated?, accent discipline, contrast/value range, headroom for UI>
- **Typography:** <good/weak + why — pairing, hierarchy, distinctiveness, audience fit>
- **Voice:** <good/weak + why — ownable vs templated; do examples match the attributes?>
- **Coherence:** <do palette + type + voice form one identity?>
- **Verdict:** biggest strength · biggest weakness · the one highest-impact change a top studio would make

## Before design proceeds
- **Proceed status:** <Proceed with caveats | Ask before binding | Resolve first for accessibility/legal/contradiction>
- **User-facing notice:** <plain-language note to show before Phase 2 starts>
- **Design-safe defaults:** <what downstream design should do if the issue is deferred>
- **Unresolved brand risks:** <short list, or none>

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

After writing, run:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/check-brand-validation-report.mjs" --file .twt-artifacts/pre-design/brand/validation-report.md
```

If the checker fails, fix `validation-report.md` until it passes. The checker is structural; passing it does not replace the quality judgment required by this rubric.

## Step 4 — Report
Print BLOCKER/WARNING/SUGGESTION counts and the `Before design proceeds` status. End with: "Brand validation does not automatically stop the workflow. Review the report before design proceeds; to address findings, run /twt-brand-define (or /twt-brand to loop automatically)."
