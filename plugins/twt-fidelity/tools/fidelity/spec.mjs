// spec.mjs — the reference-spec schema, its ID scheme, and its provenance rules.
//
// The ID scheme is load-bearing: `id` is what the builder's data-fid stamps
// join on, so it must survive re-extraction unchanged. It is derived from
// names + position, never from content — a content hash would rename an
// element the moment its copy was edited and orphan every stamp in the page.
'use strict';

export const PROPERTY_GROUPS = {
  geometry: ['box.x', 'box.y', 'box.w', 'box.h',
             'spacing.padding', 'spacing.margin', 'spacing.gap',
             'radius', 'border.width'],
  typography: ['type.family', 'type.size', 'type.lineHeight', 'type.weight',
               'type.letterSpacing', 'type.transform', 'type.align'],
  colour: ['fill.color', 'fill.opacity', 'bg.color', 'bg.image', 'border.color', 'shadow'],
  structure: ['children', 'role', 'text', 'layout.display', 'layout.direction',
              'layout.justify', 'layout.align'],
};

export function slugSegment(name) {
  const s = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'unnamed';
}

export function deriveId(pathNames, siblingIndex) {
  const segs = (pathNames ?? []).map(slugSegment);
  if (segs.length === 0) segs.push('root');
  return `${segs.join('.')}.${siblingIndex}`;
}

const DEFAULT_ELEMENT = () => ({
  id: null,
  role: null,
  provenance: 'measured',
  source: null,
  box: { x: 0, y: 0, w: 0, h: 0 },
  type: { family: null, size: null, lineHeight: null, weight: null,
          letterSpacing: null, transform: null, align: null },
  fill: { color: null, opacity: 1 },
  bg: { color: null, image: null },
  border: { width: 0, color: null },
  radius: [0, 0, 0, 0],
  shadow: [],
  spacing: { padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0 },
  layout: { display: null, direction: null, justify: null, align: null },
  text: null,
  children: [],
  positionalId: false,
});

// Shallow-merge one level deep so a caller supplying { box: { w: 100 } } keeps
// the default x/y/h rather than blanking them.
export function makeElement(partial = {}) {
  const base = DEFAULT_ELEMENT();
  for (const [k, v] of Object.entries(partial)) {
    base[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && !Array.isArray(base[k]))
      ? { ...base[k], ...v }
      : v;
  }
  if (!base.id) throw new Error('makeElement: every element needs an id');
  return base;
}

export function makeSpec({ target, source, widths, elements = [] }) {
  const measured = elements.filter((e) => e.provenance !== 'estimated').length;
  return {
    schema: 'twt-fidelity/1',
    target,
    source,
    widths,
    provenance: { measured, estimated: elements.length - measured },
    elements,
  };
}

export function isEstimated(spec) {
  return (spec?.provenance?.estimated ?? 0) > 0;
}

export function specFilename(spec) {
  return isEstimated(spec) ? 'reference-spec-estimated.json' : 'reference-spec.json';
}

// A degraded run must never render under the measured run's filename — the
// invariant /twt-figma-dev-audit already earned the hard way.
export function reportBasenames(spec) {
  return isEstimated(spec)
    ? { md: 'validation-report-estimated.md', html: 'fidelity-report-estimated.html' }
    : { md: 'validation-report.md', html: 'fidelity-report.html' };
}
