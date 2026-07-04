#!/usr/bin/env node
// theme.mjs — export theme resolution + CSS assembly. A theme is a directory:
// theme.json + css/{tokens,doc,slide,components}.css [+ css/profiles/<id>.css]
// [+ fonts/*.woff2] [+ reference/reference.{docx,pptx}] [+ preview/].
// Built-in themes live in templates/themes/; project themes in
// <cwd>/.twt-artifacts/export/themes/.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BUILTIN_THEME = 'doc-hub-light';
export function builtinThemesDir() { return join(HERE, '..', 'templates', 'themes'); }

function loadThemeDir(dir, source) {
  const jsonPath = join(dir, 'theme.json');
  if (!existsSync(jsonPath)) throw new Error(`Not a theme directory (missing theme.json): ${dir}`);
  const meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
  return { slug: meta.slug || basename(dir), dir, meta, source };
}

export function resolveTheme(ref, cwd = process.cwd()) {
  if (!ref) return loadThemeDir(join(builtinThemesDir(), BUILTIN_THEME), 'builtin');
  const asPath = resolve(cwd, String(ref).replace(/theme\.json$/i, ''));
  if (existsSync(join(asPath, 'theme.json'))) return loadThemeDir(asPath, 'path');
  const project = join(cwd, '.twt-artifacts', 'export', 'themes', String(ref));
  if (existsSync(join(project, 'theme.json'))) return loadThemeDir(project, 'project');
  const builtin = join(builtinThemesDir(), String(ref));
  if (existsSync(join(builtin, 'theme.json'))) return loadThemeDir(builtin, 'builtin');
  throw new Error(`Theme not found: ${ref} (looked for a theme dir path, ${project}, ${builtin})`);
}

export function resolveThemeOrLegacy(ref, cwd = process.cwd()) {
  if (ref && /\.md$/i.test(String(ref))) {
    return { theme: resolveTheme(undefined, cwd), legacyTemplate: resolve(cwd, String(ref)) };
  }
  return { theme: resolveTheme(ref, cwd), legacyTemplate: undefined };
}

export function listProjectThemes(cwd = process.cwd()) {
  const root = join(cwd, '.twt-artifacts', 'export', 'themes');
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { out.push(loadThemeDir(join(root, entry.name), 'project')); } catch { /* skip non-theme dirs */ }
  }
  return out;
}

export function readThemeCss(theme, layer) {
  return readFileSync(join(theme.dir, 'css', `${layer}.css`), 'utf8');
}

export function readProfileCss(theme, profileId) {
  const p = join(theme.dir, 'css', 'profiles', `${profileId}.css`);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

export function fontFaceCss(theme) {
  const faces = theme?.meta?.fonts?.faces || [];
  const rules = [];
  for (const f of faces) {
    const p = join(theme.dir, f.file);
    if (!existsSync(p)) continue; // system-stack fallback in tokens.css covers missing files
    const b64 = readFileSync(p).toString('base64');
    rules.push(`@font-face{font-family:'${f.family}';font-style:${f.style || 'normal'};font-weight:${f.weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`);
  }
  return rules.join('\n');
}

export function themeDocCss(theme, profileId = 'generic') {
  return [fontFaceCss(theme), readThemeCss(theme, 'tokens'), readThemeCss(theme, 'doc'),
    readThemeCss(theme, 'components'), readProfileCss(theme, profileId)].filter(Boolean).join('\n');
}

export function themeSlideCss(theme) {
  return [fontFaceCss(theme), readThemeCss(theme, 'tokens'), readThemeCss(theme, 'slide')]
    .filter(Boolean).join('\n');
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const t = resolveTheme(undefined);
  assert.equal(t.slug, 'doc-hub-light');
  assert.equal(t.source, 'builtin');
  assert.equal(t.meta.name, 'Doc Hub Light');
  assert.match(readThemeCss(t, 'tokens'), /--hs-ink:\s*#090e22/);
  assert.match(readThemeCss(t, 'tokens'), /--tx-ink:var\(--hs-ink\)/);
  assert.match(readThemeCss(t, 'doc'), /@page/);
  assert.match(readThemeCss(t, 'slide'), /\.slide/);
  assert.equal(typeof readThemeCss(t, 'components'), 'string');
  assert.equal(readProfileCss(t, 'report'), '');
  const byPath = resolveTheme(t.dir);
  assert.equal(byPath.slug, 'doc-hub-light');
  assert.equal(byPath.source, 'path');
  const legacy = resolveThemeOrLegacy('templates/document-export-style.md');
  assert.equal(legacy.theme.slug, 'doc-hub-light');
  assert.ok(legacy.legacyTemplate.endsWith('document-export-style.md'));
  const none = resolveThemeOrLegacy(undefined);
  assert.equal(none.legacyTemplate, undefined);
  assert.ok(Array.isArray(listProjectThemes(process.cwd())));
  assert.match(themeDocCss(t, 'generic'), /--hs-ink/);
  assert.match(themeDocCss(t, 'generic'), /@page/);
  assert.match(themeSlideCss(t), /\.slide/);
  assert.throws(() => resolveTheme('no-such-theme-xyz'));
  const ff = fontFaceCss(t);
  assert.match(ff, /@font-face/, 'emits @font-face');
  assert.match(ff, /font-family:'Montserrat'/, 'covers Montserrat');
  assert.match(ff, /data:font\/woff2;base64,/, 'inlines base64 woff2');
  assert.equal((ff.match(/@font-face/g) || []).length, 4, 'one rule per bundled face');
  assert.match(ff, /font-weight:400 700/, 'variable font declares a weight range');
  assert.equal(fontFaceCss({ dir: t.dir, meta: { fonts: { faces: [] } } }), '', 'empty faces → empty string');
  assert.match(themeDocCss(t, 'generic'), /@font-face/, 'doc css includes fonts');
  console.log('theme self-test: OK');
}
