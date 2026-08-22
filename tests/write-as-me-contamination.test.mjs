import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  analyze,
  normalize,
  numbers,
  ngrams,
  longestSharedSpan,
  sentences,
  paragraphs,
  survivingLabels,
} from '../plugins/twt-write-as-me/tools/write-as-me-contamination.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../plugins/twt-write-as-me/tools/write-as-me-contamination.mjs', import.meta.url));

// The acceptance source from the /twt-write-as-me spec: AI-written, label-heavy,
// symmetrical Strength/Weakness, superlative ranking. This is the exact shape
// the `--mode author` reconstruction has to dismantle.
const SOURCE = [
  'Critical assessment.',
  '',
  'Strength: The design system definition itself is genuinely good (87/100) - a two-layer',
  'color architecture, a clean 4px spacing scale, a 34-entry component catalog with real',
  'state coverage.',
  '',
  'Weakness: The product barely references the system. Type is 0% tokenized, there are 19',
  'font sizes, the system defines a 10-step scale, and 13 values are outside the scale.',
  '',
  'Highest-impact fix: Ship a type and spacing token layer before anything else.',
].join('\n');

// What the OLD behavior produced: source order, source labels, source spans,
// with signature words swapped in. Every surface metric passes; it is still the
// source. This is the regression the tool exists to catch.
const PARAPHRASE = [
  'Critical assessment.',
  '',
  'Strength: the design system definition itself is pretty good (87/100) - a two-layer',
  'color architecture, a clean 4px spacing scale, a 34-entry component catalog with real',
  'state coverage.',
  '',
  'Weakness: the product barely references the system. Type is 0% tokenized, there are 19',
  'font sizes, the system defines a 10-step scale, and 13 values are outside the scale.',
  '',
  'Highest-impact fix: ship a type and spacing token layer before anything else.',
].join('\n');

// What `--mode author` should produce: verdict first, scaffolding gone, metrics
// grouped, supporting evidence compressed, paragraph boundaries redrawn.
const RECONSTRUCTION = [
  'System on paper is fine - 87 out of 100. Two color layers, 4px steps, 34 components with',
  'states done properly.',
  '',
  'Problem is nobody actually uses it. Type is the worst part, 13 of 19 sizes sit outside',
  'the 10-step scale. I would start from tokenizing type and spacing.',
].join('\n');

test('a local paraphrase fails on every hard signal', () => {
  const r = analyze(SOURCE, PARAPHRASE);
  assert.equal(r.pass, false);
  assert.ok(r.sharedNgrams.length > 5, `expected many shared 6-grams, saw ${r.sharedNgrams.length}`);
  assert.ok(r.longestSharedSpan.length >= 12, `expected a long shared span, saw ${r.longestSharedSpan.length}`);
  assert.ok(r.survivingLabels.includes('strength:'));
  assert.ok(r.survivingLabels.includes('weakness:'));
  assert.ok(r.survivingLabels.includes('critical assessment'));
  assert.equal(r.sharedOpening, true);
  assert.equal(r.sameParagraphCount, true);
});

test('a genuine reconstruction passes', () => {
  const r = analyze(SOURCE, RECONSTRUCTION);
  assert.equal(r.sharedNgrams.length, 0, `shared: ${r.sharedNgrams.map((s) => s.gram).join(' | ')}`);
  assert.equal(r.survivingLabels.length, 0);
  assert.equal(r.fabricatedNumbers.length, 0, `fabricated: ${r.fabricatedNumbers.join(',')}`);
  assert.equal(r.sharedOpening, false);
  assert.equal(r.pass, true, `hard signals: ${r.hardSignals.join('; ')}`);
});

test('compressed supporting evidence is reported, never failed', () => {
  const r = analyze(SOURCE, RECONSTRUCTION);
  // 19 and 0 are dropped by the compression; that is author mode working as
  // designed. It must show up in droppedNumbers so the skill can check each
  // against its Layer-1 ledger — and it must NOT make the run fail.
  assert.ok(r.droppedNumbers.length > 0, 'dropped supporting numbers must be reported');
  assert.equal(r.pass, true);
});

test('an invented number is a hard failure', () => {
  const r = analyze(SOURCE, `${RECONSTRUCTION}\nProbably 3 weeks of work.`);
  assert.deepEqual(r.fabricatedNumbers, ['3']);
  assert.equal(r.pass, false);
  assert.ok(r.hardSignals.some((s) => s.includes('absent from the source')));
});

test('a rhetorical label only fails when the SOURCE introduced it', () => {
  const authorUsesSummary = 'Summary: nobody uses the system. 87 out of 100 on paper.';
  const cleanSource = 'The system scores 87. Nothing in the product references it.';
  assert.deepEqual(survivingLabels(cleanSource, authorUsesSummary), []);
  assert.deepEqual(survivingLabels('Summary: it scores 87.', authorUsesSummary), ['summary:']);
});

test('code fences and inline code are excluded from the prose comparison', () => {
  const withCode = 'Here is the rule.\n\n```\n.hero--editorial { display: grid; gap: 4px; }\n```\n';
  const alsoWithCode = 'Different prose entirely.\n\n```\n.hero--editorial { display: grid; gap: 4px; }\n```\n';
  const r = analyze(withCode, alsoWithCode);
  assert.equal(r.sharedNgrams.length, 0, 'identical code blocks must not register as contamination');
});

test('numbers survive normalization in comparable form', () => {
  const n = numbers('1,500 items, 4px steps, 87/100, 3.50 and 45%');
  assert.ok(n.has('1500'), 'thousands separators are stripped');
  assert.ok(n.has('4'));
  assert.ok(n.has('87'));
  assert.ok(n.has('100'));
  assert.ok(n.has('3.5'), 'trailing zeros are canonicalized');
  assert.ok(n.has('45'));
});

test('normalize keeps digits joined and drops markdown emphasis', () => {
  assert.equal(normalize('## **Type** is _0%_ tokenized'), 'type is 0% tokenized');
  assert.equal(normalize('the 10-step scale'), 'the 10-step scale', 'intra-number hyphens survive');
  assert.equal(normalize('well - designed'), 'well designed', 'standalone dashes become spaces');
});

test('sentence splitting counts unterminated lines', () => {
  // The corpus this skill targets routinely omits terminal periods; a newline
  // has to end a sentence or a chat-shaped text reads as one long one.
  assert.equal(sentences('first line\nsecond line\nthird line').length, 3);
  assert.equal(sentences('One. Two! Three?').length, 3);
  assert.equal(paragraphs('a\n\nb\n\nc').length, 3);
});

test('ngrams and longestSharedSpan agree with hand counts', () => {
  const g = ngrams(['a', 'b', 'c', 'd'], 3);
  assert.deepEqual([...g.keys()], ['a b c', 'b c d']);
  assert.equal(ngrams(['a', 'b'], 3).size, 0, 'a text shorter than n yields no grams');
  const span = longestSharedSpan(['x', 'a', 'b', 'c', 'y'], ['q', 'a', 'b', 'c', 'z']);
  assert.equal(span.length, 3);
  assert.equal(span.text, 'a b c');
});

test('--max-shared tolerates a fixed technical term without disabling the check', () => {
  const src = 'The two-layer color architecture is the good part of the system here.';
  const out = 'Good part is the two-layer color architecture is the good part of the system here now.';
  assert.equal(analyze(src, out).pass, false);
  assert.equal(analyze(src, out, { maxShared: 99 }).pass, true);
});

test('CLI exits 0 on a clean rewrite and 1 on a contaminated one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wam-contam-'));
  try {
    const src = join(dir, 'source.md');
    const good = join(dir, 'good.md');
    const bad = join(dir, 'bad.md');
    writeFileSync(src, SOURCE);
    writeFileSync(good, RECONSTRUCTION);
    writeFileSync(bad, PARAPHRASE);

    const ok = await run(process.execPath, [TOOL, '--source', src, '--output', good]);
    assert.match(ok.stdout, /PASS/);

    await assert.rejects(
      run(process.execPath, [TOOL, '--source', src, '--output', bad]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stdout, /FAIL/);
        assert.match(err.stdout, /strength:/);
        return true;
      },
    );

    const json = await run(process.execPath, [TOOL, '--source', src, '--output', good, '--json']);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.pass, true);
    assert.equal(parsed.n, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 2 without both paths', async () => {
  await assert.rejects(run(process.execPath, [TOOL, '--source', 'only-one.md']), (err) => {
    assert.equal(err.code, 2);
    return true;
  });
});
