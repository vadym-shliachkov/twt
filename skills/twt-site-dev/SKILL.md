---
name: twt-site-dev
surface: command
category: site-dev
family: site-dev
role: pipeline
unit: twt-develop
description: (v1.5.15) Phase 3 express — from a Figma link, build/update the design system and jump to development, with an always-on dispatch trace
version: 1.5.15
accepts_arguments: true
inputs:
  - Figma URL (via $ARGUMENTS or prompt); optional screenshots/notes; target chosen via menu
  - Optional first token `auto` — fully unattended run; everything after it is free-form context (Figma URL required, target hints, notes)
dependencies:
  hard: []
  soft:
    - twt-design-system-define
    - twt-component-define
    - twt-elementor-theme-creator
    - twt-elementor-block-creator
    - twt-html-site-creator
    - twt-html-block-creator
    - twt-inherit-define
    - twt-inherit-block-creator
    - twt-content-approval-checklist
    - twt-figma-dev-audit
    - twt-fidelity
    - figma-mcp
reads:
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - .twt-artifacts/elementor-theme/conventions.md
  - .twt-artifacts/html-site/conventions.md
  - .twt-artifacts/inherited/conventions.md
  - .twt-artifacts/figma-dev-audit/readiness-report.md
writes:
  - .twt-artifacts/site-dev-log.md
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/design/design-system/component/gallery.html
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
---

# /twt-site-dev

## Intent

**Purpose:** The short path. From a Figma link, create or update the cross-phase design-system spine, create the content approval workbook as a parallel confirmation artifact, auto-scaffold the chosen target if needed, then jump straight to page/block development using current Figma content. Skips the full Phase-1/Phase-2 pipeline. With the first token `auto`, runs fully unattended — every choice inferred from the provided context, zero questions.

**Non-goals:**
- Doesn't run pre-design or design phases (use `/twt-pre-design` / `/twt-design` for those)
- Doesn't reproduce design-system / scaffold / builder logic — dispatches each via the Agent tool (rule 5)
- Doesn't replace an existing design system — extends it (tokens are never revalued)
- Auto mode never grants destructive consents (in-place replacement, overwriting user-confirmed targets) — children write to artifacts and the scaffold only

**Success criteria:**
- Target chosen (HTML or Elementor) via menu — or, in auto mode, inferred from the context/existing scaffold with the inference logged
- Auto mode asks **nothing** (no AskUserQuestion, no prompts); a missing Figma URL aborts with a clear message instead of prompting
- `/twt-design-system-define` runs in analyse-existing mode from the Figma link (spine created or updated)
- `/twt-content-approval-checklist` creates or reuses `.twt-artifacts/content-approval/content-approval-checklist.xlsx` before development
- The target's scaffold is ensured (created if its `conventions.md` is missing — theme-creator before block-creator for Elementor)
- The matching builder is dispatched to start page/block development
- Approved workbook rows are not applied automatically; after stakeholder confirmation, the user runs `/twt-content-approval-implement` to update corresponding blocks/pages

---

Arguments passed to this command: $ARGUMENTS

## Step 0 — Mode
If the **first token** of `$ARGUMENTS` is `auto`, enable **auto mode**: strip the token and treat the rest as free-form context (Figma URL, target hints like "elementor"/"html", notes). In auto mode ask **nothing** — no AskUserQuestion, no plain-text prompts; decide from the context, the existing `.twt-artifacts/` state, and the defaults below, and log every auto-decision for the final report. Without the leading `auto`, run interactively as before.

If `$ARGUMENTS` contains a Figma URL, use it; otherwise ask for one — **except in auto mode**, where a missing Figma URL aborts: "Auto mode needs the Figma URL in the arguments: /twt-site-dev auto <figma-url> [notes]".

## Bash call shape — keep every call allowlist-matchable
The permission rules `/twt-setup` seeds match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`); a call that doesn't match forces a manual prompt even when the binary is allowlisted. So for **every** Bash call in this run: never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`). **Present:** continue without asking (the seeder is idempotent). **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**; on run, dispatch `/twt-setup` (Agent tool), wait, continue. **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue. Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**. This gate lives only on the pipeline entry points; skills dispatched from here inherit the seeded allowlist and never re-check.

## Step 0a — Open the session log
Start a session log at `.twt-artifacts/site-dev-log.md` (create the file/dir if missing) by **appending** a new `## Run <ISO timestamp>` section in the session-log format (a `# Session log` heading, then per invocation a `## Run <ISO timestamp>` section with **Command** / **Mode** (interactive|auto) / **Target** / **Requested** (one-line context) fields, a `### Timeline` of numbered entries — each either `[question] <header>` with the asked text + answer, or `[step] <phase>` with the skill used + a one-sentence why (in auto mode record `auto-decision: <value> (from <evidence|default>)`) — and a `### Outcome` block: phases/steps completed · outstanding BLOCKERs · key artifact paths) — never rewrite earlier runs. Record Command, Mode (interactive/auto), Target (tbd until Step 1), and the user's free-form Requested context. Then **keep the Timeline live for the rest of the run**: append one numbered entry for **every** question you ask (the question text + the user's answer, or, in auto mode, the inferred `auto-decision: <value> (from <evidence|default>)`) and one for **every** skill you dispatch (`[step]` + the skill name + a **one-sentence** why). Surfaced child `decisions.md` questions and their answers are logged the same way. This logging is **not** skipped in auto mode — auto runs especially need the trail. **Append `[question]` entries via the bundled appender** (Bash): `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --timeline "<Header>: <question text> → <answer>"` — it numbers the entry and pins the exact `N. [question] Header: text → answer` shape that `wiki-harvest.mjs` parses (a freehand line that drifts is invisible to the wiki). `[step]` entries you still write by hand — the harvester deliberately ignores them. If the hook file is missing, write the `[question]` line by hand in that same shape.

## Step 0b — Arm the dispatch tracer (always)
Arm the always-on run trace (no flag): run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --arm "site-dev $ARGUMENTS"`. The label includes `site-dev`, so the tracer folds its output into `site-dev-log.md` (not `site-log.md`). The `Task|Agent|Skill|AskUserQuestion` hooks then record every dispatch — twt builders **and** any other Skill-tool call — to `.twt-artifacts/.twt-debug/events.jsonl`; it is inert in any session without the sentinel. If the hook file is missing (global install without bundled hooks), continue without the trace. **Prefix every dispatch prompt with a `WHY:` line** so the trace records real intent. There is no token column (not exposed to hooks).

## Step 1 — Target menu

**Auto mode:** infer `<target>` and skip the menu — "elementor"/"wordpress" in the context or an existing `.twt-artifacts/elementor-theme/conventions.md` → **elementor**; an existing `.twt-artifacts/html-site/conventions.md` → **html**; an existing `.twt-artifacts/inherited/conventions.md` → **inherit**; otherwise default **html**. Record the inference and its reason.

Otherwise ask via the **AskUserQuestion** tool (single-select, header "Target") What is the build target?:
- **Static HTML/CSS** — dependency-free static site
- **Elementor (WordPress)** — Hello Elementor child theme with widgets
- **Use this project's existing stack** — build into the current codebase in its own idiom (runs `/twt-inherit-define` to discover conventions, then `/twt-inherit-block-creator`)
- **You decide** — I pick the best-fit target from the project context (existing `inherited/conventions.md`, `elementor-theme/conventions.md`, or `html-site/conventions.md`, or other hints; defaults to Static HTML/CSS)

Record the choice as `<target>` and continue.

**Target descriptor.** Resolve `<target>` once and use the descriptor for the rest of the run:

| target | conventions | builder | platform | assets root |
|---|---|---|---|---|
| `html` | `.twt-artifacts/html-site/conventions.md` | `/twt-html-block-creator` | `web` | `site/assets` |
| `elementor` | `.twt-artifacts/elementor-theme/conventions.md` | `/twt-elementor-block-creator` | `wordpress` | `<THEME>/assets` |
| `inherit` | `.twt-artifacts/inherited/conventions.md` | `/twt-inherit-block-creator` | `wordpress` if the host is a WordPress theme, else `web` | the **File layout** section of the inherited `conventions.md` — never a path this skill invents |

**Dispatch modes (§13) — binding for every Agent call in this skill.** A dispatched skill that would ask the user something must be dispatched with `subagent-collect` **and** have its returned `decisions.md` surfaced, because `AskUserQuestion` does not work inside a subagent. "Collect-and-surface" means: pass the flag, then present the child's decisions via `AskUserQuestion` on the main thread (auto mode: resolve them yourself and log each; collect mode: aggregate into your own report for the orchestrator above).

| Step | Dispatch | Mode |
|---|---|---|
| 0·setup | `/twt-setup` | plain — interactive-only, and the one question it needs is asked here before dispatching |
| 2·pre | `/twt-figma-dev-audit` | collect (advisory; the proceed prompt is asked here, on the main thread) |
| 2 | `/twt-design-system-define`, `/twt-component-define` | collect-and-surface |
| 2a | `/twt-content-approval-checklist` | collect (no user-facing gate to surface) |
| 3 | `/twt-elementor-theme-creator`, `/twt-html-site-creator` | plain — scaffolders, no gate |
| 3 | `/twt-inherit-define` | **collect-and-surface** — its Step 7 review gate is user-facing |
| 4 | `/twt-html-block-creator`, `/twt-elementor-block-creator` | collect-and-surface |
| 4 | `/twt-inherit-block-creator` | **collect-and-surface** — its Step 5 consolidated write approval is user-facing |
| 4b | `/twt-fidelity` | **collect-and-surface** — opt-in per its own gate; skipped silently in collect mode or an unattended `auto` run |

No inherit dispatch in this skill is left mode-unstated. A bare `(Agent tool)` on either inherit skill is a defect, not a shorthand.

## Step 2·pre — Developer readiness check (advisory)

Run before the design system is derived: a blocker in the Figma file invalidates the spine that Step 2 builds from it.

**Skip silently** if Step 0 did not obtain a Figma URL — no prompt, no warning, no log entry.

If `.twt-artifacts/figma-dev-audit/readiness-report.md` already exists: **standalone interactive**, ask via **AskUserQuestion** (single-select, header "Readiness"): **Reuse the existing report** (recommended) / **Re-run the audit** / **You decide**. **Collect mode (dispatched by an orchestrator, e.g. `/twt-site` under Express) or an unattended `auto` run**, reuse and log it without asking.

Otherwise dispatch `/twt-figma-dev-audit` via the Agent tool with `subagent-collect`, prefixing the prompt with a `WHY:` line for the dispatch trace, passing the Figma URL obtained in Step 0 and the chosen `<target>` as the platform hint (`elementor` → `--platform wordpress`, `html` → `--platform web`, `inherit` → `--platform wordpress` if the host is a WordPress theme per the descriptor, else `--platform web`).

When it returns, state the Blocker and High counts and the report path. **Standalone interactive**, ask via **AskUserQuestion** (single-select, header "Proceed"): **Proceed anyway** (the audit is advisory; findings do not block the build) / **Stop and fix first** (pause here; nothing further runs) / **You decide**. **Collect mode or an unattended `auto` run, always continue** — record the counts, the report path, and the decision to continue in the session log, and move on. An unattended run must never halt on this.

The audit writes only under `.twt-artifacts/figma-dev-audit/` and changes nothing the rest of this run depends on.

## Step 2 — Design system from Figma

Capture the Figma URL (from `$ARGUMENTS` or prompt). Dispatch `/twt-design-system-define` (Agent tool) in **analyse-existing** mode with `subagent-collect` (rule 13), passing the Figma URL as the design source, to create or update `.twt-artifacts/design/design-system/` (`tokens.md`, `tokens.css`, `preview.html`). Interactively, surface any returned `decisions.md` questions via AskUserQuestion; in auto mode, resolve them yourself — prefer answers derivable from the context, else accept the child's proposed assumption — and log each one.

Pass through the priority rule: an existing project design system is the baseline; tokens are **extended, never replaced**; use refinement mode if `tokens.md` already exists.

Wait for it to finish; confirm `.twt-artifacts/design/design-system/tokens.css` exists.

Then dispatch `/twt-component-define` (Agent tool) with `subagent-collect` to build the component catalog (`component/components.md` + `gallery.html`) from the just-written tokens. A complete design system requires all primitives, components, and modules — not just tokens. Surface any `decisions.md` questions the same way as for design-system above.

## Step 2a — Content approval workbook

Dispatch `/twt-content-approval-checklist` via the Agent tool with `subagent-collect`, passing the Figma URL, design-system output, page/screen names if known, and any notes. If `.twt-artifacts/content-approval/content-approval-checklist.xlsx` already exists, instruct the child to reuse/refine without overwriting existing approved content.

After the child returns, verify `.twt-artifacts/content-approval/content-approval-checklist.xlsx` exists. If it is missing, stop before scaffold/build work and report the child output plus the Figma/source context that was passed in. Do not silently continue without the workbook; the express build can use current Figma content only after the approval artifact exists as the stakeholder review surface.

In interactive mode, tell the user this workbook is the human approval surface for copy, links, images, videos, header/footer, and SEO. Development continues with the current Figma/design content; approved workbook rows are applied later only when `/twt-content-approval-implement` is explicitly called.

## Step 3 — Ensure scaffold

- `<target>` = **elementor**: if `.twt-artifacts/elementor-theme/conventions.md` is missing, dispatch `/twt-elementor-theme-creator` (Agent tool) first. If present, skip.
- `<target>` = **html**: if `.twt-artifacts/html-site/conventions.md` is missing, dispatch `/twt-html-site-creator` (Agent tool) first. If present, skip.
- `<target>` = **inherit**: if `.twt-artifacts/inherited/conventions.md` is missing, dispatch `/twt-inherit-define` (Agent tool) **with `subagent-collect`** first, then surface what it returns per the rule below. If present, skip. There is **no scaffolder for this target** — the scaffold is the host project, which already exists; `/twt-inherit-define` discovers its conventions rather than creating them.

  **Surface its review gate before Step 4 builds anything (§13).** `/twt-inherit-define`'s Step 7 is the checkpoint that makes adapting to a host safe — the user confirms the stack, styling system, exemplars and asset root that everything downstream binds to. It is an `AskUserQuestion` gate, and `AskUserQuestion` **does not work inside a subagent**, so a bare dispatch stalls it or skips it silently. Always pass the flag, then Read `.twt-artifacts/inherited/decisions.md` and present its `## Open questions` and `## Proposed rules (confirm before binding)` via **AskUserQuestion** (one question per open decision, each with a **"You decide"** option accepting the recorded `model-leaning`), then re-dispatch `/twt-inherit-define` with `subagent-collect` in refinement mode with the answers. **In auto mode**, resolve them yourself the same way as Step 2 — prefer answers derivable from the context, else accept the child's proposed assumption — and log each one. **In collect mode** (dispatched by `/twt-site` under Express), aggregate the block into your own report and let the orchestrator above surface it. Surfacing must happen **here, before Step 4**: `/twt-inherit-block-creator` writes to the same `decisions.md`, so an unsurfaced conventions decision is overwritten by the first build and lost.

(Unlike the builders, this skill never bails on a missing scaffold — it creates it. The inherit arm is the exception noted above: there is nothing to create, only to discover.)

## Step 4 — Build

Dispatch the matching builder (Agent tool) with `subagent-collect`, forwarding the Figma URL and any notes so it starts page/block development (in auto mode, resolve its open decisions the same way as Step 2):
- `<target>` = **elementor** → `/twt-elementor-block-creator`
- `<target>` = **html** → `/twt-html-block-creator`
- `<target>` = **inherit** → `/twt-inherit-block-creator`

**Then surface what the builder returned — this step is not finished at the dispatch (§13).** Step 2 already does this for `/twt-design-system-define` ("Interactively, surface any returned `decisions.md` questions via AskUserQuestion"); the builder needs it just as much and for higher stakes. Read `.twt-artifacts/<html-site|elementor-theme|inherited>/decisions.md` if the child wrote one, and present its open questions via **AskUserQuestion**; in auto mode resolve them yourself and log each one; in collect mode aggregate them into your own report.

**For `<target>` = inherit this is load-bearing, not housekeeping.** `/twt-inherit-block-creator` writes into a repo somebody else owns. In collect mode it always takes the safe *new files only* path and defers every existing-file edit into `.twt-artifacts/inherited/decisions.md` under `## Proposed rules (confirm before binding)`. If that list is never surfaced, **every modification is permanently deferred to a TODO and the user is never asked at all** — the one consolidated approval the whole target is built around never happens. So:
- **Interactive:** present the whole scope **once**, in the builder's own shape — the CREATE count, then each MODIFY path with what changes and its line estimate — and ask via **AskUserQuestion** (single-select, header "Changes"): **Approve the whole plan** / **New files only — report the modifications as TODOs** / **Stop** / **You decide** (defers every MODIFY to TODOs — the conservative default when writing into a real repo). On approve, **re-dispatch `/twt-inherit-block-creator` for the same page with `subagent-collect modifications-approved`**; its pre-approved branch applies the MODIFYs without asking again. Log the gate Q&A to the Timeline like any other question.
- **Auto mode:** never auto-approve a MODIFY. Leave every modification as a TODO, and list them in Step 5 as auto-decisions the user must review. Silence is not consent for edits to a repo the user did not hand us.
- **Collect mode** (dispatched by `/twt-site` under Express): return the decisions block verbatim and leave the MODIFYs deferred; the orchestrator above surfaces it and re-dispatches you.

Say plainly in Step 5 how many approvals an inherit build asked for: **one** for the inherited conventions (Step 3, first run only) plus **one per builder dispatch**. The builder's predictable MODIFY set — route registration, nav/menu config, the global stylesheet import — is shared across pages by construction, so the same file can appear in more than one prompt. A single cross-page consolidated plan is a recorded follow-up, not shipped behaviour.

## Step 4b — Fidelity pass (opt-in)

Only when a Figma URL was obtained in Step 0 **and** `<target>` is **html** — the only target the measured loop covers end-to-end without extra setup (per the Target descriptor table, `elementor` needs a live/staging `--url` to be measured at all, and `inherit`'s host-repo build isn't one of `/twt-fidelity`'s two supported builders).

**Standalone interactive:** ask via **AskUserQuestion** (single-select, header "Fidelity"): **Run the fidelity pass** (measures the build against the Figma frame and fixes measured deltas; costs one or more extra builder passes) / **Skip** (recommended for a first pass) / **You decide** (defaults to Skip — the loop's extra builder passes are exactly the express-lane cost this step is opt-in to avoid by default). **Collect mode or an unattended `auto` run: skip silently** — an always-on pass would multiply the cost of every express run without being asked for.

If run: dispatch `/twt-fidelity` (Agent tool) with `subagent-collect`, `WHY: measuring the built page against the Figma frame before calling this pass done`, passing the Figma URL as the reference source, `--build html`, the page Step 4's builder wrote (`<built>`), and `--mode system`. **Surface what it returns the same way Step 4 does for the builder** — if its report names a `decisions.md` path, Read it and present the open questions via **AskUserQuestion**; in auto mode resolve them yourself and log each one; in collect mode aggregate them into your own report.

Record the resulting Band, Health, and remaining failure count — read from its own returned report, never by re-opening `summary.json` yourself (that file is `/twt-fidelity`'s own internal read, per its Step 5) — in the session log. Advisory — a remaining failure never blocks the run.

## Step 5 — Report & finalize the log
**First** finalize the curated session log: ensure every question/answer and every dispatched skill is in the Timeline, then fill the run's **Outcome** block (steps completed · outstanding BLOCKERs · key artifact paths) in `.twt-artifacts/site-dev-log.md`. Do all `site-dev-log.md` edits **before** the next step (the summarizer appends to end-of-file).

**Then** regenerate the consolidated review dashboard (Bash, single command): `node "${CLAUDE_PLUGIN_ROOT}/tools/gen-report.mjs" "$CLAUDE_PROJECT_DIR"` — it gathers any `phase-review.md` and the QA report into `.twt-artifacts/reports/` (copies + an on-brand `index.html` with open decisions surfaced at the top). Convenience view, never a gate — if it errors, continue.

**Then** run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --summarize` — it folds the full dispatch trace (every Task/Agent dispatch and Skill call — twt + any other plugin/system skill, with WHY + wall-time) plus the wall-time cost tables into `.twt-artifacts/site-dev-log.md`, then disarms. Do this even on an early stop. (If never armed — hook missing — skip.) No token column (not available to hooks).

Then state to the user: target chosen, whether the spine was created or updated, whether the content approval workbook was created or reused, whether a scaffold was run, what the builder produced (with paths), and that approved workbook content was not auto-applied. **Call out the content-approval workbook explicitly** — its full path `.twt-artifacts/content-approval/content-approval-checklist.xlsx` and row count on its own line — and that approved rows apply only when `/twt-content-approval-implement` is run. Point to **the single log** at `.twt-artifacts/site-dev-log.md` (curated Timeline + auto-folded dispatch trace & cost) and, on its own line, the consolidated review dashboard **`.twt-artifacts/reports/index.html`**. In auto mode additionally list **every auto-decision** (target inference, resolved child decisions, defaults applied) — the user's review checklist for the unattended run. Point to the next call (`/twt-site-dev` for another block, `/twt-content-approval-implement` after approvals, or the builder directly).
