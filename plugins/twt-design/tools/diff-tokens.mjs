#!/usr/bin/env node
// diff-tokens.mjs — diff two CSS custom-property files and report changes.
//
//   node diff-tokens.mjs <baseline.css> <new.css>
//   node diff-tokens.mjs --self-test
//
// Output: JSON {added:[{name,value}], changed:[{name,old,new}], removed:[{name,value}], unchanged_count}
// Exit 2 on bad usage or missing files.
'use strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');
const [baseline, next] = argv.filter(a => a !== '--self-test');

function parseTokens(css) {
  const map = new Map();
  for (const m of css.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;{}]+?)\s*;/g)) {
    map.set('--' + m[1], m[2].trim());
  }
  return map;
}

function diffTokens(baselineMap, newMap) {
  const added = [], changed = [], removed = [];
  let unchanged_count = 0;
  for (const [name, value] of newMap) {
    if (!baselineMap.has(name)) added.push({ name, value });
    else if (baselineMap.get(name) !== value) changed.push({ name, old: baselineMap.get(name), new: value });
    else unchanged_count++;
  }
  for (const [name, value] of baselineMap) {
    if (!newMap.has(name)) removed.push({ name, value });
  }
  return { added, changed, removed, unchanged_count };
}

function run() {
  if (!baseline || !next) { console.error('usage: diff-tokens.mjs <baseline.css> <new.css>'); process.exit(2); }
  let a, b;
  try { a = readFileSync(baseline, 'utf8'); } catch { console.error(`Cannot read: ${baseline}`); process.exit(2); }
  try { b = readFileSync(next, 'utf8'); } catch { console.error(`Cannot read: ${next}`); process.exit(2); }
  console.log(JSON.stringify(diffTokens(parseTokens(a), parseTokens(b)), null, 2));
}

function runSelfTest() {
  const tmp = join((process.env.TEMP || process.env.TMPDIR || '/tmp'), 'diff-tokens-test-' + Date.now());
  mkdirSync(tmp, { recursive: true });
  const base = ':root {\n  --color-primary: #1234ab;\n  --color-bg: #ffffff;\n  --space-sm: 8px;\n}\n';
  const next = ':root {\n  --color-primary: #0066ff;\n  --color-bg: #ffffff;\n  --space-lg: 24px;\n}\n';
  writeFileSync(join(tmp, 'base.css'), base);
  writeFileSync(join(tmp, 'next.css'), next);
  const result = diffTokens(parseTokens(base), parseTokens(next));
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].name, '--space-lg');
  assert.equal(result.changed.length, 1);
  assert.equal(result.changed[0].name, '--color-primary');
  assert.equal(result.changed[0].old, '#1234ab');
  assert.equal(result.changed[0].new, '#0066ff');
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].name, '--space-sm');
  assert.equal(result.unchanged_count, 1);
  console.log('diff-tokens self-test: OK');
}

if (selfTest) runSelfTest();
else run();
