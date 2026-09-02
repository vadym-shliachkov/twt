# twt — Skills Marketplace

A collection of Claude Code slash commands you can install once and use across any project on any machine.

---

## What is this?

**twt** is a personal skills marketplace for Claude Code. Each skill is a `/twt-*` slash command that extends Claude with a specific capability. Install the plugin once and the commands are immediately available in both the Claude Code CLI and the Desktop application.

---

## Quick Start

```
/plugin marketplace add vadym-shliachkov/twt
/plugin install twt@twt-marketplace                 # the full pipeline
/plugin install twt-write-as-me@twt-marketplace     # or just the author-voice tool
/plugin install twt-export@twt-marketplace          # or just the document/slide exports
```

Then **restart Claude Code** (CLI or Desktop). All `/twt-*` commands are immediately available.

After the plugin is active, run `/twt-setup` once in any project to merge the curated permission allowlist into that project's `settings.json` — this cuts the "Do you want to proceed?" prompts during pipeline runs.

---

## Uninstalling

`/plugin remove twt` and restart.

---

## Using on a new Claude account

Run the two `/plugin` commands above on the new machine — no cloning required.

---

## Available commands

See [SKILLS.md](SKILLS.md) for the full reference.

<!-- TWT_SKILLS_TABLE_START -->

### Install

Add the marketplace once, then install **either** the whole pipeline **or**
the individual units you want. They are mutually exclusive: installing the
bundle alongside a unit registers the same skills twice.

```
/plugin marketplace add vadym-shliachkov/twt
/plugin install twt@twt-marketplace
/plugin install twt-export@twt-marketplace
/plugin install twt-write-as-me@twt-marketplace
```

Units not listed above are built and verified but not yet offered for
install; they ship inside the bundle. See SKILLS.md for the full set.

### Commands

| command | unit | family | description |
|---------|------|--------|-------------|
| /twt-assets-produce | twt-design | assets | Fulfill the asset manifest — ingest provided files, generate placeholders, favicon/OG set, icon SVGs |
| /twt-audience | twt-pre-design | audience | Orchestrate the audience define/validate skills in a single define→validate pass |
| /twt-block-map | twt-block-map | block-map | Map a site's block architecture — nested block/subblock tree, name-blind identity, page↔block reuse matrix |
| /twt-block-preview | twt-design | block-preview | Screenshot an HTML file or URL — full page or a specific CSS-selector element; also runs batch block-capture for a design-system audit dir |
| /twt-brand | twt-pre-design | brand | Orchestrate the brand fetch/define/validate skills in a single define→validate pass |
| /twt-content-approval-checklist | twt-develop | content-approval | Create a human-readable XLSX content approval checklist for every project page, running text-analysis to fill recommended content and color the ready cell green/pink, expanding collections (Work/Blog/…) into taxonomy + detail-page worksheets |
| /twt-content-approval-implement | twt-develop | content-approval | Apply ready approved XLSX content into the built site or development artifacts |
| /twt-content-fetch | twt-pre-design | content-fetch | Detect provided sources (site, PDF, doc, Figma, video) and dispatch to the right content-fetch sub-skill |
| /twt-content-fetch-doc | twt-pre-design | content-fetch | Extract a Word/Google Doc's content and save as clean Markdown |
| /twt-content-fetch-figma | twt-pre-design | content-fetch | Extract a Figma file's visible text content and save as clean Markdown |
| /twt-content-fetch-pdf | twt-pre-design | content-fetch | Extract a PDF's text content and save as clean Markdown |
| /twt-content-fetch-site | twt-pre-design | content-fetch | Fetch a website's content via the bundled crawler and save as clean Markdown |
| /twt-content-fetch-video | twt-pre-design | content-fetch | Transcribe one or many video/audio files (URLs, local paths, or a folder) into a descriptive timestamped transcript — speakers, on-screen text, and visible action woven into the timeline — plus a WebVTT caption track for any recording that ships none of its own |
| /twt-content-optimize | twt-pre-design | content | Score then rewrite text for clarity, brevity, and UX-writing quality — auto or per-suggestion |
| /twt-design | twt-design | design | Run the full Phase 2 pipeline and synthesize a Phase-3-ready design-brief.md |
| /twt-design-system | twt-design | design-system | Orchestrate design-system define/validate in a single define→validate pass, then always build the full component catalog (primitives/components/modules) |
| /twt-design-system-audit | twt-design-system-audit | design-system-audit | Audit a real design's system quality + cross-page block consistency from a Figma file and/or site URL — synthesizes (and cleans) the canonical system when none is given and produces a multi-page HTML report (homepage + per-page files) with per-block before/after visuals naming the exact page+block that drifts, plus 14-category DS comparison metrics |
| /twt-develop | twt-develop | develop | Phase 3 full path — promote the Phase-2 design into the chosen build target |
| /twt-elementor-block-creator | twt-develop | elementor | Build an Elementor widget or full-page template following project conventions |
| /twt-elementor-theme-creator | twt-develop | elementor | Scaffold a production-ready Hello Elementor child theme via the bundled scaffolder script |
| /twt-eval-smoke | twt-site | meta | Behavioral smoke eval — run scoped skills against a seeded fixture and assert their postconditions mechanically (marketplace-dev only) |
| /twt-export | twt-export | export | Orchestrate PDF, DOCX, PPTX, and theme-based exports |
| /twt-export-docx | twt-export | export | Convert Markdown to a polished DOCX with the doc-hub-light theme and doc-type-aware styling |
| /twt-export-pdf | twt-export | export | Convert Markdown to a polished PDF with the doc-hub-light theme and doc-type-aware styling |
| /twt-export-presentation | twt-export | export | Convert Markdown to PPTX or PDF slides via the presentation export script |
| /twt-export-template-create | twt-export | export | Create a whole reusable export theme (css layers, fonts, reference docs, preview) from brand or user style instructions |
| /twt-fidelity | twt-fidelity | fidelity | Build a block or page to measured fidelity against a Figma frame, a reference URL, or an image |
| /twt-figma-design-system | twt-design | figma-export | Push the design system into a Figma file as variables, styles, and variant components |
| /twt-figma-dev-audit | twt-figma-dev-audit | figma-dev-audit | Audit a Figma file for developer readiness before implementation starts - what will block, slow, or misdirect the build |
| /twt-figma-mockup | twt-design | figma-export | Assemble the HTML page mockups in Figma as frames built from the pushed design-system library |
| /twt-html-block-creator | twt-develop | html | Build static HTML pages/sections with inlined partials, reuse-first, token-only CSS |
| /twt-html-site-creator | twt-develop | html | Scaffold a dependency-free static HTML/CSS site via the bundled scaffolder (partials, mirrored tokens.css, conventions.md) |
| /twt-inherit-block-creator | twt-develop | inherit | Build blocks and pages into an existing project using its own architecture and idiom |
| /twt-launch-audit | twt-qa | launch-audit | Audit a project's readiness to go to production - what blocks the launch, what is missing, and who owns each item |
| /twt-link-check | twt-link-check | link-check | Probe every link and asset on a page, a whole site, or a built folder and report the bad ones (404/403/5xx, dead anchors, missing files) into Markdown |
| /twt-marketplace-docs | twt-site | meta | Regenerate SKILLS.md, architecture.md, and the README table block from skill frontmatter |
| /twt-positioning | twt-pre-design | positioning | Orchestrate positioning define/validate in a single define→validate pass |
| /twt-pre-design | twt-pre-design | pre-design | Run the full Phase 1 pipeline and synthesize a Phase-2-ready pre-design-brief.md |
| /twt-project-intake | twt-pre-design | intake | Normalize messy project notes into a clean site-instruction.md for /twt-site |
| /twt-qa | twt-qa | qa | Run the applicable QA audits (local or live) and synthesize qa-report.md + gaps.md |
| /twt-qa-a11y | twt-qa | qa | Audit built or served pages for accessibility (alt, headings, landmarks, labels, contrast) |
| /twt-qa-content | twt-qa | qa | Audit built or served pages for content & IA fidelity (sitemap coverage, real content, lorem) |
| /twt-qa-design | twt-qa | qa | Audit built HTML/CSS source for design & token fidelity (token-only, structure vs design system) |
| /twt-qa-elementor | twt-qa | qa | Audit Elementor theme files for code hygiene (token-only CSS, widget registration, WPML, PHP lint) |
| /twt-qa-links | twt-qa | qa | Audit built or served pages for link integrity and declared responsive tiers |
| /twt-search-site | twt-search-site | search | Search a website for an exact string via the bundled crawler; report page links with ±100 chars of context per match |
| /twt-seo | twt-seo | seo | Orchestrate the SEO define/validate skills in a single define→validate pass |
| /twt-setup | twt-site | meta | One-time setup — merge the curated runtime permission allowlist into this project's settings to cut prompts during pipeline runs |
| /twt-site | twt-site | site | Master orchestrator — run the full pre-design to QA pipeline with approval pauses, a design-already-done shortcut, per-phase reviews folded into a consolidated reports/ dashboard with a confirm-before-rerun decision gate, a post-Design text-quality pass that applies consistency/factual rewrites, an always-on dispatch trace, and an auto content-approval workbook after Pre-design+Design (or Development) |
| /twt-site-dev | twt-develop | site-dev | Phase 3 express — from a Figma link, build/update the design system and jump to development, with an always-on dispatch trace |
| /twt-skill-test | twt-site | meta | Agentic skill harness — derive frozen criteria, run a skill from the working tree, grade blind, optionally fix, re-run bounded (marketplace-dev only) |
| /twt-spec | twt-pre-design | spec | Orchestrate the spec define/validate skills in a single define→validate pass |
| /twt-status | twt-site | meta | Detect stale pipeline artifacts — flag any output older than the inputs it was derived from |
| /twt-text-analysis | twt-pre-design | content | Block-type-aware text-quality audit with class-tagged validated suggestions only; never applies changes |
| /twt-wiki | twt-wiki | wiki | Initialize, ingest into, and curate the project wiki — the project's durable memory |
| /twt-wiki-query | twt-wiki | wiki | Ask the project a question and get an answer cited to the wiki and its sources |
| /twt-write-as-me | twt-write-as-me | voice | Generate or rewrite text in the author's own voice using their writing-style profile |
| /twt-write-as-me-analysis | twt-write-as-me | voice | Extract a reproducible writing-fingerprint profile from the author's own text samples |
<!-- TWT_SKILLS_TABLE_END -->

---

## Directory structure

```
twt/
├── README.md              ← you are here
├── SKILLS.md              ← full command reference (auto-generated)
├── architecture.md        ← skill graph (auto-generated)
├── skills/                ← every skill, one directory each (surface: command | internal)
│   └── twt-*.md           ← one file per command, flat — no subfolders
├── skills/                ← sub-skills (model-invoked only, not in / menu)
│   └── twt-<name>-<role>/ ← one directory per sub-skill
│       └── SKILL.md
├── hooks/                 ← bundled plugin hooks
│   └── hooks.json         ← scope-guard + debug tracer (activated by plugin)
└── tools/                 ← Node scripts invoked from skill bodies
```

Category is expressed only via the `category:` frontmatter field — there are no per-category subfolders.

---

## Adding a new skill

1. Create `skills/twt-<name>/SKILL.md` and set `surface: command` (entry point) or `surface: internal` (dispatch-only)
2. **Sub-skill** (`*-define`, `*-validate`, or `*-fetch`): create `skills/twt-<name>-<role>/SKILL.md`
3. Fill all frontmatter fields (none are optional; use `[]` for empty lists)
4. Write the Intent block (Purpose / Non-goals / Success criteria), then `## Step N` body
5. Run `/twt-marketplace-docs` — it stamps `(vX.Y.Z)` into each skill's `description:` and regenerates `SKILLS.md`, `architecture.md`, and the README table

---

## Artifacts

All skills that produce output write files into `.twt-artifacts/` in the current working directory. This folder is local to each project and safe to add to `.gitignore`.

```
.twt-artifacts/
└── <skill-area>/
    └── ...
```
