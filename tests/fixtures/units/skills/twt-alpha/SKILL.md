---
name: twt-alpha
surface: command
category: alpha
family: alpha
role: orchestrator
unit: twt-alpha
description: fixture orchestrator
version: 1.0.0
accepts_arguments: false
inputs: []
dependencies:
  hard: []
  soft:
    - twt-alpha-define
reads: []
writes: []
---

# /twt-alpha

Runs `node "${CLAUDE_PLUGIN_ROOT}/tools/shared.mjs"`.
