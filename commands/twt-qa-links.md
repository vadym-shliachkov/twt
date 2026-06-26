---
name: twt-qa-links
category: qa
description: (v1.1.1) Audit built or served pages for link integrity and declared responsive tiers
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional local path or http(s):// URL; else auto-detect site/ then Phase-2 mockups
dependencies:
  hard: []
  soft: []
reads:
  - site/
  - site/partials/
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/assets/manifest.md
writes:
  - .twt-artifacts/qa/links-report.md
---

# /twt-qa-links

## Intent

**Purpose:** Read-only audit of link integrity (internal links/anchors resolve, nav consistent) and — in local mode — declared responsive tiers (960/720/600/480) and fixed-width risks. Detects dead and placeholder links for the gaps punch-list.

**Non-goals:**
- Doesn't edit anything (read-only)
- Doesn't network-probe external links — lists them only
- Responsive-CSS checks are local-only (no source CSS to inspect live)

**Success criteria:**
- Writes `.twt-artifacts/qa/links-report.md` opening with a weighted **Scorecard → Health (0–100) / Band (Pass ≥80 / Revise 50–79 / Fail <50)**, followed by BLOCKER / WARNING / SUGGESTION findings, each as Where / Problem / Recommendation
- Flags every dead internal link and placeholder link (these feed the wrapper's `gaps.md`)

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Mode & subject
Parse `$ARGUMENTS`. URL → **live mode** (`WebFetch` the entry page + up to 25 deduped internal pages; build the page set first so internal targets can be checked). Else → **local mode** (`site/*.html` + `site/partials/`, else `mockup/pages/*.html`). If neither exists, abort: "No built HTML or URL to audit."

## Step 2 — Run checks

In **local mode, gather the deterministic counts first — don't trace links by hand.** Run the bundled scanner; it returns exact `dead_internal_links`, `dead_anchors`, `missing_assets`, and `empty_or_placeholder_hrefs` counts with `file:line` + the offending `href` per finding (it strips query strings and ignores external/`mailto:`/`tel:` links):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/qa-scan.mjs" links "$CLAUDE_PROJECT_DIR"
```

Use its `counts`/`findings[]` as the link-integrity evidence backbone. You still add what the script doesn't cover: cross-check assets against `.twt-artifacts/design/assets/manifest.md` (planned-but-unused entries), and the *(local-only)* responsive-tier/fixed-width checks below. In **live mode** there's no script — build the page set via `WebFetch` and check links against it as before. Then classify:

- **BLOCKER** — an internal `href`/anchor pointing to a page, section, or `id` that does not exist in the page set (scanner's `dead_internal_links` + `dead_anchors`); nav linking to a missing page; a referenced asset file that does not exist in the build's `assets/` (scanner's `missing_assets`, cross-checked against `.twt-artifacts/design/assets/manifest.md` — use the manifest's `filename` to confirm identity) — tag as **MISSING-ASSET**.
- **WARNING** — a **placeholder link** (`href="#"`, `href=""`, `javascript:void`, "TODO"); nav inconsistent across pages; *(local only)* a page/section with a needed breakpoint (960/720/600/480) not declared in CSS; *(local only)* a fixed `px` width that would overflow below a breakpoint; a manifest `filename` that no page references (planned-but-unused asset).
- **SUGGESTION** — an external link missing `rel`/`target` conventions.

Resolve every asset reference against the build's files AND `.twt-artifacts/design/assets/manifest.md`: a referenced asset file that does not exist is a **MISSING-ASSET** finding; a manifest `filename` that no page references is a planned-but-unused WARNING.

Tag each dead/placeholder/missing-asset finding with `gap-type: DEAD-LINK|PLACEHOLDER-LINK|MISSING-ASSET` + page + the `href`/filename so the wrapper can compile `gaps.md`.

## Step 3 — Write report
Score each criterion 0–5 with concrete evidence (e.g. "4 dead internal hrefs", "6 placeholder links found", "2 pages missing 720px breakpoint"). After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Internal link integrity (hrefs/anchors resolve)","weight":45,"score":<s1>},{"criterion":"Asset & href resolution (no missing targets)","weight":30,"score":<s2>},{"criterion":"Declared responsive-tier presence (local only)","weight":25,"score":<s3>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

Write `.twt-artifacts/qa/links-report.md`:
```
# Links & responsive — QA report
Generated: <YYYY-MM-DD>  ·  Mode: <local|live>  ·  Pages: <n>

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Internal link integrity (hrefs/anchors resolve) | 45 | <0-5> | <weighted> | <dead internal link count> |
| Asset & href resolution (no missing targets) | 30 | <0-5> | <weighted> | <placeholder / empty href count> |
| Declared responsive-tier presence (local only) | 25 | <0-5> | <weighted> | <pages/sections missing required breakpoints> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Summary
BLOCKER: <n> · WARNING: <n> · SUGGESTION: <n>

## Findings
### [BLOCKER] <title>
- Where: <page · href/selector>
- Problem: <what's wrong>
- Recommendation: <how to fix>

## Gaps (for gaps.md)
- DEAD-LINK · <page> · <href>
- PLACEHOLDER-LINK · <page> · <href>
```
Sort BLOCKER → WARNING → SUGGESTION. If clean, write "No findings — links pass" and an empty Gaps list. In live mode, note responsive-CSS checks were skipped (source-only).

## Step 4 — Report
State mode, pages, counts, and the report path. Modify no other file.
