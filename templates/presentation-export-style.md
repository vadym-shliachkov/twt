# Presentation Export Style

> Applied styling now comes from templates/house-style.css (+ house-doc.css / house-slide.css) and templates/reference.docx / reference.pptx. This file documents the intended look.

Default house template for `/twt-export-presentation`. Use this for every Markdown-to-PPTX or Markdown-to-PDF presentation export unless the user explicitly confirms a custom template.

## Design intent

Create a minimal, sharp presentation that reads clearly on a projector and in a PDF handout. The look should be calm and editorial: strong hierarchy, generous whitespace, restrained color, and no decorative clutter.

It shares the **doc-hub light** design language used by the design-system preview and audit reports: a clean white page, near-black Montserrat titles, cool-grey body text, hairline rules, and the signature tri-color (red/blue/yellow) accent. The deck may apply the accent a little more boldly than a document — a tri-color bar on the cover and section dividers, and gradient-pill markers on section labels — but still avoid gradients-as-fills, drop shadows, and large decorative blocks.

## Color palette (doc-hub light)

| Role | Token | Value |
|------|-------|-------|
| Slide background | surface | `#ffffff` |
| Soft panel fill (tables/code) | panel-soft | `#f8f9fc` |
| Ink (titles, strong text) | ink | `#090e22` |
| Body text | text | `#3a3f5c` |
| Secondary / labels / sources | muted | `#7a82a8` |
| Hairline rules / borders | rule | `#dde0ee` |
| Accent — primary (markers, links) | blue | `#0b68b7` |
| Accent — signature triad | red · blue · yellow | `#ca221f` · `#0b68b7` · `#f6c22b` |

## Aspect ratio

- Default: `16:9`, the common modern presentation format.
- Supported option: `4:3`, for legacy projectors or explicitly requested formats.
- In 4:3, reduce horizontal layouts, prefer stacked content, and keep side-by-side columns to two at most.

## Slide syntax

- Split slides with a horizontal rule: `---`
- First `#` heading on a slide is the slide title.
- Use `##` for section labels or internal groups only when the slide needs them.
- Bullets become body points.
- Speaker notes may use a fenced or block marker such as `::: notes`.
- Images use standard Markdown syntax: `![alt](path)`.

## Slide types

| Type | Trigger | Layout |
|------|---------|--------|
| Cover | first slide, usually one `#` | large Montserrat title, optional subtitle, thin tri-color (red/blue/yellow) accent bar beneath the title |
| Section divider | title-only slide | upper-left title with large whitespace, tri-color accent bar beneath the title |
| Title and bullets | title plus bullets | title top-left, optional gradient-pill marker before a section label, bullets below |
| Two-column | explicit columns or paired sections | equal columns on 16:9, stacked on 4:3 if dense |
| Image slide | title plus image | image large, caption small |
| Table slide | title plus table | simplify rows/columns; split if dense |

## Typography

Prefer the doc-hub fonts, but always list an Office-safe fallback so PPTX stays portable on machines without them:

| Role | Preferred | Fallback |
|------|-----------|----------|
| Headings / titles | Montserrat, Aptos Display | Arial |
| Body | Inter, Aptos | Arial |
| Code | IBM Plex Mono, Cascadia Mono | Consolas |

Titles set in Montserrat at semibold–extrabold (600–800). When embedding fonts in the PPTX is not possible, fall back to Arial cleanly rather than substituting a mismatched display face.

Default sizes for 16:9:

| Element | Size |
|---------|-----:|
| Cover title | 48-60 pt |
| Section title | 40-48 pt |
| Slide title | 30-36 pt |
| Body bullets | 20-24 pt |
| Small labels | 13-15 pt |
| Footnotes / sources | 9-11 pt |
| Code | 14-16 pt |

For 4:3, reduce title sizes by roughly 8-12% and prefer fewer words per slide.

## Color

- Background: `#ffffff` (white). Use the soft panel fill `#f8f9fc` only behind tables or code.
- Title / strong text: ink `#090e22`.
- Body text: `#3a3f5c`. Secondary text, labels, and sources: muted `#7a82a8`.
- Hairline rules / borders: `#dde0ee`.
- Primary accent: blue `#0b68b7`, used for section markers, links, or one emphasis element per slide.
- Signature accent: the tri-color triad — red `#ca221f` · blue `#0b68b7` · yellow `#f6c22b` — used only as (a) the thin accent bar under cover/section-divider titles, and (b) a small gradient pill before a section label. See **Signature accent** below.
- Avoid gradient *fills*, shadows, decorative borders, and large color blocks unless a user-provided brand template requires them.

## Signature accent

- **Title accent bar:** a thin horizontal bar (~3–4% of slide width long, ~6 px tall) directly beneath cover and section-divider titles, split into three equal segments left-to-right: red · blue · yellow.
- **Section-label pill:** an optional small rounded pill (~30 px × 6 px) before a section label, filled with a left-to-right yellow → red → blue gradient.
- Use at most one of these per slide. Body slides usually need neither — the accent marks structure (covers, dividers, section labels), not every slide.

## Spacing

- Use consistent outer margins: around 6-8% of slide width.
- Keep title and body separated by clear whitespace.
- Align content to a simple grid.
- Avoid more than three content regions per slide.

## Density rules

- Prefer 3-5 bullets per slide.
- Warn at more than 7 bullets.
- Warn at more than 120 words on one slide.
- Split dense slides instead of shrinking body text below readable size.
- Keep tables short; split wide tables across slides.

## Images

- Use images large enough to inspect.
- Preserve aspect ratio.
- Do not use decorative stock imagery unless the source asks for it.
- Missing images should be reported in render notes rather than silently ignored.

## Tables and charts

- Use sparse tables with large text.
- Avoid tiny axis labels.
- Prefer one clear takeaway per chart slide.
- If a chart cannot be rendered as an editable chart, preserve the data and report the limitation.

## Code blocks

- Use code sparingly.
- Keep code at readable size.
- Split code across slides if it is more than 12-16 lines.

## Export notes

Every run should write `render-notes.md` with:

- Source path
- Requested format
- Aspect ratio
- Output file
- Slide count
- Structure and density warnings
- Conversion warnings
- Whether the source was edited

