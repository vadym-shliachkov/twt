---
name: twt-search-site
category: search
description: (v1.0.2) Search a website for an exact string; report page links with ±100 chars of context per match
version: 1.0.2
accepts_arguments: true
inputs:
  - Search string (first argument; wrap in quotes if it contains spaces)
  - Site URL (second argument, e.g. https://example.com)
dependencies:
  hard: []
  soft:
    - WebFetch
reads:
  - <url>
writes:
  - .twt-artifacts/search/<domain>/search-report-<query-slug>.md
---

# /twt-search-site

## Intent

**Purpose:** Find every occurrence of a specific string across a website's pages and produce a report listing the exact page URLs where it appears, with up to 100 characters of surrounding text before and after each match for context. Standalone utility — not part of the four-phase pipeline.

**Non-goals:**
- Doesn't save page content as Markdown (that's `/twt-content-fetch-site`)
- Doesn't search inside binary assets (PDFs, images) or JavaScript-rendered-only content — visible HTML text only
- Doesn't modify anything on the site or in the project besides its own report file

**Success criteria:**
- A report exists at `.twt-artifacts/search/<domain>/search-report-<query-slug>.md`
- Every listed match has the exact page URL and a context snippet of up to 100 characters on each side of the matched string
- The report states how many pages were scanned, so the user knows the coverage (and the 50-page cap if hit)

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Parse arguments

Arguments passed to this command: $ARGUMENTS

Expected form: `<search-string> <site-url>` — the search string first, the site URL second.

Parsing rules:
- If the search string is wrapped in single or double quotes, take everything inside the quotes as the string.
- Otherwise, the **URL** is the last whitespace-separated token that starts with `http://` or `https://` (or looks like a bare domain, e.g. `example.com` — normalize it to `https://example.com`); everything before it is the search string.
- If the search string is missing, ask the user (plain-text prompt): "What exact string should I search for?" and wait.
- If the URL is missing, ask the user (plain-text prompt): "Which site should I search? Please provide the URL (e.g. https://example.com):" and wait.

Extract the **domain** from the URL (e.g. `https://www.example.com/about` → `www.example.com`). Build a **query slug** from the search string: lowercase, non-alphanumeric runs → `-`, trimmed, max 40 chars (e.g. `"Free shipping!"` → `free-shipping`).

Confirm to the user (informational, no question): the search string, the site, and that the report will be written to `.twt-artifacts/search/<domain>/search-report-<query-slug>.md`.

## Step 2 — Crawl the site

Crawl internal pages starting from the given URL, fetching each page **in memory** (do not save page files):

```
visited = []           # URLs already fetched
queue   = [<url>]      # URLs yet to fetch
max     = 50           # hard page limit
```

While the queue is not empty AND `len(visited) < max`:

1. Pop a URL; skip if already in `visited`.
2. Fetch it with the **WebFetch** tool, asking for the page's visible text content AND its internal links.
3. Add the URL to `visited` and keep its text for Step 3.
4. Strip query strings and fragments from extracted links, then keep only internal links — same hostname or relative paths; exclude `mailto:`, `tel:`, `javascript:`, pure fragments (`#…`), asset extensions (`.pdf`, `.zip`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.webp`, `.css`, `.js`, `.ico`, `.woff`, `.woff2`, `.ttf`), and auth paths (`/wp-admin`, `/wp-login`, `/login`, `/logout`, `/signin`, `/signout`).
5. Add unvisited internal links to the queue.
6. Print progress: `[3/50] Scanned: /about — 2 matches`.

If a fetch fails, record the URL under "Unreachable pages" and continue — never abort the whole crawl for one bad page.

## Step 3 — Search each page

For each fetched page:

1. Work on the page's **visible text** (tags, scripts, and styles stripped), with runs of whitespace collapsed to single spaces — so context snippets read as prose.
2. Find every occurrence of the search string, **case-insensitive** substring match (note this in the report; the snippet shows the page's original casing).
3. For each occurrence, capture a snippet: up to **100 characters before** the match, the **matched text in bold** (`**…**`), and up to **100 characters after**. If the match sits near the start or end of the text, take whatever is available and don't pad. Prefix/suffix the snippet with `…` when text was truncated on that side.
4. If a single page has more than 20 occurrences, record the first 20 and note `(+N more occurrences on this page)`.

## Step 4 — Write the report

Write `.twt-artifacts/search/<domain>/search-report-<query-slug>.md` (create directories as needed; overwriting a previous report for the same query is expected — it is a regenerated snapshot, not a canonical artifact):

```markdown
---
query: <search-string>
site: <url>
domain: <domain>
searched_at: <YYYY-MM-DD>
match_mode: case-insensitive substring
pages_scanned: <count>
pages_with_matches: <count>
total_matches: <count>
---

# Search report: "<search-string>" on <domain>

## Matches

### <full page URL>
1. …<up to 100 chars before>**<matched text>**<up to 100 chars after>…
2. …

### <next page URL>
…

## Pages scanned without matches

<count> pages — <collapsed list of URLs>

## Unreachable pages

- <url> — <reason>   (omit section if none)
```

If there are zero matches anywhere, still write the report with an explicit "No occurrences of `<search-string>` found across <count> scanned pages."

## Step 5 — Report

Tell the user:
- The report path (`.twt-artifacts/search/<domain>/search-report-<query-slug>.md`)
- Totals: pages scanned, pages with matches, total matches
- Whether the 50-page cap was hit (the site may have unscanned pages) and any unreachable pages
- Suggested next step: open the report; re-run with a deeper start URL to cover a capped section of the site
