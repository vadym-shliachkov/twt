#!/usr/bin/env node
// check-io.mjs — cross-skill I/O consistency linter (CI gate).
//
// Builds the producer/consumer graph from every skill's frontmatter `reads:` /
// `writes:` lists and fails when a path some skill READS is WRITTEN by no
// skill. That is exactly the failure mode of the component-catalog split
// (twt-component-define wrote design-system/component/ while five consumers
// read the dead design/component/ path) — which lived for weeks because the
// declared contract was never machine-checked.
//
// Scope: the shared artifact namespaces (.twt-artifacts/, .project-wiki/).
// Build-target paths (site/, <THEME>/, wp-content/), repo files, and prose
// entries are out of scope — their contracts are with the filesystem, not
// between skills.
//
// Matching: placeholders (`<page-slug>`, `<domain>`, …) are single-segment
// wildcards; `<a|b>` alternations expand; a write of a directory (or any file
// beneath it) satisfies a read of that directory, and vice versa — overlap at
// segment level is enough. Errors carry a same-basename hint ("did you mean")
// so a renamed path points at its likely survivor.
//
// Usage: node tools/check-io.mjs [--verbose] [--self-test]
//   --verbose also lists writes that no skill reads (informational — many are
//   for humans or downstream tooling, so they never fail the build).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES = ['.twt-artifacts/', '.project-wiki/'];

// Reads with intentionally no in-repo writer. Keep this SHORT and justified —
// every entry is a hole in the check.
const ALLOW_UNWRITTEN = [
  // (none currently)
];

export function parseIo(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { reads: [], writes: [] };
  const out = { reads: [], writes: [] };
  let section = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    if (/^reads:\s*$/.test(line)) { section = 'reads'; continue; }
    if (/^writes:\s*$/.test(line)) { section = 'writes'; continue; }
    if (/^\S/.test(line)) { section = null; continue; }
    if (!section) continue;
    const m = /^\s+-\s+(.+)$/.exec(line);
    if (!m) continue;
    // strip trailing comments and whitespace; keep the raw path
    const raw = m[1].replace(/\s+#.*$/, '').trim();
    out[section].push(raw);
  }
  return out;
}

// `<a|b>` alternation → one path per branch; other `<placeholder>` → `*`.
export function normalizePath(raw) {
  const alt = /<([^<>]*\|[^<>]*)>/.exec(raw);
  if (alt) {
    return alt[1].split('|')
      .flatMap((branch) => normalizePath(raw.replace(alt[0], branch.trim())));
  }
  return [raw.replace(/<[^<>]+>/g, '*').replace(/\/+$/, '')];
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function segMatch(a, b) {
  if (a === '*' || b === '*') return true;
  if (a.includes('*') || b.includes('*')) {
    const rx = (s) => new RegExp('^' + s.split('*').map(escRe).join('[^/]*') + '$');
    return rx(a).test(b) || rx(b).test(a);
  }
  return a === b;
}

// Two paths overlap when every shared segment matches — a write of a dir (or
// of a file beneath it) covers a read of that dir, and vice versa.
export function covers(a, b) {
  const A = a.split('/'); const B = b.split('/');
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) if (!segMatch(A[i], B[i])) return false;
  return true;
}

function collect() {
  const entries = { reads: [], writes: [] }; // { path, skill }
  const files = [];
  for (const f of readdirSync(join(ROOT, 'commands'))) {
    if (f.endsWith('.md') && f !== 'README.md') files.push({ id: `commands/${f}`, p: join(ROOT, 'commands', f) });
  }
  for (const d of readdirSync(join(ROOT, 'skills'))) {
    files.push({ id: `skills/${d}`, p: join(ROOT, 'skills', d, 'SKILL.md') });
  }
  for (const { id, p } of files) {
    let text;
    try { text = readFileSync(p, 'utf8'); } catch (e) { continue; }
    const io = parseIo(text);
    for (const kind of ['reads', 'writes']) {
      for (const raw of io[kind]) {
        if (!SCOPES.some((s) => raw.startsWith(s))) continue;
        for (const path of normalizePath(raw)) entries[kind].push({ path, skill: id });
      }
    }
  }
  return entries;
}

function main() {
  const { reads, writes } = collect();
  const errors = [];
  for (const r of reads) {
    if (ALLOW_UNWRITTEN.includes(r.path)) continue;
    if (writes.some((w) => covers(w.path, r.path))) continue;
    const base = r.path.split('/').pop();
    const hints = [...new Set(writes.filter((w) => segMatch(w.path.split('/').pop(), base))
      .map((w) => `${w.path} (written by ${w.skill})`))].slice(0, 3);
    errors.push(`READ WITHOUT WRITER: ${r.skill} reads \`${r.path}\` but no skill writes it`
      + (hints.length ? `\n  did you mean: ${hints.join(' · ')}` : ''));
  }

  if (process.argv.includes('--verbose')) {
    const unread = writes.filter((w) => !reads.some((r) => covers(r.path, w.path)));
    for (const w of [...new Map(unread.map((u) => [u.path, u])).values()]) {
      console.log(`info: write nobody reads: ${w.path} (${w.skill})`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(`check-io: ${errors.length} error(s) — the declared I/O contract is broken.`);
    process.exit(1);
  }
  console.log(`check-io: OK — ${reads.length} reads all covered by ${writes.length} writes.`);
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const io = parseIo('---\nname: x\nreads:\n  - .twt-artifacts/a/b.md\n  - references/skip.md # not in scope, still parsed\nwrites:\n  - .twt-artifacts/a/c.md  # comment stripped\n---\nbody');
  assert.deepEqual(io.reads, ['.twt-artifacts/a/b.md', 'references/skip.md']);
  assert.deepEqual(io.writes, ['.twt-artifacts/a/c.md']);
  assert.deepEqual(normalizePath('.twt-artifacts/<html-site|elementor-theme>/phase-review.md'),
    ['.twt-artifacts/html-site/phase-review.md', '.twt-artifacts/elementor-theme/phase-review.md']);
  assert.deepEqual(normalizePath('.twt-artifacts/x/<page-slug>.md'), ['.twt-artifacts/x/*.md']);
  assert.deepEqual(normalizePath('.project-wiki/decisions/'), ['.project-wiki/decisions']);
  assert.ok(covers('.twt-artifacts/design', '.twt-artifacts/design/layout/x.md'), 'dir write covers file read beneath');
  assert.ok(covers('.twt-artifacts/a/*.md', '.twt-artifacts/a/foo.md'), 'wildcard segment matches');
  assert.ok(covers('.twt-artifacts/a/search-report-*.md', '.twt-artifacts/a/search-report-foo.md'), 'in-segment wildcard matches');
  assert.equal(covers('.twt-artifacts/design/component/x.md', '.twt-artifacts/design/design-system/component/x.md'), false,
    'sibling-dir near-miss does NOT cover — the component-split class of bug');
  console.log('check-io self-test: OK');
} else if (_isMain) {
  main();
}
