// fingerprint.mjs — name-blind identity vector.
//
// Weights encode the core requirement: a block may be named differently on
// every page and must still resolve to one identity. So class/id contributes
// the LEAST. Content semantics exist to keep structurally-identical-but-
// different-meaning blocks apart (a pricing grid and a testimonial grid are
// both h3 + p + a) without needing the model to arbitrate every such pair.
'use strict';

export const SEMANTIC_FLAGS = ['hasPrice', 'hasQuote', 'hasDate', 'hasNavLinks', 'hasFormFields'];

// Tuned from the brief's starting point (skeleton .30 / semantics .13): the
// "pricing vs testimonial" split test failed at ~0.91 with those defaults
// (the tag skeleton, atom profile, empty-children, and arity components all
// come out IDENTICAL for `.plan` vs `.quote` — the only signal that can pull
// them apart is semantics, plus a small assist from role that vanishes for
// same-length differently-spelled class names). Moved 0.05 from skeleton to
// semantics, exactly as instructed — re-verified all five tests hold
// simultaneously (see task-6-report.md).
const W = { skeleton: 0.25, atoms: 0.25, children: 0.20, arity: 0.08, semantics: 0.18, role: 0.04 };

// parse.mjs does not decode HTML entities — text nodes retain raw sequences
// like "&ldquo;" and "&rdquo;" verbatim (see tools/block-map/parse.mjs,
// addText: it slices raw source and only collapses whitespace). The fixture
// quote blocks (pricing.html .quote) rely on curly-quote entities to read as
// quotes, so semanticsOf must recognize the entity spelling too, not just a
// literal Unicode curly quote — otherwise hasQuote is always false and the
// plan/quote split loses its only real signal.
const ENTITY_QUOTES = /&l?dquo;|&r?dquo;|&#8220;|&#8221;|&quot;/gi;
function decodeQuoteEntities(s) {
  return s.replace(ENTITY_QUOTES, '"');
}

function allText(n) {
  return ((n.text || '') + ' ' + n.children.map(allText).join(' ')).trim();
}

function skeletonOf(node) {
  const tags = [];
  const walk = (x, d) => { if (d > 2) return; tags.push(x.tag); x.children.forEach((c) => walk(c, d + 1)); };
  node.children.forEach((c) => walk(c, 1));
  return tags.sort();
}

function semanticsOf(node) {
  const raw = allText(node);
  const t = decodeQuoteEntities(raw);
  const links = (function count(x) { return (x.tag === 'a' ? 1 : 0) + x.children.reduce((s, c) => s + count(c), 0); })(node);
  return {
    hasPrice: /[$€£]\s?\d|\b\d+\s?(usd|eur|gbp)\b|\/\s?(mo|yr|month|year)\b/i.test(t),
    // Straight or curly quote wrapping >= 8 chars of content — catches both
    // literal Unicode quotes and the decoded entity form above.
    hasQuote: /["“‘].{8,}["”’]/.test(t),
    hasDate: /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i.test(t),
    hasNavLinks: links >= 3 && t.length / Math.max(1, links) < 30,
    hasFormFields: false, // set below from block.atoms — see fingerprint()
  };
}

export function fingerprint(block) {
  const sem = semanticsOf(block.node);
  sem.hasFormFields = block.atoms.inputs > 0;
  return {
    skeleton: skeletonOf(block.node),
    atoms: block.atoms,
    arity: block.arity,
    childFps: block.children.map((c) => skeletonOf(c.node).join(',')).sort(),
    semantics: sem,
    roleHint: (block.classes.join(' ') + ' ' + block.id).toLowerCase(),
  };
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function countSim(a, b) {
  const keys = Object.keys(a);
  let num = 0, den = 0;
  for (const k of keys) { num += Math.min(a[k], b[k]); den += Math.max(a[k], b[k]); }
  return den === 0 ? 1 : num / den;
}

function flagSim(a, b) {
  let same = 0;
  for (const f of SEMANTIC_FLAGS) if (a[f] === b[f]) same++;
  return same / SEMANTIC_FLAGS.length;
}

function tokenSim(a, b) {
  return jaccard(a.split(/[\s-_]+/).filter(Boolean), b.split(/[\s-_]+/).filter(Boolean));
}

export function similarity(a, b) {
  const arity = 1 - Math.abs(a.arity - b.arity) / Math.max(a.arity, b.arity, 1);
  return Number((
    W.skeleton  * jaccard(a.skeleton, b.skeleton) +
    W.atoms     * countSim(a.atoms, b.atoms) +
    W.children  * jaccard(a.childFps, b.childFps) +
    W.arity     * arity +
    W.semantics * flagSim(a.semantics, b.semantics) +
    W.role      * tokenSim(a.roleHint, b.roleHint)
  ).toFixed(4));
}
