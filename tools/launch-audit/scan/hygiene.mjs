// tools/launch-audit/scan/hygiene.mjs — category 9.
//
// The highest-consequence mechanical check in the design: a committed key is
// unrecoverable once pushed, and no other twt skill looks for one.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles } from '../../lib/sources.mjs';

// Files that must never be in a repo that ships.
const SECRET_FILES = [
  '.env', '.env.local', '.env.production', 'wp-config.php',
  'id_rsa', 'id_ed25519', '.htpasswd', 'credentials.json', 'service-account.json',
];
// Live-key shapes with enough entropy to be worth flagging. Deliberately narrow:
// a false positive here costs a human a look, a false negative costs a rotation.
const INLINE_SECRET = /\b(sk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const DEBUG = /\b(console\.(log|debug|warn|error)|debugger)\b/g;
const NONPROD = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|[a-z0-9-]*\.?(staging|stage|dev|test|preview)\.[a-z0-9.-]+|[a-z0-9-]+\.local)(:\d+)?/gi;
const SKIP_DIRS = new Set(['node_modules', '.git', '.twt-artifacts', 'vendor', 'dist-codex']);

// Shallow walk of the project root plus the built output — never the whole
// drive, and never a skipped dir (CONVENTIONS: scope searches to the project).
function shippedFiles(ctx) {
  const out = [...ctx.html, ...ctx.css];
  if (ctx.theme) out.push(...listFiles(ctx.theme, '.php'), ...listFiles(ctx.theme, '.js'));
  if (ctx.base) out.push(...listFiles(ctx.base, '.js'));
  return [...new Set(out)];
}

export function run(ctx) {
  const counts = {
    committed_secret_files: 0, inline_secrets: 0, debug_statements: 0,
    nonprod_urls: 0, wp_debug_on: 0, source_maps: 0,
  };
  const findings = [];

  for (const name of SECRET_FILES) {
    const p = join(ctx.projectDir, name);
    if (!existsSync(p) || !statSync(p).isFile()) continue;
    counts.committed_secret_files++;
    findings.push({ kind: 'secret_file', file: name, line: 0, detail: `${name} is present in the project root` });
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
    if (f.split(/[\\/]/).some((seg) => SKIP_DIRS.has(seg))) continue;
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
    for (const m of src.matchAll(NONPROD)) {
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
