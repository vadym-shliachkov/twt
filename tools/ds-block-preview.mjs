#!/usr/bin/env node
// ds-block-preview.mjs — playwright screenshot of an HTML file or URL.
//
// Takes a full-page screenshot, or a cropped screenshot of one CSS-selector
// element. Used standalone or called by other audit tools.
//
// Usage:
//   node ds-block-preview.mjs --file <path> --out <path.png> [options]
//   node ds-block-preview.mjs --url  <url>  --out <path.png> [options]
//
// Options:
//   --file <path>      Local HTML file to open (converted to file:// URL)
//   --url  <url>       Remote URL to open
//   --out  <path>      Output PNG path (required)
//   --selector <css>   CSS selector — screenshot just this element.
//                      Omit to screenshot the full page.
//   --width  <n>       Viewport width  (default: 1280)
//   --height <n>       Viewport height (default: 900)
//   --full-page        Full-page screenshot even when selector is omitted
//                      (default: true when no selector)
//   --wait <ms>        Extra wait after load before screenshotting (default: 0)
//
// Requires:  npm install playwright  +  npx playwright install chromium
//
// IMPORTANT — this needs the npm `playwright` package, NOT the Claude Code
// playwright MCP plugin.  The MCP plugin provides browser tools for Claude
// itself; Node.js scripts like this one need the separate npm package.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
}

const file = flags.file ? path.resolve(String(flags.file)) : null;
const urlArg = flags.url ? String(flags.url) : null;
const outPath = flags.out ? path.resolve(String(flags.out)) : null;
const selector = flags.selector ? String(flags.selector) : null;
const width = Math.max(320, parseInt(flags.width || '1280', 10) || 1280);
const height = Math.max(320, parseInt(flags.height || '900', 10) || 900);
const extraWait = parseInt(flags.wait || '0', 10) || 0;
const fullPage = flags['full-page'] === true || !selector;

if (!file && !urlArg) {
  console.error('ds-block-preview: --file or --url is required');
  process.exit(1);
}
if (!outPath) {
  console.error('ds-block-preview: --out is required');
  process.exit(1);
}

const target = file ? pathToFileURL(file).href : urlArg;

let pw;
try {
  pw = await import('playwright');
} catch {
  console.error([
    'ds-block-preview: playwright npm package not installed.',
    'Install it with:',
    '  npm install playwright',
    '  npx playwright install chromium',
    '',
    'Note: the Claude Code playwright MCP plugin gives Claude browser-automation',
    'tools but is NOT the npm package that Node.js scripts need.',
  ].join('\n'));
  process.exit(2);
}

let browser;
try {
  browser = await pw.chromium.launch();
} catch (e) {
  console.error('ds-block-preview: chromium launch failed — ' + (e && e.message));
  process.exit(2);
}

try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
  if (extraWait > 0) await page.waitForTimeout(extraWait);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (selector) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 6000 });
    await loc.screenshot({ path: outPath });
    console.log('ds-block-preview: element "' + selector + '" → ' + outPath);
  } else {
    await page.screenshot({ path: outPath, fullPage });
    console.log('ds-block-preview: ' + (fullPage ? 'full-page' : 'viewport') + ' → ' + outPath);
  }
} catch (e) {
  console.error('ds-block-preview: screenshot failed — ' + (e && e.message));
  process.exit(3);
} finally {
  await browser.close().catch(() => {});
}
