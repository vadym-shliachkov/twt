// extract.mjs — turn a generic node tree into a tiered block tree.
//
// Rules (spec §Boundary rule):
//   Tier 1 organisms: body-level semantic landmarks that don't themselves
//     aggregate other landmarks with no content of their own, or
//     class-bearing divs that qualify below.
//   Below that, a node is emitted when ANY of:
//     (a) repetition   — >= 3 structurally-similar siblings AND >= 2 distinct
//                        atom types. Repetition alone does not promote a
//                        node whose content is one atom type, or every <li>,
//                        nav link and logo becomes a named block and the map
//                        inflates ~10x. Unlike (b), this does NOT also
//                        require "no emitted descendants" — a repeated card
//                        that wraps a <ul> or a BEM `.card__body` div is
//                        still the real repeated block; see fix-round-2.
//     (b) leaf cluster — >= 2 distinct atom types and no emitted descendants.
//     (c) semantic     — ul/ol/table/form/figure/nav, or a landmark that
//                        isn't a pure aggregate of other landmarks (see
//                        isLandmarkAggregate below).
//   Everything else is a layout wrapper: recursed THROUGH, never emitted.
//   Qualification (whether a node is a, b, or c above) is decided from the
//   FULL, untruncated tree — `opts.depth` only truncates the `children`
//   array of an already-qualifying block for display. See fix-round-3.
'use strict';

export const ATOM_TAGS = new Set([
  'h1','h2','h3','h4','h5','h6','p','a','button','img','svg','input','label',
  'li','span','strong','em',
  // Table internals are data, not blocks — same treatment as <li>: never
  // individually promoted, but an <img>/<a> inside a cell still counts
  // toward an ancestor's (the <table>'s) atom aggregate via atomCounts'
  // unconditional walk. Without this, every <tr> independently qualifies
  // under rule (a) (3+ identical rows, 2+ atom types per row) and a
  // 200-row table yields 200 anonymous molecules — the exact inflation
  // REPEAT_MIN + the 2-type floor exist to prevent.
  'tr','td','th','thead','tbody','tfoot',
]);
// NOTE: 'main' is deliberately excluded from LANDMARKS. Unlike header/nav/
// section/etc., <main> is a structural pass-through (the content root inside
// <body>), never itself a named block — no fixture page's ground truth lists
// a "Main" block. Keeping it out of LANDMARKS lets it fail isSemantic and
// fall through to the ordinary cluster check: excluded when it wraps other
// emitted landmarks (it then has emitted descendants, failing rule b), but
// still surfaces as a leaf cluster in its own right on a landmark-free page
// whose <main> holds raw content (h1/p) directly with nothing else to wrap.
const LANDMARKS = new Set(['header','nav','section','article','aside','footer','form']);
const SEMANTIC_BLOCK = new Set(['ul','ol','table','form','figure','nav']);
const SKIP = new Set(['script','style','link','meta','head','title','br','#root']);

// Only the generic, content-grouping landmarks are eligible to be treated as
// a pure "aggregate" wrapper (see isLandmarkAggregate). header/nav/form/
// footer are NEVER excluded this way: composing several distinct
// sub-widgets (nav + a search form; nav + a social list + a copyright line)
// is their normal, expected role, not a sign of accidental nesting — unlike
// a <section>/<article>/<aside> that turns out to hold nothing but one or
// more other landmarks and none of its own content, which really is just a
// generic structural wrapper that happened to pick up a semantic tag name.
const AGGREGATABLE = new Set(['section', 'article', 'aside']);

const REPEAT_MIN = 3;

// Same type-matching rules atomCounts uses below, extracted so a single
// NODE (not just its descendants) can be tested directly — see hasOwnAtoms.
function isAtomicTag(x) {
  const t = x.tag;
  return /^h[1-6]$/.test(t) || t === 'p' || t === 'a' || t === 'button' || x.classes.includes('btn')
    || t === 'img' || t === 'svg' || t === 'input' || t === 'textarea' || t === 'select'
    || t === 'ul' || t === 'ol';
}

// Does this node carry any atom-worthy content itself, or anywhere in its
// own subtree? Used by isLandmarkAggregate (see below) — deliberately a
// SHAPE test (does real content exist at all), not a size/ratio test: a
// single <h2>, one <img>, or a one-word <p>Hi</p> all make this true
// regardless of how much text sits in a sibling landmark, which is exactly
// what a length-based ratio could never guarantee. See fix-round-3 report,
// "Blocker 1", for the length-dependent bug this replaces.
function hasOwnAtoms(n) {
  return isAtomicTag(n) || n.children.some(hasOwnAtoms);
}

export function atomCounts(n) {
  const a = { headings: 0, text: 0, links: 0, buttons: 0, images: 0, inputs: 0, lists: 0 };
  const walk = (x) => {
    const t = x.tag;
    if (/^h[1-6]$/.test(t)) a.headings++;
    else if (t === 'p') a.text++;
    else if (t === 'a') a.links++;
    else if (t === 'button' || x.classes.includes('btn')) a.buttons++;
    else if (t === 'img' || t === 'svg') a.images++;
    else if (t === 'input' || t === 'textarea' || t === 'select') a.inputs++;
    else if (t === 'ul' || t === 'ol') a.lists++;
    x.children.forEach(walk);
  };
  n.children.forEach(walk);
  return a;
}

const distinctAtomTypes = (a) => Object.values(a).filter((v) => v > 0).length;

// Shape key used ONLY for sibling-repetition detection — deliberately coarse.
function shapeKey(n) {
  const tags = [];
  const walk = (x, d) => { if (d > 2) return; tags.push(x.tag); x.children.forEach((c) => walk(c, d + 1)); };
  n.children.forEach((c) => walk(c, 1));
  return n.tag + '|' + tags.sort().join(',');
}

function siblingArity(n, siblings) {
  const k = shapeKey(n);
  return siblings.filter((s) => shapeKey(s) === k).length;
}

function selectorFor(n, index) {
  const base = n.classes.length ? n.tag + '.' + n.classes.join('.') : n.tag;
  return n.id ? `${n.tag}#${n.id}` : (index > 0 ? `${base}:nth-of-type(${index + 1})` : base);
}

export function extractBlocks(root, opts = {}) {
  const depth = opts.depth ?? 4;
  const body = findBody(root) || root;

  // --- Pass 1: analyze (depth-independent, memoized per node) -------------
  //
  // Whether a node qualifies as a block, its arity, and its atoms never
  // depend on `d` (the tier it would be reported at) — only the FINAL
  // `tier` field does. Earlier rounds recomputed a node's whole subtree
  // once "for real" (as part of its parent's children) and, if the parent
  // failed to qualify, AGAIN via descend()'s fallback at a different `d` —
  // repeated at every wrapper level, which is exponential in the depth of a
  // non-qualifying wrapper chain (confirmed: ~2x cost per wrapper level;
  // W=14 wrappers took 127ms, W=200 didn't finish in 10 minutes — see
  // fix-round-4 report, Blocker 2). Splitting the `d`-independent analysis
  // from the `d`-dependent tier-stamping (pass 2, below) and memoizing pass
  // 1 by node identity means every node is analyzed exactly once, however
  // many non-qualifying wrapper ancestors it sits under.
  const memo = new Map();
  const analyze = (n, siblings) => {
    if (memo.has(n)) return memo.get(n);
    const kids = n.children.filter((c) => !SKIP.has(c.tag));
    const kidResults = kids.map((c) => analyze(c, kids));

    if (SKIP.has(n.tag) || ATOM_TAGS.has(n.tag)) {
      const result = { qualifies: false, tag: n.tag, classes: n.classes, id: n.id, arity: 1, atoms: null, node: n, kids: kidResults };
      memo.set(n, result);
      return result;
    }

    const atoms = atomCounts(n);
    const hasEnoughTypes = distinctAtomTypes(atoms) >= 2;
    const arity = siblingArity(n, siblings);

    // A landmark that's a pure aggregate of other landmarks — none of its
    // own content, just relaying 1+ nested landmarks — is a wrapper, not a
    // block: e.g. a whole-page <section>/<article> wrapping header + a
    // content section + footer, or a <section> that wraps exactly one other
    // <section> and adds nothing. Scoped to AGGREGATABLE tags only (see
    // above), and gated on SHAPE — does any non-landmark child carry atoms
    // of its own — not on a text-length ratio (see fix-round-4, Blocker 1,
    // for why a ratio doesn't work). A <section> carrying its own heading/
    // lede/image alongside a nested <section> — or a <footer>/<header>
    // composing nav+form/nav+list+copyright, which isn't AGGREGATABLE at
    // all — is never excluded, regardless of size.
    const directLandmarkKids = kids.filter((c) => LANDMARKS.has(c.tag));
    const nonLandmarkKidsWithOwnAtoms = kids.filter((c) => !LANDMARKS.has(c.tag) && hasOwnAtoms(c));
    const isLandmarkAggregate = AGGREGATABLE.has(n.tag) && directLandmarkKids.length >= 1
      && nonLandmarkKidsWithOwnAtoms.length === 0;
    const isSemantic = (SEMANTIC_BLOCK.has(n.tag) || LANDMARKS.has(n.tag)) && !isLandmarkAggregate;

    // (b) leaf cluster: "no emitted descendants" — a non-qualifying child's
    // content bubbles up THROUGH it (wrapper pass-through), so "has emitted
    // descendants" means "flattening kids through non-qualifying nodes
    // yields >=1 qualifying node". `d`-independent, and computed once from
    // the already-memoized kidResults — no re-walking of the DOM here.
    const flatKids = flattenQualifying(kidResults);
    const isCluster = hasEnoughTypes && flatKids.length === 0;
    // (a) repetition requires the same >=2-atom-types floor as (b) (the
    // single-atom-type veto — see ATOM_TAGS comment), but deliberately NOT
    // "no emitted descendants". That's rule (b)'s condition, not (a)'s: a
    // repeated card wrapping a <ul> or a BEM `.card__body` div has emitted
    // descendants (the list / the body div each qualify on their own), but
    // the repeated node itself is still the real, nameable repeated block.
    const isRepeat = arity >= REPEAT_MIN && hasEnoughTypes;

    const result = {
      qualifies: isSemantic || isRepeat || isCluster,
      tag: n.tag, classes: n.classes, id: n.id, arity, atoms, node: n, kids: kidResults,
    };
    memo.set(n, result);
    return result;
  };

  const flattenQualifying = (results) => results.flatMap((r) => (r.qualifies ? [r] : flattenQualifying(r.kids)));

  // --- Pass 2: realize (cheap, linear walk of the already-analyzed tree) --
  //
  // Stamps `tier` from `d` and truncates `children` for display. No
  // re-analysis happens here — this only ever reads `.kids`, the memoized
  // pass-1 results — so this pass is O(node count), not exponential.
  // Depth is applied here, exactly once, per fix-round-3: qualification
  // (pass 1, above) never depends on `d`/`depth` at all.
  //
  // NOTE the `d` passed to a non-qualifying node's kids is NOT incremented
  // — depth counts EMITTED TIERS, not DOM levels. Elementor output buries a
  // card under four nested wrapper divs; if wrappers spent depth budget, a
  // depth cap of 4 would cut the card off before it was ever reached and
  // services.html would map to nothing.
  const realize = (results, d) => results.flatMap((r) => {
    if (!r.qualifies) return realize(r.kids, d);
    return [{
      tag: r.tag, classes: r.classes, id: r.id,
      tier: d === 0 ? 'organism' : 'molecule',
      arity: r.arity, atoms: r.atoms, node: r.node,
      children: d + 1 >= depth ? [] : realize(r.kids, d + 1),
      selector: selectorFor(r.node, 0),
    }];
  });

  const top = body.children.filter((c) => !SKIP.has(c.tag));
  const topResults = top.map((c) => analyze(c, top));
  return realize(topResults, 0);
}

function findBody(root) {
  let found = null;
  const walk = (n) => { if (n.tag === 'body') { found = n; return; } n.children.forEach(walk); };
  walk(root);
  return found;
}
