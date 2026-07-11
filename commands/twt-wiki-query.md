---
name: twt-wiki-query
category: wiki
description: (v1.0.1) Ask the project a question and get an answer cited to the wiki and its sources
version: 1.0.1
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
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Require a wiki
Use Glob/Read to check `.project-wiki/index.md`. If it is missing, tell the user to run `/twt-wiki` first, and stop.

## Step 2 — Get the question
Take it from `$ARGUMENTS`. If none, ask in a plain-text prompt (a free-form question is not a fixed-option choice — CONVENTIONS §4).

## Step 3 — Read outward from the index
1. Read `index.md` — it is the catalog and tells you which pages could possibly bear on the question.
2. Read the relevant curated pages, including `facts.md` and `open-questions.md` when the question is factual or touches something unresolved.
3. Follow their citations into `raw/` and `.twt-artifacts/` **only if** the curated pages are not enough.

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

If saved: write `.project-wiki/analyses/<slug>.md` with `type: analysis` frontmatter, the question, the answer, and its citations.

Then, **whether or not the answer was saved**, append to `log.md` — it is the append-only record of every ingest, sync, query, and lint, not only the saved ones:

```
## <YYYY-MM-DD> — query
"<question>" — answered from <n> page(s). Saved to analyses/<slug>.md.
```

If not saved, replace the last sentence with `Not saved.`
