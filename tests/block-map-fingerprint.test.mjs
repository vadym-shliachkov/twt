import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';
import { fingerprint, similarity } from '../tools/block-map/fingerprint.mjs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children)]);
const load = (f) => flatten(extractBlocks(parseHtml(readFileSync(FIX + f, 'utf8'))));
const byClass = (bs, c) => bs.find((b) => b.classes.includes(c));

test('differently-named identical cards score >= 0.95', () => {
  const card = byClass(load('index.html'), 'card');
  const box  = byClass(load('services.html'), 'service-box');
  const teaser = byClass(load('pricing.html'), 'teaser');
  assert.ok(similarity(fingerprint(card), fingerprint(box)) >= 0.95);
  assert.ok(similarity(fingerprint(card), fingerprint(teaser)) >= 0.95);
});

test('pricing and testimonial grids stay apart despite identical skeletons', () => {
  const all = load('pricing.html');
  const plan = byClass(all, 'plan');
  const quote = byClass(all, 'quote');
  assert.deepEqual(fingerprint(plan).skeleton, fingerprint(quote).skeleton,
    'precondition: the tag skeletons ARE identical');
  assert.ok(similarity(fingerprint(plan), fingerprint(quote)) < 0.95,
    'content semantics must prevent an auto-merge');
});

test('similarity is symmetric and self-identity is 1', () => {
  const a = fingerprint(byClass(load('index.html'), 'card'));
  const b = fingerprint(byClass(load('services.html'), 'service-box'));
  assert.equal(similarity(a, a), 1);
  assert.equal(similarity(a, b), similarity(b, a));
});

test('structurally unrelated blocks score <= 0.60', () => {
  const header = load('index.html').find((b) => b.tag === 'header');
  const card = byClass(load('index.html'), 'card');
  assert.ok(similarity(fingerprint(header), fingerprint(card)) <= 0.60);
});

test('class names carry low weight: renaming alone barely moves the score', () => {
  const card = byClass(load('index.html'), 'card');
  const renamed = { ...card, classes: ['totally-different-name'] };
  assert.ok(similarity(fingerprint(card), fingerprint(renamed)) >= 0.95);
});
