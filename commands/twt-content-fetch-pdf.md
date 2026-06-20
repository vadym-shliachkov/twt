---
name: twt-content-fetch-pdf
category: content
description: (v1.0.0) Extract a PDF's text content and save as clean Markdown
version: 1.0.0
accepts_arguments: true
inputs:
  - Path to a local PDF file (or folder of PDFs)
dependencies:
  hard: []
  soft:
    - twt-content-fetch
reads:
  - <pdf-path>
writes:
  - .twt-artifacts/pre-design/content-fetch/pdf/<filename>/index.md
  - .twt-artifacts/pre-design/content-fetch/pdf/<filename>/_meta.md
---

# /twt-content-fetch-pdf

## Intent

**Purpose:** Pull a PDF's readable content into the working directory as clean, frontmatter-tagged Markdown so it can feed brand, positioning, IA, and curation skills the same way fetched site content does.

**Non-goals:**
- Not OCR for scanned/image-only PDFs — text-layer extraction only (flag when a PDF appears image-only)
- Doesn't preserve exact visual layout, columns, or pixel positions
- Doesn't extract embedded images as files (notes their presence only)

**Success criteria:**
- Output appears under `.twt-artifacts/pre-design/content-fetch/pdf/<filename>/`
- `index.md` has frontmatter (source path, title, fetched-at, page count)
- Headings and lists are preserved where the PDF's text structure allows

---

## Step 1 — Get the PDF path
Use `$ARGUMENTS` if it points to a `.pdf` (or a folder). Otherwise ask: "Provide the path to the PDF file (or a folder of PDFs):". Wait for the answer.

## Step 2 — Derive the output folder
`<filename>` = the PDF base name, slugified (lowercase, kebab-case). Base output: `.twt-artifacts/pre-design/content-fetch/pdf/<filename>/`. For a folder input, process each PDF into its own `<filename>/` subfolder.

## Step 3 — Read and convert
Use the Read tool's PDF support to read the PDF. Convert to clean Markdown: keep headings, paragraphs, lists, tables; drop running headers/footers and page numbers. If the text layer is empty/garbled, STOP and tell the user it looks image-only (OCR out of scope).

## Step 4 — Write the files
Write `index.md`:
```
---
source: <pdf-path>
title: <document title or filename>
fetched_at: <YYYY-MM-DD>
pages: <count>
---

<clean markdown>
```
Write `_meta.md` with: source path, page count, whether images/tables were present, extraction warnings.

## Step 5 — Report
Tell the user: files written (paths), page count, any extraction warnings, and that this feeds `/twt-content-fetch` and downstream define skills.
