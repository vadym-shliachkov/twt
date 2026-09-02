---
name: twt-qa
surface: command
category: qa
family: qa
role: orchestrator
unit: twt-qa
description: (v1.0.12) Run the applicable QA audits (local or live) and synthesize qa-report.md + gaps.md
version: 1.0.12
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
  - .twt-artifacts/inherited/conventions.md
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

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load** (figma, design-taste-frontend, emil-design-eng, superpowers, …), run this one Bash line so the complete skill-call tree reaches the run log:
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

## Bash call shape — keep every call allowlist-matchable
The permission rules `/twt-setup` seeds match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`); a call that doesn't match forces a manual prompt even when the binary is allowlisted. So for **every** Bash call in this run: never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`). **Present:** continue without asking (the seeder is idempotent). **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**; on run, dispatch `/twt-setup` (Agent tool), wait, continue. **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue. Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**. This gate lives only on the pipeline entry points; skills dispatched from here inherit the seeded allowlist and never re-check.

## Step 1 — Pick mode & targets
Parse `$ARGUMENTS` for an `http(s)://` URL.
- **URL present → live mode.** Applicable audits: content, links, a11y (forward the URL). Skip design and elementor (record in `skipped` with the reason "source-only").
- **No URL → local mode.** Detect subjects: if `site/` exists (or Phase-2 mockups exist) → content, design, a11y, links apply; if a `wp-content/themes/hello-elementor-*` theme exists → elementor applies; if `.twt-artifacts/inherited/conventions.md` exists (an inherit-target build) → content, design, a11y, links apply the same way, dispatched against whatever built pages the host project has — but an inherit build never creates `site/` (it writes into the host repo's own tree instead), so these audits' scanner (`locate()` in `tools/lib/sources.mjs`) can never actually resolve to the inherit build's real output. It only ever does one of two things: finds nothing (no `site/`, no Phase-2 mockup) and each audit reports nothing found — not because the build is clean, but because there was no root to read — or falls back to `.twt-artifacts/design/mockup/` and silently scores the pre-development Phase-2 mockup as though it were the built output, which reads as a confident, clean, non-empty report about the wrong artifact. **Record here whether `site/` exists** (it will not, on an inherit-only project) and carry that fact to Step 3 — this gap is specific to the inherit target; an html or Elementor build always converges on a real `site/` or theme root once built, so this caveat does not make those two targets' reports unreliable. Skip any audit whose subject is absent (record in `skipped`).
If nothing is auditable, stop: "Nothing to QA — build the site (Phase 3) or pass a live URL."

## Step 2 — Run the applicable audits (in parallel)
Dispatch every applicable audit via the Agent tool, referencing its Intent and forwarding the URL in live mode. The audits have no ordering dependency and each writes its own, disjoint `.twt-artifacts/qa/<dimension>-report.md` — so **issue all the dispatches in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Wait for all of them to finish before Step 3. _All five audits are script-driven (`qa-scan.mjs` supplies the counts, `score-rubric.mjs` the arithmetic) and each declares `model: sonnet` in its own frontmatter — when your Agent tool supports a `model` parameter, pass `sonnet` explicitly too, since a dispatched subagent otherwise inherits this orchestrator's model. Aggregation (Step 3) and the PASS/FAIL verdict stay on the session model._

## Step 3 — Aggregate `qa-report.md`
Read every report that was produced; sum BLOCKER / WARNING / SUGGESTION counts and read each audit's **Health/Band** from its Scorecard. If `design-report.md` states the audit was **skipped** (its Step 1b inherit-target guard, on a host whose styling system isn't custom properties), do not fold it into the BLOCKER/WARNING/SUGGESTION sum or the By-dimension Health/Band table as if it passed — instead add it to `skipped` with the stated reason (detected styling system + "host-specific rules not implemented yet, see `.twt-artifacts/inherited/token-map.md`") and say so plainly in the Verdict block, the same as any audit whose subject was absent. An all-zero design score on an inherit host is a **skip**, never a clean pass.

**On an inherit-target run where Step 1 recorded that `site/` did not exist**, a non-empty report from content/design/a11y/links means the audit was dispatched against `.twt-artifacts/design/mockup/`, not the inherit build's own output (`locate()`'s fallback — see Step 1). Do not present those counts as a build audit: prefix the affected dimensions' entries in **By dimension** with "(scored the Phase-2 mockup, not the inherit build's output)" and repeat the same caveat once in the **Verdict** line. This is a labeling requirement, not a skip — the findings are still real findings about the mockup, they are just not evidence about what actually got built into the host. Write `.twt-artifacts/qa/qa-report.md`:
```
---
generated: <YYYY-MM-DD>
phase: qa
mode: <local|live>
url: <url if live, else omit>
verdict: <PASS if total BLOCKER == 0, else FAIL>
targets: [<html and/or elementor and/or inherit>]
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
