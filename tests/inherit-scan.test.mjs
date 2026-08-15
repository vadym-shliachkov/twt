import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { scanProject } from '../tools/inherit/scan.mjs';

const FIX = (name) => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

test('scan reports the package manager and dependencies as facts', () => {
  const s = scanProject(FIX('inherit-next-tailwind'));
  assert.equal(s.packageManager, 'pnpm');
  assert.equal(s.deps.next, '15.0.0');
  assert.equal(s.deps.tailwindcss, '3.4.0');
  assert.deepEqual(Object.keys(s.scripts).sort(), ['build', 'dev']);
});

test('scan lists config files it actually found, with their kind', () => {
  const s = scanProject(FIX('inherit-next-tailwind'));
  const kinds = s.configs.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['next', 'tailwind']);
  assert.ok(s.configs.every((c) => typeof c.file === 'string' && c.file.length > 0));
});

test('scan counts source extensions', () => {
  const s = scanProject(FIX('inherit-next-tailwind'));
  assert.equal(s.extensions['.tsx'], 3);
  assert.equal(s.extensions['.ts'], 2);   // tailwind.config.ts + components/index.ts
});

test('a high-confidence signal requires two independent evidences', () => {
  const s = scanProject(FIX('inherit-next-tailwind'));
  const next = s.signals.find((x) => x.claim === 'next');
  assert.equal(next.confidence, 'high');
  assert.equal(next.evidence.length, 2, 'dependency + config file');

  const vite = scanProject(FIX('inherit-vite-modules')).signals.find((x) => x.claim === 'vite');
  assert.equal(vite.confidence, 'high');
});

test('a single piece of evidence yields medium, never high', () => {
  // sass is a devDependency with no config file in this fixture
  const s = scanProject(FIX('inherit-vite-modules'));
  const sass = s.signals.find((x) => x.claim === 'scss');
  assert.equal(sass.confidence, 'medium');
  assert.equal(sass.evidence.length, 1);
});

test('scan never emits a claim it has no evidence for', () => {
  const s = scanProject(FIX('inherit-wp-classic'));
  assert.equal(s.signals.find((x) => x.claim === 'next'), undefined);
  assert.equal(s.signals.find((x) => x.claim === 'tailwind'), undefined);
  assert.ok(s.signals.every((x) => x.evidence.length > 0));
});

test('a WordPress theme is recognized from its style.css header', () => {
  const s = scanProject(FIX('inherit-wp-classic'));
  assert.equal(s.wordpress.themeName, 'Fixture Classic');
  assert.ok(s.signals.some((x) => x.claim === 'wordpress'));
});

test('the WP fixture is NOT reported as elementor', () => {
  // The whole point of this target is the non-Elementor WP case.
  const s = scanProject(FIX('inherit-wp-classic'));
  assert.equal(s.signals.find((x) => x.claim === 'elementor'), undefined);
});

test('component-directory candidates are ranked by file count', () => {
  const s = scanProject(FIX('inherit-next-tailwind'));
  assert.equal(s.candidates.componentDirs[0].dir.replace(/\\/g, '/'), 'src/components');
  assert.equal(s.candidates.componentDirs[0].count, 3);
});

test('a monorepo reports every workspace and picks none', () => {
  const s = scanProject(FIX('inherit-monorepo'));
  assert.equal(s.workspaces.length, 2);
  const names = s.workspaces.map((w) => w.name).sort();
  assert.deepEqual(names, ['admin', 'web']);
  // The scanner must NOT resolve the ambiguity — that is the skill's job, via a question.
  assert.equal(s.candidates.resolvedWorkspace, null);
});

test('an unreadable root throws rather than returning an empty scan', () => {
  // An empty scan would read as "a project with nothing in it" and be acted on.
  assert.throws(() => scanProject(FIX('inherit-does-not-exist')), /not readable|ENOENT/i);
});

// --- Extra coverage beyond the brief -------------------------------------
// The brief's tests are a floor, not a ceiling: they never prove the walk
// actually skips node_modules/.git/dist/.next, and never prove a fixture
// with no package.json at all (classic WP) survives scanProject without
// throwing. Both are exactly the kind of quietly-wrong behavior a scanner
// can ship with while every brief test still passes.

test('the walk skips node_modules, dist, and dot-directories like .next entirely', () => {
  // inherit-next-tailwind carries throwaway files under three dirs that must
  // never be walked: node_modules/junk-pkg/index.js and dist/bundle.js (both
  // via SKIP_DIRS), and .next/cache.js (via the generic leading-dot skip in
  // walk()). If the walk ever descended into any of them, extensions['.js']
  // would be >0 and componentDirs/extensions would pick up noise that has
  // nothing to do with the real project.
  const s = scanProject(FIX('inherit-next-tailwind'));
  assert.equal(s.extensions['.js'], undefined, 'no .js files should be visible — the only .js lives under skipped dirs');
  const allDirs = [...s.dirSignals, ...s.candidates.componentDirs.map((c) => c.dir)]
    .map((d) => d.replace(/\\/g, '/'));
  for (const bad of ['node_modules', 'dist', '.next']) {
    assert.ok(!allDirs.some((d) => d.includes(bad)), `${bad} must not appear in any scanned dir list`);
  }
});

test('a fixture with no package.json at all does not throw', () => {
  // inherit-wp-classic has no package.json — packageManagerOf, deps,
  // scripts, and workspacesOf must all degrade to empty/null rather than
  // throwing on a null pkg.
  assert.doesNotThrow(() => scanProject(FIX('inherit-wp-classic')));
  const s = scanProject(FIX('inherit-wp-classic'));
  assert.equal(s.packageManager, null);
  assert.deepEqual(s.deps, {});
  assert.deepEqual(s.scripts, {});
  assert.deepEqual(s.workspaces, []);
});
