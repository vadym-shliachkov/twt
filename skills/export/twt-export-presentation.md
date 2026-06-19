---
name: twt-export-presentation
category: export
description: Convert Markdown to PPTX or PDF slides via the presentation export script
version: 1.0.0
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
  - .twt-artifacts/export/templates/*/template.json
  - .twt-artifacts/export/templates/*/template.md
writes:
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.pptx
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.pdf
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
- Offers a template choice when multiple presentation/universal templates exist
- Delegates conversion to `node tools/export-presentation.mjs --format <pptx|pdf> --aspect <16:9|4:3> --input <markdown-path>`
- Defaults aspect ratio to `16:9` when the user does not choose one
- Produces the requested artifact under `.twt-artifacts/export/presentation/<source-slug>/`
- Writes `render-notes.md` with slide count, aspect ratio, structure/density warnings, conversion warnings, template used, and output path

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

Resolve template choice:
- If `$ARGUMENTS` includes `--template <path>`, pass it through unchanged.
- Discover custom templates by reading `.twt-artifacts/export/templates/*/template.json`.
- Applicable templates are `type: presentation` or `type: universal`.
- If no applicable custom templates exist, use built-in `templates/presentation-export-style.md`.
- If exactly one applicable custom template exists, use it by default and mention it in the report.
- If more than one applicable template exists, use the **AskUserQuestion** tool with header "Template" and single-select options:
  - **Built-in default** — Use `templates/presentation-export-style.md`
  - One option for each custom template, labeled with its human-readable `name`, `type`, and `description`
  - **You decide** — Pick the most specific applicable custom template; if unclear, pick the built-in default

## Step 2 — Run the export script

Run from the repository or project root that contains `tools/export-presentation.mjs`:

```powershell
node tools/export-presentation.mjs --format <pptx|pdf> --aspect <16:9|4:3> --input "<markdown-path>" --template "<template-path>"
```

If `--force` was requested:

```powershell
node tools/export-presentation.mjs --format <pptx|pdf> --aspect <16:9|4:3> --input "<markdown-path>" --template "<template-path>" --force
```

The script handles slide parsing, output folders, aspect validation, density warnings, Pandoc invocation, output verification, and `render-notes.md`.

If the script is missing, stop with: "Presentation export helper missing — run this from the marketplace checkout or install/copy `tools/export-presentation.mjs` and `templates/presentation-export-style.md`."

## Step 3 — Read render notes

Read `.twt-artifacts/export/presentation/<source-slug>/render-notes.md` after the script finishes. Use it as the source of truth for:

- output path or failure
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
- That `templates/presentation-export-style.md` was used
- Slide count
- Any structure or density warnings
- Any conversion limitations
- Whether the requested presentation artifact was successfully produced
