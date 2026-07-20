---
name: twt-figma-design-system
category: figma-export
description: (v1.0.0) Push the design system into a Figma file as variables, styles, and variant components
version: 1.0.0
accepts_arguments: true
inputs:
  - Optional: a target Figma file URL, and/or a scope hint (foundations | full)
dependencies:
  hard: []
  soft:
    - figma-mcp
reads:
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/design-system/tokens.json
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/figma-export/figma-map.md
writes:
  - .twt-artifacts/figma-export/figma-map.md
  - .twt-artifacts/figma-export/design-system-report.md
  - .twt-artifacts/figma-export/decisions.md
---

# /twt-figma-design-system

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load** (figma, design-taste-frontend, emil-design-eng, superpowers, …), run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Push the canonical design system (`.twt-artifacts/design/design-system/`) into a Figma file: tokens become Figma **variables** (with modes when the token set has light/dark), the type scale and shadows become **text/effect styles**, and — in full scope — the component catalog (`component/components.md`) becomes real Figma **components with variant sets** bound to those variables. Re-runs update the same file in place via the node-map in `figma-export/figma-map.md`.

**Non-goals:**
- Doesn't design or invent anything — it exports what the design-system artifacts already define, nothing more
- Doesn't modify `.twt-artifacts/design/` (read-only on all design artifacts)
- Doesn't delete anything in Figma — tokens/components removed from the artifacts since the last export are flagged as orphans in the report, never removed
- Doesn't export page mockups (that is `/twt-figma-mockup`)
- Doesn't reproduce the Figma plugin skills' Plugin-API mechanics inline — it loads `figma-use` + `figma-generate-library` and follows them (CONVENTIONS §5 spirit: dispatch/compose, never re-implement)

**Success criteria:**
- The target Figma file contains variables, text/effect styles (and, in full scope, variant components) matching `tokens.md` + `components.md`
- `.twt-artifacts/figma-export/figma-map.md` records the target file and an artifact → Figma-node map
- A second run after editing a token **updates** the existing variable instead of creating a duplicate
- `design-system-report.md` lists created / updated / skipped / orphaned items and the Figma file URL
- Aborts with an actionable message when inputs or the Figma MCP are missing

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
- `.twt-artifacts/design/design-system/tokens.md` and `tokens.css` — **required**. If either is missing, abort: "No design system found — run /twt-design-system first."
- `.twt-artifacts/design/design-system/tokens.json` — optional; when present, prefer it as the structured token source (names, values, modes) and use `tokens.md` for grouping/intent notes.
- `.twt-artifacts/design/design-system/component/components.md` — optional; canonical path first, and if absent fall back **read-only** to the pre-move legacy `.twt-artifacts/design/component/components.md` (CONVENTIONS §2). Its presence drives the default scope in Step 3.
- `.twt-artifacts/figma-export/figma-map.md` — optional; when present, this is a re-run (Step 2 reuses its target, Step 4 diffs against its node-map).

If `$ARGUMENTS` contains a `figma.com` URL, treat it as the target file (overrides the map's target after confirming with the user — in collect mode, without confirming). If it contains `foundations` or `full`, treat it as the scope answer for Step 3.

## Step 1b — Collect mode (CONVENTIONS rule 13)

If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Resolve every choice with its model default — target file: the map's recorded target, else a URL in `$ARGUMENTS`, else create a new Figma file; scope: full if `components.md` exists, else foundations — and record each resolved choice in `.twt-artifacts/figma-export/decisions.md` (decisions.md format — frontmatter `generated`/`area: figma-export`/`producer: twt-figma-design-system`/`status: open`; sections `## Open questions` (question — options [a,b,c] — model-leaning, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (field = value — basis — reversible), `## Proposed rules (confirm before binding)`). After writing it, verify (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file .twt-artifacts/figma-export/decisions.md` — fix until it passes. Then continue from Step 2 without prompting. **Stay in-project:** never read files outside this project; every format you need is specified in this skill.

## Step 2 — Target Figma file

1. If `figma-map.md` records a target file (and Step 1 found no overriding URL), use it.
2. Otherwise ask via **AskUserQuestion** (single-select, header "Target"): **Create a new Figma file** (recommended) · **Use an existing file** · **You decide** (→ create new). On "Use an existing file", prompt plain-text: "Paste the Figma file URL (https://www.figma.com/design/…):".
3. **Connectivity check:** call the Figma MCP `whoami` (or `get_metadata` on the target URL when one exists). On auth/connection failure, abort: "Figma MCP is not connected — open the Figma desktop app (and the target file) or connect the Figma MCP, then re-run." Never fabricate success.
4. Creating a new file goes through the Figma plugin's `figma-create-new-file` flow (load that skill first, per its own mandate), named after the project (e.g. the repo/site name + " — Design System").

## Step 3 — Scope

Unless already resolved (arguments or collect mode), ask via **AskUserQuestion** (single-select, header "Scope"):
- **Foundations + components** — variables, text/effect styles, and the full component catalog as variant components (needs `components.md`; hide or mark unavailable when it is missing)
- **Foundations only** — variables and styles; fastest, but `/twt-figma-mockup` will then build flat styled frames instead of component instances
- **You decide** — full when `components.md` exists, foundations-only otherwise

## Step 4 — Push into Figma

Load the Figma plugin skills first — `figma-use` (mandatory before any `use_figma` call) and `figma-generate-library` — and follow their build order and API guidance. This skill decides *what* to build; those skills define *how*.

Build order:
1. **Variable collections + variables** — color, spacing, radius (and any other numeric token groups) from the token source. If the tokens define light/dark (or other) modes, create one collection with modes rather than duplicate variables.
2. **Text styles** — one per type-scale step (family, size, weight, line-height, letter-spacing). **Effect styles** — one per shadow token.
3. **Components** (full scope only) — walk `components.md` in catalog order (primitives → components → modules). For each: one Figma component (or component set when the spec lists variants/states), auto-layout structure per the spec, every color/space/radius/type property **bound to the variables/styles from steps 1–2** — no hardcoded values where a token exists.

**Re-run behavior (idempotency):** when `figma-map.md` has a node-map, diff before building — value changed → update the mapped node in place; artifact item with no mapped node → create and add to the map; mapped node deleted by the user in Figma → recreate it and note that in the report; mapped node whose artifact item no longer exists → leave it untouched and list it under "Orphans" in the report. **Never delete Figma nodes.**

Work in batches (per collection, per catalog level) and verify each batch (e.g. re-read via `get_variable_defs` / `get_metadata`) before moving on, per the loaded Figma skills' guidance.

## Step 5 — Record the map

Create or update `.twt-artifacts/figma-export/figma-map.md`:

```markdown
---
generated: <ISO timestamp of this run>
area: figma-export
---

# Figma export map

## Target
- file-url: <https://www.figma.com/design/…>
- file-key: <key>
- origin: created-by-skill | user-provided

## Runs
| when (ISO) | skill | scope | result |
|---|---|---|---|
| … | twt-figma-design-system | foundations \| full | ok \| partial |

## Node map
### Variables
| token | collection | figma-id |
|---|---|---|
### Styles
| style | kind (text\|effect) | figma-id |
|---|---|---|
### Components
| component | variants | figma-key |
|---|---|---|
### Pages
| page × breakpoint | frame-id |
|---|---|---|
```

Preserve sections this run didn't touch (`### Pages` belongs to `/twt-figma-mockup` — never rewrite it). Append one `## Runs` row per invocation.

Then write `.twt-artifacts/figma-export/design-system-report.md`: frontmatter (`generated`, `skill`, `figma-file`), then sections **Created / Updated / Skipped (unchanged) / Recreated (deleted in Figma) / Orphans (removed from artifacts — left in Figma)**, each a list of item names, ending with the Figma file URL and the scope used.

## Step 6 — Report

Tell the user:
- The Figma file URL and what was pushed (counts: variables, styles, components created/updated)
- Files written: `figma-map.md`, `design-system-report.md` (say "updated" when they already existed)
- Any orphans or recreated nodes needing a human look
- What to do next: run `/twt-figma-mockup` to assemble page mockups from this library
