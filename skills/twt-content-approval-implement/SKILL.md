---
name: twt-content-approval-implement
surface: command
category: content
description: (v1.1.8) Apply ready approved XLSX content into the built site or development artifacts
version: 1.1.8
model: sonnet
accepts_arguments: true
inputs:
  - Optional path to content-approval-checklist.xlsx; optional --target html|elementor|inherit
dependencies:
  hard:
    - twt-content-approval-checklist
  soft:
    - twt-html-block-creator
    - twt-elementor-block-creator
    - twt-inherit-block-creator
reads:
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - site/
  - <THEME>/
  - .twt-artifacts/html-site/conventions.md
  - .twt-artifacts/elementor-theme/conventions.md
  - .twt-artifacts/inherited/conventions.md
writes:
  - site/
  - <THEME>/
  - the host project's source tree          # inherit target — existing files only, and only after one consolidated approval (Step 4a)
  - .twt-artifacts/content-approval/content-approval-implementation-report.md
  - .twt-artifacts/content-approval/decisions.md
---

# /twt-content-approval-implement

## Intent

**Purpose:** Read the content approval workbook after stakeholder confirmation and update the corresponding site blocks/pages with only the rows whose `approved content` is filled and `ready to implement (true, false)` is `true`. This is intentionally called later, after Development has already built pages/templates with the content available at build time.

**Non-goals:**
- Does not implement unapproved or not-ready rows.
- Does not guess where ambiguous approved content belongs; ambiguous rows are reported and skipped.
- Does not create the approval workbook; use `/twt-content-approval-checklist` first.
- **Never edits a host project's source tree without one consolidated approval** (`inherit` target, Step 4a) — and never runs a command named by the host project's own config without asking first.

**Success criteria:**
- Approved ready rows from the workbook are applied to the corresponding blocks/pages, shared header/footer, media fields, links, video embeds, and SEO metadata.
- Rows not marked ready remain untouched and are listed in the implementation report.
- `.twt-artifacts/content-approval/content-approval-implementation-report.md` records applied, skipped, missing, and ambiguous items with worksheet/page context.

---

Arguments passed to this command: $ARGUMENTS

## Bash call shape — keep every call allowlist-matchable
The permission rules `/twt-setup` seeds match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`); a call that doesn't match forces a manual prompt even when the binary is allowlisted. So for **every** Bash call in this run: never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 - Check workbook dependency

Verify `openpyxl` is available before reading the XLSX:

```powershell
python -c "import openpyxl"
```

If that fails, install and re-check:

```powershell
python -m pip install openpyxl
python -c "import openpyxl"
```

On Windows where `python` is unavailable but `py` exists, use `py -m pip install openpyxl`. If installation fails, stop and report the exact install command the user must run.

## Step 2 - Locate workbook and target

Use the workbook path from `$ARGUMENTS` if supplied; otherwise use `.twt-artifacts/content-approval/content-approval-checklist.xlsx`. Abort if it does not exist.

Parse `--target html|elementor|inherit` from `$ARGUMENTS`. If absent, infer:
- `html` when `site/` or `.twt-artifacts/html-site/conventions.md` exists.
- `elementor` when `.twt-artifacts/elementor-theme/conventions.md` or a likely theme folder exists.
- `inherit` when `.twt-artifacts/inherited/conventions.md` exists.
- If more than one apply or none do, ask via AskUserQuestion with `Static HTML`, `Elementor`, `This project's existing stack`, and `You decide`.

Read the target conventions before editing target files.

## Step 3 - Parse approved rows

Don't hand-parse the XLSX — run the bundled reader (Bash, one command):

```bash
python "${CLAUDE_PLUGIN_ROOT}/tools/checklist-xlsx.py" read --workbook ".twt-artifacts/content-approval/content-approval-checklist.xlsx"
```

(On Windows where `python` is unavailable but `py` exists, use `py`.) It prints a ```json block with every field row per worksheet — `block`, `field_type`, `family`, `current`, `recommended`, `approved`, `ready`, `implementable`, `row` — plus a `summary` and a `duplicates` list. The reader already applies the mechanics: banner/spacer rows (blank `field type`) are skipped silently, readiness is normalized leniently (`true`/`yes`/`1`/boolean TRUE mean ready), and `implementable` is true only when ready is true **and** approved content is not blank. Rows in `duplicates` (same page/block/field with conflicting approved values) are conflicts — skip them and report each.

Work from that JSON. Classify each implementable row by its `family` (the `field type` prefix):
- `text:*` for visible copy and microcopy.
- `link:*` for hrefs, labels, phone/mail/social links, and downloads.
- `image:*` for image source/path/URL, alt text, captions, and thumbnails.
- `video:*` for video URL, embed code, poster/thumbnail, transcript, and captions.
- `file:*` for document/download references.
- `form:*` for labels, placeholders, help text, consent text, and validation messages.
- `seo:*` for slug, page title, keywords, meta title, meta description, schema, canonical, and open graph.

Skip and report rows that are not ready, have blank approved content, use an unknown field prefix, or have duplicate conflicting approved content for the same page/block/field.

## Step 4 - Map workbook rows to site structure

Use worksheet name as the page key, **except** the two dedicated `Shared header` and `Shared footer` worksheets, which map to the global header/footer partials rather than a page. Map page rows by the combination of page, block name, and field type. Prefer exact stable identifiers already present in page layouts, mockups, generated HTML comments, Elementor widget names, component names, or SEO metadata keys.

The `Shared header` and `Shared footer` worksheets are the single source for global header/footer content — page worksheets no longer carry header/footer rows. For their rows:
- Apply the same approved value to the reusable partial/template/widget if one exists.
- If no shared partial exists, apply to every page that contains the matching header/footer value.
- A row whose `Block name` marks a page-specific variant (for example `Header — checkout (no nav)`) applies only to the named page(s); apply the base rows everywhere else.

For media:
- Update `src`, `href`, embed URL/code, poster, thumbnail, alt, caption, and transcript/caption notes where matching fields exist.
- Do not download external media unless the user explicitly asks. Use the approved URL/path as the reference.
- If a local approved path points to a missing file, still write the intended reference only when the target project convention allows pending assets; otherwise skip and report.

For SEO:
- HTML target: update page filename/slug only when the target convention supports it; otherwise update `<title>`, meta tags, canonical/open-graph tags, and JSON-LD in the page head.
- Elementor target: update generated import/template metadata or the theme's SEO handoff artifact when direct WordPress database edits are not available. Never claim WordPress admin data was updated unless the tool actually updated it.
- Inherit target: update meta/SEO fields the way the host project already does it — per the routing and meta-tag pattern named in `.twt-artifacts/inherited/conventions.md` — never bolt on a WordPress- or static-HTML-shaped mechanism the host doesn't have.

## Step 4a - Inherit target: plan the writes and get ONE consolidated approval

**Applies only when `<target>` = `inherit`.** Skip this step entirely for `html` and `elementor` — those write into scaffolds twt created, where an edit costs nothing that wasn't ours.

For `inherit` the write target is **the host project's real source tree**, and by construction every write this skill makes is an edit to a file that already exists — that is precisely the MODIFY class the whole `inherit` approval design exists to gate. `/twt-inherit-block-creator` never touches a host file without one consolidated approval; this skill must not be the back door that does.

1. **Enumerate** every host file the mapping in Step 4 would edit, with, per file: which worksheet/page it serves, which fields land in it, and an estimated count of lines changed. A file this skill would *create* (rare — a new meta partial, say) is a CREATE and flows freely; everything else is a MODIFY.
2. **Screen every candidate path against the never-touched list before it reaches the plan** — the same list `/twt-inherit-block-creator` Step 4 uses, and for the same reason. Drop (don't ask about) any path matching: a lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `composer.lock`, `Gemfile.lock`, `poetry.lock`, `Cargo.lock`); CI config (`.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `Jenkinsfile`, `azure-pipelines.yml`); `.env` or any dotenv variant; a migrations directory; build output (`dist/`, `build/`, `.next/`, `.nuxt/`, `out/`, `.output/`); `node_modules/` or `vendor/`; and anything `git check-ignore -q "<path>"` confirms (one Bash call per remaining candidate, exit 0 means gitignored — drop it). A dropped path is reported as skipped, never silently written.
3. **Ask once, for the whole batch.** Present the full scope in one place — every file, what changes in it, the line estimate — then ask via **AskUserQuestion** (single-select, header "Changes"): **Apply the whole plan** / **Report as TODOs instead — change nothing** / **Stop** / **You decide** (reports as TODOs; the conservative default when writing into a repo the user did not hand us). One approval covers the entire batch: after it, apply Step 5 without asking again. If mid-apply you discover a file the plan did not list, stop, come back **once** with the full revised list and the same four options — never a stream of single questions.
4. **In collect mode** (`subagent-collect` in `$ARGUMENTS`): don't ask. Take the **report as TODOs** path — change nothing in the host tree — and write `.twt-artifacts/content-approval/decisions.md`: frontmatter (`generated`, `area: content-approval`, `producer: twt-content-approval-implement`, `status: open`), H1 `# Decisions to confirm — content approval into host`, a `## Model-decided assumptions (review)` entry recording the deferral (`- Host edits deferred to TODOs instead of applied — basis: collect mode never blocks on approval, so the safe report-only path was taken — reversible: yes (re-run interactively and approve to apply them)`), and a `## Proposed rules (confirm before binding)` section holding the full file list exactly as the interactive plan would show it. Validate it (one Bash call): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file ".twt-artifacts/content-approval/decisions.md"` — fix until it exits 0. Report the block in your own output; the dispatching orchestrator surfaces it per §13.
5. **Auto / unattended:** same as collect mode — report the plan, change nothing. Never auto-approve an edit to a host file.

## Step 5 - Apply edits safely

Before editing, inspect the relevant target files and preserve user changes. Do not replace broad chunks when a smaller targeted edit is possible.

Implementation rules:
- Apply only implementable rows.
- Preserve formatting, component structure, CSS classes, data attributes, and accessibility attributes.
- Keep approved content verbatim except for required HTML escaping.
- For schema JSON, parse and emit valid JSON when possible instead of string-splicing.
- If a value cannot be mapped with confidence, skip it and record why.

When the workbook changes many pages, process one page first, verify the mapping pattern, then apply the same pattern to the remaining pages.

## Step 6 - Verify

Run the cheapest relevant checks available for the target:
- HTML: parse or grep changed pages for approved values, verify key links/assets are present, and run any existing local checks.
- Elementor: verify changed PHP/JSON files still parse where possible and that import files contain approved values.
- Inherit: **grep the changed files for the approved values — that is the check.** Do **not** run the host project's lint/build/test command on your own initiative. No other skill on the `inherit` path executes an arbitrary command out of a host repo's config, and "whatever command the conventions name" is an instruction to run a string this skill did not write, from a file it did not author, against a machine it does not own. If a documented host check exists and you believe it is worth running, **name the exact command in your report and let the user run it**; only run it yourself after asking via **AskUserQuestion** (single-select, header "Host check"): **Run `<the exact command>`** / **Skip — I'll run it myself** / **You decide** (skips). Never ask this in collect, auto, or unattended mode — there, always skip and report the command instead.

Do not report success for a row unless the approved value is present in the target file or generated artifact.

## Step 7 - Write the implementation report

Write `.twt-artifacts/content-approval/content-approval-implementation-report.md`:

```markdown
# Content approval implementation report
Generated: <ISO>
Workbook: <path>
Target: <html|elementor|inherit>

## Applied
| Page | Block | Field type | Target file | Notes |
|------|-------|------------|-------------|-------|

## Skipped
| Page | Block | Field type | Reason |
|------|-------|------------|--------|

## Conflicts
| Page | Block | Field type | Details |
|------|-------|------------|---------|

## Verification
- <commands/checks run and result>
```

## Step 8 - Report

Tell the user the workbook used, target updated, counts of applied/skipped/conflicting rows, files changed, verification performed, and where the report was written.
