#!/usr/bin/env node
// export-theme-create.mjs — generate a WHOLE export theme (css layers with
// substituted tokens, fonts, reference docs, preview) from the doc-hub-light
// base. The model decides token values (reading brand sources); this script
// makes every file deterministically. Replaces the old prose-only
// export-template-create.mjs.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolveTheme } from './theme.mjs';
import { mdToHtmlDoc } from './export-html.mjs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALID_TYPES = new Set(['document', 'presentation', 'universal']);

// token key → the --hs-* declaration it overrides in tokens.css
const TOKEN_VARS = {
  ink: '--hs-ink', text: '--hs-text', muted: '--hs-muted', rule: '--hs-rule',
  panel: '--hs-panel-soft', surface: '--hs-surface', accent: '--hs-accent-blue',
  accent2: '--hs-accent-red', accent3: '--hs-accent-yellow',
  ok: '--hs-ok', warn: '--hs-warning', danger: '--hs-danger',
};
const FONT_VARS = { fontHeading: '--hs-font-heading', fontBody: '--hs-font-body', fontMono: '--hs-font-mono' };
const BUNDLED_FAMILIES = new Set(['Inter', 'Montserrat', 'IBM Plex Mono']);

const PREVIEW_SAMPLE_MD = `# Theme Preview — Sample Report

- **Subject:** sample document
- **Document Overall:** 85/100
- **Findings:** 1 Problem · 2 Opportunities

## Summary

| Block | Type | Overall | Finding Type | Decision |
|---|---|---|---|---|
| 1 | Heading | 92 | No issue | Keep original |
| 2 | CTA | 64 | Problem | Rewrite |

## Palette

| Name | Hex | Usage |
|---|---|---|
| Ink | #090E22 | Headings |
| Accent | #0B68B7 | Links |

## Findings

#### Finding 1

- **Where:** Hero section
- **Problem:** Vague claim
- **Recommendation:** Add a proof point

> Blockquote sample with \`inline code\`.
`;

function slugify(value) {
  return String(value).toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'theme';
}

function substituteTokens(css, tokens, fonts) {
  let out = css;
  for (const [key, value] of Object.entries(tokens || {})) {
    const varName = TOKEN_VARS[key];
    if (!varName) throw new Error(`Unknown token key: ${key} (valid: ${Object.keys(TOKEN_VARS).join(', ')})`);
    out = out.replace(new RegExp(`(${varName}:)[^;]+;`), `$1${value};`);
  }
  for (const [key, family] of Object.entries(fonts || {})) {
    if (!family) continue;
    const varName = FONT_VARS[key];
    out = out.replace(new RegExp(`(${varName}:)[^;]+;`), (m, p1) => `${p1}${family},ui-sans-serif,system-ui,sans-serif;`);
  }
  return out;
}

export function createTheme(opts, cwd = process.cwd()) {
  if (!opts.name) throw new Error('Missing --name.');
  if (!opts.type || !VALID_TYPES.has(opts.type)) throw new Error('Missing or invalid --type (document|presentation|universal).');
  const base = resolveTheme(); // built-in doc-hub-light
  const slug = slugify(opts.name);
  const dir = join(cwd, '.twt-artifacts', 'export', 'themes', slug);
  if (existsSync(dir) && !opts.force) throw new Error(`Theme already exists. Re-run with --force to overwrite: ${dir}`);
  mkdirSync(join(dir, 'css'), { recursive: true });

  const fonts = { fontHeading: opts.fontHeading, fontBody: opts.fontBody, fontMono: opts.fontMono };
  // css layers: tokens gets substitutions; doc/slide/components copy verbatim
  writeFileSync(join(dir, 'css', 'tokens.css'), substituteTokens(readFileSync(join(base.dir, 'css', 'tokens.css'), 'utf8'), opts.tokens, fonts), 'utf8');
  for (const layer of ['doc', 'slide', 'components']) {
    writeFileSync(join(dir, 'css', `${layer}.css`), readFileSync(join(base.dir, 'css', `${layer}.css`), 'utf8'), 'utf8');
  }

  // fonts: copy bundled woff2 for any requested family we bundle; default to base families
  const wanted = new Set([opts.fontHeading || 'Montserrat', opts.fontBody || 'Inter', opts.fontMono || 'IBM Plex Mono']
    .filter((f) => BUNDLED_FAMILIES.has(f)));
  const faces = (base.meta.fonts?.faces || []).filter((f) => wanted.has(f.family));
  if (faces.length) {
    mkdirSync(join(dir, 'fonts'), { recursive: true });
    for (const f of faces) cpSync(join(base.dir, f.file), join(dir, f.file));
    cpSync(join(base.dir, 'fonts', 'LICENSE.md'), join(dir, 'fonts', 'LICENSE.md'));
  }

  const notes = [];
  // reference docs: python builder with theme colors, else copy base
  mkdirSync(join(dir, 'reference'), { recursive: true });
  if (!opts.skipReference) {
    const hex = (v, fallback) => String(v || fallback).replace(/^#/, '');
    const py = spawnSync('python', [join(HERE, 'build-reference-docs.py'),
      '--out-dir', join(dir, 'reference'),
      '--ink', hex(opts.tokens?.ink, '090E22'), '--body-color', hex(opts.tokens?.text, '3A3F5C'),
      '--rule', hex(opts.tokens?.rule, 'DDE0EE'), '--panel', hex(opts.tokens?.panel, 'F8F9FC'),
      '--accent', hex(opts.tokens?.accent, '0B68B7'),
      '--heading-font', opts.fontHeading || 'Montserrat', '--body-font', opts.fontBody || 'Inter',
    ], { encoding: 'utf8' });
    if (py.status !== 0) {
      cpSync(join(base.dir, 'reference'), join(dir, 'reference'), { recursive: true });
      notes.push('Reference docs: python/pandoc build failed — copied doc-hub-light reference docs instead. DOCX/PPTX will use house typography.');
    } else notes.push('Reference docs: built with theme colors/fonts.');
  } else {
    cpSync(join(base.dir, 'reference'), join(dir, 'reference'), { recursive: true });
    notes.push('Reference docs: copied from doc-hub-light (--skip-reference).');
  }

  const meta = {
    name: opts.name, slug, version: '1.0.0', type: opts.type,
    description: opts.description || `${opts.name} export theme`,
    styleDirection: opts.style || 'minimal editorial',
    brandSource: opts.brand || '', instructions: opts.instructions || '',
    tokens: opts.tokens || {},
    fonts: { strategy: faces.length ? 'bundled' : 'system', faces },
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, 'theme.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  // preview
  if (!opts.skipPreview) {
    try {
      const sampleMd = join(tmpdir(), `theme-preview-${slug}.md`);
      writeFileSync(sampleMd, PREVIEW_SAMPLE_MD, 'utf8');
      const theme = { slug, dir, meta, source: 'project' };
      const { html } = mdToHtmlDoc({ markdownPath: sampleMd, title: `${opts.name} — preview`, theme, profile: 'report' });
      mkdirSync(join(dir, 'preview'), { recursive: true });
      writeFileSync(join(dir, 'preview', 'preview.html'), html, 'utf8');
      notes.push('Preview: preview/preview.html rendered with the report profile sample.');
    } catch (e) { notes.push(`Preview: skipped (${e.message}).`); }
  }
  writeFileSync(join(dir, 'preview-notes.md'), `# Preview notes - ${opts.name}\n\nGenerated: ${meta.createdAt}\nTheme: ${dir}\nType: ${meta.type}\nStyle: ${meta.styleDirection}\nBrand source: ${meta.brandSource || 'none'}\n\n## Build notes\n${notes.map((n) => `- ${n}`).join('\n')}\n\n## Next use\n- Export with it: \`--theme ${slug}\` on /twt-export-pdf, /twt-export-docx, /twt-export-presentation, or pick it from the theme menu.\n`, 'utf8');
  return { slug, dir, meta, notes };
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const cwd = join(tmpdir(), 'theme-create-selftest');
  rmSync(cwd, { recursive: true, force: true }); mkdirSync(cwd, { recursive: true });
  const res = createTheme({
    name: 'Acme Executive Report', type: 'document', style: 'executive premium',
    tokens: { ink: '#0A1A2F', accent: '#C8102E' }, fontHeading: 'Montserrat', fontBody: 'Inter',
    skipReference: true, skipPreview: true, force: false,
  }, cwd);
  assert.equal(res.slug, 'acme-executive-report');
  const dir = join(cwd, '.twt-artifacts', 'export', 'themes', 'acme-executive-report');
  assert.ok(existsSync(join(dir, 'theme.json')));
  for (const layer of ['tokens', 'doc', 'slide', 'components']) assert.ok(existsSync(join(dir, 'css', `${layer}.css`)), layer);
  const tokens = readFileSync(join(dir, 'css', 'tokens.css'), 'utf8');
  assert.match(tokens, /--hs-ink:\s*#0A1A2F/i, 'ink substituted');
  assert.match(tokens, /--hs-accent-blue:\s*#C8102E/i, 'accent substituted');
  assert.match(tokens, /--tx-ink:var\(--hs-ink\)/, 'tx aliases intact');
  const meta = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
  assert.equal(meta.type, 'document');
  assert.ok(meta.fonts.faces.length > 0, 'bundled fonts copied for known families');
  assert.ok(existsSync(join(dir, meta.fonts.faces[0].file)), 'woff2 copied');
  assert.throws(() => createTheme({ name: 'Acme Executive Report', type: 'document', skipReference: true, skipPreview: true }, cwd), /--force/);
  console.log('export-theme-create self-test: OK');
}

if (_isMain && !process.argv.includes('--self-test')) {
  try {
    const argv = process.argv.slice(2); const o = { tokens: {} };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--name') o.name = argv[++i];
      else if (a === '--type') o.type = argv[++i];
      else if (a === '--description') o.description = argv[++i];
      else if (a === '--style') o.style = argv[++i];
      else if (a === '--instructions') o.instructions = argv[++i];
      else if (a === '--brand') o.brand = argv[++i];
      else if (a === '--font-heading') o.fontHeading = argv[++i];
      else if (a === '--font-body') o.fontBody = argv[++i];
      else if (a === '--font-mono') o.fontMono = argv[++i];
      else if (a === '--token') { const [k, ...v] = argv[++i].split('='); o.tokens[k] = v.join('='); }
      else if (a === '--skip-reference') o.skipReference = true;
      else if (a === '--skip-preview') o.skipPreview = true;
      else if (a === '--force') o.force = true;
      else throw new Error(`Unknown argument: ${a}`);
    }
    const res = createTheme(o);
    console.log(`Theme: ${res.dir}`);
    for (const n of res.notes) console.log(`Note: ${n}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
