---
name: twt-export-presentation
category: export
description: (v1.1.1) Convert Markdown to PPTX or PDF slides via the presentation export script
version: 1.1.1
accepts_arguments: true
inputs:
  - Markdown deck path, optional --format pptx|pdf, optional --aspect 16:9|4:3
dependencies:
  hard: []
  soft: []
reads:
  - <markdown-path>
  - tools/export-presentation.mjs
  - templates/presentation-export-style.md
  - .twt-artifacts/export/themes/*/theme.json
  - templates/themes/doc-hub-light/theme.json
writes:
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.pptx
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.pdf
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.html
  - .twt-artifacts/export/presentation/<source-slug>/render-notes.md
---

# /twt-export-presentation

## Intent

**Purpose:** Convert a Markdown slide deck into PPTX or PDF using the marketplace's deterministic presentation export script and default presentation template. The skill keeps model work light: it gathers choices, runs the script, reads render notes, and reports results.

**Non-goals:**
- Doesn't create both PPTX and PDF in one call; run the command once per desired format
- Doesn't manually recreate presentation conversion logic from `tools/export-presentation.mjs`
- Doesn't invent missing slide content, images, data, citations, or brand styling
- Doesn't edit the source Markdown unless the user explicitly asks

**Success criteria:**
- With no `$ARGUMENTS`, presents menu choices for format and aspect ratio using AskUserQuestion, and asks for the Markdown path
- Offers a theme choice when custom themes exist (applicable types: `presentation` or `universal`)
- Delegates conversion to `node "${CLAUDE_PLUGIN_ROOT}/tools/export-presentation.mjs" --format <pptx|pdf> --aspect <16:9|4:3> --input <markdown-path>`
- Defaults aspect ratio to `16:9` when the user does not choose one
- Produces the requested artifact under `.twt-artifacts/export/presentation/<source-slug>/`
- PPTX uses the theme's `reference.pptx` (built-in `doc-hub-light` by default); PDF slides render the theme via Chromium (playwright) with a beamer fallback, and the intermediate HTML is always saved alongside the PDF
- Writes `render-notes.md` with slide count, aspect ratio, structure/density warnings, conversion warnings, theme used, and output path

---

## Step 1 — Resolve input and choices

Parse `$ARGUMENTS` for:

```text
<markdown-path> --format <pptx|pdf> --aspect <16:9|4:3> --force
```

If `$ARGUMENTS` is empty:

1. Ask the user for the Markdown deck path as free text: "Provide the Markdown deck file to export."
2. Use the **AskUserQuestion** tool with header "Format" and single-select options:
   - **PPTX** — Creates an editable PowerPoint deck
   - **PDF** — Creates a PDF presentation
   - **You decide** — Pick PPTX when the user likely needs editing; otherwise pick PDF for sharing/printing
3. Use the **AskUserQuestion** tool with header "Aspect" and single-select options:
   - **16:9** — Default modern widescreen presentation size
   - **4:3** — Legacy projector / older deck format
   - **You decide** — Pick 16:9

If `$ARGUMENTS` includes a Markdown path but omits `--format`, ask the same "Format" menu. If it omits `--aspect`, default to `16:9` without asking unless the user explicitly requested a size choice.

The source must be a local `.md` or `.markdown` file. If the input is a URL, PDF, PPTX, DOCX, or folder, stop and ask for a Markdown deck file.

Resolve theme choice:
- If `$ARGUMENTS` includes `--theme <slug-or-path>`, pass it through unchanged.
- If `$ARGUMENTS` includes legacy `--template <path>`, pass it through; the script maps theme dirs to `--theme` and ignores prose template.md files with a warning in render-notes.
- Discover custom themes by reading `.twt-artifacts/export/themes/*/theme.json`.
- Applicable themes are `type: presentation` or `type: universal`.
- If no custom themes exist, use the built-in `doc-hub-light` theme (no flag needed).
- If custom themes exist, use the **AskUserQuestion** tool with header "Theme" and single-select options:
  - **Built-in doc-hub-light** — house style: quiet editorial, tri-color accent
  - One option per custom theme, labeled with its `name`, `type`, and `description`
  - **You decide** — Pick the most specific applicable custom theme; if unclear, pick built-in

## Step 2 — Run the export script

Run from the repository or project root that contains `tools/export-presentation.mjs`:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-presentation.mjs" --format <pptx|pdf> --aspect <16:9|4:3> --input "<markdown-path>" --theme "<theme-ref>"
```

If `--force` was requested:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-presentation.mjs" --format <pptx|pdf> --aspect <16:9|4:3> --input "<markdown-path>" --theme "<theme-ref>" --force
```

The script handles slide parsing, output folders, aspect validation, density warnings, Pandoc invocation, output verification, and `render-notes.md`.

If the script is missing, stop with: "Presentation export helper missing — run this from the marketplace checkout or install/copy `tools/export-presentation.mjs` and `templates/presentation-export-style.md`."

## Step 3 — Read render notes

Read `.twt-artifacts/export/presentation/<source-slug>/render-notes.md` after the script finishes. Use it as the source of truth for:

- output path or failure
- theme used (slug + source)
- font source (bundled vs system stacks)
- requested format
- aspect ratio
- slide count
- structure and density warnings
- missing Pandoc or conversion errors
- confirmation that the source file was not edited

## Step 4 — Report

Tell the user:

- Output path
- Format and aspect ratio
- Theme used (built-in `doc-hub-light` or custom slug)
- Slide count
- If PDF, that the intermediate HTML was saved alongside it
- Any structure or density warnings
- Any conversion limitations
- Whether the requested presentation artifact was successfully produced
