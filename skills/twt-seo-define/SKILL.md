---
name: twt-seo-define
category: seo
description: (v1.0.2) Build or refine seo-map.md — per-page keywords, slugs, meta drafts, schema — plus a redirect map on redesigns
version: 1.0.2
accepts_arguments: true
inputs:
  - Optional answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-ia-define
    - twt-positioning-define
    - twt-curation-define
    - twt-content-fetch
reads:
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/curation/facts.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/pre-design/content/fetched/site/
  - .twt-artifacts/pre-design/seo/seo-map.md
  - .twt-artifacts/pre-design/seo/validation-report.md
writes:
  - .twt-artifacts/pre-design/seo/seo-map.md
  - .twt-artifacts/pre-design/seo/decisions.md
---

# /twt-seo-define

## Intent

**Purpose:** Produce the canonical `seo-map.md` — for every sitemap page: primary/secondary keywords, slug, meta title and description drafts, schema.org type, canonical/OG notes — and, on redesigns (a fetched old-site sitemap exists), an old-URL → new-page redirect map.

**Non-goals:**
- Doesn't define the sitemap (reads `/twt-ia-define`'s output; aborts if it's missing)
- Doesn't claim live search-volume or ranking data — keyword choices are inferred from positioning value props and the project's real content, and are labelled as model-inferred
- Doesn't write page copy (curation/mockup own body content) and doesn't apply anything to a built site (`/twt-content-approval-implement` does, after human approval)
- Doesn't critique itself (that's `/twt-seo-validate`); never overwrites without consent

**Success criteria:**
- Every page in `sitemap.md` has a seo-map entry with all fields populated or marked TBD
- Meta title drafts are ≤60 characters and meta descriptions ≤155, each with its character count stated
- No two pages share a slug or a primary keyword
- When `content/fetched/site/<domain>/_sitemap.md` exists, every old URL appears in the `## Redirects` table (mapped to a new page or explicitly `gone` with a reason)
- Re-run enters refinement mode (rule 10) rather than starting over

---

## Step 1 — Detect mode (rule 10)
If `.twt-artifacts/pre-design/seo/seo-map.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them via the **AskUserQuestion** tool and ask which to address; only touch the chosen sections. Else → **from-scratch mode**.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `seo-map.md` from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/seo/decisions.md` (decisions.md format — frontmatter `generated`/`area`/`producer`/`status: open`; sections `## Open questions` (each bullet: question — `options: [a, b, c]` — `model-leaning: <choice>`, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (each bullet: field = value — `basis: <why>` — `reversible: yes|no`), `## Proposed rules (confirm before binding)` — the `options:`/`model-leaning:`/`basis:`/`reversible:` keys are literal, colons included; the checker below rejects bullets without them). Set `status: open`. After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes; three consumers (the orchestrator's surface-up flow, gen-report, wiki-harvest) parse this exact format, and a drifted section title is silently invisible to them. Then write the draft and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find formats or examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Load inputs (sitemap is required)
Read `.twt-artifacts/pre-design/ia/sitemap.md` — the page list is the spine of the map. If absent, **abort**: "No sitemap.md found — run /twt-ia-define first." Then read soft context if present, degrading gracefully when absent:
- `positioning/positioning.md` — value props and audience needs become keyword themes
- `curation/facts.md` + `curation/outlines/` — real facts and per-page content signal (never contradict the facts ledger; bind names, counts, and taglines to its canonical values)
- `content/fetched/site/<domain>/` — the language the client and their visitors actually use; `_sitemap.md` is the redesign signal for Step 5

## Step 3 — Keyword themes
Derive 3–7 keyword themes from positioning value props and the fetched content's recurring language. Each theme names its source (value prop or content evidence). These are model-inferred editorial choices, not search-volume research — record that framing once in the artifact header. In interactive mode, confirm the themes via the **AskUserQuestion** tool (multi-select of proposed themes) before binding pages to them; in collect mode, record the chosen theme set under `## Model-decided assumptions (review)` in `decisions.md` (a decision made, not a blocked question).

## Step 4 — Per-page entries
For every sitemap page (including detail/archive template pages the sitemap declares), write an entry:
- **Primary keyword** — exactly one per page, drawn from a theme; never reuse a primary across pages (cannibalization)
- **Secondary keywords** — 2–5 supporting phrases
- **Slug** — kebab-case (the root page keeps `/`), consistent with the sitemap's path hierarchy; flag any sitemap path that makes a poor slug as an open decision rather than silently diverging
- **Meta title draft** — ≤60 characters, leading with the primary keyword or the brand per the page's role; state the character count
- **Meta description draft** — ≤155 characters, one concrete value statement + call to action; state the character count
- **Schema.org type** — the most specific applicable type (e.g. `Organization`, `Service`, `Article`, `FAQPage`, `CollectionPage`)
- **Canonical / OG notes** — canonical self or parent, OG title/description deviations if any

Mark unknowns TBD instead of inventing facts (per the facts ledger rule).

## Step 5 — Redirect map (redesigns only)
If `content/fetched/site/<domain>/_sitemap.md` exists, map **every** old URL into the `## Redirects` table: `redirect` → the new sitemap page that absorbs it, or `gone` with a one-line reason (content intentionally dropped — cite the curation inventory's skip decision when one exists; with no inventory, justify from content signal and additionally record the drop as an open question in `decisions.md`). Ambiguous mappings become open questions in `decisions.md`, not guesses. If no fetched sitemap exists, write the section as: `No fetched old-site sitemap — no redirect map needed.`

## Step 6 — Write
Write/update `.twt-artifacts/pre-design/seo/seo-map.md` (confirm before overwrite — except in collect mode, where the dispatch itself is the consent: refine in place without asking and log the overwrite as a reviewable assumption in `decisions.md`):
```markdown
---
generated: <YYYY-MM-DD>
area: seo
producer: twt-seo-define
---

# SEO map

Keyword choices are model-inferred from positioning and project content — not search-volume research.

## Keyword themes
| Theme | Source (value prop / content evidence) | Pages |
|-------|----------------------------------------|-------|

## Pages
### <Page title> (`/<slug>`)
- **Primary keyword:** <one>
- **Secondary keywords:** <2–5>
- **Slug:** `/<slug>`
- **Meta title (≤60):** <draft> (<n> chars)
- **Meta description (≤155):** <draft> (<n> chars)
- **Schema.org type:** <type>
- **Canonical / OG notes:** <notes or —>

## Redirects
| Old URL | Action (redirect/gone) | Target | Why |
|---------|------------------------|--------|-----|
```

## Step 7 — Report
Pages covered, themes defined, redirect rows written (or why none), TBDs and open decisions, suggest `/twt-seo-validate`.
