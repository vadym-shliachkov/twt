// criteria.mjs — parse and hash the durable criteria file for a skill under test.
//
// The hash is the freeze: iterations 2..N re-verify it and abort on drift, so a
// fixer cannot soften the rubric it is being graded against mid-run (spec §4.3).
import { createHash } from 'node:crypto';

const HEADING = /^###\s+(C-\d{3})\s+·\s+([\w-]+)\s+·\s+(.+?)\s*$/;
const SELF_DECLARED = /^\s*-\s+\*\*self-declared:\*\*\s*(yes|no)\s*$/;
const FIXTURE = /^\s*-\s+\*\*fixture:\*\*\s*(\S+)\s*$/;

function bail(msg) {
  const e = new Error(`skill-test: ${msg}`);
  e.exitCode = 2;
  throw e;
}

export function parseCriteria(md) {
  const out = [];
  const seen = new Set();
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(HEADING);
    if (h) {
      const [, id, dimension, title] = h;
      if (seen.has(id)) bail(`duplicate criterion id ${id} — ids are stable and never reused`);
      seen.add(id);
      cur = { id, dimension, title, selfDeclared: false, fixture: 'happy' };
      out.push(cur);
      continue;
    }
    // Detect malformed headings: lines attempting to be criterion headings but not matching HEADING
    if (line.match(/^###\s+C-/)) {
      bail(`malformed criterion heading: ${line}`);
    }
    if (!cur) continue;
    const sd = line.match(SELF_DECLARED);
    if (sd) { cur.selfDeclared = sd[1] === 'yes'; continue; }
    const fx = line.match(FIXTURE);
    if (fx) cur.fixture = fx[1];
  }
  return out;
}

export function selfDeclaredIds(list) {
  return list.filter(c => c.selfDeclared).map(c => c.id);
}

// CRLF-normalized: this repo is developed on Windows, and a checkout that
// rewrites line endings must not read as criteria drift (a false exit 4).
export function criteriaHash(md) {
  return 'sha256:' + createHash('sha256').update(md.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
