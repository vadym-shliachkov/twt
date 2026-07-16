---
name: twt-ia-define
category: ia
description: (v1.1.1) Build or refine sitemap.md and functional-scope.md
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-positioning-define
    - twt-audience-define
    - twt-content-fetch
reads:
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/audience/personas.md
  - .twt-artifacts/pre-design/content/fetched/
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
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `sitemap.md` and `functional-scope.md` from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/ia/decisions.md` (decisions.md format — frontmatter `generated`/`area`/`producer`/`status: open`; sections `## Open questions` (question — options [a,b,c] — model-leaning, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (field = value — basis — reversible), `## Proposed rules (confirm before binding)`). Set `status: open`. After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes; three consumers (the orchestrator's surface-up flow, gen-report, wiki-harvest) parse this exact format, and a drifted section title is silently invisible to them. Then write the drafts and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Gather soft context
**(Skipped in collect mode — see Step 1b.)** Read `positioning.md` (audience/value props drive which pages exist), `audience/personas.md` if present (persona journeys drive page priority, nav order, and which conversion pages must exist), and content-fetch outputs (what content already exists). Degrade to interview if absent.

## Step 3 — Define sitemap
Interview/refine the page hierarchy. For each page capture slug, title, parent, purpose, primary CTA. When `personas.md` exists: order the nav by what the primary personas' journeys reach first, make sure every journey's conversion action has a page whose primary CTA serves it, and note on each page entry which persona journey stage(s) it serves (e.g. `serves: <persona> — proof`) — never edit personas.md itself (its unbound `Page` cells stay as written; this mapping lives in sitemap.md). Record persona-driven structure choices in `decisions.md`. Write `sitemap.md` as a nested list.

## Step 4 — Define functional scope
Capture global features, per-page features (keyed by sitemap slug), integrations. Write `functional-scope.md`. Keep page slugs consistent with sitemap.md.

## Step 5 — Report
Files written/changed, page count, TBDs, suggest `/twt-ia-validate`.
