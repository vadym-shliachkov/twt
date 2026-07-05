#!/usr/bin/env node
// export-html.mjs — build themed HTML from markdown for the export pipeline.
// Pipeline: md → pandoc JSON AST → doc-type profile transforms → pandoc HTML →
// theme shell (fonts + tokens + doc/slide + components CSS inlined).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolveTheme, themeDocCss, themeSlideCss } from './theme.mjs';
import { transformAst } from './export-transform.mjs';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function pandoc(args, input) {
  const r = spawnSync('pandoc', args, { encoding: 'utf8', input });
  if (r.status !== 0) throw new Error('pandoc failed: ' + ((r.stderr || r.error?.message || '').trim()));
  return r.stdout;
}
const mdToAst = (md) => JSON.parse(pandoc(['-f', 'markdown', '-t', 'json'], md));
const astToHtml = (ast) => pandoc(['-f', 'json', '-t', 'html'], JSON.stringify(ast));
const mdToPlainHtml = (md) => pandoc(['-f', 'markdown', '-t', 'html'], md);

export function shellDoc({ bodyHtml, title, css, accentBar = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${css}</style></head>
<body><main class="doc-wrap">${accentBar ? '<span class="hs-accent-bar"></span>' : ''}
${bodyHtml}
</main></body></html>`;
}

export function shellSlides({ slidesHtml, title, aspect, css }) {
  const cls = aspect === '4:3' ? 'ar43' : 'ar169';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${css}</style></head>
<body class="${cls}">${slidesHtml}</body></html>`;
}

export function mdToHtmlDoc({ markdownPath, title, theme, profile = 'generic' }) {
  const md = readFileSync(markdownPath, 'utf8');
  const t = title || md.match(/^#\s+(.+)$/m)?.[1] || 'Document';
  const resolved = theme || resolveTheme();
  const css = themeDocCss(resolved, profile);
  try {
    const { ast, applied } = transformAst(mdToAst(md), profile);
    // docHeader transform renders its own accent bar; only fall back to the shell bar without it
    const accentBar = !applied.includes('docHeader');
    return { html: shellDoc({ bodyHtml: astToHtml(ast), title: t, css, accentBar }), applied, transformError: undefined };
  } catch (e) {
    return { html: shellDoc({ bodyHtml: mdToPlainHtml(md), title: t, css, accentBar: true }), applied: [], transformError: e.message };
  }
}

export function mdToSlidesHtml({ markdownPath, aspect = '16:9', title, theme }) {
  const md = readFileSync(markdownPath, 'utf8');
  const t = title || md.match(/^#\s+(.+)$/m)?.[1] || 'Presentation';
  const resolved = theme || resolveTheme();
  const parts = md.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
  const slidesHtml = parts.map((part, i) => {
    const lines = part.split(/\r?\n/).filter((l) => l.trim());
    const headingOnly = lines.length > 0 && lines.every((l) => /^#{1,6}\s+/.test(l));
    const words = part.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;
    const classes = ['slide', i === 0 ? 'slide-cover' : '', headingOnly && i !== 0 ? 'slide-section' : '', words > 90 ? 'slide-dense' : '']
      .filter(Boolean).join(' ');
    const bar = (i === 0 || (headingOnly && i !== 0)) ? '<span class="hs-accent-bar"></span>' : '';
    return `<section class="${classes}">${bar}${mdToPlainHtml(part)}</section>`;
  }).join('\n');
  return { html: shellSlides({ slidesHtml, title: t, aspect, css: themeSlideCss(resolved) }) };
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const doc = shellDoc({ bodyHtml: '<p>body</p>', title: 'T', css: ':root{--hs-ink:#090e22}@page{}', accentBar: true });
  assert.match(doc, /--hs-ink/, 'inlines tokens');
  assert.match(doc, /@page/, 'inlines doc layer');
  assert.match(doc, /hs-accent-bar/, 'has title accent bar');
  assert.match(doc, /<title>T<\/title>/, 'sets title');
  const deck = shellSlides({ slidesHtml: '<section class="slide"></section>', title: 'D', aspect: '16:9', css: '.slide{}' });
  assert.match(deck, /ar169/, 'sets aspect class');
  assert.match(deck, /\.slide/, 'inlines slide layer');
  console.log('export-html self-test: OK');
}
