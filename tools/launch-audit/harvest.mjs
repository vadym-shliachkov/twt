// tools/launch-audit/harvest.mjs — Layer A of /twt-launch-audit.
//
// Turns the project's existing artifacts into cited evidence. Every field here
// is a fact the launch report CITES rather than re-derives: duplicating another
// audit's finding puts two reports with two severities for one problem in front
// of one client.
//
// ABSENCE IS NOT AN ERROR. A project with no qa-report.md yields present:false
// and status:"ok"; whether that absence blocks the launch is the rules layer's
// call, not this module's. `status:"partial"` is reserved for a probe that
// THREW — because a probe that failed silently would read as a clean project.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = dirname(dirname(fileURLToPath(import.meta.url)));   // …/tools

const readOr = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const num = (re, text, dflt = 0) => { const m = re.exec(text); return m ? Number(m[1]) : dflt; };

// Recursive walk bounded to .twt-artifacts/ — never the whole project, and
// never outside it.
function findAll(root, name, out = []) {
  if (!existsSync(root)) return out;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) findAll(p, name, out);
    else if (e.name === name) out.push(p);
  }
  return out;
}

// Every current *-validate skill (see skills/twt-*-validate/SKILL.md, the
// templates/validation-report.md template, and the repo's own self-test
// fixture) writes findings as "### N. [BLOCKER] <title>" — a numbered heading
// with the tier bracketed. The plan's original regex (`/^#{0,4}\s*BLOCKER\b/`)
// requires BLOCKER to sit immediately after the `#`s, so it never matches that
// real shape (only a bare "### BLOCKER — …" heading, which no shipping skill
// emits). This one tolerates an optional "N. " ordinal and optional brackets
// around the tier word, so it matches both the canonical format and a bare
// "### BLOCKER" heading.
const BLOCKER_HEADING = /^#{1,6}\s*(?:\d+\.\s*)?\[?BLOCKER\]?\b/gim;

// twt-seo-define's seo-map.md nests one "### <page> (`/<slug>`)" heading per
// page under a "## Pages" section, alongside sibling "## Keyword themes" and
// "## Redirects" sections that also start with "##". Counting every "##"
// heading in the whole document (the plan's original approach) counts those
// wrapper sections as if they were pages. Scope the count to the "## Pages"
// section when present; fall back to a whole-document heading count for
// simpler/legacy seo-map.md shapes that don't use the sectioned layout.
function countSeoPages(text) {
  const section = /^##\s+Pages\b.*$/im.exec(text);
  if (!section) return (text.match(/^##\s+\S/gm) || []).length;
  const rest = text.slice(section.index + section[0].length);
  const nextIdx = rest.search(/^##\s+\S/m);
  const scoped = nextIdx === -1 ? rest : rest.slice(0, nextIdx);
  return (scoped.match(/^#{2,3}\s+\S/gm) || []).length;
}

// twt-assets-produce's manifest.md is a table with a `status` column whose
// real vocabulary is `planned` / `provided` / `generated` / `pending-stock` /
// `pending-video` / `missing-provided` — never the literal words TBD/TODO the
// plan's original free-text regex looked for, which means it would silently
// report 0 unfilled rows against every real manifest. Parse the table and
// count rows whose status isn't `provided` or `generated` (the two "done"
// states); fall back to 0 when no `status` column is found.
function tableRows(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => /^\s*\|/.test(l))
    .map((l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));  // drop |---|---| separators
}
function countUnfilledAssets(text) {
  const rows = tableRows(text);
  if (rows.length === 0) return 0;
  const statusIdx = rows[0].findIndex((h) => /^status$/i.test(h));
  if (statusIdx === -1) return 0;
  return rows.slice(1).filter((r) => {
    const v = (r[statusIdx] || '').toLowerCase();
    return v !== '' && v !== 'provided' && v !== 'generated';
  }).length;
}

export function harvest(ctx) {
  const art = join(ctx.projectDir, '.twt-artifacts');
  const notes = [];
  let degraded = false;
  const probe = (label, fn, fallback) => {
    try { return fn(); } catch (e) { degraded = true; notes.push(`${label}: ${e.message}`); return fallback; }
  };

  // ---- qa-report.md ----------------------------------------------------------
  const qaPath = join(art, 'qa', 'qa-report.md');
  const qa = probe('qa-report', () => {
    if (!existsSync(qaPath)) return { present: false, path: ctx.rel(qaPath) };
    const t = readOr(qaPath);
    return {
      present: true, path: ctx.rel(qaPath),
      verdict: (/^verdict:\s*(\S+)/im.exec(t) || [, null])[1],
      generated: (/^generated:\s*(\S+)/im.exec(t) || [, null])[1],
      blockers: num(/BLOCKER:\s*(\d+)/i, t),
      warnings: num(/WARNING:\s*(\d+)/i, t),
      suggestions: num(/SUGGESTION:\s*(\d+)/i, t),
    };
  }, { present: false, path: ctx.rel(qaPath) });

  // ---- gaps.md ---------------------------------------------------------------
  const gapsPath = join(art, 'qa', 'gaps.md');
  const gaps = probe('gaps', () => {
    if (!existsSync(gapsPath)) return { present: false, path: ctx.rel(gapsPath) };
    const t = readOr(gapsPath);
    return { present: true, path: ctx.rel(gapsPath), open_items: (t.match(/^\s*-\s*\[ \]/gm) || []).length };
  }, { present: false, path: ctx.rel(gapsPath) });

  // ---- every validation-report.md -------------------------------------------
  const validations = probe('validations', () =>
    findAll(art, 'validation-report.md').map((p) => ({
      path: ctx.rel(p),
      blockers: (readOr(p).match(BLOCKER_HEADING) || []).length,
    })), []);

  // ---- seo-map.md ------------------------------------------------------------
  const seoPath = join(art, 'pre-design', 'seo', 'seo-map.md');
  const seo_map = probe('seo-map', () => {
    if (!existsSync(seoPath)) return { present: false, path: ctx.rel(seoPath) };
    const t = readOr(seoPath);
    return { present: true, path: ctx.rel(seoPath), pages: countSeoPages(t) };
  }, { present: false, path: ctx.rel(seoPath) });

  // ---- assets manifest -------------------------------------------------------
  const manPath = join(art, 'design', 'assets', 'manifest.md');
  const assets_manifest = probe('assets-manifest', () => {
    if (!existsSync(manPath)) return { present: false, path: ctx.rel(manPath) };
    const t = readOr(manPath);
    return { present: true, path: ctx.rel(manPath), unfilled: countUnfilledAssets(t) };
  }, { present: false, path: ctx.rel(manPath) });

  // ---- approval workbook -----------------------------------------------------
  // checklist-xlsx.py already has a `read` mode emitting per-row JSON with
  // summary counts. Shelling out to it beats hand-rolling a zip+XML parser,
  // and keeps one definition of what "ready" means. Its real emitted shape
  // (verified by running `python checklist-xlsx.py read`) is a top-level
  // `summary` object with keys `total_rows` / `implementable` / `not_ready` /
  // `ready_but_blank_approved` — not `totals.total` as originally assumed.
  // If python or openpyxl is unavailable the workbook is UNREADABLE, not
  // clean — reader:'failed' + a note, and the rules turn that into UNVERIFIED
  // rather than a pass.
  const wbPath = join(art, 'content-approval', 'content-approval-checklist.xlsx');
  const approval = probe('approval', () => {
    if (!existsSync(wbPath)) return { present: false, path: ctx.rel(wbPath) };
    try {
      const out = execFileSync('python', [join(TOOLS, 'checklist-xlsx.py'), 'read', '--workbook', wbPath],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const j = JSON.parse(/\{[\s\S]*\}/.exec(out)[0]);
      const s = j.summary || {};
      return {
        present: true, path: ctx.rel(wbPath), reader: 'ok',
        total: s.total_rows ?? 0, ready: s.implementable ?? 0,
        not_ready: s.not_ready ?? 0, ready_but_blank: s.ready_but_blank_approved ?? 0,
      };
    } catch (e) {
      notes.push(`approval workbook unreadable: ${String(e.message).split('\n')[0]}`);
      degraded = true;
      return { present: true, path: ctx.rel(wbPath), reader: 'failed' };
    }
  }, { present: false, path: ctx.rel(wbPath) });

  // ---- staleness -------------------------------------------------------------
  // status-scan.mjs's real machine block (verified by running it against a
  // temp project) is `{ projectDir, scope, stale, rows }`, where each row is
  // `{ label, status, because }` — not `{ artifacts: [{ path, state }] }` as
  // originally assumed. The top-level `stale` count happened to already match;
  // `state`/`path` did not, which silently zeroed out `stale_paths` on every
  // real run without ever throwing.
  const staleness = probe('staleness', () => {
    const out = execFileSync(process.execPath, [join(TOOLS, 'status-scan.mjs'), ctx.projectDir],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const block = /```json\n([\s\S]*?)\n```/.exec(out);
    if (!block) return { status: 'ok', stale: 0, stale_paths: [] };
    const j = JSON.parse(block[1]);
    const paths = (j.rows || []).filter((r) => r.status === 'STALE').map((r) => r.label);
    return { status: 'ok', stale: j.stale ?? paths.length, stale_paths: paths };
  }, { status: 'failed', stale: 0, stale_paths: [] });

  return {
    status: degraded ? 'partial' : 'ok',
    qa, gaps, validations, seo_map, assets_manifest, approval, staleness, notes,
  };
}
