---
name: twt-develop
category: develop
description: (v1.3.6) Phase 3 full path — promote the Phase-2 design into the chosen build target
version: 1.3.6
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
  - .twt-artifacts/design/mockup/*.html
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/layout/*.md
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

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by `/twt-site` or another orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch in the steps below** — twt sub-skills **and** any external skill you load (figma, design-taste-frontend, emil-design-eng, superpowers, …) — run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Drive Phase 3 from the Phase-2 handoff: pick a build target, ensure its scaffold exists, promote the design into production code using currently available content, and keep the content approval workbook running as a parallel confirmation track. It dispatches the builders; for multi-page promotion it runs one serial **foundation page** to seed the reuse pool, then promotes the rest as a **parallel batch**, and merges their shared-file deltas.

**Non-goals:**
- Doesn't do QA (Phase 4)
- Doesn't reproduce builder/scaffolder logic — dispatches each via the Agent tool (rule 5)
- Doesn't start from Figma — that's the express path, `/twt-site-dev`

**Success criteria:**
- Target chosen (HTML or Elementor); the target's scaffold is ensured (created if its `conventions.md` is missing)
- `.twt-artifacts/content-approval/content-approval-checklist.xlsx` is created or refreshed as a parallel approval artifact, without blocking Development and without applying approved rows automatically
- Each Phase-2 mockup page is promoted into the target via the matching builder, using the content currently available from Figma, content-fetch artifacts, layouts, mockups, and asset manifests
- A **foundation page** is promoted first (serial) to seed reuse; it doubles as a **pilot** that the user reviews at a gate before the remaining pages are built — so a wrong direction is caught after 1 page, not after all of them
- After the pilot is approved, the remaining pages are promoted as a **single parallel batch**, then their shared-file deltas are merged and de-duplicated serially
- Approved workbook rows are **not** applied by this skill; after stakeholder confirmation, the user explicitly runs `/twt-content-approval-implement` to update the corresponding blocks/pages
- Reports what was built per page and anything to follow up before Phase 4

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Target

Parse `--target html|elementor` from `$ARGUMENTS`. If absent, ask via the **AskUserQuestion** tool (single-select, header "Target") What is the build target?:
- **Static HTML/CSS** — dependency-free static site
- **Elementor (WordPress)** — Hello Elementor child theme with widgets
- **You decide** — I pick the best-fit target from the project context (existing `conventions.md` or hints; defaults to Static HTML/CSS)

Record the choice as `<target>` and continue.

## Step 2 — Read the Phase-2 design

Read `.twt-artifacts/design/design-brief.md`, `.twt-artifacts/design/mockup/index.html` + page mockups from `mockup/pages/*.html` or the legacy/current fallback `mockup/*.html`, layouts from `layout/layouts/*.md` or `layout/*.md`, `component/components.md`, the design-system spine `design-system/tokens.css`, and the asset manifest `.twt-artifacts/design/assets/manifest.md` (planned images/videos with exact filenames + alt).

If `design-brief.md` is absent, stop and tell the user: "No Phase-2 design found. Run /twt-design first, or use /twt-site-dev to start from a Figma link."

## Step 2a — Run content approval in parallel

Dispatch `/twt-content-approval-checklist` via the Agent tool with `subagent-collect`, passing the page list, layouts, mockups, design-system artifacts, content-fetch artifacts if present, and asset manifest as context. This creates or refreshes the stakeholder workbook in parallel with development so missing copy/media/SEO can be confirmed later.

If the workbook already exists, instruct the child to preserve approved content and ready flags, and append/fill only newly discovered scope. Do not treat the workbook as an implementation input during this skill. Development proceeds with the content currently available in Figma/content fetch/design artifacts; later, after approval is complete, the user calls `/twt-content-approval-implement` explicitly to update corresponding blocks with approved content.

After the child returns, verify `.twt-artifacts/content-approval/content-approval-checklist.xlsx` exists. If it is missing, stop before scaffold/build work and report the child output plus the source paths that were passed in. Do not silently continue without the workbook; Development may proceed with unapproved current content only after the approval artifact exists as the stakeholder review surface.

## Step 3 — Ensure scaffold

- `<target>` = **elementor**: if `.twt-artifacts/elementor-theme/conventions.md` is missing, dispatch `/twt-elementor-theme-creator` (Agent tool). If present, continue.
- `<target>` = **html**: if `.twt-artifacts/html-site/conventions.md` is missing, dispatch `/twt-html-site-creator` (Agent tool). If present, continue.

## Step 4 — Promote pages (pilot first, gate, then parallel batch)

Pages are independent **except** for the shared files each builder appends to — HTML: `sections.css` / `general.css`, the inlined `partials/`, the `tokens.css` mirror; Elementor: `widgets.css` / `design-system.css`, the `$map` registry in `class-<slug>-elementor.php`, `wpml-config.xml`. Promoting every page fully in parallel would both **race** on those shared files and **defeat reuse-first** (each agent, starting from the same baseline, re-creates the same hero/CTA). So promote in phases, with a pilot checkpoint before the expensive full batch.

Take the page list from `mockup/pages/`, falling back to page-level `mockup/*.html` files except `index.html` (respect any page scope from `$ARGUMENTS`). The **home/index** page — or the first page if there is no home — is the **foundation page** / **pilot**. The matching builder is:
- `<target>` = **html** → `/twt-html-block-creator`
- `<target>` = **elementor** → `/twt-elementor-block-creator`

**Continuation:** if `$ARGUMENTS` contains the token `pilot-approved`, the pilot was already built and approved in a prior pass — **skip Steps 4a and the gate** and go straight to Step 4b for the pages not yet built.

### Step 4a — Foundation / pilot pass (serial)
Dispatch the builder for the **foundation page only**, normally (Agent tool, passing its mockup HTML + `layouts/<page>.md`). It writes its page file *and* the shared files, priming the reuse pool: the common sections/widgets, chrome, and shared CSS now exist for every other page to reuse. If there is only one page, you're done — skip to Step 5.

### Step 4a-gate — Pilot review (checkpoint before the full set)
The pilot is the cheap proof of how the design lands in `<target>`. Gate on it before spending tokens promoting every remaining page.

- **Auto / unattended** (the run was started in `auto`): skip the gate — proceed to Step 4b and build all remaining pages. Note in the report that the pilot was auto-approved.
- **Collect mode** (`subagent-collect` in `$ARGUMENTS`, e.g. dispatched by `/twt-site`): do **not** build the rest and do **not** ask. Record an open decision in the target's decisions file — `.twt-artifacts/html-site/decisions.md` (html) or `.twt-artifacts/elementor-theme/decisions.md` (elementor) — "Pilot page `<page>` built at `<path>`; approve to promote the remaining N pages, adjust the pilot, or stop" (`status: open`, list the remaining pages) — and **return** that decision + the pilot path in your report. The orchestrator surfaces the gate and re-dispatches `/twt-develop` with `pilot-approved` to continue. Stop here.
- **Standalone interactive:** present the pilot to the user (the built page path; invite them to open it) and ask via the **AskUserQuestion** tool (single-select, header "Pilot"):
  - **Build the remaining N pages** — proceed to Step 4b.
  - **Add one more pilot page** — build one representative interior page serially (same reuse pool), then re-show this gate, so an interior layout is seen before committing.
  - **Adjust the pilot first** — collect feedback (plain text), re-dispatch the builder for the pilot page(s) with it, then re-show this gate.
  - **Stop here** — finish with only the pilot built; go to Step 5 and report what remains.
  Only on **Build the remaining** continue to Step 4b.

### Step 4b — Parallel batch (remaining pages)
Dispatch **every page not yet built** (the set after the pilot and any pilot-added interior pages) in a **single batch of parallel Agent calls** (one message, multiple Agent tool uses), each passing the page's mockup HTML + `layouts/<page>.md`. Pass the asset manifest to each builder: media must use the **exact `filename` and `alt` from the manifest** (place real files under the build's `assets/img|video/`); where an asset file isn't present yet, emit the correct `<img src>`/path with the manifest's alt and leave the file to be supplied — never invent a different filename. In every agent's prompt, include the **parallel-promotion contract**:

> Parallel mode — return deltas, don't write shared files. Reuse-first against the shared files the foundation pass already wrote. Write **only** your own disjoint page file (`site/<page>.html`, or `import/<page-slug>/import.json` + its `assets/`). Do **not** write or append to any shared file (`sections.css`, `general.css`, `widgets.css`, `design-system.css`, the `$map` registry, `wpml-config.xml`, or `partials/`). Instead **return in your report** any new shared-file deltas as text — new section-/widget-CSS blocks, new tokens, new `$map`/WPML entries, and any partial change — only for sections that genuinely aren't already in the reuse pool.

Each page file is disjoint, so there is no write conflict. Wait for the whole batch to finish.

### Step 4c — Merge deltas (serial)
Apply the returned deltas to the shared files yourself, one at a time, **de-duplicating**: if two pages returned the same new section (same purpose/selector), add it once and point both pages at it. Then, if any page needed a partial change, re-inline the partial into every page; re-mirror `tokens.css` if a token was added. Finally run the builder's own inline build checks across all pages (every page links the CSS / registers its widgets; no literals; links resolve; chrome identical; no lorem where real content exists).

## Wiki harvest — capture this phase's decisions (skip if no wiki)
Use Glob to check whether `.project-wiki/` exists at the project root (`$CLAUDE_PROJECT_DIR/.project-wiki/`) — never a shell command. If it does not exist, skip this step silently: the wiki is opt-in, and this must not change behavior for a project that hasn't adopted it.

If it exists, run the harvester (Bash, single command) to pull this phase's decision-bearing content into the inbox:
`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-harvest.mjs" "$CLAUDE_PROJECT_DIR"`

It scans `.twt-artifacts/` for open items in every `decisions.md`, every status row in `facts.md` (the ledger's only path into the wiki — resolved facts must survive artifact deletion, not just CONFLICTs), BLOCKER findings in each `validation-report.md`, and session-log Q&A, then appends decision-bearing entries to `.project-wiki/inbox.md` and adds a `sources.md` row for everything else. It is idempotent (tracked in `.project-wiki/.harvest-state.json`, so a re-run never re-adds what's already there) and always exits 0, printing a one-line summary such as `3 harvested, 5 already present. 12 inbox entries pending curation.` — a harvest problem must never fail or block this phase; if the tool errors for any reason, note it and continue to the Report step regardless.

Carry the harvester's summary line into this phase's Report step. **This is capture, not curation (§17):** it only appends to the inbox — no curated page (`decisions/`, `entities/`, `ideas/`, `facts.md`, `open-questions.md`, `glossary.md`, `index.md`, `overview.md`) is written here, and none should be. Turning inbox entries into a cited page is a separate, user-invoked step — point to `/twt-wiki` — never do it as part of this run.

## Step 5 — Report

State: target, pages promoted, whether a scaffold was created, reuse decisions surfaced from the builders, whether the content approval workbook was created/refreshed, and any outstanding items to resolve before Phase 4 (QA). Explicitly say that approved workbook content is not auto-applied by Development; after stakeholder approval, run `/twt-content-approval-implement` to update the corresponding blocks/pages.
