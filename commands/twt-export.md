---
name: twt-export
category: export
description: (v1.1.0) Orchestrate PDF, DOCX, PPTX, and theme-based exports
version: 1.1.0
accepts_arguments: true
inputs:
  - Optional export type, source Markdown path or source instructions, theme choice, aspect ratio, and force flag
dependencies:
  hard: []
  soft:
    - twt-export-pdf
    - twt-export-docx
    - twt-export-presentation
    - twt-export-template-create
reads:
  - <markdown-path>
  - .twt-artifacts/export/themes/*/theme.json
  - templates/themes/doc-hub-light/theme.json
  - tools/export-source-create.mjs
  - tools/export-document.mjs
  - tools/export-presentation.mjs
  - tools/export-theme-create.mjs
writes:
  - .twt-artifacts/export/sources/<source-slug>.md
  - .twt-artifacts/export/sources/<source-slug>.notes.md
  - .twt-artifacts/export/pdf/<source-slug>/<source-slug>.pdf
  - .twt-artifacts/export/pdf/<source-slug>/<source-slug>.html
  - .twt-artifacts/export/docx/<source-slug>/<source-slug>.docx
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.pptx
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.pdf
  - .twt-artifacts/export/presentation/<source-slug>/<source-slug>.html
  - .twt-artifacts/export/themes/<theme-slug>/theme.json
  - .twt-artifacts/export/themes/<theme-slug>/css/*.css
  - .twt-artifacts/export/themes/<theme-slug>/fonts/*
  - .twt-artifacts/export/themes/<theme-slug>/reference/*
  - .twt-artifacts/export/themes/<theme-slug>/preview/preview.html
  - .twt-artifacts/export/themes/<theme-slug>/preview-notes.md
---

# /twt-export

## Intent

**Purpose:** Orchestrate export creation across document and presentation formats. The skill gathers choices, creates a source or theme when needed, then dispatches the specialized export skill so conversion remains script-driven. The built-in `doc-hub-light` theme is the default for all exports; per-project brand customization stays with `/twt-export-template-create`.

**Non-goals:**
- Doesn't convert files directly inside the orchestrator
- Doesn't create both document and presentation outputs unless the user explicitly runs separate exports
- Doesn't overwrite sources, themes, or outputs without explicit user consent
- Doesn't duplicate logic from `/twt-export-pdf`, `/twt-export-docx`, `/twt-export-presentation`, or `/twt-export-template-create`

**Success criteria:**
- With no `$ARGUMENTS`, uses AskUserQuestion to choose output type before asking for source and theme choices
- Supports HTML, PDF, DOCX, PPTX, and PDF presentation formats, all using the built-in `doc-hub-light` theme by default
- Allows either an existing Markdown file or new source instructions
- Offers only themes relevant to the selected output type, plus the built-in default and a create-new option
- If creating a theme, dispatches `/twt-export-template-create` first and then proceeds with the export
- Delegates source creation to `tools/export-source-create.mjs`
- Delegates final conversion to the relevant child export skill, which delegates to `tools/export-document.mjs` or `tools/export-presentation.mjs`

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Resolve output type

Parse `$ARGUMENTS` for:

```text
html | pdf | docx | pptx | presentation-pdf
--format <html|pdf|docx|pptx|presentation-pdf>
--input <markdown-path>
--source <markdown-path>
--instructions "<instructions>"
--title "<title>"
--theme <slug-or-path>
--template <legacy-path>
--aspect <16:9|4:3>
--force
```

Accept these aliases:

- `html` → HTML document
- `pdf` or `document-pdf` → PDF document
- `docx` or `word` → DOCX document
- `pptx` or `powerpoint` → PPTX presentation
- `presentation-pdf`, `slides-pdf`, or `deck-pdf` → PDF presentation

If `$ARGUMENTS` does not specify an output type, use the **AskUserQuestion** tool with header "Export Type" and single-select options:

- **HTML document** — Create a polished HTML document from Markdown
- **PDF document** — Create a polished document PDF from Markdown
- **DOCX document** — Create an editable Word document from Markdown
- **PPTX presentation** — Create an editable PowerPoint deck from Markdown slides
- **PDF presentation** — Create a PDF slide deck from Markdown slides
- **You decide** — Pick the most likely target from context; if unclear, pick PDF document

For presentation outputs, if `--aspect` is missing and the user started with no `$ARGUMENTS`, use the **AskUserQuestion** tool with header "Aspect" and single-select options:

- **16:9** — Default modern widescreen presentation size
- **4:3** — Legacy projector / older deck format
- **You decide** — Pick 16:9

If `--aspect` is missing in a partially specified presentation call, default to `16:9`.

## Step 2 — Resolve source

If `$ARGUMENTS` includes `--input <path>`, `--source <path>`, or a positional Markdown file, use it as the source.

If no source path exists, use the **AskUserQuestion** tool with header "Source" and single-select options:

- **Existing Markdown** — Ask for the local `.md` or `.markdown` file path to export
- **New from instructions** — Ask for a title and free-text instructions, then create a Markdown source file
- **You decide** — Use an existing file if one is clearly referenced; otherwise create a new source from instructions

When the user chooses **New from instructions**, gather:

- a clear export title
- free-text instructions or draft content

Then run:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-source-create.mjs" --type <document|presentation> --title "<title>" --instructions "<instructions>"
```

Use `--type document` for PDF/DOCX document outputs and `--type presentation` for PPTX/PDF presentation outputs. If overwrite was explicitly requested, add `--force`.

Use the script's reported `Source:` path as the export input. If the generated source contains only instructions rather than final content, tell the user before proceeding and continue unless they ask to pause.

## Step 3 — Resolve theme

If `$ARGUMENTS` includes `--theme <slug-or-path>`, pass it through to the child export skill unchanged.

If `$ARGUMENTS` includes legacy `--template <path>`, pass it through; the script maps theme dirs to `--theme` and ignores prose template.md files with a warning in render-notes.

Otherwise, discover custom themes by reading:

```text
.twt-artifacts/export/themes/*/theme.json
```

Determine applicable theme types:

- PDF/DOCX document exports: `document` and `universal`
- PPTX/PDF presentation exports: `presentation` and `universal`

Use the **AskUserQuestion** tool with header "Theme" and single-select options:

- **Built-in doc-hub-light** — house style: quiet editorial, tri-color accent
- **Create new** — Create a reusable theme first, then continue exporting
- One option for each applicable custom theme, labeled with its human-readable `name`, `type`, and `description`
- **You decide** — Pick the most specific applicable custom theme; if unclear, pick built-in

If the user chooses **Create new**, dispatch `/twt-export-template-create` with:

- `--type document` for PDF/DOCX document outputs
- `--type presentation` for PPTX/PDF presentation outputs
- the user's brand or style instructions if provided

After `/twt-export-template-create` finishes, read its reported theme dir or `.twt-artifacts/export/themes/<theme-slug>/theme.json`, then use that theme slug for the export.

## Step 4 — Dispatch the specialized export

Do not run Pandoc or conversion commands directly from this orchestrator. Dispatch the matching child skill with the resolved source and theme.

For a PDF document, dispatch `/twt-export-pdf`:

```text
/twt-export-pdf "<source-path>" --theme "<theme-ref>"
```

For a DOCX document, dispatch `/twt-export-docx`:

```text
/twt-export-docx "<source-path>" --theme "<theme-ref>"
```

For a PPTX presentation, dispatch `/twt-export-presentation`:

```text
/twt-export-presentation "<source-path>" --format pptx --aspect <16:9|4:3> --theme "<theme-ref>"
```

For a PDF presentation, dispatch `/twt-export-presentation`:

```text
/twt-export-presentation "<source-path>" --format pdf --aspect <16:9|4:3> --theme "<theme-ref>"
```

If overwrite was explicitly requested, append `--force`.

## Step 5 — Report

Report:

- requested export type
- source path used, including whether it was existing or created from instructions
- theme used, including whether it was built-in `doc-hub-light`, a selected custom theme, or newly created
- child export skill dispatched
- output path and render notes path from the child skill's report
- any warnings from source creation or render notes

If a source or theme has problems, report them clearly and still proceed to export unless the issue makes the script impossible to run, such as a missing source path or missing theme file.
