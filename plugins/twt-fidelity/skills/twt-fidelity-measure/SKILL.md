---
name: twt-fidelity-measure
surface: internal
user-invocable: false
category: fidelity
family: fidelity
role: measure
unit: twt-fidelity
description: (v1.0.1) Measure a built page against the reference spec and report every delta
version: 1.0.1
accepts_arguments: true
inputs:
  - --name <target-slug>, --built <url-or-file>, --root <selector>, --mode system|strict, --iteration <n>
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/fidelity/<target-slug>/reference-spec.json
  - .twt-artifacts/fidelity/<target-slug>/reference-spec-estimated.json
  - .twt-artifacts/fidelity/<target-slug>/reference/
  - .twt-artifacts/fidelity/<target-slug>/summary.json
writes:
  - .twt-artifacts/fidelity/<target-slug>/measured.json
  - .twt-artifacts/fidelity/<target-slug>/deltas.json
  - .twt-artifacts/fidelity/<target-slug>/summary.json
  - .twt-artifacts/fidelity/<target-slug>/built/
  - .twt-artifacts/fidelity/<target-slug>/diff/
  - .twt-artifacts/fidelity/<target-slug>/pixdiff.json
  - .twt-artifacts/fidelity/<target-slug>/validation-report.md
  - .twt-artifacts/fidelity/<target-slug>/validation-report-estimated.md
  - .twt-artifacts/fidelity/<target-slug>/fidelity-report.html
  - .twt-artifacts/fidelity/<target-slug>/fidelity-report-estimated.html
---

# /twt-fidelity-measure

## Intent

**Purpose:** Measure an already-built page against the reference spec `/twt-fidelity-fetch` produced, diff the two, and write a deterministic, tolerance-gated report of every property that drifted — so the fix loop this skill feeds has a real measurement to stop on, never a model's opinion.

**Non-goals:**
- Writes nothing outside `.twt-artifacts/fidelity/<target-slug>/`.
- Never edits the build. It only reads it.
- Never re-runs the builder — producing or updating the build is the orchestrator's job (`/twt-fidelity`); this skill is handed a finished `--built` target and measures it as-is.
- Never reads `deltas.json` or `measured.json` into model context. They are script-to-script artifacts — see Step 4.
- Never renders a score for a run it could not measure (Step 2's NOT VERIFIED path).

**Success criteria:**
- Every run produces exactly one of: a full measured/estimated report pair (`validation-report(-estimated).md` + `fidelity-report(-estimated).html`), or — on the unverified path — a single `validation-report(-estimated).md`, filename chosen the same way the measured path chooses it, that says NOT VERIFIED and emits no score, and no `.html` file at all.
- An estimated reference (`reference-spec-estimated.json`) never produces a report under the measured filenames (`validation-report.md` / `fidelity-report.html`) — that ambiguity is exactly what `spec.mjs`'s `reportBasenames()` exists to prevent, applied by the CLI itself since `spec.mjs` has no CLI of its own.
- The model's own context never holds `deltas.json` or `measured.json` — only `summary.json` (capped, markup-free) and, when a pixel finding cannot be expressed numerically, a single heatmap screenshot.
- A missing reference spec, a measurement failure, or a diff-CLI failure each stop the run with the tool's own stderr message reported verbatim — never a guessed explanation.

---

## Step 1 — Locate the spec

Glob `.twt-artifacts/fidelity/<target-slug>/reference-spec.json`. If absent, Glob `.twt-artifacts/fidelity/<target-slug>/reference-spec-estimated.json`. If neither exists, stop: "No reference spec at `.twt-artifacts/fidelity/<target-slug>/` — run /twt-fidelity-fetch first."

Read whichever one exists (Read tool — it is a small structured artifact, not the banned exhaustive kind; see Step 4 for what actually is banned). From it, note:
- **The widths captured** — the keys of its `widths` object (e.g. `1440`, `768`, `390`). These are the widths Step 2 measures; never measure a width the reference never captured — the diff CLI (Step 3) rejects that combination outright (exit 3) rather than silently comparing against nothing.
- **`source.kind`** (`url` / `figma` / `image`) — informs how Step 5 frames the report (an `image` source is always estimated; its pixel diff, not its numbers, is the arbiter).
- **Whether it is estimated** — read this from the spec's own `provenance.estimated` field (`> 0` means estimated), the same signal `spec.mjs`'s `isEstimated()` uses, never from which of the two filenames the Glob matched. In practice the two agree for every adapter `/twt-fidelity-fetch` ships (url/figma are always pure-measured, image always pure-estimated), but `provenance` is the actual contract and is what Step 2's unverified path and Step 3's diff CLI both key off — checking the same signal everywhere means this skill can never disagree with itself about which report filename is correct. Call this flag **`estimated`** below; if true, every number in this run's report is a guess — say so plainly in Step 5.

## Step 2 — Measure the build

Determine whether `--built` names something this skill can actually open:
- **A URL** (starts with `http://` or `https://`) — always measurable, any build target. Use `--url`.
- **A local, directly-viewable HTML file** (a real static file, e.g. an `html-site` build's page) — measurable. Use `--file`.
- **Anything else — `--built` absent, empty, or pointing at something that cannot be opened as a static page** (the common case: an Elementor target with no live/staging URL supplied, since an Elementor page is server-rendered PHP and cannot be opened via `file://` and get a correct render) — **this run cannot be measured.** Skip straight to the NOT VERIFIED report below; never invent a score.

**Measurable path** — one Bash call, no chaining:
```
node "${CLAUDE_PLUGIN_ROOT}/tools/fidelity/measure.mjs" --url "<built>" --root "<sel-or-body>" --widths "<csv-of-spec-widths>" --out ".twt-artifacts/fidelity/<target-slug>/measured.json"
```
(`--file "<built>"` in place of `--url` when the build is a local static file; omit `--root` to default to `body`.)

Interpret the exit code — these are deliberately distinct failure modes, never collapse one into the other's message:
- **Exit 0** → continue to Step 2b.
- **Exit 2** — Playwright/Chromium is genuinely unavailable. Report the install line verbatim (`npm install playwright && npx playwright install chromium`) and stop.
- **Exit 3** — the measurement itself failed (bad `--root` selector, navigation error, timeout). Report the stderr message verbatim, suggest checking the selector and the `--built` value, and stop.

**Unverified path** — no measurement is taken; `measured.json` is never written. Write the report under **the same filename the estimated flag from Step 1 dictates** — `validation-report-estimated.md` if `estimated` is true, `validation-report.md` otherwise — never hardcode the measured name. This matters even here: a later measured re-run of a target whose reference is estimated writes `validation-report-estimated.md`, and an unverified run that ignored the flag would leave a stale `validation-report.md` stub sitting beside it — exactly the measured/estimated ambiguity `reportBasenames()` exists to prevent everywhere else in this skill. Write it (Write tool) with exactly this content, mirroring `report.mjs`'s own `renderValidationReport(null, meta)` contract so a human or a later script reading it sees the identical shape either way:
```markdown
# Fidelity — <target-slug>

**NOT VERIFIED** — <reason, e.g. "no WordPress URL supplied for the Elementor build">.

No score is reported because none was measured. Supply a local or staging URL
via `--url` and re-run to get a measured report.
```
Write nothing else — no `fidelity-report.html` / `fidelity-report-estimated.html` (the renderer dereferences fields a null diff never has and is never safe to call here), no `deltas.json`, no `summary.json`, no `built/`/`diff/` screenshots. Go straight to Step 5 and report the NOT VERIFIED outcome; skip Steps 2b–4 entirely.

## Step 2b — Capture and pixel-diff

Only reached on the measurable path. For each width the reference spec captured:

1. **Screenshot the build** at that width — one Bash call per width, no chaining (the same tool `/twt-fidelity-fetch` uses for reference screenshots; `pixdiff.mjs`'s own `shoot()` stays a Node-only export on purpose, so this is not the tool to reach for from prose):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/ds-block-preview.mjs" --url "<built>" --selector "<sel-or-body>" --width <width> --height 1200 --out ".twt-artifacts/fidelity/<target-slug>/built/iter-<n>-<width>.png"
   ```
   (`--file` in place of `--url` for a local static build.) Same exit-code contract as Step 2's measure call: exit 2 = Playwright unavailable (report, stop); exit 3 = the screenshot itself failed (report, stop).

2. **Find the reference image for that width.** Glob `.twt-artifacts/fidelity/<target-slug>/reference/<width>.*` — the extension is `.png` for the url/figma adapters and the source image's own extension for the image adapter (per `/twt-fidelity-fetch`'s contract); never assume `.png`.

3. **Pixel-diff the pair** — one Bash call per width, no chaining:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/fidelity/pixdiff.mjs" --a ".twt-artifacts/fidelity/<target-slug>/reference/<width>.<ext>" --b ".twt-artifacts/fidelity/<target-slug>/built/iter-<n>-<width>.png" --out ".twt-artifacts/fidelity/<target-slug>/diff/iter-<n>-<width>.png"
   ```
   For the **first** width only, also pass `--json ".twt-artifacts/fidelity/<target-slug>/pixdiff.json"` — this is the one file Step 3's diff CLI reads (behind an `existsSync` guard) to surface the pixel-diff percentage in the report; without it the pixel line silently never renders, and on the image-adapter path the pixel diff is the stated arbiter, not a garnish. For every other width, omit `--json` — the heatmap PNG (`--out`) is what matters for those; their numeric result is not persisted.
   Same exit-code contract: exit 2 = Playwright/Chromium unavailable (report, stop); exit 3 = the comparison itself failed, e.g. a missing input file (report, stop).

## Step 3 — Diff and render

One Bash call, no chaining:
```
node "${CLAUDE_PLUGIN_ROOT}/tools/fidelity/diff.mjs" --dir ".twt-artifacts/fidelity/<target-slug>" --mode <system|strict> --iteration <n>
```
(`--mode` defaults to `system` if the caller did not specify one; `--iteration` defaults to `1`.)

This one call reads the reference spec and `measured.json`, pairs them by width, applies every tolerance, and writes `deltas.json`, `summary.json`, and both human reports (`validation-report.md` + `fidelity-report.html`, or their `-estimated` siblings if the spec was estimated — the CLI applies that filename rule itself, from the spec's own `provenance`, so a guess never wears a measurement's filename).

- **Exit 0** → continue to Step 4.
- **Non-zero exit** (no reference spec found in the directory, or a measured width the reference never captured) → report the stderr message verbatim and stop. Neither `deltas.json` nor `summary.json` exists on this path — do not attempt to read either.

## Step 4 — Read only the summary

**Read `summary.json` (Read tool) and nothing else.** It is capped (at most 120 rows, failures surviving truncation before warnings) and markup-free by construction — this is the one file built for a model to read. It carries a `pixdiff` field (`{mismatch, reported, out}`, or `null` when Step 2b never ran a comparison) — the diff CLI (Step 3) folds `pixdiff.json`'s content into it itself, so the pixel-diff percentage is already inside the one file this step reads. Do not open `pixdiff.json` separately; it exists on disk only for the diff CLI's own script-to-script use.

**`deltas.json` and `measured.json` are script-to-script and must never be read into model context.** They hold every property of every element, uncapped — the same hard token budget `/twt-block-map` established and `/twt-figma-dev-audit`'s first live run violated by aiming a 75MB payload at model context. Do not Read, Grep, or otherwise inspect either file.

**Screenshots reach the model only when a pixel finding cannot be expressed numerically**, and then only the single heatmap PNG named in `summary.json`'s `pixdiff.out` field (or the relevant `diff/iter-<n>-<width>.png`) — never the reference or built screenshots side by side, never every width's heatmap at once.

## Step 5 — Report

**On the unverified path (Step 2):** state plainly that no measurement was taken, why (the reason written into the `validation-report(-estimated).md` file actually written — name which one), and what would unblock it (a `--url`). No Band, no Health, no findings — there is nothing to report them from.

**On the measured path**, state:
- **Band** and **Health** from `summary.json`'s `score` (health may be `null` / "not assessed" if nothing was comparable — say so, never print the literal word "null").
- **Fail / warn counts** from `summary.json`'s `counts`.
- **The top failing rows** — `summary.json`'s `rows` are already sorted failures-first; name the worst two or three by `id` and `prop`.
- **The pixel-diff percentage**, from `summary.json`'s `pixdiff` field, when non-null — and whether it crossed the reportable floor.
- **Every artifact path written this run**: `measured.json`, `deltas.json`, `summary.json`, `built/`, `diff/`, `pixdiff.json`, and whichever report pair (measured or estimated) was written — say explicitly which pair, so a reader never opens the wrong filename expecting the other provenance.
- If the spec was estimated, repeat the warning: these numbers are guesses; the pixel diff, not this report, is the arbiter.
