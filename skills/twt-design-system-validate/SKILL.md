---
name: twt-design-system-validate
category: design-system
description: (v1.4.2) Read-only critique of tokens.md, tokens.css, and preview.html into validation-report.md (deterministic WCAG contrast gate via gen-preview --check)
version: 1.4.2
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
  - .twt-artifacts/design/design-system/decisions.md
  - .twt-artifacts/design/design-read.md
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

Also read, if present:
- `.twt-artifacts/design/design-system/decisions.md` — decisions the user (or define, in collect mode) already recorded. A defect the user **explicitly accepted** there (e.g. a contrast pair marked "accept the risk") is not a fresh BLOCKER: report it as a **WARNING** noting "user-accepted in decisions.md" so it stays visible without re-triggering the orchestrator's BLOCKER re-run. An `## Open questions` entry that is still `status: open` is different — it's undecided, so score it on the merits.
- `.twt-artifacts/design/design-read.md` — the visual-direction read (dials + direction notes). When its `status:` is `confirmed`, judge **Brand fidelity** and the Critical Assessment against the brief *as steered by the confirmed direction* — a distinctive type pairing or density chosen through the Design Read gate is a decision to honor, not a deviation to flag.

### Step 1a — Deterministic contrast evidence (read-only)
If `tokens.css` exists, run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/tools/gen-preview.mjs" "$CLAUDE_PROJECT_DIR" --check`. The `--check` flag computes the WCAG contrast matrix and prints a ` ```json ` block **without writing any file** (stays within rule 11 read-only). Parse `contrast_failures[]` — each entry is an **intended** text/surface pairing below AA 4.5:1 for normal text. Use this as the authoritative contrast evidence for the rubric's accessibility criterion instead of estimating ratios by eye. If the script is unavailable (global install), fall back to computing ratios from the token hex values yourself.

Also parse `near_dup_pairs[]` (cross-role primitives that are visually near-identical in the same use context) and `flat_gradients[]` (gradients whose stops read as one flat fill). Each entry **not justified in `tokens.md`** (as a documented ramp or named exception) is a **WARNING** finding under Naming / structure hygiene: Where = the two token names (or gradient name), Problem = indistinguishable values bloat the palette and make the preview unreadable, Recommendation = merge the primitives (Layer-2 purpose tokens both point at the survivor) or document why both exist.

## Step 2 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Token contrast / accessibility | 25 | Intended text/surface token pairings meet WCAG AA (use the `gen-preview --check` `contrast_failures[]` from Step 1a). **BLOCKER** if any intended text-on-surface pair fails AA 4.5:1 for normal text — this is the gate that must stop a low-contrast system reaching QA. Score ≤2 when failures exist. Two downgrades: a failure the user **accepted in `decisions.md`** is a WARNING (noted as user-accepted, per Step 1); a failure whose token is documented in `tokens.md §2.1`/§5 as **large-text/structure only** is a WARNING *only if* its `aa_large` flag is true (ratio ≥ 3.0:1 — AA for large text) — a documented restriction below even 3.0:1 stays a BLOCKER. |
| Scale coherence (type & space) | 20 | Type scale and spacing scale are consistent, rhythmic, not ad-hoc. |
| Brand fidelity | 20 | Tokens reflect `brand-brief.md` palette/type, not generic defaults. |
| Completeness for downstream build | 20 | Tokens cover what components/layouts/mockups will need (color, type, space, radius, shadow, motion — including the full type system: families, weights, line-heights, tracking, not sizes alone). `preview.html` is the **tokens-only** sheet `gen-preview.mjs` generates (the component catalog lives separately in `component/gallery.html`): check it exists and was script-generated (`gp-` namespaced markup), that `tokens.md §2.2` has a **Text styles** table and the preview rendered one specimen per row (the gen-preview `counts` include them), that `tokens.md §3` documents the Primitives/Components/Modules inventory and the gen-preview `counts` match §3.2/§3.3/§3.4, and that the preview carries the **component-gallery link**. BLOCKER if a token category downstream phases need is absent, if `preview.html` is missing or hand-written instead of generated, or if `tokens.md §3` is empty (the component skill and audit have no names to reuse); WARNING if the Text styles table is missing (preview falls back to raw axes) or §3 counts disagree with the generated preview. Do **not** expect component specimens inside `preview.html` — a tokens-only preview is correct by construction; the catalog's completeness is `/twt-component-validate`'s job. |
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

Then verify its structure (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-validation-report.mjs" --file <the report path written above>` — if it fails, fix the report until it passes. The check is structural (scorecard arithmetic, band consistency, finding format, required sections); passing it never replaces this rubric's judgment.

## Step 4 — Report
State BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-design-system-define (or /twt-design-system to loop automatically)."
