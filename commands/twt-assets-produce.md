---
name: twt-assets-produce
category: assets
description: (v1.0.1) Fulfill the asset manifest — ingest provided files, generate placeholders, favicon/OG set, icon SVGs
version: 1.0.1
accepts_arguments: true
inputs:
  - Optional path(s) to provided asset files/folders; optional row scope (filenames or a page slug)
dependencies:
  hard: []
  soft:
    - twt-layout-define
    - twt-mockup-define
    - twt-block-preview
    - WebFetch
reads:
  - $ARGUMENTS (provided-asset paths, row scope)
  - .twt-artifacts/design/assets/manifest.md
  - .twt-artifacts/pre-design/curation/facts.md
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/pre-design/positioning/positioning.md
writes:
  - .twt-artifacts/design/assets/img/
  - .twt-artifacts/design/assets/video/
  - .twt-artifacts/design/assets/icons/
  - .twt-artifacts/design/assets/meta/
  - .twt-artifacts/design/assets/manifest.md
  - .twt-artifacts/design/assets/production-report.md
  - .twt-artifacts/design/assets/decisions.md
---

# /twt-assets-produce

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by `/twt-develop` or another orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load**, run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Close the asset loop the manifest opens: for every row in `.twt-artifacts/design/assets/manifest.md`, either ingest the provided file, generate a brand-tokened placeholder (including the favicon/OG meta set and the design system's icon SVGs), or produce a concrete human to-do (stock briefs, missing files) — so mockups render, Development has real files to copy, and QA's MISSING-ASSET findings become an actionable checklist instead of noise.

**Non-goals:**
- Doesn't write into a build target (`site/`, a theme) — `/twt-develop` syncs the produced pool into the build it owns
- Doesn't download stock imagery or anything with unknown licensing — stock rows get a search brief, never a fetched binary
- Doesn't fabricate real-world imagery: headshots, client logos, office/product photos of real subjects must be `source: provided`; a missing one is flagged, never faked
- Doesn't edit mockup pages, layouts, or any upstream artifact — it verifies references resolve and reports mismatches
- Doesn't plan assets (that's `/twt-layout-define` Step 5 / `/twt-mockup-define` Step 6); it only appends the site-wide meta rows (favicon, OG) when planning missed them
- Doesn't overwrite a provided real asset with a placeholder — provided always wins

**Success criteria:**
- Every manifest row ends the run with a `status` — `provided` / `generated` / `pending-stock` / `pending-video` / `missing-provided` — and no row is silently skipped
- Every `generated` file exists in the pool (`.twt-artifacts/design/assets/img|video|icons|meta/`) under the **exact manifest `filename`**, styled from `tokens.css` values only
- The meta set exists: `meta/favicon.svg` (plus PNG rasterizations when playwright is available) and `meta/og-default.png` (or the flagged SVG fallback)
- When `tokens.md` §2.8 names an icon family, every icon name used by `components.md`/mockups exists in `icons/` as an SVG from that one family
- `production-report.md` states counts per status, every human to-do (stock briefs, files to supply), and the mockup-reference resolution result
- Idempotent: re-runs touch only rows that are still unfulfilled or explicitly re-scoped; existing `provided`/`generated` files are never regenerated without consent (rule 10)

---

Arguments passed to this command: $ARGUMENTS

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Dependency check & inputs
Read `.twt-artifacts/design/assets/manifest.md`. If it's missing, abort: "No asset manifest — run /twt-layout-define (or /twt-mockup-define) first; they plan the assets this skill produces."

Then load the styling and provenance inputs, whichever exist:
- `.twt-artifacts/design/design-system/tokens.css` + `tokens.md` — the **only** source of colors, type, radii, and (§2.8) the icon family. If neither exists, abort: "No design system — run /twt-design-system first; placeholders must be built from tokens, not invented values."
- `.twt-artifacts/pre-design/curation/facts.md` — the provided-assets ledger (which real files exist, and where).
- `.twt-artifacts/design/design-system/component/components.md` and the mockup pages (Glob `.twt-artifacts/design/mockup/pages/*.html`) — to collect the icon names actually used.
- `.twt-artifacts/pre-design/positioning/positioning.md` — tagline/name for the OG card, when present.

Parse `$ARGUMENTS` for provided-asset paths (files or a folder the user is handing over) and an optional row scope (specific filenames, or a page slug limiting to that page's rows).

## Step 2 — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Produce everything producible without a human (generate rows, meta set, icons; provided rows whose file the ledger locates), and for every choice you would otherwise have asked about — a provided row whose file can't be found, a raster row that can't be rasterized, an ambiguous OG tagline — add an entry to `.twt-artifacts/design/assets/decisions.md` (decisions.md format — frontmatter `generated`/`area: assets`/`producer: twt-assets-produce`/`status: open`; sections `## Open questions` (question — options [a,b,c] — model-leaning, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (field = value — basis — reversible), `## Proposed rules (confirm before binding)`). After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes. Return the decisions block in your report. **Stay in-project:** never read outside this project; every format you need is in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them — ingest the newly named files, regenerate only the rows the answers change — set `decisions.md` `status: resolved`, and finalize.

## Step 3 — Reconcile the manifest
Read the manifest table (columns `id | type | filename | placement | spec | alt | source | generation_prompt | status`; older manifests lack `status` — add the column, defaulting every row to `planned`).

- **Ensure the site-wide meta rows exist** (append if planning missed them, dedupe by `filename`): a favicon row (`meta/favicon.svg`, placement `site → head → favicon`, `source: provided` when the facts-ledger has a logo/mark, else `generate`) and a default OG-image row (`meta/og-default.png`, 1200×630, placement `site → head → og:image`, `source: generate`). Do **not** invent per-page OG rows — that stays a planning (layout-define) decision.
- Respect the row scope from `$ARGUMENTS` when given; otherwise process every row whose `status` is `planned`, `missing-provided`, or `pending-*`. Rows already `provided`/`generated` are **skipped** — regenerating one requires the user explicitly naming it (rule 10).

## Step 4 — Ingest provided assets
For each in-scope row with `source: provided`:
1. Locate the file: a path from `$ARGUMENTS`, the facts-ledger's provided-assets table, or (interactive only) a plain-text prompt: "Where is `<filename>` (path or folder)?" In collect mode an unlocatable file becomes an open question in `decisions.md`.
2. **Copy** (never move — the user's file stays where it is) into the pool: `.twt-artifacts/design/assets/img/` or `video/` (or `meta/` for logo-derived favicon sources), under the **exact manifest `filename`**. One simple `cp "<src>" "<dest>"` per file (Bash) — no loops, no chains.
3. If the found file's format/dimensions contradict the row's `spec`, keep the file as-is and note the mismatch in the report — never convert or crop silently.
4. Set the row `status: provided` — or `missing-provided` when the file can't be found, with the row listed in the report's human to-do.

## Step 5 — Generate placeholder assets
For each in-scope row with `source: generate` (`type: image`):
- Hand-write (Write tool) a **self-contained SVG** at the row's aspect ratio, art-directed by its `generation_prompt` and built **only** from `tokens.css` values — palette colors/gradients, the radius scale, geometric composition consistent with the design read. No lorem text baked into imagery, no hand-rolled logos or wordmarks (that's a provided asset or nothing), no fake browser/UI screenshots.
- If the manifest `filename` is already `.svg`, write it directly at `img/<filename>`.
- If the `filename` is raster (`.png`/`.jpg`/`.webp`), rasterize: write the SVG to the pool as `img/<basename>.svg`, wrap it in a minimal HTML page sized to the row's `spec`, and screenshot it to the exact `filename` — `node "${CLAUDE_PLUGIN_ROOT}/tools/ds-block-preview.mjs" --file "<wrapper.html>" --out "<img/filename>" --width <w> --height <h>` (playwright). If playwright is unavailable (exit 2), keep the `.svg` twin, set `status: generated`, and record in the report that the raster `filename` still needs rasterizing (`npm install playwright`) — do not fail the run.
- Set `status: generated`.

For `type: video` rows: generate a poster image (`video/<basename>-poster` + the SVG/raster rules above) so the slot isn't blank, leave `status: pending-video`, and add the row to the human to-do — a real video file must be supplied.

## Step 6 — Stock briefs (never downloads)
For each in-scope row with `source: stock`: do **not** fetch anything — licensing is the human's call. Write a **stock brief** into the report: the search query (derived from `generation_prompt`), subject, orientation/dimensions from `spec`, and the exact pool path to save the licensed file to (`img/<filename>`). Set `status: pending-stock`. If the user later supplies the file, a re-run ingests it via Step 4 rules.

## Step 7 — Meta set (favicon + OG)
Produce into `.twt-artifacts/design/assets/meta/`:
- **Favicon.** From a provided logo/mark in the ledger, derive `favicon.svg` (the mark cropped square, no wordmark). With no provided mark, build a monogram: the brand initial set in the §2.2 heading family on a token surface color, one radius from the scale. When playwright is available, rasterize `favicon-32.png` and `apple-touch-icon.png` (180×180) from it via `ds-block-preview.mjs` as in Step 5; otherwise note the SVG-only state in the report.
- **OG default.** Compose a minimal 1200×630 card (brand name + tagline from positioning/facts, token colors/type only, no imagery that doesn't exist) as HTML, rasterize to `og-default.png`. Without playwright, write `og-default.svg`, keep the row `status: generated` with a report note that the PNG needs rasterizing (most platforms won't render SVG OG images).
Set the meta rows' `status` accordingly.

## Step 8 — Icon set
If `tokens.md` §2.8 (Iconography) names an icon family: collect the icon names in use — the icon Primitives inventoried in `components.md` and any icon references in the mockup pages (Grep the pages for `data-icon`/icon class names/inline `<svg>` slots). For each needed name:
- Fetch the official SVG for that name **from the named family only** (WebFetch against the family's published SVG source, e.g. its unpkg/jsDelivr package or repo raw files) and write it to `icons/<icon-name>.svg`, normalized to `currentColor` strokes/fills so token colors apply.
- If fetching is unavailable (offline / WebFetch denied), hand-draw a minimal SVG **matching the family's grid and stroke weight** recorded in §2.8, and flag it `(approximation)` in the report — never substitute a different family's glyph.
If `tokens.md` has no §2.8, skip this step and note in the report that the design system predates icon-family selection (re-run `/twt-design-system-define` in refinement mode to add it).

## Step 9 — Update the manifest + verify references
Rewrite the manifest table with the updated `status` per row (Edit tool — preserve all other columns byte-for-byte; append-only for new meta rows; dedupe by `filename`).

Then verify the mockups actually resolve: run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/tools/scan-manifest.mjs" "$CLAUDE_PROJECT_DIR/.twt-artifacts/design/mockup"` and compare its `[{src, exists}]` output against the pool — every reference that now resolves is a win to report; every reference that still points somewhere other than `../../assets/<dir>/<filename>` (relative to `mockup/pages/`) is a **reference mismatch** to list for `/twt-mockup-define` refinement (this skill never edits pages).

Write `.twt-artifacts/design/assets/production-report.md`:
```
---
generated: <YYYY-MM-DD>
phase: design
area: assets
---

# Asset production report

## Summary
| Status | Count |
|--------|-------|
| provided / generated / pending-stock / pending-video / missing-provided | n |

## Produced
<one line per file written: pool path — row id — how (ingested/SVG/rasterized)>

## Human to-do
<stock briefs (query · spec · save-to path); missing provided files; video files to supply; rasterizations pending playwright — or "none">

## Mockup references
<resolved count; reference mismatches for /twt-mockup-define — or "all resolve">
```

## Step 10 — Report
State: rows fulfilled per status, the pool paths written, the meta set and icon family results, every human to-do, and what to run next — `/twt-mockup-define` refinement if references mismatch, `/twt-develop` to sync the pool into the build, or nothing if all rows are `provided`/`generated`.
