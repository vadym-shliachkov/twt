---
name: twt-search-site
category: search
description: (v1.1.1) Search a website for an exact string via the bundled crawler; report page links with ±100 chars of context per match
version: 1.1.1
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

Confirm to the user (informational, no question): the search string, the site, and that the report will be written to `.twt-artifacts/search/<domain>/search-report-<query-slug>.md`.

## Step 2 — Run the crawler script

The crawl, text extraction, and substring matching are **deterministic**, so they are delegated to the bundled crawler — fetching up to 50 pages through the model wastes tokens and gives non-reproducible snippets. Run (Bash, single command):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/site-crawl.mjs" search "<search-string>" "<site-url>"
```

The script crawls internal pages breadth-first from the URL (same hostname only; query strings/fragments stripped; asset files, auth paths, and `mailto:`/`tel:`/`javascript:` links excluded; hard cap 50 pages — pass `--max <n>` to change it), matches the string **case-insensitively** against each page's visible text, and writes the full report itself (frontmatter, per-page match snippets with the match in bold and `…` truncation marks, a "Pages scanned without matches" section, and an "Unreachable pages" section when fetches failed — max 20 snippets per page with a `(+N more)` note). It prints per-page progress to stderr and a final JSON summary to stdout: `report_path`, `pages_scanned`, `pages_with_matches`, `total_matches`, `cap_hit`, `unreachable[]`.

**Fallback (script unavailable):** if the plugin root or Node is missing, fall back to crawling with the **WebFetch** tool (same link rules and 50-page cap), matching case-insensitively in each page's visible text, and writing the same report format yourself — note in the report that it was produced via the fallback path.

## Step 3 — Report

From the script's JSON summary, tell the user:
- The report path (`.twt-artifacts/search/<domain>/search-report-<query-slug>.md`)
- Totals: pages scanned, pages with matches, total matches
- Whether the 50-page cap was hit (the site may have unscanned pages) and any unreachable pages
- Suggested next step: open the report; re-run with a deeper start URL (or `--max`) to cover a capped section of the site
