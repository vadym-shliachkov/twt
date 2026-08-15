import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugSegment, deriveId, makeElement, makeSpec,
  isEstimated, specFilename, reportBasenames, PROPERTY_GROUPS,
} from '../tools/fidelity/spec.mjs';

test('slugSegment kebab-cases and strips punctuation', () => {
  assert.equal(slugSegment('Hero CTA'), 'hero-cta');
  assert.equal(slugSegment('  Primary / Button  '), 'primary-button');
  assert.equal(slugSegment('H1'), 'h1');
  assert.equal(slugSegment(''), 'unnamed');
  assert.equal(slugSegment(null), 'unnamed');
});

test('deriveId always carries the sibling index', () => {
  // Always-suffix is load-bearing (spec 4.1): under "suffix only repeats",
  // adding a second CTA would rename hero.cta -> hero.cta.0 and orphan its
  // stamp in the built page.
  assert.equal(deriveId(['Hero', 'Title'], 0), 'hero.title.0');
  assert.equal(deriveId(['Hero', 'CTA'], 1), 'hero.cta.1');
  assert.equal(deriveId([], 0), 'root.0');
});

test('adding a sibling does not rename the existing element', () => {
  const before = deriveId(['Hero', 'CTA'], 0);
  const after = deriveId(['Hero', 'CTA'], 0); // a second CTA now exists at index 1
  assert.equal(before, after, 'index 0 must be stable when a sibling is added');
});

test('makeElement fills every schema field with defaults', () => {
  const el = makeElement({ id: 'hero.title.0', box: { x: 0, y: 0, w: 100, h: 20 } });
  assert.equal(el.id, 'hero.title.0');
  assert.equal(el.provenance, 'measured');
  assert.equal(el.role, null);
  assert.deepEqual(el.children, []);
  assert.deepEqual(el.radius, [0, 0, 0, 0]);
  assert.deepEqual(el.spacing.padding, [0, 0, 0, 0]);
  assert.equal(el.type.family, null);
  assert.equal(el.box.w, 100);
});

test('makeElement rejects an element with no id', () => {
  assert.throws(() => makeElement({ box: { x: 0, y: 0, w: 1, h: 1 } }), /id/);
});

test('a spec with any estimated element is estimated, and renames its files', () => {
  const measured = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'https://x.test' }, widths: [1440],
    elements: [makeElement({ id: 'hero.title.0' })],
  });
  assert.equal(isEstimated(measured), false);
  assert.equal(specFilename(measured), 'reference-spec.json');
  assert.deepEqual(reportBasenames(measured),
    { md: 'validation-report.md', html: 'fidelity-report.html' });

  const guessed = makeSpec({
    target: 'hero', source: { kind: 'image', ref: 'ref.png' }, widths: [1440],
    elements: [makeElement({ id: 'hero.title.0', provenance: 'estimated' })],
  });
  assert.equal(isEstimated(guessed), true);
  assert.equal(specFilename(guessed), 'reference-spec-estimated.json');
  assert.deepEqual(reportBasenames(guessed),
    { md: 'validation-report-estimated.md', html: 'fidelity-report-estimated.html' });
});

test('spec records the measured/estimated mix for the report header', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'figma', ref: 'f' }, widths: [1440],
    elements: [
      makeElement({ id: 'a.0' }),
      makeElement({ id: 'b.0', provenance: 'estimated' }),
      makeElement({ id: 'c.0' }),
    ],
  });
  assert.deepEqual(spec.provenance, { measured: 2, estimated: 1 });
});

test('property groups cover the scorecard categories and do not overlap', () => {
  const all = Object.values(PROPERTY_GROUPS).flat();
  assert.equal(new Set(all).size, all.length, 'a property may belong to one group only');
  assert.ok(PROPERTY_GROUPS.geometry.includes('box.w'));
  assert.ok(PROPERTY_GROUPS.typography.includes('type.size'));
  assert.ok(PROPERTY_GROUPS.colour.includes('fill.color'));
  assert.ok(PROPERTY_GROUPS.structure.includes('children'));
});
