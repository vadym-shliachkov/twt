---
name: twt-content-fetch-site
category: content
description: Fetch a website's content and save as clean Markdown
version: 1.1.1
accepts_arguments: true
inputs:
  - URL (homepage or full crawl up to 50 pages)
dependencies:
  hard: []
  soft:
    - WebFetch
    - twt-content-fetch
reads:
  - <url>
writes:
  - .twt-artifacts/pre-design/content-fetch/site/<domain>/index.md
  - .twt-artifacts/pre-design/content-fetch/site/<domain>/<path>/index.md
  - .twt-artifacts/pre-design/content-fetch/site/<domain>/_sitemap.md
---

# /twt-content-fetch-site

## Intent

**Purpose:** Pull a website's pages into the local working directory as clean, frontmatter-tagged Markdown — for use as reference material in copy migrations, content audits, or as input to other skills.

**Non-goals:**
- Not a full archive tool; uses WebFetch, not a real browser
- Doesn't extract structured data (tables, forms) — text only
- Doesn't follow external links

**Success criteria:**
- Output appears under `.twt-artifacts/pre-design/content-fetch/site/<domain>/`
- Every page has frontmatter (source URL, title, fetched-at)
- Crawl mode produces `_sitemap.md` indexing every file written

---

## Step 1 — Get the URL

Arguments passed to this command: $ARGUMENTS

- If `$ARGUMENTS` contains a valid URL (starts with `http://` or `https://`), use it as the target URL.
- If no URL was provided, ask the user:

  > "Please provide the URL of the website you want to fetch (e.g. https://example.com):"

  Wait for the response before continuing.

---

## Step 2 — Parse the URL

Extract the **domain** from the URL:
- `https://www.example.com/page` → domain is `www.example.com`
- `https://docs.acme.io/guide` → domain is `docs.acme.io`

The **base output directory** for all saved files will be:
```
.twt-artifacts/pre-design/content-fetch/site/<domain>/
```

---

## Step 3 — Choose fetch scope

Tell the user the resolved URL (`<url>`) and domain (`<domain>`), and that output will go to `.twt-artifacts/pre-design/content-fetch/site/<domain>/`.

Ask via the **AskUserQuestion** tool (single-select, header "Fetch scope") which scope to use:
- **Fetch homepage** — retrieve only the homepage
- **Fetch all pages** — crawl every page found under this domain (up to 50 pages)
- **You decide** — I pick the fitting scope (all pages for a multi-page site, homepage for a single landing page)

Record the choice and continue.

---

## Step 4a — Option 1: Fetch Homepage

1. Use the **WebFetch** tool to fetch the target URL.
2. Convert the raw content to clean Markdown:
   - Keep: headings (h1–h6), paragraphs, lists, tables, code blocks, links, bold/italic
   - Remove: navigation, header, footer, sidebar, ads, scripts, styles
   - Prefer content inside `<main>`, `<article>`, or `.content` elements
3. Determine the output file path:
   - Root URL (`/`) → `index.md`
   - Any other URL → map to its path (see §Path mapping below)
4. Create all intermediate directories as needed.
5. Write the file using this format:

```markdown
---
url: <original-url>
title: <page-title>
fetched_at: <YYYY-MM-DD>
---

<clean markdown content>
```

6. Report to the user:
   ```
   ✓ Homepage saved → .twt-artifacts/pre-design/content-fetch/site/<domain>/index.md
   ```

---

## Step 4b — Option 2: Fetch All Pages

Run this crawl algorithm:

### Initialise
```
visited  = []          # URLs already fetched
queue    = [<url>]     # URLs yet to fetch
max      = 50          # hard page limit
```

### Loop — while queue is not empty AND len(visited) < max

For each URL in the queue:

1. Skip if already in `visited`.
2. Use **WebFetch** to fetch the URL.
3. Convert HTML to clean Markdown (same rules as Option 1).
4. Determine the output file path (see §Path mapping).
5. Write the file (same frontmatter format as Option 1).
6. Add URL to `visited`.
7. Extract all `<a href="...">` links from the raw page content.
8. Filter links — keep only **internal links** (same domain). See §Link filtering.
9. Add any unvisited internal links to `queue`.
10. Print progress:
    ```
    [3/50] Fetched: /about → .twt-artifacts/pre-design/content-fetch/site/<domain>/about/index.md
    ```

### After the loop completes

Create `.twt-artifacts/pre-design/content-fetch/site/<domain>/_sitemap.md`:

```markdown
---
domain: <domain>
crawled_at: <YYYY-MM-DD>
total_pages: <count>
---

# Site Map: <domain>

| Page | File |
|------|------|
| <url> | <file-path> |
...
```

Report the summary:
```
✓ Crawl complete
  Domain : <domain>
  Pages  : <count> fetched
  Output : .twt-artifacts/pre-design/content-fetch/site/<domain>/
  Index  : .twt-artifacts/pre-design/content-fetch/site/<domain>/_sitemap.md
```

---

## Path Mapping

Convert a URL path to a file path under the domain folder:

| URL path              | File path                          |
|-----------------------|------------------------------------|
| `/`                   | `index.md`                         |
| `/about`              | `about/index.md`                   |
| `/about/team`         | `about/team/index.md`              |
| `/blog/my-post`       | `blog/my-post/index.md`            |
| `/page.html`          | `page/index.md`                    |
| `/docs/api.html`      | `docs/api/index.md`                |

Strip query strings and fragments from URLs before mapping.

---

## Link Filtering (for Option 2)

**Include** a link if it meets ANY of these:
- Starts with `/` (relative path on the same site)
- Is an absolute URL with the same hostname as the target domain

**Exclude** a link if it matches ANY of these:
- Different hostname (external site)
- Starts with `mailto:`, `tel:`, `javascript:`
- Is a pure fragment (`#anchor`)
- Ends with `.pdf`, `.zip`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.webp`, `.css`, `.js`, `.ico`, `.woff`, `.woff2`, `.ttf`
- Contains `/wp-admin`, `/wp-login`, `/login`, `/logout`, `/signin`, `/signout`

---

## Content Conversion Rules

When converting HTML to Markdown:
- Map `<h1>`–`<h6>` → `#`–`######`
- Map `<ul>`/`<li>` → `- item`
- Map `<ol>`/`<li>` → `1. item`
- Map `<a href="...">text</a>` → `[text](href)`
- Map `<code>` → backtick inline code
- Map `<pre><code>` → fenced code block
- Map `<table>` → Markdown table
- Map `<strong>`/`<b>` → `**bold**`
- Map `<em>`/`<i>` → `_italic_`
- Strip: `<nav>`, `<header>`, `<footer>`, `<aside>`, `<script>`, `<style>`, elements with class containing `nav`, `menu`, `sidebar`, `ad`, `advertisement`, `cookie`, `banner`, `popup`
