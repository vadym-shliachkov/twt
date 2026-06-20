---
name: twt-export-docx
category: export
description: Convert Markdown to a polished DOCX with the shared document template
version: 1.0.0
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
  - .twt-artifacts/export/templates/*/template.json
  - .twt-artifacts/export/templates/*/template.md
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
- Delegates conversion to `node tools/export-document.mjs --format docx --input <markdown-path>`
- Offers a template choice when multiple document/universal templates exist
- Produces `.twt-artifacts/export/docx/<source-slug>/<source-slug>.docx`
- Writes `.twt-artifacts/export/docx/<source-slug>/render-notes.md` with heading nesting warnings, conversion warnings, template used, and output path
- Uses `templates/document-export-style.md` through the script for minimal, readable typography, spacing, page margins, tables, lists, code blocks, and blockquotes

---

## Step 1 — Resolve input

Use `$ARGUMENTS` as the Markdown path when present. If missing, ask the user: "Provide the Markdown file path to export as DOCX." Wait.

The source must be a local `.md` or `.markdown` file. If the input is a URL, PDF, DOCX, or folder, stop and ask the user to provide a Markdown file first.

If the user wants to overwrite an existing export, pass `--force` through to the script.

Resolve template choice:
- If `$ARGUMENTS` includes `--template <path>`, pass it through unchanged.
- Discover custom templates by reading `.twt-artifacts/export/templates/*/template.json`.
- Applicable templates are `type: document` or `type: universal`.
- If no applicable custom templates exist, use built-in `templates/document-export-style.md`.
- If exactly one applicable custom template exists, use it by default and mention it in the report.
- If more than one applicable template exists, use the **AskUserQuestion** tool with header "Template" and single-select options:
  - **Built-in default** — Use `templates/document-export-style.md`
  - One option for each custom template, labeled with its human-readable `name`, `type`, and `description`
  - **You decide** — Pick the most specific applicable custom template; if unclear, pick the built-in default

## Step 2 — Run the export script

Run from the repository or project root that contains `tools/export-document.mjs`:

```powershell
node tools/export-document.mjs --format docx --input "<markdown-path>" --template "<template-path>"
```

If `--force` was requested:

```powershell
node tools/export-document.mjs --format docx --input "<markdown-path>" --template "<template-path>" --force
```

The script handles slugging, output folders, heading nesting checks, temporary normalized export copies, Pandoc invocation, output verification, and `render-notes.md`.

If the script is missing, stop with: "Export helper missing — run this from the marketplace checkout or install/copy `tools/export-document.mjs` and `templates/document-export-style.md`."

## Step 3 — Read render notes

Read `.twt-artifacts/export/docx/<source-slug>/render-notes.md` after the script finishes. Use it as the source of truth for:

- DOCX path or failure
- heading nesting warnings
- temporary export-copy adjustments
- conversion tool used
- missing Pandoc or conversion errors
- confirmation that the source file was not edited

## Step 4 — Report

Tell the user:

- DOCX path
- That `templates/document-export-style.md` was used
- Any heading nesting warnings
- Any conversion limitations
- Whether the DOCX was successfully produced
