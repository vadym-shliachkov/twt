---
name: twt-curation-define
category: curation
description: (v1.1.2) Decide keep/skip/elevate per content item; reconcile reusable facts into facts.md; produce inventory.md and per-page outlines
version: 1.1.2
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
  - .twt-artifacts/pre-design/content/fetched/
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/_fetched-brand.md
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/facts.md
  - .twt-artifacts/pre-design/curation/validation-report.md
writes:
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/facts.md
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
- `facts.md` exists and reconciles every reusable fact across all sources: agreeing sources → RESOLVED, disagreeing sources → CONFLICT (canonical TBD, never a silent pick), generic-example-pinned-to-named-client → UNVERIFIED-ATTR, absent → TBD; plus a provided-assets table. Outlines never emit a reusable-fact value that contradicts `facts.md`
- Re-run enters refinement mode

---

## Step 1 — Detect mode (rule 10)
If `inventory.md` exists → refinement mode (read it + outlines + sibling validation-report.md; ask which findings/pages to revisit). Else from-scratch.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Make the keep/skip/elevate decisions autonomously from the loaded context using best practice, and for every judgment you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/curation/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. **Every `facts.md` CONFLICT (Step 3.5) is such an open question** — record the conflicting values (each `value@source`) and a clearly-marked provisional leaning, but leave the ledger's `canonical: TBD`; never silently pick a value that sources disagree on. Then build the inventory, the facts ledger (Step 3.5), and the outlines, and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill. (The Step 4 parallel outline batch runs unchanged.)

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Gather context
Read content-fetch outputs (the items to curate), `sitemap.md` (the target pages — REQUIRED for outline generation; if absent, warn and produce inventory only), and `brand-brief.md` (voice, to judge ELEVATE/SKIP). Degrade gracefully when soft deps are missing.

## Step 3 — Build the inventory
**(Skipped in collect mode — see Step 1b.)** Enumerate every fetched content item. For each, decide KEEP / SKIP / ELEVATE with the user and assign a target page slug from the sitemap (or none). Write `inventory.md` as the flat decision table with rationale.

## Step 3.5 — Reconcile reusable facts (facts.md — the source of truth)
Build `.twt-artifacts/pre-design/curation/facts.md`, the reconciled ledger every downstream skill binds to. This runs after the inventory and **before** the outlines, so the outline agents can cite it. It runs in every mode (collect and interactive).

Scan **every** source — `brand-brief.md` / `_fetched-brand.md` and the fetched site/doc content — for **reusable facts**: any value that appears on more than one page or headlines a claim (firm tenure, founding year, headcount, vertical/industry count, client/engagement count, the self-descriptor noun, taglines, and every per-client metric together with its named attribution). For each, compare what each source says and assign a status:
- **RESOLVED** — one source, or sources agree, or a stated reconciliation rule applies. `canonical` is the exact string authors must reuse.
- **CONFLICT** — sources disagree (e.g. brand book "20+ years" vs. site "25+ years"). Set `canonical: TBD` and **never pick silently**: collect mode records it as a `decisions.md` open question (Step 1b); interactive mode asks the user.
- **UNVERIFIED-ATTR** — a generic/unnamed source example is being pinned to a **named** client (e.g. a brand-book "$800K saved" example attached to a specific client the book never names there). It may only headline once re-sourced; otherwise it renders with a visible TBD flag.
- **TBD** — needed but absent from every source. Renders as a visible TBD placeholder, never a guessed value.

Also build the **provided-assets** table from brand-fetch's `## Provided assets` records in `_fetched-brand.md` (or a direct scan of the brand-source dir if brand-fetch didn't run): one row per real logo/mark file (role · file · surface · `provided`), plus a row per standard variant with no file (`missing`).

Write `facts.md` in **exactly** this format (this skill carries the schema inline — never load it from an external template file):

```markdown
---
generated: <ISO timestamp>
area: curation
producer: twt-curation-define
status: open | resolved
---

# Facts ledger

## Canonical facts
| fact | canonical | status | sources (value@source) |
|------|-----------|--------|------------------------|
| firm-tenure | TBD | CONFLICT | 20+ years@brandbook · 25+ years@site |
| self-descriptor-noun | firm | RESOLVED | firm@brandbook (agency forbidden) |
| driven-brands-savings | $800K annual | UNVERIFIED-ATTR | $800K@brandbook(generic) · Driven Brands@site(no figure) |

## Provided assets
| role | file | usable-on | status |
|------|------|-----------|--------|
| reversed-white | assets/xivic-logo-white.png | Ink surfaces (footer, drawer, dark hero) | provided |
| primary-ink | — | light surfaces (header) | missing |
```

Set frontmatter `status: open` while any fact is CONFLICT / UNVERIFIED-ATTR / TBD (or a named asset role is `missing` with no accepted fallback); `resolved` only when every fact is RESOLVED. In refinement mode, apply the user's resolved answers — flip each CONFLICT to RESOLVED with the chosen canonical — and re-set the frontmatter status.

## Step 4 — Build per-page outlines (in parallel)
The inventory from Step 3 is now complete and written; each page's outline depends only on it plus read-only inputs, and each writes its own `outlines/<page-slug>.md`. So the pages are independent — **dispatch one Agent per page slug in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Give each agent a self-contained prompt instructing it to:
- Read `inventory.md` (the now-complete decision table), `sitemap.md` (its page's entry), `brand-brief.md` (voice), and `facts.md` (the reconciled reusable facts + provided assets).
- Write `outlines/<page-slug>.md`: ordered sections, each carrying **drafted, on-brand copy** — restructured and **rewritten in the brand voice** (from `brand-brief.md`), fitted to this page's purpose in the new IA. Pull facts from the KEEP/ELEVATE items mapped to the page, but **rewrite the wording** (headlines, subheads, body, CTAs) — do NOT paste source copy verbatim. **Never invent** facts, claims, numbers, names, or testimonials not present in the source; where the page needs content the source lacks, mark the section `> GAP` (do not fabricate). **Bind every reusable fact to `facts.md`:** use the exact `canonical` string for tenure, counts, the self-descriptor noun, per-client metrics, etc., and never emit a value that contradicts the ledger. A fact whose status is CONFLICT / TBD / UNVERIFIED-ATTR renders as `> GAP` or a visible TBD, never a guessed number. Keep the slug identical to `sitemap.md`.
- Write **only** its own `outlines/<page-slug>.md` — touch no shared file (the inventory is already final).

Wait for all the page agents to finish before reporting.

## Wiki capture — record what you decided and why
If `.project-wiki/` exists at the project root (use Glob/Read to check — never a shell command), append your reasoning to `.project-wiki/inbox.md` before you finish. The wiki's capture hook already records what the **user** chose; this records what **you** decided and, crucially, **why** — which nothing else in the pipeline preserves.

Append one entry per judgment that a human would need to re-make if it were lost:
- a decision you made autonomously (collect mode, or an unattended run)
- a factual `CONFLICT` you resolved, or refused to resolve
- a validator BLOCKER you overruled, and on what grounds
- an idea you raised but did not scope

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
Inventory counts (kept/skipped/elevated), outline files written (one per page), gaps flagged, and the **facts ledger summary** (facts reconciled, and how many are RESOLVED vs. CONFLICT / UNVERIFIED-ATTR / TBD, plus provided vs. missing asset roles). Suggest `/twt-curation-validate`.
