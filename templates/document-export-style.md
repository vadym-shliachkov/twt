# Document Export Style

Default house template for `/twt-export-pdf` and `/twt-export-docx`. Use this on every Markdown-to-PDF or Markdown-to-DOCX export unless the user explicitly confirms a custom template.

## Design intent

Produce a quiet, editorial document: readable, compact, and professional without decorative framing. The design should feel like a careful strategy/report handoff, not a slide deck or marketing page.

## Page setup

- Page size: A4 by default; use Letter only when the user requests it or the source context is clearly US-specific.
- Margins: 22 mm top, 22 mm bottom, 24 mm left, 24 mm right.
- Header: none by default.
- Footer: page number only, centered or outer-aligned.
- Max text line length: approximately 70-85 characters where the export tool allows it.

## Typography

Use the best available stack in this order:

| Role | Preferred | Fallback |
|------|-----------|----------|
| Body | Source Serif 4, Charter, Georgia | Times New Roman |
| Headings | Inter, Source Sans 3, Aptos Display | Arial |
| Code | JetBrains Mono, Cascadia Mono, Consolas | Courier New |

Default sizes:

| Element | Size | Line height | Spacing |
|---------|-----:|------------:|---------|
| Body | 10.5-11 pt | 1.45 | 0 pt before, 7 pt after |
| H1 | 22-26 pt | 1.15 | 0 pt before, 16 pt after |
| H2 | 16-18 pt | 1.25 | 20 pt before, 8 pt after |
| H3 | 13-14 pt | 1.3 | 14 pt before, 6 pt after |
| H4 | 11.5-12 pt | 1.35 | 10 pt before, 4 pt after |
| Caption / footnote | 8.5-9 pt | 1.35 | 3 pt after |
| Code | 9-9.5 pt | 1.35 | 8 pt before and after |

Use dark neutral text (`#111827`) on white. Secondary text may use `#4B5563`. Avoid colored headings unless the source document already defines a brand palette.

## Heading nesting

Preserve semantic heading order. The exported document must not skip levels:

- `#` is the document title. Use one H1 unless the source is a collection.
- `##` starts major sections.
- `###` starts subsections inside the nearest H2.
- `####` is allowed only inside the nearest H3.
- If the source jumps from H2 to H4, report it in `render-notes.md` and either normalize a temporary export copy or ask before changing the source.
- Do not use bold paragraphs as fake headings when the Markdown already has heading syntax.

## Spacing and rhythm

- Use whitespace between sections, not borders or boxes.
- Keep paragraphs compact: no first-line indent, no double blank paragraph spacing.
- Avoid orphaned headings at the bottom of a page where the export tool supports pagination controls.
- Insert a page break before major appendices only when the source uses an Appendix section.

## Lists

- Keep bullets aligned with the paragraph text block.
- Use 4-6 mm hanging indent for bullets and numbered lists.
- Preserve nested lists, but avoid more than three nesting levels in final output.
- Use numbered lists only when order matters.

## Tables

- Use full-width tables when they contain more than two columns.
- Header row: bold text, subtle bottom border, light neutral fill (`#F3F4F6`) if supported.
- Body rows: no heavy grid. Use light horizontal rules (`#E5E7EB`) or alternating very light fills only when it improves scanning.
- Keep cell padding comfortable: 4-6 pt vertical, 6-8 pt horizontal.
- If a table is too wide, prefer landscape page only for that page/section when supported; otherwise report the limitation in `render-notes.md`.

## Code blocks

- Use monospace at 9-9.5 pt.
- Use a very light background (`#F6F8FA`) and subtle border (`#E5E7EB`) when supported.
- Preserve indentation exactly.
- Do not line-wrap code if it changes meaning; report overflow if unavoidable.

## Blockquotes and callouts

- Blockquotes: left border `#D1D5DB`, 10-12 pt left padding, no large quotation marks.
- Use callouts sparingly. If the Markdown has `> NOTE:` / `> WARNING:` lines, preserve the label and use a subtle neutral treatment.

## Links

- Preserve clickable links in DOCX/PDF when the export tool supports it.
- Use understated link styling: dark blue `#1D4ED8`, no bright cyan.
- If exporting for print, include the URL in parentheses only when the link text is not self-explanatory.

## Images

- Fit images to page width without upscaling beyond source quality.
- Keep captions directly below images.
- If image files are missing, keep the alt text and report the missing asset in `render-notes.md`.

## Export notes

Every run should write `render-notes.md` with:

- Source path
- Requested format
- Output files
- Template used
- Heading nesting warnings
- Conversion warnings
- Any source edits avoided
