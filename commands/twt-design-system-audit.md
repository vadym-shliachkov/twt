---
name: twt-design-system-audit
category: design-system
description: (v1.1.2) Audit a real design's system quality + cross-page block consistency from a Figma file and/or site URL — synthesizes the canonical system when none is given and produces an HTML report with per-block visuals naming the exact page+block that drifts
version: 1.1.2
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
reads:
  - $ARGUMENTS (figma URL, site URL, tokens path, --brand)
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/tokens.css
writes:
  - .twt-artifacts/design/design-system-audit/audit-report.html
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
- `.twt-artifacts/design/design-system-audit/audit-report.html` is the **headline deliverable**: a scorecard (DS quality /100 when scored, consistency %, drifting-block count), a **design-system review** (token/color/type/space/radius/component stats + the 10-metric scorecard), a **full page matrix** — every page (linked) and every block with status + reason chips + a thumbnail — and tiered **findings** (BLOCKER / WARNING / SUGGESTION) each showing the drifting block next to its canonical example. The `.md` reports remain as machine/diff-friendly companions.
- Near-duplicate blocks are collapsed into one canonical block; the divergent instances are flagged, not treated as separate components.
- When no DS is provided, the canonical system is synthesized **into** `.twt-artifacts/design/design-system/` and the audit runs against it; an existing DS is never clobbered.

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

- **DS provided or `.twt-artifacts/design/design-system/tokens.css` exists** → set `<tokens>` to that `tokens.css` and `<ds-source>` = `provided`. Run the **Quality pass** (Step 6) and the **Consistency pass** (Steps 4–5, 7) against it. Never overwrite it.
- **No DS** → **synthesize** the canonical one (Step 4c) into `.twt-artifacts/design/design-system/` before the consistency pass, then set `<tokens>` to that `tokens.css` and `<ds-source>` = `synthesized`.

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
Run the bundled crawler — it fetches static HTML + linked CSS, extracts the per-page block inventory, and (in Step 5) clusters and scores it. **Run it directly; do not hunt for the tool.**
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit.mjs" site "<site-url>" --out "<OUT>" --max <max> [--tokens "<tokens>"] [--ds-source <provided|synthesized>]
```
It writes `<OUT>/pages/` (raw pages), `<OUT>/blocks.json`, and `<OUT>/audit.json`, and prints a ` ```json ` summary. The `audit.json` carries `summary`, `ds_stats` (token/color/type/space/radius/component counts + `source`), `canonical_blocks[]` (each with an `example` instance), `deviations[]` (typed deltas + `tier` + `reason_types`), `block_status[]` (every instance — drifting **and** OK — for the full matrix), `page_stylesheets`, and `quality_signals`. If `summary.js_rendered_pages` is non-empty, note in the report that those pages are **low-confidence** under static analysis (JS-rendered) and recommend a Playwright re-run when available.

### Step 4c — Synthesize the canonical DS (only when no DS exists)
Dispatch `/twt-design-system-define` via the Agent tool (with `subagent-collect`) in **analyse-existing** mode, pointing it at the Figma URL or the captured `<OUT>/pages/`, and let it write the **canonical** `.twt-artifacts/design/design-system/` (tokens.md, tokens.css, preview.html). It is refinement-aware: it only runs here because no DS existed, so it creates rather than clobbers. This generalizes the real design into the consistent token + component layer it implies. Set `<tokens>` to `.twt-artifacts/design/design-system/tokens.css` and `<ds-source>` = `synthesized`. State clearly in the report that the baseline is **synthesized from the audited design**, so every deviation is "drift from the design's own dominant pattern," which is exactly the point when the design is inconsistent.

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
| 2 | Scale coherence (type & space) | 10 | Type & spacing follow a rhythmic scale, few arbitrary steps — `distinct_lengths` vs a sane scale + judgment. |
| 3 | Color system rigor | 12 | Structured roles (bg/surface/text/border/accent), neutral ramp, state tints, one disciplined accent — judgment. |
| 4 | Accessibility / contrast | 16 | Intended text/surface pairs meet WCAG AA — `gen-preview --check` `contrast_failures[]`. Any failure caps this low. |
| 5 | Naming & structure hygiene | 6 | Systematic, namespaced names; no duplicates — `undefined_var_refs`, `duplicate_token_defs`. |
| 6 | Component coverage | 12 | Primitives/Components/Modules exist for the patterns the design actually uses — `canonical_blocks` roles vs DS. |
| 7 | Variant & state completeness | 8 | Needed variants & states (hover/active/disabled/focus) defined — judgment from DS/components.md. |
| 8 | Reuse / DRY | 8 | Few one-off/duplicate definitions — `distinct_colors`/`distinct_lengths` vs token count. |
| 9 | Responsiveness | 8 | Breakpoints & responsive rules are systematic — `quality_signals.breakpoint_count`. |
| 10 | Documentation & implementability | 6 | Clear enough to build from (specimens/usage) — judgment. |

**Weighted overall = Σ(metric% × weight) / 100** (weights sum to 100). Write `<OUT>/quality-report.md`: a table (Metric · Weight · Score % · Evidence · Note), the weighted overall, and a short **Critical assessment** (biggest strength · biggest weakness · highest-impact fix). Every metric scoring < 60% gets a one-line "why" tied to its evidence.

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
### [BLOCKER|WARNING|SUGGESTION] <role> drifts on <page>
- Where: <page> · <block selector/name> (cluster <id>, match <match>%)
- Problem: <the deltas — verbatim from audit.json>
- Why it doesn't match: <1–2 sentences: which canonical/token rule it breaks and the consequence>
- Recommendation: <the specific change — e.g. replace #1a73e8 with var(--color-accent); use --space-4 (16px) not 18px>

## Unify these (near-duplicate components)
- <cluster id> <role>: same component appears on <pages> with drift — converge on the canonical (canonical-blocks.md).
```
**Tiering:** a deviation is a **BLOCKER** when it breaks a defined token/contrast rule (raw color where a token exists, a contrast-failing pair, a structural omission of a required region); **WARNING** when it's off-scale or an undocumented variant; **SUGGESTION** for minor drift. The script already assigns each `deviations[]`/`block_status[]` entry a `tier` and `reason_types` by exactly this rule — use them; don't re-derive. Drive the `.md` findings from `deviations[]` (sorted worst-match first); the HTML report (Step 7c) renders the full matrix from `block_status[]` so no page collapses into an "Other minor drift" line there — the `.md` may still roll a long tail into one row for brevity. If `deviations[]` is empty, write "No block-level drift — the design follows its system consistently."

## Step 7b — Generate block visuals

After `audit.json` exists, run the visuals script. It picks one canonical example per cluster + every itemized finding instance and produces a thumbnail each — Playwright element-screenshots when available, else dependency-free embedded-HTML previews from the saved `pages/`. **Run it directly.**
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-shots.mjs" --out "<OUT>"
```
It writes `<OUT>/shots/` (PNGs), `<OUT>/previews/` (HTML embeds), and `<OUT>/visuals.json`. It degrades gracefully — a block that can't be captured simply gets no thumbnail. (Figma-only audits with no saved `pages/` produce no embeds; the report still renders.)

## Step 7c — Generate the HTML report (headline deliverable)

Run the report generator. It reads `audit.json` (+ `visuals.json` and, when present, `quality.json` and the resolved `tokens.css`) and writes the self-contained `audit-report.html`.
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit-report.mjs" --out "<OUT>" [--tokens "<tokens>"]
```
This is the human deliverable; the `.md` reports stay as companions. Do not hand-write the HTML.

## Step 8 — Report

State: the sources audited, baseline (provided vs **synthesized into the canonical DS**), DS-quality weighted overall (if run), consistency %, the count of drifting blocks and the worst offenders (page + block), any low-confidence (JS-rendered) pages, and the artifact paths under `.twt-artifacts/design/design-system-audit/` — leading with **`audit-report.html`** as the thing to open. If the canonical DS was synthesized, say so and point to `.twt-artifacts/design/design-system/`. Note that fixing is a separate step (`/twt-design-system-define` to evolve the system; rebuild blocks to match).
