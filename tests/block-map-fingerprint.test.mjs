import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';
import { fingerprint, similarity } from '../tools/block-map/fingerprint.mjs';
import { MERGE_AT } from '../tools/block-map/identity.mjs';

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

// --- Fix round: tier as a hard discriminator --------------------------
//
// page-wrap.html's `.hero` is an ORGANISM (h1+p+a sit directly inside a
// top-level <section class="hero">) and index.html's `.hero__copy` is a
// MOLECULE (h1+p+a sit inside a nested <div class="hero__copy">) — same
// inner skeleton, same atoms, same "no repeated card" arity, so before this
// fix they scored 0.98 and merged into one block despite being different
// GROUND-TRUTH rows (Hero vs Heading group) at different structural levels.
test('a same-skeleton organism and molecule do not merge — tier is a hard discriminator', () => {
  const heroOrganism = load('page-wrap.html').find((b) => b.classes.includes('hero'));
  const heroCopyMolecule = byClass(load('index.html'), 'hero__copy');
  assert.equal(heroOrganism.tier, 'organism', 'precondition: page-wrap .hero is an organism');
  assert.equal(heroCopyMolecule.tier, 'molecule', 'precondition: .hero__copy is a molecule');
  assert.deepEqual(fingerprint(heroOrganism).skeleton, fingerprint(heroCopyMolecule).skeleton,
    'precondition: the inner tag skeletons ARE identical (both empty — h1/p/a are atoms, not skeleton tags)');
  const s = similarity(fingerprint(heroOrganism), fingerprint(heroCopyMolecule));
  assert.ok(s < MERGE_AT, `differing-tier pair scored ${s}, expected < MERGE_AT (${MERGE_AT})`);
});

test('tier mismatch caps the score even when every other dimension matches (synthetic worst case)', () => {
  const base = byClass(load('index.html'), 'card');
  const sameEverythingDifferentTier = { ...base, tier: base.tier === 'organism' ? 'molecule' : 'organism' };
  const s = similarity(fingerprint(base), fingerprint(sameEverythingDifferentTier));
  assert.ok(s < MERGE_AT, `identical-in-every-other-way pair with mismatched tier scored ${s}, must be < ${MERGE_AT}`);
});

test('same-tier pairs are completely unaffected by the tier discriminator (Task 6 table survives)', () => {
  const card = byClass(load('index.html'), 'card');
  const box = byClass(load('services.html'), 'service-box');
  const teaser = byClass(load('pricing.html'), 'teaser');
  const features = byClass(load('index.html'), 'features');
  const related = byClass(load('pricing.html'), 'related');
  const plan = byClass(load('pricing.html'), 'plan');
  const quote = byClass(load('pricing.html'), 'quote');
  const siteHeadIndex = byClass(load('index.html'), 'site-head');
  const siteHeadServices = byClass(load('services.html'), 'site-head');

  assert.equal(Number(similarity(fingerprint(card), fingerprint(box)).toFixed(4)), 0.9600);
  assert.equal(Number(similarity(fingerprint(card), fingerprint(teaser)).toFixed(4)), 0.9600);
  assert.equal(Number(similarity(fingerprint(features), fingerprint(related)).toFixed(4)), 0.9600);
  assert.equal(Number(similarity(fingerprint(card), fingerprint(plan)).toFixed(4)), 0.9240);
  assert.equal(Number(similarity(fingerprint(plan), fingerprint(quote)).toFixed(4)), 0.8880);
  assert.equal(similarity(fingerprint(siteHeadIndex), fingerprint(siteHeadServices)), 1);
});
