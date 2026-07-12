#!/usr/bin/env node
/**
 * wiki-drain - deterministic inbox.md rewrite for the curator.
 *
 * Draining the inbox is the single riskiest file operation in the wiki: the
 * curator must remove exactly the entries it promoted or dismissed while
 * preserving every undrained entry byte-for-byte, in order. Losing a captured
 * decision defeats the entire point of the inbox - so the rewrite is done by
 * this script, not by a model editing the file freehand.
 *
 * Contract:
 *   node tools/wiki-drain.mjs <projectDir> --list
 *       Print every inbox entry as "<n>: <heading> | <first field>" (1-based,
 *       file order). Writes nothing.
 *   node tools/wiki-drain.mjs <projectDir> --drain 1,3,4
 *       Remove exactly those entries. Everything else - the header comment and
 *       every kept entry - is preserved byte-for-byte. Indices are validated
 *       against the file as it is NOW; any invalid index aborts the whole run
 *       with exit 1 and writes nothing.
 *   node tools/wiki-drain.mjs <projectDir> --drain all
 *       Remove every entry, resetting inbox.md to just its header comment
 *       (the comment documents the entry format for the capture hook).
 *
 * Index stability: capture only ever APPENDS to inbox.md, so an entry's index
 * cannot shift between --list and --drain in the same curation pass - new
 * entries land after the highest listed index and are simply kept.
 *
 * Unlike the phase-run tools (wiki-harvest), this is curator-invoked and MUST
 * fail loudly: a bad argument exits 1 without touching the file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function fail(msg) {
  console.error(`wiki-drain: ${msg}`);
  process.exit(1);
}

// Split inbox.md into the preamble (the scaffold's header comment - its format
// example is indented, so it never matches ^## ) and one verbatim slice per
// "## " entry. Slices carry their original bytes, CRLF and all.
function parseInbox(text) {
  const re = /^## /gm;
  const starts = [];
  let m;
  while ((m = re.exec(text)) !== null) starts.push(m.index);
  const preamble = text.slice(0, starts.length ? starts[0] : text.length);
  const entries = starts.map((s, i) =>
    text.slice(s, i + 1 < starts.length ? starts[i + 1] : text.length));
  return { preamble, entries };
}

function entrySummary(entry) {
  const lines = entry.split(/\r?\n/);
  const heading = lines[0].replace(/^## /, '').trim();
  const firstField = (lines.find((l) => /^- \*\*/.test(l)) || '').trim();
  const snippet = firstField.length > 100 ? `${firstField.slice(0, 97)}...` : firstField;
  return snippet ? `${heading} | ${snippet}` : heading;
}

function main() {
  const args = process.argv.slice(2);
  const projectDir = args[0];
  if (!projectDir || projectDir.startsWith('--')) {
    fail('usage: node tools/wiki-drain.mjs <projectDir> --list | --drain <n,m,...|all>');
  }
  const inboxPath = join(projectDir, '.project-wiki', 'inbox.md');
  if (!existsSync(join(projectDir, '.project-wiki'))) fail('no .project-wiki/ - run /twt-wiki first');
  if (!existsSync(inboxPath)) fail('no inbox.md in .project-wiki/');

  const text = readFileSync(inboxPath, 'utf8');
  const { preamble, entries } = parseInbox(text);

  if (args.includes('--list')) {
    if (!entries.length) { console.log('0 entries.'); return; }
    entries.forEach((e, i) => console.log(`${i + 1}: ${entrySummary(e)}`));
    console.log(`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}.`);
    return;
  }

  const drainAt = args.indexOf('--drain');
  if (drainAt === -1) fail('pass --list or --drain <n,m,...|all>');
  const spec = args.slice(drainAt + 1).join(',');
  if (!spec) fail('--drain needs entry numbers (e.g. --drain 1,3) or "all"');

  let drainSet;
  if (spec.trim().toLowerCase() === 'all') {
    drainSet = new Set(entries.map((_, i) => i));
  } else {
    drainSet = new Set();
    for (const tok of spec.split(/[\s,]+/).filter(Boolean)) {
      if (!/^\d+$/.test(tok)) fail(`"${tok}" is not an entry number - nothing was drained`);
      const n = Number(tok);
      if (n < 1 || n > entries.length) {
        fail(`entry ${n} does not exist (inbox has ${entries.length}) - nothing was drained`);
      }
      drainSet.add(n - 1);
    }
  }

  const kept = entries.filter((_, i) => !drainSet.has(i));
  writeFileSync(inboxPath, preamble + kept.join(''), 'utf8');
  const pending = kept.length === 1 ? '1 entry' : `${kept.length} entries`;
  console.log(`drained ${drainSet.size}, kept ${kept.length}. inbox now has ${pending} pending curation.`);
}

main();
