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

test('two dependency aliases for the same claim still grade medium, not high', () => {
  // sass and node-sass are both DEP_CLAIMS aliases for 'scss', and this
  // fixture has both as devDependencies with NO config file at all. Two
  // evidence items of the SAME kind (dependency + dependency) must never
  // reach `high` — only two DISTINCT kinds (e.g. a dependency AND a config
  // file) do. Reproduces the review finding: grading on evidence-string
  // Set.size let two dependency aliases silently reach `high` with zero
  // config-file corroboration, converting what should be a question for
  // the user into a silent assumption.
  const s = scanProject(FIX('inherit-scss-aliases'));
  const scss = s.signals.find((x) => x.claim === 'scss');
  assert.equal(scss.confidence, 'medium');
  assert.equal(scss.evidence.length, 2, 'both dependency@version strings should still be listed, even though the kind-grade stays medium');
});

test('an existing root that is a FILE, not a directory, throws rather than returning an empty scan', () => {
  // existsSync passes for a file too. Without an explicit isDirectory()
  // check, walk()'s per-subdirectory catch (correct for subdirectories)
  // also swallows the top-level readdirSync(ENOTDIR) failure, returning a
  // fully-formed but empty Scan — exactly the silent "nothing here" a
  // downstream skill would wrongly act on.
  const filePath = fileURLToPath(new URL('./fixtures/inherit-next-tailwind/package.json', import.meta.url));
  assert.throws(() => scanProject(filePath), /not a directory/i);
});

test('root-level files are never counted as component evidence', () => {
  // functions.php sits at the WP fixture's ROOT. componentDirs feeds a
  // later exemplar picker that must never be handed a non-representative
  // file — same class of problem as the barrel-.ts exclusion above, but a
  // general depth rule this time: files directly under root never count,
  // regardless of filename.
  const s = scanProject(FIX('inherit-wp-classic'));
  const rootEntry = s.candidates.componentDirs.find((c) => c.dir === '.' || c.dir === '');
  assert.equal(rootEntry, undefined, 'functions.php at root must not produce a componentDirs entry at all');
  const templateParts = s.candidates.componentDirs.find((c) => c.dir.replace(/\\/g, '/') === 'template-parts');
  assert.equal(templateParts.count, 2, 'content-hero.php + content-card.php, unaffected by the root-exclusion rule');
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
  assert.equal(s.candidates.componentDirs[0].count, 2);
});

test('the barrel re-export in src/components is not counted as a component', () => {
  // src/components holds Card.tsx, Badge.tsx, AND index.ts (a one-line
  // `export { Card } from './Card'` barrel). A later task ranks
  // componentDirs to pick EXEMPLAR files a builder imitates, and that rule
  // explicitly excludes barrels/type-decls/utils because they teach the
  // wrong idiom — so componentDirs must never count a .ts file as
  // component-shaped, even though the directory obviously has three files
  // in it. Pin both halves: the .ts files genuinely exist in the tree
  // (extensions proves the walk saw them), and the component count is 2,
  // not 3 — proving the barrel was excluded on purpose, not just uncounted
  // by omission.
  const s = scanProject(FIX('inherit-next-tailwind'));
  assert.equal(s.extensions['.ts'], 2, 'tailwind.config.ts + src/components/index.ts must both be visible to the walk');
  const componentsDir = s.candidates.componentDirs.find((c) => c.dir.replace(/\\/g, '/') === 'src/components');
  assert.equal(componentsDir.count, 2, 'index.ts (the barrel) must not be counted alongside Card.tsx and Badge.tsx');
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
