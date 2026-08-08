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
// "Essentially all" of a node's content living inside its landmark children
// — a tight tolerance, not a generous one. A real heading, lede, or
// copyright line of its own pulls this well below the threshold in every
// case tested; see fix-round-3 report for the exact numbers per fixture.
const AGGREGATE_RATIO = 0.95;

const REPEAT_MIN = 3;

function textLen(n) {
  return (n.text || '').length + n.children.reduce((s, c) => s + textLen(c), 0);
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

  const emitted = (n, siblings, d) => {
    if (SKIP.has(n.tag) || ATOM_TAGS.has(n.tag)) return null;
    const kids = n.children.filter((c) => !SKIP.has(c.tag));
    const atoms = atomCounts(n);
    const hasEnoughTypes = distinctAtomTypes(atoms) >= 2;
    const arity = siblingArity(n, siblings);

    // Children are always computed from the FULL tree — `depth` never gates
    // this recursion. Qualification (isCluster's "no emitted descendants"
    // check in particular) must be decided from what's REALLY there; if the
    // cap hid real descendants from that decision, a wrapper sitting near
    // the cap could masquerade as a leaf cluster and swallow whatever's
    // really beneath it. depth is applied ONLY to the `children` field of
    // an already-qualifying block, below, as pure display truncation.
    const children = kids.flatMap((c) => {
      const b = emitted(c, kids, d + 1);
      return b ? [b] : (c.children.length ? descend(c, d + 1) : []);
    });

    // A landmark that's a pure aggregate of other landmarks — none of its
    // own content, just relaying 1+ nested landmarks — is a wrapper, not a
    // block: e.g. a whole-page <section>/<article> wrapping header + a
    // content section + footer, or a <section> that wraps exactly one other
    // <section> and adds nothing. Scoped to AGGREGATABLE tags only (see
    // above) and gated on a content ratio, not a bare count, so a <section>
    // carrying its own heading/lede alongside a nested <section> — or a
    // <footer>/<header> composing nav+form/nav+list+copyright, which isn't
    // AGGREGATABLE at all — is never excluded.
    const directLandmarkKids = kids.filter((c) => LANDMARKS.has(c.tag));
    const landmarkText = directLandmarkKids.reduce((s, c) => s + textLen(c), 0);
    const ownText = textLen(n);
    const isLandmarkAggregate = AGGREGATABLE.has(n.tag) && directLandmarkKids.length >= 1
      && ownText > 0 && landmarkText / ownText >= AGGREGATE_RATIO;
    const isSemantic = (SEMANTIC_BLOCK.has(n.tag) || LANDMARKS.has(n.tag)) && !isLandmarkAggregate;

    // (b) leaf cluster: "no emitted descendants" is gated on `children`, not
    // the raw atom aggregate — atoms bubble up unchanged through any number
    // of wrapper divs, so the aggregate alone can't tell a leaf cluster from
    // a wrapper around one. `children` here is always the full, untruncated
    // computation (see above), so this reflects what's really beneath n.
    const isCluster = hasEnoughTypes && children.length === 0;
    // (a) repetition requires the same >=2-atom-types floor as (b) (the
    // single-atom-type veto — see ATOM_TAGS comment), but deliberately NOT
    // "no emitted descendants". That's rule (b)'s condition, not (a)'s: a
    // repeated card wrapping a <ul> or a BEM `.card__body` div has emitted
    // descendants (the list / the body div each qualify on their own), but
    // the repeated node itself is still the real, nameable repeated block.
    const isRepeat = arity >= REPEAT_MIN && hasEnoughTypes;

    const qualifies = isSemantic || isRepeat || isCluster;

    if (!qualifies) return null;
    return {
      tag: n.tag, classes: n.classes, id: n.id,
      tier: d === 0 ? 'organism' : 'molecule',
      arity, atoms,
      // Depth is a pure display truncation applied here, AFTER qualification
      // has already been decided from the real tree above — capping on the
      // CHILDREN's tier (d + 1), not this node's own d.
      children: d + 1 >= depth ? [] : children,
      node: n,
      selector: selectorFor(n, 0),
    };
  };

  // Recurse THROUGH a wrapper without emitting it.
  //
  // NOTE the `d` is NOT incremented here. Depth counts EMITTED TIERS, not DOM
  // levels. Elementor output buries a card under four nested wrapper divs; if
  // wrappers spent depth budget, a depth cap of 4 would cut the card off before
  // it was ever reached and services.html would map to nothing.
  //
  // NOTE this no longer caps on `depth` either (fix-round-3): qualification
  // must see the full tree regardless of how deep a chain of non-qualifying
  // wrappers runs. Real DOM trees are finite and acyclic (parse.mjs builds a
  // strict tree from a linear token stream), so this remains bounded by
  // actual document depth — there is no longer a depth-cap safety valve
  // against pathologically deep markup, which is an accepted tradeoff of
  // making depth a pure display concern; see fix-round-3 report.
  const descend = (n, d) => {
    const kids = n.children.filter((c) => !SKIP.has(c.tag));
    return kids.flatMap((c) => {
      const b = emitted(c, kids, d);
      return b ? [b] : descend(c, d);
    });
  };

  const top = body.children.filter((c) => !SKIP.has(c.tag));
  return top.flatMap((c) => {
    const b = emitted(c, top, 0);
    return b ? [b] : descend(c, 0);
  });
}

function findBody(root) {
  let found = null;
  const walk = (n) => { if (n.tag === 'body') { found = n; return; } n.children.forEach(walk); };
  walk(root);
  return found;
}
