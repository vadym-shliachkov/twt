#!/usr/bin/env node
/**
 * wiki-lint - the deterministic layer of twt-wiki-validate.
 *
 * Split on the gen-preview --check pattern: everything a script can decide
 * (files, links, frontmatter, dates, table states) is decided HERE, so the
 * model layer adds only judgment (contradictions with newer sources,
 * recurring terms with no page). The script is strictly READ-ONLY: it prints
 * findings and writes nothing - the validator skill writes the report.
 *
 * Findings use the standard tiers with Where/Problem/Recommendation:
 *   BLOCKER  - the wiki misleads: dead index links, a superseded page with
 *              no successor, core machinery missing
 *   WARNING  - the wiki degrades: invalid frontmatter, dead citations,
 *              un-indexed pages, live CONFLICTs, uncaptured whys,
 *              stale-vs-source pages, an inbox nobody drains
 *   SUGGESTION - polish: missing summaries, TBD/UNVERIFIED-ATTR facts,
 *              open questions to resolve
 *
 * Usage: node tools/wiki-lint.mjs <projectDir> [--json] [--max-inbox-age-days N]
 * Exit 0 whenever the lint ran (findings are output, not errors); exit 1
 * only on usage errors / no wiki.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function fail(msg) {
  console.error(`wiki-lint: ${msg}`);
  process.exit(1);
}

const STATUSES = new Set(['draft', 'current', 'needs-review', 'resolved', 'superseded']);
const IDEA_STATUSES = new Set(['raw', 'shaped', 'scoped', 'shipped', 'dropped']);

function toPosix(p) { return String(p).split('\\').join('/'); }

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const fm = { sources: [] };
  let inSources = false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return fm;
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
    if (kv) {
      inSources = kv[1] === 'sources';
      if (!inSources) fm[kv[1]] = kv[2].trim();
      else if (kv[2].trim() && kv[2].trim() !== '[]') fm.sources.push(kv[2].trim());
    } else if (inSources) {
      const item = /^\s+-\s+(.+)$/.exec(lines[i]);
      if (item) fm.sources.push(item[1].trim());
    }
  }
  return null; // unterminated frontmatter
}

// Parse every row of a pipe table whose header contains `statusCol`, returning
// { firstCell, status } per data row. Placeholder "_..._" rows are skipped.
function tableRows(text, statusCol) {
  const lines = text.split(/\r?\n/);
  const isPipe = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const out = [];
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    if (!isPipe(lines[i])) { header = null; continue; }
    if (isSep(lines[i])) continue;
    const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (header === null && isSep(lines[i + 1] || '')) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (!header) continue;
    const si = header.findIndex((h) => h.includes(statusCol));
    if (si === -1) continue;
    const first = cells[0] || '';
    if (!first || /^_.*_$/.test(first)) continue;
    out.push({ firstCell: first, status: (cells[si] || '').trim() });
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const projectDir = args.find((a) => !a.startsWith('--'));
  if (!projectDir) fail('usage: node tools/wiki-lint.mjs <projectDir> [--json] [--max-inbox-age-days N]');
  const wiki = join(projectDir, '.project-wiki');
  if (!existsSync(wiki)) fail('no .project-wiki/ - run /twt-wiki first');
  const ageAt = args.indexOf('--max-inbox-age-days');
  const maxAgeDays = ageAt !== -1 ? Number(args[ageAt + 1]) || 7 : 7;

  const findings = [];
  const add = (tier, where, problem, recommendation) =>
    findings.push({ tier, where, problem, recommendation });

  // --- required files -------------------------------------------------------
  for (const f of ['AGENTS.md', 'index.md', 'inbox.md']) {
    if (!existsSync(join(wiki, f))) {
      add('BLOCKER', f, 'core machinery file is missing - capture or navigation is broken',
        'run /twt-wiki (the scaffolder restores missing stubs without touching existing files)');
    }
  }
  for (const f of ['overview.md', 'log.md', 'facts.md', 'open-questions.md', 'sources.md', 'glossary.md', 'raw/assets.md']) {
    if (!existsSync(join(wiki, f))) {
      add('WARNING', f, 'seeded page is missing', 'run /twt-wiki to restore the stub');
    }
  }

  // --- collection pages: frontmatter, citations, summaries, supersession ----
  const collections = ['decisions', 'ideas', 'entities', 'analyses'];
  const collectionPages = [];
  for (const dir of collections) {
    let files = [];
    try { files = readdirSync(join(wiki, dir)).filter((f) => f.endsWith('.md')).sort(); } catch (e) { continue; }
    for (const f of files) collectionPages.push(`${dir}/${f}`);
  }

  const rootPages = ['overview.md', 'facts.md', 'open-questions.md', 'sources.md', 'glossary.md']
    .filter((f) => existsSync(join(wiki, f)));

  for (const rel of [...rootPages, ...collectionPages]) {
    const abs = join(wiki, rel);
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch (e) { continue; }
    const fm = parseFrontmatter(text);
    if (!fm) {
      add('WARNING', rel, 'page has no (or unterminated) frontmatter - agents cannot weigh it by status',
        'add title/type/status/updated frontmatter per AGENTS.md');
      continue;
    }
    for (const key of ['title', 'type', 'status', 'updated']) {
      if (!fm[key]) add('WARNING', rel, `frontmatter is missing \`${key}\``, 'fill it per AGENTS.md');
    }
    if (fm.status) {
      const ok = fm.type === 'idea' ? IDEA_STATUSES.has(fm.status) : STATUSES.has(fm.status);
      if (!ok) {
        add('WARNING', rel, `status \`${fm.status}\` is not in the ${fm.type === 'idea' ? 'idea lifecycle' : 'standard'} vocabulary`,
          fm.type === 'idea' ? 'use raw|shaped|scoped|shipped|dropped' : 'use draft|current|needs-review|resolved|superseded');
      }
    }
    if (fm.updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated)) {
      add('WARNING', rel, `\`updated: ${fm.updated}\` is not YYYY-MM-DD`, 'use an ISO date');
    }

    // citations: every local sources: path must still exist (URLs are skipped)
    for (const src of fm.sources) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) continue;
      const candidates = [join(projectDir, src), join(wiki, src)];
      if (!candidates.some((c) => existsSync(c))) {
        add('WARNING', rel, `cites \`${src}\`, which does not exist`,
          'restore or re-ingest the source, or update the citation - a dead citation is unverifiable provenance');
      } else if (fm.updated && /^\d{4}-\d{2}-\d{2}$/.test(fm.updated)) {
        // staleness: the cited source changed after the page was last updated
        const hit = candidates.find((c) => existsSync(c));
        try {
          const mtime = statSync(hit).mtime.toISOString().slice(0, 10);
          if (mtime > fm.updated) {
            add('WARNING', rel, `cited source \`${src}\` changed on ${mtime}, after this page's updated date (${fm.updated})`,
              're-verify the page against the source, then bump `updated`');
          }
        } catch (e) { /* unreadable - the existence check above already passed */ }
      }
    }

    if (collectionPages.includes(rel)) {
      if (!fm.summary) {
        add('SUGGESTION', rel, 'no `summary:` in frontmatter - the index catalogs it by title alone',
          'add a one-line summary; the curator maintains these');
      }
      // a superseded page must point at its successor, and it must exist
      if (fm.status === 'superseded') {
        const m = /\*\*Superseded by:\*\*\s*(.+)/.exec(text);
        const target = m ? (/\(([^)]+)\)/.exec(m[1]) || [null, m[1].trim()])[1] : null;
        const dead = !target || /^_/.test(target)
          || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)
            && !existsSync(join(wiki, target)) && !existsSync(join(wiki, rel, '..', target)));
        if (dead) {
          add('BLOCKER', rel, 'status is `superseded` but no living successor is linked - queries dead-end here',
            'link the superseding page on the **Superseded by:** line');
        }
      }
      // a decision recorded without a reason, never resolved by a human
      if (fm.status === 'needs-review' && /_not captured/.test(text)) {
        add('WARNING', rel, 'the decision is on record but its why was never captured, and no human has resolved it',
          'ask the decision-maker for the reason, or confirm the page needs none; then set status accordingly');
      }
    }
  }

  // --- index: dead links + un-indexed pages ---------------------------------
  const indexPath = join(wiki, 'index.md');
  if (existsSync(indexPath)) {
    const indexText = readFileSync(indexPath, 'utf8');
    const linked = new Set();
    for (const m of indexText.matchAll(/\]\(([^)#]+)\)/g)) {
      const target = m[1].trim();
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) continue;
      linked.add(toPosix(target));
      if (!existsSync(join(wiki, target))) {
        add('BLOCKER', `index.md → ${target}`, 'the index links to a page that does not exist',
          'regenerate the index (tools/wiki-index.mjs via the curator) or restore the page');
      }
    }
    for (const rel of collectionPages) {
      if (!linked.has(rel)) {
        add('WARNING', rel, 'page exists but is not in index.md - agents reading outward from the index will never find it',
          'regenerate the index (tools/wiki-index.mjs via the curator)');
      }
    }
  }

  // --- facts ledger states ---------------------------------------------------
  const factsPath = join(wiki, 'facts.md');
  if (existsSync(factsPath)) {
    for (const row of tableRows(readFileSync(factsPath, 'utf8'), 'status')) {
      if (/^conflict$/i.test(row.status)) {
        add('WARNING', `facts.md → ${row.firstCell}`, 'fact is in CONFLICT - sources disagree and no human has settled it',
          'get a ruling on the canonical value, then set the row RESOLVED');
      } else if (/^tbd$/i.test(row.status)) {
        add('SUGGESTION', `facts.md → ${row.firstCell}`, 'fact is needed but absent from every source',
          'ask the client, or ingest a source that answers it');
      } else if (/^unverified-attr$/i.test(row.status)) {
        add('SUGGESTION', `facts.md → ${row.firstCell}`, 'a generic example is pinned to a named party without re-sourcing',
          're-source the attribution or unpin it');
      }
    }
  }

  // --- open questions --------------------------------------------------------
  const oqPath = join(wiki, 'open-questions.md');
  if (existsSync(oqPath)) {
    const rows = tableRows(readFileSync(oqPath, 'utf8'), 'blocked');
    if (rows.length) {
      add('SUGGESTION', 'open-questions.md', `${rows.length} question(s) still open`,
        'resolve what you can with the user, then move answers into facts/decisions');
    }
  }

  // --- inbox: entries nobody curates ------------------------------------------
  const inboxPath = join(wiki, 'inbox.md');
  if (existsSync(inboxPath)) {
    const stamps = [...readFileSync(inboxPath, 'utf8').matchAll(/^## (\d{4}-\d{2}-\d{2}T[\d:]+Z)/gm)]
      .map((m) => m[1]);
    if (stamps.length) {
      const oldest = stamps.slice().sort()[0];
      const ageDays = Math.floor((Date.now() - Date.parse(oldest)) / 86400000);
      if (ageDays > maxAgeDays) {
        add('WARNING', 'inbox.md', `${stamps.length} entr${stamps.length === 1 ? 'y' : 'ies'} pending curation; the oldest (${oldest.slice(0, 10)}) has sat ${ageDays} days`,
          'run /twt-wiki to curate - captured decisions are only useful once promoted to cited pages');
      } else {
        add('SUGGESTION', 'inbox.md', `${stamps.length} entr${stamps.length === 1 ? 'y' : 'ies'} pending curation`,
          'run /twt-wiki to curate when convenient');
      }
    }
  }

  // --- output ------------------------------------------------------------------
  const order = { BLOCKER: 0, WARNING: 1, SUGGESTION: 2 };
  findings.sort((a, b) => order[a.tier] - order[b.tier]);
  const count = (t) => findings.filter((f) => f.tier === t).length;

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      blockers: count('BLOCKER'), warnings: count('WARNING'), suggestions: count('SUGGESTION'), findings,
    }, null, 2));
    return;
  }
  for (const f of findings) {
    console.log(`[${f.tier}] ${f.where}\n  Problem: ${f.problem}\n  Recommendation: ${f.recommendation}`);
  }
  console.log(`lint: ${count('BLOCKER')} blocker(s), ${count('WARNING')} warning(s), ${count('SUGGESTION')} suggestion(s).`);
}

main();
