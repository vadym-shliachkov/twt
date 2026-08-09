// report.mjs — render block-map.json into the human deliverable.
// Reads the fat artifact; the MODEL never does. Renderer only. No stdout.
'use strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// The id prefix (unique per block, by construction in identity.mjs/emit.mjs)
// guarantees the filename is unique even when two different block NAMES
// slugify to the same string (e.g. "Card grid" and "Card-grid" both ->
// "card-grid") — the slug is a readability aid, not the uniqueness key.
export const pageFile = (b) => `block-${b.id}-${slug(b.name)}.html`;

const CSS = `
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:32px;color:#16181d;background:#fff}
h1,h2{margin:0 0 12px} .sub{color:#666;margin:0 0 24px}
.scores{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 28px}
.score{border:1px solid #e3e5e9;border-radius:8px;padding:12px 16px;min-width:110px}
.score b{display:block;font-size:24px} .score span{color:#666;font-size:12px}
.scroll{overflow-x:auto;margin:0 0 28px;max-width:100%}
table{border-collapse:collapse;font-size:14px;white-space:nowrap}
th,td{border-bottom:1px solid #eceef1;padding:6px 12px;text-align:left}
th{font-weight:600;color:#666} td.n{text-align:center}
.kid td:first-child{color:#555}
.warn{background:#fff4e5;border:1px solid #f0c894;border-radius:8px;padding:12px 16px;margin:0 0 24px}
.alias{font-family:ui-monospace,monospace;font-size:12px;color:#555;margin-left:8px}
pre.mermaid{background:#f7f8fa;border:1px solid #e3e5e9;border-radius:8px;padding:16px;overflow-x:auto;white-space:pre}
pre{white-space:pre-wrap;word-break:break-word}
a{color:#2f6feb}
.note{color:#666;font-size:13px;margin:8px 0 0}
@media(prefers-color-scheme:dark){body{background:#111317;color:#e8eaed}
.score,pre.mermaid,table{border-color:#2a2e36}pre.mermaid{background:#181b21}
th,td{border-color:#2a2e36}.warn{background:#3a2c15;border-color:#7a5b22}
.alias,.sub,.note,th{color:#9aa0aa}}
`;

function scorecard(map) {
  const blocks = map.blocks || [];
  const instances = blocks.reduce((s, b) => s + b.reuse.instances, 0);
  const merged = blocks.reduce((s, b) => s + Math.max(0, (b.aliases || []).length - 1), 0);
  const oneOffs = blocks.filter((b) => b.reuse.instances === 1).length;
  const ratio = blocks.length ? (instances / blocks.length).toFixed(1) : '0';
  const cell = (v, l) => `<div class="score"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
  return `<div class="scores">${[
    cell(map.meta.pages, 'pages'), cell(blocks.length, 'unique blocks'),
    cell(instances, 'instances'), cell(ratio + '×', 'reuse ratio'),
    cell(merged, 'aliases merged'), cell(oneOffs, 'one-offs'),
    cell(map.meta.unadjudicated ?? 0, 'unadjudicated'),
  ].join('')}</div>`;
}

// Note: deliberately NOT gated on `map.meta.engine === 'playwright'` — a
// non-empty jsRenderedPages is worth surfacing regardless of which engine
// ran, since seeing it under playwright would itself mean something
// unexpected happened (a per-page render failure), not a state to hide.
function warnBanner(map) {
  const js = map.meta.jsRenderedPages || [];
  if (!js.length) return '';
  return `<div class="warn"><strong>Incomplete map.</strong> These pages are JS-rendered and were
    read as static HTML, so their blocks are missing: ${js.map((u) => `<code>${esc(u)}</code>`).join(', ')}.
    Install Playwright and re-run without <code>--static</code> for a complete map.</div>`;
}

// Rows sorted by pages desc, then instances desc. Children indented under
// their parent, recursively — real sites nest more than one level deep
// (e.g. Package grid > Package > Feature list on the fixture's
// card-with-list.html), so a single-level "roots, then roots' direct
// children" walk silently drops any block two or more hops from a root.
// `seen` both guards against a pathological cycle and de-dupes a block
// that is reachable from more than one parent (shown once, under whichever
// parent's walk reaches it first — deterministic since both roots and
// each parent's children are rank-sorted before the walk visits them).
function matrixHtml(map) {
  const pages = map.pages || [];
  const byId = new Map(map.blocks.map((b) => [b.id, b]));
  const rank = (a, b) => b.reuse.pages - a.reuse.pages || b.reuse.instances - a.reuse.instances;
  const counts = (b, url) => b.instances.filter((i) => i.page === url).length;

  const row = (b, depth) => `<tr class="${depth ? 'kid' : ''}">
    <td style="padding-left:${12 + depth * 16}px">${depth ? '└ ' : ''}<a href="${pageFile(b)}">${esc(b.name)}</a>
      <span class="alias">${esc((b.aliases || []).join(' '))}</span></td>
    <td class="n">×${b.reuse.instances}</td>
    ${pages.map((p) => { const n = counts(b, p.url); return `<td class="n">${n ? (n > 1 ? '×' + n : '●') : ''}</td>`; }).join('')}
  </tr>`;

  const seen = new Set();
  const walk = (b, depth) => {
    if (seen.has(b.id)) return '';
    seen.add(b.id);
    const kids = (b.children || []).map((cid) => byId.get(cid)).filter(Boolean).sort(rank);
    return row(b, depth) + kids.map((c) => walk(c, depth + 1)).join('');
  };

  const roots = map.blocks.filter((b) => !(b.parents || []).length).sort(rank);
  let body = roots.map((b) => walk(b, 0)).join('');
  // Orphans: a block whose declared parent id doesn't resolve to another
  // block in this map (should not happen, but silently dropping a real
  // block from the headline matrix is worse than showing it unindented).
  const orphans = map.blocks.filter((b) => !seen.has(b.id)).sort(rank);
  body += orphans.map((b) => walk(b, 0)).join('');

  return `<div class="scroll"><table>
    <tr><th>Block</th><th>total</th>${pages.map((p) => `<th>${esc(p.url)}</th>`).join('')}</tr>
    ${body}</table></div>`;
}

// Escapes text going INTO a mermaid quoted node label. Mermaid's own
// grammar treats a node label as a "..."-delimited string, and (with the
// default htmlLabels config) renders that string's content via innerHTML —
// so a literal `"` in a block name would prematurely close the label
// (a BROKEN diagram, not just a display glitch) and a literal `<` would
// let a block-name string become live markup inside the node instead of
// visible text. HTML-entity-escaping the label text first defeats both:
// Mermaid's own parser never sees a bare `"`, and its HTML renderer decodes
// the entities back to the literal characters for DISPLAY only, never as
// structure. The whole mermaid source is escaped a SECOND time below (in
// skeletonMermaid/neighborhoodMermaid's final `esc(lines.join(...))`) to
// safely embed it as the <pre> element's text content — that second pass
// round-trips losslessly through the browser's own HTML-entity decode of
// textContent, so this is deliberate two-layer escaping, not accidental
// double work. See task-10-report.md for the character-by-character trace.
const mermaidLabel = esc;

// Only reused blocks (>= 2 instances). Pages collapse into one badge node.
function skeletonMermaid(map) {
  const keep = (map.blocks || []).filter((b) => b.reuse.instances >= 2);
  if (!keep.length) return '<p>No block is reused — nothing to graph.</p>';
  const ids = new Set(keep.map((b) => b.id));
  const lines = [`flowchart LR`, `  pages["${map.meta.pages} pages"]`];
  for (const b of keep) lines.push(`  ${b.id}["${mermaidLabel(b.name)}<br/>×${b.reuse.instances}"]`);
  for (const b of keep) {
    if (!(b.parents || []).some((p) => ids.has(p))) lines.push(`  pages --> ${b.id}`);
    for (const p of b.parents || []) if (ids.has(p)) lines.push(`  ${p} --> ${b.id}`);
  }
  return `<pre class="mermaid">${esc(lines.join('\n'))}</pre>`;
}

// Beyond this many parents/children a flat one-hop fan-out stops being
// readable as a diagram; the overflow is named in a plain-text note
// instead of piling on more graph nodes. This is a READABILITY cap, not a
// correctness one — a block with 40 parents and 40 children still produces
// syntactically valid mermaid without it, but nobody can read that graph.
const NEIGHBOR_CAP = 20;

// One hop: parents above, the block itself, children below.
function neighborhoodMermaid(block, byId) {
  const lines = ['flowchart TD', `  ${block.id}["${mermaidLabel(block.name)}"]`];
  const parents = (block.parents || []).map((p) => byId.get(p)).filter(Boolean);
  const children = (block.children || []).map((c) => byId.get(c)).filter(Boolean);
  for (const n of parents.slice(0, NEIGHBOR_CAP)) lines.push(`  ${n.id}["${mermaidLabel(n.name)}"] --> ${block.id}`);
  for (const n of children.slice(0, NEIGHBOR_CAP)) lines.push(`  ${block.id} --> ${n.id}["${mermaidLabel(n.name)}"]`);
  let note = '';
  if (parents.length > NEIGHBOR_CAP) note += `<p class="note">+${parents.length - NEIGHBOR_CAP} more parent(s) not shown — see the reuse matrix.</p>`;
  if (children.length > NEIGHBOR_CAP) note += `<p class="note">+${children.length - NEIGHBOR_CAP} more child(ren) not shown — see the reuse matrix.</p>`;
  return `<pre class="mermaid">${esc(lines.join('\n'))}</pre>${note}`;
}

const shell = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
   <title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

function markdownFor(map) {
  const rows = (map.blocks || [])
    .slice().sort((a, b) => b.reuse.instances - a.reuse.instances)
    .map((b) => `| ${b.name} | ${b.tier} | ${(b.aliases || []).join(', ')} | ${b.reuse.pages} | ${b.reuse.instances} |`);
  return [`# Block map`, ``,
    `${map.meta.pages} pages · ${(map.blocks || []).length} unique blocks · engine: ${map.meta.engine || 'static'}`, ``,
    `| Block | Tier | Aliases | Pages | Instances |`, `|---|---|---|---|---|`, ...rows, ``].join('\n');
}

export function renderReport(outDir) {
  const map = JSON.parse(readFileSync(join(outDir, 'block-map.json'), 'utf8'));

  const homepage = join(outDir, 'report.html');
  writeFileSync(homepage, shell('Block map', `
    <h1>Block map</h1>
    <p class="sub">${esc(map.meta.pages)} pages · ${(map.blocks || []).length} unique blocks · engine: ${esc(map.meta.engine || 'static')}</p>
    ${warnBanner(map)}
    ${scorecard(map)}
    <h2>Reuse matrix</h2>${matrixHtml(map)}
    <h2>Reuse skeleton</h2>${skeletonMermaid(map)}`));

  const blockPages = [];

  const markdown = join(outDir, 'block-map.md');
  writeFileSync(markdown, markdownFor(map));
  return { homepage, blockPages, markdown };
}
