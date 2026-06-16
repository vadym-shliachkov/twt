# twt Marketplace — Conventions

Single source of truth for marketplace-wide rules. Every skill in this repo follows these. When creating or updating a skill, read this file first.

---

## 1. Naming

- All commands start with `/twt-<category>-...` where `<category>` is the folder name under `skills/`
- File name matches the command name exactly (sans `.md`); e.g. `/twt-content-fetch-site` lives at `skills/content/twt-content-fetch-site.md`
- Use kebab-case throughout
- A sub-area orchestrator may use the **bare** form `/twt-<category>` (no `-<rest>` suffix); its file is `skills/<category>/twt-<category>.md`

## 2. Artifacts

- All outputs go under `.twt-artifacts/<area>/...` in the current working directory
- Exception: when a skill writes to a user-confirmed target path (e.g. a WordPress theme folder, or the static `site/` output root used by the `html` build target), it may write there — but the path must be confirmed with the user first
- Never write outside these locations
- `<area>` matches the category or a logical sub-area (e.g. `fetch-content`, `designer`, `elementor-theme`)
- Outputs may be **phase-scoped**: `.twt-artifacts/<phase>/<sub-area>/...`. For Phase 1, `<phase>` is `pre-design` (e.g. `.twt-artifacts/pre-design/brand/brand-brief.md`). For Phase 2, `<phase>` is `design` (e.g. `.twt-artifacts/design/design-system/tokens.md`)
- `.twt-artifacts/design/design-system/` is the **cross-phase shared source of truth** for the design system — later phases (Development, QA) read it whether or not a full Design phase ran

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
- **Per-question "You decide".** Any single-select question that has a sensible model default must offer a **"You decide"** option (the model picks the best answer and proceeds). Selecting it resolves **only that question** — it never cascades to auto-resolving later questions in the same skill or downstream skills. Each subsequent question is still asked. (Fully unattended runs are a separate, explicit mode — e.g. roast-full `auto` — not a side effect of one "You decide".)
- Plain-text prompts remain only for **free-form input** (a URL, a name, notes, pasted content). Informational output (aborts, status tables, reports) is not a choice and stays plain text.
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

- `SKILLS.md`, `architecture.md`, and `skills/*/README.md` are **auto-generated** by `/twt-marketplace-docs`
- Never hand-edit these files. Edit frontmatter or `CONVENTIONS.md` and regenerate.
- The root `README.md` is hand-edited except for the marked block between `<!-- TWT_SKILLS_TABLE_START -->` and `<!-- TWT_SKILLS_TABLE_END -->`.

## 8. Fetch / define / validate roles

- Skills that fetch, define, or validate within a sub-area suffix the role: `/twt-<area>-fetch`, `/twt-<area>-define`, `/twt-<area>-validate`
- The bare `/twt-<area>` is reserved for the orchestrator that composes them
- `fetch` extracts from an external source (writes a raw artifact); `define` produces/refines the canonical artifact through dialogue; `validate` critiques it
- Exception — an **audit-only** phase (e.g. `qa`), where every skill is a read-only audit with no fetch/define counterpart, may name its skills `/twt-<category>-<dimension>` without the `-validate` suffix; the bare `/twt-<category>` still names the orchestrator

## 9. Sub-area orchestrator pattern

- The bare-name skill dispatches its sub-skills via the Agent tool (per rule 5) and runs the bounded validate loop
- Sub-skills are declared in `dependencies.soft` (the orchestrator degrades gracefully if one is missing)
- The loop is **bounded**: max 3 `define → validate` iterations. It **stops** when the validator's Band = Pass **and** the sibling `decisions.md` is resolved/empty. Otherwise it surfaces open decisions (rule 13) and re-runs `define`. No-progress break: stop early when the Health score does not increase between iterations. On unresolved BLOCKERs or a sub-Pass band after 3 passes, **report and stop** (never auto-fix, never loop unbounded).

## 10. Define idempotency

- Every `*-define` skill must detect an existing canonical artifact and enter **refinement mode** (reading any sibling `validation-report.md`) instead of starting from scratch
- Never overwrite the canonical artifact without explicit user consent

## 11. Validator read-only

- Every `*-validate` skill may write **only** its own sibling `validation-report.md` — no other side effects

## 12. Validation report format

- Every `validation-report.md` opens with a **Scorecard**: a fixed, weighted criteria list (weights sum to 100), each scored 0–5 with a one-line **Evidence** note, producing a weighted **Health 0–100** and **Band** (Pass ≥ 80 / Revise 50–79 / Fail < 50; a skill may tighten its own Pass bar).
- Scores are **evaluative** (judgment + evidence), never presence-only. "Field exists" is not a criterion; "palette meets WCAG AA on key pairings" is.
- After the Scorecard: a **`## Decisions to confirm`** section listing inferred rules / judgment calls the user must approve before they bind (empty if none), then **`## Findings`** using severity tiers **BLOCKER / WARNING / SUGGESTION**, each with **Where / Problem / Recommendation** (Problem states *why*, with evidence), then a one-paragraph **`## Summary`** tying band to top findings.
- The exact skeleton lives in `templates/validation-report.md`.

## 13. Surface-up decisions (interactive skills under orchestration)

- An interactive `*-define`/`*-validate` skill detects **collect mode** by the token `subagent-collect` in its `$ARGUMENTS`. In collect mode it must **not** call `AskUserQuestion`; instead it writes open decisions to a sibling **`decisions.md`** (`## Open questions`, `## Model-decided assumptions`, `## Proposed rules`) and returns that block in its report. Outside collect mode (user-invoked, main thread) it asks the user live as normal.
- When an orchestrator dispatches a sub-skill via the Agent tool, it **passes `subagent-collect`** in the dispatch prompt and, after the child returns, **aggregates** any `decisions.md` upward. The skill the **user invoked** runs without the flag and is the **surfacing point**: it presents aggregated open decisions via `AskUserQuestion`, then re-dispatches the relevant `*-define` in refinement mode with the answers (which clears `decisions.md` → `status: resolved`).
- Each surfaced question is presented with a **"You decide"** option (per §4) that accepts the decision's **recorded leaning** (from `decisions.md`). Picking it resolves only that question — the remaining surfaced questions are still asked.
- Net effect: surfacing always happens at the level the user typed, even through nested subagents (`roast-full → pre-design → twt-brand → brand-define`). No subagent silently commits a user-facing creative or constraint decision.

---

## Out of scope for this document

- Skill-specific instructions
- Markdown style nitpicks
- Tool-use preferences
- Anything that only one skill cares about
