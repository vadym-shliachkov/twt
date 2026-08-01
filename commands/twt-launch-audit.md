---
name: twt-launch-audit
category: qa
description: (v1.0.0) Audit a project's readiness to go to production - what blocks the launch, what is missing, and who owns each item
version: 1.0.0
accepts_arguments: true
inputs:
  - Optional http(s):// URL for the live checks; optional --skip-interview
dependencies:
  hard: []
  soft:
    - twt-qa
    - twt-content-approval-checklist
    - twt-seo
    - twt-status
reads:
  - .twt-artifacts/qa/qa-report.md
  - .twt-artifacts/qa/gaps.md
  - .twt-artifacts/pre-design/seo/seo-map.md
  - .twt-artifacts/design/assets/manifest.md
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - .twt-artifacts/launch/answers.json
writes:
  - .twt-artifacts/launch/facts.json
  - .twt-artifacts/launch/answers.json
  - .twt-artifacts/launch/findings.json
  - .twt-artifacts/launch/launch-report.md
  - .twt-artifacts/launch/launch-report.html
  - .twt-artifacts/launch/punch-list.md
---

# /twt-launch-audit

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load** (figma, design-taste-frontend, emil-design-eng, superpowers, …), run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Answer one question about a project that thinks it is finished: **if we pushed this to production today, what breaks, what is missing, and who owns each item?** Harvest every existing report as cited evidence, scan the built output for the ship-only dimensions nothing else covers, ask the human what no file can answer, and produce a GO / GO WITH RISKS / NO-GO verdict with an owner-grouped punch list.

**Non-goals:**
- Does not deploy, publish, or change anything anywhere.
- Does not fix findings. It reports; the humans resolve, then re-run.
- Does not rebuild the site or re-run any design phase.
- **Does not re-derive another audit's findings** — a qa BLOCKER appears here as one citation of `qa-report.md`, never as a restatement. Two reports with two severities for one problem is worse than one report.
- Does not judge design quality (`/twt-design-system-audit` owns that) or Figma buildability (`/twt-figma-dev-audit` owns that).
- Makes no claim about DNS, SSL, or hosting it has not either been given a URL for or explicitly asked about.
- Does not re-implement scanning, rule evaluation, or rendering in the model — those are the bundled scripts.

**Success criteria:**
- `facts.json`, `findings.json`, `launch-report.md`, `launch-report.html`, and `punch-list.md` all exist under `.twt-artifacts/launch/` — **or**, if the scan could not complete, the run produced `launch-report-provisional.{md,html}` and no `launch-report.md`.
- `launch-lint.mjs` exits 0: every finding carries a severity and owner from the closed vocabularies, a non-empty `where`, `evidence`, `impact`, and `action`, and the verdict matches the findings.
- Every unanswered blocking interview question appears as an `UNVERIFIED` finding, so the verdict can never be a clean `GO` on silence.
- No category renders more than 5 issue blocks; withheld counts are stated.

---

Arguments passed to this command: $ARGUMENTS

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Parse arguments and confirm there is something to audit

Parse `$ARGUMENTS` for an `http(s)://` URL and for `--skip-interview`.

Check (Glob/Read) that `site/`, `.twt-artifacts/design/mockup/`, or a `wp-content/themes/hello-elementor-*/` theme exists. If none do and no URL was given, stop: *"Nothing to audit — build the site (Phase 3) or pass a live URL."* Write nothing.

## Step 2 — Run the deterministic scan

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/launch-scan.mjs" "$CLAUDE_PROJECT_DIR"
```

With a URL, append `--url <the url>`. **Read the `layers` block in the output.** If `layers.scan` is anything but `ok`, note it — Step 7 will produce a provisional report and the verdict is capped at `NO-GO — evidence incomplete`. Never work around a failed scan by reading the source files yourself; a model-read substitute for a scan is exactly the silent skip this discipline exists to prevent.

## Step 3 — Evidence policy: offer to fill the gaps

Read `facts.harvest`. Build the list of missing or stale evidence:
- `qa.present: false` → `/twt-qa` has never run
- `qa.generated` older than the newest built page → the QA report predates the build
- `approval.present: false` → no content-approval workbook
- `approval.reader: "failed"` → the workbook exists but could not be read
- `staleness.stale > 0` → artifacts older than their inputs

If the list is non-empty and this is an interactive run, ask via **AskUserQuestion** (multi-select, header "Evidence") which to run now, listing each with its cost — e.g. *"Run /twt-qa (5 audits, ~3 min)"*, *"Run /twt-content-approval-checklist (~2 min)"*, *"Skip — accept UNVERIFIED"*, plus **You decide**. Default to running all.

Dispatch each approved one via the Agent tool, wait, then **re-run Step 2** so the harvest reflects the new artifacts. Never dispatch silently: a first run on a fresh project would otherwise trigger the whole QA suite with no warning.

If `--skip-interview` is set or this is an unattended dispatch, skip the question and let the gaps become `UNVERIFIED`.

## Step 4 — Apply the rules

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/launch-audit.mjs" ".twt-artifacts/launch/facts.json" --out ".twt-artifacts/launch"
```

This writes `findings.json` with every deterministic finding, the verdict, and the `interview[]` catalogue. Do not restate or re-severity these findings — they are measured.

## Step 5 — The interview

Skip this step entirely when `--skip-interview` is set or you are running as a subagent (AskUserQuestion is unavailable there); every blocking question then becomes an `UNVERIFIED` finding.

Read `.twt-artifacts/launch/answers.json` if it exists. For each question in `findings.json`'s `interview[]`:
- **Re-ask** it if there is no stored answer, or the stored answer's `asked` date is older than the newest file in `facts.sources.html` (the build changed under the answer).
- **Carry forward** an answer that is still current, and say so in the report rather than re-asking.

Ask the outstanding ones in **one AskUserQuestion round** (batch them — never one message per question). Each question offers its concrete options plus **"You decide"**, which resolves only that question and never cascades.

Write every answer to `.twt-artifacts/launch/answers.json`:

```json
{ "Q-BACKUP-ROLLBACK": { "answer": "Yes — nightly snapshots, restore tested 2026-07-28", "asked": "2026-07-30" } }
```

Then, for each question, add one finding to `findings.json`:
- Answered, and the answer clears the risk → **no finding**.
- Answered, and the answer reveals a problem → a finding at the severity the answer warrants, owner from the question's `owner`.
- **Unanswered and `blocking: true` → `UNVERIFIED`**, owner from the question, `where: "interview: <question id>"`, `evidence: "not answered"`.
- Unanswered and `blocking: false` → `NICE-TO-HAVE` or omit, at your judgment.

## Step 6 — Add judgment, then lint

Now add what the rules cannot reach, and only that:
- **`impact` and `action` prose on every finding.** The rules leave these `null` deliberately — a finding without them is a claim, not an instruction. Write the impact in terms of what the *client* loses, not what the code does.
- **Findings a rule cannot see:** a missing legal page that this project genuinely does not need (downgrade with the reason in `evidence`); a heavy image that is a deliberate hero; a `noindex` on a page that *should* be excluded. Re-severity a rule finding only when you can name why, in `evidence`.
- **Never invent a measurement.** If you did not read it in `facts.json`, it is an interview question, not a finding.

Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/launch-lint.mjs" ".twt-artifacts/launch" --fix
node "${CLAUDE_PLUGIN_ROOT}/tools/launch-lint.mjs" ".twt-artifacts/launch"
```

`--fix` derives `id`, `blocking`, `source`, the sort order, and the verdict. The second call must exit 0. If it reports errors, fix the named findings and re-run — do not render past a failing lint.

## Step 7 — Render

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/launch-report.mjs" ".twt-artifacts/launch/findings.json" --out ".twt-artifacts/launch"
```

The renderer chooses the filename from `layers.scan`: `launch-report.md` on a complete scan, `launch-report-provisional.md` otherwise. **Never rename a provisional file to the measured name.**

## Step 8 — Report

State, in this order:
1. The verdict and the four counts.
2. Every `LAUNCH-BLOCKER`, grouped by owner — this is what the human acts on.
3. What was not verified and why (unanswered questions, skipped dispatches, a failed harvest probe).
4. The output paths, naming `punch-list.md` as the document to send.

If the verdict is `NO-GO`, say plainly that nothing here was auto-fixed and the same command re-run after the fixes will re-verdict. If the scan was incomplete, lead with that — a provisional report is not a soft pass.
