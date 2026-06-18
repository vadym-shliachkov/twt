# twt — Skills Marketplace

A collection of Claude Code slash commands you can install once and use across any project on any machine.

---

## What is this?

**twt** is a personal skills marketplace for Claude Code. Each skill is a `/twt-*` slash command that extends Claude with a specific capability. Clone this repo, run the installer, and the commands are immediately available in both the Claude Code CLI and the Desktop application.

---

## Quick Start

### macOS / Linux

```bash
git clone <your-repo-url> twt
cd twt
bash install.sh
```

### Windows (PowerShell)

```powershell
git clone <your-repo-url> twt
cd twt
.\install.ps1
```

After installing, **restart Claude Code** (CLI or Desktop) so it picks up the new commands.

---

## Installation details

The installer recursively scans `skills/` for all `*.md` skill files and copies them flat into:

| Platform | Target directory |
|----------|-----------------|
| macOS / Linux | `~/.claude/commands/` |
| Windows | `%USERPROFILE%\.claude\commands\` |

This is the standard location that both the **Claude Code CLI** and the **Claude Code Desktop app** read from. No extra configuration required.

### Project-local install + scope guard

Install the skills into a single project instead of globally:

```bash
# macOS / Linux
bash install.sh --target /path/to/project

# Windows
.\install.ps1 -Target C:\path\to\project
```

A project-local install also seeds a **scope guard** into `<project>\.claude\settings.json`: a
`PreToolUse` hook (`.claude/hooks/twt-scope-guard.js`) that **auto-allows any tool call that stays
inside the project folder** and leaves anything reaching **outside** it to the normal approval prompt.
This removes the flood of repeated "Do you want to proceed?" prompts during a pipeline run while still
asking before anything touches a sibling project, a parent directory, or the wider filesystem.

The guard never denies outright — on any uncertainty it simply falls back to the normal prompt, so it
can only ever cost an extra confirmation, never an unwanted auto-approval. It needs **Node.js** (the hook
is a small Node script). Pass `--no-scope-guard` / `-NoScopeGuard` to skip it.

---

## Uninstalling

```bash
# macOS / Linux
bash uninstall.sh

# Windows
.\uninstall.ps1
```

---

## Using on a new Claude account

1. Clone this repo on the new machine
2. Run the installer
3. Done — commands are account-agnostic; they live in the local `~/.claude/` directory

---

## Available commands

See [SKILLS.md](SKILLS.md) for the full reference.

<!-- TWT_SKILLS_TABLE_START -->
| command | category | description |
|---------|----------|-------------|
| /twt-brand | brand | Orchestrate the brand fetch/define/validate skills in a single define→validate pass |
| /twt-brand-define | brand | Build or refine the canonical brand-brief.md through guided dialogue |
| /twt-brand-fetch | brand | Extract brand attributes from a brand book, Figma, or screenshots into raw notes |
| /twt-brand-validate | brand | Critique brand-brief.md and write a validation-report.md (read-only critic) |
| /twt-component | component | Orchestrate component define/validate in a single define→validate pass |
| /twt-component-define | component | Define component specs (components.md) and render a token-driven gallery.html |
| /twt-component-validate | component | Read-only critique of components.md and gallery.html into validation-report.md |
| /twt-content-approval-checklist | content | Create a human-readable XLSX content approval checklist for every project page |
| /twt-content-approval-implement | content | Apply ready approved XLSX content into the built site or development artifacts |
| /twt-content-fetch | content | Detect provided sources and dispatch to the right content-fetch sub-skill |
| /twt-content-fetch-doc | content | Extract a Word/Google Doc's content and save as clean Markdown |
| /twt-content-fetch-pdf | content | Extract a PDF's text content and save as clean Markdown |
| /twt-content-fetch-site | content | Fetch a website's content and save as clean Markdown |
| /twt-content-optimize | content | Score then rewrite text for clarity, brevity, and UX-writing quality — auto or per-suggestion |
| /twt-content-validate | content | Score text quality (clarity, brevity, UX writing) with evidence-backed reasoning per criterion |
| /twt-curation | curation | Orchestrate curation define/validate in a single define→validate pass |
| /twt-curation-define | curation | Decide keep/skip/elevate per content item; produce inventory.md and per-page outlines |
| /twt-curation-validate | curation | Critique curation against brand voice and IA; write validation-report.md |
| /twt-design | design | Run the full Phase 2 pipeline and synthesize a Phase-3-ready design-brief.md |
| /twt-design-system | design-system | Orchestrate design-system define/validate in a single define→validate pass |
| /twt-design-system-define | design-system | Define or analyse a design system into tokens.md, tokens.css, and preview.html (atomic-evolution preview) |
| /twt-design-system-validate | design-system | Read-only critique of tokens.md, tokens.css, and preview.html into validation-report.md |
| /twt-develop | develop | Phase 3 full path — promote the Phase-2 design into the chosen build target |
| /twt-elementor-block-creator | elementor | Build an Elementor widget or full-page template following project conventions |
| /twt-elementor-theme-creator | elementor | Scaffold a production-ready Hello Elementor child theme for a WordPress project |
| /twt-html-block-creator | html | Build static HTML pages/sections with inlined partials, reuse-first, token-only CSS |
| /twt-html-site-creator | html | Scaffold a dependency-free static HTML/CSS site (partials, mirrored tokens.css, conventions.md) |
| /twt-ia | ia | Orchestrate IA define/validate in a single define→validate pass |
| /twt-ia-define | ia | Build or refine sitemap.md and functional-scope.md |
| /twt-ia-validate | ia | Critique sitemap.md + functional-scope.md against positioning and content; write report |
| /twt-layout | layout | Orchestrate layout define/validate in a single define→validate pass |
| /twt-layout-define | layout | Define per-page layout specs (section order, component slots, content map, breakpoints) |
| /twt-layout-validate | layout | Read-only critique of per-page layout specs into validation-report.md |
| /twt-marketplace-docs | meta | Regenerate SKILLS.md, architecture.md, and category READMEs from skill frontmatter |
| /twt-mockup | mockup | Orchestrate mockup define/validate in a single define→validate pass |
| /twt-mockup-define | mockup | Render fully-responsive plain-HTML/CSS page mockups from layouts, components, and real content |
| /twt-mockup-validate | mockup | Read-only critique of page mockups (token links, real content, responsiveness, a11y) |
| /twt-positioning | positioning | Orchestrate positioning define/validate in a single define→validate pass |
| /twt-positioning-define | positioning | Build or refine positioning.md — audience, value props, promotion priorities |
| /twt-positioning-validate | positioning | Critique positioning.md against brand and content signal; write validation-report.md |
| /twt-pre-design | pre-design | Run the full Phase 1 pipeline and synthesize a Phase-2-ready pre-design-brief.md |
| /twt-qa | qa | Run the applicable QA audits (local or live) and synthesize qa-report.md + gaps.md |
| /twt-qa-a11y | qa | Audit built or served pages for accessibility (alt, headings, landmarks, labels, contrast) |
| /twt-qa-content | qa | Audit built or served pages for content & IA fidelity (sitemap coverage, real content, lorem) |
| /twt-qa-design | qa | Audit built HTML/CSS source for design & token fidelity (token-only, structure vs design system) |
| /twt-qa-elementor | qa | Audit Elementor theme files for code hygiene (token-only CSS, widget registration, WPML, PHP lint) |
| /twt-qa-links | qa | Audit built or served pages for link integrity and declared responsive tiers |
| /twt-roast-express | roast-express | Phase 3 express — from a Figma link, build/update the design system and jump to development |
| /twt-roast-full | roast-full | Master orchestrator — run the full pre-design to QA pipeline with approval pauses between phases |
| /twt-search-site | search | Search a website for an exact string; report page links with ±100 chars of context per match |
| /twt-spec | spec | Orchestrate the spec define/validate skills in a single define→validate pass |
| /twt-spec-define | spec | Interview the user (brainstorming-style) into a north-star specification.md |
| /twt-spec-validate | spec | Critique specification.md and write a validation-report.md (read-only critic) |
| /twt-status | status | Detect stale pipeline artifacts — flag any output older than the inputs it was derived from |
<!-- TWT_SKILLS_TABLE_END -->

---

## Directory structure

```
twt/
├── README.md              ← you are here
├── SKILLS.md              ← full command reference
├── install.sh             ← macOS / Linux installer
├── install.ps1            ← Windows installer
├── uninstall.sh           ← macOS / Linux uninstaller
├── uninstall.ps1          ← Windows uninstaller
└── skills/                ← all skill files, organised by category
    └── content/           ← content fetching & extraction skills
        ├── README.md      ← category description
        └── twt-fetch-content-site.md
```

Add new categories by creating a new subfolder under `skills/`. The installer
picks up any `*.md` file found anywhere inside `skills/` automatically.

---

## Adding a new skill

1. Choose the right category folder under `skills/` (or create a new one)
2. Create `twt-<your-skill>.md` inside it
3. Write the skill prompt (use `$ARGUMENTS` for anything the user types after the command name)
4. Run the installer again — the new command is deployed immediately
5. Add a row to [SKILLS.md](SKILLS.md) and the category `README.md`

### Skill file template

```markdown
# /twt-your-skill-name

One-line description of what this skill does.

---

## Step 1 — ...

[Instructions for Claude to follow when this command is invoked]

Arguments passed by the user: $ARGUMENTS
```

---

## Artifacts

All skills that produce output write files into `.twt-artifacts/` in the current working directory. This folder is local to each project and safe to add to `.gitignore`.

```
.twt-artifacts/
└── <skill-area>/
    └── ...
```
