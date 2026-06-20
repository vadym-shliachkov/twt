---
name: twt-export-template-create
category: export
description: (v1.0.0) Create reusable export templates from brand or user style instructions
version: 1.0.0
accepts_arguments: true
inputs:
  - Optional template name, type, brand path, style direction, and instructions
dependencies:
  hard: []
  soft:
    - twt-brand-define
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - tools/export-template-create.mjs
writes:
  - .twt-artifacts/export/templates/<template-slug>/template.md
  - .twt-artifacts/export/templates/<template-slug>/template.json
  - .twt-artifacts/export/templates/<template-slug>/preview-notes.md
---

# /twt-export-template-create

## Intent

**Purpose:** Create a named, reusable export template that later document and presentation export commands can offer in their template menus. Templates may be based on an existing brand brief, user-provided style instructions, or both.

**Non-goals:**
- Doesn't export a PDF, DOCX, PPTX, or presentation itself
- Doesn't overwrite an existing template unless the user explicitly asks
- Doesn't use vague names like `template-1`, `new-template`, or `default-copy`
- Doesn't invent brand facts when no brand source is provided

**Success criteria:**
- Creates `.twt-artifacts/export/templates/<template-slug>/template.md`
- Creates `.twt-artifacts/export/templates/<template-slug>/template.json` with name, slug, type, style, description, brand source, and instructions
- Creates `.twt-artifacts/export/templates/<template-slug>/preview-notes.md`
- Template names are human-distinguishable and combine context, style direction, and scope where possible
- With no `$ARGUMENTS`, gathers choices through menus and free-text prompts before running `tools/export-template-create.mjs`

---

## Step 1 — Resolve template choices

Parse `$ARGUMENTS` for:

```text
--name "<name>" --type <document|presentation|universal> --style "<style>" --brand "<path>" --instructions "<instructions>" --force
```

If `$ARGUMENTS` is empty or incomplete, gather missing choices:

1. Use the **AskUserQuestion** tool with header "Type" and single-select options:
   - **Document** — For PDF/DOCX document exports
   - **Presentation** — For PPTX/PDF slide exports
   - **Universal** — Can be offered to both document and presentation exports
   - **You decide** — Pick Universal unless the user's wording clearly targets only documents or only slides
2. Use the **AskUserQuestion** tool with header "Brand" and single-select options:
   - **Use brand** — Use `.twt-artifacts/pre-design/brand/brand-brief.md` if it exists
   - **No brand** — Use only general style instructions
   - **Custom path** — Ask for a brand/template source path
   - **You decide** — Use brand brief if present, otherwise no brand
3. Use the **AskUserQuestion** tool with header "Style" and single-select options:
   - **Minimal editorial** — Quiet, readable, restrained
   - **Executive premium** — More polished, boardroom-ready
   - **Technical report** — Dense but clear, specification-friendly
   - **Sales pitch** — Sharper emphasis and stronger calls to action
   - **You decide** — Pick the best fit from context
4. Ask for extra free-text instructions if the user wants refinements such as colors, fonts, mood, spacing, audience, or examples to emulate/avoid.
5. Ask whether to provide a name or generate one. If generating, choose a wise name.

## Step 2 — Choose a wise template name

Template names must help users distinguish templates in a future menu. Prefer this naming shape:

```text
<brand-or-context>-<style-direction>-<use-case-or-scope>
```

Good examples:

- `xivic-editorial-brand-report`
- `minimal-technical-spec-document`
- `premium-sales-presentation`
- `executive-brief-universal`

Avoid:

- `template-1`
- `default-new`
- `nice-template`
- `client-template`
- names that differ only by a number

If the user gives a vague name, improve it while preserving their intent and mention the improved name in the report.

## Step 3 — Run the template creator script

Run from the repository or project root that contains `tools/export-template-create.mjs`:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-template-create.mjs" --name "<wise-name>" --type <document|presentation|universal> --style "<style>" --instructions "<instructions>"
```

If using a brand source:

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-template-create.mjs" --name "<wise-name>" --type <document|presentation|universal> --style "<style>" --brand "<brand-path>" --instructions "<instructions>"
```

If overwriting was explicitly requested, add `--force`.

The script handles slugging, folder creation, metadata, template body, preview notes, and overwrite protection.

If the script is missing, stop with: "Export template helper missing — run this from the marketplace checkout or install/copy `tools/export-template-create.mjs`."

## Step 4 — Report

Tell the user:

- Template name
- Template type
- Template path
- Metadata path
- Preview notes path
- Brand source used, if any
- How to use it next with `--template "<template-path>"` or by choosing it from an export command's template menu
