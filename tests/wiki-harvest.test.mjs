import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const TOOL = fileURLToPath(new URL('../tools/wiki-harvest.mjs', import.meta.url));
const WIKI_INIT = fileURLToPath(new URL('../tools/wiki-init.mjs', import.meta.url));

const run = (dir, args = []) =>
  execFileSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' });

const initWiki = (dir) =>
  execFileSync(process.execPath, [WIKI_INIT, dir], { encoding: 'utf8' });

const newProject = () => mkdtempSync(join(tmpdir(), 'twt-wiki-harvest-'));

function writeArtifact(dir, relPath, content) {
  const p = join(dir, '.twt-artifacts', relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
  return p;
}

const inboxPath = (dir) => join(dir, '.project-wiki', 'inbox.md');
const sourcesPath = (dir) => join(dir, '.project-wiki', 'sources.md');
const statePath = (dir) => join(dir, '.project-wiki', '.harvest-state.json');

// --- Fixtures, copied from the REAL formats (templates/decisions.md,
// skills/twt-curation-define/SKILL.md Step 3.5, CONVENTIONS.md §12 /
// templates/validation-report.md, and the Timeline prose in commands/twt-site.md
// Step 0a) -- not from the plan brief's summary table.

const DECISIONS_MD = `---
generated: 2026-07-11
area: design-system
producer: /twt-design-system-define
status: open
---

# Decisions to confirm — design-system

## Open questions
- Q1 — Which hero style fits best? — options: [minimal, bold, photo] — model-leaning: minimal
  - why it matters: sets the tone for the whole homepage

## Model-decided assumptions (review)
- accent-color = orange — basis: WCAG AA fails for navy on the dark hero (2.9:1 vs 4.5:1 required) — reversible: yes

## Proposed rules (confirm before binding)
- Treat teal as the only CTA color
`;

const FACTS_MD = `---
generated: 2026-07-11T00:00:00Z
area: curation
producer: twt-curation-define
status: open
---

# Facts ledger

## Canonical facts
| fact | canonical | status | sources (value@source) |
|------|-----------|--------|------------------------|
| firm-tenure | TBD | CONFLICT | 20+ years@brandbook · 25+ years@site |
| self-descriptor-noun | firm | RESOLVED | firm@brandbook (agency forbidden) |

## Provided assets
| role | file | usable-on | status |
|------|------|-----------|--------|
| reversed-white | assets/logo-white.png | Ink surfaces | provided |
`;

const VALIDATION_REPORT_MD = `# Validation report — design-system
Generated: 2026-07-11  ·  Validator: /twt-design-system-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Contrast  |     25 |           2 |     10.0 | primary accent fails AA |
| **Total** |  **100** |           |   **62** | |

**Health: 62 — Band: Revise**

## Decisions to confirm
- none

## Findings
### 1. [BLOCKER] Primary CTA fails contrast
- **Where:** tokens.css --color-accent
- **Problem:** #1DB89C on #FFFFFF measures 2.1:1, fails AA 4.5:1 for body text
- **Recommendation:** darken the accent or restrict it to large text

## Summary
Contrast blocks release; everything else is on track.
`;

// A validation-report.md with a BLOCKER followed by a WARNING and a
// SUGGESTION under the same "## Findings" heading - the standard shape per
// CONVENTIONS.md §12 (every real validator emits all three tiers together).
// Regression fixture for the block-boundary bug: parseBlockers' scan for the
// end of the BLOCKER's block used to stop only at the next "## " heading, so
// it swallowed the WARNING and SUGGESTION findings below it into the
// BLOCKER's own captured text (and therefore its stable-ID hash).
const VALIDATION_REPORT_MULTI_MD = `# Validation report — design-system
Generated: 2026-07-11  ·  Validator: /twt-design-system-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Contrast  |     25 |           2 |     10.0 | primary accent fails AA |
| **Total** |  **100** |           |   **62** | |

**Health: 62 — Band: Revise**

## Decisions to confirm
- none

## Findings
### 1. [BLOCKER] Primary CTA fails contrast
- **Where:** tokens.css --color-accent
- **Problem:** #1DB89C on #FFFFFF measures 2.1:1, fails AA 4.5:1 for body text
- **Recommendation:** darken the accent or restrict it to large text

### 2. [WARNING] Spacing scale drifts on mobile
- **Where:** tokens.css --space-4
- **Problem:** mobile gutter uses a value not in the spacing scale
- **Recommendation:** snap to the nearest scale step

### 3. [SUGGESTION] Consider a warmer neutral
- **Where:** tokens.css --color-neutral-100
- **Problem:** current neutral reads slightly cold against the brand palette
- **Recommendation:** nudge hue +2 toward warm

## Summary
Contrast blocks release; spacing and neutral tone are polish items.
`;

// Same report, but with ONLY the WARNING's wording reworded (its Problem
// line). The BLOCKER finding's own text is byte-identical to the fixture
// above - a stable BLOCKER id must not change when this file is re-harvested.
const VALIDATION_REPORT_MULTI_REWORDED_MD = `# Validation report — design-system
Generated: 2026-07-11  ·  Validator: /twt-design-system-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Contrast  |     25 |           2 |     10.0 | primary accent fails AA |
| **Total** |  **100** |           |   **62** | |

**Health: 62 — Band: Revise**

## Decisions to confirm
- none

## Findings
### 1. [BLOCKER] Primary CTA fails contrast
- **Where:** tokens.css --color-accent
- **Problem:** #1DB89C on #FFFFFF measures 2.1:1, fails AA 4.5:1 for body text
- **Recommendation:** darken the accent or restrict it to large text

### 2. [WARNING] Spacing scale drifts on mobile
- **Where:** tokens.css --space-4
- **Problem:** mobile gutter measures 18px, which is not one of the 4/8/12/16/24 scale steps
- **Recommendation:** snap to the nearest scale step

### 3. [SUGGESTION] Consider a warmer neutral
- **Where:** tokens.css --color-neutral-100
- **Problem:** current neutral reads slightly cold against the brand palette
- **Recommendation:** nudge hue +2 toward warm

## Summary
Contrast blocks release; spacing and neutral tone are polish items.
`;

const SITE_LOG_MD = `# Session log

## Run 2026-07-11T10:00:00Z
**Command:** /twt-site
**Mode:** interactive
**Target:** html

### Timeline
1. [question] Stage: What stage is this build? → New build
2. [step] Pre-design: twt-pre-design — establishes brand, positioning, IA before design

### Outcome
Phases completed: pre-design. No outstanding BLOCKERs.
`;

const TOKENS_CSS = `:root {\n  --color-accent: #1DB89C;\n}\n`;

function seedFullFixtureSet(dir) {
  writeArtifact(dir, 'design/design-system/decisions.md', DECISIONS_MD);
  writeArtifact(dir, 'pre-design/curation/facts.md', FACTS_MD);
  writeArtifact(dir, 'design/design-system/validation-report.md', VALIDATION_REPORT_MD);
  writeArtifact(dir, 'site-log.md', SITE_LOG_MD);
  writeArtifact(dir, 'design/design-system/tokens.css', TOKENS_CSS);
}

test('inert: no .project-wiki/ writes nothing and exits 0', () => {
  const dir = newProject();
  writeArtifact(dir, 'design/design-system/decisions.md', DECISIONS_MD);
  const out = run(dir);
  assert.equal(existsSync(join(dir, '.project-wiki')), false);
  assert.doesNotThrow(() => out); // execFileSync already threw on non-zero exit
});

test('inert: .project-wiki/ exists but no .twt-artifacts/ writes nothing and exits 0', () => {
  const dir = newProject();
  initWiki(dir);
  const before = readFileSync(inboxPath(dir), 'utf8');
  run(dir);
  assert.equal(readFileSync(inboxPath(dir), 'utf8'), before, 'inbox.md must be untouched');
  assert.equal(existsSync(statePath(dir)), false, 'no state file should be created');
});

test('a decisions.md open question becomes one · reason · entry carrying its why', () => {
  const dir = newProject();
  initWiki(dir);
  writeArtifact(dir, 'design/design-system/decisions.md', DECISIONS_MD);
  run(dir);
  const text = readFileSync(inboxPath(dir), 'utf8');
  assert.match(text, /· reason ·/);
  assert.match(text, /Which hero style fits best\?/);
  assert.match(text, /\*\*why:\*\* sets the tone for the whole homepage/);
});

test('a site-log.md Q&A pair becomes one · decision · entry with question: and chosen:', () => {
  const dir = newProject();
  initWiki(dir);
  writeArtifact(dir, 'site-log.md', SITE_LOG_MD);
  run(dir);
  const text = readFileSync(inboxPath(dir), 'utf8');
  assert.match(text, /· decision ·/);
  assert.match(text, /\*\*question:\*\*.*What stage is this build\?/);
  assert.match(text, /\*\*chosen:\*\* New build/);
  // The [step] Timeline line is dispatch narrative, not a Q&A pair - it must
  // not be mistaken for a question.
  assert.equal(/twt-pre-design/.test(text), false, 'a [step] line must not be harvested as a decision');
});

test('a facts.md CONFLICT row reports both values and never silently picks a canonical', () => {
  const dir = newProject();
  initWiki(dir);
  writeArtifact(dir, 'pre-design/curation/facts.md', FACTS_MD);
  run(dir);
  const text = readFileSync(inboxPath(dir), 'utf8');
  assert.match(text, /20\+ years@brandbook/);
  assert.match(text, /25\+ years@site/);
  assert.match(text, /\*\*canonical:\*\* TBD/);
  // The RESOLVED row must never be harvested - only CONFLICT rows are decisions.
  assert.equal(/self-descriptor-noun/.test(text), false, 'a RESOLVED fact row is not a decision');
});

test('a non-decision artifact (tokens.css) gets a sources.md row and no inbox entry', () => {
  const dir = newProject();
  initWiki(dir);
  writeArtifact(dir, 'design/design-system/tokens.css', TOKENS_CSS);
  run(dir);
  const sources = readFileSync(sourcesPath(dir), 'utf8');
  assert.match(sources, /tokens\.css/);
  const inbox = readFileSync(inboxPath(dir), 'utf8');
  assert.equal(/tokens\.css/.test(inbox), false, 'a regenerable artifact must never reach the inbox');
});

test('no fabrication: an item with no recorded rationale gets why: _not recorded_, never invented text', () => {
  const dir = newProject();
  initWiki(dir);
  writeArtifact(dir, 'design/design-system/decisions.md', DECISIONS_MD);
  run(dir);
  const text = readFileSync(inboxPath(dir), 'utf8');
  // "Treat teal as the only CTA color" (a Proposed rule) carries no basis/why
  // in the source format at all - the harvester must say so, not guess one.
  assert.match(text, /Treat teal as the only CTA color/);
  assert.match(text, /\*\*why:\*\* _not recorded_/);
});

test('idempotency: running twice adds nothing the second time (byte-identical inbox.md)', () => {
  const dir = newProject();
  initWiki(dir);
  seedFullFixtureSet(dir);
  run(dir);
  const after1 = readFileSync(inboxPath(dir), 'utf8');
  const out2 = run(dir);
  const after2 = readFileSync(inboxPath(dir), 'utf8');
  assert.equal(after2, after1, 'a second run must not append anything new');
  assert.equal(/harvested:/.test(out2), false, 'second run should report only already-harvested items');
  assert.match(out2, /already:/);
});

test('idempotency after drain: draining inbox.md by hand and re-running still adds nothing', () => {
  const dir = newProject();
  initWiki(dir);
  seedFullFixtureSet(dir);
  const scaffoldInbox = readFileSync(inboxPath(dir), 'utf8');
  run(dir); // first harvest: populates inbox.md and .harvest-state.json
  // Simulate the curator (twt-wiki-define) draining the inbox: it resets
  // inbox.md back to just its header comment once every entry is promoted.
  writeFileSync(inboxPath(dir), scaffoldInbox, 'utf8');
  const out2 = run(dir);
  const after = readFileSync(inboxPath(dir), 'utf8');
  assert.equal(after, scaffoldInbox, 'nothing should be re-added after a drain - the state file remembers what was already harvested');
  assert.equal(/harvested:/.test(out2), false);
});

test('a BLOCKER entry captures only its own finding, not the following WARNING/SUGGESTION text', () => {
  const dir = newProject();
  initWiki(dir);
  writeArtifact(dir, 'design/design-system/validation-report.md', VALIDATION_REPORT_MULTI_MD);
  run(dir);
  const text = readFileSync(inboxPath(dir), 'utf8');
  assert.match(text, /Primary CTA fails contrast/);
  assert.match(text, /#1DB89C on #FFFFFF measures 2\.1:1/);
  // The WARNING and SUGGESTION are lower tiers - never harvested as their own
  // entries, and their text must not have leaked into the BLOCKER's entry.
  assert.equal(/Spacing scale drifts/.test(text), false, 'the WARNING title must not appear in the BLOCKER entry');
  assert.equal(/mobile gutter/.test(text), false, "the WARNING's Problem text must not leak into the BLOCKER entry");
  assert.equal(/warmer neutral/.test(text), false, 'the SUGGESTION title must not appear in the BLOCKER entry');
});

test('stable-ID regression: rewording a LATER finding must not re-harvest an earlier BLOCKER', () => {
  const dir = newProject();
  initWiki(dir);
  writeArtifact(dir, 'design/design-system/validation-report.md', VALIDATION_REPORT_MULTI_MD);
  run(dir); // first harvest: BLOCKER captured, id recorded in .harvest-state.json
  const after1 = readFileSync(inboxPath(dir), 'utf8');

  // Reword ONLY the WARNING (a later finding) - the BLOCKER's own text is
  // byte-identical. Before the fix, parseBlockers' block scan swallowed the
  // WARNING into the BLOCKER's captured text, so this reword silently changed
  // the BLOCKER's stable-ID hash too, and it would look "new" again.
  writeArtifact(dir, 'design/design-system/validation-report.md', VALIDATION_REPORT_MULTI_REWORDED_MD);
  const out2 = run(dir);
  const after2 = readFileSync(inboxPath(dir), 'utf8');

  assert.equal(after2, after1, 'inbox.md must not gain a duplicate/new BLOCKER entry after a later finding is reworded');
  assert.equal(/harvested:/.test(out2), false, 'the BLOCKER must be reported as already-harvested, not harvested again');
  assert.match(out2, /already:/);
});

test('--dry-run reports what it would harvest but writes nothing', () => {
  const dir = newProject();
  initWiki(dir);
  seedFullFixtureSet(dir);
  const inboxBefore = readFileSync(inboxPath(dir), 'utf8');
  const sourcesBefore = readFileSync(sourcesPath(dir), 'utf8');
  const out = run(dir, ['--dry-run']);
  assert.match(out, /harvested:/, 'dry-run must still report what it would harvest');
  assert.equal(readFileSync(inboxPath(dir), 'utf8'), inboxBefore, 'dry-run must not write inbox.md');
  assert.equal(readFileSync(sourcesPath(dir), 'utf8'), sourcesBefore, 'dry-run must not write sources.md');
  assert.equal(existsSync(statePath(dir)), false, 'dry-run must not write the state file');
});
