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
import { loadPlaywright } from '../lib/resolve-playwright.mjs';

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
    if (browser) await browser.close();
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
        const changed = dr + dg + dbl + dAlpha > 24;   // per-channel AA slack
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
    if (browser) await browser.close();
  }
}
