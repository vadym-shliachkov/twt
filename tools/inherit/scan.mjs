#!/usr/bin/env node
// scan.mjs — deterministic facts about a host codebase.
//
// This file reports what IS THERE and nothing else. It never concludes "this is
// a Next.js project with Tailwind" — it reports that `next` is a dependency and
// that `next.config.mjs` exists, and lets the model draw the conclusion with the
// evidence in hand. The split matters because a wrong conclusion drawn here is
// invisible downstream, whereas a wrong conclusion drawn from listed evidence is
// arguable against the evidence.
//
// Confidence is mechanical, not judged: `high` needs two INDEPENDENT evidences
// (a dependency and a config file), `medium` is one, and a claim with no
// evidence is never emitted at all.
'use strict';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out',
  'vendor', 'coverage', '.turbo', '.svelte-kit', '.astro',
]);

const CONFIG_KINDS = [
  [/^next\.config\.(js|mjs|ts)$/, 'next'],
  [/^vite\.config\.(js|mjs|ts)$/, 'vite'],
  [/^tailwind\.config\.(js|mjs|ts|cjs)$/, 'tailwind'],
  [/^astro\.config\.(js|mjs|ts)$/, 'astro'],
  [/^nuxt\.config\.(js|mjs|ts)$/, 'nuxt'],
  [/^svelte\.config\.(js|mjs|ts)$/, 'svelte'],
  [/^angular\.json$/, 'angular'],
  [/^composer\.json$/, 'composer'],
];

// A dependency name -> the claim it supports. Kept separate from CONFIG_KINDS so
// a claim can collect evidence from both sources and reach `high`.
const DEP_CLAIMS = {
  next: 'next', nuxt: 'nuxt', astro: 'astro', vite: 'vite', vue: 'vue',
  react: 'react', svelte: 'svelte', '@angular/core': 'angular',
  tailwindcss: 'tailwind', sass: 'scss', 'node-sass': 'scss',
  'styled-components': 'theme-object', '@emotion/react': 'theme-object',
  '@vanilla-extract/css': 'theme-object',
};

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function walk(root, rel = '', out = { files: [], dirs: [] }) {
  let entries;
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.dirs.push(r);
      walk(root, r, out);
    } else {
      out.files.push(r);
    }
  }
  return out;
}

function packageManagerOf(pkg, root) {
  if (pkg?.packageManager) return String(pkg.packageManager).split('@')[0];
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return null;
}

function wordpressOf(root) {
  const style = join(root, 'style.css');
  if (!existsSync(style)) return null;
  const head = readFileSync(style, 'utf8').slice(0, 2000);
  const name = head.match(/^\s*Theme Name:\s*(.+)$/mi);
  if (!name) return null;
  const template = head.match(/^\s*Template:\s*(.+)$/mi);
  return { themeName: name[1].trim(), template: template ? template[1].trim() : null };
}

function workspacesOf(pkg, root) {
  const globs = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  if (!Array.isArray(globs)) return [];
  const out = [];
  for (const g of globs) {
    const base = g.replace(/\/\*+$/, '');
    let entries;
    try { entries = readdirSync(join(root, base), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = readJson(join(root, base, e.name, 'package.json'));
      if (sub) out.push({ name: sub.name || e.name, dir: `${base}/${e.name}`, deps: sub.dependencies || {} });
    }
  }
  return out;
}

export function scanProject(root) {
  if (!existsSync(root)) throw new Error(`scanProject: root not readable: ${root}`);
  // existsSync passes for a FILE too, and walk()'s per-subdirectory catch is
  // correct for individual subdirectories but would otherwise also swallow a
  // top-level readdirSync(ENOTDIR) failure here, returning an empty-but-valid
  // Scan. An empty scan reads as "a project with nothing in it" and would be
  // acted on — so a non-directory root must throw before walk() ever runs.
  if (!statSync(root).isDirectory()) throw new Error(`scanProject: root exists but is not a directory: ${root}`);

  const pkg = readJson(join(root, 'package.json'));
  const tree = walk(root);

  const configs = [];
  for (const f of tree.files) {
    const base = f.split('/').pop();
    for (const [re, kind] of CONFIG_KINDS) if (re.test(base)) configs.push({ file: f, kind });
  }

  const extensions = {};
  for (const f of tree.files) {
    const e = extname(f);
    if (e) extensions[e] = (extensions[e] || 0) + 1;
  }

  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const wordpress = wordpressOf(root);

  // Evidence collection: a claim reaches `high` only with two INDEPENDENT
  // KINDS of evidence (dependency / config / file), never just two facts of
  // the same kind. Two dependency aliases for one claim (sass + node-sass,
  // both -> 'scss') must stay `medium` — grading on evidence-string count
  // alone let two same-kind facts silently masquerade as independent
  // corroboration, which is exactly the false-high a later skill would act
  // on as "no need to ask the user". Each claim maps evidence TEXT -> KIND;
  // the text stays deduped and human-readable, the kind drives the grade.
  const evidence = new Map();
  const add = (claim, kind, item) => {
    if (!evidence.has(claim)) evidence.set(claim, new Map());
    evidence.get(claim).set(item, kind);
  };
  for (const [dep, claim] of Object.entries(DEP_CLAIMS)) {
    if (deps[dep]) add(claim, 'dependency', `dependency ${dep}@${deps[dep]}`);
  }
  for (const c of configs) add(c.kind, 'config', `config file ${c.file}`);
  if (wordpress) {
    add('wordpress', 'file', `style.css Theme Name: ${wordpress.themeName}`);
    if (existsSync(join(root, 'functions.php'))) add('wordpress', 'file', 'functions.php present');
  }
  // Elementor is a DIFFERENT target and must never be claimed from a bare WP theme.
  if (deps['elementor'] || tree.dirs.some((d) => /(^|\/)elementor($|\/)/i.test(d))) {
    add('elementor', 'file', 'elementor dependency or directory');
  }
  if (tree.files.some((f) => f.endsWith('.module.css') || f.endsWith('.module.scss'))) {
    add('css-modules', 'file', 'a *.module.css file exists');
  }

  const signals = [...evidence.entries()].map(([claim, byText]) => ({
    claim,
    confidence: new Set(byText.values()).size >= 2 ? 'high' : 'medium',
    evidence: [...byText.keys()],
  }));

  const DIR_SIGNALS = ['app', 'pages', 'src/components', 'components', 'resources/views',
                       'template-parts', 'wp-content/themes', 'src/routes'];
  const dirSignals = DIR_SIGNALS.filter((d) => tree.dirs.includes(d));

  // Deliberately excludes .ts: a bare .ts file in a components dir is far more
  // likely a barrel re-export, type-decl, or util than an actual component,
  // and a later task ranks componentDirs to pick EXEMPLAR files a builder will
  // imitate — a one-line `export { Card } from './Card'` barrel teaches the
  // wrong idiom if it counts as component-shaped evidence here.
  const COMPONENT_EXT = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.astro', '.php']);
  const perDir = new Map();
  for (const f of tree.files) {
    if (!COMPONENT_EXT.has(extname(f))) continue;
    // Files at the repository root are never component evidence — same
    // class of problem as the barrel exclusion above. A component at the
    // repo root is essentially never the real idiom (WordPress bootstrap
    // files like functions.php are the recurring offender), and a depth
    // rule needs no maintenance as bootstrap filenames vary by target.
    if (!f.includes('/')) continue;
    const dir = f.split('/').slice(0, -1).join('/');
    perDir.set(dir, (perDir.get(dir) || 0) + 1);
  }
  const componentDirs = [...perDir.entries()]
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));

  const workspaces = workspacesOf(pkg, root);

  return {
    root,
    packageManager: packageManagerOf(pkg, root),
    deps,
    scripts: pkg?.scripts || {},
    configs,
    extensions,
    dirSignals,
    workspaces,
    wordpress,
    // resolvedWorkspace stays null on purpose: a monorepo is a QUESTION for the
    // skill to ask, never a guess for the scanner to make.
    candidates: { componentDirs, resolvedWorkspace: null },
    signals,
  };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const root = process.argv[2];
  const outIdx = process.argv.indexOf('--out');
  try {
    const scan = scanProject(root);
    const payload = JSON.stringify(scan, null, 2);
    if (outIdx !== -1) writeFileSync(process.argv[outIdx + 1], payload);
    else process.stdout.write(payload);
    process.stderr.write(`scanned ${Object.values(scan.extensions).reduce((a, b) => a + b, 0)} files, ${scan.signals.length} signals\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(3);
  }
}
