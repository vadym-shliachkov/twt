// extract.mjs — turn a generic node tree into a tiered block tree.
//
// Rules (spec §Boundary rule):
//   Tier 1 organisms: body-level semantic landmarks that don't themselves
//     aggregate 2+ other landmarks, or class-bearing divs that qualify below.
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
//                        doesn't itself aggregate 2+ other landmarks.
//   Everything else is a layout wrapper: recursed THROUGH, never emitted.
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

const REPEAT_MIN = 3;

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

    // `truncated` records whether we stopped short of actually looking at
    // descendants (depth cap), as opposed to genuinely finding none. This
    // matters below: `children` forced to [] by the cap must NOT be read as
    // proof this node has "no emitted descendants" (rule b) — a wrapper that
    // happens to sit exactly at the cap would otherwise be misread as a leaf
    // cluster and silently swallow whatever real blocks live beneath it.
    // Depth is capped on the CHILDREN's tier (d + 1), not this node's own d —
    // capping on `d` would let one extra molecule tier slip in under the cap.
    const truncated = d + 1 >= depth;
    const children = truncated ? [] : kids.flatMap((c) => {
      const b = emitted(c, kids, d + 1);
      return b ? [b] : (c.children.length ? descend(c, d + 1) : []);
    });

    // A landmark that directly wraps 2+ other landmarks/semantic blocks
    // (e.g. a whole-page <section>/<article> wrapping header + a content
    // section + footer) is aggregating distinct organisms, not itself one —
    // excluding it lets the real organisms underneath surface directly. A
    // landmark wrapping exactly one such child (<header><nav>...</nav>
    // </header>) is a genuine part-of relationship and still qualifies.
    const directLandmarkKids = kids.filter((c) => SEMANTIC_BLOCK.has(c.tag) || LANDMARKS.has(c.tag)).length;
    const isLandmarkAggregate = directLandmarkKids >= 2;
    const isSemantic = (SEMANTIC_BLOCK.has(n.tag) || LANDMARKS.has(n.tag)) && !isLandmarkAggregate;

    // (b) leaf cluster: "no emitted descendants" is gated on `children`, not
    // the raw atom aggregate — atoms bubble up unchanged through any number
    // of wrapper divs, so the aggregate alone can't tell a leaf cluster from
    // a wrapper around one. Also false whenever `truncated`, for the reason
    // documented above.
    const isCluster = !truncated && hasEnoughTypes && children.length === 0;
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
      arity, atoms, children, node: n,
      selector: selectorFor(n, 0),
    };
  };

  // Recurse THROUGH a wrapper without emitting it.
  //
  // NOTE the `d` is NOT incremented here. Depth counts EMITTED TIERS, not DOM
  // levels. Elementor output buries a card under four nested wrapper divs; if
  // wrappers spent depth budget, a depth cap of 4 would cut the card off before
  // it was ever reached and services.html would map to nothing.
  const descend = (n, d) => {
    if (d >= depth) return [];
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
