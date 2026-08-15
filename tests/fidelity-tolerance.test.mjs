import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deltaE, comparePx, compareExact, compareEm, compareColour,
  compareProperty, TOLERANCES,
} from '../tools/fidelity/tolerance.mjs';

test('comparePx applies the pass/warn/fail bands', () => {
  const band = { pass: 2, warn: 8 };
  assert.equal(comparePx(96, 96, band).status, 'pass');
  assert.equal(comparePx(96, 94, band).status, 'pass');   // exactly at the pass edge
  assert.equal(comparePx(96, 93, band).status, 'warn');
  assert.equal(comparePx(96, 88, band).status, 'warn');   // exactly at the warn edge
  assert.equal(comparePx(96, 87, band).status, 'fail');
  assert.equal(comparePx(96, 88, band).delta, -8);
});

test('comparePx skips when either side is missing', () => {
  assert.equal(comparePx(null, 96, { pass: 2, warn: 8 }).status, 'skip');
  assert.equal(comparePx(96, undefined, { pass: 2, warn: 8 }).status, 'skip');
});

test('compareExact fails on any difference and normalises case', () => {
  assert.equal(compareExact('Inter', 'Inter').status, 'pass');
  assert.equal(compareExact('Inter', 'inter').status, 'pass');
  assert.equal(compareExact(700, 700).status, 'pass');
  assert.equal(compareExact(700, 600).status, 'fail');
  assert.equal(compareExact('none', 'uppercase').status, 'fail');
});

test('compareEm converts px letter-spacing against the element font size', () => {
  // The band is 0.02em, which at 16px is 0.32px.
  assert.equal(compareEm(-0.16, -0.32, 16).status, 'pass');  // 0.16px = 0.010em, inside
  assert.equal(compareEm(-0.16, -0.8, 16).status, 'fail');   // 0.64px = 0.04em, outside 0.02em
  assert.equal(compareEm(0, 0, 16).status, 'pass');
});

test('deltaE is 0 for identical colours and grows with difference', () => {
  assert.equal(deltaE('#000000', '#000000'), 0);
  assert.equal(deltaE('rgb(0, 0, 0)', '#000000'), 0);
  const near = deltaE('#0b0b0f', '#0b0b10');
  const far = deltaE('#0b0b0f', '#e8ff5a');
  assert.ok(near < 1, `near-identical colours should be under 1, got ${near}`);
  assert.ok(far > 3, `clearly different colours should exceed 3, got ${far}`);
  assert.ok(near < far);
});

test('deltaE returns null rather than 0 for unparseable colours', () => {
  // 0 would read as "identical" and silently pass a gradient vs a flat fill.
  assert.equal(deltaE('linear-gradient(#fff, #000)', '#ffffff'), null);
  assert.equal(deltaE(null, '#ffffff'), null);
});

test('compareColour skips (never passes) when a colour cannot be parsed', () => {
  assert.equal(compareColour('linear-gradient(#fff,#000)', '#ffffff').status, 'skip');
  assert.equal(compareColour('#0b0b0f', '#0b0b10').status, 'pass');
  assert.equal(compareColour('#0b0b0f', '#e8ff5a').status, 'fail');
});

test('compareProperty routes each property to the right comparator', () => {
  assert.equal(compareProperty('box.w', 184, 184).status, 'pass');
  assert.equal(compareProperty('box.w', 184, 170).status, 'fail');
  assert.equal(compareProperty('type.size', 56, 56).status, 'pass');
  assert.equal(compareProperty('type.size', 56, 55).status, 'warn');   // <=1px
  assert.equal(compareProperty('type.size', 56, 48).status, 'fail');
  assert.equal(compareProperty('type.family', 'Inter', 'Arial').status, 'fail');
  assert.equal(compareProperty('fill.color', '#0b0b0f', '#0b0b0f').status, 'pass');
  assert.equal(compareProperty('type.letterSpacing', -0.16, -0.32, { fontSize: 16 }).status, 'pass');
});

test('a comparator that always passes cannot satisfy this suite', () => {
  // Mutation guard: at least one fail must be reachable for every comparator.
  const statuses = [
    comparePx(96, 60, { pass: 2, warn: 8 }).status,
    compareExact('a', 'b').status,
    compareColour('#000000', '#ffffff').status,
    compareEm(0, 4, 16).status,
  ];
  assert.deepEqual(statuses, ['fail', 'fail', 'fail', 'fail']);
});

test('layout properties compare exactly so composition drift is caught', () => {
  assert.equal(compareProperty('layout.display', 'flex', 'flex').status, 'pass');
  assert.equal(compareProperty('layout.display', 'flex', 'block').status, 'fail');
  assert.equal(compareProperty('layout.direction', 'row', 'column').status, 'fail');
  assert.equal(compareProperty('layout.justify', 'center', 'flex-start').status, 'fail');
  assert.equal(compareProperty('layout.align', 'center', 'center').status, 'pass');
});

test('TOLERANCES carries the spec 5.5 values verbatim', () => {
  assert.deepEqual(TOLERANCES['box.w'], { kind: 'px', pass: 2, warn: 8 });
  assert.deepEqual(TOLERANCES['type.size'], { kind: 'px', pass: 0, warn: 1 });
  assert.deepEqual(TOLERANCES['radius'], { kind: 'px', pass: 1, warn: 2 });
  assert.deepEqual(TOLERANCES['spacing.gap'], { kind: 'px', pass: 2, warn: 8 });
  assert.deepEqual(TOLERANCES['fill.color'], { kind: 'colour', pass: 1, warn: 3 });
  assert.deepEqual(TOLERANCES['type.family'], { kind: 'exact' });
  assert.deepEqual(TOLERANCES['type.letterSpacing'], { kind: 'em', pass: 0.02 });
});
