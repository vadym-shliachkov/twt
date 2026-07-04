#!/usr/bin/env node
// house-style.mjs — read point for the shared doc-hub-light CSS, now living inside
// the built-in export theme (templates/themes/doc-hub-light/css/). Consumers call
// readCss(name) / readHouseCss() and inline the result before their own <style>.
// Name mapping keeps the old call sites working: house-style.css → tokens.css,
// house-doc.css → doc.css, house-slide.css → slide.css.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_CSS = join(HERE, '..', 'templates', 'themes', 'doc-hub-light', 'css');
const NAME_MAP = { 'house-style.css': 'tokens.css', 'house-doc.css': 'doc.css', 'house-slide.css': 'slide.css' };

export function readCss(name) {
  return readFileSync(join(THEME_CSS, NAME_MAP[name] || name), 'utf8');
}
export function readHouseCss() { return readCss('house-style.css'); }

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const css = readHouseCss();
  assert.match(css, /--hs-ink:\s*#090e22/, 'must define --hs-ink #090e22');
  assert.match(css, /--hs-accent-blue:\s*#0b68b7/, 'must define --hs-accent-blue');
  assert.match(css, /--hs-font-heading:\s*Montserrat/, 'must define --hs-font-heading');
  assert.match(css, /\.hs-accent-bar/, 'must define the .hs-accent-bar utility');
  assert.ok(css.length > 400, 'stylesheet looks too short');
  assert.match(readCss('house-doc.css'), /@page/, 'doc layer must define @page');
  assert.match(readCss('house-slide.css'), /\.slide/, 'slide layer must define .slide');
  console.log('house-style self-test: OK');
}
