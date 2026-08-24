// tools/launch-audit/scan/hygiene.mjs — category 9.
//
// The highest-consequence mechanical check in the design: a committed key is
// unrecoverable once pushed, and no other twt skill looks for one.
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { listFiles } from '../../../../../tools/lib/sources.mjs';
import { NONPROD_URL_ANYWHERE } from './lib/patterns.mjs';

// Files that must never be in a repo that ships.
const SECRET_FILES = [
  '.env', '.env.local', '.env.production', 'wp-config.php',
  'id_rsa', 'id_ed25519', '.htpasswd', 'credentials.json', 'service-account.json',
];
// Live-key shapes with enough entropy to be worth flagging. Deliberately narrow:
// a false positive here costs a human a look, a false negative costs a rotation.
const INLINE_SECRET = /\b(sk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const DEBUG = /\b(console\.(log|debug|warn|error)|debugger)\b/g;
// The non-production host list is SHARED with conversion.mjs — see
// scan/lib/patterns.mjs. Applied here as an anywhere-in-the-file sweep.
const SKIP_DIRS = new Set(['node_modules', '.git', '.twt-artifacts', 'vendor', 'dist-codex']);

// Shallow walk of the project root plus the built output — never the whole
// drive, and never a skipped dir (CONVENTIONS: scope searches to the project).
function shippedFiles(ctx) {
  const out = [...ctx.html, ...ctx.css];
  if (ctx.theme) out.push(...listFiles(ctx.theme, '.php'), ...listFiles(ctx.theme, '.js'));
  if (ctx.base) out.push(...listFiles(ctx.base, '.js'));
  return [...new Set(out)];
}

// SKIP_DIRS must be judged BELOW the scan root, never across the absolute path.
// On a mockup-kind project the scan root is itself inside .twt-artifacts/, so
// testing the whole path skipped every page the locator had just chosen — which
// silently disabled inline_secret, a LAUNCH-BLOCKER, on one of the two supported
// build kinds. A mockup project with a committed key reported clean.
// The locator already vetted what to scan; this filter exists only to drop
// vendored and generated trees found by the walk INSIDE that subject.
function isSkipped(ctx, f) {
  let rel = f;
  for (const root of [ctx.base, ctx.theme]) {
    if (root && f.startsWith(root)) { rel = f.slice(root.length); break; }
  }
  return rel.split(/[\\/]/).some((seg) => SKIP_DIRS.has(seg));
}

// 'tracked' | 'ignored' | 'untracked'.
//
// The counter here is called `committed_secret_files`, and it used to be filled
// by a bare existence check — so on every WordPress project it fired on
// wp-config.php, which MUST be in the web root for the site to boot and which
// every sane setup gitignores. Presence on disk is not exposure; being in the
// repository is. Asking git is the only way to tell them apart.
//
// No git, no repository, or git not on PATH → both probes come back non-zero
// and the answer is 'untracked', which still reports. Failing toward reporting
// is the right direction for the highest-consequence check in the scan.
function gitStatusOf(projectDir, name) {
  const git = (args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', windowsHide: true });
  if (git(['ls-files', '--error-unmatch', '--', name]).status === 0) return 'tracked';
  return git(['check-ignore', '-q', '--', name]).status === 0 ? 'ignored' : 'untracked';
}

export function run(ctx) {
  const counts = {
    committed_secret_files: 0, ignored_secret_files: 0, inline_secrets: 0,
    debug_statements: 0, nonprod_urls: 0, wp_debug_on: 0, source_maps: 0,
  };
  const findings = [];

  for (const name of SECRET_FILES) {
    const p = join(ctx.projectDir, name);
    if (!existsSync(p) || !statSync(p).isFile()) continue;
    const git = gitStatusOf(ctx.projectDir, name);
    if (git === 'ignored') {
      // Present on disk because it has to be — wp-config.php, .env on a server
      // — and excluded from the repository on purpose. Counted so the fact is
      // visible in facts.json, not raised, because there is no action.
      counts.ignored_secret_files++;
    } else {
      counts.committed_secret_files++;
      findings.push({
        kind: 'secret_file', file: name, line: 0,
        detail: git === 'tracked'
          ? `${name} is committed to the repository`
          : `${name} is present in the project root and is not gitignored`,
      });
    }
    // Independent of the repository question: WP_DEBUG on is wrong on the
    // server whether or not the file that sets it is tracked.
    if (name === 'wp-config.php' && /define\(\s*['"]WP_DEBUG['"]\s*,\s*true/i.test(ctx.read(p))) {
      counts.wp_debug_on++;
      findings.push({ kind: 'wp_debug_on', file: name, line: 0, detail: 'WP_DEBUG is true' });
    }
  }
  if (ctx.theme) {
    for (const p of listFiles(ctx.theme, '.php')) {
      if (!/define\(\s*['"]WP_DEBUG['"]\s*,\s*true/i.test(ctx.read(p))) continue;
      counts.wp_debug_on++;
      findings.push({ kind: 'wp_debug_on', file: ctx.rel(p), line: 0, detail: 'WP_DEBUG is true' });
    }
  }

  for (const f of shippedFiles(ctx)) {
    if (isSkipped(ctx, f)) continue;
    const src = ctx.read(f);
    const file = ctx.rel(f);
    for (const m of src.matchAll(new RegExp(INLINE_SECRET.source, 'g'))) {
      counts.inline_secrets++;
      findings.push({ kind: 'inline_secret', file, line: ctx.lineOf(src, m.index), detail: `${m[0].slice(0, 12)}… (redacted)` });
    }
    for (const m of src.matchAll(DEBUG)) {
      counts.debug_statements++;
      findings.push({ kind: 'debug_statement', file, line: ctx.lineOf(src, m.index), detail: m[0] });
    }
    for (const m of src.matchAll(NONPROD_URL_ANYWHERE)) {
      counts.nonprod_urls++;
      findings.push({ kind: 'nonprod_url', file, line: ctx.lineOf(src, m.index), detail: m[0] });
    }
    for (const m of src.matchAll(/sourceMappingURL=/g)) {
      counts.source_maps++;
      findings.push({ kind: 'source_map', file, line: ctx.lineOf(src, m.index), detail: 'sourceMappingURL present' });
    }
  }
  return { counts, findings };
}
