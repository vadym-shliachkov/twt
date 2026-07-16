---
name: twt-content-approval-implement
category: content
description: (v1.1.3) Apply ready approved XLSX content into the built site or development artifacts
version: 1.1.3
accepts_arguments: true
inputs:
  - Optional path to content-approval-checklist.xlsx; optional --target html|elementor
dependencies:
  hard:
    - twt-content-approval-checklist
  soft:
    - twt-html-block-creator
    - twt-elementor-block-creator
reads:
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - site/
  - <THEME>/
  - .twt-artifacts/html-site/conventions.md
  - .twt-artifacts/elementor-theme/conventions.md
writes:
  - site/
  - <THEME>/
  - .twt-artifacts/content-approval/content-approval-implementation-report.md
---

# /twt-content-approval-implement

## Intent

**Purpose:** Read the content approval workbook after stakeholder confirmation and update the corresponding site blocks/pages with only the rows whose `approved content` is filled and `ready to implement (true, false)` is `true`. This is intentionally called later, after Development has already built pages/templates with the content available at build time.

**Non-goals:**
- Does not implement unapproved or not-ready rows.
- Does not guess where ambiguous approved content belongs; ambiguous rows are reported and skipped.
- Does not create the approval workbook; use `/twt-content-approval-checklist` first.

**Success criteria:**
- Approved ready rows from the workbook are applied to the corresponding blocks/pages, shared header/footer, media fields, links, video embeds, and SEO metadata.
- Rows not marked ready remain untouched and are listed in the implementation report.
- `.twt-artifacts/content-approval/content-approval-implementation-report.md` records applied, skipped, missing, and ambiguous items with worksheet/page context.

---

Arguments passed to this command: $ARGUMENTS

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 - Check workbook dependency

Verify `openpyxl` is available before reading the XLSX:

```powershell
python -c "import openpyxl"
```

If that fails, install and re-check:

```powershell
python -m pip install openpyxl
python -c "import openpyxl"
```

On Windows where `python` is unavailable but `py` exists, use `py -m pip install openpyxl`. If installation fails, stop and report the exact install command the user must run.

## Step 2 - Locate workbook and target

Use the workbook path from `$ARGUMENTS` if supplied; otherwise use `.twt-artifacts/content-approval/content-approval-checklist.xlsx`. Abort if it does not exist.

Parse `--target html|elementor` from `$ARGUMENTS`. If absent, infer:
- `html` when `site/` or `.twt-artifacts/html-site/conventions.md` exists.
- `elementor` when `.twt-artifacts/elementor-theme/conventions.md` or a likely theme folder exists.
- If both exist or neither exists, ask via AskUserQuestion with `Static HTML`, `Elementor`, and `You decide`.

Read the target conventions before editing target files.

## Step 3 - Parse approved rows

For every worksheet, read only the exact columns:
`Block name`, `field type`, `current content`, `recommended content`, `approved content`, `ready to implement (true, false)`.

A row with a blank `field type` is a section banner or a spacer (the checklist lays each block out as a labeled section) — skip these silently: do not count or report them.

Normalize readiness leniently: `true`, `yes`, `1`, and boolean TRUE mean ready; everything else means not ready. A row is implementable only when ready is true and approved content is not blank.

Classify each implementable row by `field type` prefix:
- `text:*` for visible copy and microcopy.
- `link:*` for hrefs, labels, phone/mail/social links, and downloads.
- `image:*` for image source/path/URL, alt text, captions, and thumbnails.
- `video:*` for video URL, embed code, poster/thumbnail, transcript, and captions.
- `file:*` for document/download references.
- `form:*` for labels, placeholders, help text, consent text, and validation messages.
- `seo:*` for slug, page title, keywords, meta title, meta description, schema, canonical, and open graph.

Skip and report rows that are not ready, have blank approved content, use an unknown field prefix, or have duplicate conflicting approved content for the same page/block/field.

## Step 4 - Map workbook rows to site structure

Use worksheet name as the page key, **except** the two dedicated `Shared header` and `Shared footer` worksheets, which map to the global header/footer partials rather than a page. Map page rows by the combination of page, block name, and field type. Prefer exact stable identifiers already present in page layouts, mockups, generated HTML comments, Elementor widget names, component names, or SEO metadata keys.

The `Shared header` and `Shared footer` worksheets are the single source for global header/footer content — page worksheets no longer carry header/footer rows. For their rows:
- Apply the same approved value to the reusable partial/template/widget if one exists.
- If no shared partial exists, apply to every page that contains the matching header/footer value.
- A row whose `Block name` marks a page-specific variant (for example `Header — checkout (no nav)`) applies only to the named page(s); apply the base rows everywhere else.

For media:
- Update `src`, `href`, embed URL/code, poster, thumbnail, alt, caption, and transcript/caption notes where matching fields exist.
- Do not download external media unless the user explicitly asks. Use the approved URL/path as the reference.
- If a local approved path points to a missing file, still write the intended reference only when the target project convention allows pending assets; otherwise skip and report.

For SEO:
- HTML target: update page filename/slug only when the target convention supports it; otherwise update `<title>`, meta tags, canonical/open-graph tags, and JSON-LD in the page head.
- Elementor target: update generated import/template metadata or the theme's SEO handoff artifact when direct WordPress database edits are not available. Never claim WordPress admin data was updated unless the tool actually updated it.

## Step 5 - Apply edits safely

Before editing, inspect the relevant target files and preserve user changes. Do not replace broad chunks when a smaller targeted edit is possible.

Implementation rules:
- Apply only implementable rows.
- Preserve formatting, component structure, CSS classes, data attributes, and accessibility attributes.
- Keep approved content verbatim except for required HTML escaping.
- For schema JSON, parse and emit valid JSON when possible instead of string-splicing.
- If a value cannot be mapped with confidence, skip it and record why.

When the workbook changes many pages, process one page first, verify the mapping pattern, then apply the same pattern to the remaining pages.

## Step 6 - Verify

Run the cheapest relevant checks available for the target:
- HTML: parse or grep changed pages for approved values, verify key links/assets are present, and run any existing local checks.
- Elementor: verify changed PHP/JSON files still parse where possible and that import files contain approved values.

Do not report success for a row unless the approved value is present in the target file or generated artifact.

## Step 7 - Write the implementation report

Write `.twt-artifacts/content-approval/content-approval-implementation-report.md`:

```markdown
# Content approval implementation report
Generated: <ISO>
Workbook: <path>
Target: <html|elementor>

## Applied
| Page | Block | Field type | Target file | Notes |
|------|-------|------------|-------------|-------|

## Skipped
| Page | Block | Field type | Reason |
|------|-------|------------|--------|

## Conflicts
| Page | Block | Field type | Details |
|------|-------|------------|---------|

## Verification
- <commands/checks run and result>
```

## Step 8 - Report

Tell the user the workbook used, target updated, counts of applied/skipped/conflicting rows, files changed, verification performed, and where the report was written.
