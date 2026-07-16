---
name: twt-setup
category: meta
description: (v1.0.3) One-time setup — merge the curated runtime permission allowlist into this project's settings to cut prompts during pipeline runs
version: 1.0.3
accepts_arguments: false
inputs: []
dependencies:
  hard: []
  soft: []
reads: []
writes:
  - .claude/settings.json (merges permissions.allow; never removes existing entries)
---

# /twt-setup

## Intent

**Purpose:** Pipeline runs issue dozens of routine Bash, WebFetch, and Figma read calls. Without a permission allowlist the user is prompted for each one. This command merges a curated, additive allowlist into the current project's `.claude/settings.json` so those routine calls are auto-approved and prompts appear only for genuinely novel or risky operations. The scope-guard hook continues to gate any file operation that would escape the project directory.

**Non-goals:**
- Does not install or configure hooks (those are seeded by the marketplace installer)
- Does not modify global (`~/.claude`) settings — project-local only
- Does not remove any existing permission entries

**Success criteria:**
- `.claude/settings.json` in the current project contains all curated allowlist entries
- The seeder reports how many entries were added (or confirms they were already present)
- No existing settings entries are altered or removed

---

## Step 1 — Run the permission seeder

Run this Bash command from the project root. The seeder is idempotent and additive — it never removes or reorders existing entries:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"
```

The seeder will print a line such as:

```
  Seeded 18 permission entries into /path/to/.claude/settings.json
```

or

```
  Permissions already present in /path/to/.claude/settings.json
```

## Step 2 — Report to the user

Tell the user:
- How many entries were added (or that they were already present)
- That the allowlist covers routine Bash utilities, WebFetch, the Figma read MCP tools, the Playwright browser MCP tools (the navigate/screenshot/evaluate/inspect set — never `run_code_unsafe`, form-fill, or file-upload, which still prompt), and read/write access to the two locations outside the project the pipeline legitimately touches: the installed **plugin cache** (`~/.claude/plugins`, read-only — where the plugin's own bundled scripts live) and the session **scratchpad** (`<os-temp>/claude`, read+write — where transient files go so they never land in the project)
- That to undo this at any time, run the same command with `--remove` appended:
  `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude" --remove`
