# Presentation Export Style

Default house template for `/twt-export-presentation`. Use this for every Markdown-to-PPTX or Markdown-to-PDF presentation export unless the user explicitly confirms a custom template.

## Design intent

Create a minimal, sharp presentation that reads clearly on a projector and in a PDF handout. The look should be calm and editorial: strong hierarchy, generous whitespace, restrained color, and no decorative clutter.

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
| Cover | first slide, usually one `#` | large title, optional subtitle |
| Section divider | title-only slide | centered or upper-left title with large whitespace |
| Title and bullets | title plus bullets | title top-left, bullets below |
| Two-column | explicit columns or paired sections | equal columns on 16:9, stacked on 4:3 if dense |
| Image slide | title plus image | image large, caption small |
| Table slide | title plus table | simplify rows/columns; split if dense |

## Typography

Use Office-safe fonts first so PPTX remains portable:

| Role | Preferred | Fallback |
|------|-----------|----------|
| Headings | Aptos Display | Arial |
| Body | Aptos | Arial |
| Code | Cascadia Mono | Consolas |

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

- Background: `#f7f3e8` (warm cream).
- Text: `#101214`.
- Secondary text: `#363b42`.
- Accent: `#0b68b7` (doc-hub light cyan), used for section markers, links, or one emphasis element.
- Avoid gradients, shadows, decorative borders, and large color blocks unless a user-provided brand template requires them.

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

