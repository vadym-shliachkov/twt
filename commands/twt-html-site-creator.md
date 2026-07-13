---
name: twt-html-site-creator
category: html
description: (v1.2.1) Scaffold a dependency-free static HTML/CSS site via the bundled scaffolder (partials, mirrored tokens.css, conventions.md)
version: 1.2.1
accepts_arguments: false
inputs:
  - project name (asked); short slug (auto-derived, user confirms); output root (default ./site)
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/html-site/conventions.md
writes:
  - site/index.html
  - site/partials/header.html
  - site/partials/footer.html
  - site/partials/nav.html
  - site/assets/css/tokens.css
  - site/assets/css/general.css
  - site/assets/css/sections.css
  - site/assets/js/.gitkeep
  - site/assets/img/.gitkeep
  - .twt-artifacts/html-site/conventions.md
---

# /twt-html-site-creator

## Intent

**Purpose:** Scaffold a dependency-free static HTML/CSS site once per project and write the canonical `conventions.md` that `/twt-html-block-creator` loads. Chrome (header/footer/nav) lives once in `partials/`; `tokens.css` is mirrored from the design-system spine. Run once per static-site project.

**Non-goals:**
- Doesn't build pages or sections (that's `/twt-html-block-creator`)
- Doesn't author design tokens (mirrors the design-system spine, or writes a clearly-marked scaffold)
- Doesn't add any build tooling — pure HTML + CSS, no Node/bundler/SSG (the scaffolder script is author-time tooling, not a site dependency)
- Doesn't overwrite existing files without confirmation

**Success criteria:**
- `site/` exists with `index.html`, `partials/` (header/footer/nav), and `assets/css/{tokens,general,sections}.css`
- `site/assets/css/tokens.css` mirrors `.twt-artifacts/design/design-system/tokens.css` when it exists (else a scaffold marked "replace after design handoff")
- `index.html` links the three CSS files and contains the header/footer inlined between `BEGIN/END partials/...` markers
- `.twt-artifacts/html-site/conventions.md` exists and is readable by `/twt-html-block-creator`

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.

## Step 1 — Introduction

Print on start:

```
╔══════════════════════════════════════════════════════════╗
║  TWT — HTML Site Creator                                ║
╠══════════════════════════════════════════════════════════╣
║  Scaffolds a dependency-free static HTML/CSS site:      ║
║    • index.html (header/footer inlined from partials)   ║
║    • partials/ (header · footer · nav — single source)  ║
║    • assets/css (tokens · general · sections)           ║
║    • conventions reference for /twt-html-block-creator  ║
║                                                         ║
║  Pure HTML + CSS. No Node, no build step.               ║
╚══════════════════════════════════════════════════════════╝
```

## Step 2 — Project setup

**Check first:** Does `.twt-artifacts/html-site/conventions.md` exist?
- **Yes →** read it, extract `Project name`, `Project slug`, `Output root`. Skip to Step 3 (the scaffolder creates only missing files; never overwrites without consent).
- **No →** continue.

Ask: **What is the project name?** *(Example: Project Industries)*

Derive a short slug (lowercase, alphanumeric + hyphens, 2–5 chars, initials for multi-word — e.g. "Project Industries" → `pi`). Display:

```
Project slug: <slug>

Used for the page scope class:  .<slug>-page
```

Ask via the **AskUserQuestion** tool (single-select, header "Slug OK?") Is this slug correct?:
- **Looks good** — use this slug as-is
- **Enter a different slug** — I'll provide a different slug
- **You decide** — use the proposed slug as-is

Record the choice and continue. If the user chose "Enter a different slug", ask for their preferred slug as free-form text.

Then ask the output root:

```
Where should the static site be written?
(default: ./site — confirmed per CONVENTIONS §2)
```

Record `<ROOT>` (default `site`). Compute `<ProjectName>`, `<slug>`.

## Step 3 — Run the scaffolder script

The scaffold (partials, CSS files, `index.html`, conventions reference) is a **fixed template with three substitutions** (`<ProjectName>`, `<slug>`, `<ROOT>`), and the tokens decision is a file-existence check — so file creation is delegated to a script. Run (Bash, single command):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/scaffold-html-site.mjs" --name "<ProjectName>" --slug <slug> --root "<ROOT>"
```

The script creates (skipping — never overwriting — any file that already exists):
- `partials/nav.html`, `partials/header.html` (nav inlined between `BEGIN/END partials/nav.html` markers), `partials/footer.html`
- `assets/css/tokens.css` — **mirrored verbatim** from `.twt-artifacts/design/design-system/tokens.css` when it exists, else a scaffold with a `/* SCAFFOLD — replace by mirroring ... */` header and a minimal `:root{}` set (pass `--tokens <path>` to mirror a different source)
- `assets/css/general.css` — token-only site utilities scoped under `.<slug>-page`, with the standard responsive tiers
- `assets/css/sections.css` — empty, appended to by `/twt-html-block-creator`
- `index.html` — links the three CSS files, body class `<slug>-page`, header/footer inlined between `BEGIN/END partials/...` markers
- `assets/js/.gitkeep`, `assets/img/.gitkeep`
- `.twt-artifacts/html-site/conventions.md` — the full reference `/twt-html-block-creator` loads (partials-inlining rule, scoping, tokens-mirror workflow, responsive tiers, real-content and reuse-first rules, file layout)

It prints a JSON summary: `root`, `slug`, `tokens_source` (`mirrored` | `scaffold`), `created[]`, `skipped[]`, `conventions_path`. If `tokens_source` is `scaffold`, tell the user `tokens.css` is a placeholder to replace after design handoff. If files were **skipped** because they already existed, that is expected on a re-run — tell the user which ones; pass `--force` only with explicit user consent to overwrite.

**If the script is unavailable** (plugin root or Node missing), stop with a clear message — this skill requires the bundled tools; do not hand-write the scaffold from memory.

## Step 4 — Report

Print a status table with resolved values (`<ROOT>`, `<slug>`), whether `tokens.css` was mirrored or scaffolded, and the next step: "Run /twt-html-block-creator to build pages."
