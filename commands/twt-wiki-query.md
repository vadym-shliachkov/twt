---
name: twt-wiki-query
category: wiki
description: (v1.0.5) Ask the project a question and get an answer cited to the wiki and its sources
version: 1.0.5
accepts_arguments: true
inputs:
  - The question to ask; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-wiki
reads:
  - .project-wiki/
  - .twt-artifacts/
writes:
  - .project-wiki/analyses/
  - .project-wiki/index.md
  - .project-wiki/log.md
---

# /twt-wiki-query

## Intent

**Purpose:** Answer a question about the project from its durable memory — including the questions no artifact can answer, like *why is the CTA orange* or *what did we rule out and why*.

**Non-goals:**
- Does not curate or repair the wiki (that is `/twt-wiki`).
- Does not answer from the model's own assumptions. If the wiki does not know, it says so.
- Does not write a curated page. It may write an `analyses/` page, and only with consent.

**Success criteria:**
- Every claim in the answer carries a citation to a wiki page, source, or artifact path.
- Gaps are stated plainly as gaps, not filled with plausible invention.
- Stale or contested pages are flagged when they were used.

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Require a wiki
Use Glob/Read to check `.project-wiki/index.md`. If it is missing, tell the user to run `/twt-wiki` first, and stop.

## Step 2 — Get the question
Take it from `$ARGUMENTS`. If none, ask in a plain-text prompt (a free-form question is not a fixed-option choice — CONVENTIONS §4).

## Step 3 — Read outward from the index
1. Read `index.md` — it is the catalog and tells you which pages could possibly bear on the question.
2. Read the relevant curated pages, including `facts.md` and `open-questions.md` when the question is factual or touches something unresolved.
3. Read `inbox.md` — capture that has not been curated yet. A decision answered an hour ago lives here, not on any page; skipping it makes the wiki wrongly say "I don't know" about the freshest knowledge. An inbox entry that bears on the question is usable evidence, but report it as **captured, not yet curated** (and suggest `/twt-wiki` to curate) — never treat it as settled, and never curate it yourself from this skill.
4. Follow their citations into `raw/` and `.twt-artifacts/` **only if** the curated pages are not enough.

Read artifacts with the file tools, never shell (CONVENTIONS §15).

## Step 4 — Weigh the pages by status
- `status: current` or `status: resolved` — trust it.
- `status: needs-review` — usable, but say in the answer that it is unsettled, and name the *specific* reason why, which is one of two distinct things — do not conflate them:
  - a **contradiction**: two sources disagree. Report both values with their sources (see the `facts.md` rule below).
  - an **uncaptured reason**: the page itself says its `Why:` was `_not captured_` (a decision was recorded but no reason was ever given). Report plainly that the choice is on record but the reason is not — never invent a plausible-sounding one to fill the gap.
- `status: draft` — usable, but say it is unconfirmed.
- `status: superseded` — do not answer from it. Follow its `superseded-by` link.

If `facts.md` marks a value `CONFLICT`, report **both** values with their sources. Never pick one silently.

## Step 5 — Answer with citations
Lead with the answer. Cite every claim — a wiki page, a `raw/` source, an artifact path, or a `log.md` entry.

If the wiki does not know, **say so** and point at what would answer it (a source to ingest, a decision to make). A confident invention is worse than a gap, because the wiki exists precisely to be trusted.

## Step 6 — Offer to save, then log the query
If the answer took real work — you read several pages, reconciled sources, or reasoned across phases — ask via **AskUserQuestion** (single-select, header "Save") whether to keep it:
- **Save to analyses/** (recommended when the reasoning would otherwise be redone)
- **Don't save** (a one-off lookup)
- **You decide**

Do not ask for a trivial lookup — treat it as **Don't save** without asking; that is noise.

If saved: write `.project-wiki/analyses/<slug>.md` with `type: analysis` frontmatter (including a one-line `summary:`), the question, the answer, and its citations. Then catalog it immediately so the index doesn't lie until the next curate run — regenerate the index deterministically (Bash, single command; never hand-edit `index.md`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-index.mjs" "$CLAUDE_PROJECT_DIR"
```

`wiki-index.mjs` recompiles the whole catalog from every page's frontmatter, so it only adds your new `analyses/` row and never touches curated content.

Then, **whether or not the answer was saved**, append to `log.md` — it is the append-only record of every ingest, sync, and query, not only the saved ones:

```
## <YYYY-MM-DD> — query
"<question>" — answered from <n> page(s). Saved to analyses/<slug>.md.
```

If not saved, replace the last sentence with `Not saved.`
