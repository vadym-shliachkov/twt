---
name: twt-content-fetch
category: content
description: (v1.1.2) Detect provided sources (site, PDF, doc, Figma) and dispatch to the right content-fetch sub-skill
version: 1.1.2
accepts_arguments: true
inputs:
  - Any mix of site URLs, PDF paths, document paths/URLs, and Figma links
dependencies:
  hard: []
  soft:
    - twt-content-fetch-site
    - twt-content-fetch-pdf
    - twt-content-fetch-doc
    - twt-content-fetch-figma
reads:
  - <provided sources>
writes:
  - .twt-artifacts/pre-design/content/fetched/_manifest.md
---

# /twt-content-fetch

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by `/twt-site` or another orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch in the steps below** — twt sub-skills **and** any external skill you load (figma, design-taste-frontend, emil-design-eng, superpowers, …) — run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Single entry point for content ingest. Detects what kind of sources the user provided and dispatches each to the matching source-specific fetch skill, then writes a manifest of everything ingested.

**Non-goals:**
- Doesn't fetch anything itself — pure dispatcher (delegates to `-site` / `-pdf` / `-doc` / `-figma`)
- Doesn't curate, judge, or restructure content (that's the curation step — `/twt-curation-define`)
- Not a validator — there is no validate step in this sub-area

**Success criteria:**
- Every provided source is routed to exactly one sub-skill
- `_manifest.md` lists each source, its type, the sub-skill used, and the output folder
- Unrecognized sources are reported, not silently skipped

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Gather sources
Use `$ARGUMENTS` if provided. Otherwise ask: "List the sources to ingest — site URLs, PDF paths, document paths/URLs, and/or Figma links (one per line):". Wait.

## Step 2 — Classify each source
- contains `figma.com` (a `/design/…` or `/file/…` URL) → **figma**
- starts with `http://`/`https://` and not a Google Doc or Figma URL → **site**
- ends with `.pdf` → **pdf**
- ends with `.docx`/`.doc`/`.md`/`.txt`, or is a Google Doc URL → **doc**
- otherwise → **unrecognized** (collect for the report; do not dispatch)

## Step 3 — Dispatch (in parallel)
For each classified source, use the Agent tool to invoke the matching sub-skill (`/twt-content-fetch-site`, `/twt-content-fetch-pdf`, `/twt-content-fetch-doc`, or `/twt-content-fetch-figma`), passing the source as its argument. Per CONVENTIONS rule 5, dispatch — do not reproduce the sub-skill's logic. Each source writes to its own output subfolder under `fetched/` — sites to `site/<domain>/`, PDFs **and** Word/Google docs both to `doc/<filename>/`, Figma to `figma/<file-key>/` — one folder per source file, so there is no write conflict (a PDF and a doc that slugify to the same `<filename>` are the only collision case): **issue all the dispatches in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Wait for all of them to finish before writing the manifest.

## Step 4 — Write the manifest
Write `.twt-artifacts/pre-design/content/fetched/_manifest.md`:
```
---
generated: <YYYY-MM-DD>
sources: <count>
---

# Content ingest manifest

| Source | Type | Skill | Output |
|--------|------|-------|--------|
| <src> | site/pdf/doc/figma | /twt-content-fetch-<type> | <output folder> |

## Unrecognized
- <src> — reason
```

## Step 5 — Report
Summarize: counts per type, output folders, unrecognized sources, and that downstream define skills will read from `.twt-artifacts/pre-design/content/fetched/`.
