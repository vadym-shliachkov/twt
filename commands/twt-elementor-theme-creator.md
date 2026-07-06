---
name: twt-elementor-theme-creator
category: elementor
description: (v1.2.1) Scaffold a production-ready Hello Elementor child theme via the bundled scaffolder script
version: 1.2.1
accepts_arguments: false
inputs:
  - project name
  - short slug (auto-derived, user confirms)
dependencies:
  hard: []
  soft: []
reads: []
writes:
  - wp-content/themes/hello-elementor-<slug>/style.css
  - wp-content/themes/hello-elementor-<slug>/functions.php
  - wp-content/themes/hello-elementor-<slug>/assets/css/design-system.css
  - wp-content/themes/hello-elementor-<slug>/assets/css/general.css
  - wp-content/themes/hello-elementor-<slug>/inc/elementor/class-<slug>-elementor.php
  - wp-content/themes/hello-elementor-<slug>/inc/elementor/class-skeleton-widget-base.php
  - wp-content/themes/hello-elementor-<slug>/inc/elementor/widgets/.gitkeep
  - wp-content/themes/hello-elementor-<slug>/assets/js/.gitkeep
  - wp-content/themes/hello-elementor-<slug>/wpml-config.xml
  - .twt-artifacts/elementor-theme/conventions.md
---

# /twt-elementor-theme-creator

## Intent

**Purpose:** Scaffold a Hello Elementor child theme and write the canonical project conventions file (`conventions.md`) that downstream `/twt-elementor-*` skills depend on. Run once per WordPress project.

**Non-goals:**
- Doesn't build widgets (that's `/twt-elementor-block-creator`)
- Doesn't install Hello Elementor parent theme — assumes it exists
- Doesn't overwrite existing theme files without confirmation

**Success criteria:**
- Theme folder exists at `wp-content/themes/hello-elementor-<slug>/` with all required files
- `.twt-artifacts/elementor-theme/conventions.md` exists and is readable by other skills
- `design-system.css` contains the CSS custom-property scaffold
- Theme is activatable in WordPress without errors

---

## Overview

This skill creates:
- A Hello Elementor child theme at `wp-content/themes/hello-elementor-<slug>/`
- Elementor widget loader with a reusable `Skeleton_Widget_Base` class
- CSS design system (tokens + scoped general styles)
- A conventions reference (`.twt-artifacts/elementor-theme/conventions.md`) that future `/twt-elementor-*` skills load automatically

**It asks three questions, then creates everything automatically.**

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Introduction

Print this before doing anything else:

```
╔══════════════════════════════════════════════════════════╗
║  TWT — Elementor Theme Creator                          ║
╠══════════════════════════════════════════════════════════╣
║  Creates a production-ready Hello Elementor child       ║
║  theme with:                                            ║
║    • style.css + functions.php                          ║
║    • Elementor widget loader (class-<slug>-elementor)   ║
║    • Skeleton widget base class                         ║
║    • CSS design system (tokens + scoped styles)         ║
║    • WPML config skeleton                               ║
║    • Project conventions reference for future skills    ║
║                                                         ║
║  This setup becomes the base for all future             ║
║  /twt-elementor-block-creator runs.                     ║
╚══════════════════════════════════════════════════════════╝
```

---

## Step 2 — Project Setup

**Check first:** Does `.twt-artifacts/elementor-theme/conventions.md` exist?

- **Yes →** Read it and extract `Project name:` and `Project slug:` values. Skip to Step 3.
- **No →** Continue below.

Ask the user:

> **What is the project name?**
> *(Example: Project Industries, Acme Financial Group)*

Wait for the response. Then generate a short project slug:

**Slug rules:**
- Lowercase, alphanumeric + hyphens only
- 2–5 characters preferred
- Use initials for multi-word names

| Name | Slug |
|------|------|
| Project Industries | `pi` |
| Acme Financial Group | `afg` |
| Blue Horizon Digital | `bhd` |
| Momentum Health | `mh` |

Display:

```
Project slug: `<slug>`

This slug is used everywhere:
  • Theme folder:       hello-elementor-<slug>/
  • CSS scope classes:  .<slug>-chrome, .<slug>-homepage
  • Widget IDs:         <slug>_hero, <slug>_cards, …
  • Translation domain: hello-elementor-<slug>
  • Cache constant:     <SLUG>_CHILD_VERSION
```

Ask via the **AskUserQuestion** tool (single-select, header "Slug OK?") Is this slug correct?:
- **Looks good** — use this slug as-is
- **Enter a different slug** — I'll provide a different slug
- **You decide** — use the proposed slug as-is

Record the choice and continue. If the user chose "Enter a different slug", ask for their preferred slug as free-form text.

---

## Step 3 — Theme Path

Ask via the **AskUserQuestion** tool (single-select, header "Theme folder") Does the theme folder already exist?:
- **Yes — provide the existing path** — the folder already exists; I'll give you the path
- **No — create it** — create it at `wp-content/themes/hello-elementor-<slug>/`
- **You decide** — I detect whether the folder exists and proceed accordingly (create if absent, never overwrite existing files)

Record the choice and continue. If the user chose "Yes — provide the existing path", ask for the path as free-form text, then use it as `THEME_PATH`. If "No — create it", set `THEME_PATH = wp-content/themes/hello-elementor-<slug>/`.

---

## Step 4 — Run the scaffolder script

The theme boilerplate and conventions reference are **fixed templates with five substitutions** (`<slug>`, `<ProjectName>`, `<SLUG>`, `<SlugTitle>`, `<THEME_PATH>`), so file creation is delegated to a script — retyping ~540 lines as a model wastes tokens and invites drift between projects. Run (Bash, single command):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold-elementor-theme.mjs" --name "<ProjectName>" --slug <slug> --theme-path "<THEME_PATH>"
```

The script creates (skipping — never overwriting — any file that already exists):
- `style.css` — child-theme header (Template: hello-elementor, Text Domain: `hello-elementor-<slug>`)
- `functions.php` — enqueues parent style + `design-system.css` + `general.css` versioned by `<SLUG>_CHILD_VERSION`; boots the Elementor manager on `elementor/init`
- `inc/elementor/class-<slug>-elementor.php` — singleton widget manager with a `$map` of widget-slug → class registrations and a `widgets.css` enqueue
- `inc/elementor/class-skeleton-widget-base.php` — abstract widget base: `<slug>` category, `register_section_spacing()` (responsive padding via CSS custom properties on `{{WRAPPER}}`), `url_attrs()` helper
- `assets/css/design-system.css` — the token scaffold (`--<slug>-*` colors, typography, layout, motion; gutter steps down across breakpoints)
- `assets/css/general.css` — `.container` utility scoped to `:where(.<slug>-chrome, .<slug>-homepage)`
- `wpml-config.xml` — commented widget-translation skeleton
- `assets/js/.gitkeep`, `inc/elementor/widgets/.gitkeep`
- `.twt-artifacts/elementor-theme/conventions.md` — the full project reference downstream `/twt-elementor-*` skills load (scoping patterns, widget rules + skeleton, empty-state guard patterns, section spacing, cache-bust workflow, reveal system, token list, responsive tiers, WPML block)

It prints a JSON summary: `theme_path`, `slug`, `created[]`, `skipped[]`, `conventions_path`. If files were **skipped** because they already existed, that is expected on a re-run — tell the user which ones; pass `--force` only with explicit user consent to overwrite.

**If the script is unavailable** (plugin root or Node missing), stop with a clear message — this skill requires the bundled tools; do not hand-write the theme files from memory.

---

## Step 5 — Final Checks

Run PHP syntax checks on all created PHP files:

```bash
php -l <THEME_PATH>/functions.php
php -l <THEME_PATH>/inc/elementor/class-<slug>-elementor.php
php -l <THEME_PATH>/inc/elementor/class-skeleton-widget-base.php
```

Fix any errors before reporting done. If `php` is not installed locally, note that lint was skipped and move on.

---

## Step 6 — Completion

Print the status table with actual resolved values:

```
╔══════════════════════════════════════════════════════════╗
║  ✓ Theme setup complete                                 ║
╠════════════════════════════════╦═════════════════════════╣
║  Item                          ║  Status                 ║
╠════════════════════════════════╬═════════════════════════╣
║  Theme folder                  ║  ✓ Created / Existing   ║
║  style.css + functions.php     ║  ✓ Created              ║
║  Elementor integration         ║  ✓ Created              ║
║  Widget base class             ║  ✓ Created              ║
║  Design system CSS             ║  ✓ Created              ║
║  General CSS                   ║  ✓ Created              ║
║  WPML config                   ║  ✓ Created              ║
║  Conventions reference         ║  ✓ Created              ║
╚════════════════════════════════╩═════════════════════════╝

Theme: <THEME_PATH>
Slug:  <slug>
```

Then print:

```
To activate the theme in WordPress:

  Appearance → Themes → "Hello Elementor <ProjectName>" → Activate

Via WP-CLI:
  wp theme activate hello-elementor-<slug>

Next steps:
  • Update token values in assets/css/design-system.css after design handoff
  • Use /twt-elementor-block-creator to scaffold widgets
```
