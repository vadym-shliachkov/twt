#!/usr/bin/env node
// check-decisions.mjs — structural checker for the §13 decisions.md contract.
//
// decisions.md is written freehand by 8+ define skills in collect mode and
// parsed back by THREE consumers: the orchestrators' surface-up flow (§13),
// gen-report's dashboard, and wiki-harvest.mjs (parseDecisions binds to the
// exact section titles and bullet shapes). A format drift only surfaces
// downstream as silently-missing decisions — so collect-mode skills run this
// right after writing the file.
//
// Checks (mirrors templates/decisions.md + wiki-harvest's parser):
//   - frontmatter with generated / area / producer / status: open|resolved
//   - H1 present
//   - at least one of the three canonical section headings, spelled EXACTLY:
//     "## Open questions", "## Model-decided assumptions (review)",
//     "## Proposed rules (confirm before binding)" — near-miss spellings are
//     reported as errors (the harvester would silently skip them)
//   - Open questions bullets carry "options:" and "model-leaning:"; their
//     "why it matters:" continuation is indented under the bullet
//   - Assumption bullets carry "basis:" and "reversible:"
//
// Usage: node tools/check-decisions.mjs --file <decisions.md>
// Exit 0 when sound; exit 1 listing every problem.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const SECTIONS = [
  'Open questions',
  'Model-decided assumptions (review)',
  'Proposed rules (confirm before binding)',
];

export function checkDecisions(text) {
  const problems = [];
  const lines = text.split(/\r?\n/);

  // frontmatter
  if (lines[0]?.trim() !== '---') problems.push('missing frontmatter (--- block)');
  else {
    const end = lines.slice(1).findIndex((l) => l.trim() === '---');
    const fm = lines.slice(1, end === -1 ? 1 : end + 1).join('\n');
    for (const key of ['generated', 'area', 'producer']) {
      if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(fm)) problems.push(`frontmatter missing \`${key}:\``);
    }
    const st = /^status:\s*(\S+)/m.exec(fm);
    if (!st) problems.push('frontmatter missing `status:`');
    else if (!['open', 'resolved'].includes(st[1])) problems.push(`status \`${st[1]}\` is not open|resolved`);
  }

  if (!/^#\s+\S/m.test(text)) problems.push('missing H1 title');

  // sections — exact titles, and near-misses flagged (the harvester matches
  // the literal heading; "Model-decided assumptions" without "(review)" is
  // silently invisible to it)
  const present = SECTIONS.filter((s) => new RegExp(`^##\\s+${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(text));
  if (!present.length) problems.push('none of the three canonical sections is present (Open questions / Model-decided assumptions (review) / Proposed rules (confirm before binding))');
  for (const h of text.matchAll(/^##\s+(.+?)\s*$/gm)) {
    const title = h[1];
    if (SECTIONS.includes(title)) continue;
    const near = SECTIONS.find((s) => s.toLowerCase().startsWith(title.toLowerCase().slice(0, 10)));
    if (near) problems.push(`section \`## ${title}\` is a near-miss of \`## ${near}\` — the harvester and orchestrators match the exact title`);
  }

  const section = (name) => {
    const re = new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    const m = re.exec(text);
    if (!m) return null;
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/^## /m);
    return end === -1 ? rest : rest.slice(0, end);
  };

  const oq = section('Open questions');
  if (oq) {
    for (const b of oq.matchAll(/^-\s+(.+)$/gm)) {
      if (!/options:/i.test(b[1])) problems.push(`open question \`${b[1].slice(0, 50)}…\` has no \`options:\``);
      if (!/model-leaning:/i.test(b[1])) problems.push(`open question \`${b[1].slice(0, 50)}…\` has no \`model-leaning:\``);
    }
    for (const w of oq.matchAll(/^(\s*)-\s+why it matters:/gim)) {
      if (!w[1]) problems.push('`why it matters:` must be an INDENTED continuation under its question, not a top-level bullet');
    }
  }

  const as = section('Model-decided assumptions (review)');
  if (as) {
    for (const b of as.matchAll(/^-\s+(.+)$/gm)) {
      if (!/basis:/i.test(b[1])) problems.push(`assumption \`${b[1].slice(0, 50)}…\` has no \`basis:\``);
      if (!/reversible:/i.test(b[1])) problems.push(`assumption \`${b[1].slice(0, 50)}…\` has no \`reversible:\``);
    }
  }

  return problems;
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const good = `---
generated: 2026-07-13
area: design-system
producer: /twt-design-system-define
status: open
---

# Decisions to confirm — design-system

## Open questions
- Q1 — Which hero style? — options: [minimal, bold] — model-leaning: minimal
  - why it matters: sets the homepage tone

## Model-decided assumptions (review)
- accent = orange — basis: navy fails AA on dark hero — reversible: yes

## Proposed rules (confirm before binding)
- Treat teal as the only CTA color
`;
  assert.deepEqual(checkDecisions(good), []);
  assert.ok(checkDecisions(good.replace('status: open', 'status: pending')).some((p) => /not open\|resolved/.test(p)));
  assert.ok(checkDecisions(good.replace(' (review)', '')).some((p) => /near-miss/.test(p)), 'dropped (review) suffix caught');
  assert.ok(checkDecisions(good.replace(' — options: [minimal, bold]', '')).some((p) => /no `options:`/.test(p)));
  assert.ok(checkDecisions(good.replace(' — basis: navy fails AA on dark hero', '')).some((p) => /no `basis:`/.test(p)));
  assert.ok(checkDecisions(good.replace('  - why it matters:', '- why it matters:')).some((p) => /INDENTED continuation/.test(p)));
  assert.ok(checkDecisions('# just a title\n').some((p) => /missing frontmatter/.test(p)));
  console.log('check-decisions self-test: OK');
} else if (_isMain) {
  const i = process.argv.indexOf('--file');
  if (i === -1) { console.error('usage: node tools/check-decisions.mjs --file <decisions.md>'); process.exit(1); }
  const problems = checkDecisions(readFileSync(process.argv[i + 1], 'utf8'));
  if (problems.length) {
    for (const p of problems) console.error('FAIL: ' + p);
    process.exit(1);
  }
  console.log('check-decisions: OK');
}
