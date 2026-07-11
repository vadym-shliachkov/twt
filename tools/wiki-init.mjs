#!/usr/bin/env node
/**
 * wiki-init - scaffold .project-wiki/ in a target project.
 *
 * Idempotent: never overwrites an existing file. Safe to re-run.
 * Usage: node tools/wiki-init.mjs <projectDir> [--name "Project Name"]
 */
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const args = process.argv.slice(2);
const projectDir = args[0];
if (!projectDir) {
  console.error('usage: node tools/wiki-init.mjs <projectDir> [--name "Project Name"]');
  process.exit(1);
}
const nameIdx = args.indexOf('--name');
const projectName = nameIdx !== -1 ? (args[nameIdx + 1] || 'Untitled project') : 'Untitled project';

const WIKI = join(projectDir, '.project-wiki');
const today = new Date().toISOString().slice(0, 10);

const fm = (title, type, status = 'current') =>
  `---\ntitle: ${title}\ntype: ${type}\nstatus: ${status}\nupdated: ${today}\nsources: []\ntags: []\n---\n\n`;

/** Write a file only if it is absent. Report what happened. */
function put(relPath, content) {
  const abs = join(WIKI, relPath);
  const logPath = relPath.split(/[\\/]/).join('/'); // always forward slashes in printed lines, even on Windows
  mkdirSync(dirname(abs), { recursive: true });
  if (existsSync(abs)) { console.log(`exists: .project-wiki/${logPath}`); return; }
  writeFileSync(abs, content, 'utf8');
  console.log(`created: .project-wiki/${logPath}`);
}

// AGENTS.md is copied verbatim from the canonical manual.
const agentsSrc = join(ROOT, 'templates', 'wiki', 'AGENTS.md');
const agentsDst = join(WIKI, 'AGENTS.md');
mkdirSync(WIKI, { recursive: true });
if (existsSync(agentsDst)) {
  console.log('exists: .project-wiki/AGENTS.md');
} else if (existsSync(agentsSrc)) {
  copyFileSync(agentsSrc, agentsDst);
  console.log('created: .project-wiki/AGENTS.md');
} else {
  console.error(`FATAL: canonical manual not found at ${agentsSrc}`);
  process.exit(1);
}

put('index.md', fm('Index', 'overview') +
`# Index

The catalog of this wiki. Start here.

## Core
- [Overview](overview.md) - the project in one page
- [Facts](facts.md) - the canonical ledger
- [Open questions](open-questions.md) - what is still unresolved
- [Sources](sources.md) - all evidence
- [Glossary](glossary.md) - terms and banned words

## Collections
- \`decisions/\` - what was decided, and why (0 pages)
- \`ideas/\` - ideas not yet scoped (0 pages)
- \`entities/\` - client, audience, competitors (0 pages)
- \`analyses/\` - saved answers worth keeping (0 pages)

## Machinery
- [Inbox](inbox.md) - raw captured decisions, awaiting curation
- [Log](log.md) - append-only history
- [Operating manual](AGENTS.md) - how to maintain this wiki
`);

put('overview.md', fm(projectName, 'overview', 'draft') +
`# ${projectName}

**What it is:** _not yet described - run /twt-wiki to fill this in._

**Who it is for:** _unknown._

**Where it stands:** wiki initialized ${today}. Nothing curated yet.
`);

put('inbox.md',
`<!-- APPEND-ONLY. Written by the capture hook and by twt skills. Drained by /twt-wiki
     (twt-wiki-define). Do not edit or reorder by hand; do not delete undrained entries.
     Entry format:

     ## <ISO-8601 UTC> · decision|reason · <source>
     - **question:** ...
     - **options:** a | b
     - **chosen:** a

     The separator is a middle dot (U+00B7), not a hyphen - it is what the
     capture hook emits and what the curator parses. Do not "correct" it.
-->
`);

put('log.md', fm('Log', 'report') +
`# Log

Append-only. One entry per ingest, curation, query, or lint.

## ${today} — init
Wiki initialized.
`);

put('facts.md', fm('Facts', 'concept') +
`# Facts

The canonical ledger. Every reusable fact, its canonical value, its sources, and its status.

| Fact | Canonical value | Status | Sources |
|---|---|---|---|
| _none yet_ | | | |

**Statuses:** \`RESOLVED\` (sources agree, or only one source) - \`CONFLICT\` (sources
disagree; canonical is TBD, never silently picked) - \`UNVERIFIED-ATTR\` (a generic
example pinned to a named party) - \`TBD\` (needed, absent from every source).
`);

put('open-questions.md', fm('Open questions', 'question') +
`# Open questions

Unresolved: live \`CONFLICT\` facts, un-overruled blockers, unanswered asks.

| Question | Why it matters | Blocked | Raised |
|---|---|---|---|
| _none yet_ | | | |
`);

put('glossary.md', fm('Glossary', 'concept') +
`# Glossary

## Terms
| Term | Means |
|---|---|
| _none yet_ | |

## Banned words
Words this project must never use, and what to say instead.

| Never say | Say instead | Why |
|---|---|---|
| _none yet_ | | |
`);

put('sources.md', fm('Sources', 'source') +
`# Sources

Every piece of evidence this wiki cites. Artifacts are **linked, never copied**.

| Source | Kind | Where | Ingested |
|---|---|---|---|
| _none yet_ | | | |
`);

put('raw/assets.md', fm('Assets', 'asset') +
`# Assets

Binaries held in \`raw/assets/\`: logos, photography, brand books.

| File | What it is | Provenance | Usage constraints |
|---|---|---|---|
| _none yet_ | | | |
`);

for (const d of ['decisions', 'ideas', 'entities', 'analyses', 'raw/assets', 'raw/meetings', 'reports/lint']) {
  put(join(d, '.gitkeep'), '');
}

console.log(`\nWiki ready at ${WIKI}`);
