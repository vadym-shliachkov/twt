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

// Whole-TOKEN keyword lists (exact match, not regex substring). Order is
// the tie-break when a class carries multiple tokens that separately match
// different categories (e.g. a real class alongside an unrelated utility
// class) — copy/content/text is deliberately LAST because those three
// words are common English/Tailwind fragments ("copyright", "text-center",
// "content-nav") and should only win when nothing more specific matched.
const ROLE_NOUN = [
  [['head', 'masthead', 'topbar'], 'Site header'],
  [['foot'], 'Site footer'],
  [['hero', 'banner', 'jumbo'], 'Hero'],
  [['nav', 'menu'], 'Navigation'],
  [['card', 'box', 'teaser', 'tile'], 'Card'],
  [['plan', 'pricing', 'tier'], 'Plan'],
  [['quote', 'testimonial', 'review'], 'Testimonial'],
  [['grid', 'list', 'features', 'related', 'svc', 'services'], 'Card grid'],
  [['cta', 'action'], 'CTA band'],
  [['logo'], 'Logo row'],
  [['copy', 'content', 'text'], 'Heading group'],
];

// A class contributes candidate TOKENS at two priority levels:
//
//  - PRIMARY: for a BEM class ("block__element"), only the part AFTER the
//    LAST "__" — the element — is primary. The block-prefix part is
//    deliberately NOT a primary candidate: `.hero__copy`'s "hero" would
//    otherwise out-rank "copy" simply because Hero sits earlier in
//    ROLE_NOUN than the (now-last) copy/content/text category, which is
//    exactly the substring-style collision this fix removes. For a
//    non-BEM class, hyphen-split words ARE primary (so `.site-head`'s
//    "head" token still resolves it to "Site header" — real compound
//    class names, not just Tailwind-style utility classes, use hyphens).
//  - FALLBACK: for a BEM class only, the block-prefix part (e.g. "card"
//    from `.card__body`) — used ONLY if no primary token anywhere matched
//    anything, to compose "<BlockNoun> <element>" (e.g. "Card body").
function classTokens(raw) {
  const bem = raw.lastIndexOf('__');
  if (bem === -1) return { primary: raw.split('-').filter(Boolean), fallbackBlock: null, elementRaw: null };
  return { primary: [raw.slice(bem + 2)], fallbackBlock: raw.slice(0, bem), elementRaw: raw.slice(bem + 2) };
}

function matchCategory(token) {
  const norm = token.toLowerCase();
  // Light, deliberately narrow pluralization: only strip a single trailing
  // "s" so ".plans"/".quotes"/".cards" resolve to the same category as
  // their singular form, without false-positiving short unrelated words.
  const singular = norm.length > 3 && norm.endsWith('s') ? norm.slice(0, -1) : null;
  for (const [keywords, noun] of ROLE_NOUN) {
    if (keywords.includes(norm) || (singular && keywords.includes(singular))) return noun;
  }
  return null;
}

export function nameFor(members) {
  const rawClasses = members.flatMap((m) => [...m.block.classes, m.block.id]).filter(Boolean).map((c) => c.toLowerCase());

  const primaryTokens = [];
  const fallbacks = []; // [{ blockToken, elementRaw }]
  for (const raw of rawClasses) {
    const { primary, fallbackBlock, elementRaw } = classTokens(raw);
    primaryTokens.push(...primary);
    if (fallbackBlock) fallbacks.push({ blockToken: fallbackBlock, elementRaw });
  }

  for (const token of primaryTokens) {
    const noun = matchCategory(token);
    if (noun) return noun;
  }
  for (const { blockToken, elementRaw } of fallbacks) {
    const noun = matchCategory(blockToken);
    if (noun) return `${noun} ${elementRaw}`; // e.g. "Card body" for .card__body
  }

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

// --- Agglomerative complete-linkage clustering ------------------------------
//
// Fix-round history on this function:
//
// 1) The brief's reference loop assigned each instance to the group whose
//    FIRST member (the one that founded the group) scored highest, and that
//    anchor fingerprint was never updated afterward — order-dependent: the
//    same three instances of one real block produced either 1 or 2 canonical
//    blocks purely depending on arrival order (see task-7-report.md, Trap 1).
// 2) Replacing it with union-find (connected components over the >=MERGE_AT
//    edge graph) fixed order-dependence — the partition is a pure function
//    of the symmetric edge set — but introduced a WORSE, silent failure:
//    "chaining". If A-B and B-C both clear MERGE_AT but A-C does not (a
//    real, measured case: sim(A,B)=0.9688, sim(B,C)=0.9643, sim(A,C)=0.9375
//    — see the "THE invariant" test), union-find still merges A, B, and C
//    into ONE group via the B bridge, even though A and C individually
//    would have landed in the gray band together. Worse: because the gray
//    band only ever compares pairs ACROSS separate groups, once A and C are
//    swallowed into the same group there is no gray-band entry for them at
//    all — union-find doesn't just over-merge, it deletes the adjudication
//    that would have surfaced the over-merge.
//
// Complete-linkage (below) is order-invariant like union-find AND bounded
// like the original greedy loop: two clusters may only merge while their
// MINIMUM pairwise similarity (i.e. the worst-case member-to-member score,
// checked across EVERY pair, not just adjacent ones) is >= MERGE_AT. That
// makes the headline invariant hold BY CONSTRUCTION: for every produced
// block, the minimum pairwise similarity across its members is >= MERGE_AT.
// In the A/B/C example, {A,B} merges (0.9688 >= MERGE_AT), but admitting C
// would require min(sim(A,C), sim(B,C)) = min(0.9375, 0.9643) = 0.9375 <
// MERGE_AT — so C stays a separate group, and A/C's high-but-insufficient
// score surfaces normally in the gray band instead of being buried.
//
// Standard hierarchical-clustering recurrence: once A and B merge, the new
// cluster's score against any other cluster D is min(clusterSim(A,D),
// clusterSim(B,D)) — this holds because
// min over (A∪B)×D of pointSim == min(min over A×D, min over B×D).
// Ties (multiple candidate pairs sharing the highest qualifying score) are
// broken deterministically by the LOWEST original instance index present in
// each cluster, compared lexicographically — never by iteration/arrival
// order — which is what keeps the whole procedure order-invariant.
// Numeric lexicographic comparison of two candidate cluster pairs by their
// (sorted-ascending) repIndex tuples — the deterministic tie-break. Plain
// string comparison would be wrong here ("9" > "10" lexicographically).
function pairKeyLess(iA, jA, iB, jB) {
  const [a1, a2] = [iA.repIndex, jA.repIndex].sort((x, y) => x - y);
  const [b1, b2] = [iB.repIndex, jB.repIndex].sort((x, y) => x - y);
  return a1 !== b1 ? a1 < b1 : a2 < b2;
}

function completeLinkageClusters(n, simOf) {
  // Each live cluster: { members: [instance indices], repIndex: smallest
  // original index it contains — the tie-break key, and also what makes
  // group NUMBERING (assigned later from final cluster order) depend only
  // on the smallest instance index in each cluster, not on merge order.
  let clusters = Array.from({ length: n }, (_, i) => ({ members: [i], repIndex: i }));

  // linkSim[a][b] = complete-linkage score between clusters a and b (both
  // are indices into the CURRENT `clusters` array; rebuilt each merge round
  // since indices shift — n is always small here (single-digit to low
  // hundreds of blocks per site), so an O(k^2) rebuild per merge, up to k
  // merges, is the same O(n^3) worst case as any other agglomerative
  // clustering and not a practical concern at this scale).
  while (clusters.length > 1) {
    let bestI = -1, bestJ = -1, bestScore = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let s = Infinity;
        for (const a of clusters[i].members) {
          for (const b of clusters[j].members) {
            const v = simOf(a, b);
            if (v < s) s = v;
          }
        }
        if (s < MERGE_AT) continue; // does not qualify — never a merge candidate
        if (bestI === -1) { bestScore = s; bestI = i; bestJ = j; continue; }
        // Numeric lexicographic tie-break (NOT string comparison — repIndex
        // can be >= 10, and "9" < "10" as strings is false, would silently
        // reintroduce order-dependent-looking ties on larger sites).
        if (s > bestScore || (s === bestScore && pairKeyLess(clusters[i], clusters[j], clusters[bestI], clusters[bestJ]))) {
          bestScore = s; bestI = i; bestJ = j;
        }
      }
    }
    if (bestI === -1) break; // no pair qualifies — done
    const merged = {
      members: [...clusters[bestI].members, ...clusters[bestJ].members],
      repIndex: Math.min(clusters[bestI].repIndex, clusters[bestJ].repIndex),
    };
    clusters = clusters.filter((_, idx) => idx !== bestI && idx !== bestJ);
    clusters.push(merged);
  }

  // Deterministic, order-invariant group numbering: sort final clusters by
  // their smallest contained instance index (repIndex), not by merge order.
  clusters.sort((a, b) => a.repIndex - b.repIndex);
  return clusters.map((c) => c.members.sort((x, y) => x - y));
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

  const componentMembers = completeLinkageClusters(n, simOf);
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
