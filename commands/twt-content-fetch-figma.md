---
name: twt-content-fetch-figma
category: content
description: (v1.0.1) Extract a Figma file's visible text content and save as clean Markdown
version: 1.0.1
accepts_arguments: true
inputs:
  - A Figma file or frame URL (figma.com/design/… or figma.com/file/…, with or without a node-id)
dependencies:
  hard: []
  soft:
    - twt-content-fetch
reads:
  - <figma-url> (via the Figma MCP read tools)
writes:
  - .twt-artifacts/pre-design/content/fetched/figma/<file-key>/<frame-slug>/index.md
  - .twt-artifacts/pre-design/content/fetched/figma/<file-key>/_index.md
---

# /twt-content-fetch-figma

## Intent

**Purpose:** Pull a Figma design's **visible text content** — headings, body copy, button/CTA labels, nav items, microcopy, list items, and any captured link/media labels — into the working directory as clean, frontmatter-tagged Markdown, the same shape the other `content-fetch` skills produce. This lets a Figma file feed brand, positioning, IA, curation, and the content-approval checklist exactly like fetched site or PDF content.

**Non-goals:**
- Not a design importer — it does **not** extract tokens, components, layout, or build anything (that's the Design phase / `/twt-site-dev`). It captures **text content only**.
- Doesn't approve, curate, or rewrite copy — placeholder/lorem text is captured as-is so a human can judge it later (curation / content-approval).
- Doesn't write into Figma — read-only. (`use_figma` and its mandatory `figma-use` skill are not needed here.)

**Success criteria:**
- Output appears under `.twt-artifacts/pre-design/content/fetched/figma/<file-key>/`, one Markdown file per top-level frame/page/screen.
- Every file has frontmatter (source Figma URL, frame name, node-id, fetched-at).
- Lorem ipsum / placeholder copy is preserved verbatim and flagged, not silently dropped.
- An `_index.md` lists every frame written, so downstream skills (and `/twt-content-fetch`) can discover the set.

---

Arguments passed to this command: $ARGUMENTS

## Step 1 — Get the Figma URL

- If `$ARGUMENTS` contains a `figma.com` URL (`/design/…` or `/file/…`, with or without `?node-id=…`), use it.
- Otherwise ask (plain text, free-form): "Paste the Figma file or frame URL to fetch content from (e.g. https://www.figma.com/design/ABC123/Project?node-id=1-2):". Wait for the answer.

Parse the URL: the path segment after `/design/` or `/file/` is the **file key**; a `node-id` query param (if present) scopes the fetch to that frame/section. Derive a kebab-case `<file-key>` folder name from the file key (and the human file name when available). The base output directory is:
```
.twt-artifacts/pre-design/content/fetched/figma/<file-key>/
```

## Step 2 — Read the structure from Figma

Use the **Figma MCP read tools** (no `figma-use` needed — these are read-only):
1. Call **`get_metadata`** on the file/node URL to get the node tree — page → frame/screen → layers, with each text node's name and string. This is the cheap structural pass: it tells you what frames exist and what text they contain.
2. For any frame where `get_metadata` doesn't surface the full copy, call **`get_design_context`** on that frame to pull its detailed content (text strings, link/button labels, image/video layer names).
3. Optionally call **`get_screenshot`** on a frame only when you need it to disambiguate reading order or which strings are real copy vs. decorative — not for every frame.

If the URL had a `node-id`, fetch just that node's subtree. Otherwise enumerate the file's top-level frames/pages and fetch each. If the MCP returns an auth/connection error, stop and tell the user to open the file in the Figma desktop app (or connect the Figma MCP) and retry — do not invent content.

## Step 3 — Convert each frame to clean Markdown

Treat **each top-level frame / screen / page** as one output document (these usually map to real site pages). Within a frame, walk the layers in visual reading order (top→bottom, then left→right) and convert:
- Largest/heading-styled text → `#`/`##`/`###` by relative hierarchy.
- Body text blocks → paragraphs; bulleted/numbered layer groups → Markdown lists.
- Button / CTA / link layers → `[label](url)` when a URL is captured, else `**label**` with a note `(link target not set in Figma)`.
- Image/video/icon layers → a line noting the asset and its layer name (`> image: hero-photo` / `> video: demo-embed`) — name only, no binary export.
- Preserve **lorem ipsum / placeholder copy verbatim** and append `> ⚠ placeholder copy — replace before publishing`.

Strip purely decorative layers, spacers, and duplicated component chrome (repeated nav/footer can be captured once and noted).

## Step 4 — Write the files

For each frame write `.twt-artifacts/pre-design/content/fetched/figma/<file-key>/<frame-slug>/index.md` (`<frame-slug>` = kebab-case frame name):

```markdown
---
source: <figma-url-scoped-to-this-node>
file_key: <file-key>
frame: <frame name>
node_id: <node-id>
fetched_at: <YYYY-MM-DD>
---

<clean markdown content>
```

Then write `.twt-artifacts/pre-design/content/fetched/figma/<file-key>/_index.md`:

```markdown
---
file_key: <file-key>
source: <figma-file-url>
fetched_at: <YYYY-MM-DD>
total_frames: <count>
---

# Figma content: <file name>

| Frame | Node-id | File |
|-------|---------|------|
| <frame name> | <node-id> | <relative file path> |
```

## Step 5 — Report

Summarize: file key, how many frames were written, the output folder, how many frames contained placeholder/lorem copy (flag these), and that downstream define skills + `/twt-content-approval-checklist` will read from `.twt-artifacts/pre-design/content/fetched/figma/<file-key>/`.
