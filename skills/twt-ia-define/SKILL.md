---
name: twt-ia-define
category: ia
description: (v1.0.2) Build or refine sitemap.md and functional-scope.md
version: 1.0.2
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
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `sitemap.md` and `functional-scope.md` from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/ia/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes; three consumers (the orchestrator's surface-up flow, gen-report, wiki-harvest) parse this exact format, and a drifted section title is silently invisible to them. Then write the drafts and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Gather soft context
**(Skipped in collect mode — see Step 1b.)** Read `positioning.md` (audience/value props drive which pages exist) and content-fetch outputs (what content already exists). Degrade to interview if absent.

## Step 3 — Define sitemap
Interview/refine the page hierarchy. For each page capture slug, title, parent, purpose, primary CTA. Write `sitemap.md` as a nested list.

## Step 4 — Define functional scope
Capture global features, per-page features (keyed by sitemap slug), integrations. Write `functional-scope.md`. Keep page slugs consistent with sitemap.md.

## Wiki capture — record what you decided and why
If `.project-wiki/` exists at the project root (use Glob/Read to check — never a shell command), append your reasoning to `.project-wiki/inbox.md` before you finish. The wiki's capture hook already records what the **user** chose; this records what **you** decided and, crucially, **why** — which nothing else in the pipeline preserves.

Append one entry per judgment that a human would need to re-make if it were lost:
- a decision you made autonomously (collect mode, or an unattended run)
- a factual `CONFLICT` you resolved, or refused to resolve
- a validator BLOCKER you overruled, and on what grounds
- an idea you raised but did not scope
- a free-form answer the user typed at a plain-text prompt (a direction, a constraint, pasted guidance) that shaped what you produced — the capture hook sees only AskUserQuestion menus, so this is the one place a typed answer gets recorded; put their words in **decision:** verbatim, not paraphrased

Append (never rewrite — `inbox.md` is append-only, and the curator drains it):

```
## <UTC timestamp, e.g. 2026-07-11T14:03:22Z — no milliseconds, matching the capture hook> · reason · <this skill's name>
- **decision:** <what you settled>
- **why:** <the reason — the evidence, the tradeoff, the constraint that forced it>
- **evidence:** <path, URL, or artifact this rests on>
- **reversible:** <yes|no>
```

Write nothing else in `.project-wiki/`. Curated pages have exactly one writer, and it is not you.

If `.project-wiki/` does not exist, skip this step silently — the wiki is opt-in.

## Step 5 — Report
Files written/changed, page count, TBDs, suggest `/twt-ia-validate`.
