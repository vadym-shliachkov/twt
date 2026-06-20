---
name: twt-content-approval-checklist
category: content
description: (v1.0.1) Create a human-readable XLSX content approval checklist for every project page
version: 1.0.1
accepts_arguments: true
inputs:
  - Optional project notes, page scope, Figma URL, or path to a sitemap/layout/mockup/design artifact
dependencies:
  hard: []
  soft:
    - twt-design-system-define
    - twt-layout
    - twt-mockup
reads:
  - Figma URL or Figma design context supplied via $ARGUMENTS
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/components.md
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/layout/*.md
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/mockup/*.html
  - .twt-artifacts/design/assets/manifest.md
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/curation/
writes:
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - .twt-artifacts/content-approval/content-approval-checklist-report.md
---

# /twt-content-approval-checklist

## Intent

**Purpose:** Create the content approval workbook that proves every page, shared header/footer item, asset, link, video, and SEO field has a human-approved value before implementation. It is used when not all content exists at project start, including Figma-first workflows where the design may contain lorem ipsum, placeholder copy, draft links, and unapproved media references.

**Non-goals:**
- Does not write approved content into the site; use `/twt-content-approval-implement` for that.
- Does not invent final approved content; inferred or recommended values stay in `recommended content` until the user approves them.
- Does not create extra non-page worksheets; the workbook sheet count must match the project page count.

**Success criteria:**
- `.twt-artifacts/content-approval/content-approval-checklist.xlsx` exists and has exactly one worksheet per project page.
- Every worksheet contains only these columns: `Block name`, `field type`, `current content`, `recommended content`, `approved content`, `ready to implement (true, false)`.
- When a Figma URL/design context is provided, visible Figma copy and media/link references are captured into `current content`, including lorem/placeholder content, so humans can approve, replace, or reject it.
- Shared header/footer content, page body fields, text, links, images, videos, and SEO metadata rows are present and readable by a human reviewer.
- Boolean ready cells use a true/false dropdown, unreadied rows are visually obvious, and the report states page count, row count, missing sources, and next steps.

---

Arguments passed to this command: $ARGUMENTS

## Step 1 - Check Excel dependency

Before generating the workbook, verify `openpyxl` is available. Run a shell check:

```powershell
python -c "import openpyxl"
```

If that fails, install it in the same shell environment and re-check:

```powershell
python -m pip install openpyxl
python -c "import openpyxl"
```

On Windows where `python` is unavailable but `py` exists, use `py -m pip install openpyxl`. If installation fails because of permissions or network restrictions, stop and report the exact install command the user must run.

## Step 2 - Discover pages and source materials

Find the project page list from the best available source, in this order:
1. Figma URL/design context supplied in `$ARGUMENTS` (frames/screens/pages become workbook pages).
2. `.twt-artifacts/design/layout/layouts/*.md`
3. `.twt-artifacts/design/layout/*.md` (fallback for existing projects that wrote page layouts directly under `layout/`; ignore `validation-report.md` and `decisions.md`).
4. `.twt-artifacts/design/mockup/pages/*.html`
5. `.twt-artifacts/design/mockup/*.html` (fallback for existing projects that wrote page mockups directly under `mockup/`; ignore `index.html`).
6. `.twt-artifacts/pre-design/ia/sitemap.md`
7. User-provided page list in `$ARGUMENTS`

If no page list can be discovered, ask for the sitemap or page names as free-form text. Normalize each page to a worksheet name under Excel's 31-character limit, keeping names human-readable and unique.

Read available design-system and layout artifacts to infer the content scope:
- Figma text layers, component instances, frame names, visible URLs, image/video placeholders, media filenames, alt-like labels, and SEO-looking annotations when a Figma source is provided.
- Component/block inventory from `tokens.md`, `components.md`, page layouts (`layout/layouts/*.md` or `layout/*.md`), and mockup HTML (`mockup/pages/*.html` or page-level `mockup/*.html`).
- Existing copy, links, image paths, video embeds, and forms from mockups or build output if present.
- Asset requirements from `.twt-artifacts/design/assets/manifest.md`.

Put source values found in Figma/design/mockups into `current content` exactly enough for review, even when the value is lorem ipsum, placeholder copy, a draft CTA, or a fake URL. Use `recommended content` for the model's proposed replacement or for notes such as `Needs approved final copy`, `Needs final asset URL`, or `Looks like lorem ipsum - replace before ready`. Mark inferred rows as recommendations, not approvals.

## Step 3 - Build the workbook structure

Create `.twt-artifacts/content-approval/content-approval-checklist.xlsx` with exactly one worksheet per discovered page. Do not add cover, index, hidden, or summary sheets.

Every worksheet uses this exact six-column header, in this order:

| Column | Meaning |
|--------|---------|
| Block name | Page area or reusable block name, for example `Shared header`, `Hero`, `Pricing cards`, `Footer`, `SEO metadata`. |
| field type | A stable content key such as `text:headline`, `link:primary_cta_url`, `image:hero`, `video:demo_embed`, `seo:slug`, `seo:meta_title`, `seo:schema`. |
| current content | The current value found in the design/mockup/site, or blank when content is still missing. |
| recommended content | The proposed copy, target URL, asset filename/path, image alt text, video URL/embed/transcript note, or SEO recommendation. |
| approved content | The final human-approved value. Leave blank until approved. |
| ready to implement (true, false) | `false` by default; set `true` only when `approved content` is final and safe to implement. |

For media rows, use links or paths in `approved content`:
- Images: final file path or URL plus alt text and optional caption, separated by clear labels.
- Videos: hosted URL, embed URL/code, transcript/caption requirement, thumbnail path, and poster alt text.
- Documents/downloads: file path or URL plus link label.

## Step 4 - Include required row groups

For each page worksheet, include these row groups in a readable order:
1. `SEO metadata`: `seo:slug`, `seo:page_title`, `seo:keywords`, `seo:meta_title`, `seo:meta_description`, `seo:schema`, and any canonical/open-graph fields found or needed.
2. `Shared header`: logo text/image, navigation labels, navigation URLs, utility links, language/social/search items, and global CTA.
3. Page-specific blocks from the design/layout, each with all dynamic text, links, image/video/file assets, form labels, placeholders, validation messages, and microcopy.
4. `Shared footer`: footer navigation, contact details, legal links, newsletter/signup copy, social links, copyright, and any compliance text.

If header or footer differs by page, reflect the actual page variant on that worksheet. If it is shared globally, repeat the same rows on every worksheet so the sheet count still equals the page count.

## Step 5 - Make it readable for humans

Use `openpyxl` styling so the workbook is review-friendly:
- Freeze the header row and apply autofilter.
- Set useful widths: block and field columns compact; content columns wide with wrapped text.
- Use a bold high-contrast header fill, thin borders, vertical top alignment, and alternating row shading.
- Apply data validation on the ready column with only `true,false`.
- Default every ready value to `false`.
- Highlight rows where approved content is blank or ready is `false`.
- Keep long text wrapped; do not shrink text into unreadability.

Avoid LLM-oriented clutter. The workbook is for stakeholders to scan, fill, approve, and hand back.

## Step 6 - Write the report

Write `.twt-artifacts/content-approval/content-approval-checklist-report.md` with:
- Workbook path.
- Page count and worksheet names.
- Total row count and rows by field family: text, link, image, video, file, form, SEO.
- Source artifacts used and missing source artifacts.
- Any assumptions or inferred blocks that need human review.
- Next step: fill `approved content`, set ready cells to `true`, then run `/twt-content-approval-implement`.

## Step 7 - Report

Tell the user where the workbook and report were written, whether `openpyxl` had to be installed, how many worksheets and rows were created, and what must be filled before implementation.
