// tests/launch-sources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { listFiles, locate, locateElementorCss, locateTheme, rel } from '../tools/lib/sources.mjs';

const newProject = () => mkdtempSync(join(tmpdir(), 'twt-src-'));
function put(p, content) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content, 'utf8'); }

test('locate: prefers site/ over the mockup fallback', () => {
  const dir = newProject();
  put(join(dir, 'site', 'index.html'), '<html></html>');
  put(join(dir, '.twt-artifacts', 'design', 'mockup', 'pages', 'home.html'), '<html></html>');
  const got = locate(dir);
  assert.equal(got.kind, 'site');
  assert.equal(got.html.length, 1);
  assert.match(got.html[0], /site[\\/]index\.html$/);
});

test('locate: falls back to the design mockup when no site/ exists', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'design', 'mockup', 'pages', 'home.html'), '<html></html>');
  const got = locate(dir);
  assert.equal(got.kind, 'mockup');
  assert.equal(got.html.length, 1);
});

test('locate: an empty project reports no base', () => {
  const got = locate(newProject());
  assert.equal(got.base, null);
  assert.equal(got.kind, null);
  assert.deepEqual(got.html, []);
});

test('locate: does not double-count a mockup page listed under pages/ and root', () => {
  const dir = newProject();
  const mock = join(dir, '.twt-artifacts', 'design', 'mockup');
  put(join(mock, 'pages', 'home.html'), '<html></html>');
  put(join(mock, 'index.html'), '<html></html>');
  const got = locate(dir);
  assert.equal(new Set(got.html).size, got.html.length, 'html list must be de-duplicated');
});

test('listFiles: recurses and matches extension case-insensitively', () => {
  const dir = newProject();
  put(join(dir, 'a', 'b', 'x.HTML'), 'x');
  put(join(dir, 'a', 'y.css'), 'y');
  assert.equal(listFiles(dir, '.html').length, 1);
  assert.equal(listFiles(dir, '.css').length, 1);
});

test('locateElementorCss: prefers widgets.css and design-system.css', () => {
  const dir = newProject();
  const theme = join(dir, 'wp-content', 'themes', 'hello-elementor-acme');
  put(join(theme, 'assets', 'css', 'widgets.css'), 'a{}');
  put(join(theme, 'assets', 'css', 'other.css'), 'b{}');
  const got = locateElementorCss(dir);
  assert.equal(got.css.length, 1);
  assert.match(got.css[0], /widgets\.css$/);
  assert.equal(locateTheme(dir), theme);
});

test('locateTheme: null when no hello-elementor child theme is present', () => {
  assert.equal(locateTheme(newProject()), null);
});

test('rel: forward slashes and project-relative', () => {
  const dir = newProject();
  assert.equal(rel(dir, join(dir, 'site', 'a.html')), 'site/a.html');
});
