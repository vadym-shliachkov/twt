---
name: twt-design-system-audit
category: design-system
description: (v1.4.10) Audit a real design's system quality + cross-page block consistency from a Figma file and/or site URL — synthesizes (and cleans) the canonical system when none is given and produces a multi-page HTML report (homepage + per-page files) with per-block before/after visuals naming the exact page+block that drifts
version: 1.4.10
accepts_arguments: true
inputs:
  - A Figma URL and/or a site URL (the design to audit); optional brand source or brand-brief.md; optional design system (tokens.md/tokens.css path)
dependencies:
  hard: []
  soft:
    - twt-brand
    - twt-design-system-define
    - twt-design-system-validate
    - twt-content-fetch-figma
    - twt-block-preview
reads:
  - $ARGUMENTS (figma URL, site URL, tokens path, --brand)
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/tokens.css
writes:
  - .twt-artifacts/design/design-system-audit/audit-report.html      # homepage — page list + per-page issue counts
  - .twt-artifacts/design/design-system-audit/audit-<page-slug>.html  # one per page — only that page's block cards
  - .twt-artifacts/design/design-system-audit/audit-report.md
  - .twt-artifacts/design/design-system-audit/canonical-blocks.md
  - .twt-artifacts/design/design-system-audit/quality-report.md
  - .twt-artifacts/design/design-system-audit/quality.json
  - .twt-artifacts/design/design-system-audit/audit.json
  - .twt-artifacts/design/design-system-audit/blocks.json
  - .twt-artifacts/design/design-system-audit/visuals.json
  - .twt-artifacts/design/design-system-audit/pages/
  - .twt-artifacts/design/design-system-audit/shots/
  - .twt-artifacts/design/design-system-audit/previews/
  - .twt-artifacts/design/design-system/  # conditional — synthesized canonical DS when none exists
---

# /twt-design-system-audit

## Intent

**Purpose:** Audit how good a design system is **and** how consistently a real design follows it. Given a Figma file and/or a live site, score the design system on **10 weighted quality metrics** (when one is provided or synthesized) and extract **every block on every page**, cluster near-duplicates, and report each block that drifts — naming the **exact page + exact block + what differs + why + the fix**. When no design system is provided, **synthesize a canonical one** from the real structure first, then measure every block against it — so a weak, inconsistent design is judged against the consistent system it should have had.

**Non-goals:**
- Read-only on the source — never edits the audited site or Figma file.
- Doesn't build or fix the design system (that's `/twt-design-system-define`); it reports. **Exception:** when **no** design system exists, this audit *creates* the canonical `.twt-artifacts/design/design-system/` (via `/twt-design-system-define` in analyse-existing mode) so the design has a system to be measured against — it no longer keeps a separate `synthesized-design-system/` copy. An **existing** DS is audited against, never overwritten.
- Not a content or full-a11y audit (those are the `/twt-qa-*` skills); contrast is reused only as one metric.
- The deterministic extraction/clustering/scoring/visuals/HTML report are done by the bundled scripts — this skill adds judgment (the *why*, recommendations, the design-taste metrics), it does not re-implement parsing, screenshotting, or report HTML in the model.

**Success criteria:**
- The **headline deliverable** is a multi-page HTML report. `audit-report.html` is the **homepage**: a scorecard (DS quality /100 when scored, consistency %, drifting-block count), a **design-system review** (token/color/type/space/radius/component stats + the 10-metric scorecard + a swatch row) that reads as part of the audit, and a **list of every page** with its per-page BLOCKER/WARNING/SUGGESTION/OK counts, ordered worst-first and linked. Each page link opens `audit-<page-slug>.html`, which contains **only that page's blocks** — each as a single **fused card** combining status + reason chips + slimmed deltas (with the nearest token named) + the block **as it looks now next to how it should look** (canonical), both full-width. There is **no separate canonical-component gallery and no separate matrix/findings split** — everything about a block lives in one card. The `.md` reports remain as machine/diff-friendly companions.
- Block names match the design system: every block carries a **literal name** (e.g. "Hero", "Diagnostic section", "Site header") plus its selector, so the audit and the design system speak the same language.
- Drift is measured against the **design system's token values** (not a per-cluster union); a value that is a token is OK, a raw/off-scale value drifts. Severity is calibrated (raw opaque color = BLOCKER; translucent tint / off-scale spacing-type-radius = WARNING) so the report isn't a wall of BLOCKERs.
- Near-duplicate blocks are collapsed into one canonical block; the divergent instances are flagged, not treated as separate components.
- When no DS is provided, the canonical system is synthesized **into** `.twt-artifacts/design/design-system/` **and cleaned** (preview/contrast issues fixed) before the audit runs against it; an existing **provided** DS is never clobbered — its issues are reported, not fixed.

---

Arguments passed to this command: $ARGUMENTS

> **Trace self-logging (when dispatched).** If running in collect mode (`subagent-collect` in `$ARGUMENTS`), run this one Bash line immediately before every Agent/Skill dispatch so the call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> Silent no-op when no trace is armed. Keep `<one-line why>` plain text.

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Before any project work, make sure this project is set up so the run isn't interrupted by per-call permission prompts. **Use Glob/Read — never a shell command** — to check whether `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing + running interactively in the main thread:** ask via the **AskUserQuestion** tool (single-select, header "Setup") — **Run /twt-setup now** (recommended — merges the curated allowlist so routine Bash/WebFetch/Figma-read calls stop prompting) · **Skip** (continue; expect per-call prompts) · **You decide**. On **Run /twt-setup now**, dispatch `/twt-setup` (Agent tool), wait for it to finish, then continue.
- **Missing + running unattended** (auto mode, or dispatched as a subagent that must not prompt): seed silently instead of asking — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, and continue.
- **Already present:** continue without asking (the seeder is idempotent; re-running `/twt-setup` stays safe if prompts persist).
- If the plugin root or seeder isn't available (global install without bundled tools), warn once and continue — **never block the run**.

## Step 1 — Detect sources

Parse `$ARGUMENTS` (strip and remember a `subagent-collect` token first):
- a `figma.com` URL → **Figma source**.
- an `http(s)://` URL (not figma.com) → **site source**.
- a path ending `tokens.css` / `tokens.md` → **provided design system**.
- `--brand <src>` (a path/URL) → brand source.
- `--max <n>` → site crawl page cap (default 20).

If **no** design source (neither Figma nor site) is present, ask (plain text, free-form): "Give me the design to audit — a Figma file URL and/or a site URL." Wait. Also detect existing artifacts: `.twt-artifacts/design/design-system/tokens.css` (existing DS) and `.twt-artifacts/pre-design/brand/brand-brief.md` (existing brand). State back what you detected (sources, whether a DS and brand exist). Create `.twt-artifacts/design/design-system-audit/` as the output dir (`<OUT>` below).

## Step 2 — Brand (optional)

If a brand source was given **or** `brand-brief.md` already exists: dispatch `/twt-brand` via the Agent tool (with `subagent-collect`) to produce/refresh `.twt-artifacts/pre-design/brand/brand-brief.md`, then read it — brand palette/type/voice is **context** for the DS-quality judgment (Step 6), not a hard input. If no brand is available, skip and note "no brand baseline — quality judged on internal coherence only" in the report. Never invent a brand.

## Step 3 — Decide DS mode

The audit's posture toward the design system depends on **who owns it**:

- **DS provided or `.twt-artifacts/design/design-system/tokens.css` exists** → set `<tokens>` to that `tokens.css` and `<ds-source>` = `provided`. Run the **Quality pass** (Step 6) and the **Consistency pass** (Steps 4–5, 7) against it. **Report-only — never modify it.** If the provided DS has problems (preview/contrast/coverage), record them in the quality report and findings as issues to fix separately; do **not** edit the user's tokens. This is the user's artifact; the audit critiques, it doesn't rewrite.
- **No DS** → **synthesize and clean** the canonical one (Step 4c) into `.twt-artifacts/design/design-system/` before the consistency pass, then set `<tokens>` to that `tokens.css` and `<ds-source>` = `synthesized`. Because the audit *owns* a synthesized baseline, it must be in good shape before it's used as the yardstick — Step 4c addresses its issues (re-runs the preview, clears contrast BLOCKERs) rather than measuring every block against a flawed baseline.

## Step 4 — Capture the blocks

### Step 4a — Figma source
Use the **Figma MCP read tools** (no `figma-use` needed — read-only): `get_metadata` on the file URL to enumerate top-level frames/screens; `get_design_context` per frame to pull its block structure and styles. From that, **write a normalized inventory** to `<OUT>/blocks.json`:
```json
{ "blocks": [ { "page": "<frame name>", "role": "<hero|nav|cards|cta|footer|section|…>",
  "tag": "section", "classes": ["<component/instance name>"],
  "structure": { "headings": <n>, "buttons": <n>, "images": <n>, "lists": <n>, "inputs": <n>, "links": <n> },
  "styles": { "colors": ["#…"], "spacing": ["16px"], "fontSizes": ["18px"], "radius": ["8px"], "shadow": true } } ] }
```
Use the frame name as `page`, the Figma component/instance name as the `classes` signature (so repeated component instances cluster), and the frame's actual fill/spacing/type/radius values as `styles`. (Optionally also dispatch `/twt-content-fetch-figma` to capture the visible copy for reference — not required for the structural audit.)

### Step 4b — Site source

**Step 4b-i — Page-count discovery (interactive mode only)**
Skip this sub-step if: `--max` was explicitly passed in `$ARGUMENTS` (user already chose scope), **or** running as a dispatched subagent (unattended). Otherwise:

Run the fast link-discovery pass — no block/CSS extraction, just follows links to count pages:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit.mjs" site "<site-url>" --out "<OUT>" --max 500 --count-only
```
Read `discovered_total` from the JSON output. Then ask via the **AskUserQuestion** tool (single-select, header "Crawl scope") — construct the first option's label to include the actual page count (e.g. "Fetch all (47 pages)"):

| Option | Label | What it means |
|--------|-------|---------------|
| 1 | Fetch all (N pages) | Audit every discovered page |
| 2 | 10 pages | Quick sample |
| 3 | Homepage only | Single-page audit (fastest) |
| 4 | Stop | Abort the audit |

Set `<max>` from the answer: "Fetch all" → `discovered_total` (or 1000 if the discovery hit its cap); "10 pages" → 10; "Homepage only" → 1; "Stop" → exit.

**Step 4b-ii — Full crawl**
Run the bundled crawler — it fetches static HTML + linked CSS, extracts the per-page block inventory, and (in Step 5) clusters and scores it. **Run it directly; do not hunt for the tool.**
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit.mjs" site "<site-url>" --out "<OUT>" --max <max> [--tokens "<tokens>"] [--ds-source <provided|synthesized>]
```
It writes `<OUT>/pages/` (raw pages), `<OUT>/blocks.json`, and `<OUT>/audit.json`, and prints a ` ```json ` summary. The `audit.json` carries `summary`, `ds_stats` (token/color/type/space/radius/component counts + `source`), `canonical_blocks[]` (each with an `example` instance), `deviations[]` (typed deltas + `tier` + `reason_types`), `block_status[]` (every instance — drifting **and** OK — for the full matrix), `page_stylesheets`, and `quality_signals`. If `summary.js_rendered_pages` is non-empty, note in the report that those pages are **low-confidence** under static analysis (JS-rendered) and recommend a Playwright re-run when available.

### Step 4c — Synthesize **and clean** the canonical DS (only when no DS exists)
Dispatch `/twt-design-system-define` via the Agent tool (with `subagent-collect`) in **analyse-existing** mode, pointing it at the Figma URL or the captured `<OUT>/pages/`, and let it write the **canonical** `.twt-artifacts/design/design-system/` (tokens.md, tokens.css, tokens-only preview.html). It is refinement-aware: it only runs here because no DS existed, so it creates rather than clobbers. This generalizes the real design into the consistent token + component layer it implies.

**Then clean it before using it as the yardstick — silently, with no user-visible reports.** The audit owns the synthesized baseline, so fixing its quality is the audit's own job, not a separate deliverable:
- Read the define run's returned JSON / `decisions.md`. If `contrast_failures[]` is non-empty (intended text/surface pairs below AA) or the run reports other BLOCKER-level DS issues, **re-dispatch `/twt-design-system-define` once** in refinement mode to resolve them (darken text tokens to clear AA, fix duplicate/undefined token defs). Do this silently — no intermediate report, no user prompt, no status message about the fix. This is normal baseline hygiene, not an event worth surfacing.
- The preview is regenerated by `gen-preview.mjs` as part of define (tokens-only, with correct spacing bars + the component-gallery link). You do not hand-edit it.
- Dispatch `/twt-component-define` (Agent tool, `subagent-collect`) to build the component catalog (`.twt-artifacts/design/design-system/component/components.md` + `gallery.html`) from the synthesized tokens — a complete design system requires all primitives, components, and modules, not just tokens. Best-effort: if it cannot run, note it and continue; never block the audit on it.
- **Only block and report to the user if there are MAJOR issues** — e.g. `gen-preview --check` still returns contrast failures after the clean-up re-run, or the DS has fewer than 5 tokens total (synthesized an empty system). Minor issues (a few duplicate defs, one off-scale spacing step) are fixed silently.

Set `<tokens>` to `.twt-artifacts/design/design-system/tokens.css` and `<ds-source>` = `synthesized`. State clearly in the report that the baseline is **synthesized from the audited design (and cleaned)**, so every deviation is "drift from the design's own dominant pattern," which is exactly the point when the design is inconsistent.

## Step 5 — Score consistency (deterministic)

Run the analyzer over the captured inventory with the resolved tokens:
- **Site source:** the Step 4b `site` run already produced `<OUT>/audit.json` — if `<tokens>` was only resolved after (synthesis), re-run with `--tokens "<tokens>" --ds-source <provided|synthesized>`.
- **Figma source (or a prepared inventory):**
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit.mjs" analyze "<OUT>/blocks.json" --out "<OUT>" --tokens "<tokens>" --ds-source <provided|synthesized>
```
Read `<OUT>/audit.json`. Its shape: `summary` (pages, blocks, clusters, `consistency_pct`, `deviating_instances`), `ds_stats` (token/color/type/space/radius/component counts + `source`), `canonical_blocks[]` (per cluster: role, instances, pages, `example` instance, canonical styles/structure), `deviations[]` (`{cluster, role, page, block, match, tier, reason_types[], deltas[], deltas_typed[]}`), `block_status[]` (one entry per instance — drifting **and** OK — `{page, block, cluster, role, match, tier, reason_types[], reasons[]}`, the full matrix), `page_stylesheets`, and `quality_signals`. This is the evidence backbone — do not re-derive it by eyeballing HTML.

## Step 6 — Design-system quality pass (10 weighted metrics)

Run only when a DS was **provided or synthesized**. Score each metric **0–100%** using the `quality_signals` from `audit.json` plus the deterministic contrast gate and your design judgment. For the contrast metric, run (Bash, read-only) `node "${CLAUDE_PLUGIN_ROOT}/tools/gen-preview.mjs" "$CLAUDE_PROJECT_DIR" --check` against the resolved DS (or compute from the token hex values if the DS lives outside the standard path) and read `contrast_failures[]`.

| # | Metric | Weight | What "good" means / evidence |
|---|--------|-------:|------------------------------|
| 1 | Token coverage | 14 | Color/type/space/radius/shadow/motion are tokenized, not ad-hoc — `quality_signals.token_coverage_pct`. |
| 2 | Scale coherence (type, space & radius) | 10 | Type, spacing, and radius all follow rhythmic scales with meaningful visual differentiation. Radius values within 5 px of each other (e.g., 8 px and 12 px) are perceptually identical at normal display size — a two-radius system with that gap has effectively one step; score this low and call it out explicitly in the critical assessment. Use `distinct_lengths` as a signal, then apply judgment. |
| 3 | Color system rigor | 12 | Structured roles (bg/surface/text/border/accent), neutral ramp, state tints, one disciplined accent — judgment. |
| 4 | Accessibility / contrast | 16 | Intended text/surface pairs meet WCAG AA — `gen-preview --check` `contrast_failures[]`. Any failure caps this low. |
| 5 | Naming & structure hygiene | 6 | Systematic, namespaced names; no duplicates — `undefined_var_refs`, `duplicate_token_defs`. |
| 6 | Component coverage | 12 | Primitives/Components/Modules exist for the patterns the design actually uses — `canonical_blocks` roles vs DS. |
| 7 | Variant & state completeness | 8 | Needed variants & states (hover/active/disabled/focus) defined — judgment from DS/components.md. |
| 8 | Reuse / DRY | 8 | Few one-off/duplicate definitions — `distinct_colors`/`distinct_lengths` vs token count. |
| 9 | Responsiveness | 8 | Breakpoints & responsive rules are systematic — `quality_signals.breakpoint_count`. |
| 10 | Documentation & implementability | 6 | Clear enough to build from (specimens/usage) — judgment. |

**Weighted overall** — after scoring all 10 metrics, run (Bash):
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" --max 100 '[
  {"criterion":"Token coverage","weight":14,"score":<s1>},
  {"criterion":"Scale coherence (type, space & radius)","weight":10,"score":<s2>},
  {"criterion":"Color system rigor","weight":12,"score":<s3>},
  {"criterion":"Accessibility / contrast","weight":16,"score":<s4>},
  {"criterion":"Naming & structure hygiene","weight":6,"score":<s5>},
  {"criterion":"Component coverage","weight":12,"score":<s6>},
  {"criterion":"Variant & state completeness","weight":8,"score":<s7>},
  {"criterion":"Reuse / DRY","weight":8,"score":<s8>},
  {"criterion":"Responsiveness","weight":8,"score":<s9>},
  {"criterion":"Documentation & implementability","weight":6,"score":<s10>}
]'
```
Use `rows[i].weighted` for the **Score %** column contribution, `health` for the weighted overall and the `"weighted_overall"` key in `quality.json`, and `band` for the quality band. Never recompute by hand.

Write `<OUT>/quality-report.md`: a table (Metric · Weight · Score % · Evidence · Note), the weighted overall, and a short **Critical assessment** (biggest strength · biggest weakness · highest-impact fix). Every metric scoring < 60% gets a one-line "why" tied to its evidence.

Also write the machine-readable `<OUT>/quality.json` (consumed by the HTML report in Step 7b) with the same numbers:
```json
{ "weighted_overall": <0-100>,
  "metrics": [ { "n": 1, "name": "Token coverage", "weight": 14, "score": <0-100>, "evidence": "<short>", "note": "<short>" }, … all 10 … ],
  "critical_assessment": { "strength": "<…>", "weakness": "<…>", "fix": "<…>" } }
```
If the Quality pass did not run (no DS), skip `quality.json` — the report falls back to the deterministic `quality_signals`.

## Step 7 — Write the reports

**`<OUT>/canonical-blocks.md`** — the generalized inventory: one entry per `canonical_blocks[]` cluster (role, instance count, the pages it appears on, its canonical style/structure signature). This is "the design system the pages actually express."

**`<OUT>/audit-report.md`** — the headline deliverable:
```markdown
# Design-system audit — <ISO date>
Source: <figma url | site url>  ·  Baseline: <provided DS | synthesized from design>  ·  Confidence: <static | low (JS pages) | figma>

## Scores
- Design-system quality: <weighted overall>/100   (see quality-report.md)
- Consistency: <consistency_pct>%  ·  <deviating_instances> drifting block(s) across <pages> pages / <clusters> components

## Mismatch findings
### [BLOCKER|WARNING|SUGGESTION] <literal name> drifts on <page>
- Where: <page> · <literal name> `<block selector>` (cluster <id>, match <match>%)
- Problem: <the deltas — verbatim from audit.json (already slimmed/capped)>
- Why it doesn't match: <1–2 sentences: which token rule it breaks and the consequence>
- Recommendation: <the specific change — e.g. replace #1a73e8 with var(--color-accent); use --space-4 (16px) not 18px>

## Unify these (near-duplicate components)
- <cluster id> <role>: same component appears on <pages> with drift — converge on the canonical (canonical-blocks.md).
```
**Tiering:** a deviation is a **BLOCKER** when it breaks a token rule that matters (a raw **opaque** color where a palette exists, or a structural omission of a required region); **WARNING** when it's a translucent tint/overlay off-palette, off-scale spacing/type/radius, or an undocumented variant; **SUGGESTION** for minor drift. The script already assigns each `deviations[]`/`block_status[]` entry a `name`, `tier`, and `reason_types` by exactly this rule — use them; don't re-derive. Drive the `.md` findings from `deviations[]` (sorted worst-match first), naming the literal `name`; the HTML report (Step 7c) renders every page's blocks as per-page card files from `block_status[]`. If `deviations[]` is empty, write "No block-level drift — the design follows its system consistently."

## Step 7b — Generate block visuals

**Detect Playwright first.** Run (Bash):
```bash
node -e "import('playwright').then(()=>process.exit(0),()=>process.exit(1))"
```

- **Exit 0 — Playwright is installed:** run `ds-shots` without any extra flags. The tool takes Playwright screenshots for every block it can locate. Blocks it cannot locate get **no preview** (`null`) — **no HTML fallback, ever**. The mix of screenshot + HTML-embed modes is explicitly disabled when Playwright is available.
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-shots.mjs" --out "<OUT>"
```

- **Exit 1 — Playwright is not installed:** ask via the **AskUserQuestion** tool (single-select, header "Block visuals"):
  - **Install Playwright** (recommended) — show the user: `npm install -D playwright && npx playwright install chromium`. Once the user confirms it is installed, re-run the detection check. If now installed, run `ds-shots` as above (Playwright path). If the install fails or the user skips, fall back to HTML.
  - **Use HTML previews** — run with `--html-only`, which fetches and inlines each page's stylesheets so the preview renders faithfully without a browser:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-shots.mjs" --out "<OUT>" --html-only
```

The script writes `<OUT>/shots/` (PNGs when Playwright ran), `<OUT>/previews/` (HTML embeds when html-only), and `<OUT>/visuals.json`. A block with no preview renders without a thumbnail — the card is still shown. Never re-run ds-shots after Playwright has already produced screenshots; the visuals.json it writes is consumed as-is by Step 7c.

## Step 7c — Generate the HTML report (headline deliverable)

Run the report generator. It reads `audit.json` (+ `visuals.json` and, when present, `quality.json` and the resolved `tokens.css`) and writes a **multi-file** report: `audit-report.html` (the homepage — scorecard, design-system review, and the page list with per-page BLOCKER/WARNING/SUGGESTION/OK counts) plus one `audit-<page-slug>.html` per page (only that page's blocks, each a fused card with the now-vs-should-look visuals). Pass `--tokens` so the homepage shows the swatch row and the per-block deltas name the nearest token.
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit-report.mjs" --out "<OUT>" [--tokens "<tokens>"]
```
This is the human deliverable; the `.md` reports stay as companions. Do not hand-write the HTML, and do not re-introduce a separate canonical-component gallery (that lives in the design system now).

## Step 8 — Report

State: the sources audited, baseline (provided vs **synthesized into the canonical DS, then cleaned**), DS-quality weighted overall (if run), consistency %, the count of drifting blocks and the worst offenders (literal name + page), any low-confidence (JS-rendered) pages, and the artifact paths under `.twt-artifacts/design/design-system-audit/` — leading with **`audit-report.html`** (the homepage) as the thing to open, and noting that each page has its own `audit-<slug>.html` reachable from it. If the canonical DS was synthesized, say so (and whether cleanup re-ran define) and point to `.twt-artifacts/design/design-system/`. If a **provided** DS had issues, say they're reported but **not** modified. Note that fixing the *audited design* is a separate step (`/twt-design-system-define` to evolve the system; rebuild blocks to match).
