#!/usr/bin/env node
// write-as-me-contamination.mjs — mechanical source-contamination check for
// /twt-write-as-me `--mode author`.
//
// The failure this catches: a rewrite that is grammatically different from its
// source while still carrying the source's structure and phrasing — the
// "AI text with the author's words applied on top" outcome. A model auditing
// its own draft against its own source is the worst possible judge of that,
// because the overlap it needs to notice is exactly the material it has been
// staring at. So the overlap gets counted instead of eyeballed.
//
// What it measures (all deterministic, none of it a style opinion):
//   - shared word n-grams between source and output, with examples
//   - the longest shared span, in words
//   - paragraph and sentence counts on both sides
//   - numbers in the output that do NOT appear in the source  (fabrication)
//   - numbers in the source that do NOT appear in the output  (drop ledger)
//   - source rhetorical labels ("Strength:", "Critical assessment") that survived
//   - a shared opening — the first n words of the first sentence matching
//
// Hard signals (non-zero exit): shared n-grams above the threshold, a fabricated
// number, or a surviving rhetorical label. Everything else is reported for the
// caller to weigh — a matching paragraph count on a three-paragraph text means
// nothing, and the tool does not pretend otherwise.
//
// This tool NEVER decides whether a rewrite is good. It reports overlap. The
// skill decides what the overlap means, because a shared 6-gram can legitimately
// be a product name, a quoted phrase, or a fixed technical term.
//
// Usage:
//   node tools/write-as-me-contamination.mjs --source <path> --output <path>
//                                            [--n 6] [--max-shared 0] [--json]
//   node tools/write-as-me-contamination.mjs --self-test
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_N = 6;

// Labels an AI-written source uses as scaffolding. Their survival into the
// rewrite is a hard signal because /twt-write-as-me treats them as Layer 3
// (rhetorical scaffolding) — rebuilt from the profile, never carried across.
// Matched only where the SOURCE also used them: this is a contamination check,
// not a style ban. An author who independently writes "Summary:" is fine.
const RHETORICAL_LABELS = [
  'critical assessment',
  'highest-impact fix',
  'highest impact fix',
  'single highest-leverage',
  'key takeaway',
  'executive summary',
  'strength:',
  'weakness:',
  'strengths:',
  'weaknesses:',
  'pros:',
  'cons:',
  'summary:',
  'recommendation:',
  'conclusion:',
  'takeaway:',
];

// Fenced code and inline code are quoted material, not the author's prose.
// Selectors, identifiers and command lines inside them would otherwise dominate
// the n-gram overlap and drown the signal.
export function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

// Normalize for comparison: lowercase, markdown markers gone, punctuation to
// spaces. Numbers are kept as tokens — "13 of 19" surviving verbatim is a real
// signal, not noise.
export function normalize(text) {
  return stripCode(text)
    .toLowerCase()
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/[*_~>|]/g, ' ')
    .replace(/[^\p{L}\p{N}\s%.-]/gu, ' ')
    // a dot or dash that is not between digits is punctuation, not part of a number
    .replace(/(?<!\d)[.-]+(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

export function ngrams(wordList, n) {
  const out = new Map();
  for (let i = 0; i + n <= wordList.length; i++) {
    const key = wordList.slice(i, i + n).join(' ');
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

// Longest common contiguous word run, via the standard DP over the two token
// streams. Bounded: the skill's inputs are prose, but a pathological pair
// shouldn't be able to allocate unboundedly.
export function longestSharedSpan(a, b, cap = 4000) {
  const A = a.slice(0, cap);
  const B = b.slice(0, cap);
  let best = 0;
  let bestEnd = 0;
  let prev = new Uint32Array(B.length + 1);
  let cur = new Uint32Array(B.length + 1);
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) {
        best = cur[j];
        bestEnd = i;
      }
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return { length: best, text: best ? A.slice(bestEnd - best, bestEnd).join(' ') : '' };
}

export function paragraphs(text) {
  return stripCode(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function sentences(text) {
  // Terminal punctuation followed by whitespace, plus hard line breaks — this
  // author's corpus routinely omits the terminal period, so a newline has to
  // count as a boundary or every chat-shaped text reads as one sentence.
  return stripCode(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

// Numbers as the reader meets them: 87, 4px, 10-step, 45%, 1,500, 3.5.
// Returned as canonical strings so "1,500" and "1500" compare equal.
export function numbers(text) {
  const found = new Set();
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m;
  const src = stripCode(text);
  while ((m = re.exec(src)) !== null) {
    let canon = m[0].replace(/,/g, '');
    // "3.50" and "3.5" are the same number; without this they compare as a
    // fabricated value and a dropped one at the same time.
    if (canon.includes('.')) canon = canon.replace(/0+$/, '').replace(/\.$/, '');
    found.add(canon);
  }
  return found;
}

export function survivingLabels(sourceText, outputText) {
  const s = sourceText.toLowerCase();
  const o = outputText.toLowerCase();
  return RHETORICAL_LABELS.filter((l) => s.includes(l) && o.includes(l));
}

export function analyze(sourceText, outputText, opts = {}) {
  const n = opts.n ?? DEFAULT_N;
  const maxShared = opts.maxShared ?? 0;

  const sw = words(sourceText);
  const ow = words(outputText);

  const sourceGrams = ngrams(sw, n);
  const outputGrams = ngrams(ow, n);
  const shared = [];
  for (const [gram, count] of outputGrams) {
    if (sourceGrams.has(gram)) shared.push({ gram, inOutput: count, inSource: sourceGrams.get(gram) });
  }
  shared.sort((a, b) => b.inOutput - a.inOutput || a.gram.localeCompare(b.gram));

  const span = longestSharedSpan(sw, ow);

  const srcNums = numbers(sourceText);
  const outNums = numbers(outputText);
  const fabricated = [...outNums].filter((x) => !srcNums.has(x));
  const dropped = [...srcNums].filter((x) => !outNums.has(x));

  const labels = survivingLabels(sourceText, outputText);

  const sourceSentences = sentences(sourceText);
  const outputSentences = sentences(outputText);
  const openingWords = Math.min(5, n);
  const sourceOpen = words(sourceSentences[0] ?? '').slice(0, openingWords).join(' ');
  const outputOpen = words(outputSentences[0] ?? '').slice(0, openingWords).join(' ');
  const sharedOpening = Boolean(sourceOpen) && sourceOpen === outputOpen;

  const sourceParas = paragraphs(sourceText).length;
  const outputParas = paragraphs(outputText).length;

  const hardSignals = [];
  if (shared.length > maxShared) {
    hardSignals.push(`${shared.length} shared ${n}-gram${shared.length === 1 ? '' : 's'} (max ${maxShared})`);
  }
  if (fabricated.length) hardSignals.push(`${fabricated.length} number(s) in the output absent from the source`);
  if (labels.length) hardSignals.push(`${labels.length} source rhetorical label(s) survived`);
  if (sharedOpening) hardSignals.push('output opens with the source\'s opening words');

  return {
    n,
    maxShared,
    source: { words: sw.length, paragraphs: sourceParas, sentences: sourceSentences.length, numbers: [...srcNums] },
    output: { words: ow.length, paragraphs: outputParas, sentences: outputSentences.length, numbers: [...outNums] },
    sharedNgrams: shared,
    longestSharedSpan: span,
    sharedOpening,
    fabricatedNumbers: fabricated,
    droppedNumbers: dropped,
    survivingLabels: labels,
    lengthRatio: sw.length ? Number((ow.length / sw.length).toFixed(2)) : null,
    sameParagraphCount: sourceParas === outputParas,
    hardSignals,
    pass: hardSignals.length === 0,
  };
}

function render(r) {
  const lines = [];
  lines.push(`source: ${r.source.words} words · ${r.source.paragraphs} paragraphs · ${r.source.sentences} sentences`);
  lines.push(`output: ${r.output.words} words · ${r.output.paragraphs} paragraphs · ${r.output.sentences} sentences · ${r.lengthRatio ?? '—'}x length`);
  lines.push('');
  lines.push(`shared ${r.n}-grams: ${r.sharedNgrams.length}`);
  for (const s of r.sharedNgrams.slice(0, 12)) lines.push(`  "${s.gram}"`);
  if (r.sharedNgrams.length > 12) lines.push(`  … ${r.sharedNgrams.length - 12} more`);
  lines.push(`longest shared span: ${r.longestSharedSpan.length} words${r.longestSharedSpan.length ? ` — "${r.longestSharedSpan.text}"` : ''}`);
  lines.push(`shared opening: ${r.sharedOpening ? 'YES' : 'no'}`);
  lines.push(`same paragraph count: ${r.sameParagraphCount ? 'yes (weak signal on its own)' : 'no'}`);
  lines.push('');
  lines.push(`numbers in output absent from source: ${r.fabricatedNumbers.length ? r.fabricatedNumbers.join(', ') : 'none'}`);
  lines.push(`numbers in source absent from output: ${r.droppedNumbers.length ? r.droppedNumbers.join(', ') : 'none'} ${r.droppedNumbers.length ? '(expected in author mode — check each against the Layer-1 ledger)' : ''}`);
  lines.push(`source rhetorical labels surviving: ${r.survivingLabels.length ? r.survivingLabels.join(', ') : 'none'}`);
  lines.push('');
  if (r.pass) {
    lines.push('PASS — no hard contamination signal.');
    lines.push('Judgment still required: a shared span below the n-gram threshold, a reused');
    lines.push('argument order, or a copied conclusion structure will not show up here.');
  } else {
    lines.push('FAIL — hard signals:');
    for (const s of r.hardSignals) lines.push(`  - ${s}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { n: DEFAULT_N, maxShared: 0, json: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') out.source = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--n') out.n = Number(argv[++i]);
    else if (a === '--max-shared') out.maxShared = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--self-test') out.selfTest = true;
  }
  return out;
}

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`self-test FAILED: ${msg}`);
      process.exit(1);
    }
  };

  const source = [
    'Critical assessment.',
    '',
    'Strength: The design system definition itself is genuinely good (87/100) - a two-layer',
    'color architecture, a clean 4px spacing scale, and a 34-entry component catalog with',
    'real state coverage.',
    '',
    'Weakness: The product barely references the system. Type is 0% tokenized, there are 19',
    'font sizes, the system defines a 10-step scale, and 13 values are outside the scale.',
  ].join('\n');

  // A local paraphrase: same order, same labels, same spans, marker words bolted on.
  const paraphrase = [
    'Critical assessment.',
    '',
    'Strength: the design system definition itself is pretty good (87/100) - a two-layer',
    'color architecture, a clean 4px spacing scale, and a 34-entry component catalog with',
    'real state coverage.',
    '',
    'Weakness: the product barely references the system. Type is 0% tokenized, there are 19',
    'font sizes, the system defines a 10-step scale, and 13 values are outside the scale.',
  ].join('\n');

  // A reconstruction: verdict first, labels gone, metrics grouped, order changed.
  const reconstruction = [
    'The system on paper is fine - 87 out of 100, two color layers, 4px steps, 34 components',
    'with states done properly.',
    '',
    'Problem is nobody uses it in the product. Type is the worst part, 13 of 19 sizes sit',
    'outside the 10-step scale.',
  ].join('\n');

  const bad = analyze(source, paraphrase);
  assert(!bad.pass, 'a local paraphrase must not pass');
  assert(bad.sharedNgrams.length > 0, 'paraphrase must show shared 6-grams');
  assert(bad.survivingLabels.includes('strength:'), 'paraphrase must flag the surviving Strength: label');
  assert(bad.longestSharedSpan.length >= 10, 'paraphrase must show a long shared span');

  const good = analyze(source, reconstruction);
  assert(good.sharedNgrams.length === 0, `reconstruction must show no shared 6-grams, saw ${good.sharedNgrams.length}`);
  assert(good.survivingLabels.length === 0, 'reconstruction must show no surviving labels');
  assert(good.fabricatedNumbers.length === 0, `reconstruction must fabricate no numbers, saw ${good.fabricatedNumbers.join(',')}`);
  assert(good.pass, `reconstruction must pass, hard signals: ${good.hardSignals.join('; ')}`);
  // Dropped numbers are expected and must be REPORTED, not failed: author mode
  // compresses supporting evidence by design.
  assert(good.droppedNumbers.length > 0, 'reconstruction should report dropped supporting numbers');

  const fabricated = analyze(source, reconstruction + '\nIt would take about 3 weeks to fix.');
  assert(fabricated.fabricatedNumbers.includes('3'), 'an invented number must be caught');
  assert(!fabricated.pass, 'an invented number must fail the run');

  console.log('self-test OK');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
  } else if (!args.source || !args.output) {
    console.error('Usage: node tools/write-as-me-contamination.mjs --source <path> --output <path> [--n 6] [--max-shared 0] [--json]');
    process.exit(2);
  } else {
    const src = readFileSync(args.source, 'utf8');
    const out = readFileSync(args.output, 'utf8');
    const result = analyze(src, out, { n: args.n, maxShared: args.maxShared });
    console.log(args.json ? JSON.stringify(result, null, 2) : render(result));
    process.exit(result.pass ? 0 : 1);
  }
}
