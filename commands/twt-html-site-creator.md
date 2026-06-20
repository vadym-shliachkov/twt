---
name: twt-html-site-creator
category: html
description: Scaffold a dependency-free static HTML/CSS site (partials, mirrored tokens.css, conventions.md)
version: 1.1.1
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
- Doesn't add any build tooling — pure HTML + CSS, no Node/bundler/SSG
- Doesn't overwrite existing files without confirmation

**Success criteria:**
- `site/` exists with `index.html`, `partials/` (header/footer/nav), and `assets/css/{tokens,general,sections}.css`
- `site/assets/css/tokens.css` mirrors `.twt-artifacts/design/design-system/tokens.css` when it exists (else a scaffold marked "replace after design handoff")
- `index.html` links the three CSS files and contains the header/footer inlined between `BEGIN/END partials/...` markers
- `.twt-artifacts/html-site/conventions.md` exists and is readable by `/twt-html-block-creator`

---

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
- **Yes →** read it, extract `Project name`, `Project slug`, `Output root`. Skip to Step 3 (create only missing files; never overwrite without consent).
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

## Step 3 — Token source

Check whether `.twt-artifacts/design/design-system/tokens.css` exists.
- **Exists →** copy it verbatim to `<ROOT>/assets/css/tokens.css` (this is the **mirror** — never edit it in place; re-copy when the spine changes).
- **Missing →** write a `<ROOT>/assets/css/tokens.css` scaffold with a clearly marked header `/* SCAFFOLD — replace by mirroring the design-system tokens.css after design handoff */` and a minimal `:root{}` set (`--color-text`, `--color-surface`, `--color-primary`, `--font-family-base`, `--space-4`, `--container-max`). Tell the user it is a placeholder.

## Step 4 — Create files

Create the following under `<ROOT>`. Substitute `<slug>` and `<ProjectName>` throughout.

### `<ROOT>/partials/nav.html`
```html
<nav class="site-nav" aria-label="Primary">
  <a href="index.html">Home</a>
</nav>
```

### `<ROOT>/partials/header.html`
```html
<header class="site-header">
  <div class="container">
    <a class="site-logo" href="index.html"><ProjectName></a>
    <!-- BEGIN partials/nav.html -->
    <nav class="site-nav" aria-label="Primary">
      <a href="index.html">Home</a>
    </nav>
    <!-- END partials/nav.html -->
  </div>
</header>
```

### `<ROOT>/partials/footer.html`
```html
<footer class="site-footer">
  <div class="container">
    <p>&copy; <ProjectName></p>
  </div>
</footer>
```

### `<ROOT>/assets/css/general.css`
```css
/**
 * General — <ProjectName>
 * Site-wide layout utilities. Token-only — never write hex/px/font literals here.
 */
.<slug>-page { margin: 0; font-family: var(--font-family-base); color: var(--color-text); background: var(--color-surface); }
.<slug>-page .container { max-inline-size: var(--container-max, 1200px); margin-inline: auto; padding-inline: var(--space-4); }
.<slug>-page .site-header .container,
.<slug>-page .site-footer .container { display: flex; align-items: center; justify-content: space-between; }
.<slug>-page .site-nav a { margin-inline-start: var(--space-4); }

@media (max-width: 960px) { .<slug>-page .container { padding-inline: var(--space-4); } }
@media (max-width: 720px) { .<slug>-page .site-header .container { flex-direction: column; align-items: flex-start; } }
@media (max-width: 600px) { .<slug>-page .site-nav a { margin-inline-start: 0; display: inline-block; } }
@media (max-width: 480px) { .<slug>-page .site-nav { display: flex; flex-direction: column; } }
```

### `<ROOT>/assets/css/sections.css`
```css
/**
 * Sections — <ProjectName>
 * Per-section/component styles, appended by /twt-html-block-creator.
 * Each section's block is separated by a comment line. Token-only.
 */
```

### `<ROOT>/index.html`
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><ProjectName></title>
  <link rel="stylesheet" href="assets/css/tokens.css">
  <link rel="stylesheet" href="assets/css/general.css">
  <link rel="stylesheet" href="assets/css/sections.css">
</head>
<body class="<slug>-page">
  <!-- BEGIN partials/header.html -->
  <header class="site-header">
    <div class="container">
      <a class="site-logo" href="index.html"><ProjectName></a>
      <!-- BEGIN partials/nav.html -->
      <nav class="site-nav" aria-label="Primary">
        <a href="index.html">Home</a>
      </nav>
      <!-- END partials/nav.html -->
    </div>
  </header>
  <!-- END partials/header.html -->

  <main>
    <!-- page sections go here -->
  </main>

  <!-- BEGIN partials/footer.html -->
  <footer class="site-footer">
    <div class="container">
      <p>&copy; <ProjectName></p>
    </div>
  </footer>
  <!-- END partials/footer.html -->
</body>
</html>
```

### Empty directories
Create a `.gitkeep` placeholder inside each: `<ROOT>/assets/js/.gitkeep`, `<ROOT>/assets/img/.gitkeep`.

## Step 5 — Create conventions file

Create `.twt-artifacts/html-site/conventions.md` with substitutions applied:

~~~markdown
---
name: html-block-creator
description: Reference for the <ProjectName> static site conventions — partials-inlining rule, scoping, tokens-mirror workflow, responsive tiers. Load whenever working in <ROOT>/.
---

Project name: <ProjectName>
Project slug: <slug>
Output root: <ROOT>

## Partials (single source of truth)

Chrome lives once in `<ROOT>/partials/` (`header.html`, `footer.html`, `nav.html`). Pages do NOT hand-author chrome — the builder **inlines** the partial between marker comments:

```
<!-- BEGIN partials/header.html --> ... inlined copy ... <!-- END partials/header.html -->
```

`nav.html` is inlined into `header.html` between its own `BEGIN/END partials/nav.html` markers; `header.html` (with nav already inlined) is inlined into each page. When a partial changes, the builder **re-inlines** it into every page that contains its markers, so no page drifts. Never edit chrome directly inside a page — edit the partial and re-inline.

## Scoping

- Body carries `class="<slug>-page"`. All site CSS is scoped under `.<slug>-page ...`.
- Never write unscoped global selectors.

## Tokens (mirrored — never re-authored)

- `<ROOT>/assets/css/tokens.css` is a **mirror** of `.twt-artifacts/design/design-system/tokens.css`. Re-copy it when the spine changes; never edit token values in place.
- `general.css` and `sections.css` reference tokens via `var(--...)` only. **No hex/px/font literals.** If a needed token is missing, add it to the design-system spine (`/twt-design-system-define`) and re-mirror — do not inline a literal.

## Responsive tiers

| Range | Use |
|---|---|
| > 960px | Desktop |
| ≤ 960px | Tablet |
| ≤ 720px | Mobile (stacked) |
| ≤ 600px | Narrow |
| ≤ 480px | Small mobile |

Every page is responsive across desktop/tablet/mobile.

## Content

Pages use **real content** (from Phase-1/2 artifacts or the provided design). Lorem/placeholder where real content exists is a build blocker.

## Reuse-first

Before adding a section, reuse an existing section, extend if close, create new only when nothing fits. State the decision in the run report.

## File layout

```
<ROOT>/
  index.html
  <page-slug>.html
  partials/   header.html · footer.html · nav.html
  assets/css/ tokens.css (mirror) · general.css · sections.css
  assets/js/  (only when a section needs behavior)
  assets/img/ (real assets)
```
~~~

## Step 6 — Report

Print a status table with resolved values (`<ROOT>`, `<slug>`), whether `tokens.css` was mirrored or scaffolded, and the next step: "Run /twt-html-block-creator to build pages."
