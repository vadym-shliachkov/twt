#!/usr/bin/env node
// split-blocks.mjs — split a markdown file into structural blocks for per-block analysis.
//
//   node split-blocks.mjs <file-path>
//   node split-blocks.mjs --self-test
//
// Output: JSON [{n, type, text}] — one object per block, 1-indexed.
// type: "Heading" | "List" | "Code" | "Blockquote" | "Paragraph"
// Exit 2 on missing/unreadable file.
'use strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');
const filePath = argv.find(a => a !== '--self-test');

function splitBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // Fenced code block
    if (/^```/.test(line)) {
      const fence = line.match(/^(`+)/)[1];
      const start = i;
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) i++;
      i++;
      blocks.push({ type: 'Code', text: lines.slice(start, i).join('\n') });
      continue;
    }
    // ATX heading
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({ type: 'Heading', text: line });
      i++;
      continue;
    }
    // Blockquote
    if (/^>/.test(line)) {
      const start = i;
      while (i < lines.length && /^>/.test(lines[i])) i++;
      blocks.push({ type: 'Blockquote', text: lines.slice(start, i).join('\n') });
      continue;
    }
    // List
    if (/^(\s*[-*+]|\s*\d+\.)\s/.test(line)) {
      const start = i;
      while (
        i < lines.length &&
        (/^(\s*[-*+]|\s*\d+\.)\s/.test(lines[i]) || (/^\s{2,}/.test(lines[i]) && lines[i].trim()))
      ) i++;
      blocks.push({ type: 'List', text: lines.slice(start, i).join('\n') });
      continue;
    }
    // Paragraph
    const start = i;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^>/.test(lines[i]) &&
      !/^(\s*[-*+]|\s*\d+\.)\s/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) { i++; }
    blocks.push({ type: 'Paragraph', text: lines.slice(start, i).join('\n') });
  }
  return blocks.map((b, idx) => ({ n: idx + 1, type: b.type, text: b.text.trim() }));
}

function run() {
  if (!filePath) { console.error('usage: split-blocks.mjs <file-path>'); process.exit(2); }
  let md;
  try { md = readFileSync(filePath, 'utf8'); } catch (e) { console.error(`Cannot read: ${filePath}`); process.exit(2); }
  console.log(JSON.stringify(splitBlocks(md), null, 2));
}

function runSelfTest() {
  const sample = [
    '# Hello World',
    '',
    'A paragraph with some text.',
    '',
    '## Sub-heading',
    '',
    '- item one',
    '- item two',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '> A blockquote',
  ].join('\n');
  const blocks = splitBlocks(sample);
  assert.equal(blocks[0].type, 'Heading');
  assert.equal(blocks[0].text, '# Hello World');
  assert.equal(blocks[1].type, 'Paragraph');
  assert.equal(blocks[2].type, 'Heading');
  assert.equal(blocks[3].type, 'List');
  assert.equal(blocks[4].type, 'Code');
  assert.equal(blocks[5].type, 'Blockquote');
  assert.equal(blocks.length, 6);
  console.log('split-blocks self-test: OK');
}

if (selfTest) runSelfTest();
else run();
