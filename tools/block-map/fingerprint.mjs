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

// Second hard cap, same shape as the tier-mismatch one above, for a
// residual the tier cap cannot reach: bem-card.html's `.card__body`
// (molecule, arity 1 — the ONLY child of its `.card` wrapper) scored 0.98
// against index.html's `.card` (molecule, arity 3 — one of three repeated
// siblings) and silently merged into the wrong canonical block. Both sides
// are tier `molecule`, so TIER_MISMATCH_CAP never fires; W.arity=0 (a
// deliberate fix-round-2 decision, see above) means the 1-vs-3 arity gap
// contributes nothing to the weighted sum either.
//
// Two alternatives were measured and rejected before this one:
//  - An ancestor/descendant guard: `.card__body`'s actual ancestors
//    (`.cards`, bem's own `.card`) land in DIFFERENT canonical blocks than
//    the one it wrongly merges into — zero ancestor/descendant pairs exist
//    among the merged members, so the guard would be a provable no-op. It
//    is also unsound in general (recursive menus, nested comment threads,
//    Bootstrap row-in-col-in-row all legitimately nest a block inside a
//    same-named block), and a guard-blocked pair scores >= MERGE_AT so it
//    would fall OUTSIDE the gray band — silent over-SPLITTING, the mirror
//    of the union-find over-merge bug already paid to fix once.
//  - Reactivating W.arity: no window exists. At w=0.02 the GROUND-TRUTH
//    must-merge `.features`/`.related` pair already breaks (0.9467 <
//    MERGE_AT); `.card__body` only clears 0.95 at w>=0.04.
//
// The real, measured signal: is this molecule a SINGLETON (the only child
// of its parent, arity 1) or one of a REPEATED set (arity > 1)? That is a
// genuine shape difference this fingerprint can see, unlike raw arity
// (which W.arity=0 rejected for a different reason — comparing ABSOLUTE
// arity punishes two true twins that happen to sit in differently-sized
// galleries on their respective pages; comparing "is it 1 vs is it >1" does
// not have that problem, since arity=1 is a structural fact about a node's
// OWN position — a lone child — not a page-layout artifact).
//
// Accepted cost: a molecule appearing solo on one page and 3-up on another
// no longer auto-merges — it lands in the gray band (measured ~0.90 for
// that shape) instead of silently over-merging with no recourse.
function isSoloVsRepeated(a, b) {
  return a.tier === 'molecule' && b.tier === 'molecule' && (a.arity === 1) !== (b.arity === 1);
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
  // Hard caps, applied AFTER the weighted sum — see TIER_MISMATCH_CAP and
  // isSoloVsRepeated above. Either condition caps the score; a pair that
  // hits both (can't happen here since isSoloVsRepeated requires matching
  // tier) would still just be capped once.
  if (a.tier !== b.tier || isSoloVsRepeated(a, b)) return Math.min(weighted, TIER_MISMATCH_CAP);
  return weighted;
}
