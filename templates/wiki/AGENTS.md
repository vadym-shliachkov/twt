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
| `inbox.md` | **Append-only raw capture.** Written by the capture hook and by skills. Only the curator drains it. |
| `log.md` | Append-only history: every ingest, sync, query, lint. |
| `facts.md` | Canonical ledger — `RESOLVED` / `CONFLICT` / `UNVERIFIED-ATTR` / `TBD`. |
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

- **The capture hook and skills** append to `inbox.md` and **nothing else**. Appending
  cannot corrupt.
- **The scaffolder** seeds each curated page — `decisions/`, `entities/`, `ideas/`,
  `facts.md`, `open-questions.md`, `glossary.md`, `index.md`, `overview.md` — with an
  empty stub once, at init, never overwriting a file that already exists.
- **The curator** (`twt-wiki-define`) is the only thing that writes *into* a curated
  page after that — the same list, now with real content.
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
- **Update, never duplicate.** Merge new information into the existing page.
- A contradiction is marked `status: needs-review` and surfaced — never silently resolved.
- Keep the wiki smaller than its source set by merging repeated knowledge into durable pages.
- Prefer `status: current` pages when answering. Treat `draft`, `needs-review`, and
  `superseded` as suspect.
