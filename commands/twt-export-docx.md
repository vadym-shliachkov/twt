---
name: twt-export-docx
category: export
description: (v1.1.1) Convert Markdown to a polished DOCX with the shared document template
version: 1.1.1
accepts_arguments: true
inputs:
  - Markdown file path
dependencies:
  hard: []
  soft: []
reads:
  - <markdown-path>
  - tools/export-document.mjs
  - templates/document-export-style.md
  - .twt-artifacts/export/themes/*/theme.json
  - templates/themes/doc-hub-light/theme.json
writes:
  - .twt-artifacts/export/docx/<source-slug>/<source-slug>.docx
  - .twt-artifacts/export/docx/<source-slug>/render-notes.md
---

# /twt-export-docx

## Intent

**Purpose:** Convert a Markdown document into a polished DOCX using the marketplace's deterministic export script and default document export style. The skill is intentionally thin so conversion, heading checks, render notes, and Pandoc invocation happen in code instead of model reasoning.

**Non-goals:**
- Doesn't create PDF files; use `/twt-export-pdf` for PDF output
- Doesn't rewrite the source Markdown unless the user explicitly asks
- Doesn't invent missing content, images, citations, or brand styling
- Doesn't manually reproduce conversion logic from `tools/export-document.mjs`

**Success criteria:**
- Delegates conversion to `node "${CLAUDE_PLUGIN_ROOT}/tools/export-document.mjs" --format docx --input <markdown-path>`
- Offers a theme choice when custom themes exist
- Produces `.twt-artifacts/export/docx/<source-slug>/<source-slug>.docx`
- Writes `.twt-artifacts/export/docx/<source-slug>/render-notes.md` with heading nesting warnings, conversion warnings, theme used, and output path
- Themed via the built-in `doc-hub-light` theme's `reference.docx` by default (Montserrat headings, Inter body, hairline tables); custom themes provide their own themed `reference.docx` when built
- Theme reference.docx gives global typography/colors; doc-type components are HTML/PDF-only — DOCX has no intermediate HTML

---

## Step 1 — Resolve input

Use `$ARGUMENTS` as the Markdown path when present. If missing, ask the user: "Provide the Markdown file path to export as DOCX." Wait.

The source must be a local `.md` or `.markdown` file. If the input is a URL, PDF, DOCX, or folder, stop and ask the user to provide a Markdown file first.

If the user wants to overwrite an existing export, pass `--force` through to the script.

Resolve theme choice:
- If `$ARGUMENTS` includes `--theme <slug-or-path>`, pass it through unchanged.
- If `$ARGUMENTS` includes legacy `--template <path>`, pass it through; the script maps theme dirs to `--theme` and ignores prose template.md files with a warning in render-notes.
- Discover custom themes by reading `.twt-artifacts/export/themes/*/theme.json`.
- Applicable themes are `type: document` or `type: universal` (for presentations: `type: presentation` or `universal`).
- If no custom themes exist, use the built-in `doc-hub-light` theme (no flag needed).
- If custom themes exist, use the **AskUserQuestion** tool with header "Theme" and single-select options:
  - **Built-in doc-hub-light** — house style: quiet editorial, tri-color accent
  - One option per custom theme, labeled with its `name`, `type`, and `description`
  - **You decide** — Pick the most specific applicable custom theme; if unclear, pick built-in

## Step 2 — Run the export script

Run from the repository or project root that contains `tools/export-document.mjs`:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-document.mjs" --format docx --input "<markdown-path>" --theme "<theme-ref>"
```

If `--force` was requested:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-document.mjs" --format docx --input "<markdown-path>" --theme "<theme-ref>" --force
```

The script handles slugging, output folders, heading nesting checks, temporary normalized export copies, Pandoc invocation, output verification, and `render-notes.md`.

If the script is missing, stop with: "Export helper missing — run this from the marketplace checkout or install/copy `tools/export-document.mjs` and `templates/document-export-style.md`."

## Step 3 — Read render notes

Read `.twt-artifacts/export/docx/<source-slug>/render-notes.md` after the script finishes. Use it as the source of truth for:

- DOCX path or failure
- theme used (slug + source) and doc type detected → profile
- font source (bundled vs system stacks)
- heading nesting warnings
- temporary export-copy adjustments
- conversion tool used
- missing Pandoc or conversion errors
- confirmation that the source file was not edited

## Step 4 — Report

Tell the user:

- DOCX path
- Theme used (built-in `doc-hub-light` or custom slug)
- That the theme's reference.docx supplies global typography/colors (doc-type components are HTML/PDF-only)
- Any heading nesting warnings
- Any conversion limitations
- Whether the DOCX was successfully produced
