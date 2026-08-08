// extract.mjs — turn a generic node tree into a tiered block tree.
//
// Rules (spec §Boundary rule):
//   Tier 1 organisms: body-level semantic landmarks or class-bearing divs
//     that are not page-spanning wrappers.
//   Below that, a node is emitted when ANY of:
//     (a) repetition   — >= 3 structurally-similar siblings, AND it also
//                        satisfies (b). Repetition alone does not promote a
//                        node whose content is one atom type, or every <li>,
//                        nav link and logo becomes a named block and the map
//                        inflates ~10x.
//     (b) leaf cluster — >= 2 distinct atom types and no emitted descendants.
//     (c) semantic     — ul/ol/table/form/figure/nav.
//   Everything else is a layout wrapper: recursed THROUGH, never emitted.
'use strict';

export const ATOM_TAGS = new Set(['h1','h2','h3','h4','h5','h6','p','a','button','img','svg','input','label','li','span','strong','em']);
// NOTE: 'main' is deliberately excluded from LANDMARKS. Unlike header/nav/
// section/etc., <main> is a structural pass-through (the content root inside
// <body>), never itself a named block — no fixture page's ground truth lists
// a "Main" block. Keeping it out of LANDMARKS lets it fail isSemantic and
// fall through to the ordinary cluster check, which then excludes it via the
// "has emitted descendants" gate below (see isCluster).
const LANDMARKS = new Set(['header','nav','section','article','aside','footer','form']);
const SEMANTIC_BLOCK = new Set(['ul','ol','table','form','figure','nav']);
const SKIP = new Set(['script','style','link','meta','head','title','br','#root']);

const REPEAT_MIN = 3;
const WRAPPER_SPAN = 0.6;   // a node holding >60% of the page's text is a page wrapper

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
  const pageText = Math.max(1, textLen(body));

  const emitted = (n, siblings, d) => {
    if (SKIP.has(n.tag) || ATOM_TAGS.has(n.tag)) return null;
    const kids = n.children.filter((c) => !SKIP.has(c.tag));
    const atoms = atomCounts(n);
    const types = distinctAtomTypes(atoms);
    const arity = siblingArity(n, siblings);

    // `children` must be known before deciding (b) leaf-cluster: rule (b) is
    // "2+ atom types AND no emitted descendants" — a node whose descendants
    // already qualified as blocks (e.g. .grid wrapping 3 already-qualifying
    // .card molecules) is a layout wrapper, not a leaf cluster, even though
    // its aggregated atom counts satisfy the >=2-types test on their own.
    // Depth is capped on the CHILDREN's tier (d + 1), not this node's own d —
    // capping on `d` would let one extra molecule tier slip in under the cap.
    const children = (d + 1 >= depth) ? [] : kids.flatMap((c) => {
      const b = emitted(c, kids, d + 1);
      return b ? [b] : (c.children.length ? descend(c, d + 1) : []);
    });

    const isSemantic = SEMANTIC_BLOCK.has(n.tag) || LANDMARKS.has(n.tag);
    const isCluster = types >= 2 && children.length === 0;
    const isRepeat = arity >= REPEAT_MIN && isCluster;   // (a) requires (b)
    const isPageWrapper = textLen(n) / pageText > WRAPPER_SPAN;

    // Per the boundary rule, "page-spanning wrapper" only disqualifies the
    // class-bearing-div path (isRepeat/isCluster) — a genuine semantic
    // landmark (section/header/footer/...) is an organism regardless of how
    // much of the page's text lives under it. Single-section pages like
    // services.html put >60% of the page's text under one <section>; without
    // this exemption that legitimate section would be misread as a page
    // wrapper and excluded, along with everything under it.
    const qualifies = isSemantic || (!isPageWrapper && (isRepeat || isCluster));

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
