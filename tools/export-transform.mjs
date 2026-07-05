#!/usr/bin/env node
// export-transform.mjs — deterministic block transforms over the pandoc JSON AST.
// Each doc-type profile enables an ordered set of transforms; matched blocks are
// replaced with RawBlock html components (classes styled by the theme's
// components.css). Unmatched blocks render as normal pandoc HTML. Callers catch
// errors and fall back to the untransformed path.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

function pandocAst(md) {
  const r = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], { encoding: 'utf8', input: md });
  if (r.status !== 0) throw new Error('pandoc md->json failed: ' + (r.stderr || ''));
  return JSON.parse(r.stdout);
}
function astToHtml(ast) {
  const r = spawnSync('pandoc', ['-f', 'json', '-t', 'html'], { encoding: 'utf8', input: JSON.stringify(ast) });
  if (r.status !== 0) throw new Error('pandoc json->html failed: ' + (r.stderr || ''));
  return r.stdout;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

export function inlinesToHtml(inlines = []) {
  let out = '';
  for (const n of inlines) {
    const { t, c } = n;
    if (t === 'Str') out += esc(c);
    else if (t === 'Space' || t === 'SoftBreak') out += ' ';
    else if (t === 'LineBreak') out += '<br>';
    else if (t === 'Strong') out += `<strong>${inlinesToHtml(c)}</strong>`;
    else if (t === 'Emph') out += `<em>${inlinesToHtml(c)}</em>`;
    else if (t === 'Code') out += `<code>${esc(c[1])}</code>`;
    else if (t === 'Link') out += `<a href="${esc(c[2][0])}">${inlinesToHtml(c[1])}</a>`;
    else if (t === 'Image') out += `<img src="${esc(c[2][0])}" alt="${esc(inlinesToText(c[1]))}">`;
    else if (t === 'RawInline') out += c[0] === 'html' ? c[1] : '';
    else if (t === 'Quoted') out += `“${inlinesToHtml(c[1])}”`;
    else if (Array.isArray(c) && c.every((x) => x && x.t)) out += inlinesToHtml(c);
    // unknown inline types degrade to nothing rather than crashing
  }
  return out;
}

export function inlinesToText(inlines = []) {
  let out = '';
  for (const n of inlines) {
    const { t, c } = n;
    if (t === 'Str') out += c;
    else if (t === 'Space' || t === 'SoftBreak' || t === 'LineBreak') out += ' ';
    else if (t === 'Code') out += c[1];
    else if (t === 'Link' || t === 'Image') out += inlinesToText(c[1]);
    else if (Array.isArray(c) && c.every((x) => x && x.t)) out += inlinesToText(c);
  }
  return out;
}

const rawBlock = (html) => ({ t: 'RawBlock', c: ['html', html] });
const rawInline = (html) => ({ t: 'RawInline', c: ['html', html] });

// --- kv parsing: bullet item '**Label:** value' → {label, valueHtml} | null ---
function kvParse(item) {
  const first = item && item[0];
  if (!first || (first.t !== 'Plain' && first.t !== 'Para')) return null;
  if (item.length > 1) return null;
  const inl = first.c || [];
  if (inl[0]?.t !== 'Strong') return null;
  let label = inlinesToText(inl[0].c).trim();
  let rest = inl.slice(1);
  if (label.endsWith(':')) label = label.slice(0, -1);
  else if (rest[0]?.t === 'Str' && rest[0].c.startsWith(':')) rest = [{ t: 'Str', c: rest[0].c.slice(1) }, ...rest.slice(1)];
  else return null;
  return { label, valueHtml: inlinesToHtml(rest).trim() };
}

function kvListHtml(pairs, summary) {
  if (summary) {
    const cells = pairs.map((p) => `<div><dt>${esc(p.label)}</dt><dd>${p.valueHtml}</dd></div>`).join('');
    return `<dl class="tx-kv tx-kv--summary">${cells}</dl>`;
  }
  const rows = pairs.map((p) => `<dt>${esc(p.label)}</dt><dd>${p.valueHtml}</dd>`).join('');
  return `<dl class="tx-kv">${rows}</dl>`;
}

// --- table walking (pandoc 3 Table) ---
function tableRows(table) {
  const [, , , head, bodies, foot] = table.c;
  const rows = [];
  for (const row of head[1]) rows.push({ row, head: true });
  for (const b of bodies) { for (const row of b[2]) rows.push({ row, head: true }); for (const row of b[3]) rows.push({ row, head: false }); }
  for (const row of foot[1]) rows.push({ row, head: false });
  return rows;
}
const cellBlocks = (cell) => cell[4];
const cellText = (cell) => cellBlocks(cell).map((b) => (b.t === 'Plain' || b.t === 'Para') ? inlinesToText(b.c) : '').join(' ').trim();
function setCellHtml(cell, html) { cell[4] = [{ t: 'Plain', c: [rawInline(html)] }]; }

// --- transforms ---
const SEVERITY = new Map([
  ['blocker', 'danger'], ['problem', 'danger'], ['warning', 'warn'], ['opportunity', 'warn'],
  ['suggestion', 'info'], ['no issue', 'ok'], ['pass', 'ok'], ['fail', 'danger'],
]);
const scoreTier = (n) => (n >= 85 ? 'good' : n >= 70 ? 'mid' : 'low');
const chip = (text, kind) => `<span class="tx-chip tx-chip--${kind}">${esc(text)}</span>`;

function walkInlines(inlines, fn) {
  for (let i = 0; i < inlines.length; i++) {
    const n = inlines[i];
    const rep = fn(n);
    if (rep) { inlines[i] = rep; continue; }
    if (n && Array.isArray(n.c) && ['Strong', 'Emph', 'Quoted', 'Span', 'Link'].includes(n.t)) {
      walkInlines(n.t === 'Link' || n.t === 'Quoted' ? n.c[1] : n.c, fn);
    }
  }
}
function walkBlockInlines(blocks, fn) {
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.t === 'Para' || b.t === 'Plain') walkInlines(b.c, fn);
    else if (b.t === 'Header') walkInlines(b.c[2], fn);
    else if (b.t === 'BulletList' || b.t === 'OrderedList') {
      const items = b.t === 'OrderedList' ? b.c[1] : b.c;
      for (const item of items) walkBlockInlines(item, fn);
    } else if (b.t === 'Table') {
      for (const { row } of tableRows(b)) for (const cell of row[1]) walkBlockInlines(cellBlocks(cell), fn);
    } else if (b.t === 'BlockQuote' || b.t === 'Div') walkBlockInlines(b.t === 'Div' ? b.c[1] : b.c, fn);
  }
}

const TRANSFORMS = [
  {
    name: 'docHeader',
    profiles: ['report', 'brief', 'spec', 'generic'],
    apply(blocks) {
      const i = blocks.findIndex((b) => b.t === 'Header');
      if (i === -1 || blocks[i].c[0] !== 1) return false;
      const [, [id], inlines] = blocks[i].c;
      blocks[i] = rawBlock(`<header class="tx-doc-header"><h1${id ? ` id="${esc(id)}"` : ''}>${inlinesToHtml(inlines)}</h1><span class="hs-accent-bar"></span></header>`);
      return true;
    },
  },
  {
    name: 'toc',
    profiles: ['report'],
    apply(blocks) {
      const h2s = blocks.filter((b) => b.t === 'Header' && b.c[0] === 2);
      if (h2s.length < 6) return false;
      const items = h2s.map((h) => `<li><a href="#${esc(h.c[1][0])}">${inlinesToHtml(h.c[2])}</a></li>`).join('');
      const nav = rawBlock(`<nav class="tx-toc"><p class="tx-toc-title">Contents</p><ol>${items}</ol></nav>`);
      const after = blocks.findIndex((b) => b.t === 'RawBlock' || (b.t === 'Header' && b.c[0] === 1));
      blocks.splice(after === -1 ? 0 : after + 1, 0, nav);
      return true;
    },
  },
  {
    name: 'findingCards',
    profiles: ['report'],
    apply(blocks) {
      const LABELS = new Set(['where', 'problem', 'recommendation', 'severity', 'fix']);
      let hit = false;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].t !== 'BulletList') continue;
        const pairs = blocks[i].c.map(kvParse);
        if (pairs.length < 2 || pairs.some((p) => !p)) continue;
        const labels = pairs.map((p) => p.label.toLowerCase());
        if (!labels.every((l) => LABELS.has(l)) || !labels.includes('problem')) continue;
        const rows = pairs.map((p) => `<dt>${esc(p.label)}</dt><dd>${p.valueHtml}</dd>`).join('');
        blocks[i] = rawBlock(`<section class="tx-finding"><dl>${rows}</dl></section>`);
        hit = true;
      }
      return hit;
    },
  },
  {
    name: 'kvList',
    profiles: ['report', 'brief'],
    apply(blocks, { profile }) {
      let firstList = true, hit = false;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].t !== 'BulletList') continue;
        const pairs = blocks[i].c.map(kvParse);
        const isFirst = firstList; firstList = false;
        if (pairs.length < 3 || pairs.some((p) => !p)) continue;
        const summary = profile === 'report' && isFirst;
        blocks[i] = rawBlock(kvListHtml(pairs, summary));
        hit = true;
      }
      return hit;
    },
  },
  {
    name: 'severityChips',
    profiles: ['report'],
    apply(blocks) {
      let hit = false;
      for (const b of blocks) {
        if (b.t !== 'Table') continue;
        for (const { row, head } of tableRows(b)) {
          if (head) continue;
          for (const cell of row[1]) {
            const kind = SEVERITY.get(cellText(cell).toLowerCase());
            if (kind) { setCellHtml(cell, chip(cellText(cell) || '', kind)); hit = true; }
          }
        }
      }
      // bold severity words in running text
      walkBlockInlines(blocks.filter((b) => b.t !== 'Table'), (n) => {
        if (n.t === 'Strong') {
          const kind = SEVERITY.get(inlinesToText(n.c).trim().toLowerCase());
          if (kind) { hit = true; return rawInline(chip(inlinesToText(n.c).trim(), kind)); }
        }
        return null;
      });
      return hit;
    },
  },
  {
    name: 'scoreChips',
    profiles: ['report'],
    apply(blocks) {
      let hit = false;
      walkBlockInlines(blocks, (n) => {
        if (n.t !== 'Str') return null;
        const m = /^(\d{1,3})\/100([.,;:]?)$/.exec(n.c);
        if (!m || Number(m[1]) > 100) return null;
        hit = true;
        return rawInline(`<span class="tx-score tx-score--${scoreTier(Number(m[1]))}">${m[1]}/100</span>${m[2]}`);
      });
      return hit;
    },
  },
  {
    name: 'paletteSwatches',
    profiles: ['brief', 'spec'],
    apply(blocks) {
      let hit = false;
      for (const b of blocks) {
        if (b.t !== 'Table') continue;
        for (const { row, head } of tableRows(b)) {
          if (head) continue;
          for (const cell of row[1]) {
            const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(cellText(cell));
            if (m) { setCellHtml(cell, `<span class="tx-swatch" style="background:#${m[1]}"></span><code>#${m[1].toUpperCase()}</code>`); hit = true; }
          }
        }
      }
      return hit;
    },
  },
  {
    name: 'wideTables',
    profiles: ['report', 'spec'],
    apply(blocks) {
      let hit = false;
      for (const b of blocks) {
        if (b.t !== 'Table') continue;
        const colspecs = b.c[2];
        if (colspecs.length >= 5) { b.c[0][1] = [...new Set([...(b.c[0][1] || []), 'tx-table-wide'])]; hit = true; }
      }
      return hit;
    },
  },
];

export function transformAst(ast, profile = 'generic') {
  const applied = [];
  for (const tr of TRANSFORMS) {
    if (!tr.profiles.includes(profile)) continue;
    try { if (tr.apply(ast.blocks, { profile })) applied.push(tr.name); }
    catch (e) { throw new Error(`transform '${tr.name}' failed: ${e.message}`); }
  }
  return { ast, applied };
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const probe = spawnSync('pandoc', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { console.log('export-transform self-test: SKIP (pandoc missing)'); process.exit(0); }

  // inline serializers
  const inl = pandocAst('**Bold** and `code` and [link](https://x.test)').blocks[0].c;
  assert.equal(inlinesToHtml(inl), '<strong>Bold</strong> and <code>code</code> and <a href="https://x.test">link</a>');
  assert.equal(inlinesToText(inl), 'Bold and code and link');

  // kv-list → dl.tx-kv (brief profile) with summary variant after H1 (report profile)
  const kvMd = '# Brief\n\n- **Brand name:** Xivic\n- **Category:** AI firm\n- **Tagline:** AI Velocity. Engineered.\n';
  const kvOut = astToHtml(transformAst(pandocAst(kvMd), 'brief').ast);
  assert.match(kvOut, /<dl class="tx-kv">/);
  assert.match(kvOut, /<dt>Brand name<\/dt>/);
  assert.match(kvOut, /<dd>Xivic<\/dd>/);
  const sumOut = astToHtml(transformAst(pandocAst(kvMd), 'report').ast);
  assert.match(sumOut, /tx-kv--summary/);
  assert.match(sumOut, /<div><dt>/, 'summary variant wraps pairs in divs');

  // doc header (all profiles)
  assert.match(kvOut, /<header class="tx-doc-header"><h1[^>]*>Brief<\/h1><span class="hs-accent-bar"><\/span><\/header>/);

  // score chips (report only)
  const scoreOut = astToHtml(transformAst(pandocAst('Overall 85/100 and 64/100 and 72/100.'), 'report').ast);
  assert.match(scoreOut, /tx-score tx-score--good">85\/100/);
  assert.match(scoreOut, /tx-score tx-score--low">64\/100/);
  assert.match(scoreOut, /tx-score tx-score--mid">72\/100/);
  const noScore = astToHtml(transformAst(pandocAst('Overall 85/100.'), 'brief').ast);
  assert.ok(!noScore.includes('tx-score'), 'scores only chip in report profile');

  // severity chips in table cells + wide-table class
  const tblMd = '| Block | Type | Overall | Finding | Decision |\n|---|---|---|---|---|\n| 1 | Heading | 90 | No issue | Keep |\n| 2 | CTA | 60 | Problem | Rewrite |\n';
  const tblOut = astToHtml(transformAst(pandocAst(tblMd), 'report').ast);
  assert.match(tblOut, /tx-table-wide/);
  assert.match(tblOut, /tx-chip tx-chip--ok">No issue/);
  assert.match(tblOut, /tx-chip tx-chip--danger">Problem/);

  // palette swatches (brief)
  const palMd = '| Name | Hex |\n|---|---|\n| Ink | #090E22 |\n| Blue | #0B68B7 |\n';
  const palOut = astToHtml(transformAst(pandocAst(palMd), 'brief').ast);
  assert.match(palOut, /tx-swatch" style="background:#090E22"/);

  // finding cards (report)
  const findMd = '#### Finding 1\n\n- **Where:** Hero\n- **Problem:** Vague\n- **Recommendation:** Add proof\n';
  const findOut = astToHtml(transformAst(pandocAst(findMd), 'report').ast);
  assert.match(findOut, /<section class="tx-finding">/);
  assert.match(findOut, /<dt>Where<\/dt><dd>Hero<\/dd>/);

  // toc for long reports
  const longMd = '# R\n\n' + Array.from({ length: 7 }, (_, i) => `## Section ${i + 1}\n\ntext\n`).join('\n');
  const longOut = astToHtml(transformAst(pandocAst(longMd), 'report').ast);
  assert.match(longOut, /<nav class="tx-toc">/);
  assert.match(longOut, /href="#section-1"/);

  // generic profile: header only, everything else untouched
  const gen = transformAst(pandocAst(kvMd), 'generic');
  assert.deepEqual(gen.applied, ['docHeader']);

  // fall-through: unmatched structures survive
  const surv = astToHtml(transformAst(pandocAst('Just a paragraph.\n\n- plain\n- list\n'), 'report').ast);
  assert.match(surv, /<li>plain<\/li>/);

  console.log('export-transform self-test: OK');
}
