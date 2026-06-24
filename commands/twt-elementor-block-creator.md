---
name: twt-elementor-block-creator
category: elementor
description: (v1.2.2) Build an Elementor widget or full-page template following project conventions
version: 1.2.2
accepts_arguments: true
inputs:
  - widget description or page description
  - optional Figma URL
  - optional screenshots, staging URLs, or notes
dependencies:
  hard:
    - twt-elementor-theme-creator
  soft:
    - twt-design-system-define
    - figma-mcp
reads:
  - .twt-artifacts/elementor-theme/conventions.md
  - <THEME>/inc/elementor/widgets/
  - <THEME>/assets/css/design-system.css
  - <THEME>/assets/css/widgets.css
  - <THEME>/inc/elementor/class-<slug>-elementor.php
  - .twt-artifacts/design/design-system/tokens.md
writes:
  - <THEME>/inc/elementor/widgets/class-<slug>-<widget>.php
  - <THEME>/inc/elementor/class-<slug>-elementor.php
  - <THEME>/assets/css/widgets.css
  - <THEME>/assets/css/design-system.css
  - <THEME>/assets/js/<widget>.js
  - <THEME>/wpml-config.xml
  - <THEME>/import/<page-slug>/import.json
  - <THEME>/import/<page-slug>/assets/
---

# /twt-elementor-block-creator

## Intent

**Purpose:** Build an Elementor widget or full-page template that follows the project's existing theme architecture (read from `conventions.md`). Applies reuse-first strategy: reuse existing widgets where possible, extend if close, create new only when nothing fits.

**Non-goals:**
- Doesn't scaffold the theme itself (requires `/twt-elementor-theme-creator` to have run first)
- Doesn't rewrite existing widgets without explicit user confirmation
- Doesn't rename or revalue existing CSS custom properties — only appends missing tokens

**Success criteria:**
- New widget(s) registered in `class-<slug>-elementor.php` `$map`
- Widget CSS appended in delimited block to `widgets.css`
- New tokens (if any) appended to `design-system.css` without overwriting existing ones
- WPML config updated when translatable fields are added
- For page builds: `import.json` produced with referenced assets in the same folder
- Reuse decisions stated explicitly in the run report

---

Arguments passed to this command: $ARGUMENTS

If `$ARGUMENTS` contains a description of what to build, use it as the starting context and skip or pre-fill questions where possible.

---

## Overview

This skill:
1. Verifies the project theme is set up
2. Reads your project conventions (slug, CSS rules, widget skeleton)
3. Accepts design input (Figma, screenshots, staging URLs, notes)
4. Analyzes existing widgets before creating anything new
5. Builds widget PHP + CSS + optional JS + WPML — or a full page with an Elementor import file

**Reuse first. Create new only when needed.**

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Introduction

Print on start:

```
╔══════════════════════════════════════════════════════════╗
║  TWT — Elementor Block Creator                          ║
╠══════════════════════════════════════════════════════════╣
║  Builds Elementor widgets or full-page templates        ║
║  that follow your existing project architecture.        ║
║                                                         ║
║  Before building, this skill will:                      ║
║    • Verify project theme setup                         ║
║    • Read your project conventions                      ║
║    • Analyze existing widgets for reuse opportunities   ║
║    • Accept design input (Figma, screenshots, notes)    ║
║                                                         ║
║  All output follows project CSS scoping rules,          ║
║  widget naming conventions, and design tokens.          ║
╚══════════════════════════════════════════════════════════╝
```

---

## Step 2 — Verify Project Setup

Check if `.twt-artifacts/elementor-theme/conventions.md` exists.

**If missing**, print:

```
⚠ No conventions file found.

The project theme must be set up before building widgets or pages.
Run /twt-elementor-theme-creator first, then return here.
```

Stop. Do not continue.

---

## Step 3 — Load Conventions

Read `.twt-artifacts/elementor-theme/conventions.md` in full.

Extract and hold in memory for the entire session:
- `Project slug` → `<slug>`
- `Project name` → `<ProjectName>`
- `Theme path` → `<THEME_PATH>`
- CSS scoping rules and responsive tiers
- Widget naming convention and admin title format
- Widget skeleton (PHP pattern)
- Empty-state patterns per control type
- Spacing pattern (longhand CSS vars)

Do not proceed until fully read.

---

## Step 4 — Design Source

Ask via the **AskUserQuestion** tool (single-select, header "Figma design?") Is there a Figma design for this block or page?:
- **Yes — I have a Figma URL** — I'll provide a Figma URL
- **No — describe it** — I'll describe it or provide other references
- **You decide** — proceed without Figma (build from the description/references and the existing design system)

Record the choice and continue.

**If Yes:**

Check whether Figma MCP tools are available in your current tool set (look for tools prefixed with `mcp__plugin_figma_figma__`).

- **Available:** Load the `figma:figma-use` skill. Ask for the Figma URL. Read the design context using `get_design_context` or `get_screenshot`. Figma is the authoritative source — it overrides all other references for visual decisions.
- **Not available:** Print:
  ```
  Figma MCP is not installed.

  Options:
  1. Install it — restart Claude Code, then run this command again
  2. Continue without Figma — describe the design or provide screenshots
  ```
  Wait for choice. If they choose 2, continue to Step 5.

---

## Step 4b — Design System Source (only if Figma was provided)

Immediately after the Figma URL is captured, ask via the **AskUserQuestion** tool (single-select, header "Token source") Where should design tokens (colors, typography, spacing) come from?:
- **Use existing project design system** — recommended; preserves consistency across the site
- **Provide a separate Figma URL** — I'll supply a separate Figma URL for the design system
- **Create from this Figma design** — derive the design system from the Figma design provided above
- **You decide** — I pick the safest fit (defaults to using the existing project design system)

Record the choice as `<design_system_source>` and continue. If the user chose "Provide a separate Figma URL", ask for that URL as free-form text and capture it as `<design_system_figma_url>`. These values are consumed by Step 8, which delegates the work to `/twt-design-system-define`.

**Priority rule — applies regardless of the choice:**

> The existing project design system always wins. Consistency across the site is more important than matching one new design perfectly. Tokens are **extended, never replaced.** New tokens are added only when the component being built genuinely cannot be expressed with what already exists.

If Figma was **not** provided, skip this step entirely and proceed to Step 5.

---

## Step 5 — Reference Assets

Ask via the **AskUserQuestion** tool (single-select, header "References?") Do you have any reference files or URLs (screenshots, PDFs, staging site URLs, design inspiration)?:
- **Yes — provide path or URL** — I have references to share
- **No — skip** — no additional references
- **You decide** — proceed without extra references

Record the choice and continue. If the user chose "Yes — provide path or URL", ask for the path or URL as free-form text, then load it using Read (for local files/images) or WebFetch (for URLs). Accept multiple references — ask again after each until they choose No.

---

## Step 6 — Notes

Ask via the **AskUserQuestion** tool (single-select, header "Notes?") Any notes before building (animation style, mobile priorities, content restrictions, reuse requests)?:
- **Enter notes** — I have notes to add before building
- **Start building** — no notes; proceed to build
- **You decide** — proceed to build with sensible defaults

Record the choice and continue. If the user chose "Enter notes", ask for the notes as free-form text.

---

## Step 7 — Project Analysis

Analyze the existing project before writing any code:

1. List all files in `<THEME_PATH>/inc/elementor/widgets/`
2. Read each widget PHP to understand what it renders and what controls it exposes
3. Read `<THEME_PATH>/assets/css/design-system.css` for the current token set
4. Read `<THEME_PATH>/assets/css/widgets.css` if it exists
5. Check the `$map` array in `<THEME_PATH>/inc/elementor/class-<slug>-elementor.php`

**Determine intent** from the user's request, `$ARGUMENTS`, Figma, and references:
- **Single widget** — a self-contained, reusable component
- **Full page** — a layout composed of multiple sections

Print a brief analysis:

```
Analysis:
  Existing widgets : <count> found
  Widget list      : <widget1>, <widget2>, …
  Building         : [Single widget / Full page — <page name>]
  Reuse candidates : <widget> (for <section>), …
```

---

## Step 8 — Design System Sync

This step delegates all token analysis to the dedicated designer skill, then mirrors the result into the theme's CSS.

### 8.1 — Decide whether to invoke the designer subagent

Skip the subagent and go straight to 8.3 when **all** of the following are true:
- No Figma was provided in Step 4, **or** `<design_system_source>` = Option 1 (use existing)
- `<THEME_PATH>/assets/css/design-system.css` already contains real project tokens (not just theme-creator scaffolding)
- The component being built can be expressed entirely with tokens already present

Otherwise dispatch the subagent in 8.2.

### 8.2 — Dispatch `/twt-design-system-define` as a subagent

Use the Agent tool (`subagent_type: general-purpose`) to run `/twt-design-system-define`. The subagent owns the analysis and writes `.twt-artifacts/design/design-system/tokens.md`. This skill does not duplicate that work.

Build the subagent prompt from the Step 4b choice:

| `<design_system_source>` | Subagent inputs |
|--------------------------|-----------------|
| **Option 2** — separate Figma | Mode 6 (full architecture). Pass `<design_system_figma_url>` as the only Figma source. |
| **Option 3** — from the design captured in Step 4 | Mode 6 (full architecture). Pass the Step 4 Figma URL as the only Figma source. |
| **Option 1** but tokens are scaffolding defaults | Mode 5 (tokens only). Pass any references collected in Step 5 plus the existing `design-system.css` so it reconciles. |

Always include in the prompt:
- Path to the existing theme CSS: `<THEME_PATH>/assets/css/design-system.css`
- The project slug `<slug>` so token names stay namespace-consistent
- An explicit instruction: *"The existing project design system is the priority baseline. Use Update mode when tokens.md already exists. Do not regenerate. Never replace existing token values."*

Wait for the subagent to finish. When it returns, verify that `.twt-artifacts/design/design-system/tokens.md` exists and has been updated. If the subagent reports no changes, continue to 8.3 unchanged.

### 8.3 — Mirror tokens.md into `design-system.css`

Read `.twt-artifacts/design/design-system/tokens.md` (if it exists) and `<THEME_PATH>/assets/css/design-system.css`.

Reconciliation rules — apply in this order:

1. **Existing CSS variables win.** Every `--<slug>-…` custom property already in `design-system.css` keeps its name and value. Do not rename or revalue.
2. **Add only the missing tokens.** For each token in `tokens.md` that has no equivalent CSS variable, append a new `--<slug>-<token-name>` declaration to `design-system.css` under the matching section comment.
3. **Naming bridge.** Map the subagent's naming (`color-primary`, `radius-card`, `space-4`, …) to the theme's `--<slug>-…` namespace. Record the mapping inline as a one-line comment above each newly added variable: `/* from tokens.md: color-primary */`.
4. **Section grouping.** Keep `design-system.css` organized by section (Colors / Typography / Spacing / Radius / Shadows / Motion / Grid). If a section does not exist yet, create it with a `/* ─── <Section> ─────────────── */` header before appending.
5. **No raw literals downstream.** The widget CSS in Step 10 must reference these CSS variables. If a value the component needs still isn't in `design-system.css` after this sync, add it here before writing widget CSS — never inline a hex/px/font literal in widgets.

### 8.4 — Verify and continue

Before moving on, confirm:
- `tokens.md` and `design-system.css` agree on every token the new component will use
- No existing CSS variable was renamed, removed, or revalued
- Section comments in `design-system.css` are intact

If anything looks off, stop and surface the diff to the user rather than guessing.

**Rule: Never write hex literals, raw font stacks, or raw pixel values in widget CSS.** Tokens live in `design-system.css`; widgets only reference them via `var(--<slug>-…)`.

---

## Step 9 — Reuse Strategy

Apply this priority order and state your decision:

1. **Reuse as-is** — existing widget already does the job. Tell the user which widget to use; no code changes needed.
2. **Extend** — existing widget is close. Add controls to its `register_controls()` and update `render()` without breaking existing uses.
3. **Create new** — no existing widget fits the purpose.

Print:

```
Strategy: [Reusing <slug>_<widget> / Extending <slug>_<widget> / Creating new: <widget-title>]
```

---

## Step 10 — Build

### Building a Widget

Create or modify the following for each widget:

---

#### PHP: `<THEME_PATH>/inc/elementor/widgets/class-<slug>-<widget-slug>.php`

Use the widget skeleton from conventions exactly:

```php
<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class Skeleton_Widget_<WidgetName> extends Skeleton_Widget_Base {
    public function get_name()  { return '<slug>_<widget-slug>'; }
    public function get_title() { return __( '[<ABBR>] – <Block Purpose> – <Variation>', 'hello-elementor-<slug>' ); }
    public function get_icon()  { return 'eicon-<icon>'; }

    protected function register_controls() {
        // ... sections and controls ...
        $this->register_section_spacing(); // always last
    }

    protected function render() {
        $s = $this->get_settings_for_display();
        // read each setting into a trimmed local
        // guard every output block
        // return; early if nothing to render
    }
}
```

**Admin title format** — use `[ABBR]` (the project name abbreviation, e.g. `[PI]`), not the raw slug:
```
[PI] – Hero Banner – Split
[PI] – Testimonials – Carousel
[PI] – CTA Banner – Inline
```

**Controls discipline:**
- No `'default'` on TEXT, TEXTAREA, or MEDIA controls
- No seed items in REPEATER controls
- Semantic-state defaults only: switcher (`'yes'`/`''`), SELECT keys, NUMBER values needed by logic

**Render discipline:**
- Read every setting: `$val = isset($s['key']) ? trim((string)$s['key']) : '';`
- Guard every output block: `if ( '' !== $val ) : … endif;`
- Return early if the widget has nothing to render
- Use `$this->url_attrs( $s['key'] ?? [] )` for URL controls

---

#### CSS: append to `<THEME_PATH>/assets/css/widgets.css`

Add a delimited block for the new widget:

```css
/* ─── Widget: <widget-slug> ─────────────────────────────── */

:where(.<slug>-chrome, .<slug>-homepage) .<widget-slug> {
    padding-top:    var(--<slug>-pad-top,    64px);
    padding-right:  var(--<slug>-pad-right,  0);
    padding-bottom: var(--<slug>-pad-bottom, 64px);
    padding-left:   var(--<slug>-pad-left,   0);
    /* component styles using design tokens only */
}

@media (max-width: 960px) {
    :where(.<slug>-chrome, .<slug>-homepage) .<widget-slug> {
        padding-top:    var(--<slug>-pad-top,    36px);
        padding-bottom: var(--<slug>-pad-bottom, 36px);
    }
}

@media (max-width: 720px) {
    :where(.<slug>-chrome, .<slug>-homepage) .<widget-slug> {
        padding-top:    var(--<slug>-pad-top,    24px);
        padding-bottom: var(--<slug>-pad-bottom, 24px);
    }
}
```

CSS rules:
- `:where(.<slug>-chrome, .<slug>-homepage)` scope on every selector
- Longhand padding with CSS variable pattern (never `padding:` shorthand)
- Design tokens only — no hex literals
- Mirror responsive tiers from conventions: 960 / 720 / 600 / 480

If `widgets.css` does not exist, create it with this header first:

```css
/**
 * Widgets — <ProjectName>
 * Widget-specific styles, enqueued by the Elementor manager in Elementor context.
 * Each widget's block is separated by a comment line.
 */
```

---

#### JS (only when needed): `<THEME_PATH>/assets/js/<widget-slug>.js`

Create only when the widget requires client-side behaviour (slider, counter animation, accordion, etc.). Enqueue it by adding a `wp_enqueue_script` call to the Elementor manager.

---

#### WPML: add block to `<THEME_PATH>/wpml-config.xml`

Insert inside `<elementor-widgets>` for every control that holds user-facing text:

```xml
<widget id="<slug>_<widget-slug>">
    <key name="eyebrow"/>
    <key name="title"/>
    <key name="cta_label"/>
    <key name="items">
        <key name="title"/>
        <key name="excerpt"/>
    </key>
</widget>
```

Include only controls that actually exist in this widget's `register_controls()`.

---

#### Register: add to `$map` in `<THEME_PATH>/inc/elementor/class-<slug>-elementor.php`

```php
'<widget-slug>' => 'Skeleton_Widget_<WidgetName>',
```

---

#### Cache bust after all files are written

Run PHP lint on every modified file, then bump the version constant and CSS header:

```bash
php -l <THEME_PATH>/functions.php
php -l <THEME_PATH>/inc/elementor/widgets/class-<slug>-<widget-slug>.php
wp cache flush
wp elementor flush_css
```

---

### Building a Page

A page build creates an Elementor import file, building new widgets only for sections that can't use existing ones.

#### Phase 1 — Layout plan

Analyse sections needed for the page. For each, determine the widget and its status:

```
Page layout plan:
┌──────────────────────┬──────────────────────────┬──────────┐
│ Section              │ Widget                   │ Status   │
├──────────────────────┼──────────────────────────┼──────────┤
│ Hero                 │ <slug>_hero              │ REUSE    │
│ Feature Grid         │ <slug>_feature_grid      │ NEW      │
│ Testimonials         │ <slug>_testimonials      │ EXTEND   │
│ CTA                  │ <slug>_cta_banner        │ REUSE    │
└──────────────────────┴──────────────────────────┴──────────┘
```

Confirm the plan with the user before building.

#### Phase 2 — Build NEW and EXTENDED widgets

Follow the widget build process above for each `NEW` or `EXTEND` widget.

- **Use transformed copy, never raw source.** Populate widget content from the curation outline's drafted on-brand copy, not verbatim fetched source. No invention; mark gaps rather than mirroring the original wording.
- **Assets from the manifest.** For images/videos, use the exact `filename` and `alt` from `.twt-artifacts/design/assets/manifest.md`; reference the correct path even when the file isn't supplied yet — never invent a different filename.

#### Phase 3 — Generate Elementor import file

Create `<THEME_PATH>/import/<page-slug>/import.json`.

If `<THEME_PATH>/import/` does not exist, create it.

Use this Elementor 3.x container-layout template structure:

```json
{
  "version": "0.4",
  "title": "<Page Title>",
  "type": "page",
  "content": [
    {
      "id": "<8-char-hex>",
      "elType": "container",
      "settings": {
        "content_width": "full",
        "flex_direction": "column",
        "padding": { "unit": "px", "top": "0", "right": "0", "bottom": "0", "left": "0", "isLinked": true }
      },
      "elements": [
        {
          "id": "<8-char-hex>",
          "elType": "widget",
          "widgetType": "<slug>_<widget-slug>",
          "settings": {}
        }
      ],
      "isInner": false
    }
  ],
  "page_settings": {}
}
```

Import JSON rules:
- Generate unique 8-character lowercase hex IDs for every `id` field (e.g. `a1b2c3d4`)
- One top-level container per page section
- `widgetType` must match the widget's `get_name()` return value exactly
- Leave `settings: {}` empty — admin fills content in Elementor
- Multiple widgets in a section go as additional elements inside the same container

Copy any local image or asset files referenced in the design to:
`<THEME_PATH>/import/<page-slug>/assets/`

---

## Step 10b — Parallel-promotion mode

When an orchestrator (e.g. `/twt-develop`) dispatches you as one of a **parallel batch** of pages and its prompt says *"parallel mode — return deltas, don't write shared files"*:

- **Write only your own page's** `<THEME_PATH>/import/<page-slug>/import.json` (+ its `assets/`). Do **not** append to `widgets.css`/`design-system.css`, edit the `$map` in `class-<slug>-elementor.php`, or touch `wpml-config.xml` — those are shared registries and would race with sibling agents. (You may still create a new widget's own PHP file at its unique path, since that path is disjoint — but return its registration rather than editing the shared `$map` yourself.)
- **Return shared-file deltas in your report instead:** new widget PHP file paths + their `widgets.css` blocks, new tokens for `design-system.css`, the `$map` registration lines, and WPML entries. Reuse-first still applies — reuse the widgets the foundation pass already registered and only return deltas for genuinely new widgets.

The orchestrator merges and de-duplicates the deltas, registers each new widget once in `$map`, updates `wpml-config.xml`, then runs PHP lint + cache bust across all changes.

## Step 11 — Completion

### Widget build completion

Print:

```
╔══════════════════════════════════════════════════════════╗
║  ✓ Widget ready                                         ║
╠════════════════════╦═════════════════════════════════════╣
║  Item              ║  Status                            ║
╠════════════════════╬═════════════════════════════════════╣
║  Widget PHP        ║  ✓ Created / Extended              ║
║  Widget CSS        ║  ✓ Added to widgets.css            ║
║  WPML config       ║  ✓ Updated                         ║
║  Registration      ║  ✓ Added to $map                   ║
╚════════════════════╩═════════════════════════════════════╝

Widget ID: <slug>_<widget-slug>
Admin name: [<ABBR>] – <Block Purpose> – <Variation>
```

Then explain how to use it:

```
To use this widget in Elementor:

1. Open any page in Elementor editor
2. Search the widget panel (left sidebar) for: "<ABBR>" or the widget title
3. Drag it onto the canvas
4. Fill in the controls — no demo content is pre-filled

The widget appears under the "<ProjectName>" category.
```

---

### Page build completion

Print the section table with actual values:

```
╔══════════════════════════════════════════════════════════════════╗
║  ✓ Page ready                                                   ║
╠══════════════════╦════════════════════════╦════════════════════  ╣
║  Section         ║  Widget                ║  Status              ║
╠══════════════════╬════════════════════════╬══════════════════════╣
║  <Section>       ║  <slug>_<widget>       ║  ✓ Reused            ║
║  <Section>       ║  <slug>_<widget>       ║  ✓ Created           ║
║  <Section>       ║  <slug>_<widget>       ║  ✓ Extended          ║
╚══════════════════╩════════════════════════╩══════════════════════╝

Import: <THEME_PATH>/import/<page-slug>/import.json
```

Then explain how to import:

```
To import this page template into Elementor:

1. Go to Templates → Saved Templates in wp-admin
2. Click "Import Templates" (top right corner)
3. Select: <THEME_PATH>/import/<page-slug>/import.json
4. The template appears in your saved templates list
5. Open the target page with Elementor → click the folder icon
6. My Templates → find the template → Insert

To start a new page from this template:
1. Pages → Add New
2. Edit with Elementor → folder icon → My Templates → Insert
```
