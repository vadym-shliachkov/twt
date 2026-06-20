---
name: twt-curation-define
category: curation
description: Decide keep/skip/elevate per content item; produce inventory.md and per-page outlines
version: 1.0.2
accepts_arguments: true
inputs:
  - Optional answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-content-fetch
    - twt-brand-define
    - twt-ia-define
reads:
  - .twt-artifacts/pre-design/content-fetch/
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/validation-report.md
writes:
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/outlines/<page-slug>.md
  - .twt-artifacts/pre-design/curation/decisions.md
---

# /twt-curation-define

## Intent

**Purpose:** Turn raw fetched content into a curated plan: a flat `inventory.md` of keep/skip/elevate decisions mapped to pages, plus one `outlines/<page-slug>.md` per page showing what content fills each section.

**Non-goals:**
- Doesn't fetch content (reads content-fetch outputs)
- Doesn't define the sitemap (reads it from IA)
- Doesn't critique itself; never overwrites without consent

**Success criteria:**
- `inventory.md` lists every fetched item with a KEEP/SKIP/ELEVATE decision and a target page (or none)
- One `outlines/<page-slug>.md` exists for each page in `sitemap.md`
- Every outline section carries drafted, on-brand transformed copy (or a `> GAP` marker) — never a raw source excerpt
- Outlines contain final-intent **transformed copy**, not source excerpts; verbatim-mirrored copy is a curation defect (see `twt-curation-validate`'s 'Copy transformed not mirrored' criterion)
- Re-run enters refinement mode

---

## Step 1 — Detect mode (rule 10)
If `inventory.md` exists → refinement mode (read it + outlines + sibling validation-report.md; ask which findings/pages to revisit). Else from-scratch.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Make the keep/skip/elevate decisions autonomously from the loaded context using best practice, and for every judgment you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/curation/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then build the inventory + outlines and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill. (The Step 4 parallel outline batch runs unchanged.)

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Gather context
Read content-fetch outputs (the items to curate), `sitemap.md` (the target pages — REQUIRED for outline generation; if absent, warn and produce inventory only), and `brand-brief.md` (voice, to judge ELEVATE/SKIP). Degrade gracefully when soft deps are missing.

## Step 3 — Build the inventory
**(Skipped in collect mode — see Step 1b.)** Enumerate every fetched content item. For each, decide KEEP / SKIP / ELEVATE with the user and assign a target page slug from the sitemap (or none). Write `inventory.md` as the flat decision table with rationale.

## Step 4 — Build per-page outlines (in parallel)
The inventory from Step 3 is now complete and written; each page's outline depends only on it plus read-only inputs, and each writes its own `outlines/<page-slug>.md`. So the pages are independent — **dispatch one Agent per page slug in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Give each agent a self-contained prompt instructing it to:
- Read `inventory.md` (the now-complete decision table), `sitemap.md` (its page's entry), and `brand-brief.md` (voice).
- Write `outlines/<page-slug>.md`: ordered sections, each carrying **drafted, on-brand copy** — restructured and **rewritten in the brand voice** (from `brand-brief.md`), fitted to this page's purpose in the new IA. Pull facts from the KEEP/ELEVATE items mapped to the page, but **rewrite the wording** (headlines, subheads, body, CTAs) — do NOT paste source copy verbatim. **Never invent** facts, claims, numbers, names, or testimonials not present in the source; where the page needs content the source lacks, mark the section `> GAP` (do not fabricate). Keep the slug identical to `sitemap.md`.
- Write **only** its own `outlines/<page-slug>.md` — touch no shared file (the inventory is already final).

Wait for all the page agents to finish before reporting.

## Step 5 — Report
Inventory counts (kept/skipped/elevated), outline files written (one per page), gaps flagged, suggest `/twt-curation-validate`.
