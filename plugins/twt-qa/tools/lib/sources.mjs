// tools/lib/sources.mjs
// The single definition of "where is the built output" for the twt scanners.
//
// qa-scan.mjs owned these three functions inline; launch-scan.mjs needs the
// same answer. Two copies of a path contract drift, and the copy that drifts
// is the one nobody is looking at — which is exactly the failure check-io.mjs
// exists to catch between skills. One definition, two importers.
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export function listFiles(dir, ext) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext));
    else if (e.name.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}

export const rel = (projectDir, p) => (p ? relative(projectDir, p).replace(/\\/g, '/') : p);

export function locateTheme(projectDir) {
  const themesRoot = join(projectDir, 'wp-content', 'themes');
  if (!existsSync(themesRoot)) return null;
  for (const e of readdirSync(themesRoot, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith('hello-elementor-')) return join(themesRoot, e.name);
  }
  return null;
}

// The token-only CSS the elementor audit cares about (widgets.css /
// design-system.css), found anywhere under the theme dir; all CSS if neither
// canonical name exists.
export function locateElementorCss(projectDir) {
  const themeDir = locateTheme(projectDir);
  if (!themeDir) return { html: [], css: [], base: null };
  const all = listFiles(themeDir, '.css');
  const named = all.filter((f) => /(?:^|[\\/])(widgets|design-system)\.css$/i.test(f));
  return { html: [], css: named.length ? named : all, base: themeDir };
}

// Prefer a built site/; fall back to the design mockup. `kind` lets callers
// report honestly which one they scanned — a mockup scan is not a site scan.
export function locate(projectDir) {
  const siteDir = join(projectDir, 'site');
  if (existsSync(siteDir)) {
    return {
      html: listFiles(siteDir, '.html'),
      css: listFiles(siteDir, '.css'),
      base: siteDir,
      kind: 'site',
    };
  }
  const mockDir = join(projectDir, '.twt-artifacts', 'design', 'mockup');
  if (existsSync(mockDir)) {
    // listFiles(mockDir) already recurses into pages/, so concatenating a
    // separate pages/ listing would double-count every page. Dedupe.
    const html = [...new Set(listFiles(mockDir, '.html'))];
    return { html, css: listFiles(mockDir, '.css'), base: mockDir, kind: 'mockup' };
  }
  return { html: [], css: [], base: null, kind: null };
}
