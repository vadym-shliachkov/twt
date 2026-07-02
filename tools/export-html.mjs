#!/usr/bin/env node
// export-html.mjs — build doc-hub-light HTML from markdown for the export pipeline.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readCss } from './house-style.mjs';

const FONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800;900&display=swap">';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function pandocHtml({ file, input }) {
  const args = ['-f', 'markdown', '-t', 'html'];
  if (file) args.unshift(file);
  const r = spawnSync('pandoc', args, { encoding: 'utf8', input: file ? undefined : input });
  if (r.status !== 0) throw new Error('pandoc md->html failed: ' + ((r.stderr || r.error?.message || '').trim()));
  return r.stdout;
}

export function shellDoc({ bodyHtml, title }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
${FONTS}
<style>${readCss('house-style.css')}
${readCss('house-doc.css')}</style></head>
<body><main class="doc-wrap"><span class="hs-accent-bar"></span>
${bodyHtml}
</main></body></html>`;
}

export function shellSlides({ slidesHtml, title, aspect }) {
  const cls = aspect === '4:3' ? 'ar43' : 'ar169';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
${FONTS}
<style>${readCss('house-style.css')}
${readCss('house-slide.css')}</style></head>
<body class="${cls}">${slidesHtml}</body></html>`;
}

export function mdToHtmlDoc({ markdownPath, title }) {
  const md = readFileSync(markdownPath, 'utf8');
  const t = title || md.match(/^#\s+(.+)$/m)?.[1] || 'Document';
  return shellDoc({ bodyHtml: pandocHtml({ file: markdownPath }), title: t });
}

export function mdToSlidesHtml({ markdownPath, aspect = '16:9', title }) {
  const md = readFileSync(markdownPath, 'utf8');
  const t = title || md.match(/^#\s+(.+)$/m)?.[1] || 'Presentation';
  const parts = md.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
  const slidesHtml = parts.map((part, i) =>
    `<section class="slide${i === 0 ? ' slide-cover' : ''}">` +
    `${i === 0 ? '<span class="hs-accent-bar"></span>' : ''}${pandocHtml({ input: part })}</section>`
  ).join('\n');
  return shellSlides({ slidesHtml, title: t, aspect });
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const doc = shellDoc({ bodyHtml: '<p>body</p>', title: 'T' });
  assert.match(doc, /--hs-ink/, 'inlines house-style tokens');
  assert.match(doc, /@page/, 'inlines house-doc layer');
  assert.match(doc, /hs-accent-bar/, 'has title accent bar');
  assert.match(doc, /<title>T<\/title>/, 'sets title');
  const deck = shellSlides({ slidesHtml: '<section class="slide"></section>', title: 'D', aspect: '16:9' });
  assert.match(deck, /ar169/, 'sets aspect class');
  assert.match(deck, /\.slide/, 'inlines slide layer');
  console.log('export-html self-test: OK');
}
