---
name: twt-qa-design
category: qa
description: (v1.1.1) Audit built HTML/CSS source for design & token fidelity (token-only, structure vs design system)
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional local path; a URL is rejected (source-only audit)
dependencies:
  hard: []
  soft: []
reads:
  - site/assets/css/
  - site/
  - .twt-artifacts/design/mockup/styles.css
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/component/components.md
  - .twt-artifacts/design/layout/layouts/
writes:
  - .twt-artifacts/qa/design-report.md
---

# /twt-qa-design

## Intent

**Purpose:** Read-only audit of design & token fidelity on the **source** files — CSS is token-only (no hex/px/font literals), every custom property used is defined in `tokens.css`, and each page's section structure includes the components its layout requires.

**Non-goals:**
- **Local source only.** A served URL can't reveal token-only authoring; if given a URL, write a one-line note and exit
- Doesn't edit anything (read-only)
- Doesn't audit content or accessibility (other skills)

**Success criteria:**
- Writes `.twt-artifacts/qa/design-report.md` opening with a weighted **Scorecard → Health (0–100) / Band (Pass ≥80 / Revise 50–79 / Fail <50)**, followed by BLOCKER / WARNING / SUGGESTION findings, each as Where / Problem / Recommendation
- Flags every raw literal in token-only CSS and every undefined custom property reference

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Mode guard
If `$ARGUMENTS` contains an `http(s)://` URL, write `.twt-artifacts/qa/design-report.md` containing only: "Design/token fidelity is a source-only audit — run `/twt-qa` locally (no URL) to check token compliance." Then stop.

## Step 2 — Locate source
Audit `site/assets/css/*.css` + `site/*.html` if `site/` exists; otherwise `.twt-artifacts/design/mockup/styles.css` + `mockup/pages/*.html`. If neither exists, abort: "No built source to audit — build the site (Phase 3) first." Read `tokens.css`, `components.md`, and `layouts/` as baselines.

## Step 3 — Run checks

**First, gather the deterministic counts — don't eyeball the CSS.** Run the bundled scanner; it returns exact `hex_literals`, `length_literals`, `font_literals`, and `undefined_var_refs` counts with `file:line` locations, and it already ignores literals that are token *definitions* (e.g. `--color-error: #B23A48` even in a non-tokens file) and literals inside `tokens.css`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/qa-scan.mjs" tokens "$CLAUDE_PROJECT_DIR"
```

Use its `counts` as the evidence backbone and its `findings[]` locations in your report. The output also includes `evidence_hints` (token_only_styling, defined_vars) — use these pre-formatted strings in the scorecard Evidence column. You still apply judgment the script can't: decide which `length_literals` are **sanctioned** (44px touch targets, SVG geometry, the comment-flagged exceptions) vs. real BLOCKERs, and run the **structure-vs-design-system** check yourself by reading `layouts/<page>.md` against each page. Then classify:

- **BLOCKER** — a hex (`#abc`/`#aabbcc`), raw `px`/`rem` length, or raw font-family **literal** in token-only CSS where a token exists (from the scanner, minus sanctioned exceptions); a `var(--x)` referencing a custom property absent from `tokens.css` (scanner's `undefined_var_refs`); a page's section omits a component its `layouts/<page>.md` requires.
- **WARNING** — a literal that approximates an existing token (should reference it); a component/variant in the build not documented in `components.md`.
- **SUGGESTION** — a token defined in `tokens.css` but never used; minor spacing-scale drift.
(Ignore literals inside `tokens.css` itself — that file *defines* the values.)

## Step 4 — Write report
Score each criterion 0–5 with concrete evidence (e.g. "7 hex literals found across 3 files", "2 undefined var(--x) references", "3 pages missing required layout components"). After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Token-only styling (no hex/px/font literals)","weight":40,"score":<s1>},{"criterion":"Defined custom properties (no undefined var() refs)","weight":20,"score":<s2>},{"criterion":"Structure vs design system (layout components present)","weight":25,"score":<s3>},{"criterion":"Consistency across pages (token + component reuse)","weight":15,"score":<s4>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

Write `.twt-artifacts/qa/design-report.md`:
```
# Design & token fidelity — QA report
Generated: <YYYY-MM-DD>  ·  Mode: local

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Token-only styling (no hex/px/font literals) | 40 | <0-5> | <weighted> | <literal count across CSS files> |
| Defined custom properties (no undefined var() refs) | 20 | <0-5> | <weighted> | <undefined var() reference count> |
| Structure vs design system (layout components present) | 25 | <0-5> | <weighted> | <sections missing required components vs layouts> |
| Consistency across pages (token + component reuse) | 15 | <0-5> | <weighted> | <pages with unique undocumented patterns> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Summary
BLOCKER: <n> · WARNING: <n> · SUGGESTION: <n>

## Findings
### [BLOCKER] <title>
- Where: <file · selector/line>
- Problem: <what's wrong>
- Recommendation: <how to fix>
```
Sort BLOCKER → WARNING → SUGGESTION. If clean, write "No findings — design fidelity passes."

## Step 5 — Report
State counts and the report path. Modify no other file.
