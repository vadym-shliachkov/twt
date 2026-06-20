---
name: twt-content-fetch
category: content
description: (v1.0.0) Detect provided sources and dispatch to the right content-fetch sub-skill
version: 1.0.0
accepts_arguments: true
inputs:
  - Any mix of site URLs, PDF paths, and document paths/URLs
dependencies:
  hard: []
  soft:
    - twt-content-fetch-site
    - twt-content-fetch-pdf
    - twt-content-fetch-doc
reads:
  - <provided sources>
writes:
  - .twt-artifacts/pre-design/content-fetch/_manifest.md
---

# /twt-content-fetch

## Intent

**Purpose:** Single entry point for content ingest. Detects what kind of sources the user provided and dispatches each to the matching source-specific fetch skill, then writes a manifest of everything ingested.

**Non-goals:**
- Doesn't fetch anything itself — pure dispatcher (delegates to `-site` / `-pdf` / `-doc`)
- Doesn't curate, judge, or restructure content (that's `/twt-curation`)
- Not a validator — there is no validate step in this sub-area

**Success criteria:**
- Every provided source is routed to exactly one sub-skill
- `_manifest.md` lists each source, its type, the sub-skill used, and the output folder
- Unrecognized sources are reported, not silently skipped

---

## Step 1 — Gather sources
Use `$ARGUMENTS` if provided. Otherwise ask: "List the sources to ingest — site URLs, PDF paths, and/or document paths/URLs (one per line):". Wait.

## Step 2 — Classify each source
- starts with `http://`/`https://` and not a Google Doc → **site**
- ends with `.pdf` → **pdf**
- ends with `.docx`/`.doc`/`.md`/`.txt`, or is a Google Doc URL → **doc**
- otherwise → **unrecognized** (collect for the report; do not dispatch)

## Step 3 — Dispatch (in parallel)
For each classified source, use the Agent tool to invoke the matching sub-skill (`/twt-content-fetch-site`, `/twt-content-fetch-pdf`, or `/twt-content-fetch-doc`), passing the source as its argument. Per CONVENTIONS rule 5, dispatch — do not reproduce the sub-skill's logic. Each source writes to its own disjoint output folder (`site/<domain>/`, `pdf/<filename>/`, `doc/<filename>/`), so there is no write conflict: **issue all the dispatches in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Wait for all of them to finish before writing the manifest.

## Step 4 — Write the manifest
Write `.twt-artifacts/pre-design/content-fetch/_manifest.md`:
```
---
generated: <YYYY-MM-DD>
sources: <count>
---

# Content ingest manifest

| Source | Type | Skill | Output |
|--------|------|-------|--------|
| <src> | site/pdf/doc | /twt-content-fetch-<type> | <output folder> |

## Unrecognized
- <src> — reason
```

## Step 5 — Report
Summarize: counts per type, output folders, unrecognized sources, and that downstream define skills will read from `.twt-artifacts/pre-design/content-fetch/`.
