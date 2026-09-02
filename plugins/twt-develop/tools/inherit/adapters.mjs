// adapters.mjs — translate the design system into the HOST's styling idiom.
//
// This is the part that decides whether output feels native or gets deleted by
// whoever owns the repo, so two rules are absolute:
//   1. Never redefine a variable the host already defines — map onto it and
//      report the collision. Inheriting means deferring to what is there.
//   2. Never silently drop a token. A design system that loses a third of its
//      values while reporting success is worse than one that says which third.
//
// The host/exact modes mirror /twt-fidelity's system/strict deliberately: it is
// the same tension (host scale vs exact value) and the two skills should not
// invent competing vocabulary for one idea.
//
// CLI entrypoint (mirrors scan.mjs's library-plus-isMain shape): a SKILL.md is
// prose executed by a model — it can run Bash and use file tools, but it cannot
// call a library function directly, and CONVENTIONS §15 bans throwaway `node -e`
// computation. So this module doubles as its own CLI. What it deliberately does
// NOT do: evaluate the host's styling config (a tailwind.config.ts is code).
// Reading and summarizing that config into --host-style JSON is the calling
// skill's job (model judgment), not this script's (deterministic computation).
'use strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCssVars } from '../lib/contrast.mjs';

const PX = /^(-?[\d.]+)px$/;

// css-modules outranks scss because a project with BOTH authors components as
// modules — the scss claim describes the compiler, not the authoring idiom.
const PRECEDENCE = ['tailwind', 'css-modules', 'theme-object', 'scss', 'css-vars'];

// Token-name FAMILIES. What a Tailwind token becomes is decided by what the
// token MEANS, never by what its value looks like.
//
// The earlier implementation matched any `^-?[\d.]+px$` value and snapped it
// against the spacing scale, emitting `py-<key>` — so `--radius-lg: 16px`
// became `py-4`, `--border-width: 2px` became `py-1`, and `--font-size-h1:
// 48px` became `py-12`, all three reported as perfect-fidelity `mapped` with
// ZERO unmapped. A builder following that map writes vertical padding where a
// heading size was needed and every downstream gate reads clean — strictly
// worse than the silent loss the module exists to prevent.
//
// Order matters: the more specific family wins. `--font-size-h1` must resolve
// as a font size, not as `size`; `--border-radius-lg` as a radius, not as a
// border width.
const TOKEN_FAMILIES = [
  ['spacing', /(?:^|-)(?:space|spacing|gap|pad|padding|margin|inset)(?:-|$)/],
  ['fontSize', /(?:^|-)(?:font|fontsize|text|type|leading|tracking)(?:-|$)/],
  ['borderRadius', /(?:^|-)(?:radius|rounded|corner)(?:-|$)/],
  ['borderWidth', /(?:^|-)(?:border|stroke|outline|hairline)(?:-|$)/],
  ['boxShadow', /(?:^|-)(?:shadow|elevation)(?:-|$)/],
  ['colors', /(?:^|-)(?:color|colour|bg|background|surface|foreground|fg|palette|ink)(?:-|$)/],
  ['size', /(?:^|-)(?:size|width|height|icon|avatar|measure)(?:-|$)/],
];

// The Tailwind utility prefixes a builder would reasonably reach for, per
// family. Deliberately NOT baked into `became`: this module has no idea whether
// a spacing token is padding, margin or a flex gap, and picking one (the old
// `py-`) is the same class of unilateral error as picking the wrong scale.
// `became` names the SCALE ENTRY (`spacing.6`); the builder picks the utility.
export const FAMILY_UTILITIES = {
  spacing: 'p-/py-/px-/m-/gap- (whichever the design value is for)',
  fontSize: 'text-',
  borderRadius: 'rounded-',
  borderWidth: 'border-',
  boxShadow: 'shadow-',
  colors: 'text-/bg-/border- (whichever property the color applies to)',
  size: 'w-/h-/size-',
};

export function tokenFamily(token) {
  const name = String(token).replace(/^--/, '').toLowerCase();
  for (const [family, re] of TOKEN_FAMILIES) if (re.test(name)) return family;
  return null;
}

export function detectStylingSystem(scan) {
  const byClaim = new Map((scan.signals || []).map((s) => [s.claim, s]));
  for (const system of PRECEDENCE) {
    const hit = byClaim.get(system);
    if (hit) return { system, confidence: hit.confidence, evidence: hit.evidence };
  }
  return { system: 'none', confidence: 'medium', evidence: [] };
}

export function nearestStep(value, scale) {
  // Sort into an ARRAY and iterate that, never an object: JS re-enumerates
  // canonical integer-like object keys ("0", "1", "24" ...) in ascending KEY
  // order regardless of insertion order, silently discarding a by-value sort
  // the moment it's round-tripped through Object.fromEntries. That happens to
  // coincide with ascending-by-value for small all-integer scales (which is
  // why this bug hid behind every test on 2-3 integer-key fixtures) but
  // breaks on Tailwind's real default spacing scale, whose fractional keys
  // ('0.5', '1.5', '2.5' ...) are NOT canonical integer indices and so
  // enumerate in raw insertion order — completely divorced from value.
  // `|| {}` is load-bearing, not defensive noise: nearestStep is EXPORTED, so a
  // caller reaching a family the host never supplied a scale for passes
  // undefined. Without the guard that is a TypeError instead of the documented
  // `null` return, which is what every caller here already handles.
  const entries = Object.entries(scale || {}).sort((a, b) => a[1] - b[1]);
  let best = null;
  for (const [key, stepValue] of entries) {
    const delta = stepValue - value;
    const dist = Math.abs(delta);
    // Strict < keeps the FIRST-seen step on an exact tie; iterating the
    // array sorted above (not an object) is what makes "first-seen" mean
    // "smaller value" deterministically, independent of key shape.
    if (!best || dist < best.dist) best = { key, value: stepValue, delta, dist };
  }
  if (!best) return null;
  return { key: best.key, value: best.value, delta: best.delta };
}

function tailwindRow(token, value, hostScale, mode) {
  const family = tokenFamily(token);
  if (!family) {
    return { token, value, became: null, status: 'unmapped',
      note: 'token name names no known design family (spacing / font / radius / border / shadow / color / size), '
        + 'so no Tailwind scale can be chosen for it — use the host\'s nearest existing idiom' };
  }
  const scale = hostScale?.[family] || {};
  if (Object.keys(scale).length === 0) {
    return { token, value, became: null, status: 'unmapped', family,
      note: `host has no ${family} scale — supply one under host-style.json \`scale.${family}\` to map this family` };
  }
  const m = PX.exec(value);
  if (!m) {
    return { token, value, became: null, status: 'unmapped', family,
      note: `no Tailwind ${family} scale equivalent for a non-length value` };
  }
  const px = parseFloat(m[1]);
  const near = nearestStep(px, scale);
  if (mode === 'exact' && near.delta !== 0) {
    const key = String(px);
    return { token, value, became: `${family}.${key}`, status: 'mapped', delta: 0, family,
      extendsScale: true,
      note: `extends the host ${family} scale with a named step ${key}` };
  }
  return {
    token, value, became: `${family}.${near.key}`, family,
    status: near.delta === 0 ? 'mapped' : 'snapped', delta: near.delta,
  };
}

export function adaptTokens(tokens, { system, hostScale, hostVars, mode = 'host' } = {}) {
  const map = [];
  const artifacts = [];
  const varLines = [];
  const extend = {};   // family -> { namedStep: value } for --exact scale extensions

  for (const [token, value] of Object.entries(tokens)) {
    if (system === 'none') {
      map.push({ token, value, became: token, status: 'mapped',
        note: 'degraded: no styling system detected, tokens.css injected verbatim' });
      varLines.push(`  ${token}: ${value};`);
      continue;
    }
    if (hostVars && Object.prototype.hasOwnProperty.call(hostVars, token)) {
      map.push({ token, value, became: token, status: 'collision',
        note: `the host already defines ${token} as ${hostVars[token]} — mapped onto it, not redefined` });
      continue;
    }
    if (system === 'tailwind') {
      const row = tailwindRow(token, value, hostScale, mode);
      if (row.extendsScale) {
        const m = PX.exec(value);
        if (m) {
          if (!extend[row.family]) extend[row.family] = {};
          extend[row.family][String(parseFloat(m[1]))] = value;
        }
      }
      map.push(row);
      continue;
    }
    // css-vars / css-modules / scss / theme-object all carry the raw value; only
    // the container differs, which is chosen below.
    map.push({ token, value, became: token, status: 'mapped' });
    varLines.push(`  ${token}: ${value};`);
  }

  if (system === 'tailwind') {
    if (Object.keys(extend).length) {
      artifacts.push({
        path: 'tailwind.config.extension.js',
        contents: `// Generated by /twt-inherit-define (--exact). Merge into theme.extend.\n`
          + `module.exports = { theme: { extend: ${JSON.stringify(extend, null, 2)} } };\n`,
      });
    }
  } else if (system === 'scss') {
    artifacts.push({
      path: '_tokens.scss',
      contents: varLines.map((l) => l.trim().replace(/^--/, '$')).join('\n') + '\n',
    });
  } else if (system === 'theme-object') {
    const obj = Object.fromEntries(map.filter((r) => r.status === 'mapped')
      .map((r) => [r.token.replace(/^--/, ''), r.value]));
    artifacts.push({
      path: 'theme.tokens.js',
      contents: `// Generated by /twt-inherit-define. Merge into the host theme object.\n`
        + `export const tokens = ${JSON.stringify(obj, null, 2)};\n`,
    });
  } else if (varLines.length) {
    artifacts.push({ path: 'tokens.css', contents: `:root {\n${varLines.join('\n')}\n}\n` });
  }

  return { artifacts, map };
}

export function renderTokenMap(rows, meta = {}) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const lines = [];
  lines.push('# Token map', '');
  lines.push(`**Host styling system:** ${meta.system ?? 'unknown'} · **Mode:** ${meta.mode ?? 'host'}`, '');
  lines.push(`${count('mapped')} mapped · ${count('snapped')} snapped · `
    + `${count('collision')} collision · ${count('unmapped')} unmapped`, '');
  if (meta.system === 'tailwind') {
    lines.push('`Became` names a **scale entry**, not a utility class — `spacing.6` means '
      + "the host's `spacing` scale step `6`. Pick the utility prefix from the property the "
      + 'design value is for (`p-`/`py-`/`px-`/`m-`/`gap-` for spacing, `text-` for fontSize, '
      + '`rounded-` for borderRadius, `border-` for borderWidth, `shadow-` for boxShadow, '
      + '`w-`/`h-` for size). This map deliberately does not choose the direction for you.', '');
  }
  lines.push('| Token | Family | Value | Became | Status | Δ | Note |', '|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| \`${r.token}\` | ${r.family ?? '—'} | ${r.value} | ${r.became ?? '—'} | ${r.status} | `
      + `${r.delta ?? ''} | ${r.note ?? ''} |`);
  }
  lines.push('');
  if (count('unmapped')) {
    lines.push('## Unmapped', '',
      'These design-system values have no equivalent in the host styling system.',
      'They are listed so the loss is visible rather than silent.', '');
    for (const r of rows.filter((x) => x.status === 'unmapped')) {
      lines.push(`- \`${r.token}\` (${r.value}) — ${r.note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
  const scanPath = arg('scan');
  const tokensPath = arg('tokens');
  const outDir = arg('out');
  const mode = arg('mode', 'host');
  const hostStylePath = arg('host-style');   // optional, written by the model

  if (!scanPath || !tokensPath || !outDir) {
    process.stderr.write('usage: adapters.mjs --scan <detection.json> --tokens <tokens.css> --out <dir> [--mode host|exact] [--host-style <json>]\n');
    process.exit(2);
  }
  if (!existsSync(tokensPath)) {
    process.stderr.write(`no tokens file at ${tokensPath} — nothing to adapt\n`);
    process.exit(3);
  }

  const scan = JSON.parse(readFileSync(scanPath, 'utf8'));
  // parseCssVars returns { vars: Map, order }, not a plain object — adaptTokens
  // does Object.entries(tokens), so the Map must be flattened first or every
  // token silently vanishes behind two bogus keys ('vars', 'order').
  const { vars: parsedVars } = parseCssVars(readFileSync(tokensPath, 'utf8'));
  const tokens = Object.fromEntries(parsedVars);
  const hostStyle = hostStylePath && existsSync(hostStylePath)
    ? JSON.parse(readFileSync(hostStylePath, 'utf8')) : {};

  const detected = detectStylingSystem(scan);
  const { artifacts, map } = adaptTokens(tokens, {
    system: detected.system, hostScale: hostStyle.scale, hostVars: hostStyle.vars, mode,
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'token-map.md'),
    renderTokenMap(map, { system: detected.system, mode }));
  for (const a of artifacts) writeFileSync(join(outDir, a.path.replace(/[\\/]/g, '_')), a.contents);

  const n = (s) => map.filter((r) => r.status === s).length;
  process.stderr.write(`system ${detected.system} (${detected.confidence}) · `
    + `${n('mapped')} mapped, ${n('snapped')} snapped, ${n('collision')} collision, ${n('unmapped')} unmapped\n`);
}
