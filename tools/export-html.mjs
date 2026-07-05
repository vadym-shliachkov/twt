#!/usr/bin/env node
// export-html.mjs — build themed HTML from markdown for the export pipeline.
// Pipeline: md → pandoc JSON AST → doc-type profile transforms → pandoc HTML →
// theme shell (fonts + tokens + doc/slide + components CSS inlined).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { resolveTheme, themeDocCss, themeSlideCss } from './theme.mjs';
import { transformAst } from './export-transform.mjs';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Slide splitter. A new slide starts on either boundary, both fence-aware (a lone
// `---` or a leading `#` inside a ``` / ~~~ code fence is content, not a boundary):
//   1. a `---` horizontal rule, or
//   2. a top-level `# ` (H1) heading — matching Pandoc's `--slide-level=1`.
// The H1 rule means a deck that forgets a `---` between two `# Slide N` headings
// still splits correctly instead of merging (and overflowing) two slides.
// Shared by the HTML/PDF path (mdToSlidesHtml below) and tools/export-presentation.mjs.
export function splitSlides(markdown) {
  const lines = markdown.split(/\r?\n/);
  const slides = [];
  let current = [];
  let inFence = false;
  let fenceMarker = "";
  const flush = () => {
    if (current.join("\n").trim()) slides.push(current.join("\n").trim());
    current = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence && !inFence) {
      inFence = true;
      fenceMarker = fence[1][0];
      current.push(line);
      continue;
    }
    if (inFence && line.trim().startsWith(fenceMarker.repeat(3))) {
      inFence = false;
      fenceMarker = "";
      current.push(line);
      continue;
    }
    if (!inFence && /^-{3,}\s*$/.test(line)) {
      flush();
      continue;
    }
    // A top-level H1 begins a new slide, but only when the current slide already
    // has content — so the deck's opening heading doesn't emit an empty first slide.
    if (!inFence && /^#\s+/.test(line) && current.some((l) => l.trim())) {
      flush();
      current.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  return slides;
}

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

export function shellSlides({ slidesHtml, title, aspect, css, script = '' }) {
  const cls = aspect === '4:3' ? 'ar43' : 'ar169';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${css}</style></head>
<body class="${cls}">${slidesHtml}${script}</body></html>`;
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

// Pull the leading heading (any level) out of a rendered slide body so the slide
// title can live in a fixed band while the rest of the content flows below it.
function extractLeadingHeading(html) {
  const m = html.match(/^\s*<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>\s*/i);
  if (!m) return { title: '', rest: html };
  return { title: m[1], rest: html.slice(m[0].length) };
}

// Runtime slide paginator, embedded once per deck. After web fonts settle it runs
// three passes over every content slide's `.slide-flow`:
//   1. cleanup — drop empty <li>/<ul> (e.g. a stray "-" bullet in the source);
//   2. structure — pair a "Pros" list with a "Cons" list into a two-column block,
//      and tag "<p>label:</p>" lead-ins that head a list;
//   3. paginate — while a slide's content overflows its fixed box, peel trailing
//      blocks onto a cloned "(cont.)" slide (split-to-fit; type sizes never change).
// Then it renumbers the rail + footer. Setting window.__slidesReady lets the PDF
// renderer wait for pagination before printing; opening the HTML directly runs it too.
const SLIDE_PAGINATOR = `<script>/* twt slide paginator — split-to-fit, runs once after fonts load */
(function(){
  var done=false;
  function overflow(el){ return el.scrollHeight - el.clientHeight > 1; }
  function labelPair(flow, re){
    var kids = Array.prototype.slice.call(flow.children);
    for (var i=0;i<kids.length-1;i++){
      if (kids[i].tagName==='P' && re.test(kids[i].textContent||'') && kids[i+1].tagName==='UL'){ return {p:kids[i], ul:kids[i+1]}; }
    }
    return null;
  }
  function stripEmpties(flow){
    Array.prototype.slice.call(flow.querySelectorAll('li')).forEach(function(li){ if(!li.textContent.trim() && !li.querySelector('img,svg')) li.remove(); });
    Array.prototype.slice.call(flow.querySelectorAll('ul,ol')).forEach(function(l){ if(!l.children.length) l.remove(); });
  }
  function groupProsCons(flow){
    var pros = labelPair(flow, /^\\s*pros\\b/i), cons = labelPair(flow, /^\\s*cons\\b/i);
    if(!pros || !cons) return;
    var anchor = pros.p.previousElementSibling;
    var box=document.createElement('div'); box.className='pros-cons';
    var c1=document.createElement('div'); c1.className='pc-col pc-pros';
    var c2=document.createElement('div'); c2.className='pc-col pc-cons';
    pros.p.textContent = pros.p.textContent.replace(/:\\s*$/,'');
    cons.p.textContent = cons.p.textContent.replace(/:\\s*$/,'');
    c1.appendChild(pros.p); c1.appendChild(pros.ul);
    c2.appendChild(cons.p); c2.appendChild(cons.ul);
    box.appendChild(c1); box.appendChild(c2);
    if(anchor && anchor.parentNode===flow) anchor.after(box); else flow.insertBefore(box, flow.firstChild);
  }
  function leadLabels(flow){
    Array.prototype.slice.call(flow.children).forEach(function(el){
      if(el.tagName==='P' && /:\\s*$/.test(el.textContent||'')){
        var n = el.nextElementSibling;
        if(n && (n.tagName==='UL'||n.tagName==='OL')){ el.classList.add('lead-label'); el.textContent = el.textContent.replace(/:\\s*$/,''); }
      }
    });
  }
  function makeCont(slide){
    var c = slide.cloneNode(true); c.classList.add('slide-cont');
    var title = c.querySelector('.slide-title');
    if(title && !/\\(cont\\.\\)\\s*$/.test(title.textContent)) title.textContent = title.textContent + ' (cont.)';
    var flow = c.querySelector('.slide-flow'); while(flow && flow.firstChild) flow.removeChild(flow.firstChild);
    return c;
  }
  function paginate(){
    var list = Array.prototype.slice.call(document.querySelectorAll('section.slide'));
    for (var i=0;i<list.length;i++){
      var slide = list[i];
      if (slide.classList.contains('slide-cover') || slide.classList.contains('slide-section')) continue;
      var main = slide.querySelector('.slide-main'), flow = slide.querySelector('.slide-flow');
      if(!main || !flow) continue;
      if (overflow(main) && flow.children.length > 1){
        var cont = makeCont(slide); slide.after(cont);
        var cflow = cont.querySelector('.slide-flow'), guard=0;
        while (overflow(main) && flow.children.length > 1 && guard++ < 200){
          cflow.insertBefore(flow.lastElementChild, cflow.firstChild);
        }
        list.splice(i+1, 0, cont);
      }
    }
  }
  function renumber(){
    var all = document.querySelectorAll('section.slide'), total = all.length;
    for (var i=0;i<all.length;i++){
      var n=i+1;
      var num = all[i].querySelector('.rail-num'); if(num) num.textContent = (n<10?'0':'')+n;
      var pg = all[i].querySelector('.foot-page'); if(pg) pg.textContent = n + ' / ' + total;
    }
  }
  function run(){
    if(done) return; done=true;
    var slides = document.querySelectorAll('section.slide');
    for (var i=0;i<slides.length;i++){
      var flow = slides[i].querySelector('.slide-flow');
      if(flow){ stripEmpties(flow); groupProsCons(flow); leadLabels(flow); }
    }
    paginate(); renumber();
    window.__slidesReady = true;
  }
  if (document.fonts && document.fonts.ready){ document.fonts.ready.then(run); }
  setTimeout(run, 1600);
})();
</script>`;

export function mdToSlidesHtml({ markdownPath, aspect = '16:9', title, theme }) {
  const md = readFileSync(markdownPath, 'utf8');
  const t = title || md.match(/^#\s+(.+)$/m)?.[1] || 'Presentation';
  const resolved = theme || resolveTheme();
  const parts = splitSlides(md);
  const deckLabel = esc(t);
  const slidesHtml = parts.map((part, i) => {
    const lines = part.split(/\r?\n/).filter((l) => l.trim());
    const headingOnly = lines.length > 0 && lines.every((l) => /^#{1,6}\s+/.test(l));
    const bodyHtml = mdToPlainHtml(part);
    // Slide 1 is the cover; a slide that is only a heading is a section divider.
    // Both keep their own centered / bottom-anchored treatment with no side-rail.
    if (i === 0) {
      return `<section class="slide slide-cover"><span class="hs-accent-bar"></span>${bodyHtml}</section>`;
    }
    if (headingOnly) {
      return `<section class="slide slide-section"><span class="hs-accent-bar"></span>${bodyHtml}</section>`;
    }
    const { title: slideTitle, rest } = extractLeadingHeading(bodyHtml);
    const head = slideTitle ? `<h1 class="slide-title">${slideTitle}</h1><span class="slide-rule"></span>` : '';
    return `<section class="slide">`
      + `<aside class="slide-rail"><span class="rail-num">00</span></aside>`
      + `<div class="slide-main">${head}<div class="slide-flow">${rest}</div></div>`
      + `<footer class="slide-foot"><span class="foot-deck">${deckLabel}</span><span class="foot-page">0 / 0</span></footer>`
      + `</section>`;
  }).join('\n');
  return { html: shellSlides({ slidesHtml, title: t, aspect, css: themeSlideCss(resolved), script: SLIDE_PAGINATOR }) };
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const doc = shellDoc({ bodyHtml: '<p>body</p>', title: 'T', css: ':root{--hs-ink:#090e22}@page{}', accentBar: true });
  assert.match(doc, /--hs-ink/, 'inlines tokens');
  assert.match(doc, /@page/, 'inlines doc layer');
  assert.match(doc, /hs-accent-bar/, 'has title accent bar');
  assert.match(doc, /<title>T<\/title>/, 'sets title');
  const deck = shellSlides({ slidesHtml: '<section class="slide"></section>', title: 'D', aspect: '16:9', css: '.slide{}', script: '<script>1</script>' });
  assert.match(deck, /ar169/, 'sets aspect class');
  assert.match(deck, /\.slide/, 'inlines slide layer');
  assert.match(deck, /<script>1<\/script><\/body>/, 'appends deck script before </body>');

  // Slide builder: cover + two content slides. Unified type (no dense/packed tiers),
  // side-rail structure, and an embedded paginator that guarantees fit by splitting.
  const bulletsA = Array.from({ length: 9 }, (_, n) => `- bullet point number ${n} with a few extra words here`).join('\n');
  const bulletsB = Array.from({ length: 14 }, (_, n) => `- bullet point number ${n} with several extra words to pad out the count here today`).join('\n');
  const tmpDeck = [
    '# Cover Slide',
    '---',
    `## Content Slide A\n${bulletsA}`,
    '---',
    `## Content Slide B\n${bulletsB}`,
  ].join('\n');
  const tmpPath = path.join(os.tmpdir(), `export-html-self-test-${process.pid}.md`);
  writeFileSync(tmpPath, tmpDeck, 'utf8');
  const { html: deckHtml } = mdToSlidesHtml({ markdownPath: tmpPath });
  assert.doesNotMatch(deckHtml, /slide-dense|slide-packed/, 'no legacy shrink tiers — density is handled by pagination');
  assert.match(deckHtml, /slide-cover/, 'first slide is the cover');
  assert.match(deckHtml, /class="slide-rail"/, 'content slides get an accent side-rail');
  assert.match(deckHtml, /class="slide-title"/, 'content slides lift the heading into a title band');
  assert.match(deckHtml, /class="slide-flow"/, 'content slides wrap flow content');
  assert.match(deckHtml, /class="slide-foot"/, 'content slides get a footer');
  assert.match(deckHtml, /__slidesReady/, 'embeds the paginator ready signal');
  const coverSectionHtml = deckHtml.split('<section')[1];
  assert.doesNotMatch(coverSectionHtml, /slide-rail/, 'cover has no side-rail');

  // Fence-aware splitting: a lone `---` line inside a code fence is content, not a
  // slide boundary — must not tear the slide in two.
  assert.equal(splitSlides('# Cover\n---\n# Slide 2\n```\nfoo\n---\nbar\n```').length, 2, 'splitSlides keeps fenced --- as content');
  // H1-aware splitting: two `# ` slides with no `---` between them still split.
  assert.equal(splitSlides('# Slide 1\ntext\n# Slide 2\nmore').length, 2, 'a forgotten --- between H1 slides still splits');
  assert.equal(splitSlides('# Only\ntext').length, 1, 'a single H1 slide is not double-counted');
  assert.equal(splitSlides('# A\n```\n# not a heading\n```').length, 1, 'a leading # inside a fence is content, not a boundary');
  const fencedDeck = [
    '# Cover Slide',
    '---',
    '## Slide 2 With Fence',
    '```',
    'some code',
    '---',
    'more code',
    '```',
  ].join('\n');
  const fencedPath = path.join(os.tmpdir(), `export-html-self-test-fence-${process.pid}.md`);
  writeFileSync(fencedPath, fencedDeck, 'utf8');
  const { html: fencedHtml } = mdToSlidesHtml({ markdownPath: fencedPath });
  const sectionCount = (fencedHtml.match(/<section/g) || []).length;
  assert.equal(sectionCount, 2, 'lone --- inside a code fence must not split the slide in two');

  console.log('export-html self-test: OK');
}
