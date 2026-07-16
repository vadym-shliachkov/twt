---
name: twt-qa
category: qa
description: (v1.0.6) Run the applicable QA audits (local or live) and synthesize qa-report.md + gaps.md
version: 1.0.6
accepts_arguments: true
inputs:
  - Optional http(s):// URL (live mode) or local path; else local auto-detect
dependencies:
  hard: []
  soft:
    - twt-qa-content
    - twt-qa-design
    - twt-qa-a11y
    - twt-qa-links
    - twt-qa-elementor
reads:
  - .twt-artifacts/qa/content-report.md
  - .twt-artifacts/qa/design-report.md
  - .twt-artifacts/qa/a11y-report.md
  - .twt-artifacts/qa/links-report.md
  - .twt-artifacts/qa/elementor-report.md
writes:
  - .twt-artifacts/qa/qa-report.md
  - .twt-artifacts/qa/gaps.md
---

# /twt-qa

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by `/twt-site` or another orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch in the steps below** — twt sub-skills **and** any external skill you load (figma, design-taste-frontend, emil-design-eng, superpowers, …) — run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** One-call QA: pick the mode (local files, or live crawl if a URL is given), run the applicable audits, then aggregate a `qa-report.md` (with a PASS/FAIL verdict) and synthesize a client-ready `gaps.md` punch-list of outstanding content and links.

**Non-goals:**
- Doesn't reproduce audit logic — dispatches each audit via the Agent tool (rule 5)
- Doesn't auto-fix anything — reports and stops; the human resolves BLOCKERs
- Doesn't do live performance/pixel-render checks (out of scope)

**Success criteria:**
- Runs the audits applicable to the mode and writes `qa-report.md` (verdict PASS iff total BLOCKERs == 0) and `gaps.md`
- `qa-report.md` frontmatter records `mode`, `url` (if live), `verdict`, `targets`, and `skipped` audits
- `gaps.md` lists every LOREM / EMPTY / MISSING-ASSET / DEAD-LINK / PLACEHOLDER-LINK item grouped by page

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Pick mode & targets
Parse `$ARGUMENTS` for an `http(s)://` URL.
- **URL present → live mode.** Applicable audits: content, links, a11y (forward the URL). Skip design and elementor (record in `skipped` with the reason "source-only").
- **No URL → local mode.** Detect subjects: if `site/` exists (or Phase-2 mockups exist) → content, design, a11y, links apply; if a `wp-content/themes/hello-elementor-*` theme exists → elementor applies. Skip any audit whose subject is absent (record in `skipped`).
If nothing is auditable, stop: "Nothing to QA — build the site (Phase 3) or pass a live URL."

## Step 2 — Run the applicable audits (in parallel)
Dispatch every applicable audit via the Agent tool, referencing its Intent and forwarding the URL in live mode. The audits have no ordering dependency and each writes its own, disjoint `.twt-artifacts/qa/<dimension>-report.md` — so **issue all the dispatches in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Wait for all of them to finish before Step 3. _`/twt-qa-links` is script-driven (qa-scan does the scanning) — if your Agent tool supports a `model` parameter, dispatch it on a fast/economical model (e.g. `haiku`); the other audits need judgment and inherit the parent model._

## Step 3 — Aggregate `qa-report.md`
Read every report that was produced; sum BLOCKER / WARNING / SUGGESTION counts and read each audit's **Health/Band** from its Scorecard. Write `.twt-artifacts/qa/qa-report.md`:
```
---
generated: <YYYY-MM-DD>
phase: qa
mode: <local|live>
url: <url if live, else omit>
verdict: <PASS if total BLOCKER == 0, else FAIL>
targets: [<html and/or elementor>]
skipped: [<audits not run, with reasons below>]
---

# QA report

## Verdict
<PASS|FAIL>  ·  BLOCKER: <n> · WARNING: <n> · SUGGESTION: <n>
Mode: <local|live><, URL if live>.  Skipped: <audit — reason; ...>

## By dimension
<for each audit that ran: name · Band (Health) · B/W/S counts · → link to its <dimension>-report.md>

## All BLOCKERs
<every BLOCKER finding (Where / Problem / Recommendation), grouped by dimension>
```

## Step 4 — Synthesize `gaps.md`
Collect the `## Gaps (for gaps.md)` entries from `content-report.md` and `links-report.md`. Group by page. Write `.twt-artifacts/qa/gaps.md`:
```
---
generated: <YYYY-MM-DD>
phase: qa
---

# Outstanding items (content & links)

Hand this to whoever owns content. Each item blocks a clean QA pass.

## <page>
- [ ] LOREM — <selector> — placeholder text; expected: <outline ref>
- [ ] EMPTY — <selector> — content slot empty; expected: <outline ref>
- [ ] MISSING-ASSET — <img src> — file not found
- [ ] DEAD-LINK — <href> — points nowhere
- [ ] PLACEHOLDER-LINK — <href> — needs real destination
```
If there are no gaps, write "No outstanding content or link items — all real."

## Step 5 — Report
State the mode, which audits ran and which were skipped (with reasons), the verdict + counts, and the two output paths. If BLOCKERs remain, surface them and remind the user QA never auto-fixes — they resolve, then re-run.
