#!/usr/bin/env node
// check-token-refs.mjs — token-name consistency sweep (design-system Step 10d).
//
// twt-design-system-define used to have the MODEL Grep tokens.md/decisions.md
// for every `--token-name` and cross-check each against tokens.css by hand —
// a fully deterministic job. A documented name no token implements sends
// downstream authors hunting for something that doesn't exist; this script
// finds every such reference in one pass.
//
//   node check-token-refs.mjs <tokens.css> <file.md> [more.md ...]
//
// Rules:
// - A "token reference" is `--word-word[...]` with at least TWO segments
//   (`--color-primary`, `--space-4`) — single-segment matches (`--file`,
//   `--check`) are almost always CLI flags in prose, so they are ignored.
// - A trailing-wildcard mention (`--icon-size-*`) is a family reference:
//   satisfied when any defined token starts with that prefix.
// - Unknown references get a nearest-name hint (same tail segment, or the
//   closest defined name by shared prefix).
//
// Output: one summary line + a ```json block { defined, files, unknown[] }.
// Exit 0 when every reference resolves, 1 when any is unknown, 2 on usage error.
'use strict';

import { readFileSync, existsSync } from 'node:fs';

const [cssPath, ...mdPaths] = process.argv.slice(2);
if (!cssPath || mdPaths.length === 0) {
  console.error('usage: check-token-refs.mjs <tokens.css> <file.md> [more.md ...]');
  process.exit(2);
}
if (!existsSync(cssPath)) { console.error(`tokens.css not found: ${cssPath}`); process.exit(2); }

// Every custom property DEFINED in tokens.css (declaration position, not var() use).
const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
const defined = new Set();
for (const m of css.matchAll(/(--[a-z0-9][a-z0-9-]*)\s*:/gi)) defined.add(m[1].toLowerCase());

const REF = /--([a-z0-9]+(?:-[a-z0-9*]+)+)/gi; // two+ segments; * allowed for family refs
const unknown = [];
let refCount = 0;

function hint(name) {
  const tail = name.split('-').pop();
  const sameTail = [...defined].filter((d) => d.endsWith(`-${tail}`));
  if (sameTail.length) return `did you mean ${sameTail.slice(0, 3).join(' / ')}?`;
  let best = null, bestLen = 0;
  for (const d of defined) {
    let i = 0;
    while (i < Math.min(d.length, name.length) && d[i] === name[i]) i++;
    if (i > bestLen) { bestLen = i; best = d; }
  }
  return best && bestLen > 4 ? `closest defined: ${best}` : 'no similar token defined';
}

for (const p of mdPaths) {
  if (!existsSync(p)) { console.error(`file not found: ${p}`); process.exit(2); }
  const text = readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/);
  const seen = new Set(); // dedupe per file+name so one rename isn't 14 findings
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(REF)) {
      const name = `--${m[1].toLowerCase()}`;
      refCount++;
      let ok;
      if (name.endsWith('-*')) {
        const prefix = name.slice(0, -1); // keep the trailing hyphen
        ok = [...defined].some((d) => d.startsWith(prefix));
      } else {
        ok = defined.has(name);
      }
      if (!ok && !seen.has(name)) {
        seen.add(name);
        unknown.push({ name, file: p, line: i + 1, hint: hint(name) });
      }
    }
  }
}

console.log(`check-token-refs: ${defined.size} tokens defined, ${refCount} reference(s) scanned, ${unknown.length} unknown name(s)`);
console.log('```json');
console.log(JSON.stringify({ defined: defined.size, files: mdPaths, unknown }, null, 2));
console.log('```');
process.exit(unknown.length ? 1 : 0);
