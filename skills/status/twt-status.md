---
name: twt-status
category: status
description: Detect stale pipeline artifacts — flag any output older than the inputs it was derived from
version: 1.0.0
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

## Step 1 — Load the artifact dependency map

The twt pipeline is a fixed DAG; an output is **stale** when any input it derives from has a later mtime. Use this canonical map (downstream artifact ← inputs it derives from · re-run skill):

| Artifact | Derived from (inputs) | Re-run |
|----------|-----------------------|--------|
| `pre-design/positioning/positioning.md` | `pre-design/brand/brand-brief.md`, `pre-design/content-fetch/` | `/twt-positioning` |
| `pre-design/ia/sitemap.md`, `…/functional-scope.md` | `pre-design/positioning/positioning.md`, `pre-design/content-fetch/` | `/twt-ia` |
| `pre-design/curation/inventory.md`, `…/outlines/` | `pre-design/content-fetch/`, `pre-design/brand/brand-brief.md`, `pre-design/ia/sitemap.md` | `/twt-curation` |
| `pre-design/pre-design-brief.md` | `brand/brand-brief.md`, `positioning/positioning.md`, `ia/sitemap.md`, `ia/functional-scope.md`, `curation/inventory.md`, `curation/outlines/` | `/twt-pre-design` (synthesis) |
| `design/design-system/tokens.md`, `tokens.css` | `pre-design/brand/brand-brief.md` (greenfield) — or an external design source (no local mtime) | `/twt-design-system` |
| `design/component/components.md` | `design/design-system/tokens.md`, `pre-design/ia/sitemap.md`, `pre-design/curation/outlines/` | `/twt-component` |
| `design/layout/layouts/` | `pre-design/ia/sitemap.md`, `pre-design/curation/outlines/`, `design/component/components.md` | `/twt-layout` |
| `design/mockup/pages/`, `…/styles.css` | `design/layout/layouts/`, `design/component/components.md`, `design/design-system/tokens.css`, `pre-design/curation/inventory.md`, `pre-design/curation/outlines/` | `/twt-mockup` |
| `design/design-brief.md` | `design/design-system/tokens.md`, `design/component/components.md`, `design/layout/layouts/`, `design/mockup/index.html` | `/twt-design` (synthesis) |
| `site/` (built static site) | `design/design-brief.md`, `design/mockup/pages/`, `design/layout/layouts/`, `design/component/components.md`, `design/design-system/tokens.css` | `/twt-develop` (or `/twt-site-dev`) |
| `wp-content/themes/hello-elementor-*/` | same design inputs as `site/` | `/twt-develop` (or `/twt-site-dev`) |
| `qa/qa-report.md`, `qa/gaps.md` | the built `site/` or theme | `/twt-qa` |

If `$ARGUMENTS` names a phase or artifact, scope the check to that artifact and everything downstream of it; otherwise check the whole map.

## Step 2 — Snapshot modification times

List the mtime of every artifact present under `.twt-artifacts/` (and `site/` / a `hello-elementor-*` theme if built). Use one pass, e.g.:

```powershell
Get-ChildItem -Recurse -File .twt-artifacts, site, wp-content\themes\hello-elementor-* -ErrorAction SilentlyContinue |
  Select-Object FullName, LastWriteTime | Sort-Object FullName
```

For a **directory artifact** (`outlines/`, `layouts/`, `mockup/pages/`, `site/`, the theme), use the **oldest** contained file's mtime as the artifact's effective time, so a partially-regenerated directory is still flagged as potentially stale.

## Step 3 — Compute staleness

For each artifact in scope that exists on disk:
- Gather its inputs from the map that also exist on disk. (Inputs that don't exist → note `NO-INPUTS-PRESENT`; don't infer staleness from a missing input.)
- The artifact is **STALE** if any present input's mtime is later than the artifact's (effective) mtime. Record which input(s) are newer and by how much.
- Otherwise **FRESH**.
- Note external sources explicitly: a design system built from Figma has no local input mtime, so report it as `FRESH (external source — can't verify)` rather than guessing.

## Step 4 — Report

Print a table in pipeline order:

```
Artifact                              Status   Stale because
pre-design/positioning/positioning.md FRESH    —
pre-design/ia/sitemap.md              STALE    positioning.md is 2h newer
design/component/components.md        STALE    tokens.md is 1d newer
```

Then a **re-run plan**, ordered upstream→downstream, listing only the distinct skills needed and a one-line caution that re-running an upstream artifact will re-stale its descendants (so work top-down). If nothing is stale: "All artifacts are fresh relative to their inputs." Write no files.
