#!/usr/bin/env node
// score-rubric.mjs — compute weighted rubric health given LLM-scored criteria.
//
//   node score-rubric.mjs '[{"criterion":"X","weight":25,"score":4},...]'
//   node score-rubric.mjs --max 100 '[...]'   # 0-100 % audit metrics
//   node score-rubric.mjs --self-test
//
// Output: JSON { rows:[{criterion,weight,score,weighted}], health, band, max_score }
// Exit 0 always; exit 2 on bad usage.
'use strict';
import { strict as assert } from 'node:assert';

const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');
const maxIdx = argv.indexOf('--max');
const maxScore = maxIdx !== -1 ? Number(argv[maxIdx + 1]) : 5;
const rest = argv.filter((_, i) => i !== maxIdx && (maxIdx === -1 || i !== maxIdx + 1) && argv[i] !== '--self-test');
const jsonArg = rest[0];

function compute(criteria, max) {
  const rows = criteria.map(c => ({
    criterion: c.criterion,
    weight: c.weight,
    score: c.score,
    weighted: Math.round(c.weight * c.score / max * 10) / 10,
  }));
  const health = Math.round(rows.reduce((s, r) => s + r.weighted, 0) * 10) / 10;
  const band = health >= 80 ? 'Pass' : health >= 50 ? 'Revise' : 'Fail';
  return { rows, health, band, max_score: max };
}

function run() {
  if (!jsonArg) {
    console.error("usage: score-rubric.mjs [--max N] '[{criterion,weight,score},...]'");
    process.exit(2);
  }
  let criteria;
  try { criteria = JSON.parse(jsonArg); } catch (e) { console.error('Invalid JSON:', e.message); process.exit(2); }
  if (!Array.isArray(criteria)) { console.error('Expected a JSON array'); process.exit(2); }
  console.log(JSON.stringify(compute(criteria, maxScore), null, 2));
}

function runSelfTest() {
  // 0-5 scale: weights 25+20+20+20+15=100
  const r5 = compute([
    { criterion: 'A', weight: 25, score: 4 },
    { criterion: 'B', weight: 20, score: 5 },
    { criterion: 'C', weight: 20, score: 3 },
    { criterion: 'D', weight: 20, score: 4 },
    { criterion: 'E', weight: 15, score: 5 },
  ], 5);
  assert.equal(r5.rows[0].weighted, 20);   // 25*4/5
  assert.equal(r5.rows[1].weighted, 20);   // 20*5/5
  assert.equal(r5.rows[2].weighted, 12);   // 20*3/5
  assert.equal(r5.rows[3].weighted, 16);   // 20*4/5
  assert.equal(r5.rows[4].weighted, 15);   // 15*5/5
  assert.equal(r5.health, 83);
  assert.equal(r5.band, 'Pass');

  // 0-100 % scale
  const r100 = compute([
    { criterion: 'X', weight: 50, score: 40 },
    { criterion: 'Y', weight: 50, score: 70 },
  ], 100);
  assert.equal(r100.rows[0].weighted, 20);  // 50*40/100
  assert.equal(r100.rows[1].weighted, 35);
  assert.equal(r100.health, 55);
  assert.equal(r100.band, 'Revise');

  // Fail band (health 20)
  const rf = compute([{ criterion: 'Z', weight: 100, score: 1 }], 5);
  assert.equal(rf.band, 'Fail');

  console.log('score-rubric self-test: OK');
}

if (selfTest) runSelfTest();
else run();
