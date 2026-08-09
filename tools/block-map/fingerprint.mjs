// fingerprint.mjs — name-blind identity vector.
//
// Weights encode the core requirement: a block may be named differently on
// every page and must still resolve to one identity. So class/id contributes
// the LEAST. Content semantics exist to keep structurally-identical-but-
// different-meaning blocks apart (a pricing grid and a testimonial grid are
// both h3 + p + a) without needing the model to arbitrate every such pair.
'use strict';

export const SEMANTIC_FLAGS = ['hasPrice', 'hasQuote', 'hasDate', 'hasNavLinks', 'hasFormFields'];

// Fix-round-2 weights (see task-6-report.md): arity measures a page
// artifact, not identity — `.features` sits alone on its page (arity 1)
// while `.related` sits beside two siblings (arity 3), so two twins of the
// SAME block were scored worse against each other purely because of
// unrelated neighbours on their respective pages. Zeroing W.arity removed
// that noise and opened a real gap between the must-merge and
// must-not-merge pairs found in the full 355-pair labeled sweep; the 0.05
// moved off skeleton in fix-round-1 stays on semantics.
const W = { skeleton: 0.33, atoms: 0.25, children: 0.20, arity: 0.00, semantics: 0.18, role: 0.04 };

// A hard discriminator, not a weighted term: an organism and a molecule can
// share an identical inner skeleton (page-wrap.html's top-level `.hero`
// organism vs index.html's nested `.hero__copy` molecule both wrap bare
// h1+p+a and score 0.98 on every other dimension) but they are still
// different GROUND-TRUTH rows at different structural levels, and must
// never auto-merge. Folding `tier` in as just another weighted term
// (W.tier * (a.tier===b.tier?1:0)) would only NUDGE the score down —
// insufficient when every other dimension already agrees near-perfectly.
// Capping the tier-mismatch case below MERGE_AT (0.95) by construction is
// what "hard discriminator" means here; same-tier pairs are completely
// unaffected (the cap only ever activates when tiers differ), so Task 6's
// measured score table (all five pairs are same-tier vs same-tier) is
// untouched — verified in tests/block-map-fingerprint.test.mjs.
const TIER_MISMATCH_CAP = 0.90;

// parse.mjs now decodes HTML entities in text nodes (fix-round-2 — see
// task-6-report.md), so `allText()` below already sees real curly quotes,
// not raw "&ldquo;"/"&rdquo;" sequences. No local entity handling needed
// here anymore.

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
  const t = allText(node);
  const links = (function count(x) { return (x.tag === 'a' ? 1 : 0) + x.children.reduce((s, c) => s + count(c), 0); })(node);
  return {
    hasPrice: /[$€£]\s?\d|\b\d+\s?(usd|eur|gbp)\b|\/\s?(mo|yr|month|year)\b/i.test(t),
    hasQuote: /["“”„«»]|‘|’{2}/.test(t) && /["“”].{10,}["“”]/.test(t),
    hasDate: /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i.test(t),
    hasNavLinks: links >= 3 && t.length / Math.max(1, links) < 30,
    hasFormFields: false, // set below from block.atoms — see fingerprint()
  };
}

export function fingerprint(block) {
  const sem = semanticsOf(block.node);
  sem.hasFormFields = block.atoms.inputs > 0;
  return {
    tier: block.tier,
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
  const weighted = Number((
    W.skeleton  * jaccard(a.skeleton, b.skeleton) +
    W.atoms     * countSim(a.atoms, b.atoms) +
    W.children  * jaccard(a.childFps, b.childFps) +
    W.arity     * arity +
    W.semantics * flagSim(a.semantics, b.semantics) +
    W.role      * tokenSim(a.roleHint, b.roleHint)
  ).toFixed(4));
  // Hard cap, applied AFTER the weighted sum — see TIER_MISMATCH_CAP above.
  return a.tier !== b.tier ? Math.min(weighted, TIER_MISMATCH_CAP) : weighted;
}
