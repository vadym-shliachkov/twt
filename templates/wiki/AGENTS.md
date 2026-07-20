<!-- manual-version: 5 — stamped from the twt plugin's templates/wiki/AGENTS.md.
     When the plugin ships a newer manual, /twt-wiki offers an upgrade (a plain
     re-stamp; hand edits are recoverable from git history). Do not remove this line. -->

# Wiki operating manual

This is the project's durable memory. It is read and maintained by both humans and
LLM agents. Read `index.md` first — it is the catalog and the entry point.

## The one rule

`.twt-artifacts/` is **evidence**: generated, disposable, regenerable.
`.project-wiki/` is **memory**: hand-fed, curated, precious.

Before putting anything here, ask: *can this be regenerated from the sources without
asking a human again?*

- **Yes** → it is an artifact. Leave it in `.twt-artifacts/` and **link** to it. Never copy it here.
- **No** → it belongs here. A decision and its reason, a resolved factual conflict, a
  client constraint, an idea, a logo file. If it is lost, a human has to be asked again.

This wiki must survive `rm -rf .twt-artifacts/`.

## Layout

| Path | Holds |
|---|---|
| `index.md` | Catalog of every page. The entry point. |
| `overview.md` | The project in one page: what, for whom, where it stands. |
| `inbox.md` | **Append-only raw capture.** Written only by the harvester (`/twt-wiki-fetch`), on demand. Only the curator drains it. |
| `log.md` | Append-only history: every ingest, sync, and query. (Lints leave their dated trail in `validation-report.md`'s git history, not here.) |
| `facts.md` | Canonical ledger — `RESOLVED` / `CONFLICT` / `UNVERIFIED-ATTR` / `TBD` — plus the provided-assets table. Written only by the curator (`twt-wiki-define`), from fact rows harvested on demand; the pipeline keeps its own ledger in `.twt-artifacts/` and never writes here. |
| `decisions/` | One page per durable decision: what, why, evidence, reversible, superseded-by. |
| `open-questions.md` | Unresolved: live conflicts, un-overruled blockers, unanswered asks. |
| `ideas/` | Functionality and content ideas — `raw` / `shaped` / `scoped` / `shipped` / `dropped`. |
| `entities/` | Client, audience segments, competitors, people, products — and durable concepts (`type: concept` pages live here too; there is no separate `concepts/` folder). |
| `analyses/` | Saved answers from queries that were worth keeping. |
| `glossary.md` | Terms, and banned words. |
| `sources.md` | Registry of all evidence: `raw/` files, `.twt-artifacts/` paths, URLs. |
| `raw/` | Immutable ingested sources. Assets, meeting notes. Never edit; never delete. |
| `validation-report.md` | Wiki health report, written only by the validator; its git history is the dated trail. |

## Who may write what

- **The harvester** (`/twt-wiki-fetch`, run on demand) appends to `inbox.md`, adds rows
  to `sources.md`, and records processed-item IDs in `.harvest-state.json` — and touches
  **no curated page**. Nothing writes to the wiki automatically. Appending cannot corrupt.
- **The scaffolder** seeds each curated page — `decisions/`, `entities/`, `ideas/`,
  `facts.md`, `open-questions.md`, `glossary.md`, `index.md`, `overview.md` — with an
  empty stub once, at init, never overwriting a file that already exists.
- **The curator** (`twt-wiki-define`) is the only thing that writes *into* a curated
  page after that — the same list, now with real content. That includes `facts.md`: the
  curator is its only writer, merging fact rows mechanically through
  `tools/wiki-facts-merge.mjs` (by fact key, never silently flipping a value — a
  disagreement becomes a `CONFLICT` row). The pipeline keeps its **own** separate ledger
  in `.twt-artifacts/`; `twt-curation-define` writes only there and never touches this
  wiki page (CONVENTIONS §17).
- **Nothing** deletes a source file or a wiki page without explicit human approval.

## Page frontmatter

```yaml
---
title: Page Title
type: overview|source|decision|question|entity|concept|idea|asset|analysis|report
status: draft|current|needs-review|resolved|superseded
updated: YYYY-MM-DD
summary: one line for the index (optional - the catalog is compiled from it)
sources:
  - path-or-url
tags: []
---
```

Exception: `type: idea` pages use their own lifecycle vocabulary in `status` —
`raw | shaped | scoped | shipped | dropped` — instead of the list above.

## Rules for maintaining pages

- Every claim cites a source path, artifact path, URL, or `log.md` entry.
- **Pages link to each other — the wiki is a graph, not a set of drawers.** When a
  decision names an entity, the decision page links the entity page *and* the entity
  page links back under a "Decisions" list. Related decisions link each other;
  supersession always links both ways. Use relative Markdown links
  (`[Acme Corp](../entities/acme-corp.md)`) so they work in Obsidian, GitHub, and a
  plain filesystem. A page no other page links to is knowledge nothing trails to.
- **Update, never duplicate.** Merge new information into the existing page.
- A contradiction is marked `status: needs-review` and surfaced — never silently resolved.
- Keep the wiki smaller than its source set by merging repeated knowledge into durable pages.
- Prefer `status: current` pages when answering. Treat `draft`, `needs-review`, and
  `superseded` as suspect.
