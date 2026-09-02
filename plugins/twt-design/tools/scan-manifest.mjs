#!/usr/bin/env node
// scan-manifest.mjs — extract asset references from HTML/CSS/MD files under a directory.
//
//   node scan-manifest.mjs <dir>
//   node scan-manifest.mjs --self-test
//
// Output: JSON [{file, src, type, resolved, exists}]
//   type: "img" | "video" | "css-bg" | "md-img" | "link-resource"
//   resolved: absolute path for local src, null for external URLs
//   exists: true/false for local, null for external URL
// Exit 2 on bad usage.
'use strict';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { strict as assert } from 'node:assert';

const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');
const dir = argv.find(a => a !== '--self-test');

function listFiles(d, exts) {
  const out = [];
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some(x => e.name.toLowerCase().endsWith(x))) out.push(p);
  }
  return out;
}

function isExternal(src) { return /^https?:\/\//i.test(src) || /^\/\//.test(src); }
function isDataUri(src) { return /^data:/i.test(src); }

function resolveRef(src, fromFile) {
  if (isExternal(src) || isDataUri(src) || !src) return null;
  if (src.startsWith('/')) return resolve(src);
  return resolve(dirname(fromFile), src);
}

function scanFile(filePath) {
  const refs = [];
  const content = readFileSync(filePath, 'utf8');

  if (filePath.endsWith('.html')) {
    for (const m of content.matchAll(/<img[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi))
      refs.push({ file: filePath, src: m[1], type: 'img' });
    for (const m of content.matchAll(/<(?:video|source)[^>]+\bsrc\s*=\s*["']([^"']+)["']/gi))
      refs.push({ file: filePath, src: m[1], type: 'video' });
    for (const m of content.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["'](?!stylesheet)([^"']+)["']/gi))
      refs.push({ file: filePath, src: m[1], type: 'link-resource' });
  }

  if (filePath.endsWith('.css') || filePath.endsWith('.html')) {
    for (const m of content.matchAll(/background(?:-image)?\s*:[^;]*url\(\s*["']?([^"')]+)["']?\s*\)/gi))
      refs.push({ file: filePath, src: m[1].trim(), type: 'css-bg' });
  }

  if (filePath.endsWith('.md')) {
    for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g))
      refs.push({ file: filePath, src: m[1].trim(), type: 'md-img' });
  }

  return refs.map(r => {
    const resolved = resolveRef(r.src, r.file);
    const exists = resolved ? existsSync(resolved) : (isExternal(r.src) ? null : false);
    return { ...r, resolved, exists };
  });
}

function run() {
  if (!dir) { console.error('usage: scan-manifest.mjs <dir>'); process.exit(2); }
  const files = [
    ...listFiles(dir, ['.html']),
    ...listFiles(dir, ['.css']),
    ...listFiles(dir, ['.md']),
  ];
  const results = files.flatMap(f => { try { return scanFile(f); } catch { return []; } });
  const seen = new Set();
  const deduped = results.filter(r => {
    const k = `${r.file}|${r.src}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(JSON.stringify(deduped, null, 2));
}

function runSelfTest() {
  const tmp = join((process.env.TEMP || process.env.TMPDIR || '/tmp'), 'scan-manifest-test-' + Date.now());
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'page.html'), `
    <img src="assets/hero.jpg">
    <video src="video/intro.mp4">
    <style>body { background-image: url('bg.png'); }</style>
  `);
  writeFileSync(join(tmp, 'doc.md'), '![logo](logo.svg)\n');

  const refs = [
    ...scanFile(join(tmp, 'page.html')),
    ...scanFile(join(tmp, 'doc.md')),
  ];
  const types = refs.map(r => r.type);
  assert(types.includes('img'), 'img type missing');
  assert(types.includes('video'), 'video type missing');
  assert(types.includes('css-bg'), 'css-bg type missing');
  assert(types.includes('md-img'), 'md-img type missing');
  console.log('scan-manifest self-test: OK');
}

if (selfTest) runSelfTest();
else run();
