# twt Marketplace — Conventions

Single source of truth for marketplace-wide rules. Every skill in this repo follows these. When creating or updating a skill, read this file first.

---

## 1. Naming

- All commands start with `/twt-`; category is expressed only via the `category:` frontmatter field — there are no per-category subfolders
- **Orchestrators + standalone tools** live at `commands/twt-<name>.md` (flat — one file each, no subfolders); the file's basename must match the slash-command name exactly
- **Sub-skills** (`*-define`, `*-validate`, and `twt-brand-fetch`) live at `skills/twt-<name>-<role>/SKILL.md` (one directory per sub-skill); the directory name must match the skill name
- Use kebab-case throughout
- A sub-area orchestrator may use the **bare** form `/twt-<category>` (no `-<rest>` suffix); its file is `commands/twt-<category>.md`

## 2. Artifacts

- All outputs go under `.twt-artifacts/<area>/...` in the current working directory
- Exception: when a skill writes to a user-confirmed target path (e.g. a WordPress theme folder, or the static `site/` output root used by the `html` build target), it may write there — but the path must be confirmed with the user first
- Never write outside these locations
- `<area>` matches the category or a logical sub-area (e.g. `fetch-content`, `designer`, `elementor-theme`)
- Outputs may be **phase-scoped**: `.twt-artifacts/<phase>/<sub-area>/...`. For Phase 1, `<phase>` is `pre-design` (e.g. `.twt-artifacts/pre-design/brand/brand-brief.md`). For Phase 2, `<phase>` is `design` (e.g. `.twt-artifacts/design/design-system/tokens.md`)
- `.twt-artifacts/design/design-system/` is the **cross-phase shared source of truth** for the design system — later phases (Development, QA) read it whether or not a full Design phase ran
- `.twt-artifacts/pre-design/curation/facts.md` is the **reconciled source of truth for reusable facts** (firm tenure, counts, per-client metrics + attribution, self-descriptor noun, taglines) and **provided brand assets** (logo files + which variants are missing). `twt-curation-define` produces it by reconciling every source (brand book vs. site); when sources disagree it records the conflict rather than guessing. Authoring skills bind repeated facts to its canonical values, and validators check output against it. Absent it (e.g. a Figma express run that skips Pre-design), downstream skills fall back to binding facts to outlines/inventory as before

## 3. Skill file structure

Every skill file has three parts in fixed order: **frontmatter → Intent block → body**.

### 3.1 Frontmatter (required)

```yaml
---
name: twt-<category>-<rest>
category: <category>
description: <one-liner, under ~100 chars>
version: <semver>
accepts_arguments: <true|false>
inputs:
  - <input description>
dependencies:
  hard: [<list of other twt-* skill names>]
  soft: [<list of skills/tools that improve quality>]
reads:
  - <files/sources this skill consumes>
writes:
  - <paths this skill creates or modifies>
---
```

All listed fields are required. Use `[]` for empty lists.

### 3.2 Intent block (required, fixed structure)

```markdown
# /twt-<name>

## Intent

**Purpose:** [1-2 sentences — what this skill does and why]

**Non-goals:**
- [explicit boundaries]

**Success criteria:**
- [verification targets a future model can use after regeneration]

---
```

### 3.3 Body

Uses `## Step N — <name>` headings in execution order. First step is typically input gathering or dependency check; last step is the "what just happened" report.

## 4. User interaction

- If `$ARGUMENTS` is empty and the skill needs input, **prompt** — never assume defaults that affect the output
- Present every fixed-option choice with the **AskUserQuestion** tool — not numbered text menus. Use single-select for mutually-exclusive choices (mode, target, yes/no, use-as-is/refine/rebuild) and multi-select for non-exclusive ones (which phases, which findings). Give each question a short header and each option a label + description; don't add a manual "Other" option (the tool offers a free-type escape).
- **Per-question "You decide".** Any single-select question that has a sensible model default must offer a **"You decide"** option (the model picks the best answer and proceeds). Selecting it resolves **only that question** — it never cascades to auto-resolving later questions in the same skill or downstream skills. Each subsequent question is still asked. (Fully unattended runs are a separate, explicit mode — e.g. site `auto` — not a side effect of one "You decide".)
- Plain-text prompts remain only for **free-form input** (a URL, a name, notes, pasted content). Informational output (aborts, status tables, reports) is not a choice and stays plain text.
- **Ask one question at a time.** When a skill needs several free-form answers (e.g. an intake interview), pose one question, wait for the answer, then ask the next — never stack multiple questions into a single prompt. A person answers more accurately, and gives you more to work with, one question at a time. (AskUserQuestion may batch up to a few *fixed-option* questions in one call when they're genuinely independent, but free-form prompts are always sequential.)
- Transition note: skills authored before 2026-06-02 may still print numbered menus until the interactive-menu retrofit converts them; new skills must use AskUserQuestion from creation.
- If a hard dependency is missing (e.g. `conventions.md` not found), **abort with a clear message** pointing to the skill that creates it

## 5. Cross-skill dispatch

- To run another twt skill from inside a skill, use the Agent tool with a prompt that references the target skill's Intent block
- Do not reproduce another skill's logic inline — dispatch instead
- Hard-dispatch (always required) must appear in frontmatter `dependencies.hard`
- Soft-dispatch (optional improvement) goes in `dependencies.soft`

## 6. Reporting

- Every skill ends with a "what just happened" summary: files written (with paths), key decisions made, what to do next
- If files were appended (not created), say so explicitly
- If files were skipped because they already existed, say so

## 7. Generated documentation

- `SKILLS.md` and `architecture.md` are **auto-generated** by `/twt-marketplace-docs` (via `tools/gen-docs.mjs`); per-category `skills/<cat>/README.md` files no longer exist
- `/twt-marketplace-docs` also stamps `(vX.Y.Z)` into each skill's committed `description:` field, derived from its `version:` frontmatter — this replaces the version injection that the legacy installer performed at copy time
- Never hand-edit generated files. Edit frontmatter or `CONVENTIONS.md` and regenerate.
- **Shared inline blocks are synced, not hand-copied.** The Step 0 setup gate's canonical text lives in `templates/blocks/setup-gate.md`; `/twt-marketplace-docs` re-stamps it into every `commands/*.md` whose body contains a `## Step 0 … permission allowlist` heading. To change the gate, edit the canonical block and regenerate — never edit one command's copy.
- The root `README.md` is hand-edited except for the marked block between `<!-- TWT_SKILLS_TABLE_START -->` and `<!-- TWT_SKILLS_TABLE_END -->`.
- To merge the curated runtime permission allowlist into a target project's `settings.json`, run `/twt-setup` (opt-in, per project) — not auto-seeded at install time.

## 8. Fetch / define / validate roles

- Skills that fetch, define, or validate within a sub-area suffix the role: `/twt-<area>-fetch`, `/twt-<area>-define`, `/twt-<area>-validate`
- The bare `/twt-<area>` is reserved for the orchestrator that composes them
- `fetch` extracts from an external source (writes a raw artifact); `define` produces/refines the canonical artifact through dialogue; `validate` critiques it
- Exception — an **audit-only** phase (e.g. `qa`), where every skill is a read-only audit with no fetch/define counterpart, may name its skills `/twt-<category>-<dimension>` without the `-validate` suffix; the bare `/twt-<category>` still names the orchestrator

## 9. Sub-area orchestrator pattern

- The bare-name skill dispatches its sub-skills via the Agent tool (per rule 5) and runs a **single-pass** define → validate cycle — **not** an iterative loop. (Changed 2026-06-17: the former ≤3-iteration loop re-dispatched define+validate as fresh subagents each pass, burning tokens without materially improving the artifact. Quality comes from one good define plus one critique, not from self-revision laps.)
- Sub-skills are declared in `dependencies.soft` (the orchestrator degrades gracefully if one is missing).
- **Standalone** (user invoked the bare orchestrator directly — no `subagent-collect`): dispatch `define` once, then `validate` once; surface open decisions (rule 13) and report Band + Health + findings. If unresolved **BLOCKERs** remain, **report and stop** — present them with human-decision options (answer open questions / accept and edit directly / defer) and offer a manual re-run; never auto-loop.
- **Orchestrated / collect mode** (`subagent-collect` present — dispatched by a phase wrapper or an `auto` run): dispatch `define` **once** and instruct it to **self-check against the sibling `/twt-<area>-validate` rubric** (§12), writing the sibling `validation-report.md` in the §12 format and recording Band/Health, any BLOCKER/WARNING, and open decisions in `decisions.md`. **Skip the separate `*-validate` dispatch** — the fold-in replaces it, roughly halving the dispatch count of a full pipeline run. Bubble decisions upward (rule 13); the level the user typed surfaces them.
- **At most one** re-run of `define` is permitted, and only to (a) finalize decisions once the user has answered surfaced questions, or (b) fix unresolved **BLOCKERs** when new information makes them fixable. Never re-run on WARNING/SUGGESTION, never to chase a higher Health score, never more than once.

## 10. Define idempotency

- Every `*-define` skill must detect an existing canonical artifact and enter **refinement mode** (reading any sibling `validation-report.md`) instead of starting from scratch
- Never overwrite the canonical artifact without explicit user consent

## 11. Validator read-only

- Every `*-validate` skill may write **only** its own sibling `validation-report.md` — no other side effects
- **Fold-in exception (§9 collect mode):** when an orchestrator folds validation into `define` (orchestrated/collect runs), `define` performs the validator's §12 rubric self-check and writes that same `validation-report.md` in the validator's place — so downstream synthesis can still aggregate BLOCKERs. The standalone `*-validate` skill itself stays read-only.

## 12. Validation report format

- Every `validation-report.md` opens with a **Scorecard**: a fixed, weighted criteria list (weights sum to 100), each scored 0–5 with a one-line **Evidence** note, producing a weighted **Health 0–100** and **Band** (Pass ≥ 80 / Revise 50–79 / Fail < 50; a skill may tighten its own Pass bar).
- Scores are **evaluative** (judgment + evidence), never presence-only. "Field exists" is not a criterion; "palette meets WCAG AA on key pairings" is.
- After the Scorecard: a **`## Decisions to confirm`** section listing inferred rules / judgment calls the user must approve before they bind (empty if none), then **`## Findings`** using severity tiers **BLOCKER / WARNING / SUGGESTION**, each with **Where / Problem / Recommendation** (Problem states *why*, with evidence), then a one-paragraph **`## Summary`** tying band to top findings.
- The exact skeleton lives in `templates/validation-report.md`.

## 13. Surface-up decisions (interactive skills under orchestration)

- An interactive `*-define`/`*-validate` skill detects **collect mode** by the token `subagent-collect` in its `$ARGUMENTS`. In collect mode it must **not** call `AskUserQuestion`; instead it writes open decisions to a sibling **`decisions.md`** (`## Open questions`, `## Model-decided assumptions`, `## Proposed rules`) and returns that block in its report. Outside collect mode (user-invoked, main thread) it asks the user live as normal.
- When an orchestrator dispatches a sub-skill via the Agent tool, it **passes `subagent-collect`** in the dispatch prompt and, after the child returns, **aggregates** any `decisions.md` upward. The skill the **user invoked** runs without the flag and is the **surfacing point**: it presents aggregated open decisions via `AskUserQuestion`, then re-dispatches the relevant `*-define` in refinement mode with the answers (which clears `decisions.md` → `status: resolved`).
- Each surfaced question is presented with a **"You decide"** option (per §4) that accepts the decision's **recorded leaning** (from `decisions.md`). Picking it resolves only that question — the remaining surfaced questions are still asked.
- Net effect: surfacing always happens at the level the user typed, even through nested subagents (`site → pre-design → twt-brand → brand-define`). No subagent silently commits a user-facing creative or constraint decision.

## 14. Self-contained at runtime (stay in-project)

- Skills are surfaced by the native plugin (from `commands/` and `skills/`); the marketplace's `templates/`, `CONVENTIONS.md`, and sibling skills **do not travel** with the running skill's context. A skill must therefore carry **inline** every artifact format it writes (the `decisions.md`, `design-read.md`, asset-manifest, session-log, etc. schemas) — never reference a `templates/…` path at runtime. Bundled Node scripts are invoked as `node "${CLAUDE_PLUGIN_ROOT}/tools/..."`.
- A running skill operates **only inside the current project** (its working tree + `.twt-artifacts/`). It must **never** read outside the project — no sibling project folders, no home directory, no filesystem-wide `find` — to locate templates, conventions, or "format examples." Everything it needs is in the skill text or the project. The scope-guard hook is the backstop, not a license to reach out.
- Exception: the export skills (`twt-export-*`) genuinely need `tools/export-*.mjs` + `templates/*-export-style.md` from the marketplace checkout. If those are missing they **stop with a clear message** — they never search the disk for them.

## 15. Read artifacts with the file tools, never shell

- To read or scan any artifact (`decisions.md`, `validation-report.md`, `tokens.md`, mockups, briefs, …), use the **Read / Glob / Grep** tools — **never** a Bash command (`cat`, `grep`, `sed`, `awk`, `head`, `tail`, or a `for`/`while` loop over files). A compound shell command (`cd "<abs>" && for f in */decisions.md; do cat "$f"; done`) cannot be statically matched by the permission allowlist, so it prompts the user on every run; the file tools are auto-scoped to the project and never prompt.
- To read a **set** of sibling files (e.g. every sub-area's `decisions.md` or `validation-report.md`), **Glob** the pattern (`.twt-artifacts/pre-design/*/decisions.md`) to list them, then **Read** each, or **Grep** across them with a pattern — do not shell out to a loop.
- Never `cd` into an absolute path or embed an absolute project path in a shell command. Paths in skills stay **project-relative** (`.twt-artifacts/...`); the file tools resolve them against the working directory.
- Bash remains correct for genuine non-file work the file tools can't do — running `node`/`python` tools, `pdftotext`, installers, git. This rule is about *reading artifacts*, not banning Bash.
- **No throwaway scripts, heredocs, or command chains.** Never write a one-off `.mjs`/`.js`/`.py`/`.sh` helper via a heredoc (`cat > /tmp/x.mjs <<'EOF' … EOF; node /tmp/x.mjs`) to transform a file, fill template slots, or compute something — heredocs carry quotes + braces that trip the shell **obfuscation guard** and force a permission prompt every single time, and they re-implement logic a bundled `tools/*.mjs` (or the Edit tool) already does. Edit files with the **Edit** tool; compute with the **bundled tools** (`gen-preview.mjs`, `qa-scan.mjs`, …) and read their JSON output. Likewise avoid compound chains (`cmd1 && cmd2`, `a; b; c`) and `perl -pe`/`sed -i` in-place edits over files — each is unmatchable by the allowlist and prompts. Keep every Bash call a **single, simple, allowlistable command** (`node "${CLAUDE_PLUGIN_ROOT}/tools/foo.mjs" <arg>`), one per invocation.

## 16. Export themes and doc-type profiles

- A theme is a directory: `theme.json` + `css/{tokens,doc,slide,components}.css` (+ optional `css/profiles/<id>.css`, `fonts/*.woff2`, `reference/reference.{docx,pptx}`, `preview/`). Built-in themes live in `templates/themes/`; project themes in `.twt-artifacts/export/themes/<slug>/`. The built-in `doc-hub-light` is the default everywhere; brand themes are opt-in via `/twt-export-template-create`.
- Theme CSS uses the `--tx-*` namespace; `--hs-*` remains as compat aliases for the non-export HTML generators. Theme creation substitutes `--hs-*` values; `--tx-*` follows.
- Doc-type detection is deterministic (`tools/export-doctype.mjs`): filename registry first, structural fingerprints second, `generic` fallback. Profiles: `report`, `brief`, `spec`, `generic`, `slides`. New artifact → add one registry row or accept generic.
- Rendering uses pandoc-AST block transforms (`tools/export-transform.mjs`) that emit typed components. Guarantees: unmatched blocks render as plain pandoc HTML; any transform error falls back to the untransformed path and is logged in render-notes. Exports never hard-fail on styling.
- Document exports always save the intermediate `<slug>.html` beside the PDF. render-notes must state: theme (slug + source), doc type + evidence, transforms applied, font source.
- DOCX/PPTX get theme-consistent reference docs only (global typography/colors); doc-type components are HTML/PDF-only and render-notes says so.

---

## Out of scope for this document

- Skill-specific instructions
- Markdown style nitpicks
- Tool-use preferences
- Anything that only one skill cares about
