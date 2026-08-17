#!/usr/bin/env node
// pixdiff.mjs — image comparison with NO new npm dependency.
//
// Both PNGs are decoded and compared inside the Chromium that Playwright
// already ships (canvas + ImageData), and the heatmap comes back out as a
// base64 PNG. Adding pixelmatch+pngjs would have doubled this repo's
// dependency count for arithmetic the browser already does.
'use strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadPlaywright, detectPlaywright } from '../lib/resolve-playwright.mjs';

// Screenshot helper — used by tests and by the orchestrator's built/ captures.
export async function shoot({ url, file, root, width = 1440, out }) {
  const { pw } = await loadPlaywright();
  if (!pw) return false;
  let browser;
  try {
    browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    await page.goto(url || pathToFileURL(file).href, { waitUntil: 'networkidle', timeout: 20000 });
    const target = root ? page.locator(root).first() : page;
    await target.screenshot({ path: out, ...(root ? {} : { fullPage: true }) });
    return true;
  } catch {
    return false;
  } finally {
    // A browser whose process already died (e.g. after a goto timeout) can
    // make close() itself throw. That must not replace whatever try/catch
    // above was about to return — including a legitimate success — with an
    // unhandled rejection the caller has no top-level handler for.
    if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  }
}

const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

export async function pixdiff({ a, b, out, floor = 0.5 }) {
  const { pw } = await loadPlaywright();
  if (!pw) return null;
  let browser;
  try {
    browser = await pw.chromium.launch();
    const page = await browser.newPage();
    const result = await page.evaluate(async ([srcA, srcB]) => {
      const load = (src) => new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
      const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
      // Compare on the UNION of both sizes: a build that is short by 200px
      // has a real, reportable difference, not an exception.
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const grab = (img) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h);
      };
      const da = grab(ia), db = grab(ib);
      const outC = document.createElement('canvas');
      outC.width = w; outC.height = h;
      const octx = outC.getContext('2d');
      const od = octx.createImageData(w, h);
      let diff = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const dr = Math.abs(da.data[i] - db.data[i]);
        const dg = Math.abs(da.data[i + 1] - db.data[i + 1]);
        const dbl = Math.abs(da.data[i + 2] - db.data[i + 2]);
        const dAlpha = Math.abs(da.data[i + 3] - db.data[i + 3]);
        const changed = dr + dg + dbl + dAlpha > 24;   // AA slack: sum of all four channel deltas, not any single channel
        if (changed) diff++;
        od.data[i] = changed ? 255 : da.data[i];
        od.data[i + 1] = changed ? 0 : da.data[i + 1];
        od.data[i + 2] = changed ? 0 : da.data[i + 2];
        od.data[i + 3] = changed ? 255 : 60;
      }
      octx.putImageData(od, 0, 0);
      return { mismatch: (diff / (w * h)) * 100, png: outC.toDataURL('image/png') };
    }, [dataUri(a), dataUri(b)]);

    writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64'));
    const mismatch = Number(result.mismatch.toFixed(3));
    return { mismatch, reported: mismatch >= floor, out };
  } catch {
    return null;
  } finally {
    // Same rationale as shoot()'s finally: a dead browser process making
    // close() throw must not clobber a legitimate result with an unhandled
    // rejection.
    if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  }
}

// --- CLI entrypoint --------------------------------------------------------
//
// A SKILL.md is prose executed by a model: it runs Bash and file tools, never
// library functions. Without an isMain guard here, pixdiff() was reachable
// from Node callers and tests only — the same trap the `inherit` plan hit
// with adapters.mjs, and Task 7 of this plan hit again when it had to
// substitute tools/ds-block-preview.mjs for reference screenshots because
// shoot() (also exported here) had no CLI either. shoot() stays exported and
// CLI-less on purpose — ds-block-preview.mjs already covers that job and the
// brief for this task is explicit: do not duplicate a working CLI.
//
// Usage:
//   node tools/fidelity/pixdiff.mjs --a <ref.png> --b <built.png> --out <diff.png> [--floor 0.5] [--json <path>]
// Exit: 0 ok | 2 playwright/chromium unavailable | 3 the comparison failed
// (missing/unreadable input file, decode failure, ...).
//
// pixdiff() itself collapses BOTH failure classes into a single `null`
// return (its one try/catch spans the browser launch and the actual
// comparison) — unlike measure.mjs, which has a dedicated `_launch` seam to
// tell "Chromium binary missing" apart from "the measurement itself broke".
// Reproducing that split inside pixdiff() would go beyond "add a CLI" and
// touch a landed, reviewed function. Instead this CLI probes real
// availability itself, once, via detectPlaywright() (package resolves AND
// chromium launches) — before ever calling pixdiff() — so the 2-vs-3 choice
// is grounded in an independent check, not in guessing what a bare `null`
// meant. The one-line classifier below is exported and tested directly,
// because the "genuinely unavailable" branch (exit 2) cannot be exercised by
// spawning the real CLI in this environment: every dev/CI box that runs this
// suite already has Chromium installed (the identical constraint that made
// Task 4/measure.mjs's tests use an injection seam rather than rely on the
// environment lacking Chromium for real).
export function classifyPixdiffExit({ playwrightOk, result }) {
  if (!playwrightOk) return 2;
  if (!result) return 3;
  return 0;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : process.argv[i + 1];
  };
  const a = arg('a');
  const b = arg('b');
  const out = arg('out');
  const floor = Number(arg('floor', '0.5'));
  const jsonPath = arg('json');

  const { playwright, chromium } = await detectPlaywright();
  const playwrightOk = playwright && chromium;
  const result = playwrightOk ? await pixdiff({ a, b, out, floor }) : null;
  const code = classifyPixdiffExit({ playwrightOk, result });

  if (code === 2) {
    process.stderr.write('playwright unavailable — npm install playwright && npx playwright install chromium\n');
    process.exit(2);
  }
  if (code === 3) {
    process.stderr.write(`pixel comparison failed: could not compare "${a}" and "${b}"\n`);
    process.exit(3);
  }

  const payload = JSON.stringify(result, null, 2);
  if (jsonPath) writeFileSync(jsonPath, payload);
  else process.stdout.write(payload + '\n');
  const health = result.reported ? 'reported' : 'not reported';
  process.stderr.write(`pixdiff: ${result.mismatch}% mismatch (${health}) -> ${result.out}\n`);
}
