#!/usr/bin/env node
// measure.mjs — the one measurement engine.
//
// This same function measures the REFERENCE (a live URL) and the BUILD (a local
// file or a served page). One engine, two callers, so the two sides can never
// disagree about what a "padding" is — the same reason tools/lib/site-fetch.mjs
// was extracted rather than forked.
//
// Usage:
//   node tools/fidelity/measure.mjs --url <url>  --root <sel> --widths 1440,768 --out <json>
//   node tools/fidelity/measure.mjs --file <path> --root <sel> --widths 1440    --out <json>
// Exit: 0 ok | 2 playwright unavailable | 3 measurement failed
'use strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadPlaywright } from '../lib/resolve-playwright.mjs';

const px = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export async function measure({ url, file, root = 'body', widths = [1440], _launch } = {}) {
  const { pw, how } = await loadPlaywright();
  if (!pw) return null;
  const target = url || pathToFileURL(file).href;

  // Launching the browser is its own failure class, kept separate from the
  // measurement try/catch below: a missing Chromium BINARY (package resolved
  // fine, `npx playwright install chromium` was never run) must read exactly
  // like "playwright unavailable" — same null, same exit 2, same install
  // message — because that is what the user actually needs to run. Folding
  // a launch failure into the generic measurement-failure bucket would print
  // a raw Playwright stack under "measurement failed" for the single most
  // common first-run problem this tool has.
  // `_launch` is a test-only injection point so the classification below can
  // be pinned by a stub without depending on whether THIS environment
  // happens to have Chromium installed.
  let browser;
  try {
    browser = await (_launch ? _launch(pw) : pw.chromium.launch());
  } catch {
    return null;
  }

  try {
    const out = {};
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 1200 } });
      await page.goto(target, { waitUntil: 'networkidle', timeout: 20000 });
      out[width] = await page.evaluate((rootSel) => {
        const rootEl = document.querySelector(rootSel);
        // A root selector matching nothing is a user error (wrong selector,
        // page not built yet), not an empty page worth diffing — a silent
        // `[]` here would report as a clean zero-element pass.
        if (!rootEl) throw new Error(`root selector matched no element: ${rootSel}`);
        const rootBox = rootEl.getBoundingClientRect();
        const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
        // Same test walk() uses to skip a node entirely. children must be
        // built through it too — otherwise a display:none sibling is absent
        // from the flat output (correctly) but still named in its parent's
        // `children` array, and diff.mjs's child-ORDER check would then see
        // a stamp on one side that can never be matched on the other and
        // raise a spurious structural failure for an element nobody built.
        const isVisible = (node) => {
          const cs = getComputedStyle(node);
          return cs.display !== 'none' && cs.visibility !== 'hidden';
        };
        const els = [];
        let positional = 0;

        const walk = (node, pathNames) => {
          if (!isVisible(node)) return;
          const cs = getComputedStyle(node);
          const r = node.getBoundingClientRect();
          const stamped = node.getAttribute('data-fid');
          const id = stamped || `__unstamped__${positional++}`;
          const requested = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();

          els.push({
            id,
            positionalId: !stamped,
            role: node.tagName.toLowerCase(),
            provenance: 'measured',
            box: { x: r.x - rootBox.x, y: r.y - rootBox.y, w: r.width, h: r.height },
            type: {
              family: requested,
              size: num(cs.fontSize),
              lineHeight: cs.lineHeight === 'normal' ? null : num(cs.lineHeight),
              weight: num(cs.fontWeight),
              letterSpacing: cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing),
              transform: cs.textTransform,
              align: cs.textAlign,
            },
            // requestedFamily vs what actually rendered: the caller marks a
            // fallback so a missing local font reads as a rendering artifact,
            // not a build defect (spec 9.3).
            fontFallback: false,
            fill: { color: cs.color, opacity: num(cs.opacity) },
            bg: { color: cs.backgroundColor, image: cs.backgroundImage === 'none' ? null : cs.backgroundImage },
            border: { width: num(cs.borderTopWidth), color: cs.borderTopColor },
            radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius,
                     cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(num),
            shadow: cs.boxShadow === 'none' ? [] : [cs.boxShadow],
            spacing: {
              padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(num),
              margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(num),
              gap: cs.gap === 'normal' ? 0 : num(cs.rowGap || cs.gap),
            },
            layout: {
              display: cs.display, direction: cs.flexDirection,
              justify: cs.justifyContent, align: cs.alignItems,
            },
            text: node.children.length === 0 ? (node.textContent || '').trim().slice(0, 200) : null,
            children: [...node.children].filter(isVisible).map((c) => c.getAttribute('data-fid')).filter(Boolean),
          });

          for (const child of node.children) walk(child, pathNames);
        };

        walk(rootEl, []);
        return els;
      }, root);
      await page.close();
    }
    return { widths: out, how };
  } catch (err) {
    // Distinct from "Playwright is missing" (the `!pw` return above, which
    // stays `null`): this is Playwright working fine and the measurement
    // itself failing — bad selector, navigation failure, timeout. The two
    // must not collapse into the same value, or a real measurement bug
    // reports itself to the caller as "go install Playwright."
    return { error: 'measurement', message: String((err && err.message) || err) };
  } finally {
    // A browser whose process already died (e.g. after a goto timeout) can
    // make close() itself throw. That must not replace whatever try/catch
    // above was about to return — including a legitimate success — with an
    // unhandled rejection the CLI has no top-level handler for.
    if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  }
}

// Round every px value on the way out so 95.99999 and 96 never diff.
export function round(els) {
  const r = (v) => (typeof v === 'number' ? px(v) : v);
  return els.map((e) => ({
    ...e,
    box: Object.fromEntries(Object.entries(e.box).map(([k, v]) => [k, r(v)])),
    radius: e.radius.map(r),
    type: { ...e.type, size: r(e.type.size), lineHeight: r(e.type.lineHeight),
            letterSpacing: r(e.type.letterSpacing) },
    border: { ...e.border, width: r(e.border.width) },
    spacing: { padding: e.spacing.padding.map(r), margin: e.spacing.margin.map(r),
               gap: r(e.spacing.gap) },
  }));
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : process.argv[i + 1];
  };
  const widths = String(arg('widths', '1440')).split(',').map(Number);
  const out = await measure({
    url: arg('url'), file: arg('file'), root: arg('root', 'body'), widths,
  });
  if (!out) {
    process.stderr.write('playwright unavailable — npm install playwright && npx playwright install chromium\n');
    process.exit(2);
  }
  if (out.error === 'measurement') {
    process.stderr.write(`measurement failed: ${out.message}\n`);
    process.exit(3);
  }
  const rounded = Object.fromEntries(
    Object.entries(out.widths).map(([w, els]) => [w, round(els)]));
  const dest = arg('out');
  const payload = JSON.stringify({ widths: rounded, how: out.how }, null, 2);
  if (dest) writeFileSync(dest, payload);
  else process.stdout.write(payload);
  process.stderr.write(`measured ${Object.values(rounded).flat().length} elements via ${out.how}\n`);
}
