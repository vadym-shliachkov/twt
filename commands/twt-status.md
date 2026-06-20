---
name: twt-status
category: status
description: (v1.1.0) Detect stale pipeline artifacts — flag any output older than the inputs it was derived from
version: 1.1.0
accepts_arguments: true
inputs:
  - Optional: a phase (pre-design|design|develop|qa) or artifact path to scope the check; else the whole pipeline
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/
  - site/
  - wp-content/themes/hello-elementor-*/
writes: []
---

# /twt-status

## Intent

**Purpose:** In the iterative design loop, editing an upstream artifact silently invalidates everything derived from it — `brand-brief.md` changes and `positioning.md` is now stale, but nothing says so. This skill compares each artifact's modification time against the inputs it was derived from, flags the stale ones, and reports the minimal upstream-first set of skills to re-run. Read-only: it never re-runs or edits anything.

**Non-goals:**
- Doesn't re-run any skill or fix anything — it reports; the human decides
- Doesn't judge content quality (that's the `*-validate` skills) — only freshness
- Doesn't fetch, build, or write any artifact

**Success criteria:**
- Every existing pipeline artifact is reported as FRESH / STALE / NO-INPUTS-PRESENT, with the newer input named for each STALE one
- A re-run plan ordered upstream→downstream (so re-running a parent doesn't leave the user chasing freshly-staled children)
- Honest about what it can't see (e.g. external Figma sources have no local mtime)

---

## Step 1 — Run the freshness scan

The whole freshness computation (the fixed pipeline DAG, mtime snapshotting, and stale/fresh comparison) is deterministic, so it lives in a bundled script — don't recompute it by hand. Run it against the current project, passing `$ARGUMENTS` as the optional scope (a phase like `pre-design`/`design`/`develop`/`qa`, or an artifact-path substring):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/status-scan.mjs" "$CLAUDE_PROJECT_DIR" $ARGUMENTS
```

The script:
- knows the canonical DAG (each artifact ← the inputs it derives from · the skill that rebuilds it);
- uses the **oldest** contained file's mtime for a directory artifact (so a partially-regenerated dir still trips) and the **newest** contained file for a directory input (so any edit counts);
- marks each present artifact **FRESH** / **STALE** (naming the newer input + age) / **NO-INPUTS-PRESENT**, skips artifacts not yet on disk, and reports an externally-sourced design system as `FRESH (external — can't verify)` rather than guessing;
- prints a ready-to-relay table, a de-duplicated upstream→downstream re-run plan, and a fenced ```json block for reference.

## Step 2 — Relay and advise

Present the script's table and re-run plan to the user (the table is already in pipeline order — relay it as-is; you may drop the trailing ```json block). Then add only what judgment the script can't:
- if the user scoped to a phase/artifact, note that the check was limited to it;
- restate the caution that re-running an upstream artifact re-stales its descendants, so work top-down;
- if nothing is stale, confirm "All artifacts are fresh relative to their inputs."

Write no files. Modify nothing — this skill only reports.
