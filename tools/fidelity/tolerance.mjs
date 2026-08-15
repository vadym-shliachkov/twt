// tolerance.mjs — the gate. Every pass/fail decision in this skill family is
// made here, deterministically, so the loop's stop signal is a measurement and
// never a model's opinion (see spec 3.2 / CONVENTIONS 9 amendment).
//
// Colour compares as perceptual deltaE rather than hex equality on purpose:
// token snapping produces near-identical colours that deserve a warning, not a
// failure, and #0b0b0f vs #0b0b10 is not a real defect.
'use strict';
import { parseColor } from '../lib/contrast.mjs';

export const TOLERANCES = {
  'box.x': { kind: 'px', pass: 2, warn: 8 },
  'box.y': { kind: 'px', pass: 2, warn: 8 },
  'box.w': { kind: 'px', pass: 2, warn: 8 },
  'box.h': { kind: 'px', pass: 2, warn: 8 },
  'spacing.padding': { kind: 'px', pass: 2, warn: 8 },
  'spacing.margin': { kind: 'px', pass: 2, warn: 8 },
  'spacing.gap': { kind: 'px', pass: 2, warn: 8 },
  'radius': { kind: 'px', pass: 1, warn: 2 },
  'border.width': { kind: 'px', pass: 1, warn: 2 },
  'type.size': { kind: 'px', pass: 0, warn: 1 },
  'type.lineHeight': { kind: 'px', pass: 0, warn: 1 },
  'type.family': { kind: 'exact' },
  'type.weight': { kind: 'exact' },
  'type.transform': { kind: 'exact' },
  'type.align': { kind: 'exact' },
  'type.letterSpacing': { kind: 'em', pass: 0.02 },
  'fill.color': { kind: 'colour', pass: 1, warn: 3 },
  'bg.color': { kind: 'colour', pass: 1, warn: 3 },
  'border.color': { kind: 'colour', pass: 1, warn: 3 },
  // Structure & composition is one of the four in-scope drift types (spec 2).
  // Without these four, a reordered or re-directed flex container reports a
  // clean pass and only a missing/extra ELEMENT is ever caught.
  'layout.display': { kind: 'exact' },
  'layout.direction': { kind: 'exact' },
  'layout.justify': { kind: 'exact' },
  'layout.align': { kind: 'exact' },
};

const cmp = (prop, status, delta, ref, got, unit) => ({ prop, status, delta, ref, got, unit });
const missing = (v) => v === null || v === undefined || v === '';

export function comparePx(ref, got, { pass, warn }, prop = '') {
  if (missing(ref) || missing(got)) return cmp(prop, 'skip', null, ref, got, 'px');
  const delta = got - ref;
  const abs = Math.abs(delta);
  const status = abs <= pass ? 'pass' : abs <= warn ? 'warn' : 'fail';
  return cmp(prop, status, delta, ref, got, 'px');
}

export function compareExact(ref, got, prop = '') {
  if (missing(ref) || missing(got)) return cmp(prop, 'skip', null, ref, got, '');
  const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
  return cmp(prop, norm(ref) === norm(got) ? 'pass' : 'fail', null, ref, got, '');
}

export function compareEm(ref, got, fontSize, prop = '') {
  if (missing(ref) || missing(got)) return cmp(prop, 'skip', null, ref, got, 'em');
  const size = fontSize || 16;
  const deltaEm = (got - ref) / size;
  const status = Math.abs(deltaEm) <= TOLERANCES['type.letterSpacing'].pass ? 'pass' : 'fail';
  return cmp(prop, status, Number(deltaEm.toFixed(4)), ref, got, 'em');
}

// sRGB -> linear -> CIE XYZ (D65) -> CIELAB, then CIE76 distance. CIE76 is
// enough here: the thresholds (1 / 3) are coarse, and CIEDE2000 would add a
// page of maths for a difference no reader of this report would notice.
function toLab(c) {
  const lin = (u) => {
    u /= 255;
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(a, b) {
  const ca = parseColor(a), cb = parseColor(b);
  if (!ca || !cb) return null;   // null, never 0 — 0 would read as "identical"
  const [l1, a1, b1] = toLab(ca);
  const [l2, a2, b2] = toLab(cb);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

export function compareColour(ref, got, prop = '') {
  const d = deltaE(ref, got);
  if (d === null) return cmp(prop, 'skip', null, ref, got, 'dE');
  const { pass, warn } = TOLERANCES['fill.color'];
  const status = d <= pass ? 'pass' : d <= warn ? 'warn' : 'fail';
  return cmp(prop, status, Number(d.toFixed(2)), ref, got, 'dE');
}

export function compareProperty(prop, ref, got, ctx = {}) {
  const rule = TOLERANCES[prop];
  if (!rule) return cmp(prop, 'skip', null, ref, got, '');
  if (rule.kind === 'px') return comparePx(ref, got, rule, prop);
  if (rule.kind === 'exact') return compareExact(ref, got, prop);
  if (rule.kind === 'em') return compareEm(ref, got, ctx.fontSize, prop);
  if (rule.kind === 'colour') return compareColour(ref, got, prop);
  return cmp(prop, 'skip', null, ref, got, '');
}
