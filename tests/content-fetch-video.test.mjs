import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  slugify, extFromContentType, fmtTime, paragraphize, buildIndexMd, buildMetaMd, titleFrom,
  redactUrl, sourceLabel, isGenericName, detectIssues, properPhrases, buildReportTxt,
  spliceReview, buildReviewRequest, REPORT_WIDTH, REVIEW_HEADING, verifyArtifacts,
  parseCaptions, captionSegments, diffTranscripts, brightcoveRef, ingestCaptions,
  parseTranscriptBlocks, beatsFromBlocks, referenceWords, anchorBeats, writeTimeline,
  TIMELINE_FILE, splitSpeechBeats, WCAG_FILE, splitDelivery,
  splitCueText, wrapCue, cuesFromSegments, formatVttTime, buildVtt, captionOrigin,
  writeSubtitles, subtitleWarnings, captionSourceLine, ORIGIN_TEXT, SUBTITLE_FILE, SRT_FILE,
  buildSrt, formatSrtTime, buildSpeechMd, buildSpeechTxt, speechParagraphs, buildWcagText,
  speakerCards, speakerRoster, buildSpeakersMd, cuesFromBeats, buildChaptersVtt, fileMapLines,
  SPEECH_MD_FILE, SPEECH_TXT_FILE, SPEAKERS_FILE, WCAG_TEXT_FILE, DESCRIPTIONS_FILE,
  CHAPTERS_FILE, DATA_DIR, dataPath, artifactPath, readArtifact, writeData, migrateFlatArtifacts,
  buildWcagTranscription, DEFAULT_MODEL, BELOW_DEFAULT, MODELS, modelIsCached,
  CUE_MAX_CHARS, CUE_LINE_CHARS, CUE_MIN_SECONDS, CUE_MAX_SECONDS,
  fmtBytes, mediaProfile, sourceLine, extractedLine, longRunNote, prepareAudio,
  LONG_RUN_SECONDS,
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
  assert.match(md, /captions: captions\.vtt/);
  assert.match(md, /by death/, 'the publisher wrote this one; the recognizer only guessed');
  assert.ok(!/by depth/.test(md), 'the guess must not be what downstream reads');
});

test('index.md says plainly when it is only the recognizer talking', () => {
  const result = { duration: 30, model: 'small', language: 'en', segments: segs([0, 10, 'a line.']) };
  const md = buildIndexMd({ source: 'https://cdn.test/a.mp4', slug: 'a', title: 'A', fetchedAt: '2026-08-25', result });
  assert.match(md, /text_source: speech-recognition/);
  // The caption file still exists — the recognizer wrote it. What changes is the
  // claim: text_source says whose words these are, and _meta.md says who cut the cues.
  assert.match(md, /captions: captions\.vtt/);
  assert.ok(!/publisher/.test(md));
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
  assert.match(readFileSync(dataPath(dir, 'publisher-captions.vtt'), 'utf8'), /^WEBVTT/,
    'the track is kept exactly as the publisher wrote it');
  assert.equal(out.track.format, 'vtt');
  assert.ok(!existsSync(join(dir, 'publisher-captions.vtt')),
    'the machine files live under data/ so the directory listing shows only what is read');
  const recorded = JSON.parse(readFileSync(dataPath(dir, 'caption-diff.json'), 'utf8'));
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
  writeSubtitles({ outDir: dir, source: 'a.mp4',
    result: { model: 'small', duration: 170, segments: [{ start: 0, end: 1, text: 'a' }] } });
  if (prose !== null) {
    writeFileSync(join(dir, 'transcript.md'), prose);
    // Built after the prose, as a real run does — the staleness check compares mtimes.
    writeTimeline(dir);
  }
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

// ---- the single-stream timeline ---------------------------------------------------

const TL_PROSE = [
  '---', 'title: T', 'duration: 0:02:50', '---', '',
  '# T', '',
  '## Summary', '', 'Not part of the timeline.', '',
  '## Transcript', '',
  '### [0:00] Opening', '',
  '[Visual: fade up from black onto a woman against a lit blue',
  'studio backdrop.]', '',
  '[On screen: name card — "Maria Collins / Vice President".]', '',
  '**Maria Collins:** In 2008, the New York Life Foundation established',
  'childhood bereavement as a philanthropic focus.', '',
  '### [0:29] The Coalition', '',
  '**David Schonfeld:** *(voice-over, then on camera)* Together, our organizations formed the Coalition.', '',
  '[No speech 2:44–2:50 — the end card holds in silence.]', '',
  '## References', '', '- Something cited.', '',
].join('\n');

// Times chosen so a naive "first segment" match and a correct one differ.
const TL_SEGMENTS = [
  { start: 0.0, end: 11.0, text: 'In 2008, the New York Life Foundation established childhood bereavement as a philanthropic focus.' },
  { start: 29.15, end: 38.1, text: 'Together, our organizations formed the Coalition.' },
];

function timelineDir(prose = TL_PROSE, segments = TL_SEGMENTS) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-timeline-'));
  writeFileSync(join(dir, 'index.md'),
    '---\nsource: https://example.com/v.mp4\ntitle: T\nduration: 0:02:50\nlanguage: en\nfetched_at: 2026-08-26\n---\n');
  writeFileSync(join(dir, 'segments.json'), JSON.stringify({ segments }));
  writeFileSync(join(dir, 'transcript.md'), prose);
  return dir;
}

test('the transcript section is split into markers, speech and chapters — and nothing outside it is', () => {
  const blocks = parseTranscriptBlocks(TL_PROSE);
  const kinds = blocks.map((b) => b.kind);
  assert.deepEqual(kinds, ['chapter', 'marker', 'marker', 'speech', 'chapter', 'speech', 'nospeech']);
  // The Summary above and the References below must not leak into the timeline.
  assert.ok(!blocks.some((b) => /Not part of the timeline|Something cited/.test(b.text || b.speech || '')));
  // A marker hard-wrapped over two source lines is one marker, on one line.
  assert.equal(blocks[1].text, '[Visual: fade up from black onto a woman against a lit blue studio backdrop.]');
});

test('markers attach to the speech line they introduce', () => {
  const { beats, chapters } = beatsFromBlocks(parseTranscriptBlocks(TL_PROSE));
  assert.equal(chapters.length, 2);
  assert.equal(beats[0].kind, 'speech');
  assert.equal(beats[0].speaker, 'Maria Collins');
  assert.equal(beats[0].markers.length, 2, 'both markers belong to the line they precede');
  assert.equal(beats[1].markers.length, 0);
});

test('a beat is timed from the recording, not from the chapter heading above it', () => {
  const dir = timelineDir();
  const out = writeTimeline(dir);
  assert.equal(out.ok, true);
  assert.deepEqual(out.unmatched, []);
  const md = readFileSync(join(dir, TIMELINE_FILE), 'utf8');
  // Schonfeld's line sits under a [0:29] chapter and starts at 29.15 — both
  // round to 0:29, so this asserts the *shape*: every beat carries its own stamp.
  assert.match(md, /^### \[0:00\]$/m);
  assert.match(md, /^### \[0:29\]$/m);
  assert.match(md, /^\*\*Maria Collins:\*\* In 2008/m);
  assert.match(md, /^## Timeline$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('a stage direction does not drag the beat earlier than the line it decorates', () => {
  // "*(voice-over, then on camera)*" is nine words nobody says. Left in the match
  // query it pulls the anchor back into the previous speaker's segment.
  const ref = referenceWords(TL_SEGMENTS);
  const beats = [{ kind: 'speech', speaker: 'David Schonfeld', markers: [], speech: '*(voice-over, then on camera)* Together, our organizations formed the Coalition.' }];
  const { beats: out } = anchorBeats(beats, ref);
  assert.equal(Math.round(out[0].time), 29, 'must land on the line, not on the words about the line');
  assert.ok(!out[0].approx);
});

test('a line that is nowhere in the recording keeps the previous time and says so', () => {
  const dir = timelineDir(TL_PROSE.replace(
    '**David Schonfeld:** *(voice-over, then on camera)* Together, our organizations formed the Coalition.',
    '**David Schonfeld:** Nothing here corresponds to any audio whatsoever, none of it.'));
  const out = writeTimeline(dir);
  assert.equal(out.unmatched.length, 1);
  assert.equal(out.unmatched[0].speaker, 'David Schonfeld');
  assert.match(readFileSync(join(dir, TIMELINE_FILE), 'utf8'), /^### \[\d+:\d\d\] ~$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('the timeline never runs backwards', () => {
  const dir = timelineDir(TL_PROSE, [
    { start: 40, end: 50, text: 'In 2008, the New York Life Foundation established childhood bereavement as a philanthropic focus.' },
    { start: 5, end: 10, text: 'Together, our organizations formed the Coalition.' },
  ]);
  writeTimeline(dir);
  const stamps = [...readFileSync(join(dir, TIMELINE_FILE), 'utf8').matchAll(/^### \[(\d+):(\d\d)\]/gm)]
    .map((m) => Number(m[1]) * 60 + Number(m[2]));
  assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
  rmSync(dir, { recursive: true, force: true });
});

test('the publisher caption track is preferred as the timing reference', () => {
  const dir = timelineDir();
  writeFileSync(join(dir, 'publisher-captions.vtt'),
    'WEBVTT\n\n00:00.000 --> 00:11.000\nIn 2008, the New York Life Foundation established childhood bereavement as a philanthropic focus.\n\n'
    + '00:31.500 --> 00:38.000\nTogether, our organizations formed the Coalition.\n');
  const out = writeTimeline(dir);
  assert.equal(out.reference, 'publisher-captions');
  // 31.5 is the caption's time; segments.json says 29.15. The caption wins.
  assert.match(readFileSync(join(dir, TIMELINE_FILE), 'utf8'), /^### \[0:31\]$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('a transcript with no ## Transcript section cannot produce a timeline', () => {
  const dir = timelineDir('---\ntitle: T\n---\n\n## Summary\n\nNo timeline here.\n');
  const out = writeTimeline(dir);
  assert.equal(out.ok, false);
  assert.match(out.problems[0], /no `## Transcript` section/);
  rmSync(dir, { recursive: true, force: true });
});

test('a missing timeline.md is a note during the run and a problem once the pass is claimed done', () => {
  const dir = descriptiveDir(GOOD_PROSE);
  rmSync(join(dir, TIMELINE_FILE));
  assert.ok(verifyArtifacts(dir).notes.some((n) => /has not been built/.test(n)));
  const strict = verifyArtifacts(dir, { expectDescriptive: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.problems.some((p) => /it is generated, not written/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

test('a timeline older than the transcript it came from is caught', () => {
  const dir = descriptiveDir(GOOD_PROSE);
  // The prose is edited and the timeline is not rebuilt — the only way these two
  // come apart, and the one that leaves the most citable file in the directory stale.
  const future = new Date(Date.now() + 60000);
  utimesSync(join(dir, 'transcript.md'), future, future);
  const v = verifyArtifacts(dir, { expectDescriptive: true });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /older than transcript\.md/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

// ---- a name misread off a keyframe -------------------------------------------------

test('a speaker name with a capital inside a word and no [?] is flagged', () => {
  const dir = descriptiveDir(GOOD_PROSE.replace('**Maria:**', '**TerriyIn Rivers-Cannon:**'));
  const v = verifyArtifacts(dir, { expectDescriptive: true });
  assert.ok(v.notes.some((n) => /TerriyIn Rivers-Cannon/.test(n)), 'the misread must be named');
  assert.deepEqual(v.problems, [], 'it is a note, not a stop — real names can look like this');
  rmSync(dir, { recursive: true, force: true });
});

test('the same name marked [?] is not flagged, and ordinary names never are', () => {
  for (const name of ['TerriyIn Rivers-Cannon [?]', 'Maria Collins', 'David Schonfeld',
    'Jim Arey', 'Eric Rossen', 'Boardroom interviewee A [?]', 'Ronan McDonald', 'Ana DeLuca']) {
    const dir = descriptiveDir(GOOD_PROSE.replace('**Maria:**', `**${name}:**`));
    const v = verifyArtifacts(dir, { expectDescriptive: true });
    assert.ok(!v.notes.some((n) => /capital letter inside a word/.test(n)), `${name} must not be flagged`);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- paragraphs do not run across a speaker change ---------------------------------

test('a handover ends the paragraph even when it would otherwise run on', () => {
  const segments = [
    { start: 0, end: 4, text: 'First speaker says something short.' },
    { start: 6, end: 10, text: 'Second speaker answers.' },
  ];
  const fused = paragraphize(segments);
  assert.equal(fused.length, 1, 'without turn boundaries these fuse — the behaviour being fixed');

  const split = paragraphize(segments, { turnBoundaries: [6] });
  assert.equal(split.length, 2);
  assert.equal(split[1].start, 6, 'the second paragraph is stamped at the handover, not at the window');
});

// ---- the generated caption track ---------------------------------------------------

const norm = (s) => s.replace(/\s+/g, ' ').trim();

test('a line that already fits a caption box is left alone', () => {
  assert.deepEqual(splitCueText('Welcome to the quarterly product review.'),
    ['Welcome to the quarterly product review.']);
  assert.deepEqual(splitCueText(''), []);
});

test('a long line breaks at the last sentence end that fits, not mid-thought', () => {
  const text = 'The payment step now comes before shipping. That cut abandonment by eleven percent across every market we measured.';
  const chunks = splitCueText(text);
  assert.equal(chunks[0], 'The payment step now comes before shipping.');
  for (const c of chunks) assert.ok(c.length <= CUE_MAX_CHARS, `"${c}" is ${c.length} chars`);
  assert.equal(norm(chunks.join(' ')), norm(text), 'no word may be lost in the split');
});

test('with no sentence end in range it falls back to a clause, then to a space', () => {
  const clause = 'fewer form fields before the first commitment, a saved-card path that skips re-entry, and an address step that can fail';
  assert.ok(splitCueText(clause)[0].endsWith(','), 'a clause break is preferred over a bare space');

  const noPunct = filler(40);  // w0 w1 … — no punctuation anywhere
  const chunks = splitCueText(noPunct);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= CUE_MAX_CHARS);
    assert.ok(!/^\s|\s$/.test(c), 'chunks are trimmed');
  }
  assert.equal(norm(chunks.join(' ')), norm(noPunct));
});

test('a single token longer than a whole cue is hard-cut rather than overflowing the box', () => {
  const chunks = splitCueText('x'.repeat(200));
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.length <= CUE_MAX_CHARS);
});

test('a cue wraps to two balanced lines, and a short one does not wrap at all', () => {
  assert.equal(wrapCue('short enough'), 'short enough');
  const wrapped = wrapCue('The payment step now comes before shipping and that changed everything');
  const lines = wrapped.split('\n');
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(l.length <= CUE_LINE_CHARS + 8, `"${l}" is ${l.length} chars`);
  assert.ok(Math.abs(lines[0].length - lines[1].length) < 12, 'the two lines are near-even');
  assert.equal(norm(wrapped.replace('\n', ' ')),
    'The payment step now comes before shipping and that changed everything');
});

test('a short segment becomes one cue keeping the recogniser own timings', () => {
  const cues = cuesFromSegments(segs([3.2, 6.4, 'Welcome to the review.']), { duration: 10 });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 3.2);
  assert.equal(cues[0].end, 6.4);
  assert.equal(cues[0].text, 'Welcome to the review.');
});

test('a long segment is shared out across cues that stay inside it and never overlap', () => {
  const text = 'The payment step now comes before shipping. That cut abandonment by eleven percent across every market. The saved-card path is what did most of it.';
  const cues = cuesFromSegments(segs([10, 22, text]), { duration: 60 });
  assert.ok(cues.length >= 2);
  assert.equal(cues[0].start, 10);
  assert.equal(cues[cues.length - 1].end, 22, 'the last cue ends where the segment does');
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].end > cues[i].start, 'no zero-length cue');
    if (i) assert.ok(cues[i].start >= cues[i - 1].end - 0.001, 'cues never overlap');
  }
  assert.equal(norm(cues.map((c) => c.text).join(' ')), norm(text), 'the words survive intact');
});

test('a flash-by cue is stretched to a readable minimum, but never over its neighbour', () => {
  // Two clipped segments 0.4s apart: the first cannot be stretched a full second.
  const cues = cuesFromSegments(segs([0, 0.3, 'Right.'], [0.4, 3.0, 'So here is the thing.']),
    { duration: 10 });
  assert.ok(cues[0].end <= cues[1].start + 0.001, 'the stretch stops at the next cue');
  assert.ok(cues[0].end > cues[0].start);
  // With room to grow it takes the full minimum.
  const roomy = cuesFromSegments(segs([0, 0.3, 'Right.'], [8, 9, 'Later.']), { duration: 10 });
  assert.equal(roomy[0].end - roomy[0].start, CUE_MIN_SECONDS);
});

test('a cue held past the maximum is clamped — it has stopped tracking the speech', () => {
  const cues = cuesFromSegments(segs([0, 40, 'One short line over a very long segment.']),
    { duration: 60 });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].end - cues[0].start, CUE_MAX_SECONDS);
});

test('WebVTT times are zero-padded to hours and milliseconds', () => {
  assert.equal(formatVttTime(0), '00:00:00.000');
  assert.equal(formatVttTime(3.2), '00:00:03.200');
  assert.equal(formatVttTime(3661.5), '01:01:01.500');
  assert.equal(formatVttTime(9.9999), '00:00:10.000', 'rounding must not produce .1000');
});

test('the generated file parses back with this tool own caption parser', () => {
  const result = { model: 'small', language: 'en',
    segments: segs([0, 4, 'In 2008, the New York Life Foundation established a focus.'],
      [5, 9, 'At least two students in an average classroom will lose a parent.']) };
  const vtt = buildVtt(cuesFromSegments(result.segments, { duration: 12 }),
    { source: 'https://example.com/talk.mp4', result, fetchedAt: '2026-08-26' });
  assert.ok(vtt.startsWith('WEBVTT\n'));
  const parsed = parseCaptions(vtt);
  assert.equal(parsed.format, 'vtt');
  assert.equal(parsed.cues.length, 2, 'the NOTE header is not mistaken for a cue');
  assert.equal(parsed.cues[0].start, 0);
  assert.equal(norm(parsed.cues[0].text), 'In 2008, the New York Life Foundation established a focus.');
});

test('the file itself says the words were guessed from audio', () => {
  const result = { model: 'small', language: 'en', segments: segs([0, 4, 'Hello there.']) };
  const vtt = buildVtt(cuesFromSegments(result.segments, { duration: 5 }),
    { source: 'https://example.com/a.mp4?token=SECRET', result, fetchedAt: '2026-08-26' });
  assert.match(vtt, /^NOTE$/m);
  assert.match(vtt, /speech recognition, not a checked caption track/);
  assert.match(vtt, /model small/);
  assert.ok(!vtt.includes('SECRET'), 'a signed token must not reach the caption file either');
});

test('captions come from the publisher, then the media file, then the recognizer', () => {
  assert.equal(captionOrigin({ publisherCaptions: [{ text: 'x' }], embeddedCues: 9, segments: segs([0, 1, 'a']) }),
    'publisher', 'a person wrote it — nothing else outranks that');
  assert.equal(captionOrigin({ embeddedCues: 42, segments: segs([0, 1, 'a']) }), 'embedded');
  assert.equal(captionOrigin({ embeddedCues: 0, segments: segs([0, 1, 'a']) }), 'generated');
  assert.equal(captionOrigin({ segments: [] }), null, 'nothing said, nothing to caption');
});

test('every recording gets captions.vtt and captions.srt, whoever wrote the words', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-vtt-'));
  const result = { model: 'small', language: 'en', duration: 6,
    segments: segs([0, 4, 'Welcome to the review.']) };
  const out = writeSubtitles({ outDir: dir, source: 'a.mp4', result, fetchedAt: '2026-08-26' });
  assert.equal(out.file, SUBTITLE_FILE);
  assert.equal(out.srt, SRT_FILE);
  assert.equal(out.origin, 'generated');
  assert.ok(existsSync(join(dir, SUBTITLE_FILE)));
  assert.ok(existsSync(join(dir, SRT_FILE)));
  assert.match(readFileSync(join(dir, SUBTITLE_FILE), 'utf8'), /speech recognition, not a checked caption track/);
  const warned = subtitleWarnings({ subtitles: out });
  assert.ok(warned.some((w) => /unchecked machine/.test(w)), 'the user must be told it is unchecked');
  rmSync(dir, { recursive: true, force: true });
});

test("a publisher's WebVTT ships byte for byte under the same name", () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-vtt-'));
  const raw = 'WEBVTT\n\nintro\n00:00:00.000 --> 00:00:04.000 line:90%\nWelcome.\n';
  const parsed = parseCaptions(raw);
  const out = writeSubtitles({ outDir: dir, source: 'a.mp4',
    result: { model: 'small', duration: 6, segments: segs([0, 4, 'Wellcome.']) },
    publisherTrack: { raw, format: 'vtt', cues: parsed.cues, file: 'publisher-captions.vtt' } });
  assert.equal(out.origin, 'publisher');
  assert.equal(readFileSync(join(dir, SUBTITLE_FILE), 'utf8'), raw,
    'a track someone wrote, re-emitted by a formatter, is no longer the track they published');
  assert.match(readFileSync(join(dir, SRT_FILE), 'utf8'), /00:00:00,000 --> 00:00:04,000/);
  assert.ok(!readFileSync(join(dir, SUBTITLE_FILE), 'utf8').includes('Wellcome'),
    "the recognizer's guess must not reach the file the video ships");
  assert.deepEqual(subtitleWarnings({ subtitles: out }), [], 'nothing to warn about a human-authored track');
  rmSync(dir, { recursive: true, force: true });
});

test("a publisher's SRT is converted rather than shipped with a .vtt name on it", () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-vtt-'));
  const raw = '1\n00:00:00,000 --> 00:00:04,000\nWelcome.\n';
  const parsed = parseCaptions(raw);
  assert.equal(parsed.format, 'srt');
  const out = writeSubtitles({ outDir: dir, source: 'a.mp4',
    result: { model: 'small', duration: 6, segments: segs([0, 4, 'Welcome.']) },
    publisherTrack: { raw, format: 'srt', cues: parsed.cues, file: 'publisher-captions.srt' } });
  assert.equal(out.origin, 'publisher');
  const vtt = readFileSync(join(dir, SUBTITLE_FILE), 'utf8');
  assert.match(vtt, /^WEBVTT/, 'a browser <track> will not load a .srt whatever it is called');
  assert.match(vtt, /Converted from the publisher's SRT/);
  assert.match(vtt, /00:00:00\.000 --> 00:00:04\.000/);
  assert.match(vtt, /Welcome\./);
  rmSync(dir, { recursive: true, force: true });
});

test("the media file's own subtitle stream is extracted, not re-guessed", () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-vtt-'));
  const out = writeSubtitles({ outDir: dir, source: 'a.mp4',
    result: { model: 'small', duration: 6, segments: segs([0, 4, 'Wellcome.']) },
    embeddedCues: [{ start: 0, end: 4, text: 'Welcome.' }] });
  assert.equal(out.origin, 'embedded');
  const vtt = readFileSync(join(dir, SUBTITLE_FILE), 'utf8');
  assert.match(vtt, /Extracted from the media file's own subtitle stream/);
  assert.match(vtt, /Welcome\./);
  assert.ok(!vtt.includes('Wellcome'));
  rmSync(dir, { recursive: true, force: true });
});

test('_meta.md names the caption file and says who wrote the words in it', () => {
  assert.match(captionSourceLine({ file: 'captions.vtt', srt: 'captions.srt', cues: 57, origin: 'publisher',
    why: ORIGIN_TEXT.publisher }), /captions\.vtt.*57 cues.*publisher's own track/);
  assert.match(captionSourceLine({ file: 'captions.vtt', srt: 'captions.srt', cues: 12, origin: 'generated',
    why: ORIGIN_TEXT.generated }), /unchecked machine output/);
  assert.match(captionSourceLine({ file: null, why: ORIGIN_TEXT.null }), /^none — no speech/);
});

test('verify rejects a .vtt no player would load, and misses one that is absent', () => {
  const dir = descriptiveDir(GOOD_PROSE);
  writeFileSync(join(dir, SUBTITLE_FILE), 'WEBVTT\n\nthis was written by hand\n');
  const bad = verifyArtifacts(dir, { expectDescriptive: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => /captions\.vtt is not valid WebVTT/.test(p)));

  const result = { model: 'small', language: 'en', duration: 6, segments: segs([0, 4, 'Welcome.']) };
  writeSubtitles({ outDir: dir, source: 'a.mp4', result });
  assert.ok(!verifyArtifacts(dir, { expectDescriptive: true }).problems
    .some((p) => /captions/.test(p)));

  rmSync(join(dir, SUBTITLE_FILE));
  assert.ok(verifyArtifacts(dir).notes.some((n) => /No captions\.vtt/.test(n)),
    'a recording with speech and no caption track is worth saying out loud');
  assert.ok(verifyArtifacts(dir, { expectDescriptive: true }).problems
    .some((p) => /No captions\.vtt/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

test('verify calls out a leftover generated-captions.vtt from an older run', () => {
  const dir = descriptiveDir(GOOD_PROSE);
  writeSubtitles({ outDir: dir, source: 'a.mp4',
    result: { model: 'small', duration: 6, segments: segs([0, 4, 'Welcome.']) } });
  writeFileSync(join(dir, 'generated-captions.vtt'), 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:04.000\nWelcome.\n');
  const v = verifyArtifacts(dir);
  assert.ok(v.notes.some((n) => /generated-captions\.vtt is left over/.test(n)),
    'two caption files beside one video is how the wrong one ships');
  rmSync(dir, { recursive: true, force: true });
});

test('the report says which caption file was written and where its words came from', () => {
  const made = reportOf({ subtitles: { file: 'captions.vtt', srt: 'captions.srt', cues: 41,
    origin: 'generated', why: ORIGIN_TEXT.generated } });
  assert.match(made, /captions\.vtt \+ captions\.srt \(41 cues\)/);
  assert.match(made.replace(/\s+/g, ' '), /unchecked machine output/);
  assert.match(made.replace(/\s+/g, ' '), /Read it against the recording/);

  const published = reportOf({ subtitles: { file: 'captions.vtt', srt: 'captions.srt', cues: 57,
    origin: 'publisher', why: ORIGIN_TEXT.publisher } });
  assert.match(published.replace(/\s+/g, ' '), /the publisher's own track, copied verbatim/);
  assert.ok(!published.includes('Read it against the recording'),
    'a human-authored track needs no health warning');
});

test('SRT is the same cues with a comma and no NOTE block', () => {
  const cues = cuesFromSegments(segs([0, 4, 'Welcome to the review.'], [4, 9, 'Here is what changed.']),
    { duration: 9 });
  const srt = buildSrt(cues);
  assert.match(srt, /^1\n00:00:00,000 --> /);
  assert.match(srt, /\n2\n00:00:04,000 --> /);
  assert.ok(!srt.includes('NOTE'), 'SRT has no comment syntax — a NOTE line would render as a caption');
  assert.equal(formatSrtTime(3661.5), '01:01:01,500');
});

// ---- sentence-level beats, the WCAG table, and the re-stamped index ---------------

// A speech line as the descriptive pass writes it: several sentences under one
// speaker, with the markers that set it up. The txt report splits the same speech
// into one timestamped row per recognizer segment, and the timeline is meant to be
// no coarser than that.
const GRANULAR_PROSE = [
  '---', 'title: T', 'duration: 0:00:45', '---', '',
  '## Transcript', '',
  '### [0:00] Why a life insurer took this on', '',
  '[Visual: fade up from black onto a woman against a lit blue backdrop.]', '',
  '[On screen: name card — "Maria Collins / Vice President / New York Life Foundation".]', '',
  '**Maria Collins:** In 2008, the New York Life Foundation established childhood bereavement'
    + ' as a philanthropic focus. This was and is a natural extension of who we are as a life'
    + ' insurance company. The unfortunate reality is that at least two students will lose a parent.', '',
  // A marker that closes one chapter and sets up the next sits *before* the heading —
  // which is what used to emit a beat of its own at the same second as the line below it.
  '[Visual: cut to exterior footage of a school at dusk.]', '',
  '### [0:22] Forming the coalition', '',
  '[Visual: cut to a man in a dark suit and red tie.]', '',
  '**David Schonfeld:** Together, our organizations formed the Coalition to Support Grieving'
    + ' Students. An alliance dedicated to developing professional materials.', '',
  '[No speech 0:40–0:45 — the end card holds in silence.]', '',
].join('\n');

const GRANULAR_REF = segs(
  [0, 6, 'In 2008, the New York Life Foundation established childhood bereavement as a philanthropic focus.'],
  [6, 11, 'This was and is a natural extension of who we are as a life insurance company.'],
  [11, 22, 'The unfortunate reality is that at least two students will lose a parent.'],
  [22.6, 30, 'Together, our organizations formed the Coalition to Support Grieving Students.'],
  [30, 40, 'An alliance dedicated to developing professional materials.'],
);

function granularDir() {
  const dir = mkdtempSync(join(tmpdir(), 'twt-granular-'));
  writeFileSync(join(dir, 'index.md'),
    '---\nsource: https://example.com/v.mp4\ntype: video\ntitle: T\nduration: 0:00:45\n'
    + 'language: en\nengine: faster-whisper\nmodel: small\ntext_source: publisher-captions\n'
    + 'segments: 5\nfetched_at: 2026-08-26\n---\n\n# T\n\n**[0:00]** everything in one lump.\n');
  writeFileSync(join(dir, 'segments.json'), JSON.stringify({ segments: GRANULAR_REF }));
  writeFileSync(join(dir, '_meta.md'), '**Segments:** 5');
  writeFileSync(join(dir, 'transcript.txt'),
    `PART 1 - x\nPART 2 - TIMESTAMPED SEGMENTS (all 5 items)\nPART 3 - POSSIBLE ISSUES\n${REVIEW_HEADING}\nfound nothing\nEND OF REPORT`);
  writeFileSync(join(dir, 'media.json'), JSON.stringify({ has_video: false }));
  writeFileSync(join(dir, 'outline.json'), JSON.stringify({ windows: [] }));
  writeSubtitles({ outDir: dir, source: 'a.mp4',
    result: { model: 'small', duration: 45, segments: GRANULAR_REF } });
  writeFileSync(join(dir, 'transcript.md'), GRANULAR_PROSE);
  return dir;
}

test('a multi-sentence speech block becomes one beat per sentence', () => {
  const blocks = parseTranscriptBlocks(GRANULAR_PROSE);
  const { beats } = beatsFromBlocks(blocks);
  const split = splitSpeechBeats(beats);
  const speech = split.filter((b) => b.kind === 'speech');
  assert.equal(speech.length, 5, 'three sentences from Collins and two from Schonfeld');
  assert.match(speech[0].speech, /^In 2008,/);
  assert.match(speech[1].speech, /^This was and is/);
  assert.equal(speech[0].speaker, 'Maria Collins');
  assert.equal(speech[1].speaker, 'Maria Collins');
});

test('splitting keeps the markers on the sentence they introduced', () => {
  const { beats } = beatsFromBlocks(parseTranscriptBlocks(GRANULAR_PROSE));
  const split = splitSpeechBeats(beats);
  const first = split.find((b) => b.kind === 'speech');
  assert.equal((first.markers || []).length, 2, 'the visual and the name card set up the first sentence');
  const second = split.filter((b) => b.kind === 'speech')[1];
  assert.deepEqual(second.markers || [], [], 'a continuation invents no markers of its own');
  assert.equal(second.continued, true);
});

test('a fragment too short to stand alone stays with the sentence before it', () => {
  const { beats } = beatsFromBlocks(parseTranscriptBlocks(
    '## Transcript\n\n**Jim:** When in fact that is a misconception. A wild misconception.\n'));
  const split = splitSpeechBeats(beats);
  assert.equal(split.filter((b) => b.kind === 'speech').length, 1);
  assert.match(split[0].speech, /A wild misconception\.$/);
});

test('the timeline is no coarser than the report it sits beside', () => {
  const dir = granularDir();
  const r = writeTimeline(dir);
  assert.equal(r.ok, true);
  const md = readFileSync(join(dir, TIMELINE_FILE), 'utf8');
  const stops = (md.match(/^### \[/gm) || []).length;
  assert.ok(stops >= 6, `expected a stop per sentence plus the silence, got ${stops}`);
  // Each sentence carries its own measured time, not the chapter's.
  assert.match(md, /^### \[0:06\]/m);
  assert.match(md, /^### \[0:11\]/m);
  rmSync(dir, { recursive: true, force: true });
});

test('a marker-only beat is folded into the beat it shares a moment with', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const md = readFileSync(join(dir, TIMELINE_FILE), 'utf8');
  const stamps = (md.match(/^### \[[\d:]+\]/gm) || []);
  assert.equal(new Set(stamps).size, stamps.length, `two beats share a timestamp: ${stamps.join(' ')}`);
  rmSync(dir, { recursive: true, force: true });
});

test('writeTimeline emits the WCAG transcription table', () => {
  const dir = granularDir();
  const r = writeTimeline(dir);
  assert.match(r.wcag || '', /wcag-transcription\.json$/);
  const doc = JSON.parse(readFileSync(join(dir, WCAG_FILE), 'utf8'));
  assert.equal(doc.title, 'T');
  assert.ok(Array.isArray(doc.entries));
  const first = doc.entries[0];
  assert.equal(first.time, '0:00');
  assert.equal(first.author, 'Maria Collins');
  assert.match(first.caption, /^In 2008, the New York Life Foundation/);
  assert.deepEqual(first.informative_caption, [
    '[Visual: fade up from black onto a woman against a lit blue backdrop.]',
    '[On screen: name card — "Maria Collins / Vice President / New York Life Foundation".]',
  ]);
  // A silence is an informative caption with nobody speaking.
  const silence = doc.entries.at(-1);
  assert.equal(silence.author, null);
  assert.equal(silence.caption, '');
  assert.match(silence.informative_caption[0], /^\[No speech/);
  rmSync(dir, { recursive: true, force: true });
});

test('the WCAG entries and the timeline beats are the same list', () => {
  const dir = granularDir();
  const r = writeTimeline(dir);
  const doc = JSON.parse(readFileSync(join(dir, WCAG_FILE), 'utf8'));
  assert.equal(doc.entries.length, r.beats);
  rmSync(dir, { recursive: true, force: true });
});

test('index.md is re-stamped with the speakers the descriptive pass named', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const index = readFileSync(join(dir, 'index.md'), 'utf8');
  assert.match(index, /\*\*\[0:00\] Maria Collins:\*\*/);
  assert.match(index, /\*\*\[0:22\] David Schonfeld:\*\*/);
  assert.ok(!index.includes('everything in one lump'), 'the pre-descriptive body is replaced, not appended to');
  // Frontmatter the rest of the tool depends on survives.
  assert.match(index, /^segments: 5$/m);
  assert.match(index, /^text_source: publisher-captions$/m);
  assert.match(index, /^duration: 0:00:45$/m);
  // And it points at the files that carry the rest.
  assert.match(index, /^descriptive: transcript\.md$/m);
  assert.match(index, /^timeline: timeline\.md$/m);
  assert.match(index, /^wcag: wcag-transcription\.json$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('re-stamping index.md is idempotent', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const once = readFileSync(join(dir, 'index.md'), 'utf8');
  writeTimeline(dir);
  assert.equal(readFileSync(join(dir, 'index.md'), 'utf8'), once);
  rmSync(dir, { recursive: true, force: true });
});

test('verify insists on a WCAG table that is not older than the transcript', () => {
  const dir = granularDir();
  writeTimeline(dir);
  assert.deepEqual(verifyArtifacts(dir, { expectDescriptive: true }).problems, []);

  rmSync(join(dir, WCAG_FILE));
  const gone = verifyArtifacts(dir, { expectDescriptive: true });
  assert.equal(gone.ok, false);
  assert.ok(gone.problems.some((p) => /wcag-transcription\.json/.test(p)));

  writeTimeline(dir);
  const past = new Date(Date.now() - 60000);
  utimesSync(join(dir, WCAG_FILE), past, past);
  const stale = verifyArtifacts(dir, { expectDescriptive: true });
  assert.equal(stale.ok, false);
  assert.ok(stale.problems.some((p) => /older than transcript\.md/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

// ---- the fixes to what the tool already wrote -------------------------------------

test('caption paragraphs break on sentence ends when no pause and no handover can be seen', () => {
  // Publisher cues run back to back, and a recognizer with no measurable pauses
  // offers no turn boundaries — the case that flattened an 8-speaker film into
  // four 100-word lumps.
  const contiguous = segs(
    [0, 10, `${filler(45)} one.`],
    [10, 20, `${filler(45)} two.`],
    [20, 30, `${filler(45)} three.`],
  );
  assert.equal(paragraphize(contiguous).length, 1, 'the old behaviour, kept for the ASR path');
  assert.equal(paragraphize(contiguous, { sentenceBreakWords: 40 }).length, 3);
});

test('index.md does not lump a whole caption track into one block', () => {
  const captions = segs(
    [0, 10, `${filler(45)} one.`],
    [10, 20, `${filler(45)} two.`],
    [20, 30, `${filler(45)} three.`],
  );
  const md = buildIndexMd({
    source: 'https://example.com/v.mp4', slug: 'v', title: 'V', fetchedAt: '2026-08-26',
    result: { model: 'small', language: 'en', duration: 30, segments: captions },
    captionSegments: captions,
  });
  assert.ok((md.match(/^\*\*\[\d+:\d\d\]\*\*/gm) || []).length >= 3);
});

test('a hyphenated mishearing is reported part against part, not token against part', () => {
  const asr = segs([160, 165, 'becoming a grease-sensitive school today.']);
  const cap = segs([160, 165, 'becoming a grief sensitive school today.']);
  const [d] = diffTranscripts(asr, cap);
  assert.equal(d.asr, 'grease-sensitive');
  assert.equal(d.captions, 'grief sensitive',
    'reporting "grease-sensitive" against a bare "grief" reads as if a word vanished');
});

test('a whole differing token is still reported whole', () => {
  const asr = segs([50, 55, 'Grief and Grievement can be lifelong.']);
  const cap = segs([50, 55, 'Grief and bereavement can be lifelong.']);
  const [d] = diffTranscripts(asr, cap);
  assert.equal(d.asr, 'Grievement');
  assert.equal(d.captions, 'bereavement');
});

test('the outline quotes the text the transcript actually carries', () => {
  const asr = segs([0, 10, 'no child greaves alone in a grease-sensitive school.']);
  const cap = segs([0, 10, 'no child grieves alone in a grief-sensitive school.']);
  const o = buildOutline({ segments: asr, textSegments: cap, duration: 10 });
  assert.match(o.windows[0].opens, /grieves alone/);
  assert.ok(!o.windows[0].opens.includes('greaves'));
  // Turn ranges still come from the recognizer's timings, which is all that has them.
  assert.ok(Array.isArray(o.windows[0].turns));
});

test('_meta.md separates the publisher track from the stream inside the media file', () => {
  const md = buildMetaMd({
    source: 'https://example.com/v.mp4', localPath: null, bytes: 0,
    result: { model: 'small', device: 'cpu', compute_type: 'int8', duration: 170,
      language: 'en', language_probability: 0.999, segments: segs([0, 5, 'a']), transcribe_seconds: 33 },
    warnings: [], keptSource: false,
    descriptive: { frames: 35, captions: 0, audio_description: false, turns: 1, non_speech_spans: 1, windows: 1 },
    publisherCaptions: { cues: 57, used: true },
  });
  assert.match(md, /Publisher caption track:\*\* 57 cues/);
  assert.match(md, /used as the text source/);
  // The zero that used to read as "this recording has no captions".
  assert.match(md, /Caption cues inside the media file:\*\* 0/);
});

test('transcript.md gains a measured stamp on every speech line', () => {
  const dir = granularDir();
  const r = writeTimeline(dir);
  assert.equal(r.proseRestamped, true);
  const prose = readFileSync(join(dir, 'transcript.md'), 'utf8');
  const stamped = prose.match(/^\*\*\[\d+:\d\d\] [^*]+:\*\*/gm) || [];
  assert.equal(stamped.length, 5, 'one per sentence, as the report stamps one per segment');
  assert.match(prose, /^\*\*\[0:06\] Maria Collins:\*\* This was and is/m);
  assert.match(prose, /^\*\*\[0:22\] David Schonfeld:\*\* Together,/m);
  // The chapter headings, markers and everything outside ## Transcript survive.
  assert.match(prose, /^### \[0:00\] Why a life insurer took this on$/m);
  assert.match(prose, /^\[On screen: name card — "Maria Collins/m);
  assert.match(prose, /^\[No speech 0:40/m);
  rmSync(dir, { recursive: true, force: true });
});

test('stamping transcript.md is idempotent and never stacks two stamps on a name', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const once = readFileSync(join(dir, 'transcript.md'), 'utf8');
  const second = writeTimeline(dir);
  const twice = readFileSync(join(dir, 'transcript.md'), 'utf8');
  assert.equal(twice, once);
  assert.equal(second.proseRestamped, false);
  assert.ok(!/\[\d+:\d\d\]\s+\[\d+:\d\d\]/.test(twice));
  assert.equal(second.beats, JSON.parse(readFileSync(join(dir, WCAG_FILE), 'utf8')).entries.length);
  rmSync(dir, { recursive: true, force: true });
});

test('a re-stamped transcript still verifies, and its files are not stale', () => {
  const dir = granularDir();
  writeTimeline(dir);
  assert.deepEqual(verifyArtifacts(dir, { expectDescriptive: true }).problems, []);
  rmSync(dir, { recursive: true, force: true });
});

test('an already-stamped speaker line re-parses to the bare name', () => {
  const blocks = parseTranscriptBlocks(
    '## Transcript\n\n**[1:45] Terrilyn Rivers-Cannon [?]:** If we do not work together.\n');
  assert.equal(blocks[0].speaker, 'Terrilyn Rivers-Cannon [?]');
});

test('a stage direction is split off the speech, not counted as speech', () => {
  assert.deepEqual(splitDelivery('*(voice-over)* The unfortunate reality is.'),
    { delivery: 'voice-over', speech: 'The unfortunate reality is.' });
  assert.deepEqual(splitDelivery('*(voice-over, over the school exterior)* It is not a one time event.'),
    { delivery: 'voice-over, over the school exterior', speech: 'It is not a one time event.' });
  // A parenthesis inside the sentence is part of what was said.
  assert.deepEqual(splitDelivery('We shipped it (finally) last week.'),
    { delivery: null, speech: 'We shipped it (finally) last week.' });
});

test('the WCAG caption is the words spoken, with the delivery in the descriptive half', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-delivery-'));
  writeFileSync(join(dir, 'index.md'), '---\ntitle: T\nduration: 0:00:20\nsegments: 2\n---\n\n# T\n\nbody\n');
  writeFileSync(join(dir, 'segments.json'), JSON.stringify({ segments: segs(
    [0, 6, 'In 2008 the foundation began.'],
    [6, 14, 'The unfortunate reality is that two students will lose a parent.'],
  ) }));
  writeFileSync(join(dir, 'transcript.md'), [
    '---', 'duration: 0:00:20', '---', '', '## Transcript', '', '### [0:00] A', '',
    '**Maria Collins:** In 2008 the foundation began.', '',
    '[Visual: the shot dissolves to an infographic.]', '',
    '**Maria Collins:** *(voice-over)* The unfortunate reality is that two students will lose a parent.', '',
  ].join('\n'));
  writeTimeline(dir);

  const row = JSON.parse(readFileSync(join(dir, WCAG_FILE), 'utf8')).entries[1];
  assert.equal(row.caption, 'The unfortunate reality is that two students will lose a parent.');
  assert.ok(!row.caption.includes('voice-over'), 'a reviewer must not read words nobody said');
  assert.deepEqual(row.informative_caption, [
    '[Visual: the shot dissolves to an infographic.]',
    '[Delivery: voice-over]',
  ]);

  // index.md carries the speech only — the stage direction would read as a stutter
  // in the middle of a paragraph.
  const index = readFileSync(join(dir, 'index.md'), 'utf8');
  assert.match(index, /began\. The unfortunate reality/);
  assert.ok(!index.includes('voice-over'));

  // The prose keeps it exactly where the descriptive pass put it.
  assert.match(readFileSync(join(dir, 'transcript.md'), 'utf8'), /\*\(voice-over\)\* The unfortunate/);
  rmSync(dir, { recursive: true, force: true });
});

// ---- the speech-only files, the roster, and the two extra tracks -----------------

test('speech.md stamps every line and carries none of the picture', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const md = readFileSync(join(dir, SPEECH_MD_FILE), 'utf8');
  assert.match(md, /^kind: speech$/m);
  assert.match(md, /^lines: 5$/m);
  const stamped = md.match(/^\*\*\[\d+:\d\d\][^*]*\*\*/gm) || [];
  assert.equal(stamped.length, 5, 'one per sentence, the granularity the report uses');
  assert.match(md, /^\*\*\[0:06\] Maria Collins:\*\* This was and is/m);
  assert.ok(!md.includes('[Visual:'), 'the visuals are what this file exists to leave out');
  assert.ok(!md.includes('[On screen:'));
  assert.ok(!md.includes('[No speech'));
  assert.match(md, /^## \[0:00\] Why a life insurer took this on$/m, 'chapters still orient the reader');
  rmSync(dir, { recursive: true, force: true });
});

test('speech.txt is the words and nothing else — no frontmatter, no times, no names', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const txt = readFileSync(join(dir, SPEECH_TXT_FILE), 'utf8');
  assert.ok(!txt.startsWith('---'), 'a file for pasting into a document starts with the words');
  assert.ok(!/\[\d+:\d\d\]/.test(txt), 'no timings');
  assert.ok(!/Maria Collins/.test(txt), 'no speaker names');
  assert.ok(!/\[Visual:|\[On screen:|\[No speech/.test(txt), 'no markers');
  assert.match(txt, /^In 2008, the New York Life Foundation/);
  // Consecutive sentences by one speaker rejoin into a paragraph; a new speaker
  // starts a new one. Five beats from two speakers is two paragraphs.
  assert.equal(txt.trim().split(/\n\n+/).length, 2);
  assert.match(txt, /philanthropic focus\. This was and is/, 'the sentence split is undone for prose');
  rmSync(dir, { recursive: true, force: true });
});

test('a voice-over marker never becomes words in the speech files', () => {
  const beats = [
    { kind: 'speech', time: 0, speaker: 'Jim', speech: 'We opened the school.' },
    { kind: 'speech', time: 6, speaker: 'Jim', speech: '*(voice-over)* Then it changed.' },
  ];
  assert.equal(buildSpeechTxt({ beats }), 'We opened the school. Then it changed.\n');
  const md = buildSpeechMd({ beats, chapters: [], meta: { source: 's', title: 'T', duration: '0:00:10',
    durationSeconds: 10, language: 'en', textSource: 'x', fetchedAt: '2026-08-26' } });
  assert.ok(!md.includes('voice-over'), 'a stage direction is not something anybody said');
});

test('speechParagraphs groups by speaker, not by sentence', () => {
  const paras = speechParagraphs([
    { kind: 'speech', time: 0, speaker: 'A', speech: 'One.' },
    { kind: 'markers', time: 3, markers: ['[Visual: a cut.]'] },
    { kind: 'speech', time: 4, speaker: 'A', speech: 'Two.' },
    { kind: 'speech', time: 8, speaker: 'B', speech: 'Three.' },
  ]);
  assert.equal(paras.length, 2);
  assert.equal(paras[0].text, 'One. Two.', 'a marker between two of a speaker\'s sentences is not a handover');
  assert.equal(paras[1].speaker, 'B');
});

test('wcag-transcription.txt is the JSON rows in the shape a reviewer reads', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const txt = readFileSync(join(dir, WCAG_TEXT_FILE), 'utf8');
  const doc = JSON.parse(readFileSync(join(dir, WCAG_FILE), 'utf8'));
  assert.equal((txt.match(/^time: /gm) || []).length, doc.entries.length,
    'the two files are one list — a row in one and not the other is a drift nobody would see');
  assert.equal((txt.match(/^caption:$/gm) || []).length, doc.entries.length);
  assert.equal((txt.match(/^author:$/gm) || []).length, doc.entries.length);
  assert.match(txt, /time: 0:00\n\ninformative caption:\n\[Visual: fade up from black/);
  assert.match(txt, /caption:\nIn 2008, the New York Life Foundation/);
  assert.match(txt, /author:\nMaria Collins/);
  // A row with description and no speech is a real row, and says so rather than
  // leaving a reviewer to wonder whether a field went missing.
  assert.match(txt, /caption:\n\(no speech\)/);
  rmSync(dir, { recursive: true, force: true });
});

test('speakers.md reads the title off the name card and totals each voice', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const md = readFileSync(join(dir, SPEAKERS_FILE), 'utf8');
  assert.match(md, /^speakers: 2$/m);
  assert.match(md, /\| Maria Collins \| Vice President · New York Life Foundation \| 0:00 \| 3 \|/);
  assert.match(md, /\| David Schonfeld \|/);
  rmSync(dir, { recursive: true, force: true });
});

test('a name card is only read as one when it has a name and a role in it', () => {
  const cards = speakerCards([
    { markers: ['[On screen: name card — "Maria Collins / Vice President / New York Life Foundation".]'] },
    { markers: ['[On screen: title card — "A film about grief".]'] },
    { markers: ['[Visual: a wide shot of "the building".]'] },
  ]);
  assert.equal(cards.size, 1, 'a title with no separator is a caption, not a person');
  assert.deepEqual(cards.get('mariacollins'),
    { name: 'Maria Collins', role: 'Vice President · New York Life Foundation' });
});

test('an uncertain name keeps its [?] and is called out under the table', () => {
  const beats = [{ kind: 'speech', time: 0, speaker: 'Terrilyn Rivers-Cannon [?]', speech: 'We work together.' }];
  const md = buildSpeakersMd({ beats, meta: { source: 's', title: 'T', duration: '0:00:10',
    durationSeconds: 10, fetchedAt: '2026-08-26' } });
  assert.match(md, /\| Terrilyn Rivers-Cannon \[\?\] \| — \|/, 'no card was shown, so no title is invented');
  assert.match(md, /1 name\(s\) above are marked uncertain/);
});

test('the roster shares by words and reports a speaking span for each voice', () => {
  const rows = speakerRoster([
    { kind: 'speech', time: 0, speaker: 'A', speech: 'one two three' },
    { kind: 'speech', time: 10, speaker: 'B', speech: 'four' },
  ], { durationSeconds: 20 });
  assert.equal(rows[0].name, 'A');
  assert.equal(rows[0].words, 3);
  assert.equal(rows[0].share, 75);
  assert.equal(rows[0].seconds, 10);
  assert.equal(rows[1].seconds, 10, 'the last voice runs to the end of the recording');
});

test('descriptions.vtt carries the picture and never the speech', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const vtt = readFileSync(join(dir, DESCRIPTIONS_FILE), 'utf8');
  assert.match(vtt, /^WEBVTT/);
  assert.ok(parseCaptions(vtt), 'a player has to be able to load it');
  assert.match(vtt, /kind="descriptions"/, 'the file says which track it is meant to be hung on');
  assert.match(vtt, /\[Visual: fade up from black/);
  assert.ok(!vtt.includes('In 2008, the New York Life Foundation'),
    'the speech is in captions.vtt — a viewer hearing both would hear the film twice');
  rmSync(dir, { recursive: true, force: true });
});

test('a description cue runs until the moment it describes is over', () => {
  const cues = cuesFromBeats([
    { kind: 'markers', time: 0, markers: ['[Visual: a cut.]'] },
    { kind: 'speech', time: 6, speaker: 'A', speech: 'hello' },
    { kind: 'markers', time: 12, markers: ['[Visual: an end card.]'] },
  ], { durationSeconds: 20 });
  assert.equal(cues.length, 2, 'a beat with nothing to describe gets no cue');
  assert.deepEqual([cues[0].start, cues[0].end], [0, 6]);
  assert.deepEqual([cues[1].start, cues[1].end], [12, 20], 'the last one runs to the end');
});

test('chapters.vtt is the chapter list a player can act on, or nothing at all', () => {
  const dir = granularDir();
  writeTimeline(dir);
  const vtt = readFileSync(join(dir, CHAPTERS_FILE), 'utf8');
  // 22.600, not the heading's own 0:22: the stamp in the prose was written by eye and
  // the line under it is measured, so the heading takes the line's time.
  assert.match(vtt, /^Chapter 1\n00:00:00\.000 --> 00:00:22\.600\nWhy a life insurer took this on$/m);
  assert.match(vtt, /^Chapter 2\n00:00:22\.600 --> /m);
  assert.ok(parseCaptions(vtt));
  assert.equal(buildChaptersVtt([], { durationSeconds: 20 }), null,
    'an empty chapters track would look like a broken one');
  rmSync(dir, { recursive: true, force: true });
});

// ---- data/ ------------------------------------------------------------------------

test('the machine files go under data/ and reads still find an old flat directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-data-'));
  writeData(dir, 'segments.json', '{"segments":[]}');
  assert.ok(existsSync(join(dir, DATA_DIR, 'segments.json')));
  assert.equal(artifactPath(dir, 'segments.json'), dataPath(dir, 'segments.json'));
  assert.equal(readArtifact(dir, 'segments.json'), '{"segments":[]}');

  const flat = mkdtempSync(join(tmpdir(), 'twt-flat-'));
  writeFileSync(join(flat, 'segments.json'), '{"segments":[1]}');
  assert.equal(artifactPath(flat, 'segments.json'), join(flat, 'segments.json'),
    'a directory written before the split still verifies and still re-runs');
  assert.equal(readArtifact(flat, 'nothing.json'), null);
  rmSync(dir, { recursive: true, force: true });
  rmSync(flat, { recursive: true, force: true });
});

test('_meta.md says which file to open, and what data/ is not', () => {
  const map = fileMapLines(true).join('\n');
  assert.match(map, /\| `index\.md` \| the speech, attributed per speaker/);
  assert.match(map, /`transcript\.txt`.*the report/);
  assert.match(map, /`data\/`.*Nothing in here is content/);
  assert.match(map, /`speech\.txt`/);
  assert.match(map, /`captions\.vtt` \/ `captions\.srt`/);

  const verbatim = fileMapLines(false).join('\n');
  assert.ok(!verbatim.includes('transcript.md'), 'a verbatim run has no descriptive transcript to list');
  assert.ok(!verbatim.includes('speech.txt'));
  assert.match(verbatim, /`index\.md`/);
  assert.match(verbatim, /re-run with `--force` produces them/);
});

test('the derived files are rebuilt together and verify catches a stale one', () => {
  const dir = granularDir();
  writeTimeline(dir);
  assert.deepEqual(verifyArtifacts(dir, { expectDescriptive: true }).problems, []);

  // The prose is edited and the command is not re-run: every file built from it is
  // now describing a draft that no longer exists.
  const later = Date.now() / 1000 + 60;
  utimesSync(join(dir, 'transcript.md'), later, later);
  const stale = verifyArtifacts(dir, { expectDescriptive: true }).problems;
  for (const name of [TIMELINE_FILE, WCAG_FILE, WCAG_TEXT_FILE, SPEECH_MD_FILE, SPEECH_TXT_FILE,
    SPEAKERS_FILE, DESCRIPTIONS_FILE, CHAPTERS_FILE]) {
    assert.ok(stale.some((p) => p.startsWith(`${name} is older than transcript.md`)),
      `${name} went stale without anyone being told`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('a missing speech file is a note mid-run and a problem once the pass is claimed done', () => {
  const dir = granularDir();
  writeTimeline(dir);
  rmSync(join(dir, SPEECH_TXT_FILE));
  assert.ok(verifyArtifacts(dir).notes.some((n) => /No speech\.txt/.test(n)));
  assert.ok(verifyArtifacts(dir, { expectDescriptive: true }).problems
    .some((p) => /No speech\.txt/.test(p)));
  rmSync(dir, { recursive: true, force: true });
});

test('an old flat directory is tidied into data/ rather than doubled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-migrate-'));
  writeFileSync(join(dir, 'segments.json'), '{"segments":[1]}');
  writeFileSync(join(dir, 'outline.json'), '{"windows":[]}');
  writeFileSync(join(dir, 'index.md'), '---\ntitle: T\n---\n');
  const moved = migrateFlatArtifacts(dir);
  assert.deepEqual(moved.sort(), ['outline.json', 'segments.json']);
  assert.equal(readFileSync(dataPath(dir, 'segments.json'), 'utf8'), '{"segments":[1]}');
  assert.ok(!existsSync(join(dir, 'segments.json')));
  assert.ok(existsSync(join(dir, 'index.md')), 'the files a person reads stay where they are');

  // A stale flat copy beside a current one in data/ is deleted, not promoted.
  writeFileSync(join(dir, 'segments.json'), '{"segments":[9,9,9]}');
  migrateFlatArtifacts(dir);
  assert.ok(!existsSync(join(dir, 'segments.json')));
  assert.equal(readFileSync(dataPath(dir, 'segments.json'), 'utf8'), '{"segments":[1]}');
  rmSync(dir, { recursive: true, force: true });
});

test('verify notices a machine file sitting in both places', () => {
  const dir = descriptiveDir(GOOD_PROSE);
  migrateFlatArtifacts(dir);
  writeFileSync(join(dir, 'segments.json'), '{"segments":[]}');
  assert.ok(verifyArtifacts(dir).notes.some((n) => /segments\.json exist\(s\) both here and in data\//.test(n)),
    'the copy at the top level is the one a person opens first');
  rmSync(dir, { recursive: true, force: true });
});

test('a directory in the data/ layout verifies clean, not as one full of empty files', () => {
  const dir = descriptiveDir(GOOD_PROSE);
  migrateFlatArtifacts(dir);
  const v = verifyArtifacts(dir, { expectDescriptive: true });
  assert.deepEqual(v.problems, [], 'a size check that only looks at the top level calls every machine file empty');
  assert.equal(v.counts['segments.json'], 1);
  rmSync(dir, { recursive: true, force: true });
});

test('the slice names the frame folder that actually holds the frames', () => {
  const one = buildSlice({ from: 0, to: 300, duration: 300, segments: segs([0, 5, 'hello']),
    frames: [{ t: 4, file: '001-00m04s.jpg' }], framesDir: 'data/frames' });
  assert.match(one, /- 0:04 — data\/frames\/001-00m04s\.jpg/);
  const legacy = buildSlice({ from: 0, to: 300, duration: 300, segments: segs([0, 5, 'hello']),
    frames: [{ t: 4, file: '001-00m04s.jpg' }] });
  assert.match(legacy, /- 0:04 — frames\/001-00m04s\.jpg/, 'an older directory still resolves');
});

// ---- model choice ------------------------------------------------------------------

test('the default model is the accurate one, and the fast ones are the opt-in', () => {
  assert.equal(DEFAULT_MODEL, 'medium');
  assert.ok(BELOW_DEFAULT.includes('small'), 'small mangles domain vocabulary and is a trade, not a default');
  assert.ok(!BELOW_DEFAULT.includes(DEFAULT_MODEL));
  assert.ok(MODELS.some((m) => m.name === DEFAULT_MODEL), 'the default has to be a model the table knows');
});

test('a run below the default says so, and how far below', () => {
  const rough = detectIssues({ segments: segs([0, 4, 'a line.']), duration: 10, model: 'base', warnings: [] });
  assert.ok(rough.run.some((r) => /error-prone end of the range/.test(r)));
  assert.ok(rough.run.some((r) => /--model medium/.test(r)));

  const traded = detectIssues({ segments: segs([0, 4, 'a line.']), duration: 10, model: 'small', warnings: [] });
  assert.ok(traded.run.some((r) => /rather than the default `medium`/.test(r)));
  assert.ok(traded.run.some((r) => /domain vocabulary/.test(r)),
    'the reason matters: small fails on exactly the words you would quote');
  assert.ok(!traded.run.some((r) => /error-prone end/.test(r)), 'small is a trade, not a mistake');

  const dflt = detectIssues({ segments: segs([0, 4, 'a line.']), duration: 10, model: 'medium', warnings: [] });
  assert.ok(!dflt.run.some((r) => /--model/.test(r)), 'nothing to warn about when the default was used');
});

test('a model counts as downloaded only once its weights are on disk', () => {
  const hub = mkdtempSync(join(tmpdir(), 'twt-hub-'));
  const repo = 'Systran/faster-whisper-medium';
  const snap = join(hub, 'models--Systran--faster-whisper-medium', 'snapshots', 'abc123');
  assert.equal(modelIsCached(repo, hub), false, 'nothing there at all');

  // An interrupted download: the small files land first, the 1.5 GB one does not.
  mkdirSync(snap, { recursive: true });
  writeFileSync(join(snap, 'config.json'), '{}');
  writeFileSync(join(snap, 'tokenizer.json'), '{}');
  assert.equal(modelIsCached(repo, hub), false,
    'reporting this as ready is how a user is told to go ahead and then waits ten minutes');

  writeFileSync(join(snap, 'model.bin'), 'weights');
  assert.equal(modelIsCached(repo, hub), true);
  rmSync(hub, { recursive: true, force: true });
});

// ---- the publisher's words, all the way through ------------------------------------
// Everything below exists because of one silent failure. index.md and the five files
// built beside it declare `text_source: publisher-captions`; _meta.md says index.md
// carries the caption wording. The first index.md is built from the cues and is
// exact — and then the descriptive pass rebuilds every one of them out of its own
// re-typing of the same speech, and the frontmatter carries over untouched. What
// reached the pipeline said "grades K-12" where the publisher had written "grades K
// through 12", under a heading claiming to be the publisher's own track.

import {
  reconcileBeatText, snapChapters, fitDescriptionCues, AD_WORDS_PER_SECOND,
  indexSpeechSegments, spliceDescriptivePostscript, spliceMetaPostscript,
  descriptivePostscript, buildDescriptionsVtt, POSTSCRIPT_HEADING, META_POSTSCRIPT_HEADING,
  cleanSpeakerName, isUncertainName, RECONCILE_MAX_DRIFT, CAPTIONS_FILE,
} from '../skills/twt-content-fetch-video/tools/transcribe-video.mjs';

const vtt = (...rows) => ['WEBVTT', '', ...rows.map(([a, b, text]) =>
  `${formatVttTime(a)} --> ${formatVttTime(b)}\n${text}\n`)].join('\n');

// The publisher wrote "K through 12" and "one time"; the recognizer dropped the
// "through" and the descriptive pass re-typed the rest. Both doubled words are real:
// spanText used to collapse "that that" to "that" when it rebuilt a sentence.
const PUB_VTT = vtt(
  [0, 4, 'Support grieving students'],
  [4, 8, 'in grades K through 12.'],
  [8, 12, "It's not a one time event."],
  [12, 18, 'That that student will never forget that that teacher was there.'],
);

const RETYPED_PROSE = [
  '---', 'title: T', 'duration: 0:00:20', '---', '',
  '## Transcript', '',
  '### [0:00] Opening', '',
  '[Visual: fade up from black.]', '',
  '[On screen: name card — "Ada Lovelace / Director / Somewhere".]', '',
  "**Ada Lovelace:** Support grieving students in grades K-12. It's not a one-time event.", '',
  '[On screen: name card — "Terrilyn Rivers-Cannon / School Social Work Association".]', '',
  '**Terrilyn Rivers-Cannon [?]:** That that student will never forget that that teacher was'
    + ' there.', '',
].join('\n');

function reconcileDir({ prose = RETYPED_PROSE, captions = PUB_VTT } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-reconcile-'));
  const asr = segs(
    [0, 8, 'Support grieving students in grades K-12.'],
    [8, 12, "It's not a one-time event."],
    [12, 18, 'That that student will never forget that that teacher was there.'],
  );
  writeFileSync(join(dir, 'index.md'),
    '---\nsource: https://example.com/v.mp4\ntype: video\ntitle: T\nduration: 0:00:20\n'
    + 'language: en\nengine: faster-whisper\nmodel: small\ntext_source: publisher-captions\n'
    + 'segments: 3\nfetched_at: 2026-08-26\n---\n\n# T\n\n**[0:00]** everything in one lump.\n');
  writeFileSync(join(dir, 'segments.json'), JSON.stringify({ segments: asr }));
  writeFileSync(join(dir, '_meta.md'),
    '# Transcript metadata — v.mp4\n\n- **Segments:** 3\n\n## Warnings\n\n'
    + '- The recognizer returned back-to-back segment times, so pause-based turn detection is'
    + ' blind on this file.\n\n> Machine transcription. Names, jargon, and numbers are the least'
    + ' reliable parts.\n');
  writeFileSync(join(dir, 'transcript.txt'),
    'PART 1 - x\nPART 2 - TIMESTAMPED SEGMENTS (all 3 items)\nPART 3 - POSSIBLE ISSUES\n'
    + `${'-'.repeat(REPORT_WIDTH)}\n${REVIEW_HEADING}\n${'-'.repeat(REPORT_WIDTH)}\n\n`
    + 'The 7 lower-third frames are what will settle this in the descriptive pass.\n\n'
    + `${'='.repeat(REPORT_WIDTH)}\nEND OF REPORT\n${'='.repeat(REPORT_WIDTH)}\n`);
  writeFileSync(join(dir, 'media.json'), JSON.stringify({ has_video: false }));
  writeFileSync(join(dir, 'outline.json'), JSON.stringify({ windows: [] }));
  writeData(dir, CAPTIONS_FILE, captions);
  writeSubtitles({ outDir: dir, source: 'a.mp4', result: { model: 'small', duration: 20, segments: asr } });
  writeFileSync(join(dir, 'transcript.md'), prose);
  return dir;
}

test('a word the recognizer dropped comes back from the publisher\'s track', () => {
  const dir = reconcileDir();
  const out = writeTimeline(dir);
  assert.equal(out.reconciled.applied, true);

  // The whole point: every file the pipeline reads carries the publisher's wording.
  for (const name of ['index.md', TIMELINE_FILE, SPEECH_MD_FILE, SPEECH_TXT_FILE, WCAG_TEXT_FILE]) {
    const text = readFileSync(join(dir, name), 'utf8');
    assert.match(text, /grades K through 12/, `${name} lost the publisher's "through"`);
    assert.ok(!/grades K-12/.test(text), `${name} still carries the recognizer's "K-12"`);
  }
  const wcag = JSON.parse(readFileSync(join(dir, WCAG_FILE), 'utf8'));
  assert.ok(wcag.entries.some((e) => /grades K through 12/.test(e.caption)));

  // And the change is on the record in both directions, not applied quietly.
  const restored = out.reconciled.changes.find((c) => /K through 12/.test(c.after));
  assert.ok(restored, "the restoration has to be on the record, not just in the file");
  assert.match(restored.before, /K-12/);
  assert.match(readFileSync(join(dir, '_meta.md'), 'utf8'), /K through 12/);
  assert.match(readFileSync(join(dir, 'transcript.txt'), 'utf8'), /K through 12/);
  rmSync(dir, { recursive: true, force: true });
});

test('rebuilding a sentence keeps a word that was genuinely said twice', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  const index = readFileSync(join(dir, 'index.md'), 'utf8');
  assert.match(index, /That that student will never forget that that teacher was there\./,
    'collapsing "that that" to "that" would be the tool inventing a different sentence');
  rmSync(dir, { recursive: true, force: true });
});

test('a difference of hyphen or full stop alone is left exactly as it was', () => {
  const dir = reconcileDir();
  const out = writeTimeline(dir);
  const index = readFileSync(join(dir, 'index.md'), 'utf8');
  // The publisher's cue says "a one time event."; the descriptive pass hyphenated it.
  // Nothing was said differently, so nothing is rewritten — the same rule
  // diffTranscripts works by, and the one verify checks this file against.
  assert.match(index, /a one-time event/);
  assert.equal(out.reconciled.changes.length, 1, 'the dropped word, and nothing else');
  assert.match(out.reconciled.changes[0].after, /K through 12/);
  rmSync(dir, { recursive: true, force: true });
});

test("the publisher's own cue-boundary punctuation is not adopted along with the words", () => {
  // A real caption track breaks a clause across two cues and full-stops the join:
  // "…on the professionals as well." / "That they feel equipped." Restoring the words
  // must not import that, or a fix for a dropped word becomes a mangled sentence.
  const beats = [{
    kind: 'speech', speaker: 'A',
    speech: "there's a great impact on the professionals as well, that they feel prepared.",
  }];
  const out = reconcileBeatText(beats, segs(
    [0, 3, "there's a great impact on the professionals as well."],
    [3, 6, 'That they feel prepared.'],
  ));
  assert.equal(out.changes.length, 0);
  assert.equal(beats[0].speech,
    "there's a great impact on the professionals as well, that they feel prepared.");
});

test('a beat the reference stream does not cover keeps its own words', () => {
  const beats = [
    { kind: 'speech', speaker: 'A', speech: 'in grades K-12.' },
    { kind: 'speech', speaker: 'B', speech: 'An aside the caption track never carried at all.' },
  ];
  const out = reconcileBeatText(beats, segs([0, 4, 'in grades K through 12.']));
  assert.equal(out.applied, true);
  assert.equal(beats[0].speech, 'in grades K through 12.');
  assert.equal(beats[1].speech, 'An aside the caption track never carried at all.',
    'emptying it would delete real speech, which is worse than leaving it unreconciled');
});

test('a stage direction survives the words being replaced under it', () => {
  const beats = [{ kind: 'speech', speaker: 'A', speech: '*(voice-over)* in grades K-12.' }];
  reconcileBeatText(beats, segs([0, 4, 'in grades K through 12.']));
  assert.equal(beats[0].speech, '*(voice-over)* in grades K through 12.');
});

test('two texts too far apart are left alone rather than rewritten into each other', () => {
  const beats = [{ kind: 'speech', speaker: 'A', speech: 'the quick brown fox jumps over the lazy dog' }];
  const out = reconcileBeatText(beats, segs([0, 4, 'entirely different words about something else here']));
  assert.equal(out.applied, false);
  assert.ok(out.drift > RECONCILE_MAX_DRIFT);
  assert.match(out.why, /too far apart/);
  assert.equal(beats[0].speech, 'the quick brown fox jumps over the lazy dog');
});

test('verify catches an index.md that claims the caption track and does not carry it', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  assert.equal(verifyArtifacts(dir).ok, true, 'a reconciled directory is clean');

  // Put the recognizer's wording back, exactly as the descriptive pass used to leave it.
  const index = readFileSync(join(dir, 'index.md'), 'utf8');
  writeFileSync(join(dir, 'index.md'), index.replace('K through 12', 'K-12'));
  const bad = verifyArtifacts(dir);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /text_source: publisher-captions.*differ/s);
  assert.match(bad.problems.join('\n'), /through/);
  rmSync(dir, { recursive: true, force: true });
});

test('index.md gives its speech back as segments, named or not', () => {
  const named = indexSpeechSegments('---\na: b\n---\n\n# T\n\n_a note._\n\n**[0:06] Ada Lovelace:** hello there.\n');
  assert.deepEqual(named, [{ start: 6, text: 'hello there.' }]);
  const anon = indexSpeechSegments('---\na: b\n---\n\n# T\n\n**[1:02]** hello there.\n');
  assert.deepEqual(anon, [{ start: 62, text: 'hello there.' }]);
});

// ---- chapters ----------------------------------------------------------------------

test('a chapter never starts after the line it introduces', () => {
  const chapter = { time: 22, title: 'Forming the coalition' };
  const beats = [
    { kind: 'markers', time: 22, markers: ['[Visual: a cut.]'], chapter },
    { kind: 'speech', time: 22.6, speaker: 'A', speech: 'Together, our organizations…', chapter },
  ];
  assert.equal(snapChapters(beats, [chapter]), 0, 'a move inside the same printed second is not a move');
  assert.equal(chapter.time, 22);

  const late = { time: 25, title: 'Later' };
  const lateBeats = [{ kind: 'speech', time: 22.6, speaker: 'A', speech: 'x', chapter: late }];
  assert.equal(snapChapters(lateBeats, [late]), 1);
  assert.equal(late.time, 22.6);
});

test('snapped chapters stay in order even when a beat lands before the one above it', () => {
  const a = { time: 0, title: 'A' };
  const b = { time: 30, title: 'B' };
  const beats = [
    { kind: 'speech', time: 10, speaker: 'x', speech: 'one', chapter: a },
    { kind: 'speech', time: 5, speaker: 'x', speech: 'two', chapter: b },
  ];
  snapChapters(beats, [a, b]);
  assert.ok(b.time >= a.time, 'a chapter list that runs backwards is worse than an imprecise one');
});

// ---- descriptions that can actually be spoken ---------------------------------------

test('a description cue that cannot be spoken in its window is measured as such', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const fit = fitDescriptionCues([
    { start: 0, end: 10, text: `[Visual: ${words(20)}]` },
    { start: 10, end: 11.32, text: `[On screen: ${words(57)}]` },
  ]);
  assert.equal(fit.overrun, 1);
  assert.deepEqual(fit.overrunCues, [2]);
  assert.equal(fit.worst.n, 2);
  assert.ok(fit.needSeconds > fit.windowSeconds);
  assert.ok(AD_WORDS_PER_SECOND * 60 > 140 && AD_WORDS_PER_SECOND * 60 < 180,
    'the rate has to be a describer speaking, not a synthesiser being pushed');
});

test('descriptions.vtt says which of the two things it is', () => {
  const meta = { fetchedAt: '2026-08-26', durationSeconds: 20, speechSeconds: 19 };
  const fits = [{ start: 0, end: 10, text: '[Visual: a short one.]' }];
  assert.match(buildDescriptionsVtt(fits, { source: 'a.mp4', meta }),
    /Hang it on the video as <track kind="descriptions">/);

  const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
  const over = [{ start: 0, end: 1.32, text: `[On screen: ${words}]` }];
  const vttText = buildDescriptionsVtt(over, { source: 'a.mp4', meta });
  assert.match(vttText, /EXTENDED DESCRIPTION SCRIPT, NOT A DROP-IN TRACK/);
  assert.match(vttText, /Overrunning cues: 1\./);
  assert.match(vttText, /speech already occupies|Speech already occupies/);
  assert.ok(!/Hang it on the video as <track kind="descriptions">, not as captions/.test(vttText),
    'a track that cannot be spoken must not tell the reader to hang it on a player');
  assert.ok(parseCaptions(vttText), 'it is still valid WebVTT either way');
});

test('verify re-measures the description fit rather than trusting the header', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  const words = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
  writeFileSync(join(dir, DESCRIPTIONS_FILE),
    'WEBVTT\n\nNOTE\nHang it on the video as <track kind="descriptions">, not as captions —\n'
    + `\n1\n00:00:00.000 --> 00:00:02.000\n[On screen: ${words}]\n`);
  const out = verifyArtifacts(dir);
  assert.match(out.notes.join('\n'), /extended-description script/);
  assert.match(out.notes.join('\n'), /NOTE header still tells the reader to do exactly that/);
  rmSync(dir, { recursive: true, force: true });
});

// ---- the uncertainty marker stays a note to a human ---------------------------------

test('[?] is a flag in the data and a marker in the prose, never part of the name', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  const wcag = JSON.parse(readFileSync(join(dir, WCAG_FILE), 'utf8'));
  const row = wcag.entries.find((e) => e.author && /Terrilyn/.test(e.author));
  assert.equal(row.author, 'Terrilyn Rivers-Cannon', 'the curation skills read this field as the spelling');
  assert.equal(row.author_uncertain, true, 'the doubt is kept, in a shape a consumer can act on');
  assert.match(readFileSync(join(dir, WCAG_TEXT_FILE), 'utf8'), /Terrilyn Rivers-Cannon\s+\[\?\]/);
  assert.match(readFileSync(join(dir, SPEAKERS_FILE), 'utf8'), /Terrilyn Rivers-Cannon \[\?\]/);
  rmSync(dir, { recursive: true, force: true });
});

test('cleanSpeakerName and isUncertainName split the two jobs the marker was doing', () => {
  assert.equal(cleanSpeakerName('Terrilyn Rivers-Cannon [?]'), 'Terrilyn Rivers-Cannon');
  assert.equal(cleanSpeakerName('Terrilyn [ ? ] Rivers-Cannon'), 'Terrilyn Rivers-Cannon');
  assert.equal(isUncertainName('Terrilyn Rivers-Cannon [?]'), true);
  assert.equal(isUncertainName('Ada Lovelace'), false);
  assert.equal(cleanSpeakerName(null), '');
});

test('verify flags the marker buried inside a name in a quoted card', () => {
  const dir = reconcileDir({
    prose: RETYPED_PROSE.replace('"Terrilyn Rivers-Cannon / School',
      '"Terrilyn [?] Rivers-Cannon / School'),
  });
  writeTimeline(dir);
  const out = verifyArtifacts(dir);
  assert.match(out.notes.join("\n"), /\[\?\]` sits inside a name rather than after it/);
  assert.match(out.notes.join('\n'), /Terrilyn \[\?\] Rivers-Cannon/);

  // …and the same card with the marker in the right place raises nothing.
  const clean = reconcileDir();
  writeTimeline(clean);
  assert.ok(!verifyArtifacts(clean).notes.join("\n").includes("sits inside a name"));
  rmSync(clean, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

// ---- the two files that used to be a run behind ---------------------------------------

test('the report stops asking for what the descriptive pass has already settled', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  const report = readFileSync(join(dir, 'transcript.txt'), 'utf8');
  assert.match(report, new RegExp(POSTSCRIPT_HEADING));
  assert.match(report, /Speakers are settled: 2 named voice\(s\)/);
  assert.match(report, /Ada Lovelace/);
  assert.match(report, /PARTS 1 and 2 of `transcript.txt` are unchanged/);
  assert.ok(report.indexOf(POSTSCRIPT_HEADING) < report.indexOf(REVIEW_HEADING),
    'below the review heading the next `annotate` would delete it');

  const meta = readFileSync(join(dir, '_meta.md'), 'utf8');
  assert.match(meta, new RegExp(META_POSTSCRIPT_HEADING));
  assert.ok(meta.indexOf('## Warnings') < meta.indexOf(META_POSTSCRIPT_HEADING),
    'the caveat, then its resolution, in that order');
  assert.ok(meta.indexOf(META_POSTSCRIPT_HEADING) < meta.indexOf('> Machine transcription'));
  rmSync(dir, { recursive: true, force: true });
});

test('splicing the amendment twice replaces it rather than stacking it', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  const once = readFileSync(join(dir, 'transcript.txt'), 'utf8');
  // The report wraps to its own column, so these are matched on the flattened text.
  const flat = (s) => s.replace(/\s+/g, " ");
  assert.match(flat(once), /changed the wording in 1 place\(s\)/);

  // The second run reads a transcript.md this command has already reconciled, so it
  // truthfully reports a clean file rather than repeating the first run's findings.
  // What must not change is the number of amendments in the file.
  const out = writeTimeline(dir);
  const twice = readFileSync(join(dir, 'transcript.txt'), 'utf8');
  assert.equal(twice.split(POSTSCRIPT_HEADING).length - 1, 1);
  assert.equal(out.reconciled.changes.length, 0);
  assert.match(twice, /matched it\s+exactly\. Nothing was rewritten\./);
  assert.equal(twice.split(REVIEW_HEADING).length - 1, 1, 'and nothing below it was disturbed');

  // From there it is a fixed point: nothing is left to settle, so nothing moves.
  const metaTwice = readFileSync(join(dir, '_meta.md'), 'utf8');
  writeTimeline(dir);
  assert.equal(readFileSync(join(dir, 'transcript.txt'), 'utf8'), twice);
  assert.equal(readFileSync(join(dir, '_meta.md'), 'utf8'), metaTwice);
  rmSync(dir, { recursive: true, force: true });
});

test('annotating the review afterwards leaves the amendment where it is', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  const spliced = spliceReview(readFileSync(join(dir, 'transcript.txt'), 'utf8'), 'a later read-through.');
  assert.match(spliced, new RegExp(POSTSCRIPT_HEADING));
  assert.match(spliced, /a later read-through\./);
  rmSync(dir, { recursive: true, force: true });
});

test('the amendment says plainly when there was no track to reconcile against', () => {
  const lines = descriptivePostscript({
    voices: [], reconciled: { applied: false, why: 'no publisher caption track', changes: [] },
    fit: null, chaptersMoved: 0, unmatched: [], meta: {},
  });
  const text = lines.join('\n');
  assert.match(text, /named nobody/);
  assert.match(text, /not reconciled against a reference track: no publisher caption track/);
});

test('the two splices no-op on a file that is not the shape they expect', () => {
  assert.equal(spliceDescriptivePostscript('not a report', ['x']), null);
  assert.match(spliceMetaPostscript('# meta\n\nno closing note here\n', ['x']),
    new RegExp(`${META_POSTSCRIPT_HEADING}\\n\\n- x`));
});

// ---- the counts that used to disagree ------------------------------------------------

test('speakers.md totals its own table', () => {
  const dir = reconcileDir();
  writeTimeline(dir);
  const md = readFileSync(join(dir, SPEAKERS_FILE), 'utf8');
  const rows = [...md.matchAll(/^\| (?!\*\*All)(?!-)([^|]+)\|[^|]*\|[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gm)];
  const words = rows.reduce((n, r) => n + Number(r[3]), 0);
  assert.match(md, new RegExp(`\\*\\*All ${rows.length} speakers\\*\\*.*\\*\\*${words}\\*\\*`));
  rmSync(dir, { recursive: true, force: true });
});

test('the report names both word counts rather than one unlabelled number', () => {
  const result = {
    duration: 20, model: 'small', device: 'cpu', compute_type: 'int8', language: 'en',
    language_probability: 1, transcribe_seconds: 3, segments: segs([0, 8, 'in grades K-12.']),
  };
  const txt = buildReportTxt({
    source: 'a.mp4', slug: 'a', result, issues: { counts: {}, segments: [], run: [], variants: [] },
    fetchedAt: '2026-08-26', descriptive: null, captionDiff: [], subtitles: null,
    publisherCaptions: { cues: 4, used: true, words: 4 },
  });
  assert.match(txt, /Words .*3 recognized, 4 in the publisher's track/s);

  const noTrack = buildReportTxt({
    source: 'a.mp4', slug: 'a', result, issues: { counts: {}, segments: [], run: [], variants: [] },
    fetchedAt: '2026-08-26', descriptive: null, captionDiff: [], subtitles: null,
  });
  assert.match(noTrack, /Words \.+ 3 recognized\n/);
});

// ---- the source profile, and the audio the recognizer is actually handed --------
// The change these cover: the container used to go straight into faster-whisper,
// whose decode_audio holds the whole track in RAM (measured 333 MB peak on 30
// minutes of audio, against 40 MB for the streaming extractor, and it grows with
// duration). Everything below is the seam that keeps the container out.

test('fmtBytes switches to GB where MB stops being readable', () => {
  assert.equal(fmtBytes(0), null);
  assert.equal(fmtBytes(5 * 1048576), '5.0 MB');
  assert.equal(fmtBytes(1073741823), '1024.0 MB');
  assert.equal(fmtBytes(5e9), '4.66 GB');
});

test('mediaProfile derives the bitrate that tells a master from a delivery file', () => {
  // The reported case: 5 GB across half an hour.
  assert.equal(mediaProfile({ bytes: 5e9, duration: 1800 }).mbps, 22.2);
  // A normal 1080p delivery file, an order of magnitude down.
  assert.equal(mediaProfile({ bytes: 5e8, duration: 1800 }).mbps, 2.2);
  // Neither number is invented when the inputs are missing.
  assert.equal(mediaProfile({ bytes: 0, duration: 1800 }).mbps, null);
  assert.equal(mediaProfile({ bytes: 5e9, duration: 0 }).mbps, null);
  assert.equal(mediaProfile({}).shrank, null);
});

test('mediaProfile reports how much of the container the recognizer skipped', () => {
  assert.equal(mediaProfile({ bytes: 5e9, duration: 1800, audioBytes: 57.6e6 }).shrank, 87);
  // A small clip whose WAV is larger than its source must not claim a saving.
  assert.equal(mediaProfile({ bytes: 112235, duration: 6, audioBytes: 193240 }).shrank, 1);
});

test('the source line names size, duration, bitrate and what is in the file', () => {
  const line = sourceLine({
    bytes: 5e9, duration: 1800, streams: [{ type: 'video' }, { type: 'audio' }, { type: 'audio' }],
  });
  assert.equal(line, 'source: 4.66 GB, 0:30:00, 22.2 Mbit/s (video + audio)');
  assert.match(sourceLine({ bytes: 0, duration: 12, streams: [] }),
    /size unknown, 0:00:12 \(unknown streams\)/);
});

test('the extracted line claims a saving only when there was one', () => {
  assert.equal(extractedLine({ bytes: 5e9, duration: 1800, audioBytes: 57.6e6 }),
    'extracted 16 kHz mono audio: 54.9 MB — 87x less to read than the container');
  assert.equal(extractedLine({ bytes: 112235, duration: 6, audioBytes: 193240 }),
    'extracted 16 kHz mono audio: 0.2 MB');
});

test('a long recording is warned about before the wait, and blamed on the model not the file', () => {
  assert.equal(longRunNote({ duration: LONG_RUN_SECONDS - 1, model: 'medium' }), null);
  assert.equal(longRunNote({ duration: 0, model: 'medium' }), null);
  const note = longRunNote({ duration: 3600, model: 'medium' });
  assert.match(note, /1:00:00 of audio at `medium`/);
  // The estimate is scaled by the measured table, not quoted from `medium` for
  // every size: `base` is ~8x faster, and saying "about an hour" for it is wrong
  // by most of an order of magnitude.
  assert.match(longRunNote({ duration: 3600, model: 'medium' }), /roughly 1:00:00 of wall time/);
  assert.match(longRunNote({ duration: 3600, model: 'base' }), /roughly 0:07:12 of wall time/);
  // An untimed size is told it is untimed rather than handed a made-up number.
  const untimed = longRunNote({ duration: 3600, model: 'tiny' });
  assert.match(untimed, /`tiny` has not been timed here/);
  assert.doesNotMatch(untimed, /roughly \d/);
  // The point of the sentence: shrinking the source does not shorten the wait.
  assert.match(note, /smaller source file does not shorten it, only a smaller --model does/);
});

test('_meta.md reports the container and the bytes the recognizer actually read', () => {
  const result = {
    duration: 1800, model: 'medium', device: 'cpu', compute_type: 'int8',
    language: 'en', language_probability: 0.99, transcribe_seconds: 1700, segments: [],
  };
  const md = buildMetaMd({
    source: 'master.mov', localPath: 'master.mov', bytes: 5e9, audioBytes: 57.6e6,
    result, warnings: [], keptSource: true, descriptive: null,
  });
  assert.match(md, /- \*\*Size:\*\* 4\.66 GB \(22\.2 Mbit\/s\)/);
  assert.match(md, /- \*\*Read by the recognizer:\*\* 54\.9 MB, extracted to 16 kHz mono before transcription — 87x less than the container/);

  // Where extraction did not happen, the file says so rather than staying silent
  // about which of the two numbers the run actually paid for.
  const fellBack = buildMetaMd({
    source: 'master.mov', localPath: 'master.mov', bytes: 5e9, audioBytes: 0,
    result, warnings: ['x'], keptSource: true, descriptive: null,
  });
  assert.match(fellBack, /Read by the recognizer:\*\* the whole container/);

  // And with no size known at all it stays quiet instead of guessing.
  const noBytes = buildMetaMd({
    source: 'a.mp4', localPath: 'a.mp4', bytes: 0, result, warnings: [],
    keptSource: true, descriptive: null,
  });
  assert.doesNotMatch(noBytes, /Read by the recognizer/);
});

// prepareAudio shells out to media_probe.py. The tests drive it through a stub
// interpreter instead: `py` is just {exe, args}, so a Node script standing in for
// Python exercises the real branching without needing PyAV on the test machine.
function stubPy(dir, { probe, wavBytes = 4096, failAudio = false }) {
  const script = join(dir, 'stub.mjs');
  writeFileSync(script, [
    "import { writeFileSync } from 'node:fs';",
    'const a = process.argv.slice(2);',
    'const cmd = a[1];',
    'const at = (n) => a[a.indexOf(n) + 1];',
    `if (cmd === 'probe') writeFileSync(at('--out'), ${JSON.stringify(JSON.stringify(probe))});`,
    "else if (cmd === 'audio') {",
    `  if (${failAudio}) process.exit(5);`,
    `  writeFileSync(at('--out'), Buffer.alloc(${wavBytes}));`,
    '}',
  ].join('\n'), 'utf8');
  return { exe: process.execPath, args: [script] };
}

test('prepareAudio hands the recognizer an extracted WAV, not the container', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-prep-'));
  try {
    const py = stubPy(dir, {
      probe: { duration: 1800, audio_index: 1, streams: [{ type: 'video' }, { type: 'audio' }] },
      wavBytes: 57600000,
    });
    const warnings = [];
    const audio = prepareAudio({
      py, mediaPath: join(dir, 'master.mov'), outDir: dir, bytes: 5e9, warnings, model: 'medium',
    });
    assert.equal(audio.extracted, true);
    assert.notEqual(audio.path, join(dir, 'master.mov'));
    assert.match(audio.path, /speech\.wav$/);
    assert.equal(audio.bytes, 57600000);
    assert.deepEqual(warnings, []);
    // The probe it ran is left where the descriptive pass expects to find it, so
    // that pass does not re-read the container to learn the same thing.
    assert.equal(existsSync(dataPath(dir, 'media.json')), true);
    assert.equal(audio.info.audio_index, 1);
    rmSync(audio.tempDir, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file with no audio stops before the model loads, not with an IndexError after it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-prep-'));
  try {
    const py = stubPy(dir, { probe: { duration: 3, audio_index: null, streams: [{ type: 'video' }] } });
    assert.throws(() => prepareAudio({
      py, mediaPath: join(dir, 'silent.mp4'), outDir: dir, bytes: 1e6,
      warnings: [], model: 'medium',
    }), (err) => {
      assert.equal(err.code, 2);
      assert.match(err.lines[0], /no audio stream/);
      assert.match(err.lines[1], /Streams in it: video\./);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed extraction falls back to the container rather than failing the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-prep-'));
  try {
    const media = join(dir, 'odd.mkv');
    const py = stubPy(dir, {
      probe: { duration: 60, audio_index: 2, streams: [{ type: 'audio' }] }, failAudio: true,
    });
    const warnings = [];
    const audio = prepareAudio({ py, mediaPath: media, outDir: dir, bytes: 1e6, warnings, model: 'medium' });
    assert.equal(audio.extracted, false);
    assert.equal(audio.path, media);
    assert.equal(audio.tempDir, null);
    assert.match(warnings[0], /stream 2 could not be extracted/);
    // The transcript is still produced; only the cheap path was lost.
    assert.match(warnings[0], /transcript is unaffected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a probe that fails leaves the container path open instead of stopping the run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-prep-'));
  try {
    const media = join(dir, 'weird.avi');
    const py = { exe: process.execPath, args: ['-e', 'process.exit(1)'] };
    const warnings = [];
    const audio = prepareAudio({ py, mediaPath: media, outDir: dir, bytes: 1e6, warnings, model: 'medium' });
    assert.equal(audio.extracted, false);
    assert.equal(audio.path, media);
    assert.equal(audio.info, null);
    assert.match(warnings[0], /stream probe failed/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
