---
name: twt-design-system-audit
category: design-system
description: (v1.0.0) Audit a real design's system quality + cross-page block consistency from a Figma file and/or site URL — synthesizes a canonical system when none is given and reports the exact page+block that drifts
version: 1.0.0
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
  - .twt-artifacts/design/design-system-audit/audit-report.md
  - .twt-artifacts/design/design-system-audit/canonical-blocks.md
  - .twt-artifacts/design/design-system-audit/quality-report.md
  - .twt-artifacts/design/design-system-audit/audit.json
  - .twt-artifacts/design/design-system-audit/blocks.json
  - .twt-artifacts/design/design-system-audit/pages/
  - .twt-artifacts/design/design-system-audit/synthesized-design-system/
---

# /twt-design-system-audit

## Intent

**Purpose:** Audit how good a design system is **and** how consistently a real design follows it. Given a Figma file and/or a live site, score the design system on **10 weighted quality metrics** (when one is provided or synthesized) and extract **every block on every page**, cluster near-duplicates, and report each block that drifts — naming the **exact page + exact block + what differs + why + the fix**. When no design system is provided, **synthesize a canonical one** from the real structure first, then measure every block against it — so a weak, inconsistent design is judged against the consistent system it should have had.

**Non-goals:**
- Read-only on the source — never edits the audited site or Figma file.
- Doesn't build or fix the design system (that's `/twt-design-system-define`); it reports.
- Not a content or full-a11y audit (those are the `/twt-qa-*` skills); contrast is reused only as one metric.
- The deterministic extraction/clustering/scoring is done by the bundled script — this skill adds judgment (the *why*, recommendations, the design-taste metrics), it does not re-implement parsing in the model.

**Success criteria:**
- `.twt-artifacts/design/design-system-audit/audit-report.md` opens with the DS-quality scorecard (10 metrics %, weighted overall) — when a DS was provided/synthesized — plus an overall **consistency %**, then **mismatch findings**, each with Where (page + block) / Problem (the deltas) / Why / Recommendation, tiered BLOCKER / WARNING / SUGGESTION.
- Near-duplicate blocks are collapsed into one canonical block; the divergent instances are flagged, not treated as separate components.
- When no DS is provided, a synthesized canonical system is written under `synthesized-design-system/` and the audit runs against it (never clobbering `.twt-artifacts/design/design-system/`).

---

Arguments passed to this command: $ARGUMENTS

> **Trace self-logging (when dispatched).** If running in collect mode (`subagent-collect` in `$ARGUMENTS`), run this one Bash line immediately before every Agent/Skill dispatch so the call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> Silent no-op when no trace is armed. Keep `<one-line why>` plain text.

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

- **DS provided or `.twt-artifacts/design/design-system/tokens.css` exists** → set `<tokens>` to that `tokens.css`. Run the **Quality pass** (Step 6) and the **Consistency pass** (Steps 4–5, 7) against it.
- **No DS** → **synthesize** one (Step 4c) before the consistency pass, then set `<tokens>` to the synthesized `tokens.css`.

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
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit.mjs" site "<site-url>" --out "<OUT>" --max <max> [--tokens "<tokens>"]
```
It writes `<OUT>/pages/` (raw pages), `<OUT>/blocks.json`, and `<OUT>/audit.json`, and prints a ` ```json ` summary. If its `summary.js_rendered_pages` is non-empty, note in the report that those pages are **low-confidence** under static analysis (JS-rendered) and recommend a Playwright re-run when available.

### Step 4c — Synthesize a canonical DS (only when no DS was provided)
Dispatch `/twt-design-system-define` via the Agent tool (with `subagent-collect`) in **analyse-existing** mode, pointing it at the Figma URL or the captured `<OUT>/pages/`, and instruct it to write its output under `<OUT>/synthesized-design-system/` (tokens.md, tokens.css, components.md) — **not** the canonical `.twt-artifacts/design/design-system/`. This generalizes the real design into the consistent token + component layer it implies. Set `<tokens>` to `<OUT>/synthesized-design-system/tokens.css`. State clearly in the report that the baseline is **synthesized from the audited design**, so every deviation is "drift from the design's own dominant pattern," which is exactly the point when the design is inconsistent.

## Step 5 — Score consistency (deterministic)

Run the analyzer over the captured inventory with the resolved tokens:
- **Site source:** the Step 4b `site` run already produced `<OUT>/audit.json` — if `<tokens>` was only resolved after (synthesis), re-run with `--tokens "<tokens>"`.
- **Figma source (or a prepared inventory):**
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/ds-audit.mjs" analyze "<OUT>/blocks.json" --out "<OUT>" --tokens "<tokens>"
```
Read `<OUT>/audit.json`. Its shape: `summary` (pages, blocks, clusters, `consistency_pct`, `deviating_instances`), `canonical_blocks[]` (per cluster: role, instances, pages, canonical styles/structure), `deviations[]` (`{cluster, role, page, block, match, deltas[]}`), and `quality_signals` (token coverage %, undefined var refs, distinct value counts, breakpoint count, duplicate token defs). This is the evidence backbone — do not re-derive it by eyeballing HTML.

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
**Tiering:** a deviation is a **BLOCKER** when it breaks a defined token/contrast rule (raw color where a token exists, a contrast-failing pair, a structural omission of a required region); **WARNING** when it's off-scale or an undocumented variant; **SUGGESTION** for minor drift. Drive findings from `deviations[]` (sorted worst-match first) — every entry with deltas becomes a finding; roll a long tail of low-impact ones into a single "Other minor drift (N)" row. If `deviations[]` is empty, write "No block-level drift — the design follows its system consistently."

## Step 8 — Report

State: the sources audited, baseline (provided vs synthesized), DS-quality weighted overall (if run), consistency %, the count of drifting blocks and the worst offenders (page + block), any low-confidence (JS-rendered) pages, and the four artifact paths under `.twt-artifacts/design/design-system-audit/`. Note that fixing is a separate step (`/twt-design-system-define` to evolve the system; rebuild blocks to match).
