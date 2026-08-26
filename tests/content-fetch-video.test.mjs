import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  slugify, extFromContentType, fmtTime, paragraphize, buildIndexMd, buildMetaMd, titleFrom,
  redactUrl, sourceLabel, isGenericName, detectIssues, properPhrases, buildReportTxt,
  spliceReview, buildReviewRequest, REPORT_WIDTH, REVIEW_HEADING, verifyArtifacts,
  parseCaptions, captionSegments, diffTranscripts, brightcoveRef, ingestCaptions,
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

// ---- URL hygiene ---------------------------------------------------------------
// A signed CDN URL is a bearer credential. One reached a committed artifact whole,
// twice over (the heading and the source line) — these lock that shut.

test('redactUrl strips signed-token values and keeps the rest of the URL usable', () => {
  const { url, redacted } = redactUrl(
    'https://cdn.test/media/main.mp4?fastly_token=SECRET123&videoId=6342533385112');
  assert.match(url, /fastly_token=REDACTED/);
  assert.doesNotMatch(url, /SECRET123/);
  assert.match(url, /videoId=6342533385112/, 'a non-credential param must survive');
  assert.deepEqual(redacted, ['fastly_token']);
});

test('redactUrl covers the signature/expiry/policy family, not just "token"', () => {
  const { url, redacted } = redactUrl(
    'https://cdn.test/a.mp4?Signature=abc&Expires=999&Policy=ppp&plain=keep');
  for (const secret of ['abc', '999', 'ppp']) assert.doesNotMatch(url, new RegExp(secret));
  assert.match(url, /plain=keep/);
  assert.deepEqual(redacted.sort(), ['Expires', 'Policy', 'Signature']);
});

test('redactUrl leaves local paths and unparseable sources alone', () => {
  assert.equal(redactUrl('C:/media/talk.mp4').url, 'C:/media/talk.mp4');
  assert.deepEqual(redactUrl('/tmp/a.mp4').redacted, []);
});

test('sourceLabel drops the query string — the heading is where the token leaked', () => {
  assert.equal(sourceLabel('https://cdn.test/media/v1/main.mp4?fastly_token=SECRET123'), 'main.mp4');
  assert.equal(sourceLabel('/tmp/dir/talk.mov'), 'talk.mov');
});

test('_meta.md never writes a signed token, in the heading or the source line', () => {
  const source = 'https://cdn.test/media/main.mp4?fastly_token=SECRET123';
  const md = buildMetaMd({ source, localPath: null, bytes: 0, result, warnings: [], keptSource: false });
  assert.doesNotMatch(md, /SECRET123/);
  assert.match(md, /^# Transcript metadata — main\.mp4$/m);
  assert.match(md, /\*\*Signed URL:\*\*.*fastly_token/);
});

test('index.md frontmatter carries the redacted URL too', () => {
  const md = buildIndexMd({
    source: 'https://cdn.test/main.mp4?token=SECRET123', slug: 'talk', result, fetchedAt: '2026-08-25',
  });
  assert.doesNotMatch(md, /SECRET123/);
  assert.match(md, /^source: .*token=REDACTED$/m);
});

// ---- naming --------------------------------------------------------------------

test('isGenericName spots the CDN placeholder filenames that make a useless slug', () => {
  for (const n of ['main', 'index', 'video', 'master', 'playlist', '1080', 'a1b2c3d4e5']) {
    assert.ok(isGenericName(n), `${n} should read as generic`);
  }
  for (const n of ['grief-sensitive-schools-initiative', 'q3-review', 'interview-dana']) {
    assert.ok(!isGenericName(n), `${n} should read as meaningful`);
  }
});

test('an explicit title wins over the slug, so index.md never needs hand-editing', () => {
  const md = buildIndexMd({
    source: 'a.mp4', slug: 'main', title: 'About the Grief-Sensitive Schools Initiative',
    result, fetchedAt: '2026-08-25',
  });
  assert.match(md, /^title: About the Grief-Sensitive Schools Initiative$/m);
  assert.match(md, /^# About the Grief-Sensitive Schools Initiative$/m);
  assert.equal(titleFrom('main', '  '), 'Main', 'a blank title falls back to the slug');
});

// ---- possible-issue detection --------------------------------------------------

const scored = (rows) => rows.map(([start, end, text, lp, ns, cr]) => ({
  start, end, text,
  avg_logprob: lp ?? -0.2, no_speech_prob: ns ?? 0.05, compression_ratio: cr ?? 1.4,
}));

test('a very low confidence line is flagged high, a mildly low one medium', () => {
  const issues = detectIssues({ segments: scored([
    [0, 4, 'clear speech here.', -0.2],
    [4, 8, 'mumbled words maybe.', -1.0],
    [8, 12, 'total guesswork here.', -1.4],
  ]) });
  assert.equal(issues.segments.length, 2);
  assert.equal(issues.segments[0].severity, 'medium');
  assert.equal(issues.segments[1].severity, 'high');
  assert.match(issues.segments[1].notes.join(' '), /very low confidence/);
});

test('a line the recognizer thinks was silence is flagged as possibly invented', () => {
  const issues = detectIssues({ segments: scored([[0, 4, 'Thanks for watching!', -0.3, 0.92]]) });
  assert.equal(issues.segments.length, 1);
  assert.equal(issues.segments[0].severity, 'high');
  assert.match(issues.segments[0].notes.join(' '), /may have been invented/);
});

test('a repetition loop is caught by compression ratio and by repeated lines alike', () => {
  const byRatio = detectIssues({ segments: scored([[0, 4, 'la la la la la la', -0.3, 0.05, 3.1]]) });
  assert.match(byRatio.segments[0].notes.join(' '), /repetition loop/);

  const byRepeat = detectIssues({ segments: scored([
    [0, 2, 'Subscribe to the channel.'], [2, 4, 'Subscribe to the channel.'],
    [4, 6, 'Subscribe to the channel.'], [6, 8, 'And now the real content.'],
  ]) });
  assert.equal(byRepeat.segments.length, 1);
  assert.match(byRepeat.segments[0].notes.join(' '), /repeats 3 times in a row/);
});

test('two repeats are speech; three are a loop', () => {
  const issues = detectIssues({ segments: scored([
    [0, 2, 'No, no.'], [2, 4, 'No, no.'], [4, 6, 'Moving on.'],
  ]) });
  assert.equal(issues.segments.length, 0);
});

test('a run with no confidence scores reports that rather than a clean bill of health', () => {
  const issues = detectIssues({ segments: segs([0, 4, 'plain segment.']) });
  assert.equal(issues.scored, false);
  assert.equal(issues.segments.length, 0);
});

test('the run-level flags name the things that invalidate everything downstream', () => {
  const issues = detectIssues({ segments: [], language_probability: 0.41, model: 'base',
    warnings: ['Frame extraction failed.'] });
  const text = issues.run.join('\n');
  assert.match(text, /No speech was detected/);
  assert.match(text, /Language detection was not confident/);
  assert.match(text, /error-prone end of the range/);
  assert.match(text, /Frame extraction failed\./);
});

test('a confident model choice raises no model flag', () => {
  assert.ok(!detectIssues({ segments: [], model: 'medium', language_probability: 1 })
    .run.some((r) => /error-prone/.test(r)));
});

// ---- name variants -------------------------------------------------------------

test('properPhrases skips sentence openers but keeps names and acronyms', () => {
  const found = properPhrases('The Coalition met. We asked the National Center for GSSI funding.');
  assert.ok(found.includes('National Center'), 'a mid-sentence name run is a phrase');
  assert.ok(found.includes('GSSI'), 'an all-caps acronym counts anywhere');
  assert.ok(!found.includes('The'), 'a sentence opener is not a name');
  assert.ok(!found.includes('We'), 'nor is a capitalized pronoun at position 0');
});

test('a long run also yields its individual words, which is how a title meets speech', () => {
  const found = properPhrases('about New York Life Foundation Grief-Sensitive Schools Initiative today');
  assert.ok(found.includes('Grief-Sensitive'), 'the individual word must be emitted');
  assert.ok(!found.includes('New York Life Foundation Grief-Sensitive Schools Initiative'),
    'a run past the token cap is not emitted whole — it would match nothing');
});

test('the title and the transcript disagreeing about a hyphen is reported', () => {
  const issues = detectIssues({
    title: 'About the Grief-Sensitive Schools Initiative',
    segments: segs([0, 5, 'Schools can agree to become Grief Sensitive today.']),
  });
  assert.equal(issues.variants.length, 1);
  const forms = issues.variants[0].forms.map((f) => f.phrase).sort();
  assert.deepEqual(forms, ['Grief Sensitive', 'Grief-Sensitive']);
});

test('a longer name containing a shorter one is not a rival spelling', () => {
  const issues = detectIssues({ segments: segs(
    [0, 5, 'At New York Life we tried.'],
    [5, 9, 'The New York Life GSSI program grew.'],
  ) });
  assert.equal(issues.variants.length, 0);
});

test('a plural is not a misspelling', () => {
  const issues = detectIssues({ segments: segs(
    [0, 5, 'the Coalition met.'], [5, 9, 'both Coalitions met.'],
  ) });
  assert.equal(issues.variants.length, 0);
});

test('a trademark symbol is not a rival spelling either', () => {
  const issues = detectIssues({
    title: 'The Grief-Sensitive Schools Initiative®',
    segments: segs([0, 5, 'we built the Grief-Sensitive Schools Initiative.']),
  });
  assert.equal(issues.variants.length, 0);
});

// ---- the plain-text report -----------------------------------------------------

const reportOf = (over = {}) => buildReportTxt({
  source: 'https://cdn.test/main.mp4?fastly_token=SECRET123',
  slug: 'q3-review', title: 'Q3 Product Review', fetchedAt: '2026-08-25', bytes: 1048576,
  result, warnings: [], issues: detectIssues({ ...result, title: 'Q3 Product Review' }),
  ...over,
});

test('PART 1 reads as continuous prose with no timestamps in it', () => {
  const part1 = reportOf().split('PART 2')[0].split('PART 1')[1];
  assert.doesNotMatch(part1, /\d+:\d\d/, 'the reading transcript carries no timings');
  assert.match(part1, /first\./);
  assert.match(part1, /second\./);
});

test('PART 2 keeps every timestamp — it is the half you cite from', () => {
  const part2 = reportOf().split('PART 3')[0].split('PART 2')[1];
  assert.match(part2, /0:00:00 - 0:00:05/);
  assert.match(part2, /0:00:09 - 0:00:14/);
  assert.match(part2, /all 2 items/);
});

test('the report never carries the signed token, and says the link was redacted', () => {
  const txt = reportOf();
  assert.doesNotMatch(txt, /SECRET123/);
  assert.match(txt, /fastly_token=REDACTED/);
  assert.match(txt, /time-limited credential/);
});

test('the report wraps to a readable width, URLs excepted', () => {
  for (const line of reportOf().split('\n')) {
    if (/https?:\/\//.test(line)) continue;
    assert.ok(line.length <= REPORT_WIDTH, `line over ${REPORT_WIDTH} cols: ${line}`);
  }
});

test('PART 3 ships pending until the assistant has actually reviewed it', () => {
  const txt = reportOf();
  assert.match(txt, new RegExp(REVIEW_HEADING));
  assert.match(txt, /Not yet reviewed/);
  assert.match(txt, /cannot hear the words/);
});

test('PART 3 carries the machine findings above the review seam', () => {
  const segments = scored([[0, 5, 'we became Grief Sensitive.', -1.3]]);
  const issues = detectIssues({
    title: 'The Grief-Sensitive Schools Initiative', segments, model: 'base',
  });
  const txt = reportOf({ issues, result: { ...result, segments } });
  assert.match(txt, /NAMES SPELLED MORE THAN ONE WAY/);
  assert.match(txt, /ABOUT THE RUN/);
  assert.match(txt, /LINES THE RECOGNIZER WAS UNSURE OF/);
  assert.ok(txt.indexOf('LINES THE RECOGNIZER') < txt.indexOf(REVIEW_HEADING));
});

test('spliceReview replaces only the review section, leaving PARTS 1 and 2 untouched', () => {
  const before = reportOf();
  const after = spliceReview(before, '- [0:17] "by depth" is almost certainly "by death".');
  assert.match(after, /by depth/);
  assert.doesNotMatch(after, /Not yet reviewed/);
  assert.equal(after.split('PART 1')[0], before.split('PART 1')[0], 'the header is unchanged');
  assert.equal(after.split('PART 1')[1].split('PART 3')[0],
    before.split('PART 1')[1].split('PART 3')[0], 'PARTS 1 and 2 are unchanged');
  assert.match(after, /END OF REPORT/);
});

test('re-splicing replaces the previous review rather than stacking a second one', () => {
  const once = spliceReview(reportOf(), 'first pass.');
  const twice = spliceReview(once, 'second pass.');
  assert.doesNotMatch(twice, /first pass/);
  assert.match(twice, /second pass/);
  assert.equal((twice.match(new RegExp(REVIEW_HEADING, 'g')) || []).length, 1);
});

test('spliceReview refuses a report whose seam was edited away', () => {
  assert.equal(spliceReview('a hand-written file with no seam at all', 'notes'), null);
});

// ---- the review request --------------------------------------------------------

test('a short transcript is handed over whole — a fluent mishearing needs reading', () => {
  const req = buildReviewRequest({
    title: 'Q3', result, issues: detectIssues(result), wordBudget: 4000,
  });
  assert.match(req, /the full transcript is below/);
  assert.match(req, /## Full transcript/);
});

test('a transcript over the budget hands over flagged excerpts only, and says so', () => {
  const req = buildReviewRequest({
    title: 'Q3', result, issues: detectIssues(result), wordBudget: 10,
  });
  assert.match(req, /over the 10-word read budget/);
  assert.match(req, /flagged excerpts only/);
  assert.doesNotMatch(req, /## Full transcript/);
});

test('a flagged line reaches the review with its neighbours for context', () => {
  const segments = scored([
    [0, 4, 'Before the hard bit.'], [4, 8, 'The hard bit itself.', -1.3], [8, 12, 'After the hard bit.'],
  ]);
  const req = buildReviewRequest({
    title: 'Q3', result: { ...result, segments }, issues: detectIssues({ segments }), wordBudget: 0,
  });
  assert.match(req, /in context: Before the hard bit\. The hard bit itself\. After the hard bit\./);
});

test('a title too long to be one phrase still meets the speech at the program name', () => {
  const issues = detectIssues({
    title: 'About New York Life Foundation’s Grief-Sensitive Schools Initiative®',
    segments: segs([63, 71, 'In 2018 we developed the Grief Senses Schools Initiative, a program.']),
  });
  const hit = issues.variants.find((g) => g.forms.some((f) => /Senses/.test(f.phrase)));
  assert.ok(hit, 'the mangled program name must be grouped with the title spelling');
  assert.ok(hit.forms.some((f) => /Grief-Sensitive Schools Initiative/.test(f.phrase)),
    'and the title spelling is the one it is grouped against');
});

test('a scoreless run is flagged at the run level, not just noted inside PART 3', () => {
  const issues = detectIssues({ segments: segs([0, 4, 'plain segment.'], [4, 8, 'another one.']) });
  assert.equal(issues.scored, false);
  assert.ok(issues.run.some((r) => /no per-segment confidence/i.test(r)),
    'an unchecked transcript must not be indistinguishable from a checked, clean one');
});

test('the caller saying it already keeps detectIssues from saying it twice', () => {
  const warnings = ['This build returned no per-segment confidence scores — nothing could be flagged mechanically.'];
  const issues = detectIssues({ segments: segs([0, 4, 'plain segment.']), warnings });
  const said = issues.run.filter((r) => /no per-segment confidence/i.test(r));
  assert.equal(said.length, 1, 'one phrasing of one fact');
});

test('a scored run says nothing about missing scores', () => {
  const issues = detectIssues({ segments: scored([[0, 4, 'clear speech here.']]) });
  assert.equal(issues.scored, true);
  assert.ok(!issues.run.some((r) => /no per-segment confidence/i.test(r)));
});

test('_meta.md records the decode settings, so two runs can be told apart', () => {
  const md = buildMetaMd({
    source: 'https://cdn.test/talk.mp4', bytes: 2048,
    result: {
      duration: 61, model: 'small', device: 'cpu', compute_type: 'int8',
      language: 'en', language_probability: 1, transcribe_seconds: 9, segments: [],
      decode: { beam_size: 5, temperature: 0, condition_on_previous_text: false },
      faster_whisper: '1.2.1',
    },
    warnings: [],
  });
  assert.match(md, /beam_size 5/, 'the beam width belongs in the record');
  assert.match(md, /temperature 0/, 'so does the temperature, which is what pins the decode');
  assert.match(md, /condition_on_previous_text off/);
  assert.match(md, /faster-whisper 1\.2\.1/, 'the build decides whether the payload carries scores at all');
  assert.match(md, /not guaranteed to reproduce/i, 'and the honest caveat travels with them');
});

test('_meta.md stays readable when the engine did not report its settings', () => {
  const md = buildMetaMd({
    source: '/local/talk.mp4',
    result: {
      duration: 61, model: 'small', device: 'cpu', compute_type: 'int8',
      language: 'en', language_probability: 1, transcribe_seconds: 9, segments: [],
    },
    warnings: [],
  });
  assert.ok(!/Decode:/.test(md), 'no settings, no half-empty settings line');
});

// ---- artifact verification -----------------------------------------------------

const stage = (over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-verify-'));
  const result = {
    duration: 30, model: 'small', device: 'cpu', compute_type: 'int8',
    language: 'en', language_probability: 1, transcribe_seconds: 9,
    segments: segs([0, 10, 'First thing said.'], [10, 20, 'Second thing said.']),
  };
  const common = { source: 'https://cdn.test/a.mp4', slug: 'a-talk', title: 'A Talk', fetchedAt: '2026-08-25' };
  writeFileSync(join(dir, 'index.md'), buildIndexMd({ ...common, result }));
  writeFileSync(join(dir, 'segments.json'), JSON.stringify(result));
  writeFileSync(join(dir, '_meta.md'), buildMetaMd({ ...common, result, warnings: [] }));
  writeFileSync(join(dir, 'transcript.txt'), buildReportTxt({
    ...common, result, warnings: [], issues: detectIssues({ ...result, warnings: [] }),
  }));
  for (const [name, body] of Object.entries(over)) {
    if (body === null) rmSync(join(dir, name), { force: true });
    else writeFileSync(join(dir, name), body);
  }
  return dir;
};

test('a complete verbatim artifact set verifies clean', () => {
  const v = verifyArtifacts(stage());
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
});

test('the missing report is caught — that is the whole point of verifying', () => {
  const v = verifyArtifacts(stage({ 'transcript.txt': null }));
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /transcript\.txt/.test(p) && /missing/i.test(p)));
});

test('an empty file is as missing as an absent one', () => {
  const v = verifyArtifacts(stage({ 'index.md': '' }));
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /index\.md/.test(p) && /empty/i.test(p)));
});

test('a hand-written report is caught by the absence of the script\'s own scaffolding', () => {
  const v = verifyArtifacts(stage({
    'transcript.txt': 'TRANSCRIPT\n\nPART 3 - LIKELY TRANSCRIPTION ERRORS\n\nsome prose\n\nPART 4 - KEY FACTS\n',
  }));
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /by hand|not.*produced by the script/i.test(p)),
    'a report the script never wrote must not pass as one it did');
});

test('a segment count that disagrees between files means a stale copy', () => {
  const dir = stage();
  const stale = JSON.parse(readFileSync(join(dir, 'segments.json'), 'utf8'));
  stale.segments = stale.segments.slice(0, 1);
  writeFileSync(join(dir, 'segments.json'), JSON.stringify(stale));
  const v = verifyArtifacts(dir);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /segment count/i.test(p)),
    'copying half a run into place is exactly the failure this catches');
});

test('an unreviewed report is reported as unfinished, not as broken', () => {
  const v = verifyArtifacts(stage());
  assert.equal(v.ok, true, 'a pending review is not a corrupt artifact set');
  assert.equal(v.reviewed, false);
  assert.ok(v.notes.some((n) => /review/i.test(n)));
});

test('a descriptive set is held to the descriptive files too', () => {
  const dir = stage({ 'transcript.md': '# A Talk\n\ndescriptive body\n' });
  const v = verifyArtifacts(dir);
  assert.equal(v.descriptive, true);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /outline\.json/.test(p)),
    'a descriptive transcript with no outline behind it was assembled from something else');
});

// ---- publisher captions --------------------------------------------------------

const VTT = `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0

466c7f52-5cb4-4a2c-9787-5d6fdbc17576
00:00.000 --> 00:02.845 align:middle line:84%
In 2008, the New
York Life Foundation

bef2d799-2391-43bb-a2c9-5a75c3084d68
00:02.845 --> 00:06.030 align:middle line:90%
established childhood bereavement
as a philanthropic focus.

32cd8a73-27d9-474b-991a-96f14374ab27
00:17.450 --> 00:20.990 align:middle line:84%
lose by death a parent or sibling.
`;

const SRT = `1
00:00:00,000 --> 00:00:02,845
In 2008, the New
York Life Foundation

2
00:00:02,845 --> 00:00:06,030
established childhood bereavement.
`;

test('WebVTT cues parse with their times, cue ids and positioning stripped', () => {
  const { format, cues } = parseCaptions(VTT);
  assert.equal(format, 'vtt');
  assert.equal(cues.length, 3);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].end, 2.845);
  assert.equal(cues[0].text, 'In 2008, the New York Life Foundation',
    'a cue wrapped across two lines is one cue, and align:/line: are not text');
  assert.equal(cues[2].start, 17.45);
});

test('SRT parses too — a publisher hands over whichever it has', () => {
  const { format, cues } = parseCaptions(SRT);
  assert.equal(format, 'srt');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].end, 2.845, 'comma decimals are still decimals');
});

test('junk is rejected rather than parsed into an empty transcript', () => {
  assert.equal(parseCaptions('<html><body>Not found</body></html>'), null);
  assert.equal(parseCaptions(''), null);
});

test('fragment cues are rejoined into sentences that carry the opening timestamp', () => {
  const segments = captionSegments(parseCaptions(VTT).cues);
  assert.equal(segments[0].text, 'In 2008, the New York Life Foundation established childhood bereavement as a philanthropic focus.');
  assert.equal(segments[0].start, 0, 'the sentence starts when its first cue did');
  assert.equal(segments[1].text, 'lose by death a parent or sibling.');
  assert.equal(segments[1].start, 17.45);
});

test('the captions catch the mishearing no confidence score can', () => {
  const asr = segs([17, 22, 'will lose, by depth, a parent or a sibling.']);
  const cap = segs([17, 22, 'will lose by death a parent or a sibling.']);
  const found = diffTranscripts(asr, cap);
  assert.equal(found.length, 1);
  assert.equal(found[0].at, '0:17');
  assert.match(found[0].asr, /depth/);
  assert.match(found[0].captions, /death/);
});

test('punctuation and casing are not disagreements', () => {
  const asr = segs([0, 5, 'When, in fact, that is a Misconception.']);
  const cap = segs([0, 5, 'when in fact that is a misconception']);
  assert.deepEqual(diffTranscripts(asr, cap), [],
    'flagging these would bury the real findings');
});

test('a run of differing words is one finding, not one finding per word', () => {
  const asr = segs([36, 44, 'they formed the Coalition to Support Grieving Students.']);
  const cap = segs([36, 44, 'they formed the Coalition to Help Bereaved Students.']);
  const found = diffTranscripts(asr, cap);
  assert.equal(found.length, 1, 'adjacent differences belong in one entry');
  assert.equal(found[0].asr, 'Support Grieving');
  assert.equal(found[0].captions, 'Help Bereaved');
});

test('a caption line the recognizer dropped entirely is reported as missing speech', () => {
  const asr = segs([0, 5, 'one two three.']);
  const cap = segs([0, 5, 'one two extra words here three.']);
  const found = diffTranscripts(asr, cap);
  assert.equal(found.length, 1);
  assert.equal(found[0].asr, '');
  assert.match(found[0].captions, /extra words here/);
});

test('index.md prefers the publisher captions and says so in its frontmatter', () => {
  const result = {
    duration: 30, model: 'small', language: 'en',
    segments: segs([0, 10, 'will lose, by depth, a parent.']),
  };
  const md = buildIndexMd({
    source: 'https://cdn.test/a.mp4', slug: 'a-talk', title: 'A Talk', fetchedAt: '2026-08-25',
    result, captionSegments: segs([0, 10, 'will lose by death a parent.']),
  });
  assert.match(md, /text_source: publisher-captions/);
  assert.match(md, /captions: publisher-captions\.vtt/);
  assert.match(md, /by death/, 'the publisher wrote this one; the recognizer only guessed');
  assert.ok(!/by depth/.test(md), 'the guess must not be what downstream reads');
});

test('index.md says plainly when it is only the recognizer talking', () => {
  const result = { duration: 30, model: 'small', language: 'en', segments: segs([0, 10, 'a line.']) };
  const md = buildIndexMd({ source: 'https://cdn.test/a.mp4', slug: 'a', title: 'A', fetchedAt: '2026-08-25', result });
  assert.match(md, /text_source: speech-recognition/);
  assert.ok(!/captions:/.test(md));
});

test('PART 3 leads with the caption disagreements — they are the checkable ones', () => {
  const result = {
    duration: 30, model: 'small', device: 'cpu', compute_type: 'int8', language: 'en',
    language_probability: 1, transcribe_seconds: 4,
    segments: segs([17, 22, 'will lose, by depth, a parent.']),
  };
  const txt = buildReportTxt({
    source: 'https://cdn.test/a.mp4', slug: 'a', title: 'A', fetchedAt: '2026-08-25',
    result, warnings: [], issues: detectIssues({ ...result, warnings: [] }),
    captionDiff: diffTranscripts(result.segments, segs([17, 22, 'will lose by death a parent.'])),
  });
  assert.match(txt, /PUBLISHER'S OWN CAPTIONS/);
  assert.match(txt, /depth/);
  assert.match(txt, /death/);
});

test('a Brightcove player page is recognized and its ids pulled out', () => {
  const ref = brightcoveRef('https://players.brightcove.net/75123740001/2PUrdsPSa5_default/index.html?videoId=6342533385112');
  assert.deepEqual(ref, { account: '75123740001', player: '2PUrdsPSa5_default', videoId: '6342533385112' });
});

test('a plain media URL is not mistaken for a player page', () => {
  assert.equal(brightcoveRef('https://cdn.example.com/media/main.mp4'), null);
  assert.equal(brightcoveRef('/local/file.mp4'), null);
});

test('caption artifacts are verified as a set, not one at a time', () => {
  const dir = stage();
  writeFileSync(join(dir, 'caption-diff.json'), JSON.stringify({ differences: [] }));
  const v = verifyArtifacts(dir);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /publisher-captions\.vtt/.test(p)),
    'a diff with no captions behind it is half a run');
});

test('index.md claiming caption provenance must have the captions to show for it', () => {
  const dir = stage();
  writeFileSync(join(dir, 'publisher-captions.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n');
  writeFileSync(join(dir, 'caption-diff.json'), JSON.stringify({ differences: [] }));
  const v = verifyArtifacts(dir);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /text_source/.test(p)),
    'index.md still says speech-recognition while a caption track sits beside it');
});

test('a hyphen is a typographic choice, not a disagreement about the words', () => {
  const asr = segs([0, 5, 'it is not a one-time event for grief-sensitive schools.']);
  const cap = segs([0, 5, 'it is not a one time event for grief sensitive schools.']);
  assert.deepEqual(diffTranscripts(asr, cap), [],
    'six spurious findings train a reader to skim past the real ones');
});

test('a difference inside a hyphenated word is still caught, and shown whole', () => {
  const asr = segs([63, 71, 'we developed the Grief Senses Schools Initiative.']);
  const cap = segs([63, 71, 'we developed the Grief-Sensitive Schools Initiative.']);
  const found = diffTranscripts(asr, cap);
  assert.equal(found.length, 1);
  assert.match(found[0].captions, /Grief-Sensitive/, 'the whole word is what the reader needs to see');
  assert.match(found[0].asr, /Senses/);
});

test('ingesting a caption file stores it verbatim and records the disagreements', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-captions-'));
  const vttPath = join(dir, 'src.vtt');
  writeFileSync(vttPath, `WEBVTT

00:17.450 --> 00:20.990
lose by death a parent or sibling.
`);
  const warnings = [];
  const asr = segs([17, 22, 'lose by depth a parent or sibling.']);
  const out = await ingestCaptions({ captionsUrl: vttPath, outDir: dir, asrSegments: asr, warnings });

  assert.equal(out.captions.length, 1);
  assert.equal(out.diff.length, 1);
  assert.match(readFileSync(join(dir, 'publisher-captions.vtt'), 'utf8'), /^WEBVTT/,
    'the track is kept exactly as the publisher wrote it');
  const recorded = JSON.parse(readFileSync(join(dir, 'caption-diff.json'), 'utf8'));
  assert.equal(recorded.format, 'vtt');
  assert.equal(recorded.cues, 1);
  assert.match(recorded.differences[0].asr, /depth/);
  assert.ok(warnings.some((w) => /disagrees with the recognizer in 1 place/.test(w)));
});

test('an unusable caption file warns and leaves the run standing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-captions-'));
  writeFileSync(join(dir, 'src.vtt'), '<html>404</html>');
  const warnings = [];
  const out = await ingestCaptions({
    captionsUrl: join(dir, 'src.vtt'), outDir: dir, asrSegments: segs([0, 4, 'a line.']), warnings,
  });
  assert.equal(out.captions, null);
  assert.ok(warnings.some((w) => /could not be used/.test(w) && /nothing to check it against/.test(w)));
  assert.ok(!existsSync(join(dir, 'publisher-captions.vtt')), 'nothing half-written is left behind');
});

test('no caption track is not an error, just no second opinion', async () => {
  const out = await ingestCaptions({ captionsUrl: null, outDir: mkdtempSync(join(tmpdir(), 'twt-c-')), asrSegments: [] });
  assert.deepEqual(out, { captions: null, diff: null });
});

// ---- several sources at once ---------------------------------------------------

import { expandSources, collectBatchEntries, buildBatchIndexMd } from '../skills/twt-content-fetch-video/tools/transcribe-video.mjs';
import { mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// A fake filesystem, so source expansion is tested without laying down media.
// Keys are absolute paths in the platform's own shape — expandSources resolves
// every path it touches, so anything else would miss on Windows.
const P = (...parts) => resolve(join(tmpdir(), ...parts));
const fakeFs = (tree) => ({
  statSync(p) {
    if (!(p in tree)) throw new Error('ENOENT');
    return { isDirectory: () => Array.isArray(tree[p]), isFile: () => !Array.isArray(tree[p]) };
  },
  readdirSync(p) { return tree[p]; },
});

test('a URL passes through untouched — it is never probed on disk', () => {
  const out = expandSources(['https://cdn.example.com/talk.mp4'], fakeFs({}));
  assert.deepEqual(out, ['https://cdn.example.com/talk.mp4']);
});

test('a directory expands to the media directly inside it, in a stable order', () => {
  const tree = {
    [P('vids')]: ['zeta.mp4', 'alpha.mov', 'notes.txt', 'nested'],
    [P('vids', 'zeta.mp4')]: 1, [P('vids', 'alpha.mov')]: 1,
    [P('vids', 'notes.txt')]: 1, [P('vids', 'nested')]: [],
  };
  const out = expandSources([P('vids')], fakeFs(tree));
  assert.equal(out.length, 2, 'notes.txt is not media and nested/ is not descended into');
  assert.equal(basename(out[0]), 'alpha.mov', 'sorted, so a re-run transcribes in the same order');
  assert.equal(basename(out[1]), 'zeta.mp4');
});

test('a directory holding no media is a stop, not a silent empty batch', () => {
  const tree = { [P('empty')]: ['readme.md'], [P('empty', 'readme.md')]: 1 };
  assert.throws(() => expandSources([P('empty')], fakeFs(tree)), (err) => {
    assert.equal(err.code, 2);
    assert.match(err.lines.join(' '), /No media files directly inside/);
    assert.match(err.lines.join(' '), /subdirectories are not searched/);
    return true;
  });
});

test('a missing path stops before anything is transcribed', () => {
  assert.throws(() => expandSources([P('nope.mp4')], fakeFs({})), (err) => {
    assert.equal(err.code, 2);
    assert.match(err.message, /No such file or directory/);
    return true;
  });
});

test('a file named both directly and through its folder is transcribed once', () => {
  const tree = { [P('vids')]: ['a.mp4'], [P('vids', 'a.mp4')]: 1 };
  const out = expandSources([P('vids'), P('vids', 'a.mp4')], fakeFs(tree));
  assert.equal(out.length, 1, 'the same media must not land in the same slug twice');
});

// ---- the batch index -----------------------------------------------------------

// Two recordings on disk: one with its descriptive transcript assembled, one without.
function batchRoot() {
  const root = mkdtempSync(join(tmpdir(), 'twt-batch-'));
  mkdirSync(join(root, 'kickoff'));
  writeFileSync(join(root, 'kickoff', 'index.md'),
    '---\nsource: https://x/kickoff.mp4\ntitle: Kickoff call\nduration: 0:42:10\n'
    + 'language: en\nmodel: small\nsegments: 412\ntext_source: publisher-captions\n---\n# Kickoff call\n');
  writeFileSync(join(root, 'kickoff', 'transcript.md'),
    '---\ntitle: Kickoff call\nspeakers_named: 3\nspeakers_unnamed: 1\n---\n# Kickoff call\n');
  mkdirSync(join(root, 'interview'));
  writeFileSync(join(root, 'interview', 'index.md'),
    '---\nsource: /media/interview.mov\ntitle: Interview\nduration: 0:12:00\n'
    + 'language: uk\nmodel: base\nsegments: 90\ntext_source: speech-recognition\n---\n# Interview\n');
  return root;
}

test('the batch index reads what is on disk now, not what the run reported', () => {
  const root = batchRoot();
  const entries = collectBatchEntries(root, ['kickoff', 'interview']);
  assert.equal(entries[0].descriptive.speakers_named, '3');
  assert.equal(entries[1].descriptive, null, 'interview has no transcript.md yet');
  const md = buildBatchIndexMd({ entries, fetchedAt: '2026-08-26' });

  assert.match(md, /2 recordings, 1 of them with a descriptive transcript assembled/);
  assert.match(md, /\[transcript\.md\]\(kickoff\/transcript\.md\) — 3 named, 1 identified by role only/);
  assert.match(md, /interview[\s\S]*not assembled yet/,
    'a missing descriptive transcript is stated, never quietly omitted');
  assert.match(md, /publisher's own caption track/);
  assert.match(md, /no caption track to check it against/);
  rmSync(root, { recursive: true, force: true });
});

test('a slug whose directory went missing is named, not skipped', () => {
  const root = batchRoot();
  const md = buildBatchIndexMd({
    entries: collectBatchEntries(root, ['kickoff', 'deleted-one']), fetchedAt: '2026-08-26',
  });
  assert.match(md, /Directories this index expected but did not find/);
  assert.match(md, /`deleted-one\/` — no `index\.md`/);
  rmSync(root, { recursive: true, force: true });
});

test('a source that failed is carried into the index rather than vanishing', () => {
  const root = batchRoot();
  const md = buildBatchIndexMd({
    entries: collectBatchEntries(root, ['kickoff']), fetchedAt: '2026-08-26',
    failed: [{ source: 'https://x/gone.mp4', error: 'Could not download the source: 404' }],
  });
  assert.match(md, /1 source failed/);
  assert.match(md, /Sources that failed[\s\S]*gone\.mp4 — Could not download/);
  rmSync(root, { recursive: true, force: true });
});

test('the index falls back to a speaker total when the transcript counts only that', () => {
  const root = batchRoot();
  writeFileSync(join(root, 'interview', 'transcript.md'), '---\ntitle: Interview\nspeakers: 7\n---\n');
  const md = buildBatchIndexMd({ entries: collectBatchEntries(root, ['interview']), fetchedAt: '2026-08-26' });
  assert.match(md, /transcript\.md\) — 7 speakers/);
  rmSync(root, { recursive: true, force: true });
});

// ---- verify insists on the descriptive transcript --------------------------------

// A directory that passes every pre-existing check, so each assertion below is
// isolated to the transcript.md rule it is testing.
function descriptiveDir(prose) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-verify-desc-'));
  writeFileSync(join(dir, 'index.md'), '---\ntitle: T\nduration: 0:02:50\nsegments: 1\n---\n');
  writeFileSync(join(dir, 'segments.json'), JSON.stringify({ segments: [{ start: 0, end: 1, text: 'a' }] }));
  writeFileSync(join(dir, '_meta.md'), '**Segments:** 1');
  writeFileSync(join(dir, 'transcript.txt'),
    `PART 1 - x\nPART 2 - TIMESTAMPED SEGMENTS (all 1 items)\nPART 3 - POSSIBLE ISSUES\n${REVIEW_HEADING}\nfound nothing\nEND OF REPORT`);
  writeFileSync(join(dir, 'media.json'), JSON.stringify({ has_video: false }));
  writeFileSync(join(dir, 'outline.json'), JSON.stringify({ windows: [] }));
  if (prose !== null) writeFileSync(join(dir, 'transcript.md'), prose);
  return dir;
}

const GOOD_PROSE = '---\ntitle: T\nduration: 0:02:50\n---\n\n## Transcript\n\n### [0:00] Opening\n\n**Maria:** hello.\n';

test('a finished descriptive pass verifies clean', () => {
  const dir = descriptiveDir(GOOD_PROSE);
  const v = verifyArtifacts(dir, { expectDescriptive: true });
  assert.deepEqual(v.problems, []);
  rmSync(dir, { recursive: true, force: true });
});

test('a missing transcript.md is a note during the run and a problem once the pass is claimed done', () => {
  const dir = descriptiveDir(null);
  assert.ok(verifyArtifacts(dir).ok, 'run-time verify must not fail before the model has written it');
  assert.ok(verifyArtifacts(dir).notes.some((n) => /has not been assembled/.test(n)));

  const strict = verifyArtifacts(dir, { expectDescriptive: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.problems.some((p) => /the deliverable, not an optional extra/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

test('descriptive detail lifted out of the timeline is caught', () => {
  const dir = descriptiveDir('---\nduration: 0:02:50\n---\n\n## Summary\n\nA video.\n\n## Visual descriptions\n\n- fade up\n');
  const v = verifyArtifacts(dir, { expectDescriptive: true });
  assert.ok(v.problems.some((p) => /no `## Transcript` section/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

test('a timeline with no timestamps is caught', () => {
  const dir = descriptiveDir('---\nduration: 0:02:50\n---\n\n## Transcript\n\n### Opening\n\n**Maria:** hello.\n');
  const v = verifyArtifacts(dir, { expectDescriptive: true });
  assert.ok(v.problems.some((p) => /no `### \[mm:ss\]` heading/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

test('a transcript.md describing a different recording is caught', () => {
  const dir = descriptiveDir(GOOD_PROSE.replace('0:02:50', '1:14:02'));
  const v = verifyArtifacts(dir, { expectDescriptive: true });
  assert.ok(v.problems.some((p) => /describe different recordings/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});
