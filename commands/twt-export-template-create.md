---
name: twt-export-template-create
category: export
description: (v2.0.2) Create a whole reusable export theme (css layers, fonts, reference docs, preview) from brand or user style instructions
version: 2.0.2
accepts_arguments: true
inputs:
  - Optional theme name, type, brand path, style direction, and instructions
dependencies:
  hard: []
  soft:
    - twt-brand-define
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/design/design-system/tokens.css
  - tools/export-theme-create.mjs
writes:
  - .twt-artifacts/export/themes/<theme-slug>/theme.json
  - .twt-artifacts/export/themes/<theme-slug>/css/*.css
  - .twt-artifacts/export/themes/<theme-slug>/fonts/*
  - .twt-artifacts/export/themes/<theme-slug>/reference/*
  - .twt-artifacts/export/themes/<theme-slug>/preview/preview.html
  - .twt-artifacts/export/themes/<theme-slug>/preview-notes.md
---

# /twt-export-template-create

## Intent

**Purpose:** Create a named, reusable export theme — css layers, bundled fonts, reference docs, and a preview — that later document and presentation export commands can offer in their theme menus. Themes may be based on an existing brand brief, user-provided style instructions, or both.

**Non-goals:**
- Doesn't export a PDF, DOCX, PPTX, or presentation itself
- Doesn't overwrite an existing theme unless the user explicitly asks
- Doesn't use vague names like `theme-1`, `new-theme`, or `default-copy`
- Doesn't invent brand facts when no brand source is provided

**Success criteria:**
- Creates the whole theme directory `.twt-artifacts/export/themes/<theme-slug>/` (css layers, fonts, reference docs, preview)
- Creates `.twt-artifacts/export/themes/<theme-slug>/theme.json` with name, slug, type, style, description, brand source, and instructions
- Creates `.twt-artifacts/export/themes/<theme-slug>/preview-notes.md`
- Theme names are human-distinguishable and combine context, style direction, and scope where possible
- With no `$ARGUMENTS`, gathers choices through menus and free-text prompts before running `tools/export-theme-create.mjs`

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

## Step 3 — Derive token values (model judgment, deterministic files)

The script generates every file; your job is only to choose the token values it substitutes.

If a brand source was chosen, read it (brand-brief.md and/or `.twt-artifacts/design/design-system/tokens.css`) and map brand colors to theme token roles:

- `ink` — darkest brand neutral (headings)
- `text` — body text color
- `muted` — secondary/caption color
- `rule` — hairline border color
- `panel` — soft panel fill
- `surface` — page background
- `accent` — primary accent (links, blockquote, chips)
- `accent2` / `accent3` — secondary accents (only if the brand defines them; otherwise omit and the house tri-color remains)
- `ok` / `warn` / `danger` — status colors (keep house defaults unless the brand defines semantic colors)

Contrast rule: `ink` and `text` must stay readable on `surface` (AA for body text). If a brand color fails, keep the house value for that role and say so in the report.

Fonts: pass `--font-heading` / `--font-body` / `--font-mono` only when the brand names fonts. Bundled families (Montserrat, Inter, IBM Plex Mono) embed automatically; any other family falls back to system stacks — tell the user.

## Step 4 — Run the theme creator script

```powershell
node "${CLAUDE_PLUGIN_ROOT}/tools/export-theme-create.mjs" --name "<wise-name>" --type <document|presentation|universal> --style "<style>" --instructions "<instructions>" --brand "<brand-path-if-any>" --token ink=#0A1A2F --token accent=#C8102E
```

Pass one `--token key=value` per chosen override; omit tokens you didn't change. Add `--force` only when the user explicitly confirmed overwriting.

The script creates the whole theme: substituted css layers (tokens/doc/slide/components), copied bundled fonts, themed reference.docx/pptx (python builder, falls back to house reference docs with a note), preview/preview.html, theme.json, preview-notes.md.

Two optional css layers stack on top at export time and may be added to a theme by hand: `css/profiles/<report|brief|spec|generic>.css` (per doc-type *profile* — e.g. numbered section kickers for briefs) and `css/doctypes/<docType>.css` (one specific registry doc type — only when a more specific treatment than its profile is worth it). Missing files degrade silently; the built-in `doc-hub-light` ships `profiles/brief.css` and `profiles/spec.css` as reference implementations.

If the script is missing, stop with: "Export theme helper missing — run this from the marketplace checkout or install/copy `tools/export-theme-create.mjs`."

## Step 5 — Report

Tell the user: theme name/slug, theme dir, which tokens were overridden (and any kept for contrast reasons), font decision, reference-doc build result, preview path, and how to use it: `--theme <slug>` on any export command or pick it from the export theme menu.
