import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, extFromContentType, fmtTime, paragraphize, buildIndexMd, buildMetaMd, titleFrom,
} from '../skills/twt-content-fetch-video/tools/transcribe-video.mjs';

// Build a segment list from [start, end, text] triples.
const segs = (...rows) => rows.map(([start, end, text]) => ({ start, end, text }));
// n words of filler, ending without punctuation.
const filler = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('fmtTime omits the hour under an hour and pads minutes past it', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(9.7), '0:09');
  assert.equal(fmtTime(605), '10:05');
  assert.equal(fmtTime(3661), '1:01:01');
  assert.equal(fmtTime(65, true), '0:01:05');   // forceHours
});

test('slugify keeps it filename-safe and bounded', () => {
  assert.equal(slugify('Client Walkthrough — Final (v2)'), 'client-walkthrough-final-v2');
  assert.equal(slugify(''), 'video');
  assert.equal(slugify('!!!'), 'video');
  assert.ok(slugify('x'.repeat(200)).length <= 60);
});

test('extFromContentType maps known types and falls back to .mp4', () => {
  assert.equal(extFromContentType('audio/mpeg'), '.mp3');
  assert.equal(extFromContentType('video/quicktime; codecs=avc1'), '.mov');
  assert.equal(extFromContentType('application/octet-stream'), '.mp4');
  assert.equal(extFromContentType(''), '.mp4');
});

test('a pause mid-sentence does not break the paragraph', () => {
  // 3s gap, but the text so far does not end a sentence.
  const paras = paragraphize(segs(
    [0, 5, `${filler(50)} and then`],
    [8, 12, 'we shipped it.'],
  ));
  assert.equal(paras.length, 1);
  assert.match(paras[0].text, /and then we shipped it\.$/);
});

test('a pause after a sentence end breaks once the paragraph is long enough', () => {
  const paras = paragraphize(segs(
    [0, 5, `${filler(50)} done.`],
    [8, 12, 'New topic here.'],
  ));
  assert.equal(paras.length, 2);
  assert.equal(paras[1].start, 8);
});

test('a short opening sentence is not split off by a pause', () => {
  // Sentence ends, and there is a 4s gap, but only ~5 words so far.
  const paras = paragraphize(segs(
    [0, 2, 'Hello everyone, welcome back.'],
    [6, 10, `${filler(30)} rest.`],
  ));
  assert.equal(paras.length, 1);
});

test('unpunctuated speech is still broken up at the hard word cap', () => {
  const paras = paragraphize(segs(
    [0, 30, filler(150)],
    [30, 60, filler(150)],
    [60, 90, filler(150)],
  ));
  assert.ok(paras.length >= 2, `expected a forced break, got ${paras.length} paragraph(s)`);
  for (const p of paras) {
    assert.ok(p.text.split(/\s+/).length <= 350, 'no paragraph should run away past the hard cap');
  }
});

test('paragraph timestamps come from the first segment of each paragraph', () => {
  const paras = paragraphize(segs(
    [12.4, 20, `${filler(50)} one.`],
    [24, 30, `${filler(50)} two.`],
  ));
  assert.equal(paras.length, 2);
  assert.equal(paras[0].start, 12.4);
  assert.equal(paras[1].start, 24);
});

const result = {
  language: 'en', language_probability: 0.98, duration: 4000, model: 'small',
  device: 'cpu', compute_type: 'int8', transcribe_seconds: 120,
  segments: segs([0, 5, `${filler(50)} first.`], [9, 14, `${filler(50)} second.`]),
};

test('index.md carries frontmatter and one anchor per paragraph', () => {
  const md = buildIndexMd({ source: 'https://x.test/talk.mp4', slug: 'talk', result, fetchedAt: '2026-08-25' });
  assert.match(md, /^---\n/);
  assert.match(md, /^source: https:\/\/x\.test\/talk\.mp4$/m);
  assert.match(md, /^language: en$/m);
  assert.match(md, /^model: small$/m);
  assert.match(md, /^segments: 2$/m);
  assert.match(md, /^fetched_at: 2026-08-25$/m);
  // Over an hour, so anchors carry the hour field.
  assert.equal((md.match(/\*\*\[\d+:\d\d:\d\d\]\*\*/g) || []).length, 2);
  assert.match(md, /\*\*\[0:00:00\]\*\*/);
});

test('index.md says so plainly when nothing was transcribed', () => {
  const md = buildIndexMd({
    source: 'silent.mp4', slug: 'silent', fetchedAt: '2026-08-25',
    result: { ...result, segments: [] },
  });
  assert.match(md, /No speech was detected/);
  assert.match(md, /^segments: 0$/m);
});

test('_meta.md records the engine and every warning', () => {
  const md = buildMetaMd({
    source: 'https://x.test/talk.mp4', localPath: '/tmp/talk.mp4', bytes: 5 * 1048576,
    result, warnings: ['Low language-detection confidence (0.4)'], keptSource: false,
  });
  assert.match(md, /faster-whisper \(local, offline\)/);
  assert.match(md, /model `small`, cpu\/int8/);
  assert.match(md, /5\.0 MB/);
  assert.match(md, /deleted after transcription/);
  assert.match(md, /- Low language-detection confidence \(0\.4\)/);
});

test('_meta.md reports "None." rather than an empty warnings section', () => {
  const md = buildMetaMd({ source: 'a.mp4', localPath: 'a.mp4', bytes: 0, result, warnings: [], keptSource: true });
  assert.match(md, /## Warnings\n\n- None\./);
  assert.match(md, /\*\*Local media:\*\* a\.mp4/);
});

test('titleFrom prettifies a slug and leaves short tokens alone', () => {
  assert.equal(titleFrom('client-walkthrough-v2'), 'Client Walkthrough v2');
  assert.equal(titleFrom('a-b-c'), 'a b c');
  assert.equal(titleFrom(''), 'Transcript');
});

// ---- descriptive pass ----------------------------------------------------------

import {
  assignTurns, nonSpeechGaps, buildOutline, buildSlice, parseTime,
  TURN_GAP_ANY, GAP_MIN_SECONDS,
} from '../skills/twt-content-fetch-video/tools/transcribe-video.mjs';

test('a mid-sentence pause does not open a new turn', () => {
  const turns = assignTurns(segs([0, 4, 'we looked at the numbers and'], [5.4, 9, 'they were fine.']));
  assert.deepEqual(turns.map((t) => t.turn), [0, 0]);
});

test('a short pause after a finished sentence opens a turn', () => {
  const turns = assignTurns(segs([0, 4, 'That is the whole flow.'], [5.1, 9, 'Thanks, Dana.']));
  assert.deepEqual(turns.map((t) => t.turn), [0, 1]);
});

test('a long pause opens a turn even mid-sentence', () => {
  const gap = TURN_GAP_ANY + 0.5;
  const turns = assignTurns(segs([0, 4, 'and then we'], [4 + gap, 9, 'sorry, go ahead.']));
  assert.deepEqual(turns.map((t) => t.turn), [0, 1]);
});

test('continuous speech stays one turn', () => {
  const turns = assignTurns(segs([0, 4, 'one.'], [4.1, 8, 'two.'], [8.2, 12, 'three.']));
  assert.deepEqual(turns.map((t) => t.turn), [0, 0, 0]);
});

test('nonSpeechGaps marks silence before the first word and after the last', () => {
  // The 2s pause between the two lines is under the threshold, so the only
  // spans left are the silence at the head and the silence at the tail.
  const gaps = nonSpeechGaps(segs([12, 20, 'hello.'], [22, 30, 'bye.']), 40);
  assert.deepEqual(gaps, [{ start: 0, end: 12 }, { start: 30, end: 40 }]);
});

test('nonSpeechGaps ignores pauses under the threshold', () => {
  const short = GAP_MIN_SECONDS - 0.5;
  const gaps = nonSpeechGaps(segs([0, 10, 'a.'], [10 + short, 20, 'b.']), 20);
  assert.deepEqual(gaps, []);
});

test('nonSpeechGaps survives overlapping segments without inventing a gap', () => {
  // Whisper can emit a segment that starts before the previous one ended.
  const gaps = nonSpeechGaps(segs([0, 10, 'a.'], [8, 20, 'b.'], [21, 30, 'c.']), 30);
  assert.deepEqual(gaps, []);
});

const longSegs = segs(
  [0, 100, `${filler(200)} one.`],
  [140, 260, `${filler(200)} two.`],
  [310, 420, `${filler(200)} three.`],
);

test('buildOutline windows the recording and files each frame under its window', () => {
  const outline = buildOutline({
    segments: longSegs, duration: 600, windowSeconds: 300,
    frames: [{ n: 1, t: 5, file: 'a.jpg' }, { n: 2, t: 310, file: 'b.jpg' }],
    gaps: [{ start: 100, end: 140 }, { start: 420, end: 600 }],
    captions: [{ start: 12, text: 'x' }],
  });
  assert.equal(outline.windows.length, 2);
  assert.deepEqual(outline.windows[0].frames, ['a.jpg']);
  assert.deepEqual(outline.windows[1].frames, ['b.jpg']);
  assert.equal(outline.windows[0].non_speech_spans, 1);
  assert.equal(outline.windows[1].non_speech_spans, 1);
  assert.equal(outline.windows[0].caption_cues, 1);
  assert.equal(outline.windows[1].caption_cues, 0);
});

test('outline rows stay short — they are a plan, not the transcript', () => {
  const outline = buildOutline({ segments: longSegs, duration: 600, windowSeconds: 300 });
  for (const w of outline.windows) {
    assert.ok(w.opens.split(/\s+/).length <= 18, 'opens must stay bounded');
    assert.ok(w.closes.split(/\s+/).length <= 12, 'closes must stay bounded');
  }
});

test('an outline window with no speech says so instead of going blank', () => {
  const outline = buildOutline({ segments: segs([0, 30, 'hi.']), duration: 900, windowSeconds: 300 });
  assert.equal(outline.windows.length, 3);
  assert.equal(outline.windows[1].opens, '(no speech)');
  assert.equal(outline.windows[1].words, 0);
});

test('parseTime accepts seconds, mm:ss and h:mm:ss, and rejects junk', () => {
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
});

const sliceInput = {
  duration: 600,
  segments: assignTurns(segs(
    [10, 40, 'Welcome to the review.'],
    [46, 80, 'Thanks. Here is the checkout flow.'],
    [320, 350, 'Next window entirely.'],
  )),
  gaps: [{ start: 0, end: 10 }, { start: 80, end: 300 }],
  frames: [{ n: 1, t: 12, file: '001-00m12s.jpg' }, { n: 2, t: 330, file: '002-05m30s.jpg' }],
  captions: [{ start: 15, text: 'Q3 PRODUCT REVIEW' }, { start: 325, text: 'DASHBOARD' }],
};

test('a slice carries only its own window — the whole point of slicing', () => {
  const md = buildSlice({ from: 0, to: 300, ...sliceInput });
  assert.match(md, /Welcome to the review/);
  assert.doesNotMatch(md, /Next window entirely/, 'later speech must not leak in');
  assert.doesNotMatch(md, /002-05m30s\.jpg/, 'later frames must not leak in');
  assert.doesNotMatch(md, /DASHBOARD/, 'later captions must not leak in');
});

test('silence is interleaved with speech in time order, not appended after it', () => {
  const md = buildSlice({ from: 0, to: 300, ...sliceInput });
  const openingGap = md.indexOf('no speech 0:00');
  const firstSpeech = md.indexOf('Welcome to the review');
  const closingGap = md.indexOf('no speech 1:20');
  assert.ok(openingGap > -1 && closingGap > -1, 'both silences should appear');
  assert.ok(openingGap < firstSpeech, 'the silence before the first word comes first');
  assert.ok(firstSpeech < closingGap, 'the silence after the last word comes last');
});

test('each speech block in a slice is labelled with exactly one turn', () => {
  const md = buildSlice({ from: 0, to: 300, ...sliceInput });
  const labels = md.match(/_\(turn \d+\)_/g) || [];
  assert.equal(labels.length, 2, 'two turns in this window');
  assert.deepEqual(labels, ['_(turn 0)_', '_(turn 1)_']);
});

test('a slice lists its frames and its caption cues', () => {
  const md = buildSlice({ from: 0, to: 300, ...sliceInput });
  assert.match(md, /frames\/001-00m12s\.jpg/);
  assert.match(md, /Q3 PRODUCT REVIEW/);
});

test('an audio-only slice says there are no frames rather than showing an empty list', () => {
  const md = buildSlice({ from: 0, to: 300, ...sliceInput, frames: [] });
  assert.match(md, /None \(audio-only source/);
});

test('_meta.md gains a descriptive section only when the descriptive pass ran', () => {
  const plain = buildMetaMd({ source: 'a.mp4', localPath: 'a.mp4', bytes: 0, result, warnings: [], keptSource: true });
  assert.doesNotMatch(plain, /Descriptive-pass inputs/);

  const rich = buildMetaMd({
    source: 'a.mp4', localPath: 'a.mp4', bytes: 0, result, warnings: [], keptSource: true,
    descriptive: { frames: 12, captions: 40, audio_description: true, turns: 9, non_speech_spans: 3, windows: 2 },
  });
  assert.match(rich, /## Descriptive-pass inputs/);
  assert.match(rich, /\*\*Keyframes extracted:\*\* 12/);
  assert.match(rich, /transcribed to `audio-description\.md`/);
  assert.match(rich, /not from an audio-event classifier/);
});
