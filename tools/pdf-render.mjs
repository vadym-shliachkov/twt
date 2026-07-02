#!/usr/bin/env node
// pdf-render.mjs — render an HTML string to PDF via Chromium when the optional
// `playwright` npm package is present; otherwise return a graceful fallback signal
// so the caller runs its pandoc path. Same optional-playwright pattern as ds-shots.mjs.
import assert from 'node:assert/strict';

export async function htmlToPdf({ html, outPath, format, landscape = false, margin, width, height }) {
  let pw;
  try { pw = await import('playwright'); }
  catch { return { ok: false, engine: 'none', reason: 'playwright npm package not installed' }; }
  let browser;
  try { browser = await pw.chromium.launch(); }
  catch (e) { return { ok: false, engine: 'none', reason: 'chromium launch failed: ' + (e && e.message) }; }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const opts = { path: outPath, printBackground: true };
    if (width && height) { opts.width = width; opts.height = height; }
    else { opts.preferCSSPageSize = true; if (format) opts.format = format; if (landscape) opts.landscape = true; }
    if (margin) opts.margin = margin;
    await page.pdf(opts);
    return { ok: true, engine: 'chromium' };
  } finally { await browser.close(); }
}

if (process.argv.includes('--self-test')) {
  (async () => {
    const os = await import('node:os'); const { join } = await import('node:path');
    const { existsSync, statSync } = await import('node:fs');
    const out = join(os.tmpdir(), 'pdf-render-selftest.pdf');
    const r = await htmlToPdf({ html: '<h1 style="font-family:Montserrat">hi</h1>', outPath: out });
    assert.ok(typeof r.ok === 'boolean', 'returns ok flag');
    assert.ok(['chromium', 'none'].includes(r.engine), 'engine is chromium|none');
    if (r.ok) assert.ok(existsSync(out) && statSync(out).size > 0, 'chromium wrote a non-empty PDF');
    console.log('pdf-render self-test: OK (engine=' + r.engine + ')');
  })().catch((e) => { console.error(e); process.exit(1); });
}
