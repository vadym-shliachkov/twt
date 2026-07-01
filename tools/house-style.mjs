#!/usr/bin/env node
// house-style.mjs — single read point for templates/house-style.css (the
// canonical doc-hub-light look). Generators import readHouseCss() and inline
// the result before their own component <style>.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(HERE, '..', 'templates', 'house-style.css');

export function readHouseCss() {
  return readFileSync(CSS_PATH, 'utf8');
}

if (process.argv.includes('--self-test')) {
  const css = readHouseCss();
  assert.match(css, /--hs-ink:\s*#090e22/, 'must define --hs-ink #090e22');
  assert.match(css, /--hs-accent-blue:\s*#0b68b7/, 'must define --hs-accent-blue');
  assert.match(css, /--hs-font-heading:\s*Montserrat/, 'must define --hs-font-heading');
  assert.match(css, /\.hs-accent-bar/, 'must define the .hs-accent-bar utility');
  assert.ok(css.length > 400, 'stylesheet looks too short');
  console.log('house-style self-test: OK');
}
