import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanProject } from '../tools/inherit/scan.mjs';
import { detectStylingSystem } from '../tools/inherit/adapters.mjs';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../tools/inherit/scan.mjs', import.meta.url));
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

// ---------------------------------------------------------------------------
// css-vars reachability (final-review Important I1). `css-vars` sat in
// adapters.mjs's PRECEDENCE and in twt-inherit-define's prose, but scan.mjs
// never emitted the claim — so a host that genuinely styles with CSS custom
// properties resolved to `none` and was reported as "degraded: no styling
// system detected". The spec's HIGHEST-fidelity adapter was graded as its
// LOWEST, and /twt-qa-design's one runnable rule set was permanently skipped.
// ---------------------------------------------------------------------------

test('a custom-properties host resolves to css-vars, not the degraded none path', () => {
  const s = scanProject(FIX('inherit-css-vars'));
  const claim = s.signals.find((x) => x.claim === 'css-vars');
  assert.ok(claim, 'the css-vars claim must be emitted at all');
  assert.equal(detectStylingSystem(s).system, 'css-vars');
  assert.notEqual(detectStylingSystem(s).system, 'none');
});

test('a conventionally-named token stylesheet plus the declaration reaches high confidence', () => {
  const s = scanProject(FIX('inherit-css-vars'));
  const claim = s.signals.find((x) => x.claim === 'css-vars');
  assert.equal(claim.confidence, 'high');
  assert.ok(claim.evidence.some((e) => /declares custom properties/.test(e)));
  assert.ok(claim.evidence.some((e) => /conventional design-token stylesheet/.test(e)));
});

test('a stylesheet with no :root custom properties produces no css-vars claim', () => {
  // inherit-wp-classic's style.css is a WordPress theme header comment only.
  const s = scanProject(FIX('inherit-wp-classic'));
  assert.equal(s.signals.find((x) => x.claim === 'css-vars'), undefined);
  assert.equal(detectStylingSystem(s).system, 'none');
});

test('css-modules still outranks css-vars on a host that has both', () => {
  // inherit-vite-modules carries src/styles/tokens.css AND *.module.css. The
  // authoring idiom is modules; the custom properties are what they feed.
  const s = scanProject(FIX('inherit-vite-modules'));
  assert.ok(s.signals.some((x) => x.claim === 'css-vars'), 'the claim is still emitted...');
  assert.equal(detectStylingSystem(s).system, 'css-modules', '...but precedence still picks the authoring idiom');
});

// ---------------------------------------------------------------------------
// Per-file line counts (final-review Important I6). The exemplar picker had to
// Read every file in a component directory just to measure it — 150 model-side
// reads on a large host to choose 3. The scanner measures for free.
// ---------------------------------------------------------------------------

test('componentDirs carries per-file line counts for the top-ranked directories', () => {
  const s = scanProject(FIX('inherit-next-tailwind'));
  const top = s.candidates.componentDirs[0];
  assert.ok(Array.isArray(top.files), 'the top directory must list its files');
  assert.equal(top.files.length, top.count, 'one entry per counted component file');
  for (const f of top.files) {
    assert.equal(typeof f.file, 'string');
    assert.ok(Number.isInteger(f.lines) && f.lines > 0, `${f.file} must carry a usable line count`);
  }
  assert.ok(top.files.every((f) => !/index\.ts$/.test(f.file)), 'the barrel is still excluded');
});

test('line counts are supplied for the WP fixture too, whatever the extension', () => {
  const s = scanProject(FIX('inherit-wp-classic'));
  const top = s.candidates.componentDirs[0];
  assert.equal(top.dir.replace(/\\/g, '/'), 'template-parts');
  assert.deepEqual(top.files.map((f) => f.file.split('/').pop()).sort(),
    ['content-card.php', 'content-hero.php']);
  assert.ok(top.files.every((f) => f.lines > 0));
});

// ---------------------------------------------------------------------------
// CLI write path (final-review Critical C1). `--out` had no mkdirSync and sat
// inside the try that maps everything to exit 3, so the very first run on a
// fresh project (where .twt-artifacts/inherited/ does not exist yet) died with
// ENOENT reported as "the root was missing or wasn't a directory" — a wrong
// diagnosis the skill's own instructions forbid it from recovering from.
// ---------------------------------------------------------------------------

test('--out into a non-existent nested directory creates it and succeeds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inherit-scan-'));
  const out = join(dir, '.twt-artifacts', 'inherited', 'detection.json');
  const { stderr } = await run('node', [CLI, FIX('inherit-next-tailwind'), '--out', out]);
  assert.ok(existsSync(out), 'the CLI must create the output directory rather than fail');
  const parsed = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(parsed.signals.some((s) => s.claim === 'next'));
  assert.match(stderr, /signals/);
});

test('an unusable root is exit 3 and writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inherit-scan-'));
  const out = join(dir, 'nested', 'detection.json');
  await assert.rejects(
    () => run('node', [CLI, join(dir, 'no-such-root'), '--out', out]),
    (e) => e.code === 3,
  );
  assert.ok(!existsSync(out), 'nothing is written on the unusable-root path');
});

test('a write failure is exit 4, never exit 3 — the two diagnoses must not collide', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inherit-scan-'));
  // package.json is a FILE, so mkdirSync(dirname) on a path underneath it
  // cannot succeed — a genuine write failure with a perfectly good root.
  const out = join(dir, 'blocker.json', 'nested', 'detection.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'blocker.json'), '{}');
  await assert.rejects(
    () => run('node', [CLI, FIX('inherit-next-tailwind'), '--out', out]),
    (e) => e.code === 4 && /could not write/i.test(e.stderr || ''),
  );
});

test('--out with no value is a usage error (exit 2), not a crash', async () => {
  await assert.rejects(
    () => run('node', [CLI, FIX('inherit-next-tailwind'), '--out']),
    (e) => e.code === 2 && /usage/i.test(e.stderr || ''),
  );
});
