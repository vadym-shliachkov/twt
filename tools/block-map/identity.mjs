// identity.mjs — collapse block instances into canonical blocks.
//
// Deterministic where it can be, judged where it cannot: >=0.95 auto-merges,
// <=0.60 auto-splits, and only the band between goes to the model. Two runs
// over an unchanged site differ ONLY in the adjudicated band.
'use strict';
import { fingerprint, similarity } from './fingerprint.mjs';

export const MERGE_AT = 0.95;   // amended from 0.90 — see task-6 report / plan amendment
export const SPLIT_AT = 0.60;
export const GRAY_CAP = 60;
const EXCERPT = 400;

const ROLE_NOUN = [
  [/head|masthead|topbar/, 'Site header'],
  [/foot/, 'Site footer'],
  // Checked BEFORE /hero|banner|jumbo/: a BEM sub-block like `.hero__copy`
  // contains "hero" as a mere substring of its own name, so testing the
  // (more specific) "is this a text/heading group" pattern first is what
  // lets it read as "Heading group" rather than "Hero" — matches
  // GROUND-TRUTH.md, and no other fixture class collides the other way
  // (verified: "copy"/"content"/"text" appear in no other alias).
  [/copy|content|text/, 'Heading group'],
  [/hero|banner|jumbo/, 'Hero'],
  [/nav|menu/, 'Navigation'],
  [/card|box|teaser|tile/, 'Card'],
  [/plan|pricing|tier/, 'Plan'],
  [/quote|testimonial|review/, 'Testimonial'],
  [/grid|list|features|related|svc|services/, 'Card grid'],
  [/cta|action/, 'CTA band'],
  [/logo/, 'Logo row'],
];

function nameFor(members) {
  const hay = members.flatMap((m) => [...m.block.classes, m.block.id]).join(' ').toLowerCase();
  for (const [re, noun] of ROLE_NOUN) if (re.test(hay)) return noun;
  const tag = members[0].block.tag;
  if (tag === 'header') return 'Site header';
  if (tag === 'footer') return 'Site footer';
  if (tag === 'nav') return 'Navigation';
  return members[0].block.tier === 'organism' ? 'Section' : 'Group';
}

function excerpt(block) {
  const render = (n, budget) => {
    if (budget <= 0) return '';
    const cls = n.classes.length ? ` class="${n.classes.join(' ')}"` : '';
    const inner = n.text || n.children.map((c) => render(c, budget / 2)).join('');
    return `<${n.tag}${cls}>${inner}</${n.tag}>`;
  };
  return render(block.node, EXCERPT).slice(0, EXCERPT);
}

const aliasOf = (b) => (b.classes.length ? '.' + b.classes[0] : (b.id ? '#' + b.id : b.tag));

// --- Union-find over the pairwise similarity graph -------------------------
//
// The brief's reference loop assigns each instance to the group whose FIRST
// member (the one that founded the group) scores highest, and that anchor
// fingerprint is never updated afterward. That makes the result depend on
// *arrival order*: three genuine instances of the same block, where sim(1,2)
// = 0.94 (just under MERGE_AT) but sim(1,3) = 0.96 and sim(2,3) = 0.97, come
// out as ONE group `[1,2,3]` when instance 3 happens to found the group
// (order [3,1,2]) but as TWO groups `[1]` + `[2,3]` under every order where
// 1 or 2 founds first — same instances, same pairwise scores, different
// canonical-block count. That directly violates this file's own header
// promise ("two runs over an unchanged site differ ONLY in the adjudicated
// band"). Comparing a new instance against the BEST-scoring existing member
// (rather than only the founder) narrows but does not close this gap: the
// partition still depends on which item happens to seed a group before a
// bridging item arrives (verified: same triangle, still order-dependent).
//
// A connected-components pass over the >=MERGE_AT edge graph is the only one
// of the three that is provably invariant under instance order — order never
// enters the computation, only the (symmetric) edge set does. Same
// asymptotic cost as the greedy versions (both are O(n^2) pairwise
// similarity calls in the worst case).
//
// This does not eliminate the classic single-linkage "chaining" risk: if a
// genuinely-different pair A/C (score in the gray band, say 0.70) both sit
// >=MERGE_AT next to a bridge item B, A and C land in the same final group
// under ANY clustering strategy that admits on pairwise edges — that is a
// property of transitive threshold clustering, not an artifact of this
// implementation, and confirmed still order-independent (same result for
// all 6 orderings of A/B/C). See task-7 report, "residual risk" section.
function connectedComponents(n, edge) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (edge(i, j)) union(i, j);
    }
  }
  const order = []; // first-seen order of each root, for stable, deterministic group numbering
  const byRoot = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) { byRoot.set(r, []); order.push(r); }
    byRoot.get(r).push(i);
  }
  return order.map((r) => byRoot.get(r));
}

export function cluster(instances) {
  const fps = instances.map((i) => fingerprint(i.block));
  const n = instances.length;

  // Pairwise similarity is computed once and reused for both the merge
  // graph and the gray band, so the two never disagree about a given pair's
  // score.
  const simCache = new Map();
  const pairKey = (i, j) => (i < j ? i * n + j : j * n + i);
  const simOf = (i, j) => {
    if (i === j) return 1;
    const k = pairKey(i, j);
    if (simCache.has(k)) return simCache.get(k);
    const s = similarity(fps[i], fps[j]);
    simCache.set(k, s);
    return s;
  };

  const componentMembers = connectedComponents(n, (i, j) => simOf(i, j) >= MERGE_AT);
  const groups = componentMembers.map((members) => ({ members }));

  // Gray band: cross-group pairs whose closest members neither merged nor
  // cleanly split. Built from the SAME `groups` array, in the SAME order,
  // that `blocks` below is built from — so the 'B'+(index+1) ids assigned
  // here and the ids `blocks` assigns independently necessarily agree (both
  // are pure functions of `groups`' index, and `groups` is never reordered
  // or filtered between the two — verified by a dedicated cross-check test).
  const gray = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      let s = 0, aRep = groups[a].members[0], bRep = groups[b].members[0];
      for (const i of groups[a].members) {
        for (const j of groups[b].members) {
          const sij = simOf(i, j);
          if (sij > s) { s = sij; aRep = i; bRep = j; }
        }
      }
      if (s > SPLIT_AT && s < MERGE_AT) {
        gray.push({
          a: 'B' + String(a + 1).padStart(2, '0'),
          b: 'B' + String(b + 1).padStart(2, '0'),
          score: s,
          aExcerpt: excerpt(instances[aRep].block),
          bExcerpt: excerpt(instances[bRep].block),
        });
      }
    }
  }
  gray.sort((x, y) => Math.abs(x.score - 0.75) - Math.abs(y.score - 0.75));
  const grayBand = gray.slice(0, GRAY_CAP);

  const blocks = groups.map((g, gi) => {
    const members = g.members.map((i) => instances[i]);
    const pages = [...new Set(members.map((m) => m.page))];
    return {
      id: 'B' + String(gi + 1).padStart(2, '0'),
      name: nameFor(members),
      tier: members[0].block.tier,
      aliases: [...new Set(members.map((m) => aliasOf(m.block)))],
      parents: [], children: [],
      reuse: { pages: pages.length, instances: members.length },
      instances: members.map((m) => ({ page: m.page, selector: m.selector })),
      _members: members,
    };
  });

  linkEdges(blocks);
  return { blocks, grayBand, unadjudicated: Math.max(0, gray.length - grayBand.length) };
}

// Parent/child edges follow the extraction tree: a block is a parent of every
// canonical block its instances directly contain.
function linkEdges(blocks) {
  const owner = new Map();
  for (const b of blocks) for (const m of b._members) owner.set(m.block, b.id);
  for (const b of blocks) {
    const kids = new Set();
    for (const m of b._members) for (const c of m.block.children) {
      const id = owner.get(c);
      if (id && id !== b.id) kids.add(id);
    }
    b.children = [...kids];
  }
  for (const b of blocks) for (const cid of b.children) {
    const child = blocks.find((x) => x.id === cid);
    if (child && !child.parents.includes(b.id)) child.parents.push(b.id);
  }
}
