---
name: twt-develop
category: develop
description: Phase 3 full path — promote the Phase-2 design into the chosen build target
version: 1.3.1
accepts_arguments: true
inputs:
  - Optional --target html|elementor (else menu); optional page scope
dependencies:
  hard: []
  soft:
    - twt-html-site-creator
    - twt-html-block-creator
    - twt-elementor-theme-creator
    - twt-elementor-block-creator
    - twt-content-approval-checklist
reads:
  - .twt-artifacts/design/design-brief.md
  - .twt-artifacts/design/mockup/index.html
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/component/components.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/assets/manifest.md
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
writes:
  - site/assets/css/sections.css            # html target — merged section-CSS deltas (Step 4c)
  - site/assets/css/general.css             # html target — merged deltas
  - <THEME>/assets/css/widgets.css          # elementor target — merged widget-CSS deltas
  - <THEME>/assets/css/design-system.css    # elementor target — merged token deltas
---

# /twt-develop

## Intent

**Purpose:** Drive Phase 3 from the Phase-2 handoff: pick a build target, ensure its scaffold exists, promote the design into production code using currently available content, and keep the content approval workbook running as a parallel confirmation track. It dispatches the builders; for multi-page promotion it runs one serial **foundation page** to seed the reuse pool, then promotes the rest as a **parallel batch**, and merges their shared-file deltas.

**Non-goals:**
- Doesn't do QA (Phase 4)
- Doesn't reproduce builder/scaffolder logic — dispatches each via the Agent tool (rule 5)
- Doesn't start from Figma — that's the express path, `/twt-roast-express`

**Success criteria:**
- Target chosen (HTML or Elementor); the target's scaffold is ensured (created if its `conventions.md` is missing)
- `.twt-artifacts/content-approval/content-approval-checklist.xlsx` is created or refreshed as a parallel approval artifact, without blocking Development and without applying approved rows automatically
- Each Phase-2 mockup page is promoted into the target via the matching builder, using the content currently available from Figma, content-fetch artifacts, layouts, mockups, and asset manifests
- A **foundation page** is promoted first (serial) to seed reuse; the remaining pages are promoted as a **single parallel batch**, then their shared-file deltas are merged and de-duplicated serially
- Approved workbook rows are **not** applied by this skill; after stakeholder confirmation, the user explicitly runs `/twt-content-approval-implement` to update the corresponding blocks/pages
- Reports what was built per page and anything to follow up before Phase 4

---

## Step 1 — Target

Parse `--target html|elementor` from `$ARGUMENTS`. If absent, ask via the **AskUserQuestion** tool (single-select, header "Target") What is the build target?:
- **Static HTML/CSS** — dependency-free static site
- **Elementor (WordPress)** — Hello Elementor child theme with widgets
- **You decide** — I pick the best-fit target from the project context (existing `conventions.md` or hints; defaults to Static HTML/CSS)

Record the choice as `<target>` and continue.

## Step 2 — Read the Phase-2 design

Read `.twt-artifacts/design/design-brief.md`, `.twt-artifacts/design/mockup/index.html` + `mockup/pages/*.html`, `layout/layouts/*.md`, `component/components.md`, the design-system spine `design-system/tokens.css`, and the asset manifest `.twt-artifacts/design/assets/manifest.md` (planned images/videos with exact filenames + alt).

If `design-brief.md` is absent, stop and tell the user: "No Phase-2 design found. Run /twt-design first, or use /twt-roast-express to start from a Figma link."

## Step 2a — Run content approval in parallel

Dispatch `/twt-content-approval-checklist` via the Agent tool with `subagent-collect`, passing the page list, layouts, mockups, design-system artifacts, content-fetch artifacts if present, and asset manifest as context. This creates or refreshes the stakeholder workbook in parallel with development so missing copy/media/SEO can be confirmed later.

If the workbook already exists, instruct the child to preserve approved content and ready flags, and append/fill only newly discovered scope. Do not treat the workbook as an implementation input during this skill. Development proceeds with the content currently available in Figma/content fetch/design artifacts; later, after approval is complete, the user calls `/twt-content-approval-implement` explicitly to update corresponding blocks with approved content.

## Step 3 — Ensure scaffold

- `<target>` = **elementor**: if `.twt-artifacts/elementor-theme/conventions.md` is missing, dispatch `/twt-elementor-theme-creator` (Agent tool). If present, continue.
- `<target>` = **html**: if `.twt-artifacts/html-site/conventions.md` is missing, dispatch `/twt-html-site-creator` (Agent tool). If present, continue.

## Step 4 — Promote pages (foundation pass, then parallel batch)

Pages are independent **except** for the shared files each builder appends to — HTML: `sections.css` / `general.css`, the inlined `partials/`, the `tokens.css` mirror; Elementor: `widgets.css` / `design-system.css`, the `$map` registry in `class-<slug>-elementor.php`, `wpml-config.xml`. Promoting every page fully in parallel would both **race** on those shared files and **defeat reuse-first** (each agent, starting from the same baseline, re-creates the same hero/CTA). So promote in three phases.

Take the page list from `mockup/pages/` (respect any page scope from `$ARGUMENTS`). The **home/index** page — or the first page if there is no home — is the **foundation page**. The matching builder is:
- `<target>` = **html** → `/twt-html-block-creator`
- `<target>` = **elementor** → `/twt-elementor-block-creator`

### Step 4a — Foundation pass (serial)
Dispatch the builder for the **foundation page only**, normally (Agent tool, passing its mockup HTML + `layouts/<page>.md`). It writes its page file *and* the shared files, priming the reuse pool: the common sections/widgets, chrome, and shared CSS now exist for every other page to reuse. If there is only one page, you're done — skip to Step 5.

### Step 4b — Parallel batch (remaining pages)
Dispatch **all** remaining pages in a **single batch of parallel Agent calls** (one message, multiple Agent tool uses), each passing the page's mockup HTML + `layouts/<page>.md`. Pass the asset manifest to each builder: media must use the **exact `filename` and `alt` from the manifest** (place real files under the build's `assets/img|video/`); where an asset file isn't present yet, emit the correct `<img src>`/path with the manifest's alt and leave the file to be supplied — never invent a different filename. In every agent's prompt, include the **parallel-promotion contract**:

> Parallel mode — return deltas, don't write shared files. Reuse-first against the shared files the foundation pass already wrote. Write **only** your own disjoint page file (`site/<page>.html`, or `import/<page-slug>/import.json` + its `assets/`). Do **not** write or append to any shared file (`sections.css`, `general.css`, `widgets.css`, `design-system.css`, the `$map` registry, `wpml-config.xml`, or `partials/`). Instead **return in your report** any new shared-file deltas as text — new section-/widget-CSS blocks, new tokens, new `$map`/WPML entries, and any partial change — only for sections that genuinely aren't already in the reuse pool.

Each page file is disjoint, so there is no write conflict. Wait for the whole batch to finish.

### Step 4c — Merge deltas (serial)
Apply the returned deltas to the shared files yourself, one at a time, **de-duplicating**: if two pages returned the same new section (same purpose/selector), add it once and point both pages at it. Then, if any page needed a partial change, re-inline the partial into every page; re-mirror `tokens.css` if a token was added. Finally run the builder's own inline build checks across all pages (every page links the CSS / registers its widgets; no literals; links resolve; chrome identical; no lorem where real content exists).

## Step 5 — Report

State: target, pages promoted, whether a scaffold was created, reuse decisions surfaced from the builders, whether the content approval workbook was created/refreshed, and any outstanding items to resolve before Phase 4 (QA). Explicitly say that approved workbook content is not auto-applied by Development; after stakeholder approval, run `/twt-content-approval-implement` to update the corresponding blocks/pages.
