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

<!-- Every user-facing command (everything in commands/ except twt-setup, twt-marketplace-docs,
     twt-status, twt-eval-smoke, and the dispatched sub-variants) carries the Bash-call-shape
     block below. It is what keeps this run's Bash calls matchable against the allowlist
     /twt-setup seeds, so it applies whether or not the command carries the setup gate.
     Body auto-synced from templates/blocks/bash-shape.md — keep the heading, don't hand-edit. -->

## Bash call shape — keep every call allowlist-matchable
<!-- body synced by /twt-marketplace-docs -->

<!-- The Step 0 setup gate belongs ONLY to the pipeline entry points — /twt-site, /twt-site-dev,
     /twt-pre-design, /twt-design, /twt-develop, /twt-qa (the $gateRequired list in
     tools/check-skill.ps1). Everything else is reached by dispatch from one of them, or relies
     on the user having run /twt-setup once for the project; a gate elsewhere is a CI failure.
     Delete this section unless you are adding a new entry point. Sub-skills in skills/ omit it. -->

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
<!-- body synced by /twt-marketplace-docs -->

## Step 1 — <name>

<instructions for Claude>

## Step 2 — <name>

<instructions for Claude>

## Step N — Report

Tell the user:
- Files written (with absolute or relative paths)
- Key decisions made
- What to do next
