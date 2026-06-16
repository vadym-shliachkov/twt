---
name: twt-ia-define
category: ia
description: Build or refine sitemap.md and functional-scope.md
version: 1.0.1
accepts_arguments: true
inputs:
  - Optional answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-positioning-define
    - twt-content-fetch
reads:
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/content-fetch/
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/ia/functional-scope.md
  - .twt-artifacts/pre-design/ia/validation-report.md
writes:
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/ia/functional-scope.md
  - .twt-artifacts/pre-design/ia/decisions.md
---

# /twt-ia-define

## Intent

**Purpose:** Produce the canonical site structure — `sitemap.md` (page hierarchy with purpose + CTA) and `functional-scope.md` (global/per-page features and integrations) — from scratch or refined.

**Non-goals:**
- Doesn't decide per-item content keep/skip (that's `/twt-curation-define`)
- Doesn't design pages or pick components
- Doesn't critique itself; never overwrites without consent

**Success criteria:**
- Both `sitemap.md` and `functional-scope.md` exist with all sections populated or TBD
- Every page has a stated purpose and primary CTA
- Re-run enters refinement mode for both files

---

## Step 1 — Detect mode (rule 10)
If either canonical file exists → refinement mode (read both + sibling validation-report.md; ask which findings to address). Else from-scratch.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `sitemap.md` and `functional-scope.md` from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/ia/decisions.md` (use `templates/decisions.md`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the drafts and return the decisions block in your report. Do not loop on the user.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Gather soft context
**(Skipped in collect mode — see Step 1b.)** Read `positioning.md` (audience/value props drive which pages exist) and content-fetch outputs (what content already exists). Degrade to interview if absent.

## Step 3 — Define sitemap
Interview/refine the page hierarchy. For each page capture slug, title, parent, purpose, primary CTA. Write `sitemap.md` as a nested list.

## Step 4 — Define functional scope
Capture global features, per-page features (keyed by sitemap slug), integrations. Write `functional-scope.md`. Keep page slugs consistent with sitemap.md.

## Step 5 — Report
Files written/changed, page count, TBDs, suggest `/twt-ia-validate`.
