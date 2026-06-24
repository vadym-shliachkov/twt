---
name: twt-qa-elementor
category: qa
description: (v1.1.1) Audit Elementor theme files for code hygiene (token-only CSS, widget registration, WPML, PHP lint)
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional theme path; else auto-detect wp-content/themes/hello-elementor-*
dependencies:
  hard: []
  soft: []
reads:
  - wp-content/themes/
  - .twt-artifacts/elementor-theme/conventions.md
  - .twt-artifacts/design/design-system/tokens.md
writes:
  - .twt-artifacts/qa/elementor-report.md
---

# /twt-qa-elementor

## Intent

**Purpose:** Read-only **code-hygiene** audit of the Elementor child theme — token-only CSS, every widget registered in `$map`, WPML coverage for translatable fields, PHP syntax, and CSS scoping. Does NOT audit content (Elementor content lives in the WordPress DB, not in files — use live `/twt-qa <url>` for that).

**Non-goals:**
- Doesn't edit anything (read-only)
- Doesn't audit content, accessibility, or rendered output (not in files)
- Doesn't require a running WordPress

**Success criteria:**
- Writes `.twt-artifacts/qa/elementor-report.md` opening with a weighted **Scorecard → Health (0–100) / Band (Pass ≥80 / Revise 50–79 / Fail <50)**, followed by BLOCKER / WARNING / SUGGESTION findings, each as Where / Problem / Recommendation
- States explicitly that content is not statically checkable for Elementor

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Locate theme
Find the theme at the path in `$ARGUMENTS`, else auto-detect `wp-content/themes/hello-elementor-*`. If none exists, abort: "No Elementor theme found — build it (Phase 3) or audit a static site instead." Read `.twt-artifacts/elementor-theme/conventions.md` (for slug + rules) and `tokens.md` (for the mirror check).

## Step 2 — Run checks

For the **token-only CSS** check, gather the literal counts deterministically — don't hand-scan `widgets.css`/`design-system.css`. Run the bundled scanner in elementor mode; it returns exact `hex_literals`, `length_literals`, `font_literals`, and `undefined_var_refs` with `file:line` locations, already ignoring literals that are token *definitions* (values inside `--x:` / `:root{}`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/qa-scan.mjs" tokens "$CLAUDE_PROJECT_DIR" elementor
```

Use its `counts`/`findings[]` for the Token-only CSS criterion. The **other checks are not scriptable** and stay yours: widget-`$map` registration, `php -l`, WPML coverage, and CSS scoping all require reading the PHP/XML structure. Then classify:

- **BLOCKER** — a widget PHP file in `inc/elementor/widgets/` whose class is not registered in the `$map` of `class-<slug>-elementor.php`; a hex/px/font **literal** in `widgets.css` or `design-system.css` (scanner's counts — token-only violation, definitions already excluded); a PHP syntax error (run `php -l` per file if `php` is available; otherwise flag as "lint not run — php unavailable"); an unscoped CSS selector (not wrapped in the `:where(.<slug>-chrome, .<slug>-homepage)` scope) that would leak globally.
- **WARNING** — a translatable text control with no entry in `wpml-config.xml`; a widget shipping `'default' =>` demo content on TEXT/TEXTAREA/MEDIA/REPEATER (violates the no-demo-content rule); a widget missing `register_section_spacing()`.
- **SUGGESTION** — a token in `tokens.md` not mirrored into `design-system.css`.

## Step 3 — Write report
Score each criterion 0–5 with concrete evidence (e.g. "5 hex literals in widgets.css", "2 widget classes missing from $map", "4 translatable fields absent from wpml-config.xml", "php -l errors in 1 file"). Use the formulas: `Weighted = Weight × Score / 5`, `Health = Σ Weighted`, `Band = Pass ≥80 / Revise 50–79 / Fail <50`.

Write `.twt-artifacts/qa/elementor-report.md`:
```
# Elementor code hygiene — QA report
Generated: <YYYY-MM-DD>  ·  Mode: local (theme files)

> Content is not statically checkable for Elementor (it lives in the WordPress DB).
> To audit Elementor content, run: /twt-qa https://<live-site>

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Token-only CSS (no literals outside :root definitions) | 30 | <0-5> | <weighted> | <literal count in widgets.css / design-system.css> |
| Widget registration correctness (all classes in $map) | 25 | <0-5> | <weighted> | <widgets missing from $map / total widgets> |
| WPML completeness (translatable fields declared) | 20 | <0-5> | <weighted> | <fields missing from wpml-config.xml> |
| PHP lint cleanliness (no syntax errors) | 25 | <0-5> | <weighted> | <files with php -l errors, or "lint not run"> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Summary
BLOCKER: <n> · WARNING: <n> · SUGGESTION: <n>

## Findings
### [BLOCKER] <title>
- Where: <file · line/selector>
- Problem: <what's wrong>
- Recommendation: <how to fix>
```
Sort BLOCKER → WARNING → SUGGESTION. If clean, write "No findings — Elementor hygiene passes."

## Step 4 — Report
State counts, whether `php -l` ran, and the report path. Modify no other file.
