---
name: twt-brand-define
surface: internal
user-invocable: false
category: brand
family: brand
role: define
unit: twt-pre-design
description: (v1.1.6) Build or refine the canonical brand-brief.md through guided dialogue
version: 1.1.6
accepts_arguments: true
inputs:
  - Optional starting notes or answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-brand-fetch
reads:
  - .twt-artifacts/pre-design/brand/_fetched-brand.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/validation-report.md
  - references/brand-book-checklist.md
  - .twt-artifacts/pre-design/brand/_coverage.md
writes:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/decisions.md
  - .twt-artifacts/pre-design/brand/validation-report.md
---

# /twt-brand-define

## Intent

**Purpose:** Produce the canonical `brand-brief.md` — palette, typography, voice/tone, values, audience signals — either from scratch via interview or by refining an existing brief (including addressing validation findings).

**Non-goals:**
- Doesn't fetch from external sources (that's `/twt-brand-fetch`)
- Doesn't critique its own output in standalone mode (that's `/twt-brand-validate`); collect mode has the explicit folded-validation exception below
- Never overwrites `brand-brief.md` without explicit user consent

**Success criteria:**
- `brand-brief.md` exists with all canonical sections populated or explicitly marked TBD
- On re-run with an existing brief, enters refinement mode rather than starting over
- Voice section has at least 3 attributes with do/don't examples
- Given the `fold-validation` token, writes the full sibling `validation-report.md` using the rubric reproduced in Step 1c, not a compact pass/fail summary; without it, writes no validation report

---

## Step 1 — Detect mode (idempotency, CONVENTIONS rule 10)
If `brand-brief.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them and ask which to address. If it does not exist → **from-scratch mode**: read `_fetched-brand.md` if present to seed answers.

Also read `.twt-artifacts/pre-design/brand/_coverage.md` if present: it tells you which brand-book parts the fetch found, which were `Silent`, and which were `Not-extracted`. Use it to steer the interview toward thin **Core** parts and to decide what to mark `TBD` (see Step 2/Step 3).

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the brand-brief from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/brand/decisions.md` (decisions.md format — frontmatter `generated`/`area`/`producer`/`status: open`; sections `## Open questions` (question — options [a,b,c] — model-leaning, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (field = value — basis — reversible), `## Proposed rules (confirm before binding)`). Set `status: open`. After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes; three consumers (the orchestrator's surface-up flow, gen-report, wiki-harvest) parse this exact format, and a drifted section title is silently invisible to them.

Then write the draft brand-brief.

## Step 1c — Folded validation (only on the `fold-validation` token)
Perform the **folded validation exception** (CONVENTIONS §11) **only when `$ARGUMENTS` also contains the token `fold-validation`**. That token is separate from `subagent-collect` on purpose: `subagent-collect` means "you are a subagent, do not ask the user"; `fold-validation` means "no separate `/twt-brand-validate` dispatch is coming, so produce its report yourself." Every orchestrator passes `subagent-collect` on every dispatch — keying the fold off it made this skill write a full validation report that the standalone validator then re-ran and overwrote, every time.

**Without `fold-validation`, write no `validation-report.md` at all** — the validator owns it. With it, write `.twt-artifacts/pre-design/brand/validation-report.md` as if `/twt-brand-validate` had run. Do not replace it with a compact pass/fail, green/yellow/red, or checklist-only report. The rubric is reproduced in full below — per CONVENTIONS §14 the sibling validator's SKILL.md does **not** travel with this run, so never try to read it from disk.

The folded validation report MUST include all of these sections in this order:

1. `# Validation report — brand`
2. `## Scorecard` — a table `Criterion | Weight | Score (0-5) | Weighted | Evidence` over exactly these five fixed criteria, then a `Total` row, a `**Health:**` line, and the Band verdict (`Pass ≥80 / Revise 50-79 / Fail <50`):

   | Criterion | Weight | What "good" means |
   |---|---|---|
   | Palette contrast / WCAG AA on key pairings | 25 | Text/background and primary-on-surface pairings meet AA (4.5:1 body, 3:1 large/UI). Compute actual ratios from the hex values. |
   | Palette fit to context & audience | 20 | Hues/temperature/saturation suit the sector and audience implied by content + positioning. |
   | Voice distinctiveness & consistency | 20 | ≥3 concrete, non-generic voice attributes; examples are consistent with them. |
   | Positioning/message clarity | 20 | The brand statement says something specific and defensible, not vague. |
   | Completeness & internal coherence | 15 | No TBD/missing required fields; no internal contradictions. |

   After assigning all five scores, compute the weighted sums and health with the bundled scorer (Bash) — never do this arithmetic by hand:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Palette contrast / WCAG AA on key pairings","weight":25,"score":<s1>},{"criterion":"Palette fit to context & audience","weight":20,"score":<s2>},{"criterion":"Voice distinctiveness & consistency","weight":20,"score":<s3>},{"criterion":"Positioning/message clarity","weight":20,"score":<s4>},{"criterion":"Completeness & internal coherence","weight":15,"score":<s5>}]'
   ```

   Use `rows[i].weighted` for the **Weighted** column, `health` for the `Total` row and the `**Health:**` line, and `band` for the Band verdict.
3. `## Detailed brand component evaluation` with every available brand item evaluated item-by-item, including status, evaluation method, item health, metric values, pros, cons/risks, severity, and design handoff note. Every item block must include all eight metric rows: Clarity, Relevance, Distinctiveness, Consistency, Actionability, Evidence quality, Accessibility / usability, and Governance readiness. Score each non-`N/A` dimension 0–5 and report an **Item health** as the unweighted average of the scored dimensions; do not blend item scores into the top-level Health. Use `N/A — not applicable because <reason>` for a metric only when it truly does not apply; do not omit the metric row.
4. `## Brand-book completeness & source coverage` mapping the brief onto `references/brand-book-checklist.md`: a `**Tier coverage:** Core <n>% · Recommended <n>% · Optional <n>%` line, then a table `Part | Tier | In brief | Source coverage | Recommendation` with each part's presence (`Complete/Partial/Missing`) and source-coverage attribution (`silent`/`not-extracted`/`n/a`/`unknown`, drawn from `_coverage.md` when present). Compute each tier's coverage % as `(Complete + 0.5·Partial) / parts-in-tier · 100`, rounded. **Core** gaps become WARNING findings (BLOCKER only when a Core part is both Missing *and* downstream-blocking — e.g. no palette at all, so tokens cannot be derived); Recommended/Optional gaps are informational and never BLOCK. This section is additive — it does not change the Scorecard or the 8-dimension item evaluation. It is required — the checker asserts its heading and the `Tier coverage`/`Source coverage` needles.
5. `## Critical assessment` with direct senior-designer judgment on palette, typography, voice, coherence, and a one-line verdict
6. `## Before design proceeds` with proceed status, user-facing notice, design-safe defaults, and unresolved brand risks
7. `## Decisions to confirm`
8. `## Findings` using numbered findings with severity in the heading and `Where / Problem / Recommendation`
9. `## Summary`

For palette evaluation, compute actual WCAG contrast ratios from provided hex values whenever hex values exist. If a value is missing or only described, mark the metric as `Missing / not evaluable`; do not convert that absence into a Pass.

Return the decisions block in your report — plus the validation Band/Health when `fold-validation` ran. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill, the validator's rubric included.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

In collect mode, apply the same coverage-aware rule without prompting: fill Core parts from best practice grounded in loaded context (logging each under decisions/assumptions), and mark `Silent` Recommended/Optional parts `TBD`.

## Step 2 — Interview / refine
**(Skipped in collect mode — see Step 1b.)** Walk the canonical sections one at a time (Identity → Palette → Typography → Voice & Tone → Audience signals). Ask focused questions; pre-fill from fetched notes where available and confirm rather than re-ask. In refinement mode, only touch the sections the user chose.

**Coverage-aware filling.** Prioritize interviewing the **Core** parts that `_coverage.md` marked `Silent`/`Partial`. For **Recommended/Optional** parts that were `Silent`, mark them `TBD` in the brief rather than inventing content — the completeness report will surface them as informational gaps. Never fabricate a value to close a gap.

## Step 3 — Write the brief
Write/update `.twt-artifacts/pre-design/brand/brand-brief.md` with sections: `# Brand Brief`, `## Identity`, `## Palette` (table: name | hex | usage), `## Typography`, `## Voice & Tone` (attributes + do/don't), `## Audience signals`, `## Sources`. Mark unknowns `TBD` rather than guessing. Confirm before overwriting.

## Step 4 — Report
Sections written/changed, any remaining TBDs, and suggest `/twt-brand-validate` next.
