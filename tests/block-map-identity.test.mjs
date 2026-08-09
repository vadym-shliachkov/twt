import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';
import { cluster, GRAY_CAP } from '../tools/block-map/identity.mjs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children)]);

function instancesFor(files) {
  return files.flatMap((f) =>
    flatten(extractBlocks(parseHtml(readFileSync(FIX + f, 'utf8'))))
      .map((block) => ({ block, page: '/' + f.replace('.html', ''), selector: block.selector })));
}

const PAGES = ['index.html', 'services.html', 'pricing.html'];

test('the three card aliases collapse into one block', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  const card = blocks.find((b) => b.aliases.some((a) => a.includes('card')));
  assert.ok(card, 'no block absorbed .card');
  for (const alias of ['.card', '.service-box', '.teaser']) {
    assert.ok(card.aliases.includes(alias), `missing alias ${alias}: got ${card.aliases.join(', ')}`);
  }
  assert.equal(card.reuse.instances, 9);
  assert.equal(card.reuse.pages, 3);
});

test('pricing and testimonial molecules do not merge', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  const plan = blocks.find((b) => b.aliases.includes('.plan'));
  const quote = blocks.find((b) => b.aliases.includes('.quote'));
  assert.ok(plan && quote, 'both must exist as separate blocks');
  assert.notEqual(plan.id, quote.id);
});

test('the site header clusters across every page', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  const header = blocks.find((b) => b.aliases.includes('.site-head'));
  assert.equal(header.reuse.pages, 3);
});

test('gray band is capped and sorted by ambiguity', () => {
  const many = instancesFor(PAGES);
  const { grayBand } = cluster(many);
  assert.ok(grayBand.length <= GRAY_CAP);
  for (let i = 1; i < grayBand.length; i++) {
    assert.ok(Math.abs(grayBand[i - 1].score - 0.75) <= Math.abs(grayBand[i].score - 0.75) + 1e-9,
      'most ambiguous pairs must come first');
  }
});

test('gray band excerpts are bounded', () => {
  const { grayBand } = cluster(instancesFor(PAGES));
  for (const p of grayBand) {
    assert.ok(p.aExcerpt.length <= 400, 'excerpt exceeded 400 chars');
    assert.ok(p.bExcerpt.length <= 400, 'excerpt exceeded 400 chars');
  }
});

test('every block gets a stable id and a human name', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  for (const b of blocks) {
    assert.match(b.id, /^B\d{2,}$/);
    assert.ok(b.name && b.name.length > 1);
  }
  const ids = blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});
