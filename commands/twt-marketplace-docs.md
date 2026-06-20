---
name: twt-marketplace-docs
category: meta
description: (v1.0.3) Regenerate SKILLS.md, architecture.md, and the README table block from skill frontmatter
version: 1.0.3
accepts_arguments: false
inputs: []
dependencies:
  hard: []
  soft: []
reads:
  - commands/*.md
  - skills/*/SKILL.md
writes:
  - SKILLS.md
  - architecture.md
  - README.md (marked block only)
---

# /twt-marketplace-docs

## Intent

**Purpose:** Regenerate all derived marketplace documentation (`SKILLS.md`, `architecture.md`, and the skills table in root `README.md`) from the frontmatter and Intent blocks of every skill. Stamps `(vX.Y.Z)` into each skill's committed `description:` field from its `version:` frontmatter. Ensures docs never drift from skills.

**Non-goals:**
- Doesn't modify skill body content — only stamps the `description:` frontmatter field and rewrites generated files
- Doesn't validate skill body content — only frontmatter
- Doesn't create per-category README files (those no longer exist)
- Doesn't enforce strict lint rules — only warns about missing required fields

**Success criteria:**
- `SKILLS.md` lists every skill found, sorted alphabetically, with the `(vX.Y.Z)` version stripped from the displayed description
- `architecture.md` contains a current mermaid diagram of skill dependencies plus a per-skill detail table
- Validation warnings printed for any skill missing required frontmatter fields
- Every auto-generated file starts with the AUTO-GENERATED header
- Root `README.md` marked block (if present) is updated

---

## Step 0 — Run the generator script

This regeneration is **deterministic**, so it is delegated to a script rather than done by hand — running it as a model wastes tokens and risks format drift. From the marketplace repo root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/gen-docs.mjs"            # regenerate all derived docs
node "${CLAUDE_PLUGIN_ROOT}/tools/gen-docs.mjs" --check    # CI: exit 1 if any derived doc is stale
```

The script (`tools/gen-docs.mjs`, zero dependencies) reads skills from two locations:
- `commands/*.md` — orchestrators and standalone tools (39+ skills)
- `skills/*/SKILL.md` — sub-skills (one directory per sub-skill)

Category comes from the `category:` frontmatter field (not from a folder name). The script stamps `(vX.Y.Z)` into each skill's `description:` from its `version:` field, then rewrites `SKILLS.md`, `architecture.md`, and the `README.md` marked block — preserving each file's existing line endings. It prints a skills-indexed / categories / validation-warnings summary and exits 0 on success (or 1 when `--check` finds stale files).

If the script runs successfully, **you are done** — report its summary output (Step 5). Only fall back to the manual steps below if Node is unavailable or the script errors.

## Step 1 — Scan skill files

Read skills from two locations (plugin layout):
- `commands/*.md` — skip `README.md`; the file's basename (without `.md`) is the expected skill name
- `skills/*/SKILL.md` — the parent directory name is the expected skill name

For each file:
- Strip a leading BOM if present
- Parse YAML frontmatter (text between the first two `---` markers)
- Capture the Intent block (text between `## Intent` and the next `---`)
- Stamp `(vX.Y.Z)` into the `description:` line using the `version:` field; write back if changed

Build an in-memory record per skill: `{name, category, description, version, accepts_arguments, inputs, reads, writes, dependencies, intent}`.

## Step 2 — Validate frontmatter

For each skill, verify these fields are present and non-empty (an explicit empty list `[]` is acceptable for `inputs`, `reads`, `writes`):
- `name`, `category`, `description`, `version`, `accepts_arguments`, `inputs`, `reads`, `writes`

For any genuinely absent field (undefined), append an entry to a `warnings` list: `<filepath>: missing field <name>`. Continue regardless — validation is a warning, not an abort.

Also verify `name` matches the expected name (file basename for commands, directory name for skills). Warn on mismatch. Warn if `accepts_arguments` is absent.

## Step 3 — Compute reverse dependencies

For each skill `S`, scan all other skills for entries in `dependencies.hard` or `dependencies.soft` matching `S.name`. Attach the resulting list as `hard_consumers` and `soft_consumers`.

## Step 4 — Render and write output files

Render and overwrite three files (preserving each file's existing line endings):

**`SKILLS.md`** — Index table (one row per "public" skill — those not filtered as internal define/validate sub-skills with a matching bare orchestrator) plus per-skill detail sections.

**`architecture.md`** — Mermaid flowchart of all skill dependencies, skills-by-category listing, per-skill detail tables (with writes as a table), cross-skill dependency table, and artifact namespace summary derived from all `writes` paths starting with `.twt-artifacts/`.

**`README.md` marked block** — Replace the content between `<!-- TWT_SKILLS_TABLE_START -->` and `<!-- TWT_SKILLS_TABLE_END -->` with a `| command | category | description |` table row for each public skill (description with `(vX.Y.Z)` stripped).

## Step 5 — Report

Print a summary to the user:

```
Skills indexed: <N>
Categories: <list>
Warnings: (none)   [or list of warnings]

<N> file(s) regenerated.   [or: 0 file(s) already current.]
```
