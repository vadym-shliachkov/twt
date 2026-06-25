# twt — Skills Marketplace

A collection of Claude Code slash commands you can install once and use across any project on any machine.

---

## What is this?

**twt** is a personal skills marketplace for Claude Code. Each skill is a `/twt-*` slash command that extends Claude with a specific capability. Install the plugin once and the commands are immediately available in both the Claude Code CLI and the Desktop application.

---

## Quick Start

```
/plugin marketplace add vadym-shliachkov/twt
/plugin install twt@twt-marketplace
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
| command | category | description |
|---------|----------|-------------|
| /twt-brand | brand | Orchestrate the brand fetch/define/validate skills in a single define→validate pass |
| /twt-brand-fetch | brand | Extract brand attributes from a brand book, Figma, or screenshots into raw notes |
| /twt-component-define | component | Define component specs (components.md) and render a token-driven gallery.html (Primitives/Components/Modules) |
| /twt-component-validate | component | Read-only critique of components.md and gallery.html into validation-report.md |
| /twt-content-approval-checklist | content | Create a human-readable XLSX content approval checklist for every project page, running text-analysis to fill recommended content and color the ready cell green/pink, expanding collections (Work/Blog/…) into taxonomy + detail-page worksheets |
| /twt-content-approval-implement | content | Apply ready approved XLSX content into the built site or development artifacts |
| /twt-content-fetch | content | Detect provided sources (site, PDF, doc, Figma) and dispatch to the right content-fetch sub-skill |
| /twt-content-fetch-doc | content | Extract a Word/Google Doc's content and save as clean Markdown |
| /twt-content-fetch-figma | content | Extract a Figma file's visible text content and save as clean Markdown |
| /twt-content-fetch-pdf | content | Extract a PDF's text content and save as clean Markdown |
| /twt-content-fetch-site | content | Fetch a website's content and save as clean Markdown |
| /twt-content-optimize | content | Score then rewrite text for clarity, brevity, and UX-writing quality — auto or per-suggestion |
| /twt-content-validate | content | Score text quality (clarity, brevity, UX writing) with evidence-backed reasoning per criterion |
| /twt-curation-define | curation | Decide keep/skip/elevate per content item; produce inventory.md and per-page outlines |
| /twt-curation-validate | curation | Critique curation against brand voice and IA; write validation-report.md |
| /twt-design | design | Run the full Phase 2 pipeline and synthesize a Phase-3-ready design-brief.md |
| /twt-design-system | design-system | Orchestrate design-system define/validate in a single define→validate pass, then build the component catalog (standalone) |
| /twt-design-system-audit | design-system | Audit a real design's system quality + cross-page block consistency from a Figma file and/or site URL — synthesizes (and cleans) the canonical system when none is given and produces a multi-page HTML report (homepage + per-page files) with per-block before/after visuals naming the exact page+block that drifts |
| /twt-develop | develop | Phase 3 full path — promote the Phase-2 design into the chosen build target |
| /twt-elementor-block-creator | elementor | Build an Elementor widget or full-page template following project conventions |
| /twt-elementor-theme-creator | elementor | Scaffold a production-ready Hello Elementor child theme for a WordPress project |
| /twt-export | export | Orchestrate PDF, DOCX, PPTX, and template-based exports |
| /twt-export-docx | export | Convert Markdown to a polished DOCX with the shared document template |
| /twt-export-pdf | export | Convert Markdown to a polished PDF with the shared document template |
| /twt-export-presentation | export | Convert Markdown to PPTX or PDF slides via the presentation export script |
| /twt-export-template-create | export | Create reusable export templates from brand or user style instructions |
| /twt-html-block-creator | html | Build static HTML pages/sections with inlined partials, reuse-first, token-only CSS |
| /twt-html-site-creator | html | Scaffold a dependency-free static HTML/CSS site (partials, mirrored tokens.css, conventions.md) |
| /twt-ia-define | ia | Build or refine sitemap.md and functional-scope.md |
| /twt-ia-validate | ia | Critique sitemap.md + functional-scope.md against positioning and content; write report |
| /twt-layout-define | layout | Define per-page layout specs (section order, component slots, content map, breakpoints) |
| /twt-layout-validate | layout | Read-only critique of per-page layout specs into validation-report.md |
| /twt-marketplace-docs | meta | Regenerate SKILLS.md, architecture.md, and the README table block from skill frontmatter |
| /twt-mockup-define | mockup | Render fully-responsive plain-HTML/CSS page mockups from layouts, components, and real content |
| /twt-mockup-validate | mockup | Read-only critique of page mockups (token links, real content, responsiveness, a11y) |
| /twt-positioning | positioning | Orchestrate positioning define/validate in a single define→validate pass |
| /twt-pre-design | pre-design | Run the full Phase 1 pipeline and synthesize a Phase-2-ready pre-design-brief.md |
| /twt-project-intake | intake | Normalize messy project notes into a clean site-instruction.md for /twt-site |
| /twt-qa | qa | Run the applicable QA audits (local or live) and synthesize qa-report.md + gaps.md |
| /twt-qa-a11y | qa | Audit built or served pages for accessibility (alt, headings, landmarks, labels, contrast) |
| /twt-qa-content | qa | Audit built or served pages for content & IA fidelity (sitemap coverage, real content, lorem) |
| /twt-qa-design | qa | Audit built HTML/CSS source for design & token fidelity (token-only, structure vs design system) |
| /twt-qa-elementor | qa | Audit Elementor theme files for code hygiene (token-only CSS, widget registration, WPML, PHP lint) |
| /twt-qa-links | qa | Audit built or served pages for link integrity and declared responsive tiers |
| /twt-search-site | search | Search a website for an exact string; report page links with ±100 chars of context per match |
| /twt-setup | meta | One-time setup — merge the curated runtime permission allowlist into this project's settings to cut prompts during pipeline runs |
| /twt-site | site | Master orchestrator — run the full pre-design to QA pipeline with approval pauses, a design-already-done shortcut, per-phase reviews folded into a consolidated reports/ dashboard with a confirm-before-rerun decision gate, a post-Design text-quality pass, an always-on dispatch trace, and an auto content-approval workbook after Pre-design+Design (or Development) |
| /twt-site-dev | site-dev | Phase 3 express — from a Figma link, build/update the design system and jump to development, with an always-on dispatch trace |
| /twt-spec | spec | Orchestrate the spec define/validate skills in a single define→validate pass |
| /twt-status | status | Detect stale pipeline artifacts — flag any output older than the inputs it was derived from |
| /twt-text-analysis | content | Block-by-block text-quality analysis (11 metrics incl. substantiation) — read-only scored report with suggested rewrites; never applies changes |
<!-- TWT_SKILLS_TABLE_END -->

---

## Directory structure

```
twt/
├── README.md              ← you are here
├── SKILLS.md              ← full command reference (auto-generated)
├── architecture.md        ← skill graph (auto-generated)
├── commands/              ← orchestrators + standalone tools (slash commands)
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

1. **Orchestrator / standalone tool:** create `commands/twt-<name>.md`
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
