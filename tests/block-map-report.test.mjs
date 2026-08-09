import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderReport } from '../tools/block-map/report.mjs';

function fixtureMap(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'block-map.json'), JSON.stringify({
    meta: { pages: 3, blocks: 3, engine: 'static', jsRenderedPages: [], unadjudicated: 0, generated: '2026-08-08T00:00:00Z' },
    pages: [{ id: 'P1', url: '/index' }, { id: 'P2', url: '/services' }, { id: 'P3', url: '/pricing' }],
    blocks: [
      { id: 'B01', name: 'Site header', tier: 'organism', aliases: ['.site-head'], parents: [], children: [], reuse: { pages: 3, instances: 3 }, instances: [{ page: '/index', selector: 'header.site-head' }], variants: [{ id: 'v1', count: 3, html: '<header></header>' }] },
      { id: 'B02', name: 'Card grid', tier: 'organism', aliases: ['.features', '.svc'], parents: [], children: ['B03'], reuse: { pages: 2, instances: 2 }, instances: [], variants: [{ id: 'v1', count: 2, html: '<section></section>' }] },
      { id: 'B03', name: 'Card', tier: 'molecule', aliases: ['.card', '.service-box'], parents: ['B02'], children: [], reuse: { pages: 2, instances: 6 }, instances: [], variants: [{ id: 'v1', count: 6, html: '<div></div>' }] },
    ],
  }, null, 2));
}

test('homepage carries the reuse matrix with every page as a column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  renderReport(dir);
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  for (const p of ['/index', '/services', '/pricing']) assert.ok(html.includes(p), `missing column ${p}`);
  assert.ok(html.includes('Site header') && html.includes('Card'));
});

test('homepage graph is filtered to reused blocks only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  renderReport(dir);
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  assert.ok(html.includes('mermaid'), 'a mermaid block must be present');
  const graph = html.slice(html.indexOf('class="mermaid"'), html.indexOf('</pre>', html.indexOf('class="mermaid"')));
  assert.ok(graph.includes('B02') && graph.includes('B03'), 'reused blocks belong in the skeleton');
});

test('one page per block, each with a neighborhood graph', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  const { blockPages } = renderReport(dir);
  assert.equal(blockPages.length, 3);
  const card = readFileSync(join(dir, 'block-B03-card.html'), 'utf8');
  assert.ok(card.includes('B02'), 'parent must appear in the neighborhood graph');
  assert.ok(card.includes('.service-box'), 'aliases must be listed');
});

test('markdown companion lists blocks with reuse counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  renderReport(dir);
  const md = readFileSync(join(dir, 'block-map.md'), 'utf8');
  assert.ok(md.includes('| Card |'));
  assert.ok(md.includes('.service-box'));
});

test('report renders with zero blocks without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'block-map.json'), JSON.stringify({ meta: { pages: 1, blocks: 0, jsRenderedPages: ['/app'] }, pages: [{ id: 'P1', url: '/app' }], blocks: [] }));
  const { blockPages } = renderReport(dir);
  assert.equal(blockPages.length, 0);
  assert.ok(readFileSync(join(dir, 'report.html'), 'utf8').includes('/app'), 'the js-rendered warning must name the page');
});
