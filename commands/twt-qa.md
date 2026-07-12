---
name: twt-qa
category: qa
description: (v1.0.5) Run the applicable QA audits (local or live) and synthesize qa-report.md + gaps.md
version: 1.0.5
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
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Pick mode & targets
Parse `$ARGUMENTS` for an `http(s)://` URL.
- **URL present → live mode.** Applicable audits: content, links, a11y (forward the URL). Skip design and elementor (record in `skipped` with the reason "source-only").
- **No URL → local mode.** Detect subjects: if `site/` exists (or Phase-2 mockups exist) → content, design, a11y, links apply; if a `wp-content/themes/hello-elementor-*` theme exists → elementor applies. Skip any audit whose subject is absent (record in `skipped`).
If nothing is auditable, stop: "Nothing to QA — build the site (Phase 3) or pass a live URL."

## Step 2 — Run the applicable audits (in parallel)
Dispatch every applicable audit via the Agent tool, referencing its Intent and forwarding the URL in live mode. The audits have no ordering dependency and each writes its own, disjoint `.twt-artifacts/qa/<dimension>-report.md` — so **issue all the dispatches in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Wait for all of them to finish before Step 3.

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

## Wiki harvest — capture this phase's decisions (skip if no wiki)
Use Glob to check whether `.project-wiki/` exists at the project root (`$CLAUDE_PROJECT_DIR/.project-wiki/`) — never a shell command. If it does not exist, skip this step silently: the wiki is opt-in, and this must not change behavior for a project that hasn't adopted it.

If it exists, run the harvester (Bash, single command) to pull this phase's decision-bearing content into the inbox:
`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-harvest.mjs" "$CLAUDE_PROJECT_DIR"`

It scans `.twt-artifacts/` for open items in every `decisions.md`, every status row in `facts.md` (the ledger's only path into the wiki — resolved facts must survive artifact deletion, not just CONFLICTs), BLOCKER findings in each `validation-report.md`, and session-log Q&A, then appends decision-bearing entries to `.project-wiki/inbox.md` and adds a `sources.md` row for everything else. It is idempotent (tracked in `.project-wiki/.harvest-state.json`, so a re-run never re-adds what's already there) and always exits 0, printing a one-line summary such as `3 harvested, 5 already present. 12 inbox entries pending curation.` — a harvest problem must never fail or block this phase; if the tool errors for any reason, note it and continue to the Report step regardless.

Carry the harvester's summary line into this phase's Report step. **This is capture, not curation (§17):** it only appends to the inbox — no curated page (`decisions/`, `entities/`, `ideas/`, `facts.md`, `open-questions.md`, `glossary.md`, `index.md`, `overview.md`) is written here, and none should be. Turning inbox entries into a cited page is a separate, user-invoked step — point to `/twt-wiki` — never do it as part of this run.

## Step 5 — Report
State the mode, which audits ran and which were skipped (with reasons), the verdict + counts, and the two output paths. If BLOCKERs remain, surface them and remind the user QA never auto-fixes — they resolve, then re-run.
