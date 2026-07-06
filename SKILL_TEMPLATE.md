<!-- Copy this file to commands/twt-<name>.md (orchestrator / standalone tool) or
     skills/twt-<name>-<role>/SKILL.md (sub-skill) when creating a new skill. -->
<!-- Replace every <placeholder>, then delete this comment block. -->

---
name: twt-<category>-<name>
category: <category>
description: <one-line description, under ~100 chars>
version: 1.0.0
accepts_arguments: <true|false>
inputs:
  - <what the user provides; remove this entry if accepts_arguments is false and no input is needed>
dependencies:
  hard: []
  soft: []
reads:
  - <files or sources this skill consumes>
writes:
  - <paths this skill creates or modifies>
---

# /twt-<category>-<name>

## Intent

**Purpose:** <1-2 sentences: what this skill does and why it exists>

**Non-goals:**
- <explicit things this skill does NOT do>

**Success criteria:**
- <what a good run produces and how the user verifies>

---

<!-- Self-contained at runtime (CONVENTIONS §14): inline every artifact format you write —
     never reference a templates/… path. Read only inside the current project; never reach into
     sibling projects or the home directory for templates, conventions, or format examples. -->

<!-- User-facing commands (everything in commands/ except twt-setup, twt-marketplace-docs,
     twt-status, and dispatched sub-variants) must open with the Step 0 setup gate below.
     Its body is auto-synced from templates/blocks/setup-gate.md by /twt-marketplace-docs —
     keep the heading, don't hand-edit the body. Sub-skills in skills/ omit it. -->

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — <name>

<instructions for Claude>

## Step 2 — <name>

<instructions for Claude>

## Step N — Report

Tell the user:
- Files written (with absolute or relative paths)
- Key decisions made
- What to do next
