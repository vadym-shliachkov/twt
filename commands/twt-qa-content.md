---
name: twt-qa-content
category: qa
description: (v1.2.1) Audit built or served pages for content & IA fidelity (sitemap coverage, real content, lorem)
version: 1.2.1
accepts_arguments: true
inputs:
  - Optional local path or http(s):// URL; else auto-detect site/ then Phase-2 mockups
dependencies:
  hard: []
  soft:
    - twt-content-validate
reads:
  - site/
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/design/assets/manifest.md
writes:
  - .twt-artifacts/qa/content-report.md
---

# /twt-qa-content

## Intent

**Purpose:** Read-only audit of content & information-architecture fidelity — every sitemap page exists, each page's sections match the Phase-1 outlines, and the content is real (no lorem/placeholder, no empty slots). Works on local HTML files or, given a URL, on the rendered site (the only way to see Elementor content).

**Non-goals:**
- Doesn't edit the site or any upstream artifact (read-only; writes only its own report)
- Doesn't judge visual design or tokens (that's `/twt-qa-design`)
- Doesn't network-probe external links

**Success criteria:**
- Writes `.twt-artifacts/qa/content-report.md` opening with a weighted **Scorecard → Health (0–100) / Band (Pass ≥80 / Revise 50–79 / Fail <50)**, followed by BLOCKER / WARNING / SUGGESTION findings, each as Where / Problem / Recommendation
- Flags every lorem/placeholder block, empty content slot, and missing-asset (these feed the wrapper's `gaps.md`)
- Flags any `sitemap.md` page with no built/served page

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Mode & subject
Parse `$ARGUMENTS`. If it contains an `http(s)://` URL → **live mode**: treat the URL as the entry page and fetch pages with `WebFetch`. Else → **local mode**: audit `site/*.html` if `site/` exists, otherwise `.twt-artifacts/design/mockup/pages/*.html`. If neither a URL nor any local HTML is found, abort: "No built HTML or URL to audit — build the site (Phase 3) or pass a URL."

## Step 2 — Load baselines
Read `sitemap.md`, `outlines/`, and `inventory.md` (skip any that are absent, noting reduced coverage). These are the sources of truth for which pages and sections should exist and what real content they carry.

## Step 3 — Gather pages
- **Local:** list the HTML files in scope.
- **Live:** `WebFetch` the entry URL, extract internal links (nav + in-page), and crawl **internal** pages only, deduped, **capped at 25**. Record the page set.

## Step 4 — Run checks

In **local mode, gather the deterministic counts first — don't scan for filler by hand.** Run the bundled scanner; it returns exact `lorem_blocks`, `placeholder_markers`, `empty_headings`, plus `missing_pages`/`extra_pages` (sitemap coverage, when `sitemap.md` is present), each with `file:line` locations:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/qa-scan.mjs" content "$CLAUDE_PROJECT_DIR"
```

Use its `counts`/`findings[]` for the lorem/placeholder/empty and sitemap-coverage evidence. You still own the judgment the script can't do: **outline fidelity** (do the sections match `outlines/`?), **copy quality** (Step 5), and the **manifest** cross-check. In **live mode** there's no script — crawl with `WebFetch` (Step 3) and judge content from the rendered text. Then, for each page:

- **BLOCKER** — a `sitemap.md` page has no corresponding built/served page (scanner's `missing_pages`); an outline section is missing from its page; **lorem/placeholder** text present (scanner's `lorem_blocks` + `placeholder_markers`); a content slot the outline specifies is empty (scanner's `empty_headings` + your outline read).
- **WARNING** — content present but not traceable to any outline; a heading/copy block materially diverges from the outline; a manifest entry that no page references (planned-but-unused asset).
- **SUGGESTION** — minor copy deviation; an image/asset referenced but missing (also recorded as a gap).

When scoring **Heading & copy quality** (Step 5), judge copy with the `/twt-content-validate` anchors in miniature — clarity, conciseness, active voice, user value — citing verbatim quotes as evidence; for a deep per-criterion evaluation of any one page's text, recommend running `/twt-content-validate` on it (soft dependency).

Cross-check every referenced image/video against `.twt-artifacts/design/assets/manifest.md`: any `<img>`/`<video>`/background asset whose file is absent from the build's `assets/` is a **MISSING-ASSET** gap (use the manifest's `filename`/`alt` to identify it); any manifest entry never referenced by a page is a WARNING (planned-but-unused).

Tag each lorem/empty/missing-asset finding with `gap-type: LOREM|EMPTY|MISSING-ASSET` and the page + location so the wrapper can compile `gaps.md`.

## Step 5 — Write report
Score each criterion 0–5 with concrete evidence (e.g. "3 of 8 sitemap pages missing", "12 lorem blocks found", "4 sections deviate from outline"). After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Sitemap / page coverage","weight":30,"score":<s1>},{"criterion":"Real content vs lorem/placeholder","weight":35,"score":<s2>},{"criterion":"Content-IA fidelity (sections match outlines)","weight":20,"score":<s3>},{"criterion":"Heading & copy quality","weight":15,"score":<s4>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

Write `.twt-artifacts/qa/content-report.md`:
```
# Content & IA — QA report
Generated: <YYYY-MM-DD>  ·  Mode: <local|live>  ·  Pages: <n>

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Sitemap / page coverage | 30 | <0-5> | <weighted> | <pages present vs sitemap entries> |
| Real content vs lorem/placeholder | 35 | <0-5> | <weighted> | <lorem/empty/filler block count> |
| Content-IA fidelity (sections match outlines) | 20 | <0-5> | <weighted> | <sections missing or divergent vs outlines> |
| Heading & copy quality | 15 | <0-5> | <weighted> | <skipped/missing headings, stray filler copy> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Summary
BLOCKER: <n> · WARNING: <n> · SUGGESTION: <n>

## Findings
### [BLOCKER] <title>
- Where: <page · section/selector>
- Problem: <what's wrong>
- Recommendation: <how to fix>

## Gaps (for gaps.md)
- LOREM · <page> · <selector> · expected: <outline ref>
- EMPTY · <page> · <selector> · expected: <outline ref>
- MISSING-ASSET · <page> · <img src>
```
Sort BLOCKER → WARNING → SUGGESTION. If clean, write "No findings — content passes" and an empty Gaps list.

## Step 6 — Report
State mode, pages audited, the counts, and the report path. Modify no other file.
