---
name: twt-content-fetch-doc
category: content
description: Extract a Word/Google Doc's content and save as clean Markdown
version: 1.0.0
accepts_arguments: true
inputs:
  - Path to a .docx file, or an exported .md/.txt, or a Google Doc share URL
dependencies:
  hard: []
  soft:
    - twt-content-fetch
reads:
  - <doc-path-or-url>
writes:
  - .twt-artifacts/pre-design/content-fetch/doc/<filename>/index.md
  - .twt-artifacts/pre-design/content-fetch/doc/<filename>/_meta.md
---

# /twt-content-fetch-doc

## Intent

**Purpose:** Pull a Word or Google Doc's content into the working directory as clean, frontmatter-tagged Markdown, matching the shape produced by the site and PDF fetchers so downstream skills consume one uniform format.

**Non-goals:**
- Doesn't preserve tracked changes, comments, or revision history
- Doesn't download embedded media as files (notes presence only)
- For Google Docs, requires a publicly accessible or already-exported source — does not authenticate

**Success criteria:**
- Output appears under `.twt-artifacts/pre-design/content-fetch/doc/<filename>/`
- `index.md` has frontmatter (source, title, fetched-at)
- Heading hierarchy and lists preserved

---

## Step 1 — Get the doc source
Use `$ARGUMENTS` if it is a `.docx`/`.md`/`.txt` path or a Google Doc URL. Otherwise ask: "Provide the path to the document, or a Google Doc share/export URL:". Wait.

## Step 2 — Derive the output folder
`<filename>` = doc base name (or URL slug), slugified. Base output: `.twt-artifacts/pre-design/content-fetch/doc/<filename>/`.

## Step 3 — Read and convert
- `.docx`: read and convert structure → Markdown (headings, lists, tables, bold/italic).
- `.md`/`.txt`: normalize to clean Markdown.
- Google Doc URL: use WebFetch on the export/published form; if access fails, ask the user to paste the export or provide a `.docx`.

## Step 4 — Write the files
`index.md` with frontmatter:
```
---
source: <doc-path-or-url>
title: <document title>
fetched_at: <YYYY-MM-DD>
---

<clean markdown>
```
`_meta.md`: source, structure notes, any conversion warnings.

## Step 5 — Report
Files written (paths), conversion warnings, and that this feeds `/twt-content-fetch`.
