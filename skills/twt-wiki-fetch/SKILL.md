---
name: twt-wiki-fetch
category: wiki
description: (v1.0.1) Ingest an external source (file, URL, doc, transcript, asset) into the project wiki's raw evidence layer
version: 1.0.1
accepts_arguments: true
inputs:
  - One or more sources — a path, a URL, a pasted note, or a folder
dependencies:
  hard: []
  soft:
    - twt-content-fetch
reads:
  - .project-wiki/AGENTS.md
  - .project-wiki/sources.md
  - .project-wiki/raw/assets.md
writes:
  - .project-wiki/raw/
  - .project-wiki/sources.md
  - .project-wiki/raw/assets.md
  - .project-wiki/log.md
---

# /twt-wiki-fetch

## Intent

**Purpose:** Bring an external source into the wiki's evidence layer: copy or register it under `.project-wiki/raw/`, and record it in `sources.md` so every later claim can cite it.

**Non-goals:**
- Does not write curated pages — no `decisions/`, `entities/`, `ideas/`, `facts.md`, `index.md`, `overview.md`. That is the curator's job alone.
- Does not interpret or synthesize. It registers evidence; it does not draw conclusions from it.
- Does not delete or edit anything already in `raw/`. Raw evidence is immutable.

**Success criteria:**
- Every requested source is either copied into `raw/` or registered in `sources.md` by path/URL.
- Every binary lands in `raw/assets/` and gets a row in `raw/assets.md`.
- `log.md` gains one ingest entry.
- No curated page changed.

---

## Step 1 — Refuse to run without a wiki
Use Glob/Read to check that `.project-wiki/AGENTS.md` exists. If it does not, stop and tell the user to run `/twt-wiki` first — that is what creates and arms the wiki. Do not create the wiki yourself.

## Step 2 — Classify each source
For each source in `$ARGUMENTS` (or ask the user for sources if none were given):

| Source | What to do |
|---|---|
| **Binary** (logo, image, PDF brand book, font) | Copy into `.project-wiki/raw/assets/` (Bash, single `cp` command — a binary isn't text, so the Read/Write file tools don't apply). Add a row to `raw/assets.md`: file · what it is · provenance · usage constraints. |
| **Meeting note / transcript / email** | Save as Markdown under `.project-wiki/raw/meetings/YYYY-MM-DD-<slug>.md`. |
| **URL, website, Google Doc, Figma file** | Dispatch `/twt-content-fetch` (Agent tool) to extract it — never reimplement extraction. Save its clean Markdown output under `.project-wiki/raw/<slug>.md`. |
| **Pasted text** | Save verbatim under `.project-wiki/raw/<slug>.md`. |
| **A file already in the repo, or a very large file** | Do **not** copy. Register it in `sources.md` by path only. |

Copy binaries and loose local files rather than linking them: a link to a file in someone's Downloads folder is a dead link within a week.

## Step 3 — Register every source
Append one row per source to the table in `.project-wiki/sources.md`:

| Source | Kind | Where | Ingested |
|---|---|---|---|
| Brand book v3 | asset | `raw/assets/brand-book-v3.pdf` | 2026-07-11 |
| acme.com | site | `raw/acme-com.md` | 2026-07-11 |

Never remove or rewrite an existing row, for any reason — not even supersession. If a source supersedes an earlier one, express that only on the **new** row's `Kind` cell (e.g. `site (supersedes acme-com)`); the old row for `acme-com` is left exactly as first registered.

## Step 4 — Log
Append to `.project-wiki/log.md`:

```
## <YYYY-MM-DD> — ingest
Ingested <n> source(s): <list>. Registered in sources.md.
```

## Step 5 — Report
Tell the user:
- Each file written, with its path
- Each source registered
- What the curator will do with it next (`/twt-wiki` runs `twt-wiki-define` to synthesize it)
