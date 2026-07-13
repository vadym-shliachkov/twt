---
name: twt-block-preview
category: design-system
description: (v1.0.1) Screenshot an HTML file or URL — full page or a specific CSS-selector element; also runs batch block-capture for a design-system audit dir
version: 1.0.1
accepts_arguments: true
inputs:
  - A URL (https://…) or local HTML file path, plus optional --selector, --width, --height, --wait, --out flags
  - OR --audit <dir> to run batch block-capture for an existing audit dir
dependencies:
  hard: []
  soft: []
reads:
  - $ARGUMENTS (url/file, --selector, --width, --height, --wait, --out, --audit)
  - <audit-dir>/audit.json  (batch mode only)
writes:
  - .twt-artifacts/screenshots/<slug>.png          (standalone, no selector)
  - .twt-artifacts/screenshots/<slug>-<sel>.png    (standalone, with selector)
  - <audit-dir>/visuals.json                        (batch mode)
  - <audit-dir>/shots/*.png                         (batch mode — playwright)
  - <audit-dir>/previews/*.html                     (batch mode — HTML-embed fallback)
---

# /twt-block-preview

## Intent

**Purpose:** Take a playwright-powered screenshot of any HTML file or live URL — either the whole page or a specific CSS-selector element. Also runs as a batch block-capture step for a design-system audit directory, producing `visuals.json` consumed by `ds-audit-report.mjs`.

**Non-goals:**
- Does not analyse or score the screenshot — purely a capture tool
- Does not modify the audited site or Figma file
- Does not replace the HTML-embed fallback (`ds-shots.mjs` handles that internally in batch mode)

**Success criteria:**
- Standalone: a PNG exists at the reported path; if a selector was given, only that element is captured
- Batch: `visuals.json` is written to the audit dir; the summary line reports screenshot / embed / missing counts

---

Arguments passed to this command: $ARGUMENTS

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.

## Step 1 — Parse mode

Parse `$ARGUMENTS`:
- If `--audit` is present → **batch mode** (Step 3)
- Otherwise → **standalone mode** (Step 2)

## Step 2 — Standalone mode

Extract from `$ARGUMENTS`:
- **Target**: first token that starts with `http://`, `https://`, or ends in `.html`/`.htm`; or any bare path that looks like a file.
- **`--selector <css>`** — CSS selector for a specific element (optional; omit for full-page)
- **`--width <n>`** — viewport width (default 1280)
- **`--height <n>`** — viewport height (default 900)
- **`--wait <ms>`** — extra milliseconds to wait after page load (default 0)
- **`--out <path>`** — output PNG path (optional; auto-generated if absent)

If no target is found in the arguments, ask (plain-text prompt): "Give me a URL or HTML file path to screenshot."

**Auto-generate `--out`** when not supplied:
- Slugify the target: strip `https?://`, replace non-alphanumeric runs with `-`, lowercase, max 50 chars → `<slug>`
- Slugify the selector similarly → `<sel-slug>` (omit if no selector)
- Output path: `$CLAUDE_PROJECT_DIR/.twt-artifacts/screenshots/<slug>[-<sel-slug>].png`

Ensure `.twt-artifacts/screenshots/` exists (Bash `mkdir -p`).

Run the screenshot tool:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-block-preview.mjs" \
  --url "<target>" \
  --out "<out-path>" \
  [--selector "<selector>"] \
  [--width <width>] \
  [--height <height>] \
  [--wait <wait>]
```
(Use `--file` instead of `--url` when the target is a local file path.)

Interpret exit codes:
- **Exit 0** → report: "Screenshot saved: `<out-path>`" and (if selector) "Captured element: `<selector>`"
- **Exit 2** (playwright npm not installed) → report the error output verbatim; add: "Install with: `npm install playwright && npx playwright install chromium`" — then stop
- **Exit 3** (screenshot failed) → report the error; suggest: "Check that the selector exists on the page, or try without `--selector` for a full-page shot"

## Step 3 — Batch audit mode

Extract `<dir>` from `--audit <dir>` in `$ARGUMENTS`. If missing, ask (plain-text): "Which audit directory should I generate visuals for? (must contain audit.json)"

Verify `<dir>/audit.json` exists (Glob/Read check — no shell). If absent, stop and report: "audit.json not found in `<dir>` — run /twt-design-system-audit first."

Run batch block-capture:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-shots.mjs" --out "<dir>"
```

Read the stderr output and report the summary line, e.g.: "Block visuals: 42 screenshots, 8 embeds, 3 missing (playwright+fallback)"
