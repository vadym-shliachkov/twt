---
name: twt-eval-smoke
category: meta
description: (v1.0.1) Behavioral smoke eval — run scoped skills against a seeded fixture and assert their postconditions mechanically (marketplace-dev only)
version: 1.0.1
accepts_arguments: true
inputs:
  - Optional scope — ia | curation | design-system | wiki | all (default all)
dependencies:
  hard: []
  soft:
    - twt-ia-define
    - twt-curation-define
    - twt-design-system-define
    - twt-wiki-define
reads:
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/ia/functional-scope.md
  - .project-wiki/inbox.md
  - .project-wiki/decisions/
writes:
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/content/fetched/site/<domain>/index.md
  - .project-wiki/inbox.md
---

# /twt-eval-smoke

## Intent

**Purpose:** The standing behavioral eval. Unit tests and structural checkers guard the *tools* and *formats*; nothing else exercises the *prompts* — a broken dependency check or a dead contract path in a skill only surfaces in a real user run. This command seeds a deterministic fixture, dispatches a real skill against it in collect mode, and asserts the postconditions mechanically via `tools/eval-smoke.mjs`. Run it after any change to the skills it covers, or on a schedule.

**Non-goals:**
- Not a quality eval — it asserts contracts (files at contract paths, parseable decisions.md, drained inbox, lint-clean wiki), never design taste.
- Never runs against a real project: the seeder refuses any tree that exists without its ownership marker, and clean refuses any tree without it.

**Success criteria:**
- Each requested scope reports PASS from `eval-smoke.mjs check`, or the run ends with the FAIL lines and the fixture left in place for debugging.
- A passing scope's fixture is cleaned; the repo tree is untouched (`.twt-artifacts/` and `.project-wiki/` fixtures only).

---

## Step 1 — Guard: marketplace repo only
Use Glob to confirm `tools/eval-smoke.mjs` and `tools/gen-docs.mjs` exist at the project root. If not, stop: "This is a marketplace-dev eval — run it inside the twt repo."

## Step 2 — Scope
`$ARGUMENTS`: `ia`, `curation`, `design-system`, `wiki`, or `all` (default `all`). Run each selected scope's cycle **sequentially** — the artifact scopes share the `pre-design` fixture tree, so a scope must be cleaned before the next seeds.

## Step 3 — Cycle per scope
For each scope, run the four beats. If **seed** refuses (a real tree exists), report that and skip the scope — never force it.

**ia:**
1. Seed (Bash): `node "$CLAUDE_PROJECT_DIR/tools/eval-smoke.mjs" seed "$CLAUDE_PROJECT_DIR" --scope ia`
2. Dispatch `twt-ia-define` (Agent tool) with exactly: `subagent-collect — project brief: "Acme Bakery, weekly sourdough subscriptions for Springfield families; site goal: grow subscriptions."` — nothing more; the eval measures what the skill does with its contract inputs.
3. Check (Bash): `node "$CLAUDE_PROJECT_DIR/tools/eval-smoke.mjs" check "$CLAUDE_PROJECT_DIR" --scope ia`
4. On PASS → clean (Bash): `node "$CLAUDE_PROJECT_DIR/tools/eval-smoke.mjs" clean "$CLAUDE_PROJECT_DIR" --scope ia`. On FAIL → **leave the fixture in place**, relay every FAIL line, and name the paths to inspect.

**curation:**
1. Seed: `node "$CLAUDE_PROJECT_DIR/tools/eval-smoke.mjs" seed "$CLAUDE_PROJECT_DIR" --scope curation`
2. Dispatch `twt-curation-define` (Agent tool) with exactly: `subagent-collect — project brief: "Acme Bakery, weekly sourdough subscriptions; grow subscriptions."`
3. Check / PASS-FAIL handling as above (`--scope curation`). The check asserts the inventory, per-page outlines, the facts ledger at its resolved path, and a parseable `decisions.md`.

**design-system:**
1. Seed: `node "$CLAUDE_PROJECT_DIR/tools/eval-smoke.mjs" seed "$CLAUDE_PROJECT_DIR" --scope design-system`
2. Dispatch `twt-design-system-define` (Agent tool) with exactly: `subagent-collect — greenfield from brand-brief; no external design sources.`
3. Check / PASS-FAIL handling as above (`--scope design-system`). The check asserts `tokens.md` + `tokens.css` and runs `gen-preview.mjs --check` — the skill's own WCAG gate must report zero AA failures.

**wiki:**
1. Seed: `node "$CLAUDE_PROJECT_DIR/tools/eval-smoke.mjs" seed "$CLAUDE_PROJECT_DIR" --scope wiki`
2. Dispatch `twt-wiki-define` (Agent tool) with exactly: `inbox only`
3. Check: `node "$CLAUDE_PROJECT_DIR/tools/eval-smoke.mjs" check "$CLAUDE_PROJECT_DIR" --scope wiki`
4. Same PASS/FAIL handling as ia (`--scope wiki`).

Do **not** repair a failing scope by re-dispatching with extra hints — a FAIL is the eval's finding, not a problem to prompt around. Fix the skill, then re-run the eval.

## Step 4 — Report
One line per scope — `ia: PASS` / `wiki: FAIL (n findings)` — followed by every FAIL detail verbatim, whether fixtures were cleaned or left for debugging, and (on any FAIL) which skill file to suspect first (the dispatched skill's SKILL.md).
