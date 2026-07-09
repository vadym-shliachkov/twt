---
name: twt-export-pdf
category: export
description: (v1.1.4) Convert Markdown to a polished PDF with the doc-hub-light theme and doc-type-aware styling
version: 1.1.4
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
  - .twt-artifacts/export/pdf/<source-slug>/<source-slug>.pdf
  - .twt-artifacts/export/pdf/<source-slug>/<source-slug>.html
  - .twt-artifacts/export/pdf/<source-slug>/render-notes.md
---

# /twt-export-pdf

## Intent

**Purpose:** Convert a Markdown document into a polished PDF using the marketplace's deterministic export script and default document export style. The skill is intentionally thin so conversion, heading checks, render notes, and Pandoc invocation happen in code instead of model reasoning.

**Non-goals:**
- Doesn't create DOCX files; use `/twt-export-docx` for Word output
- Doesn't rewrite the source Markdown unless the user explicitly asks
- Doesn't invent missing content, images, citations, or brand styling
- Doesn't manually reproduce conversion logic from `tools/export-document.mjs`

**Success criteria:**
- Delegates conversion to `node "${CLAUDE_PLUGIN_ROOT}/tools/export-document.mjs" --format pdf --input <markdown-path>`
- Offers a theme choice when custom themes exist
- Produces `.twt-artifacts/export/pdf/<source-slug>/<source-slug>.pdf`
- Writes `.twt-artifacts/export/pdf/<source-slug>/render-notes.md` with heading nesting warnings, conversion warnings, theme used, doc-type profile applied, and output path
- Themed via the built-in `doc-hub-light` theme by default (css layers + bundled fonts), rendered via Chromium when the `playwright` npm package is installed; otherwise falls back to pandoc LaTeX (noted in render-notes)
- Doc-type profile (report/brief/spec/generic) is detected and applied automatically: structural transforms (labeled field cards, kv grids, score/severity chips, finding cards), a per-profile CSS layer (`css/profiles/<profile>.css`), an optional per-doc-type CSS layer (`css/doctypes/<docType>.css`), a doc-type + date meta line under the title, and a running page footer (doc label · page x / y) in the Chromium PDF
- Intermediate HTML is always saved alongside the PDF at `.twt-artifacts/export/pdf/<source-slug>/<source-slug>.html`

---

## Step 1 — Resolve input

Use `$ARGUMENTS` as the Markdown path when present. If missing, ask the user: "Provide the Markdown file path to export as PDF." Wait.

The source must be a local `.md` or `.markdown` file. If the input is a URL, PDF, DOCX, or folder, stop and ask the user to provide a Markdown file first.

If the user wants to overwrite an existing export, pass `--force` through to the script.

Resolve theme choice:
- If `$ARGUMENTS` includes `--theme <slug-or-path>`, pass it through unchanged.
- If `$ARGUMENTS` includes legacy `--template <path>`, pass it through; the script maps theme dirs to `--theme` and ignores prose template.md files with a warning in render-notes.
- Discover custom themes by reading `.twt-artifacts/export/themes/*/theme.json`.
- Applicable themes are `type: document` or `type: universal`.
- If no custom themes exist, use the built-in `doc-hub-light` theme (no flag needed).
- If custom themes exist, use the **AskUserQuestion** tool with header "Theme" and single-select options:
  - **Built-in doc-hub-light** — house style: quiet editorial, tri-color accent
  - One option per custom theme, labeled with its `name`, `type`, and `description`
  - **You decide** — Pick the most specific applicable custom theme; if unclear, pick built-in

## Step 2 — Run the export script

Run from the repository or project root that contains `tools/export-document.mjs`:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-document.mjs" --format pdf --input "<markdown-path>" --theme "<theme-ref>"
```

If `--force` was requested:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-document.mjs" --format pdf --input "<markdown-path>" --theme "<theme-ref>" --force
```

The script handles slugging, output folders, heading nesting checks, temporary normalized export copies, Pandoc invocation, output verification, and `render-notes.md`.

If the script is missing, stop with: "Export helper missing — run this from the marketplace checkout or install/copy `tools/export-document.mjs` and `templates/document-export-style.md`."

## Step 3 — Read render notes

Read `.twt-artifacts/export/pdf/<source-slug>/render-notes.md` after the script finishes. Use it as the source of truth for:

- PDF path or failure
- theme used (slug + source) and doc type detected → profile
- transforms applied and font source (bundled vs system stacks)
- heading nesting warnings
- temporary export-copy adjustments
- conversion tool used
- missing Pandoc or conversion errors
- confirmation that the source file was not edited

## Step 4 — Report

Tell the user:

- PDF path
- Theme used (built-in `doc-hub-light` or custom slug)
- Doc type detected → profile applied
- That the intermediate HTML was saved alongside the PDF
- Any heading nesting warnings
- Any conversion limitations
- Whether the PDF was successfully produced
