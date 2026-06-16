<!-- Copy this file to skills/<category>/twt-<category>-<name>.md when creating a new skill. -->
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

## Step 1 — <name>

<instructions for Claude>

## Step 2 — <name>

<instructions for Claude>

## Step N — Report

Tell the user:
- Files written (with absolute or relative paths)
- Key decisions made
- What to do next
