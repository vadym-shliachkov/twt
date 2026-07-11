---
name: twt-brand-define
category: brand
description: (v1.1.3) Build or refine the canonical brand-brief.md through guided dialogue
version: 1.1.3
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
  - skills/twt-brand-validate/SKILL.md
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
- In `subagent-collect` mode, writes the full sibling `validation-report.md` using the `/twt-brand-validate` report skeleton, not a compact pass/fail summary

---

## Step 1 — Detect mode (idempotency, CONVENTIONS rule 10)
If `brand-brief.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them and ask which to address. If it does not exist → **from-scratch mode**: read `_fetched-brand.md` if present to seed answers.

Also read `.twt-artifacts/pre-design/brand/_coverage.md` if present: it tells you which brand-book parts the fetch found, which were `Silent`, and which were `Not-extracted`. Use it to steer the interview toward thin **Core** parts and to decide what to mark `TBD` (see Step 2/Step 3).

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the brand-brief from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/brand/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`.

Then write the draft brand-brief and perform the **folded validation exception** required by the orchestrator: write `.twt-artifacts/pre-design/brand/validation-report.md` as if `/twt-brand-validate` had run, using the full validation skeleton and rubric from `skills/twt-brand-validate/SKILL.md`. Do not replace it with a compact pass/fail, green/yellow/red, or checklist-only report.

The folded validation report MUST include all of these sections in this order:

1. `# Validation report — brand`
2. `## Scorecard` with the five fixed weighted criteria from `/twt-brand-validate`: weights summing to 100, `Score (0-5)`, `Weighted`, evidence, numeric `Health 0-100`, and Band `Pass ≥80 / Revise 50-79 / Fail <50`
3. `## Detailed brand component evaluation` with every available brand item evaluated item-by-item, including status, evaluation method, item health, metric values, pros, cons/risks, severity, and design handoff note. Every item block must include all eight metric rows from `/twt-brand-validate`: Clarity, Relevance, Distinctiveness, Consistency, Actionability, Evidence quality, Accessibility / usability, and Governance readiness. Use `N/A — not applicable because <reason>` for a metric only when it truly does not apply; do not omit the metric row.
4. `## Brand-book completeness & source coverage` mapping the brief onto `references/brand-book-checklist.md`: a `**Tier coverage:** Core <n>% · Recommended <n>% · Optional <n>%` line, then a table `Part | Tier | In brief | Source coverage | Recommendation` with each part's presence (`Complete/Partial/Missing`) and source-coverage attribution (`silent`/`not-extracted`/`n/a`/`unknown`, drawn from `_coverage.md` when present), per `/twt-brand-validate` Step 2a′. This section is required — the checker asserts its heading and the `Tier coverage`/`Source coverage` needles.
5. `## Critical assessment` with direct senior-designer judgment on palette, typography, voice, coherence, and a one-line verdict
6. `## Before design proceeds` with proceed status, user-facing notice, design-safe defaults, and unresolved brand risks
7. `## Decisions to confirm`
8. `## Findings` using numbered findings with severity in the heading and `Where / Problem / Recommendation`
9. `## Summary`

For palette evaluation, compute actual WCAG contrast ratios from provided hex values whenever hex values exist. If a value is missing or only described, mark the metric as `Missing / not evaluable`; do not convert that absence into a Pass.

Return the decisions block and the validation Band/Health in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill and the sibling validator rubric.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

In collect mode, apply the same coverage-aware rule without prompting: fill Core parts from best practice grounded in loaded context (logging each under decisions/assumptions), and mark `Silent` Recommended/Optional parts `TBD`.

## Step 2 — Interview / refine
**(Skipped in collect mode — see Step 1b.)** Walk the canonical sections one at a time (Identity → Palette → Typography → Voice & Tone → Audience signals). Ask focused questions; pre-fill from fetched notes where available and confirm rather than re-ask. In refinement mode, only touch the sections the user chose.

**Coverage-aware filling.** Prioritize interviewing the **Core** parts that `_coverage.md` marked `Silent`/`Partial`. For **Recommended/Optional** parts that were `Silent`, mark them `TBD` in the brief rather than inventing content — the completeness report will surface them as informational gaps. Never fabricate a value to close a gap.

## Step 3 — Write the brief
Write/update `.twt-artifacts/pre-design/brand/brand-brief.md` with sections: `# Brand Brief`, `## Identity`, `## Palette` (table: name | hex | usage), `## Typography`, `## Voice & Tone` (attributes + do/don't), `## Audience signals`, `## Sources`. Mark unknowns `TBD` rather than guessing. Confirm before overwriting.

## Wiki capture — record what you decided and why
If `.project-wiki/` exists at the project root (use Glob/Read to check — never a shell command), append your reasoning to `.project-wiki/inbox.md` before you finish. The wiki's capture hook already records what the **user** chose; this records what **you** decided and, crucially, **why** — which nothing else in the pipeline preserves.

Append one entry per judgment that a human would need to re-make if it were lost:
- a decision you made autonomously (collect mode, or an unattended run)
- a factual `CONFLICT` you resolved, or refused to resolve
- a validator BLOCKER you overruled, and on what grounds
- an idea you raised but did not scope

Append (never rewrite — `inbox.md` is append-only, and the curator drains it):

```
## <ISO-8601 UTC timestamp> · reason · <this skill's name>
- **decision:** <what you settled>
- **why:** <the reason — the evidence, the tradeoff, the constraint that forced it>
- **evidence:** <path, URL, or artifact this rests on>
- **reversible:** <yes|no>
```

Write nothing else in `.project-wiki/`. Curated pages have exactly one writer, and it is not you.

If `.project-wiki/` does not exist, skip this step silently — the wiki is opt-in.

## Step 4 — Report
Sections written/changed, any remaining TBDs, and suggest `/twt-brand-validate` next.
