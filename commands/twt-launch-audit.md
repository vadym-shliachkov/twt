---
name: twt-launch-audit
category: qa
description: (v1.0.6) Audit a project's readiness to go to production - what blocks the launch, what is missing, and who owns each item
version: 1.0.6
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
  - .twt-artifacts/inherited/conventions.md
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
- **Does not re-derive another audit's findings** — a qa BLOCKER appears here as one citation of `qa-report.md`, never as a restatement. Two reports with two severities for one problem is worse than one report. (Citations and scan findings can still *overlap* on one underlying defect; nothing mechanical de-duplicates them, and Step 6 says what to do about it.)
  - "Never restated" is about **severity and derivation**, not about detail: a citation may name what the cited findings are, so the reader knows what is in the referenced document. What it may not do is re-severity them, re-measure them, or present them as this audit's own findings. If a citation covers several sub-findings, list them as an enumerated set with the cited report's own labels — do not fuse them into one paragraph of prose that loses which item is which.
- Does not judge design quality (`/twt-design-system-audit` owns that) or Figma buildability (`/twt-figma-dev-audit` owns that).
- Makes no claim about DNS, SSL, or hosting it has not either been given a URL for or explicitly asked about.
- Does not re-implement scanning, rule evaluation, or rendering in the model — those are the bundled scripts.

**Success criteria:**
- `facts.json`, `findings.json`, `launch-report.md`, `launch-report.html`, and `punch-list.md` all exist under `.twt-artifacts/launch/` — **or**, if the scan could not complete, the run produced `launch-report-provisional.{md,html}` and no `launch-report.md`.
- `launch-lint.mjs` exits 0: every finding carries a severity and owner from the closed vocabularies, a non-empty `where`, `evidence`, `impact`, and `action`, and the verdict matches the findings.
- Every unanswered blocking interview question appears as an `UNVERIFIED` finding, so the verdict can never be a clean `GO` on silence. **The rules produce these, not the interview** — `launch-audit.mjs` emits one per unanswered blocking question on every path, including `--skip-interview` and subagent dispatch; the interview *removes* them by answering.
- No category renders more than 5 issue blocks; withheld counts are stated.

---

Arguments passed to this command: $ARGUMENTS

## Bash call shape — keep every call allowlist-matchable
The permission rules `/twt-setup` seeds match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`); a call that doesn't match forces a manual prompt even when the binary is allowlisted. So for **every** Bash call in this run: never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Parse arguments and confirm there is something to audit

Parse `$ARGUMENTS` for an `http(s)://` URL and for `--skip-interview`.

Check (Glob/Read) that `site/`, `.twt-artifacts/design/mockup/`, a `wp-content/themes/hello-elementor-*/` theme, or `.twt-artifacts/inherited/conventions.md` (an inherit-target build) exists. If none do and no URL was given, stop: *"Nothing to audit — build the site (Phase 3) or pass a live URL."* Write nothing.

All three are genuinely auditable and the scanner handles each: with no built HTML the page-scoped checks (content, discoverability, social, legal, analytics, conversion, performance) report nothing rather than reporting everything as missing, while build hygiene reads the project root and the theme, the error-page check reads the theme's `404.php` (and reports nothing at all on a URL-only run, where it would otherwise be measuring zero input), and the live layer reads the URL. A theme-only or URL-only run is a complete scan (`layers.scan: ok`) over a narrower surface, not a partial one — say in Step 8 which layers actually had input.

**An inherit-target build is a fourth, narrower case the deterministic scanner does not yet locate.** `launch-scan.mjs`'s build-root finder (`tools/lib/sources.mjs`) only knows `site/` and a `wp-content/themes/hello-elementor-*/` theme — it has no reader yet for the arbitrary host path an inherit build writes into (named in `.twt-artifacts/inherited/conventions.md`'s **File layout** section). So on an inherit-only project the scan still runs (`layers.scan: ok`), but every page-scoped and build-hygiene layer will report nothing found — **not because the build is clean**, but because the scanner had no root to read. Say this plainly in Step 8 rather than letting an all-zero findings list read as a pass, and lean on the harvested `qa-report.md`/`gaps.md` citations (Step 3) as the only real evidence for this surface until a follow-on teaches `sources.mjs` to resolve an inherit build's root from `conventions.md`.

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

This is enforced, not merely asked for: `launch-audit.mjs` compares `facts.generated` against the mtime of every harvested source and **exits 2** if any of them moved after the scan, naming the file and the scan command. A run that dispatches QA and then skips the re-scan cannot reach a report — it would otherwise cite reports its own evidence file records as absent.

If `--skip-interview` is set or this is an unattended dispatch, skip the question and let the gaps become `UNVERIFIED`.

## Step 4 — Apply the rules

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/launch-audit.mjs" ".twt-artifacts/launch/facts.json" --out ".twt-artifacts/launch"
```

It reads `answers.json` from the same directory when one exists (pass `--answers <path>` to point elsewhere), and writes `findings.json` with every deterministic finding, the verdict, and the `interview[]` catalogue. Do not restate or re-severity these findings — they are measured.

**It already contains one `UNVERIFIED` finding (`rule: INTV001`) per unanswered blocking interview question.** That is not the interview's output — it is a rule, so it fires on every path, including the ones Step 5 skips. Step 5 *removes* these.

## Step 5 — The interview: answering removes findings

**Skip this step entirely when `--skip-interview` is set or you are running as a subagent** (AskUserQuestion is unavailable there). The blocking questions then simply stay in `findings.json` as `UNVERIFIED` — Step 4 already put them there, so a silent run reports honestly that nothing was verified instead of reaching a clean `GO`. Skipping this step is now safe by construction, not by remembering to compensate for it.

When you do run it: read `.twt-artifacts/launch/answers.json` if it exists. For each question in `findings.json`'s `interview[]`:
- **Re-ask** it if there is no stored answer, or the stored answer's `asked` date is older than the newest file in `facts.sources.html` (the build changed under the answer).
- **Carry forward** an answer that is still current, and say so in the report rather than re-asking.

Ask the outstanding ones in **one AskUserQuestion round** (batch them — never one message per question). Each question offers its concrete options plus **"You decide"**, which resolves only that question and never cascades.

Write every answer to `.twt-artifacts/launch/answers.json`:

```json
{ "Q-BACKUP-ROLLBACK": { "answer": "Yes — nightly snapshots, restore tested 2026-07-28", "asked": "2026-07-30" } }
```

Then reconcile `findings.json` against what you learned. For each question:
- Answered, and the answer clears the risk → **delete its `INTV001` finding**.
- Answered, and the answer reveals a problem → **replace** the `INTV001` finding with one at the severity the answer warrants, owner from the question's `owner`, and the answer itself as `evidence`.
- Unanswered → **leave the `INTV001` finding exactly as it is.** Never delete one you did not ask.
- A non-blocking question you asked and that revealed a problem → add a finding at your judgment (there is no `INTV001` finding to replace; non-blocking questions are not materialized).

Re-running Step 4 after writing `answers.json` produces the same result mechanically, and is the cheaper path when you have not yet added judgment findings.

## Step 6 — Add judgment, then lint

Now add what the rules cannot reach, and only that:
- **`impact` and `action` prose on every finding.** The rules leave these `null` deliberately — a finding without them is a claim, not an instruction. Write the impact in terms of what the *client* loses, not what the code does.
- **Findings a rule cannot see:** a missing legal page that this project genuinely does not need (downgrade with the reason in `evidence`); a heavy image that is a deliberate hero. Re-severity a rule finding only when you can name why, in `evidence`.
- **Reconcile overlapping findings — nothing mechanical does this.** `CONT001` (a lorem block, with its file and line), `HARV002` (a citation of `qa-report.md`'s blocker count) and `HARV003` (a citation of `gaps.md`'s open-item count) can all be reporting the same leftover paragraph — three `LAUNCH-BLOCKER`s under two owners for one defect. When a harvested citation and a scanner finding plainly describe the same problem, **keep the scanner finding** (it names the file and line, so it is actionable) and fold the citation into its `evidence` as a cross-reference rather than leaving both as separate items. There is no key on which the code could match them: `gaps.md` items are free prose with no file and no line, which is exactly why this is your job and not the rules'.
- **Never invent a measurement.** If you did not read it in `facts.json`, it is an interview question, not a finding.
- **The scanner already exempts what is supposed to be excluded.** A `noindex` on `404.html`, `error.html`, a thank-you page, or a search-results page is never reported — it is the recommended configuration, and it is counted in `checks.discoverability.counts.noindex_excluded` if you want to see it. Do not add a finding for one. The exemption is a **whole path segment**, so `search-engine-optimisation.html` and `thanks-to-our-volunteers.html` are ordinary content pages and a `noindex` on either IS reported — do not extend the exemption by eye.
- **A site served under a path prefix is handled.** `facts.sources.deploy` records the prefix inferred from the site's own links and sitemap (`null` = served at the root). Sitemap-orphan, legal-link and on-disk asset checks all compare with it stripped, so do not re-report a page as an orphan because its `<loc>` carries a segment its filename does not.

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

The readiness matrix now carries a **`NOT ASSESSED`** state and a line stating what the scan actually had in front of it (pages, theme, live layer, harvested reports) — both derived from `coverage` in `findings.json`, so they are stated on every run. `CLEAR` means measured and clean; `NOT ASSESSED` means there was nothing to measure. Do not describe a `NOT ASSESSED` category as passing, and if several are unassessed, say in your summary what would have to exist for them to be judged.

If the verdict is `NO-GO`, say plainly that nothing here was auto-fixed and the same command re-run after the fixes will re-verdict. If the scan was incomplete, lead with that — a provisional report is not a soft pass.
