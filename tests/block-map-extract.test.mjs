import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const load = (f) => extractBlocks(parseHtml(readFileSync(FIX + f, 'utf8')));
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children)]);
const classesOf = (bs) => flatten(bs).flatMap((b) => b.classes);

test('wrappers never appear in the output', () => {
  const all = classesOf(load('services.html'));
  for (const w of ['elementor-section', 'elementor-container', 'elementor-column', 'elementor-widget-wrap']) {
    assert.ok(!all.includes(w), `wrapper .${w} leaked into the map`);
  }
  const home = classesOf(load('index.html'));
  assert.ok(!home.includes('container'), 'wrapper .container leaked');
  assert.ok(!home.includes('wrap'), 'wrapper .wrap leaked');
});

test('repeated siblings become molecules with arity', () => {
  const cards = flatten(load('services.html')).filter((b) => b.classes.includes('service-box'));
  assert.equal(cards.length, 3);
  assert.equal(cards[0].tier, 'molecule');
  assert.equal(cards[0].arity, 3);
});

test('semantic landmarks are organisms', () => {
  const top = load('index.html');
  const tags = top.map((b) => b.tag);
  assert.ok(tags.includes('header'));
  assert.ok(tags.includes('footer'));
  assert.ok(top.filter((b) => b.tag === 'header')[0].tier === 'organism');
});

test('leaf clusters with 2+ atom types are molecules', () => {
  const hero = flatten(load('index.html')).find((b) => b.classes.includes('hero__copy'));
  assert.ok(hero, '.hero__copy should be emitted (h1 + p + a = 3 atom types)');
  assert.equal(hero.tier, 'molecule');
});

test('repeated single-atom nodes stay atoms, not molecules', () => {
  const logos = flatten(load('index.html')).find((b) => b.classes.includes('logos'));
  assert.ok(logos, '.logos should be emitted (semantic ul)');
  assert.equal(logos.children.length, 0, 'the six <li><img> must NOT become six molecules');
  assert.equal(logos.atoms.images, 6, 'repetition is recorded as atom count on the parent');
});

test('depth cap is honoured', () => {
  const deep = extractBlocks(parseHtml(readFileSync(FIX + 'services.html', 'utf8')), { depth: 1 });
  assert.equal(flatten(deep).every((b) => b.children.length === 0), true);
});

test('a JS mount point yields no blocks', () => {
  assert.equal(load('app.html').length, 0);
});
