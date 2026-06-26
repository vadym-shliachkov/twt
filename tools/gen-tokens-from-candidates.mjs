#!/usr/bin/env node
// gen-tokens-from-candidates.mjs — deduplicate and categorize raw CSS variable declarations.
//
//   node gen-tokens-from-candidates.mjs <input.css>
//   node gen-tokens-from-candidates.mjs --self-test
//
// Input: CSS file with --name: value; declarations (may have duplicates).
// Output: JSON {color, type, space, radius, shadow, motion, other} — each [{name,value}], deduped + sorted.
// Last value wins for the same name (dedup).
'use strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');
const inputFile = argv.find(a => a !== '--self-test');

const GROUP_RULES = [
  ['color',  /color|bg|background|surface|text|border|accent|fill|stroke|icon/i],
  ['type',   /font|type|size|weight|line.height|letter|tracking|leading/i],
  ['space',  /space|gap|pad|margin|inset|offset/i],
  ['radius', /radius|rounded|corner/i],
  ['shadow', /shadow|elevation/i],
  ['motion', /duration|easing|transition|motion|delay|animation/i],
];

function categorize(name) {
  const n = name.toLowerCase();
  for (const [cat, re] of GROUP_RULES) if (re.test(n)) return cat;
  return 'other';
}

function normalizeName(raw) {
  let n = raw.trim();
  if (!n.startsWith('--')) n = '--' + n;
  return n.replace(/-{3,}/g, '--').replace(/[^a-zA-Z0-9-]/g, '-');
}

function processTokens(css) {
  const seen = new Map();
  for (const m of css.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+?)\s*;/g)) {
    const name = normalizeName('--' + m[1]);
    seen.set(name, m[2].trim());
  }
  const groups = { color: [], type: [], space: [], radius: [], shadow: [], motion: [], other: [] };
  for (const [name, value] of seen) {
    groups[categorize(name)].push({ name, value });
  }
  for (const g of Object.values(groups)) g.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

function run() {
  if (!inputFile) { console.error('usage: gen-tokens-from-candidates.mjs <input.css>'); process.exit(2); }
  let css;
  try { css = readFileSync(inputFile, 'utf8'); } catch { console.error(`Cannot read: ${inputFile}`); process.exit(2); }
  console.log(JSON.stringify(processTokens(css), null, 2));
}

function runSelfTest() {
  const sample = `
    :root {
      --color-primary: #0066ff;
      --color-bg: #ffffff;
      --color-primary: #1234ab;
      --type-scale-base: 1rem;
      --space-sm: 8px;
      --radius-md: 6px;
      --shadow-card: 0 2px 8px rgba(0,0,0,.1);
      --motion-duration-fast: 150ms;
      --border-width: 1px;
    }
  `;
  const result = processTokens(sample);
  assert.equal(result.color.find(t => t.name === '--color-primary')?.value, '#1234ab');
  assert.equal(result.type.length, 1);
  assert.equal(result.space.length, 1);
  assert.equal(result.radius.length, 1);
  assert.equal(result.shadow.length, 1);
  assert.equal(result.motion.length, 1);
  assert(result.color.some(t => t.name === '--border-width'));
  console.log('gen-tokens-from-candidates self-test: OK');
}

if (selfTest) runSelfTest();
else run();
