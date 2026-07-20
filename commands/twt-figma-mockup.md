---
name: twt-figma-mockup
category: figma-export
description: (v1.0.0) Assemble the HTML page mockups in Figma as frames built from the pushed design-system library
version: 1.0.0
accepts_arguments: true
inputs:
  - Optional: which page(s) to export and a breakpoint hint (desktop | all)
dependencies:
  hard: []
  soft:
    - figma-mcp
    - twt-figma-design-system
reads:
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/mockup/styles.css
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/figma-export/figma-map.md
writes:
  - .twt-artifacts/figma-export/figma-map.md
  - .twt-artifacts/figma-export/mockup-report.md
  - .twt-artifacts/figma-export/decisions.md
---

# /twt-figma-mockup

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load** (figma, design-taste-frontend, emil-design-eng, superpowers, …), run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Rebuild the Phase-2 HTML page mockups (`.twt-artifacts/design/mockup/pages/*.html`) inside the project's Figma file — one frame per selected page × breakpoint — **instantiating the design-system library components** pushed by `/twt-figma-design-system` wherever a mockup section maps to a cataloged component, with the mockup's real content. Re-runs update existing page frames in place via the node-map.

**Non-goals:**
- Doesn't redesign anything — the HTML mockups are the source of truth; this exports them
- Doesn't modify `.twt-artifacts/design/` (read-only on mockups and the design system)
- Doesn't push the design system itself (that is `/twt-figma-design-system`; this skill only *offers* to dispatch it)
- Doesn't chase pixel-perfect parity with browser rendering — the target is structural + token fidelity (layout, components, type, color, spacing, real copy), not rendering quirks
- Doesn't delete anything in Figma — page frames for mockups that no longer exist are flagged as orphans in the report
- Doesn't reproduce the Figma plugin skills' Plugin-API mechanics inline — it loads `figma-use` + `figma-generate-design` and follows them

**Success criteria:**
- One Figma frame per selected page × breakpoint (desktop 1440 / tablet 768 / mobile 390), named `<page-slug> / <breakpoint>`
- When a design-system export exists, sections that map to cataloged components are **instances** of the library components (checked via the map's `### Components` keys), not detached frames
- All frame content is the mockup's real copy — never lorem
- `figma-map.md` gains/updates `### Pages` rows; `mockup-report.md` lists per-page results
- Aborts with an actionable message when mockups or the Figma MCP are missing

---

Arguments passed to this command: $ARGUMENTS

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Inputs check

Read (Glob/Read):
- `.twt-artifacts/design/mockup/pages/*.html` — **required**. If empty/absent, abort: "No page mockups found — run /twt-mockup-define first."
- `.twt-artifacts/design/mockup/styles.css` and `.twt-artifacts/design/design-system/tokens.css` — the CSS the pages link; needed to resolve token values and layout when reading the HTML.
- `.twt-artifacts/design/design-system/component/components.md` — optional (legacy read-only fallback `.twt-artifacts/design/component/components.md`, CONVENTIONS §2); used to map mockup sections to catalog components.
- `.twt-artifacts/figma-export/figma-map.md` — target file, prior design-system export (a `## Runs` row from `twt-figma-design-system`), component keys, and existing `### Pages` rows.

If `$ARGUMENTS` names pages (slugs) treat them as the page selection; `desktop` or `all` resolves the breakpoint question.

## Step 1b — Collect mode (CONVENTIONS rule 13)

If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Resolve every choice with its model default — layering: if no design-system export is recorded, dispatch `/twt-figma-design-system` (Agent tool, passing `subagent-collect`) first; pages: all; breakpoints: desktop only — and record each resolved choice in `.twt-artifacts/figma-export/decisions.md` (decisions.md format — frontmatter `generated`/`area: figma-export`/`producer: twt-figma-mockup`/`status: open`; sections `## Open questions` (question — options [a,b,c] — model-leaning, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (field = value — basis — reversible), `## Proposed rules (confirm before binding)`). After writing it, verify (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file .twt-artifacts/figma-export/decisions.md` — fix until it passes. Then continue without prompting. **Stay in-project:** never read files outside this project; every format you need is specified in this skill.

## Step 2 — Layering: is the library in Figma?

If `figma-map.md` is missing, or has no `## Runs` row from `twt-figma-design-system`, ask via **AskUserQuestion** (single-select, header "Library"):
- **Push the design system first** (recommended) — dispatch `/twt-figma-design-system` via the Agent tool (its Intent: push tokens/styles/components into Figma), wait for it, then continue with its updated map
- **Proceed without it** — pages become styled flat frames with hardcoded values instead of component instances and variable bindings
- **Cancel** — stop; report nothing was written
- **You decide** — push the design system first

If the map exists and records a target file, use that file (this keeps both exports in one Figma file). Verify connectivity (`get_metadata` on the target); on failure abort: "Figma MCP is not connected — open the Figma desktop app (and the target file) or connect the Figma MCP, then re-run." If there is no map at all and the user chose to proceed without the library, run the target-file selection exactly as `/twt-figma-design-system` Step 2 (AskUserQuestion create-new / existing / You decide; `figma-create-new-file` flow for new files) and record it in the map.

## Step 3 — Page and breakpoint selection

Unless resolved by arguments or collect mode:
1. **Pages** — AskUserQuestion (multi-select, header "Pages"): one option per `pages/*.html` (label = page slug), all pre-listed; default all. (With more than ~4 pages, offer **All pages** · **Let me pick** first, then list on "Let me pick".)
2. **Breakpoints** — AskUserQuestion (single-select, header "Breakpoints"): **Desktop only (1440)** (recommended) · **All three (1440 / 768 / 390)** · **You decide** (→ desktop only).

## Step 4 — Build the frames

Load the Figma plugin skills first — `figma-use` (mandatory before any `use_figma` call) and `figma-generate-design` — and follow their discovery + assembly workflow. This skill decides *what* to build; those skills define *how*.

Per selected page × breakpoint:
1. **Parse the mockup HTML** top-to-bottom into sections (header, hero, content sections, footer — the mockup's own structure/comments and `components.md` names guide the split).
2. **Map sections to library components** — where a section corresponds to a cataloged component (`### Components` in the map), place an **instance** of that component and set its text/media overrides from the HTML's real content. Set variant properties to match the mockup's state where the catalog defines variants.
3. **Build unmapped sections** as auto-layout frames, binding colors/spacing/radius/type to the pushed variables and styles (fall back to raw values only when no design-system export exists).
4. **Content is the mockup's real copy** — headings, body, CTAs, nav labels verbatim from the HTML; image/video slots become placeholder rectangles named after the asset (`img: hero-photo`), no binary uploads.
5. Frame naming: `<page-slug> / desktop|tablet|mobile`, width 1440 / 768 / 390, auto-layout vertical, one Figma page (canvas page) named "Mockups".
6. **Self-check:** `get_screenshot` the finished frame and compare against the mockup HTML (read the HTML again, or a rendered screenshot if one exists under `.twt-artifacts/screenshots/`) — fix material drift (missing sections, wrong order, wrong hierarchy) before moving to the next frame. Structural + token fidelity is the bar, not pixel identity.

**Re-run behavior:** a page × breakpoint already in `### Pages` → update that frame in place (re-sync sections/overrides); new selection → create and append to the map; mapped frame deleted in Figma → recreate and note it; `### Pages` rows whose mockup no longer exists → leave the frame, list under "Orphans". **Never delete Figma nodes.**

## Step 5 — Record and report

Update `figma-map.md` (same file/format as `/twt-figma-design-system` Step 5 — preserve all sections this run didn't touch): append a `## Runs` row (`twt-figma-mockup`, scope = `<n> pages × <breakpoints>`), and one `### Pages` row per frame (`<page-slug> × <breakpoint>` | frame-id).

Write `.twt-artifacts/figma-export/mockup-report.md`: frontmatter (`generated`, `skill`, `figma-file`), then per page × breakpoint: **created | updated | recreated**, which sections used component instances vs flat frames, and any self-check fixes applied; end with **Orphans** and the Figma file URL.

## Step 6 — Report

Tell the user:
- The Figma file URL and what was built (pages × breakpoints, instance coverage: "n of m sections are library instances")
- Files written/updated: `figma-map.md`, `mockup-report.md`
- Any orphans, recreated frames, or flat-frame fallbacks worth a human look
- What to do next: open the file in Figma; re-run after mockup changes to re-sync
