---
name: twt-content-approval-checklist
category: content
description: (v1.2.1) Create a human-readable XLSX content approval checklist for every project page, expanding collections (Work/Blog/…) into taxonomy + detail-page worksheets
version: 1.2.1
accepts_arguments: true
inputs:
  - Optional project notes, page scope, Figma URL, or path to a sitemap/layout/mockup/design artifact
dependencies:
  hard: []
  soft:
    - twt-design-system-define
    - twt-layout-define
    - twt-mockup-define
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
- Does not create cover, index, or summary sheets; the only non-page worksheets are the two dedicated `Shared header` and `Shared footer` sheets.

**Success criteria:**
- `.twt-artifacts/content-approval/content-approval-checklist.xlsx` exists and has one worksheet per project page **plus** a dedicated `Shared header` and `Shared footer` worksheet (sheet count = page count + 2).
- Every worksheet contains only these columns: `Block name`, `field type`, `current content`, `recommended content`, `approved content`, `ready to implement (true, false)`.
- When a Figma URL/design context is provided, visible Figma copy and media/link references are captured into `current content`, including lorem/placeholder content, so humans can approve, replace, or reject it.
- Shared header and footer content lives only on its own two worksheets — never duplicated onto page worksheets; each page worksheet carries only that page's body fields, text, links, images, videos, and SEO metadata.
- Collection blocks (Work, Portfolio, Blog, Services, Team, Products, …) are expanded, not flattened: their category/filter labels become an approvable **taxonomy** on the listing sheet, and each implied item-detail (and, where the IA uses category archives, category) page gets its **own** worksheet — so the approval set matches the real page count, not just the top-level nav.
- Boolean ready cells use a true/false dropdown, unreadied rows are visually obvious, and the report states page count, row count, missing sources, **the pages synthesised from collections/taxonomies**, and next steps.

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

### Step 2a - Expand collections/taxonomies into real pages (do not treat a listing as flat text)

A block like **Work**, **Portfolio**, **Projects**, **Case studies**, **Services**, **Blog**, **News**, **Team**, or **Products** is **not** a single text section — it is a *collection* backed by a **taxonomy** (its category / filter labels). Filter chips such as `filter_labels: All · Branding · Web · Strategy` are the **taxonomy terms**, and each item in the collection (and usually each category) is its **own page** that needs content approval. Recognising this is the difference between approving "a Work section" and approving the site that Work section actually implies.

When you detect a collection block (a repeating card/list of items, especially one paired with category/filter labels), expand it before building the workbook:

1. **Promote the taxonomy.** Add the collection's category/filter terms as approvable rows on the listing page's sheet under a `Taxonomy` block — one row per term (`taxonomy:term` field type), so a human approves the actual category set (names, order, which "All"/default) rather than leaving filter labels as decorative copy. Note where new terms are still needed.
2. **Add a detail-page worksheet.** Generate at least one **item detail page** worksheet (e.g. `Work — project detail`) representing the template every collection item uses: title, role/meta, hero/media, body sections, gallery, links, prev/next, SEO. If concrete items are known (from the sitemap, Figma frames, or content sources), add a worksheet per known item (named uniquely, 31-char limit); if only the pattern is known, add one representative `… — detail (template)` worksheet and note in the report how many real item pages it stands in for.
3. **Add category/archive pages when the IA implies them.** If filtering navigates to per-category archive URLs (not just client-side filtering on one page), add a `… — category (archive)` worksheet for the category template too, and capture its SEO fields.

Use the sitemap (`pre-design/ia/sitemap.md`) and curation outlines (`pre-design/curation/`) as the source of truth for which detail/category pages exist; fall back to the layout/mockup if the sitemap is silent. Record every page you synthesised this way (and why) in the Step 6 report so the user can confirm the expanded page set is correct.

## Step 3 - Build the workbook structure

Create `.twt-artifacts/content-approval/content-approval-checklist.xlsx` with one worksheet per discovered page, **plus two dedicated shared worksheets**: `Shared header` (placed first) and `Shared footer` (placed last). Do not add cover, index, hidden, or summary sheets.

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

## Step 4 - Group rows into labeled block sections

Header and footer are global, so they get their **own** worksheets and must **not** be repeated on any page worksheet.

**Page worksheets** — for each discovered page (including the detail/category pages synthesised in Step 2a), include these row groups in a readable order, and include **no** header or footer rows:
1. `SEO metadata`: `seo:slug`, `seo:page_title`, `seo:keywords`, `seo:meta_title`, `seo:meta_description`, `seo:schema`, and any canonical/open-graph fields found or needed (these are per-page, so they stay on the page sheet).
2. Page-specific blocks from the design/layout, each with all dynamic text, links, image/video/file assets, form labels, placeholders, validation messages, and microcopy.
3. For a **collection/listing page** (per Step 2a): a `Taxonomy` block whose rows are the category/filter terms (`taxonomy:term`), so the approved category set is explicit — not buried in a filter-chip text field. For an **item-detail / category-archive page**: the full template field set (title, role/meta, hero/media, body sections, gallery, links, prev/next) so the per-item content is approvable like any other page.

**`Shared header` worksheet** — captured once, here only: logo text/image, navigation labels, navigation URLs, utility links, language/social/search items, and the global CTA.

**`Shared footer` worksheet** — captured once, here only: footer navigation, contact details, legal links, newsletter/signup copy, social links, copyright, and any compliance text.

If a specific page uses a header or footer **variant** that differs from the global one, record that difference as extra rows on the `Shared header` / `Shared footer` sheet and name the affected page(s) in `Block name` (for example `Header — checkout (no nav)`) — never scatter header/footer rows back onto page worksheets.

### Section layout (the part that makes it readable)

Do not emit one flat, undivided list of rows — that is what makes the sheet hard to scan. Instead lay **every** worksheet (pages and the two shared sheets) out as a sequence of clearly separated block sections, top to bottom in the page's reading order:

1. **Section banner row** — one row per block that opens the block. Write the block name in `Block name` (e.g. `Hero`, `Pricing cards`, `Primary navigation`), leave `field type` **blank**, and style it as a full-width banner (Step 5). The blank `field type` is what marks it as a divider, not data, so the implement step skips it.
2. **Field rows** — the block's fields immediately under its banner, one field per row, ordered by family for scannability: `text:*`, then `link:*`, then `image:*` / `video:*` / `file:*`, then `form:*`. Each field row repeats its block name in `Block name` (so every row stays self-describing for sorting/filtering and for the implement mapping).
3. **Spacer row** — one empty row after each block's field rows, before the next banner, so blocks breathe.

Keep `Block name` consistent between a block's banner and its field rows — the banner is the human divider; the repeated column value is the machine key.

## Step 5 - Make it readable for humans

Use `openpyxl` styling so the workbook is review-friendly:
- Freeze the header row (sections scroll under a fixed column header).
- Set useful widths: `Block name` and `field type` compact; the three content columns wide with wrapped text.
- **Section banner rows:** merge `Block name`→`ready` across the row, bold, larger, white text on a strong block-accent fill, with a thick top border — so each block is unmistakably separated from the one above.
- **Field rows:** thin borders, vertical top alignment, and gentle alternating shading *within* each section (restart the alternation at every banner so the zebra never bleeds across a divider). De-emphasize the repeated `Block name` cell (lighter text) so the banner stays the dominant label.
- **Spacer rows:** no fill, no border — pure whitespace between sections.
- Apply data validation on the ready column with only `true,false`; default every ready value to `false` (skip these on banner/spacer rows).
- Highlight field rows where approved content is blank or ready is `false`.
- Keep long text wrapped; do not shrink text into unreadability.

Prefer the clear section layout over a sheet-wide autofilter — interspersed banner and spacer rows make a single autofilter range misleading; if you add filtering, scope it so banners/spacers are not swept into it.

Avoid LLM-oriented clutter. The workbook is for stakeholders to scan, fill, approve, and hand back.

## Step 6 - Write the report

Write `.twt-artifacts/content-approval/content-approval-checklist-report.md` with:
- Workbook path.
- Page count, the two shared worksheets (`Shared header`, `Shared footer`), and all worksheet names.
- Block-section count per worksheet, plus total row count and rows by field family: text, link, image, video, file, form, SEO.
- Source artifacts used and missing source artifacts.
- **Collections/taxonomies expanded:** each collection block detected, the taxonomy terms promoted, and the detail/category worksheets synthesised from it (with how many real item pages a `(template)` worksheet represents).
- Any assumptions or inferred blocks that need human review.
- Next step: fill `approved content`, set ready cells to `true`, then run `/twt-content-approval-implement`.

## Step 7 - Report

Tell the user where the workbook and report were written, whether `openpyxl` had to be installed, how many worksheets and rows were created, and what must be filled before implementation.
