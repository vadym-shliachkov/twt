// emit.mjs — write the two artifacts, with a hard wall between them.
//
// block-map.json is the FAT downstream contract (markup + css per variant).
// summary.json is what the model reads. Nothing that could carry markup may
// cross into summary.json — that separation is the whole token budget.
'use strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const VARIANT_HTML_CAP = 4000;

// MUST escape. parse.mjs decodes HTML entities at parse time, so `node.text`
// holds DECODED text: source `&lt;script&gt;alert(1)&lt;/script&gt;` arrives here
// as the literal string `<script>alert(1)</script>`. Interpolating it raw would
// re-emit it as LIVE MARKUP inside block-map.json's variant html — which the
// Task 10 renderer and the future a11y consumer then read back as structure.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function serialize(node, budget = VARIANT_HTML_CAP) {
  if (budget <= 0) return '';
  const attrs = Object.entries(node.attrs || {})
    .filter(([k]) => k === 'class' || k === 'id' || k === 'href' || k === 'src' || k === 'alt')
    .map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const inner = node.text
    ? esc(node.text)
    : node.children.map((c) => serialize(c, budget / Math.max(1, node.children.length))).join('');
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

// Variants: group a block's instances by their exact serialized shape.
function variantsOf(block) {
  const buckets = new Map();
  for (const m of block._members) {
    const html = serialize(m.block.node).slice(0, VARIANT_HTML_CAP);
    const key = html.replace(/>[^<]*</g, '><');   // shape, ignoring text content
    if (!buckets.has(key)) buckets.set(key, { html, count: 0 });
    buckets.get(key).count++;
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .map((v, i) => ({ id: 'v' + (i + 1), count: v.count, html: v.html }));
}

export function emitAll(result, outDir) {
  mkdirSync(outDir, { recursive: true });
  const meta = {
    generated: new Date().toISOString(),
    pages: result.pages.length,
    blocks: result.blocks.length,
    engine: result.engine || 'static',
    jsRenderedPages: result.pages.filter((p) => p.jsRendered).map((p) => p.url),
    unadjudicated: result.unadjudicated || 0,
  };

  const full = {
    meta,
    pages: result.pages.map((p) => ({ id: p.id, url: p.url, jsRendered: p.jsRendered })),
    blocks: result.blocks.map((b) => ({
      id: b.id, name: b.name, tier: b.tier, aliases: b.aliases,
      parents: b.parents, children: b.children, reuse: b.reuse,
      mergedBy: b.mergedBy || [],        // model rulings: [{ absorbed, reason }]
      instances: b.instances,
      variants: variantsOf(b),
    })),
  };

  const summary = {
    meta,
    pages: full.pages,
    blocks: result.blocks.map((b) => ({
      id: b.id, name: b.name, tier: b.tier, aliases: b.aliases,
      parents: b.parents, children: b.children, reuse: b.reuse,
    })),
  };

  const blockMapPath = join(outDir, 'block-map.json');
  const summaryPath = join(outDir, 'summary.json');
  const grayBandPath = join(outDir, 'gray-band.json');
  writeFileSync(blockMapPath, JSON.stringify(full, null, 2) + '\n');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(grayBandPath, JSON.stringify(result.grayBand || [], null, 2) + '\n');
  return { blockMapPath, summaryPath, grayBandPath };
}
