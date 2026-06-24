---
name: twt-html-block-creator
category: html
description: (v1.1.2) Build static HTML pages/sections with inlined partials, reuse-first, token-only CSS
version: 1.1.2
accepts_arguments: true
inputs:
  - page or section description; optional Figma URL; optional Phase-2 mockup/layout; screenshots/notes
dependencies:
  hard:
    - twt-html-site-creator
  soft:
    - twt-design-system-define
    - figma-mcp
reads:
  - .twt-artifacts/html-site/conventions.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/component/components.md
  - site/partials/
  - site/assets/css/
writes:
  - site/<page-slug>.html
  - site/assets/css/sections.css
  - site/assets/css/general.css
  - site/assets/js/<section-slug>.js
  - site/assets/img/
---

# /twt-html-block-creator

## Intent

**Purpose:** Build a static HTML page or a single section into the scaffolded `site/`, inlining the shared partials, reusing existing sections first, and styling with token-only CSS. Promotes a Phase-2 mockup when one is provided, or builds from Figma/screenshots/notes.

**Non-goals:**
- Doesn't scaffold the site (requires `/twt-html-site-creator` to have run first)
- Doesn't add a build step or runtime include mechanism — partials are inlined at build time
- Doesn't author or revalue tokens — references the mirrored `tokens.css`; adds a missing token via `/twt-design-system-define`, never a literal
- Doesn't use lorem/placeholder where real content exists

**Success criteria:**
- Page written to `site/<page-slug>.html`, linking `assets/css/{tokens,general,sections}.css`, with header/footer inlined between `BEGIN/END partials/...` markers
- New section CSS appended to `sections.css` as a delimited, scoped, token-only block with the responsive tiers
- On a partial change, every existing page re-inlined so chrome never drifts
- Reuse decision (reuse / extend / create) stated in the report

---

Arguments passed to this command: $ARGUMENTS

If `$ARGUMENTS` describes what to build, use it as the starting context and skip or pre-fill questions where possible.

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Verify setup

Check `.twt-artifacts/html-site/conventions.md` exists.

**If missing**, print and stop:
```
⚠ No static-site conventions found.
Run /twt-html-site-creator first, then return here.
```
(Exception: when dispatched by `/twt-site-dev`, the scaffold is created upstream — the file will exist.)

## Step 2 — Load conventions

Read `.twt-artifacts/html-site/conventions.md` in full. Hold for the session: `<slug>`, `<ProjectName>`, output `<ROOT>`, the partials-inlining marker mechanism, scoping rule (`.<slug>-page`), token-only rule, responsive tiers (960/720/600/480).

## Step 3 — Design source

Determine the design source in this priority order (use whichever is provided):
1. **Phase-2 mockup** — if `.twt-artifacts/design/mockup/pages/<page>.html` and/or `.twt-artifacts/design/layout/layouts/<page>.md` exist for the requested page, use them as the authoritative layout/content source (this is the full-path "promote" case).
2. **Figma** — if a Figma URL is provided and Figma MCP tools (`mcp__plugin_figma_figma__*`) are available, load the `figma:figma-use` skill and read the design via `get_design_context`/`get_screenshot`. Figma overrides other references for visual decisions.
3. **Screenshots / notes** — load local files with Read, URLs with WebFetch.

State which source is driving the build.

## Step 4 — Tokens sync

Ensure `<ROOT>/assets/css/tokens.css` matches the design-system spine `.twt-artifacts/design/design-system/tokens.css` (re-copy if the spine is newer). If the section being built needs a token not present in `tokens.css`, dispatch `/twt-design-system-define` (Agent tool, soft) to add it to the spine, then re-mirror. **Never inline a hex/px/font literal** — every foundation value is `var(--...)`.

## Step 5 — Reuse analysis

Before writing new markup/CSS, inspect what already exists: list `<ROOT>/*.html`, read existing sections in `sections.css`, and read `partials/`. Apply the priority order and state the decision:
1. **Reuse** — an existing section already does the job.
2. **Extend** — an existing section is close; add to it without breaking current uses.
3. **Create new** — nothing fits.

Print: `Strategy: [Reusing <section> / Extending <section> / Creating new: <section-slug>]`

## Step 6 — Build

### Building a page
Write `<ROOT>/<page-slug>.html`:
- Start from the `index.html` template shape: `<head>` links `assets/css/tokens.css`, `general.css`, `sections.css`; `<body class="<slug>-page">`.
- **Inline the chrome**: copy the current `partials/header.html` (which already has `nav.html` inlined) between `<!-- BEGIN partials/header.html -->` / `<!-- END partials/header.html -->`, and `partials/footer.html` between its markers. Never hand-edit chrome inside the page.
- Compose `<main>` sections in the layout's order, using the documented components, populated with **real content** from the mockup/outline/inventory or the Figma design. No lorem where real content exists.
- **Use transformed copy, never raw source.** Populate sections from the curation outline's drafted on-brand copy (`.twt-artifacts/pre-design/curation/outlines/<page>.md`). Do NOT paste fetched source copy verbatim — if an outline section is missing, write brand-voice copy from the available facts (no invention) or mark it a gap; never mirror the original site's wording.
- **Assets from the manifest.** For images/videos, use the exact `filename` and `alt` from `.twt-artifacts/design/assets/manifest.md`; emit the correct `<img src>`/path (under `assets/img|video/`) even when the file isn't supplied yet — never invent a different filename.
- Ensure desktop/tablet/mobile all render (responsive CSS in `sections.css` / `general.css`).
- Basic a11y: `alt` on images, sensible heading order, landmark elements.

### Building a section
Append a delimited, scoped, token-only block to `<ROOT>/assets/css/sections.css`:
```css
/* ─── Section: <section-slug> ─────────────────────────────── */
.<slug>-page .<section-slug> {
  padding-top:    var(--space-8, 64px);
  padding-bottom: var(--space-8, 64px);
  /* component styles using tokens only */
}
@media (max-width: 960px) { .<slug>-page .<section-slug> { padding-top: var(--space-6, 36px); padding-bottom: var(--space-6, 36px); } }
@media (max-width: 720px) { .<slug>-page .<section-slug> { padding-top: var(--space-5, 24px); padding-bottom: var(--space-5, 24px); } }
```
Add the section markup to the target page(s).

### Partial change
If `header.html`, `footer.html`, or `nav.html` changed, **re-inline** into every existing page: for each `<ROOT>/*.html`, replace the content between the partial's `BEGIN/END` markers with the current partial. Count the pages updated.

## Step 6b — Parallel-promotion mode

When an orchestrator (e.g. `/twt-develop`) dispatches you as one of a **parallel batch** of pages and its prompt says *"parallel mode — return deltas, don't write shared files"*, change two things:

- **Write only your own page file** `<ROOT>/<page-slug>.html`. You still read `partials/` and inline the current chrome into your page, and still link `tokens.css`/`general.css`/`sections.css` — those are read-only on the shared side. But do **not** append to `sections.css`/`general.css`, re-inline `partials/` across other pages, or re-mirror `tokens.css`; those writes would race with sibling agents.
- **Return shared-file deltas in your report instead:** each new section's delimited, scoped, token-only CSS block (Step 6 "Building a section" format); any token missing from the spine; any partial change. Reuse-first still applies — reuse the sections the foundation pass already wrote and only return a delta for a genuinely new section.

The orchestrator merges and de-duplicates the deltas, then runs the Step 7 checks across all pages. In this mode skip the shared-file items of Step 7 yourself (your page file is still fully linked and its chrome inlined from the current partials).

## Step 7 — Inline build checks

Before reporting, confirm:
- Every page links `tokens.css`, `general.css`, `sections.css`.
- No hex/px/font literals in any CSS this run wrote (foundation values are `var(--...)`).
- All internal links (`href`) resolve to a file in `<ROOT>`.
- Chrome in every page matches `partials/` (markers present, content identical).
- No lorem/placeholder where real content exists.

If any check fails, fix it before reporting.

## Step 8 — Report

State: pages/sections written (paths), the reuse decision, any tokens added to the spine, how many pages were re-inlined, and what to run next (`/twt-html-block-creator` for the next page, or `/twt-develop` to continue the full pipeline).
