---
name: twt-beta
surface: command
category: beta
family: beta
role: tool
unit: twt-beta
description: fixture tool
version: 1.0.0
accepts_arguments: false
inputs: []
dependencies:
  hard: []
  soft: []
reads: []
writes: []
---

# /twt-beta

Runs `node "${CLAUDE_PLUGIN_ROOT}/tools/shared.mjs"`.
Then `node "${CLAUDE_PLUGIN_ROOT}/skills/twt-beta/tools/local.mjs"`.
