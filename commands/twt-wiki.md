---
name: twt-wiki
category: wiki
description: (v1.0.5) Initialize, ingest into, and curate the project wiki — the project's durable memory
version: 1.0.5
accepts_arguments: true
inputs:
  - Optional sources to ingest, or a focus for curation; otherwise interactive
dependencies:
  hard:
    - twt-wiki-define
  soft:
    - twt-wiki-fetch
    - twt-wiki-validate
reads:
  - .project-wiki/
  - .twt-artifacts/
writes:
  - .project-wiki/
---

# /twt-wiki

## Intent

**Purpose:** The single entry point to the project wiki — `.project-wiki/`, the durable memory that holds what `.twt-artifacts/` cannot: why decisions were made, what was ruled out, what the client said, ideas not yet scoped, and the assets themselves.

**Non-goals:**
- Does not answer questions about the project — that is `/twt-wiki-query`.
- Does not lint the wiki inline — it dispatches `twt-wiki-validate` (Step 3b), which is the only thing that writes `validation-report.md`.
- Does not harvest `.twt-artifacts/` itself — it only *offers* the sync and, on accept, dispatches `twt-wiki-fetch` (which runs the bundled harvester); it never reimplements that scan inline.
- Never writes a curated page itself — it dispatches `twt-wiki-define`, the sole curator.

**Success criteria:**
- `.project-wiki/` exists and capture is armed (the hook only records once the folder exists).
- Requested sources are ingested and registered.
- The inbox is drained into cited pages.
- The user is told what needs their decision.

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Initialize the wiki if it is absent
Use Glob/Read — never a shell command — to check whether `.project-wiki/AGENTS.md` exists at the project root.

**If it is missing**, ask via **AskUserQuestion** (single-select, header "Wiki"):
- **Create the wiki** (recommended — scaffolds `.project-wiki/` and arms decision capture)
- **Skip** (stop here; nothing is written)
- **You decide**

On **Create the wiki**, ask the user for the project's name in a plain-text prompt (free-form input is not a fixed-option choice, so it is not an AskUserQuestion — CONVENTIONS §4), then run:

`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-init.mjs" "$CLAUDE_PROJECT_DIR" --name "<project name>"`

It is idempotent and never overwrites an existing file. Tell the user that decision capture is now armed: from here on, every question they answer in any twt skill is recorded to `.project-wiki/inbox.md` automatically.

Then, using **Glob** (never a shell command), check whether `.twt-artifacts/` exists at the project root. If it does, this project already has decisions sitting on disk that the fresh wiki knows nothing about — offer via **AskUserQuestion** (single-select, header "Sync"):
- **Harvest existing artifacts** (recommended — pulls decisions already on disk into the inbox)
- **Skip**
- **You decide**

On **Harvest existing artifacts** (or **You decide** resolving to it), dispatch `twt-wiki-fetch` (Agent tool) with `.twt-artifacts/` as the source — never run the harvester or scan artifacts inline (CONVENTIONS §5). It appends decision-bearing items to `inbox.md` and registers everything else in `sources.md`; it does **not** curate. Report back what it harvested. On **Skip**, note that artifacts can be harvested later by giving `.twt-artifacts/` as a source to `/twt-wiki-fetch`. If `.twt-artifacts/` does not exist, skip this offer entirely — there is nothing to sync yet.

Either way, do not auto-curate what was just harvested — that is still Step 3, and only on the user's say-so.

**If it exists**, check the operating manual's age before continuing: run the scaffolder once — it is idempotent and never overwrites —

`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-init.mjs" "$CLAUDE_PROJECT_DIR"`

and read its printed line for `AGENTS.md`. `exists:` means the manual is current — continue. `outdated: ... (manual vN < vM)` means the curator would be obeying stale rules, so ask via **AskUserQuestion** (single-select, header "Manual"):
- **Upgrade the manual** (recommended — re-stamps AGENTS.md from the plugin template; the wiki is committed to git, so hand edits are recoverable from history)
- **Keep the current manual** (the wiki keeps running under its old rules)
- **You decide**

On **Upgrade the manual** (or **You decide** resolving to it), run:

`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-init.mjs" "$CLAUDE_PROJECT_DIR" --upgrade-manual`

Running unattended (auto mode / dispatched as a subagent): do **not** upgrade silently — note the outdated manual in the report and continue. Then continue.

## Step 2 — Ingest sources, or note a curation focus
`$ARGUMENTS` (or what the user offers unprompted) means one of two things — sources to ingest, or a focus that narrows Step 3's curation pass to a page, a topic, or `inbox only` — never both (see this command's `inputs`). Treat it as **source(s)** when it names files, URLs, pasted notes, or an explicit ask to ingest something; treat it as a **focus** when it is `inbox only`, a bare topic word (e.g. `pricing`), or a wiki page path (e.g. `decisions/2026-07-11-cta-color.md`). If it is genuinely ambiguous, this is a fixed, mutually-exclusive choice, so ask via **AskUserQuestion** (single-select, header "Ingest or focus") — not a plain-text prompt (CONVENTIONS §4):
- **Treat as source(s) to ingest** (dispatch fetch on the given input)
- **Treat as a curation focus** (carry it forward to Step 3 unchanged)
- **You decide**

- **Sources** — dispatch `twt-wiki-fetch` (Agent tool) with them. Do not reimplement ingestion inline (CONVENTIONS §5).
- **A focus** — do not dispatch fetch for it; carry it forward unchanged to Step 3.
- **Neither** — skip to Step 3. A wiki with a full inbox and no new sources is still worth curating.

## Step 3 — Curate
Dispatch `twt-wiki-define` (Agent tool), forwarding any focus captured in Step 2 as its `$ARGUMENTS` (a page, a topic, or `inbox only`); pass nothing to curate everything pending. It drains the inbox and writes the curated pages. This is a single define pass, per the orchestrator pattern (CONVENTIONS §9) — do not loop.

## Step 3b — Validate
Dispatch `twt-wiki-validate` (Agent tool). It runs the deterministic lint (`tools/wiki-lint.mjs`) plus its judgment checks and writes `validation-report.md` — read-only otherwise.

If the report has **BLOCKERs the curator can fix mechanically** (a stale index, a page the index misses — anything whose Recommendation names the curator or its tools), re-dispatch `twt-wiki-define` once with those findings as its focus, then re-dispatch `twt-wiki-validate` once. **At most one such re-run** (CONVENTIONS §9) — no score-chasing loop. BLOCKERs that need a human (an unresolved CONFLICT, a superseded page with no successor, an uncaptured why) are never "fixed" by re-running; they go in the Step 4 report for the user.

## Step 4 — Report
Tell the user:
- Whether the wiki was created, and that capture is armed
- Whether an artifact sync was offered, and its outcome (harvested — with counts — skipped, or not offered because there was no `.twt-artifacts/` yet)
- Sources ingested
- Pages created or updated
- Validation health/band and the BLOCKER/WARNING/SUGGESTION counts, with the `validation-report.md` path
- **Contradictions raised, and open questions that need a human** — lead with these; they are the reason the wiki exists
- Suggest `/twt-wiki-query` to ask the project a question
