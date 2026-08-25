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
