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
    else if (t === 'Span') out += inlinesToHtml(c[1]);
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
    else if (t === 'Span') out += inlinesToText(c[1]);
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

// A bare NN/100 summary value renders as a score chip so the headline metric pops.
function kvValueHtml(valueHtml) {
  const m = /^(\d{1,3})\/100$/.exec(valueHtml.trim());
  if (m && Number(m[1]) <= 100) return `<span class="tx-score tx-score--${scoreTier(Number(m[1]))}">${m[1]}/100</span>`;
  return valueHtml;
}
function kvListHtml(pairs, summary) {
  if (summary) {
    // Long values (prose notes, file paths) span the full row instead of being
    // crushed into a narrow card; short stats sit two-up.
    const cells = pairs.map((p) => {
      const wide = p.valueHtml.replace(/<[^>]+>/g, '').length > 64 ? ' tx-kv__cell--wide' : '';
      return `<div class="tx-kv__cell${wide}"><dt>${esc(p.label)}</dt><dd>${kvValueHtml(p.valueHtml)}</dd></div>`;
    }).join('');
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
      walkInlines(n.t === 'Link' || n.t === 'Quoted' || n.t === 'Span' ? n.c[1] : n.c, fn);
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

// --- analysis-report per-block cards (twt-text-analysis) ---
// The report writes each block as a `## Block N — Type` header followed by a fixed
// run of `Label:` / value paragraphs (Purpose, Original, Applicable Metrics, Overall,
// Finding Type, Decision, Weaknesses, Can Fix Safely, Reason, Suggested Version,
// Rewrite Validation, Confidence). We fold each section into one styled card so the
// PDF reads as a review, not a flat stack of "Label: value" lines.
const ANALYSIS_LABELS = new Set([
  'purpose', 'original', 'applicable metrics', 'overall', 'finding type', 'decision',
  'weaknesses', 'can fix safely', 'reason', 'suggested version', 'rewrite validation',
  'confidence', 'weakness-to-fix mapping',
]);

// A block whose leading inlines are "Label:" then a soft break then a value.
function readLabeledField(block) {
  if (!block || (block.t !== 'Para' && block.t !== 'Plain')) return null;
  const inl = block.c || [];
  const s = inl.findIndex((n) => n.t === 'SoftBreak' || n.t === 'LineBreak');
  const labelInlines = s === -1 ? inl : inl.slice(0, s);
  let label = inlinesToText(labelInlines).trim();
  if (!label.endsWith(':')) return null;
  label = label.slice(0, -1).trim();
  const key = label.toLowerCase();
  if (!ANALYSIS_LABELS.has(key)) return null;
  let value = s === -1 ? [] : inl.slice(s + 1);
  while (value[0] && (value[0].t === 'Space' || value[0].t === 'SoftBreak')) value = value.slice(1);
  return { key, label, valueInlines: value };
}

const bulletItemInlines = (item) => (item[0] && (item[0].t === 'Plain' || item[0].t === 'Para')) ? item[0].c : [];
const bulletItemHtml = (item) => inlinesToHtml(bulletItemInlines(item)).trim();
const bulletItemText = (item) => inlinesToText(bulletItemInlines(item)).trim();

// In pandoc markdown a list glued to a label line (no blank line) is NOT a list —
// it becomes soft-break lines inside the value. Split them back into "- item" rows.
function valueLines(valueInlines) {
  const groups = [[]];
  for (const n of valueInlines) {
    if (n.t === 'SoftBreak' || n.t === 'LineBreak') groups.push([]);
    else groups[groups.length - 1].push(n);
  }
  const strip = (s) => s.replace(/^\s*[-*•]\s+/, '').trim();
  return groups
    .map((g) => ({ text: strip(inlinesToText(g)), html: strip(inlinesToHtml(g)) }))
    .filter((l) => l.text !== '');
}

const FINDING_TIER = new Map([['problem', 'danger'], ['opportunity', 'warn'], ['no issue', 'ok']]);

function overallChip(raw) {
  const m = /(\d{1,3})\/100/.exec(raw || '');
  if (m && Number(m[1]) <= 100) return `<span class="tx-score tx-score--${scoreTier(Number(m[1]))}">${m[1]}/100</span>`;
  if (/n\/a/i.test(raw || '')) return `<span class="tx-score tx-score--na">N/A</span>`;
  return '';
}

// "Clarity: 88 — evidence" | "Discoverability: N/A" | "Not scored — …"
function parseMetric(text) {
  const m = /^\s*(.+?):\s*(N\/A|\d{1,3})\b\s*(?:[—–-]\s*([\s\S]*))?$/.exec(text);
  if (!m) return { note: text.trim() };
  return { name: m[1].trim(), value: m[2], evidence: (m[3] || '').trim() };
}

// A single bullet line often packs several metrics separated by "·"
// ("Clarity: 90 · Scanability: 90 · Content Density: 88"). Split those back into
// one metric each before parsing, or the whole line collapses into one bogus
// metric named after everything up to the last colon.
function splitMetricItems(items) {
  const out = [];
  for (const it of items) {
    const parts = it.split('·').map((s) => s.trim()).filter(Boolean);
    // Only split when every piece looks like its own "Name: value" metric —
    // otherwise a lone "·" inside evidence prose would shatter one metric.
    if (parts.length > 1 && parts.every((p) => /:\s*(N\/A|\d{1,3})\b/i.test(p))) out.push(...parts);
    else out.push(it);
  }
  return out;
}

function metricsHtml(rawItems) {
  const items = splitMetricItems(rawItems);
  const parsed = items.map(parseMetric);
  if (parsed.every((p) => p.note !== undefined)) {
    return `<p class="tx-block__scaffold">${esc(parsed.map((p) => p.note).join(' '))}</p>`;
  }
  const rows = parsed.map((p) => {
    if (p.note !== undefined) return `<div class="tx-metric tx-metric--note"><span class="tx-metric__name">${esc(p.note)}</span></div>`;
    const na = p.value === 'N/A';
    const n = na ? 0 : Number(p.value);
    const tier = na ? 'na' : scoreTier(n);
    const fill = na ? '' : `<span class="tx-metric__fill tx-metric__fill--${tier}" style="width:${n}%"></span>`;
    const title = p.evidence ? ` title="${esc(p.evidence)}"` : '';
    return `<div class="tx-metric"${title}><span class="tx-metric__name">${esc(p.name)}</span>`
      + `<span class="tx-metric__track">${fill}</span>`
      + `<span class="tx-metric__val tx-metric__val--${tier}">${na ? 'N/A' : p.value}</span></div>`;
  }).join('');
  return `<div class="tx-metrics">${rows}</div>`;
}

function renderAnalysisCard(headText, seg) {
  const hm = /^Block\s+(\d+)\s*[—–-]\s*([\s\S]+)$/.exec(headText.trim());
  const num = hm ? hm[1] : '';
  const type = (hm ? hm[2] : headText).trim();
  const f = {};
  for (let k = 0; k < seg.length; k++) {
    const field = readLabeledField(seg[k]);
    if (!field) continue;
    const { key, valueInlines } = field;
    const next = seg[k + 1];
    const valHtml = inlinesToHtml(valueInlines).trim();
    const valText = inlinesToText(valueInlines).trim();
    if (key === 'applicable metrics') {
      if (!valText && next && next.t === 'BulletList') { f.metrics = next.c.map(bulletItemText); k++; }
      else f.metrics = valueLines(valueInlines).map((l) => l.text);
    } else if (key === 'original' || key === 'suggested version') {
      let html = valHtml, text = valText;
      if (!html && next && next.t === 'CodeBlock') { html = `<pre><code>${esc(next.c[1])}</code></pre>`; text = next.c[1].trim(); k++; }
      if (key === 'original') f.original = html; else { f.suggested = html; f.suggestedText = text; }
    } else if (key === 'weaknesses' || key === 'rewrite validation') {
      if (next && next.t === 'BulletList') { f[key] = next.c.map(bulletItemHtml); k++; }
      else f[key] = valueLines(valueInlines).map((l) => l.html);
    } else if (key === 'weakness-to-fix mapping') {
      if (next && next.t === 'BulletList') k++; // parsed away; detail lives in Reason
    } else {
      f[key] = valHtml;
    }
  }

  const tier = FINDING_TIER.get(String(f['finding type'] || '').toLowerCase()) || 'neutral';
  const chips = [overallChip(f.overall)];
  if (f['finding type']) chips.push(`<span class="tx-chip tx-chip--${tier}">${esc(f['finding type'])}</span>`);
  const decision = f.decision ? `<span class="tx-block__decision">${esc(f.decision)}</span>` : '';

  const parts = [];
  parts.push(`<header class="tx-block__head"><span class="tx-block__n">Block ${esc(num)}</span>`
    + `<h3 class="tx-block__type">${esc(type)}</h3>`
    + `<span class="tx-block__chips">${chips.filter(Boolean).join('')}${decision}</span></header>`);
  if (f.purpose) parts.push(`<p class="tx-block__purpose">${f.purpose}</p>`);
  if (f.original) parts.push(`<div class="tx-block__orig"><span class="tx-k">Original</span><div class="tx-orig__body">${f.original}</div></div>`);
  if (f.metrics && f.metrics.length) parts.push(metricsHtml(f.metrics));

  const notes = [];
  const weakness = (f.weaknesses || []).filter((w) => w && !/^none$/i.test(w.replace(/<[^>]+>/g, '').trim()));
  if (weakness.length) notes.push(`<div class="tx-note tx-note--warn"><span class="tx-k">Weaknesses</span><span>${weakness.join('; ')}</span></div>`);
  if (f.reason) notes.push(`<div class="tx-note"><span class="tx-k">Reason</span><span>${f.reason}</span></div>`);
  if (notes.length) parts.push(`<div class="tx-block__notes">${notes.join('')}</div>`);

  const tags = [];
  if (f['can fix safely']) tags.push(`<span class="tx-tag">Fix safely: <b>${esc(f['can fix safely'])}</b></span>`);
  if (f.confidence && !/^[—-]$/.test(f.confidence.trim())) tags.push(`<span class="tx-tag">Confidence: <b>${esc(f.confidence)}</b></span>`);
  if (tags.length) parts.push(`<div class="tx-block__tags">${tags.join('')}</div>`);

  const hasRewrite = f.suggestedText && !/^no better wording found\.?$/i.test(f.suggestedText);
  if (hasRewrite) {
    const checks = (f['rewrite validation'] || []).map((c) => {
      const ok = /:\s*yes\b/i.test(c) || /yes$/i.test(c.replace(/<[^>]+>/g, '').trim());
      return `<span class="tx-check tx-check--${ok ? 'ok' : 'no'}">${c}</span>`;
    }).join('');
    parts.push(`<div class="tx-block__suggest"><span class="tx-k tx-k--accent">Suggested rewrite</span>`
      + `<div class="tx-suggest__body">${f.suggested}</div>`
      + (checks ? `<div class="tx-suggest__checks">${checks}</div>` : '') + `</div>`);
  }

  const anchor = num ? ` id="tx-block-${esc(num)}"` : '';
  return `<section${anchor} class="tx-block tx-block--${tier}">${parts.join('')}</section>`;
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
    name: 'analysisBlock',
    profiles: ['report'],
    apply(blocks) {
      const isBlockHeader = (b) => b.t === 'Header' && b.c[0] === 2 && /^Block\s+\d+\b/i.test(inlinesToText(b.c[2]));
      if (!blocks.some(isBlockHeader)) return false;
      const out = [];
      let hit = false;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (!isBlockHeader(b)) { out.push(b); continue; }
        let j = i + 1;
        const seg = [];
        while (j < blocks.length && !(blocks[j].t === 'Header' && blocks[j].c[0] <= 2)) { seg.push(blocks[j]); j++; }
        out.push(rawBlock(renderAnalysisCard(inlinesToText(b.c[2]), seg)));
        hit = true;
        i = j - 1;
      }
      if (hit) { blocks.length = 0; blocks.push(...out); }
      return hit;
    },
  },
  {
    name: 'toc',
    profiles: ['report'],
    apply(blocks) {
      // Skip per-block headers ("Block 12 — Heading …"): they self-number and are
      // already covered by the summary table, so a TOC of them is pure noise.
      const isBlock = (h) => /^Block\s+\d+\b/i.test(inlinesToText(h.c[2]));
      const h2s = blocks.filter((b) => b.t === 'Header' && b.c[0] === 2 && !isBlock(b));
      if (h2s.length < 6) return false;
      // Unordered list — section labels carry their own meaning; ordered numbers
      // collide with any "Block N"/step numbering already in the heading text.
      const items = h2s.map((h) => `<li><a href="#${esc(h.c[1][0])}">${inlinesToHtml(h.c[2])}</a></li>`).join('');
      const nav = rawBlock(`<nav class="tx-toc"><p class="tx-toc-title">Contents</p><ul>${items}</ul></nav>`);
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
    // Turn the summary table's "Block" column into anchor links to each block card
    // (cards carry id="tx-block-N"). Must run before severityChips so the linkified
    // number cell no longer reads as plain text.
    name: 'summaryBlockLinks',
    profiles: ['report'],
    apply(blocks) {
      let hit = false;
      for (const b of blocks) {
        if (b.t !== 'Table') continue;
        const rows = tableRows(b);
        const header = rows.find((r) => r.head);
        if (!header || cellText(header.row[1][0]).toLowerCase() !== 'block') continue;
        for (const { row, head } of rows) {
          if (head) continue;
          const cell = row[1][0];
          const n = cellText(cell).trim();
          if (/^\d+$/.test(n)) { setCellHtml(cell, `<a class="tx-blink" href="#tx-block-${n}">${n}</a>`); hit = true; }
        }
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
  assert.match(sumOut, /<div class="tx-kv__cell[^"]*"><dt>/, 'summary variant wraps pairs in divs');

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
  // summary "Block" column becomes anchor links to each card
  assert.match(tblOut, /<a class="tx-blink" href="#tx-block-1">1<\/a>/, 'block-number cell links to the card anchor');
  assert.match(tblOut, /<a class="tx-blink" href="#tx-block-2">2<\/a>/);

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

  // analysis-report per-block cards (report profile)
  const anaMd = [
    '# Text Analysis',
    '',
    '- **Document Overall:** 85/100',
    '- **Blocks scored:** 45',
    '- **Voice context:** A deliberately long note that exceeds the wide threshold so the summary card should span the full row instead of being crushed into a narrow column here.',
    '',
    '## Block 13 — Paragraph (list lead-in label)',
    '',
    'Purpose:',
    'Introduces the four disciplines.',
    '',
    'Original:',
    '`Disciplines (400+ experts):`',
    '',
    'Applicable Metrics:',
    '- Clarity: 78 — awkward wording.',
    '- Conciseness: 65 — repeats a word.',
    '- Discoverability: N/A',
    '',
    'Overall:',
    '70/100',
    '',
    'Finding Type:',
    'Opportunity',
    '',
    'Decision:',
    'Rewrite recommended',
    '',
    'Weaknesses:',
    '- Redundancy in the lead-in.',
    '',
    'Can Fix Safely:',
    'Yes',
    '',
    'Reason:',
    'The redundancy can be removed without touching any fact.',
    '',
    'Suggested Version:',
    '`400+ experts across four disciplines:`',
    '',
    'Rewrite Validation:',
    '- Solves reported weakness: Yes',
    '- Preserves meaning: Yes',
    '',
    'Confidence:',
    '74%',
  ].join('\n');
  const anaOut = astToHtml(transformAst(pandocAst(anaMd), 'report').ast);
  assert.match(anaOut, /<section id="tx-block-13" class="tx-block tx-block--warn">/, 'block card carries finding-type tier and anchor id');
  assert.match(anaOut, /tx-block__n">Block 13</, 'card shows block number');
  assert.match(anaOut, /tx-block__type">Paragraph \(list lead-in label\)</, 'card shows block type');
  assert.match(anaOut, /tx-score tx-score--mid">70\/100/, 'overall becomes a score chip in the head');
  assert.match(anaOut, /tx-metric__fill tx-metric__fill--low" style="width:65%"/, 'metric renders a proportional bar');
  assert.match(anaOut, /tx-metric__val--na">N\/A/, 'N\\/A metric renders without a bar');

  // A single bullet packing several "·"-joined metrics splits into one bar each
  const compactMd = ['# T', '', '## Block 14 — List', '', 'Applicable Metrics:',
    '- Clarity: 90 · Scanability: 90 · Content Density: 88', '', 'Overall:', '88/100', '',
    'Finding Type:', 'No issue', '', 'Decision:', 'Keep original'].join('\n');
  const compactOut = astToHtml(transformAst(pandocAst(compactMd), 'report').ast);
  const metricNames = [...compactOut.matchAll(/tx-metric__name">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(metricNames, ['Clarity', 'Scanability', 'Content Density'], 'compact "·"-joined metrics split into separate bars');
  assert.match(anaOut, /tx-block__suggest/, 'validated rewrite renders a suggestion box');
  assert.match(anaOut, /tx-check tx-check--ok/, 'rewrite validation renders pass checks');
  assert.ok(!anaOut.includes('<nav class="tx-toc">'), 'per-block headers do not seed a TOC');
  assert.match(anaOut, /tx-kv__cell--wide/, 'long summary values span the full row');
  assert.match(anaOut, /tx-kv--summary[^]*tx-score tx-score--good">85\/100/, 'summary Overall renders a score chip');

  // No-issue block stays compact: no suggestion box, no empty "none" weakness note
  const keepMd = ['# T', '', '## Block 7 — Heading', '', 'Purpose:', 'Section heading.', '',
    'Overall:', '92/100', '', 'Finding Type:', 'No issue', '', 'Decision:', 'Keep original', '',
    'Weaknesses:', '- none', '', 'Reason:', 'Reads well.', '', 'Suggested Version:',
    'No better wording found.', '', 'Confidence:', '—'].join('\n');
  const keepOut = astToHtml(transformAst(pandocAst(keepMd), 'report').ast);
  assert.match(keepOut, /tx-block tx-block--ok/, 'no-issue block gets the ok tier');
  assert.ok(!keepOut.includes('tx-block__suggest'), 'kept block shows no suggestion box');
  assert.ok(!/tx-note--warn/.test(keepOut), '"none" weakness is not shown as a warning note');

  // generic profile: header only, everything else untouched
  const gen = transformAst(pandocAst(kvMd), 'generic');
  assert.deepEqual(gen.applied, ['docHeader']);

  // fall-through: unmatched structures survive
  const surv = astToHtml(transformAst(pandocAst('Just a paragraph.\n\n- plain\n- list\n'), 'report').ast);
  assert.match(surv, /<li>plain<\/li>/);

  // Span inlines (c=[Attr,[Inline]]): content must survive serializers and be reachable by walkers
  assert.match(astToHtml(transformAst(pandocAst('# Report [Draft]{.x}\n\ntext'), 'generic').ast), /Report Draft/, 'span content survives docHeader');
  assert.match(astToHtml(transformAst(pandocAst('Score [85/100]{.x} ok.'), 'report').ast), /tx-score--good/, 'score chip fires inside a span');

  console.log('export-transform self-test: OK');
}
