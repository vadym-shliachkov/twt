// emit.mjs — write the two artifacts, with a hard wall between them.
//
// block-map.json is the FAT downstream contract (markup + css per variant).
// summary.json is what the model reads. Nothing that could carry markup may
// cross into summary.json — that separation is the whole token budget.
'use strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const VARIANT_HTML_CAP = 4000;

// IMPORTANT review finding (round 1, item 3): a block with more genuinely
// distinct instance shapes than this is unusual enough that showing every
// one individually stops being useful and starts inflating the artifact —
// so beyond this many buckets, the rest are folded into one `overflow`
// entry (see variantsOf) rather than emitted one-by-one. Exported so tests
// can size their fixtures against the real value instead of a hardcoded
// duplicate.
export const MAX_VARIANTS_PER_BLOCK = 8;

// MUST escape. parse.mjs decodes HTML entities at parse time, so `node.text`
// holds DECODED text: source `&lt;script&gt;alert(1)&lt;/script&gt;` arrives here
// as the literal string `<script>alert(1)</script>`. Interpolating it raw would
// re-emit it as LIVE MARKUP inside block-map.json's variant html — which the
// Task 10 renderer and the future a11y consumer then read back as structure.
// Two DIFFERENT escapers, not one (review round 1, IMPORTANT 2): text and
// attribute values arrive from parse.mjs in different states.
//  - `node.text` is DECODED (parse.mjs's decodeEntities already turned
//    `&amp;` into `&`) — so it must be escaped for `&`, `<`, `>` to be safe
//    to re-embed as element content.
//  - `node.attrs` values are RAW/undecoded — parse.mjs's attrsOf() never
//    calls decodeEntities on them — so a source `href="/x?a=1&amp;b=2"`
//    (the spec-correct way to write a literal `&` in an href, common on
//    real sites) arrives here STILL encoded, as the literal characters
//    "&amp;b=2". Escaping `&` again on top of that turns it into
//    "&amp;amp;b=2", corrupting the URL. Attribute values only need `"`
//    (breaks out of the attribute), `<` and `>` (technically-invalid but
//    defensive) escaped — `&` must be left exactly as the source wrote it.
const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => String(s).replace(/["<>]/g, (c) => ({ '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

// IMPORTANT review finding (round 1, item 4): the budget must be enforced
// AT NODE BOUNDARIES, during serialization — never as a post-hoc string
// slice. The old scheme divided the cap evenly per child up front but let
// a text-bearing node ignore it entirely, so in practice the only real cap
// was `variantsOf`'s `.slice(0, VARIANT_HTML_CAP)` — which cuts wherever
// the character count happens to land, mid-tag or mid-attribute, with no
// closing tags at all. That is invalid markup, not a smaller sample, and
// Task 10's renderer would read it back as structure.
//
// `state` is a single mutable `{ left: number }` threaded through the
// whole recursive call (not a per-child divided number) so every node
// shares one real remaining-budget counter instead of each guessing its
// own slice up front. Once a node is decided to be INCLUDED, its own open
// and close tags are non-negotiable — they are reserved immediately, even
// if that pushes `state.left` negative — because dropping the close tag is
// exactly the malformed-output bug this replaces. What actually responds
// to the budget is (a) how much of this node's OWN text survives (may be
// truncated, but the tag around it still closes) and (b) whether any FURTHER
// children get started at all: the children loop checks the budget BEFORE
// starting each child, never mid-child, so a child is either serialized
// whole (well-formed) or not started (nothing to close). This can let the
// total output run slightly over VARIANT_HTML_CAP (bounded by the tag
// overhead of whichever nodes were already "in flight" when the budget hit
// zero) — an acceptable, bounded tradeoff for guaranteeing every emitted
// tag is closed.
function serialize(node, state = { left: VARIANT_HTML_CAP }) {
  const attrs = Object.entries(node.attrs || {})
    .filter(([k]) => k === 'class' || k === 'id' || k === 'href' || k === 'src' || k === 'alt')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const open = `<${node.tag}${attrs}>`;
  const close = `</${node.tag}>`;
  state.left -= open.length + close.length;

  // CRITICAL FIX (review round 1): text and children are NOT mutually
  // exclusive. `parse.mjs`'s `addText` concatenates every direct text run
  // of a node into ONE `.text` string as it parses, so the original
  // before/between/after interleaving relative to child elements is already
  // lost by the time this node reaches us — there is no way to recover
  // "text A, then <a>, then text B" from `{ text: "A B", children: [a] }`.
  // Emitting text-then-children is therefore only an approximation of the
  // source order, but it is the correct tradeoff: the old `text ? esc(text)
  // : children...` branch treated the two as exclusive and silently
  // DROPPED whichever one lost, which for ordinary prose like
  // `<p>Learn more about <a>us</a> today.</p>` deleted the link outright.
  // An approximation that keeps all the content beats a shortcut that
  // deletes some of it.
  let inner = '';
  if (node.text) {
    const t = escText(node.text);
    if (state.left > 0) {
      // Truncating a text node IS allowed — unlike a child element, plain
      // text has no closing tag of its own to strand, so cutting it short
      // never produces invalid markup (the node's own tag pair, reserved
      // above, still closes correctly either way).
      const kept = t.length > state.left ? t.slice(0, state.left) : t;
      inner += kept;
      state.left -= kept.length;
    }
  }
  for (const c of node.children) {
    if (state.left <= 0) break; // node boundary: never start a child once the budget is gone, never truncate mid-child
    inner += serialize(c, state);
  }
  return open + inner + close;
}

// IMPORTANT review finding (round 1, item 3): the bucket key must ignore
// attribute VALUES, not just inter-tag text — the default shape on the
// real web is a card grid where every card links somewhere different
// (`href="/product/N"`), and the old key kept full opening tags (attrs and
// all), so 30 byte-identical cards produced 30 buckets with zero dedup,
// defeating the whole point of bucketing. `class` is deliberately NOT
// stripped here: it IS the shape signal (a `.card--featured` vs a plain
// `.card` really is a different variant), so only href/src/alt/id — the
// attributes serialize() allowlists that carry per-instance identity, not
// per-instance styling/semantics — are dropped from the key. The `html`
// stored per bucket keeps the real attribute values; only the KEY ignores
// them.
const BUCKET_IGNORED_ATTRS = /\s(?:href|src|alt|id)="[^"]*"/g;
function shapeKeyOf(html) {
  return html
    .replace(/>[^<]*</g, '><')          // ignore inter-tag text content
    .replace(BUCKET_IGNORED_ATTRS, ''); // ignore non-shape attribute VALUES
}

// Variants: group a block's instances by their exact serialized shape, then
// cap the number of DISTINCT buckets shown (see MAX_VARIANTS_PER_BLOCK) so a
// genuinely varied block cannot explode the artifact — the long tail beyond
// the cap is folded into one `overflow` entry whose `count` is the sum of
// every bucket it absorbed, so `variants[].count` always still sums to
// `reuse.instances` regardless of whether capping happened.
function variantsOf(block) {
  const buckets = new Map();
  for (const m of block._members) {
    // No post-hoc slice here (review round 1, item 4) — serialize() now
    // enforces VARIANT_HTML_CAP itself, at node boundaries, so its output
    // is already well-formed and does not need (and must not get) a second,
    // string-level truncation on top.
    const html = serialize(m.block.node);
    const key = shapeKeyOf(html);
    if (!buckets.has(key)) buckets.set(key, { html, count: 0 });
    buckets.get(key).count++;
  }
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (sorted.length <= MAX_VARIANTS_PER_BLOCK) {
    return sorted.map((v, i) => ({ id: 'v' + (i + 1), count: v.count, html: v.html }));
  }
  const kept = sorted.slice(0, MAX_VARIANTS_PER_BLOCK - 1);
  const overflow = sorted.slice(MAX_VARIANTS_PER_BLOCK - 1);
  const variants = kept.map((v, i) => ({ id: 'v' + (i + 1), count: v.count, html: v.html }));
  variants.push({
    id: 'v' + MAX_VARIANTS_PER_BLOCK,
    count: overflow.reduce((s, v) => s + v.count, 0),
    html: overflow[0].html,          // most common of the absorbed shapes (overflow is still count-sorted)
    overflow: true,
    overflowShapes: overflow.length, // how many distinct shapes got folded in here
  });
  return variants;
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
