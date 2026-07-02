# Document Export Style

> Applied styling now comes from templates/house-style.css (+ house-doc.css / house-slide.css) and templates/reference.docx / reference.pptx. This file documents the intended look.

Default house template for `/twt-export-pdf` and `/twt-export-docx`. Use this on every Markdown-to-PDF or Markdown-to-DOCX export unless the user explicitly confirms a custom template.

## Design intent

Produce a quiet, editorial document: readable, compact, and professional without decorative framing. The design should feel like a careful strategy/report handoff, not a slide deck or marketing page.

It shares the **doc-hub light** design language used by the design-system preview and audit reports: a clean white page, near-black ink headings, cool-grey body text, hairline rules, and one restrained tri-color (red/blue/yellow) accent. Keep the accent to a single thin rule under the document title — never large color blocks, shapes, or shadows in a document.

## Color palette (doc-hub light)

| Role | Token | Value |
|------|-------|-------|
| Page background | surface | `#ffffff` |
| Soft panel fill (tables/code) | panel-soft | `#f8f9fc` |
| Ink (headings, strong text) | ink | `#090e22` |
| Body text | text | `#3a3f5c` |
| Secondary / captions | muted | `#7a82a8` |
| Hairline rules / borders | rule | `#dde0ee` |
| Accent — primary (links, blockquote) | blue | `#0b68b7` |
| Accent — signature triad | red · blue · yellow | `#ca221f` · `#0b68b7` · `#f6c22b` |

Headings use ink (`#090e22`); body uses text (`#3a3f5c`); captions/footnotes use muted (`#7a82a8`). Do not color headings unless the source document already defines a brand palette.

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
| Headings | Montserrat, Inter, Aptos Display | Arial |
| Body | Inter, Source Sans 3, Segoe UI | Arial |
| Code | IBM Plex Mono, JetBrains Mono, Cascadia Mono | Consolas |

Headings are set in Montserrat at semibold–bold (600–800); body in Inter at regular. If the source is a long-form serif-leaning report and the user prefers a serif body, Source Serif 4 / Charter / Georgia is an acceptable body substitute — but keep Montserrat headings either way.

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

Ink headings (`#090e22`) and body text (`#3a3f5c`) on a white page (`#ffffff`); secondary text uses `#7a82a8`. See the **Color palette** section above. Avoid colored headings unless the source document already defines a brand palette.

## Title treatment

- The document title (`#`) sets in Montserrat at the H1 size, ink color.
- Place a single thin tri-color accent rule directly beneath the title: a ~72 pt-wide, ~4 pt-tall bar split into three equal segments — red (`#ca221f`) · blue (`#0b68b7`) · yellow (`#f6c22b`). This is the one signature flourish; use it once, on the title only.
- No accent bars under H2/H3 in documents (that is reserved for the bolder presentation style).

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
- Header row: Montserrat semibold text, subtle bottom border, light panel fill (`#f8f9fc`) if supported.
- Body rows: no heavy grid. Use hairline horizontal rules (`#dde0ee`) or alternating very light fills only when it improves scanning.
- Keep cell padding comfortable: 4-6 pt vertical, 6-8 pt horizontal.
- If a table is too wide, prefer landscape page only for that page/section when supported; otherwise report the limitation in `render-notes.md`.

## Code blocks

- Use IBM Plex Mono (or fallback) at 9-9.5 pt.
- Use a very light panel background (`#f8f9fc`) and a hairline border (`#dde0ee`) when supported.
- Preserve indentation exactly.
- Do not line-wrap code if it changes meaning; report overflow if unavoidable.

## Blockquotes and callouts

- Blockquotes: left border `#0b68b7`, 10-12 pt left padding, no large quotation marks.
- Use callouts sparingly. If the Markdown has `> NOTE:` / `> WARNING:` lines, preserve the label and use a subtle neutral treatment.

## Links

- Preserve clickable links in DOCX/PDF when the export tool supports it.
- Use understated link styling: `#0b68b7`, matching the doc-hub light accent.
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
