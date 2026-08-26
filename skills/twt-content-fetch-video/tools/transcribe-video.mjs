#!/usr/bin/env node
// transcribe-video.mjs — deterministic transcript builder behind
// /twt-content-fetch-video. Downloading, transcribing, and paragraphing are
// mechanical; running them through the model would burn the whole transcript
// as context (a 90-minute talk is ~15k words) for a worse, non-reproducible
// result. The model reads the summary line, not the transcript.
//
//   node transcribe-video.mjs check [--python <exe>]
//     Preflight: report the Python interpreter and whether faster-whisper is
//     importable. Always exits 0; read the STATUS line.
//
//   node transcribe-video.mjs probe <path> [--python <exe>]
//     Report the media's stream layout — video, every audio track (flagging a
//     real audio-description track), and text vs bitmap subtitle streams.
//
//   node transcribe-video.mjs run <url-or-path> [<url-or-path> …] [--out-dir <dir>]
//        [--model base] [--language auto] [--title <name>] [--slug <slug>]
//        [--python <exe>] [--keep-source] [--force] [--verbatim] [--max-frames 60]
//        [--frame-gap 4] [--frame-width 960] [--frame-threshold 0.06]
//        [--frame-band-threshold 0.04] [--card-probe 1.6]
//     Resolve the source, transcribe it locally with faster-whisper, and write
//     index.md + segments.json + _meta.md + transcript.txt under <out-dir>/<slug>/.
//     --title/--slug name the output: a CDN filename ("main.mp4") makes a useless
//     slug, and correcting it afterwards by hand breaks the exists-check that
//     stops a re-run from duplicating itself. Signed-URL tokens are redacted out
//     of every file written. By default it also extracts the deterministic half
//     of a WCAG-style descriptive transcript: media.json, keyframes + frames.json,
//     captions.json from an embedded subtitle track, audio-description.md from a
//     real description track, speaker-turn candidates and non-speech spans in
//     segments.json, and outline.json. The prose transcript.md is written by the
//     model from those, window by window. --verbatim skips that extraction for a
//     speech-only run; --descriptive is accepted and ignored (it is the default).
//
//     SEVERAL SOURCES. Every positional is a source: file paths, URLs, or a
//     directory, which expands to the media files directly inside it. Each gets
//     its own <out-dir>/<slug>/ directory, named from its own filename, and one
//     failure never stops the others. The batch writes _batch-<date>.md at the
//     out-dir root and prints one JSON summary covering every source.
//     --title/--slug/--captions name a single recording, so they are refused
//     when more than one source is given.
//
//   node transcribe-video.mjs batch-index <out-dir> --slugs <a,b,c> [--file <name>]
//     Rewrite a batch index over those slugs. Run it again after the descriptive
//     passes are assembled so the index counts the speakers they actually found.
//
//   node transcribe-video.mjs slice <transcript-dir> [--window <n>]
//        [--from <t>] [--to <t>] [--window-seconds 300]
//     Print everything known about ONE window — its frames, speech, silences,
//     and caption cues — and nothing about any other. This is how the
//     descriptive pass reads a long recording without loading all of it.
//
//   node transcribe-video.mjs review <transcript-dir> [--word-budget 4000]
//     Print what the model needs to fill in PART 3's review half: the run-level
//     flags, the inconsistent name spellings, the low-confidence lines in context,
//     and — only under the word budget — the full text. A fluent mishearing scores
//     perfectly, so nothing mechanical can find it; this is the pass that can.
//
//   node transcribe-video.mjs annotate <transcript-dir> --notes <file>
//     Splice those findings into PART 3 of transcript.txt. The report stays
//     script-owned: prose arrives through this seam, never by editing the file.
//
// No npm dependencies — native fetch (Node 18+) plus the bundled Python workers.
// Exit 0 on success; 2 bad usage; 3 missing Python/faster-whisper;
// 4 output exists (pass --force); 1 anything else.
'use strict';
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "whisper_transcribe.py");
const PROBE = join(HERE, "media_probe.py");
const DEFAULT_OUT = ".twt-artifacts/pre-design/content/fetched/video";
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpe?g|m4a|mp3|wav|aac|ogg|opus|flac)$/i;
const UA = "Mozilla/5.0 (compatible; twt-content-fetch-video/1.0; +https://github.com/vadym-shliachkov/twt)";

// Paragraphing thresholds — tuned so a paragraph is a readable unit of speech,
// not one ASR segment (~5 seconds) and not a wall of text.
const GAP_SECONDS = 1.5;
const MIN_WORDS = 40;
const MAX_WORDS = 120;
const HARD_WORDS = 200;

// ---- CLI ----------------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0];
const BOOLEAN_FLAGS = new Set(["--keep-source", "--force", "--descriptive", "--verbatim", "--expect-descriptive"]);

function flag(name, dflt) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
function has(name) { return argv.includes(name); }
function allPositionals() {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { if (!BOOLEAN_FLAGS.has(argv[i])) i++; continue; }
    out.push(argv[i]);
  }
  return out;
}
function firstPositional() { return allPositionals()[0] ?? null; }
function usage(msg) {
  console.error(msg);
  console.error("Usage: transcribe-video.mjs check [--python <exe>]");
  console.error("       transcribe-video.mjs probe <path> [--python <exe>]");
  console.error("       transcribe-video.mjs run <url-or-path> [<url-or-path> …] [--out-dir <dir>]");
  console.error("           [--model base] [--language auto] [--title <name>] [--slug <slug>]");
  console.error("           [--python <exe>] [--keep-source] [--force] [--verbatim]");
  console.error("           [--max-frames 60] [--captions <url-or-path>]");
  console.error("       transcribe-video.mjs batch-index <out-dir> --slugs <a,b,c> [--file <name>]");
  console.error("           [--frame-gap 4] [--frame-width 960]");
  console.error("           [--frame-threshold 0.06] [--frame-band-threshold 0.04] [--card-probe 1.6]");
  console.error("  timeline <dir>            build timeline.md from transcript.md");
  console.error("       transcribe-video.mjs verify <transcript-dir> [--expect-descriptive]");
  console.error("       transcribe-video.mjs slice <transcript-dir> [--window <n> | --from <t> --to <t>]");
  console.error("           [--window-seconds 300]");
  console.error("       transcribe-video.mjs review <transcript-dir> [--word-budget 4000]");
  console.error("       transcribe-video.mjs annotate <transcript-dir> --notes <file>");
  process.exit(2);
}

// ---- Python discovery ----------------------------------------------------------

function probe(exe, args) {
  try {
    return spawnSync(exe, args, { encoding: "utf8", windowsHide: true });
  } catch {
    return { status: null, stdout: "", stderr: "" };
  }
}

// Returns {exe, args, version, executable} for the first interpreter that runs.
function findPython(explicit) {
  const candidates = explicit
    ? [[explicit, []]]
    : [["python", []], ["python3", []], ["py", ["-3"]]];
  for (const [exe, pre] of candidates) {
    const r = probe(exe, [...pre, "-c", "import sys; print(sys.version.split()[0]); print(sys.executable)"]);
    if (r.status === 0 && r.stdout.trim()) {
      const [version, executable] = r.stdout.trim().split(/\r?\n/);
      return { exe, args: pre, version, executable: executable || exe };
    }
  }
  return null;
}

function hasFasterWhisper(py) {
  const r = probe(py.exe, [...py.args, "-c", "import faster_whisper; print(faster_whisper.__version__)"]);
  return r.status === 0 ? (r.stdout.trim() || "unknown") : null;
}

function doCheck() {
  const py = findPython(flag("--python", null));
  if (!py) {
    console.log("python: NOT FOUND");
    console.log("STATUS: missing-python");
    console.log("Install Python 3.9-3.14 from https://www.python.org/downloads/ and re-run this check.");
    return;
  }
  console.log(`python: ${py.version} (${py.executable})`);
  const fw = hasFasterWhisper(py);
  if (!fw) {
    console.log("faster-whisper: NOT INSTALLED");
    console.log("STATUS: missing-package");
    console.log(`Install with: ${py.exe} -m pip install faster-whisper`);
    console.log("It pulls ctranslate2, av, onnxruntime and friends (~200MB). No system ffmpeg needed —");
    console.log("av decodes the media. The first run of each model size then downloads its weights.");
    return;
  }
  console.log(`faster-whisper: ${fw}`);
  console.log("STATUS: ok");
}

// ---- Source resolution ---------------------------------------------------------

export function slugify(s) {
  return (s || "video").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";
}

export function extFromContentType(ct) {
  const map = {
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    "video/x-matroska": ".mkv", "video/mpeg": ".mpeg", "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/flac": ".flac",
  };
  return map[(ct || "").split(";")[0].trim().toLowerCase()] || ".mp4";
}

function nameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "video");
}

// Query params whose *values* are credentials — signed-CDN tokens and the
// expiry/policy/signature triples that travel with them. A signed URL is a
// bearer credential, and everything under .twt-artifacts/ is written to disk and
// usually committed, so the value never reaches an artifact. The parameter name
// stays: knowing the URL *was* signed is what tells a reader why it 403s later.
const SECRET_PARAM = /(^|[_.-])(tokens?|sig|signature|keys?|secret|expires?|policy|auth|hmac|password|passwd|credential|session|nonce)([_.-]|\d*$|$)/i;

export function redactUrl(source) {
  if (!/^https?:\/\//i.test(source || "")) return { url: source, redacted: [] };
  let u;
  try { u = new URL(source); } catch { return { url: source, redacted: [] }; }
  const redacted = [];
  for (const key of [...u.searchParams.keys()]) {
    if (!SECRET_PARAM.test(key) || u.searchParams.get(key) === "") continue;
    u.searchParams.set(key, "REDACTED");
    redacted.push(key);
  }
  return { url: u.toString(), redacted: [...new Set(redacted)] };
}

// The filename alone — never the query string, which is where the token lives.
export function sourceLabel(source) {
  if (/^https?:\/\//i.test(source || "")) {
    try { return nameFromUrl(source); } catch { /* not parseable; fall through */ }
  }
  return basename(source || "") || "media";
}

// CDN paths bottom out in placeholder filenames, so the slug a URL yields is
// routinely meaningless ("main", "index", a bare hash). Naming that case is the
// difference between a re-run finding its own output and silently duplicating it.
const GENERIC_NAME = /^(main|video|audio|index|master|playlist|file|files|output|movie|media|download|source|stream|hls|dash|manifest|chunk|part|clip|untitled|tmp|temp|\d+|[0-9a-f]{8,}|[0-9a-f-]{20,})$/i;
export function isGenericName(name) {
  return GENERIC_NAME.test(String(name || "").trim());
}

async function downloadTo(url, dir) {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("download failed: empty response body");
  const ct = res.headers.get("content-type") || "";
  if (/^text\/html/i.test(ct)) {
    throw new Error(`the URL returned an HTML page, not a media file (content-type: ${ct}). ` +
      "This skill takes a direct link to a video/audio file, not a player or watch page.");
  }
  let name = nameFromUrl(url);
  if (!MEDIA_EXT.test(name)) name += extFromContentType(ct);
  const dest = join(dir, name.replace(/[<>:"|?*\\/]/g, "-"));
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return { path: dest, contentType: ct, bytes: statSync(dest).size };
}

// ---- Transcript assembly -------------------------------------------------------

export function fmtTime(seconds, forceHours) {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h || forceHours)
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function endsSentence(text) { return /[.!?…"')\]]\s*$/.test(text); }
function wordCount(text) { return text.split(/\s+/).filter(Boolean).length; }

// Group ASR segments into paragraphs: break on a real pause at a sentence end,
// or on length once a sentence ends, or unconditionally if the recognizer never
// produced punctuation.
export function paragraphize(segments, { turnBoundaries = [] } = {}) {
  const paras = [];
  const bounds = [...turnBoundaries].sort((a, b) => a - b);
  let cur = null;
  for (const seg of segments) {
    if (!cur) { cur = { start: seg.start, end: seg.end, text: seg.text }; continue; }
    const gap = seg.start - cur.end;
    const words = wordCount(cur.text);
    // A handover always ends the paragraph, however short that leaves it. A
    // paragraph running across a speaker change carries one timestamp and two
    // people, and anything quoting it attributes half of it to the wrong one.
    const handover = bounds.some((b) => b > cur.start && b <= seg.start + 0.001);
    const done = handover
      || words >= HARD_WORDS
      || (endsSentence(cur.text) && (words >= MAX_WORDS || (gap >= GAP_SECONDS && words >= MIN_WORDS)));
    if (done) {
      paras.push(cur);
      cur = { start: seg.start, end: seg.end, text: seg.text };
    } else {
      cur.text += " " + seg.text;
      cur.end = seg.end;
    }
  }
  if (cur) paras.push(cur);
  return paras;
}

// ---- descriptive-pass structure ------------------------------------------------
// None of this decides what the recording *means* — it marks where a turn, a
// silence, or a visual change happened so the descriptive pass can look there.

// A pause long enough to be a handover. The shorter threshold applies only when
// the previous segment closed a sentence; mid-sentence pauses are just breath.
export const TURN_GAP_SENTENCE = 0.9;
export const TURN_GAP_ANY = 2.0;
// Silence worth marking as a non-speech span in the transcript.
export const GAP_MIN_SECONDS = 3.0;
// How much recording the descriptive pass reads and looks at in one go.
export const WINDOW_SECONDS = 300;

// Speaker-turn *candidates*, not speaker identities: numbered handover points
// the descriptive pass clusters into named speakers from context.
export function assignTurns(segments) {
  let turn = 0;
  let prev = null;
  return segments.map((seg) => {
    if (prev) {
      const gap = seg.start - prev.end;
      if (gap >= TURN_GAP_ANY || (gap >= TURN_GAP_SENTENCE && endsSentence(prev.text))) turn += 1;
    }
    prev = seg;
    return { ...seg, turn };
  });
}

// Spans with no speech in them — where music, effects, or on-screen-only action
// live. A gap before the first segment counts: titles and stings open there.
export function nonSpeechGaps(segments, duration, min = GAP_MIN_SECONDS) {
  const gaps = [];
  let end = 0;
  for (const seg of segments) {
    if (seg.start - end >= min) gaps.push({ start: round3(end), end: round3(seg.start) });
    end = Math.max(end, seg.end);
  }
  if (duration && duration - end >= min) gaps.push({ start: round3(end), end: round3(duration) });
  return gaps;
}

function round3(n) { return Math.round((n || 0) * 1000) / 1000; }
function words(text, n) { return text.split(/\s+/).filter(Boolean).slice(0, n).join(" "); }
function lastWords(text, n) {
  const all = text.split(/\s+/).filter(Boolean);
  return all.slice(Math.max(0, all.length - n)).join(" ");
}
const inWindow = (t, w) => t >= w.start && t < w.end;

// A bounded planning digest: one row per window, never the transcript itself.
// A 90-minute recording outlines to ~18 rows — small enough to read whole.
export function buildOutline({ segments, gaps = [], frames = [], captions = [],
  duration, windowSeconds = WINDOW_SECONDS }) {
  const turned = segments[0] && "turn" in segments[0] ? segments : assignTurns(segments);
  const span = duration || (turned.length ? turned[turned.length - 1].end : 0);
  const count = Math.max(1, Math.ceil(span / windowSeconds));
  const windows = [];
  for (let i = 0; i < count; i++) {
    const w = { start: i * windowSeconds, end: Math.min(span, (i + 1) * windowSeconds) };
    const mine = turned.filter((s) => inWindow(s.start, w));
    const text = mine.map((s) => s.text).join(" ");
    windows.push({
      n: i + 1,
      start: fmtTime(w.start, span >= 3600),
      end: fmtTime(w.end, span >= 3600),
      words: wordCount(text),
      turns: mine.length ? [mine[0].turn, mine[mine.length - 1].turn] : [],
      frames: frames.filter((f) => inWindow(f.t, w)).map((f) => f.file),
      non_speech_spans: gaps.filter((g) => inWindow(g.start, w)).length,
      caption_cues: captions.filter((c) => inWindow(c.start, w)).length,
      opens: mine.length ? words(text, 18) : "(no speech)",
      closes: mine.length ? lastWords(text, 12) : "",
    });
  }
  return { duration: fmtTime(span, true), window_seconds: windowSeconds, windows };
}

// "90" | "1:30" | "1:02:03" -> seconds.
export function parseTime(value) {
  const raw = String(value ?? "").trim().split(":");
  // Number("") is 0, so an empty field has to be rejected before the conversion.
  if (!raw.length || raw.some((p) => p === "")) return null;
  const parts = raw.map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// The descriptive pass's read primitive: everything known about ONE window and
// nothing about any other, so a long recording never lands in context at once.
export function buildSlice({ from, to, duration, segments, gaps = [], frames = [],
  captions = [], framesDir = "frames" }) {
  const forceHours = (duration || 0) >= 3600;
  const at = (t) => fmtTime(t, forceHours);
  const w = { start: from, end: to };
  const turned = segments[0] && "turn" in segments[0] ? segments : assignTurns(segments);
  const mine = turned.filter((s) => inWindow(s.start, w));

  const lines = [`## Window ${at(from)}–${at(to)} of ${fmtTime(duration, true)}`, ""];

  const shots = frames.filter((f) => inWindow(f.t, w));
  lines.push(shots.length
    ? `### Frames in this window (${shots.length}) — view each before writing\n`
      + shots.map((f) => `- ${at(f.t)} — ${framesDir}/${f.file}`).join("\n")
    : "### Frames in this window\n- None (audio-only source, or no frame fell in this window).");
  lines.push("");

  // Speech and silence on one timeline, so a silence is never mistaken for a cut.
  // Paragraphs stop at every turn boundary here — unlike index.md, which reads as
  // continuous prose — because a handover is exactly where the speaker may change.
  lines.push("### Speech and silence");
  const byTurn = [];
  for (const seg of mine) {
    const last = byTurn[byTurn.length - 1];
    if (last && last.turn === seg.turn) last.segs.push(seg);
    else byTurn.push({ turn: seg.turn, segs: [seg] });
  }
  const events = [
    ...byTurn.flatMap((t) => paragraphize(t.segs)
      .map((p) => ({ t: p.start, kind: "speech", p, turn: t.turn }))),
    ...gaps.filter((g) => inWindow(g.start, w)).map((g) => ({ t: g.start, kind: "gap", g })),
  ].sort((a, b) => a.t - b.t);
  if (!events.length) lines.push("_Nothing in this window._");
  for (const ev of events) {
    if (ev.kind === "gap") {
      lines.push(`\n_[no speech ${at(ev.g.start)}–${at(ev.g.end)} — ${Math.round(ev.g.end - ev.g.start)}s]_`);
      continue;
    }
    lines.push(`\n**[${at(ev.p.start)}]** _(turn ${ev.turn})_ ${ev.p.text}`);
  }

  const cues = captions.filter((c) => inWindow(c.start, w));
  if (cues.length) {
    lines.push("", `### Embedded caption cues (${cues.length}) — the file's own subtitle track`,
      ...cues.map((c) => `- **[${at(c.start)}]** ${c.text}`));
  }
  return lines.join("\n") + "\n";
}

// An explicit --title always wins: prettifying a slug is a fallback, not a guess
// to be overridden later by hand — index.md is script-owned and stays that way.
export function titleFrom(slug, explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  return slug.split("-").filter(Boolean)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ") || "Transcript";
}

// index.md is what the rest of the pipeline reads — curation, the fact ledger,
// every define skill downstream. So it carries the best text available, not
// whichever text this tool happened to produce: where the publisher shipped a
// caption track, those are the words, and the recognizer's attempt stays in
// segments.json and the report. `text_source` says which one a reader is holding,
// because "the machine guessed this" and "the publisher wrote this" are not the
// same claim and must not look alike.
export function buildIndexMd({ source, slug, title, result, fetchedAt, captionSegments: captions }) {
  const forceHours = (result.duration || 0) >= 3600;
  const fromCaptions = Boolean(captions && captions.length);
  // Turn candidates come from the recognizer's timings either way — the caption
  // track is the better *words*, but it carries no handover information at all.
  const turned = assignTurns(result.segments);
  const turnBoundaries = turned
    .filter((seg, i) => i && seg.turn !== turned[i - 1].turn)
    .map((seg) => seg.start);
  const paras = paragraphize(fromCaptions ? captions : result.segments, { turnBoundaries });
  const name = titleFrom(slug, title);
  const body = paras.length
    ? paras.map((p) => `**[${fmtTime(p.start, forceHours)}]** ${p.text}`).join("\n\n")
    : "_No speech was detected in this file._";
  const fm = [
    "---",
    `source: ${redactUrl(source).url}`,
    "type: video",
    `title: ${name}`,
    `duration: ${fmtTime(result.duration, true)}`,
    `language: ${result.language || "unknown"}`,
    "engine: faster-whisper",
    `model: ${result.model}`,
    `text_source: ${fromCaptions ? "publisher-captions" : "speech-recognition"}`,
    fromCaptions ? `captions: ${CAPTIONS_FILE}` : null,
    `segments: ${result.segments.length}`,
    `fetched_at: ${fetchedAt}`,
    "---",
  ].filter((l) => l !== null).join("\n");
  const note = fromCaptions
    ? "_The text below is the publisher's own caption track — written by a person, not guessed "
      + "from the audio. The speech-recognition attempt, and every place the two disagree, are "
      + "in `transcript.txt`._\n\n"
    : "";
  return `${fm}\n\n# ${name}\n\n${note}${body}\n`;
}

// The settings the decode actually ran with. They are recorded rather than
// assumed because the same file, model and machine can still come back as 24
// segments one run and 31 the next: CTranslate2's CPU kernels vary with thread
// count, so pinned settings narrow the drift without abolishing it. Saying which
// build produced the file matters for the same reason — whether the payload
// carries confidence scores at all is a property of the build, not the audio.
function decodeLines(result) {
  const d = result.decode;
  const out = [];
  if (d) {
    const bits = [];
    if (d.beam_size != null) bits.push(`beam_size ${d.beam_size}`);
    if (d.temperature != null) bits.push(`temperature ${d.temperature}`);
    if (d.condition_on_previous_text != null) {
      bits.push(`condition_on_previous_text ${d.condition_on_previous_text ? "on" : "off"}`);
    }
    if (d.vad_filter != null) bits.push(`VAD ${d.vad_filter ? "on" : "off"}`);
    if (bits.length) out.push(`- **Decode:** ${bits.join(", ")}`);
  }
  if (result.faster_whisper) out.push(`- **Engine build:** faster-whisper ${result.faster_whisper}`);
  if (out.length) {
    out.push("- **Reproducibility:** pinned decode settings make two runs comparable, but they are "
      + "not guaranteed to reproduce byte for byte — CPU kernels vary with thread count, so a re-run "
      + "can segment the same speech differently.");
  }
  return out;
}

export function buildMetaMd({ source, localPath, bytes, result, warnings, keptSource, descriptive }) {
  const src = redactUrl(source);
  const extras = descriptive ? [
    "",
    "## Descriptive-pass inputs",
    "",
    `- **Keyframes extracted:** ${descriptive.frames}`,
    `- **Embedded caption cues:** ${descriptive.captions}`,
    `- **Audio-description track:** ${descriptive.audio_description ? "found and transcribed to `audio-description.md`" : "none in this file"}`,
    `- **Speaker-turn candidates:** ${descriptive.turns ?? 0} (pause-derived — boundaries are approximate and unnamed)`,
    `- **Non-speech spans:** ${descriptive.non_speech_spans ?? 0}`,
    `- **Reading windows:** ${descriptive.windows ?? 0}`,
    "",
    "> Sounds are inferred from silence and picture, not from an audio-event classifier:",
    "> an off-screen noise with nothing on screen to show it can be missed. Speaker turns",
    "> mark where a handover probably happened, not who spoke.",
  ] : [];
  const lines = [
    `# Transcript metadata — ${sourceLabel(source)}`,
    "",
    `- **Source:** ${src.url}`,
    src.redacted.length
      ? `- **Signed URL:** the \`${src.redacted.join("`, `")}\` value${src.redacted.length > 1 ? "s were" : " was"} redacted above — it is a time-limited credential and does not belong in a committed artifact. The link will not re-fetch as written.`
      : null,
    `- **Local media:** ${keptSource ? localPath : "downloaded to a temp file and deleted after transcription"}`,
    bytes ? `- **Size:** ${(bytes / 1048576).toFixed(1)} MB` : null,
    `- **Duration:** ${fmtTime(result.duration, true)}`,
    `- **Engine:** faster-whisper (local, offline) — model \`${result.model}\`, ${result.device}/${result.compute_type}`,
    `- **Language:** ${result.language || "unknown"} (detection confidence ${result.language_probability})`,
    `- **Segments:** ${result.segments.length}`,
    `- **Transcription wall time:** ${result.transcribe_seconds}s`,
    ...decodeLines(result),
    ...extras,
    "",
    "## Warnings",
    "",
    warnings.length ? warnings.map((w) => `- ${w}`).join("\n") : "- None.",
    "",
    "> Machine transcription. Names, jargon, and numbers are the least reliable parts —",
    "> verify anything you plan to quote or treat as fact against the source recording.",
  ];
  return lines.filter((l) => l !== null).join("\n") + "\n";
}

// ---- possible-issue detection --------------------------------------------------
// Everything here is *mechanical*: the recognizer's own confidence scores plus
// two text patterns it is known to fail on. None of it understands the words, so
// a fluent mishearing ("by depth" for "by death") scores perfectly and is invisible
// to this pass — that is what the assistant's review half of PART 3 is for.

export const LOW_CONFIDENCE = -0.9;       // avg_logprob: the decoder struggled here
export const VERY_LOW_CONFIDENCE = -1.15; // …and here it was mostly guessing
export const NO_SPEECH_PROB = 0.6;        // probably nothing was said — likely invented
export const COMPRESSION_LOOP = 2.4;      // Whisper's classic repetition failure
export const REPEAT_RUN = 3;              // identical lines in a row
export const MAX_VARIANT_GROUPS = 8;
export const MAX_FLAGGED_SEGMENTS = 40;

function normWord(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// Names, as runs of capitalized words that are not sentence-initial plus all-caps
// acronyms anywhere. Skipping position 0 of each sentence is what keeps "The",
// "We" and every other ordinary sentence opener out of the name list.
//
// Each run yields its individual words *and* the phrases inside it. Both are
// needed: individual words are how "Grief-Sensitive" in the title meets "Grief
// Sensitive" in the speech, while phrases are how a mangled multi-word name meets
// its correct spelling — "Grief Senses Schools Initiative" only ever looks wrong
// next to "Grief-Sensitive Schools Initiative", never one word at a time
// ("Senses" and "Sensitive" are too far apart to pair on their own).
//
// A run longer than the cap yields every window up to the cap rather than
// nothing. A title is one long uninterrupted run ("New York Life Foundation's
// Grief-Sensitive Schools Initiative"), and dropping it whole used to leave the
// title contributing single words only — so the one comparison that matters, the
// publisher's own spelling of the program against the recognizer's, never
// happened.
export const MAX_PHRASE_TOKENS = 5;

export function properPhrases(text) {
  const found = [];
  const emit = (run) => {
    for (const tok of run) found.push(tok);
    if (run.length <= MAX_PHRASE_TOKENS) {
      if (run.length > 1) found.push(run.join(" "));
      return;
    }
    for (let n = 2; n <= MAX_PHRASE_TOKENS; n++) {
      for (let i = 0; i + n <= run.length; i++) found.push(run.slice(i, i + n).join(" "));
    }
  };
  for (const sentence of String(text || "").split(/(?<=[.!?…])\s+/)) {
    // ® and ™ are deliberately outside the token: a title's "Initiative®" and a
    // speaker's "Initiative" are the same spelling, and grouping them as rival
    // ones would bury the real findings under trademark symbols.
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’&-]*/gu) || [];
    let run = [];
    tokens.forEach((tok, i) => {
      const capitalized = /^\p{Lu}/u.test(tok) && (i > 0 || /^\p{Lu}{2,}$/u.test(tok));
      if (capitalized) { run.push(tok); return; }
      if (run.length) { emit(run); run = []; }
    });
    if (run.length) emit(run);
  }
  // Anything shorter than four letters is as likely to be a sentence artefact as
  // a name, and grouping those produces noise rather than findings.
  return [...new Set(found)].filter((p) => normWord(p).length >= 4);
}

// Group spellings that are probably the same name. Identical spellings collapse
// first, so the distance pass runs over distinct phrases rather than every
// mention. The shared-prefix guard is what keeps two genuinely different words of
// similar length out of one group.
export function groupNameVariants(mentions) {
  const distinct = new Map();
  for (const m of mentions) {
    if (!normWord(m.phrase)) continue;
    if (!distinct.has(m.phrase)) distinct.set(m.phrase, []);
    distinct.get(m.phrase).push(m.where);
  }

  const groups = [];
  for (const [phrase, where] of distinct) {
    const key = normWord(phrase);
    const form = { phrase, where };
    const hit = groups.find((g) => {
      const dist = levenshtein(g.key, key);
      if (dist === 0) return true;
      // "New York Life" inside "New York Life's GSSI" is the same name said at
      // more length, not a second spelling of it.
      if (g.key.includes(key) || key.includes(g.key)) return false;
      const shorter = Math.min(g.key.length, key.length);
      return dist <= Math.max(2, Math.floor(Math.max(g.key.length, key.length) * 0.34))
        && commonPrefix(g.key, key) >= Math.min(4, shorter);
    });
    if (hit) hit.forms.push(form);
    else groups.push({ key, forms: [form] });
  }

  // A plural needs no rule of its own: "Coalitions" contains "Coalition", so the
  // containment guard above has already kept the two apart.
  return groups.filter((g) => g.forms.length > 1);
}

// Returns {segments: [...], run: [...]} — per-segment findings anchored to a
// timestamp, and findings about the run as a whole.
export function detectIssues({ segments = [], duration = 0, language_probability: langProb,
  model, title, warnings = [] } = {}) {
  const forceHours = (duration || 0) >= 3600;
  const at = (t) => fmtTime(t, forceHours);
  const flagged = new Map();
  const add = (seg, severity, note) => {
    const key = seg.start;
    if (!flagged.has(key)) {
      flagged.set(key, { start: seg.start, at: at(seg.start), text: seg.text, severity, notes: [] });
    }
    const entry = flagged.get(key);
    if (severity === "high") entry.severity = "high";
    entry.notes.push(note);
  };

  for (const seg of segments) {
    if (typeof seg.avg_logprob === "number") {
      if (seg.avg_logprob < VERY_LOW_CONFIDENCE) {
        add(seg, "high", `the recognizer had very low confidence here (avg_logprob ${seg.avg_logprob.toFixed(2)}) — treat the whole line as unreliable`);
      } else if (seg.avg_logprob < LOW_CONFIDENCE) {
        add(seg, "medium", `low recognizer confidence (avg_logprob ${seg.avg_logprob.toFixed(2)})`);
      }
    }
    if (typeof seg.no_speech_prob === "number" && seg.no_speech_prob > NO_SPEECH_PROB) {
      add(seg, "high", `probably no speech here (no_speech_prob ${seg.no_speech_prob.toFixed(2)}) — this line may have been invented over music or silence`);
    }
    if (typeof seg.compression_ratio === "number" && seg.compression_ratio > COMPRESSION_LOOP) {
      add(seg, "high", `repetition loop (compression_ratio ${seg.compression_ratio.toFixed(2)}) — the decoder was repeating itself, not transcribing`);
    }
  }

  // Identical lines in a row: a loop the compression ratio can miss when each
  // individual segment is short.
  let runStart = 0;
  for (let i = 1; i <= segments.length; i++) {
    const same = i < segments.length && normWord(segments[i].text) === normWord(segments[runStart].text);
    if (same) continue;
    const len = i - runStart;
    if (len >= REPEAT_RUN && normWord(segments[runStart].text)) {
      add(segments[runStart], "high",
        `the same line repeats ${len} times in a row (through ${at(segments[i - 1].end)}) — almost always a decoding loop, not speech`);
    }
    runStart = i;
  }

  // Name spellings. The title is a mention like any other, and usually the
  // *correct* one: it comes from the publisher, not from the recognizer.
  const mentions = [];
  for (const phrase of properPhrases(title || "")) mentions.push({ phrase, where: "the title" });
  for (const seg of segments) {
    for (const phrase of properPhrases(seg.text)) mentions.push({ phrase, where: at(seg.start) });
  }
  const variants = groupNameVariants(mentions).slice(0, MAX_VARIANT_GROUPS);

  const run = [];
  // The caller's warnings often already say this; two phrasings of one fact read
  // as two problems.
  if (!segments.length && !warnings.some((w) => /no speech was detected/i.test(w))) {
    run.push("No speech was detected at all — the transcript is empty.");
  }
  // A build that reports no confidence at all produces an empty flagged-lines
  // section, which is exactly what a clean transcript produces. Saying so at the
  // run level is what keeps "nothing was flagged" from reading as "nothing is
  // wrong" when in truth nothing was ever checked.
  const scored = segments.some((s) => typeof s.avg_logprob === "number");
  if (segments.length && !scored && !warnings.some((w) => /no per-segment confidence/i.test(w))) {
    run.push("The recognizer returned no per-segment confidence scores, so no line could be "
      + "flagged mechanically — the empty section below means unchecked, not clean. The review "
      + "is the only thing standing between this transcript and an undetected mishearing.");
  }
  if (typeof langProb === "number" && langProb < 0.75) {
    run.push(`Language detection was not confident (${langProb}) — if the language is wrong, everything downstream of it is too. Re-run with --language <code>.`);
  }
  if (["tiny", "base"].includes(model)) {
    run.push(`Transcribed with the \`${model}\` model, which is the error-prone end of the range. Re-run with --model small (or medium) before quoting any of this.`);
  }
  for (const w of warnings) run.push(w);

  const bySeverity = { high: 0, medium: 0 };
  for (const f of flagged.values()) bySeverity[f.severity] += 1;
  return {
    segments: [...flagged.values()].sort((a, b) => a.start - b.start).slice(0, MAX_FLAGGED_SEGMENTS),
    variants,
    run,
    truncated: Math.max(0, flagged.size - MAX_FLAGGED_SEGMENTS),
    counts: { ...bySeverity, variants: variants.length, run: run.length },
    scored,
  };
}

// ---- the plain-text report -----------------------------------------------------

export const REPORT_WIDTH = 78;
// How much speech the review pass will read whole. Under this, proofreading the
// transcript end to end is cheap and catches fluent mishearings nothing else can;
// over it, the review is confined to the flagged excerpts and says so in PART 3.
// ~4000 words is roughly 25 minutes of speech.
export const REVIEW_WORD_BUDGET = 4000;
export const REVIEW_HEADING = "REVIEW BY THE ASSISTANT";
export const REVIEW_PENDING = "Not yet reviewed.";
const RULE = "=".repeat(REPORT_WIDTH);
const THIN = "-".repeat(REPORT_WIDTH);

export function wrapText(text, width = REPORT_WIDTH, indent = "") {
  const out = [];
  let line = "";
  for (const word of String(text || "").split(/\s+/).filter(Boolean)) {
    if (!line) { line = word; continue; }
    if ((indent + line + " " + word).length > width) { out.push(indent + line); line = word; }
    else line += " " + word;
  }
  if (line) out.push(indent + line);
  return out.length ? out : [indent.trimEnd()];
}

function field(label, value, width = 19) {
  const dots = label + " " + ".".repeat(Math.max(1, width - label.length - 1));
  const wrapped = wrapText(value, REPORT_WIDTH - width - 2, "");
  return wrapped.map((l, i) => (i === 0 ? `${dots} ${l}` : `${" ".repeat(width + 1)}${l}`));
}

function part(n, heading) { return [RULE, `PART ${n} - ${heading}`, RULE, ""]; }

// The whole run in one human-readable file: what was said, when it was said, and
// what about it should not be trusted. PART 1 deliberately carries no timestamps —
// it is the version you read; PART 2 is the version you cite.
export function buildReportTxt({ source, slug, title, result, warnings = [], issues,
  fetchedAt, bytes, descriptive, review, captionDiff }) {
  const name = titleFrom(slug, title);
  const src = redactUrl(source);
  const forceHours = (result.duration || 0) >= 3600;
  const paras = paragraphize(result.segments);
  const totalWords = result.segments.reduce((n, s) => n + wordCount(s.text), 0);
  const L = [RULE, "TRANSCRIPT", ...wrapText(name), RULE, "", "SOURCE DETAILS", THIN];

  L.push(...field("Source", src.url));
  if (src.redacted.length) {
    L.push(...field("Redacted", `the ${src.redacted.join(", ")} value${src.redacted.length > 1 ? "s are" : " is"} a time-limited credential and is not stored; this link will not re-fetch as written`));
  }
  L.push(...field("Title", name));
  L.push(...field("Slug", slug));
  L.push(...field("Duration", `${fmtTime(result.duration, true)} (${Math.round(result.duration || 0)} seconds)`));
  if (bytes) L.push(...field("Media size", `${(bytes / 1048576).toFixed(1)} MB`));
  if (descriptive) {
    L.push(...field("Descriptive pass", `${descriptive.frames} keyframes, ${descriptive.captions} embedded caption cues, `
      + `audio-description track ${descriptive.audio_description ? "found" : "absent"} — see transcript.md`));
  }

  L.push("", "TRANSCRIPTION DETAILS", THIN);
  L.push(...field("Engine", "faster-whisper (runs locally and offline)"));
  L.push(...field("Model", `${result.model}   (device: ${result.device}, compute: ${result.compute_type})`));
  L.push(...field("Language", `${result.language || "unknown"}  (detection confidence ${result.language_probability})`));
  L.push(...field("Segments", String(result.segments.length)));
  L.push(...field("Words", String(totalWords)));
  L.push(...field("Processing time", `${result.transcribe_seconds}s`));
  L.push(...field("Transcribed on", fetchedAt));
  L.push("", "");

  L.push(...part(1, "FULL TRANSCRIPT (continuous, for reading)"));
  if (!paras.length) L.push("No speech was detected in this file.");
  paras.forEach((p, i) => {
    if (i) L.push("");
    L.push(...wrapText(p.text));
  });
  L.push("", "");

  L.push(...part(2, `TIMESTAMPED SEGMENTS (all ${result.segments.length} items)`));
  if (!result.segments.length) L.push("None.");
  else {
    L.push("  #   START - END      TEXT", "  " + THIN.slice(2));
    result.segments.forEach((seg, i) => {
      const head = `${String(i + 1).padStart(5)}  ${fmtTime(seg.start, forceHours)} - ${fmtTime(seg.end, forceHours)}   `;
      const body = wrapText(seg.text, REPORT_WIDTH - head.length);
      L.push(...body.map((l, j) => (j === 0 ? head + l : " ".repeat(head.length) + l)), "");
    });
  }
  L.push("");

  L.push(...part(3, "POSSIBLE ISSUES (verify before quoting)"));
  L.push(...wrapText("Nothing below is a correction — the transcript is left exactly as the "
    + "recognizer produced it. These are the places most likely to be wrong."), "");
  L.push(...renderCaptionDiff(captionDiff));
  L.push(...renderIssues(issues, result));
  L.push("", THIN, REVIEW_HEADING, THIN, "");
  L.push(...(review ? wrapReview(review) : [REVIEW_PENDING,
    ...wrapText("The mechanical checks above cannot hear the words: a confident mishearing "
      + "reads as ordinary text and scores perfectly. A read-through by the assistant fills "
      + "this section in.")]));
  L.push("", RULE, "END OF REPORT", RULE);
  // Sections append their own trailing blank, so an omitted subsection leaves a
  // gap wide enough to read as a missing chunk. Two blank lines is the maximum.
  return L.join("\n").replace(/\n{4,}/g, "\n\n\n") + "\n";
}

function whereList(where) {
  const places = [...new Set(where)];
  if (places.length === 1 && places[0] === "the title") return "from the title";
  const title = places.includes("the title");
  const times = places.filter((p) => p !== "the title");
  // Listing four and saying "and 1 more" wastes the reader's time; only elide
  // once there is enough left over to be worth eliding.
  const keep = times.length > 7 ? 6 : times.length;
  const shown = times.slice(0, keep).join(", ");
  const more = times.length > keep ? ` and ${times.length - keep} more` : "";
  if (!times.length) return "from the title";
  return `${title ? "from the title, and " : ""}spoken at ${shown}${more}`;
}

// The strongest finding in the report when it exists, so it goes first: unlike
// everything below it, each line here is a second account of the same audio
// disagreeing with the first. That is the only mechanical check that can catch a
// mishearing the recognizer was confident about.
function renderCaptionDiff(diff) {
  if (!diff) return [];
  const L = ["THE PUBLISHER'S OWN CAPTIONS DISAGREE HERE", ""];
  if (!diff.length) {
    L.push(...wrapText("The publisher's caption track and the recognizer agree on every word "
      + "(punctuation and casing aside). That is the strongest signal in this report — two "
      + "independent accounts of the same audio saying the same thing."), "");
    return L;
  }
  L.push(...wrapText(`${diff.length} place${diff.length > 1 ? "s" : ""} where the two differ. The `
    + "captions were written by a person and the transcript was guessed from audio, so where they "
    + "disagree the captions are usually right — and `index.md` already carries the caption "
    + "wording. PARTS 1 and 2 above deliberately still show what the recognizer said."), "");
  for (const f of diff) {
    L.push(`  [${f.at}]`);
    L.push(...wrapText(`recognizer: ${f.asr ? `"${f.asr}"` : "(nothing — it dropped this)"}`, REPORT_WIDTH, "        "));
    L.push(...wrapText(`captions:   ${f.captions ? `"${f.captions}"` : "(nothing — the recognizer added this)"}`, REPORT_WIDTH, "        "));
    L.push("");
  }
  return L;
}

function renderIssues(issues, result) {
  if (!issues) return ["Not checked."];
  const L = [];
  if (issues.run.length) {
    L.push("ABOUT THE RUN", "");
    for (const r of issues.run) {
      const [first, ...rest] = wrapText(r, REPORT_WIDTH - 2);
      L.push(`- ${first}`, ...rest.map((l) => `  ${l}`), "");
    }
  }
  if (issues.variants.length) {
    L.push("NAMES SPELLED MORE THAN ONE WAY", "");
    L.push(...wrapText("Each group below is one name the recognizer wrote in several ways. "
      + "At most one spelling is right; where the title is in the group, it is usually that one."), "");
    for (const g of issues.variants) {
      for (const f of g.forms) L.push(...wrapText(`  "${f.phrase}" — ${whereList(f.where)}`, REPORT_WIDTH, "  "));
      L.push("");
    }
  }
  if (issues.segments.length) {
    L.push("LINES THE RECOGNIZER WAS UNSURE OF", "");
    for (const f of issues.segments) {
      L.push(`  [${f.at}]  ${f.severity === "high" ? "!!" : "! "}`);
      L.push(...wrapText(`"${f.text}"`, REPORT_WIDTH, "        "));
      for (const n of f.notes) L.push(...wrapText(`-> ${n}`, REPORT_WIDTH, "        "));
      L.push("");
    }
    if (issues.truncated > 0) {
      L.push(...wrapText(`  … and ${issues.truncated} more flagged lines, not listed. When this many `
        + "lines score badly the problem is usually the audio or the model size, not "
        + "individual words — re-run with a larger model."), "");
    }
  } else if (!issues.scored && !issues.run.some((r) => /no per-segment confidence/i.test(r))) {
    L.push(...wrapText("The recognizer returned no per-segment confidence scores in this run, "
      + "so no lines could be flagged mechanically."), "");
  } else if (!issues.variants.length && !issues.run.length) {
    L.push(...wrapText("No mechanical check flagged anything: every line scored within normal "
      + "confidence, no name was spelled two ways, and the run itself was clean. That is not "
      + "a guarantee of accuracy — see the review below."), "");
  }
  if (!result.segments.length) L.push("");
  return L;
}

function wrapReview(review) {
  const out = [];
  for (const block of String(review).replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      const bullet = /^\s*[-*]\s+/.test(line);
      const indent = bullet ? "  " : "";
      const hang = bullet ? "    " : "";
      const wrapped = wrapText(line.replace(/^\s*[-*]\s+/, bullet ? "- " : ""), REPORT_WIDTH, "");
      out.push(...wrapped.map((l, i) => (i === 0 ? indent + l : hang + l)));
    }
    out.push("");
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.length ? out : [REVIEW_PENDING];
}

// Splice the assistant's findings into PART 3 without rewriting anything else.
// The report stays script-owned: the model supplies prose through this seam and
// never edits the file, so PARTS 1 and 2 cannot drift from segments.json.
export function spliceReview(report, notes) {
  const head = `${THIN}\n${REVIEW_HEADING}\n${THIN}\n\n`;
  const tail = `\n${RULE}\nEND OF REPORT`;
  const i = report.indexOf(head);
  const j = report.lastIndexOf(tail);
  if (i === -1 || j === -1 || j < i) return null;
  return report.slice(0, i + head.length) + wrapReview(notes).join("\n") + "\n" + report.slice(j);
}

// ---- publisher captions --------------------------------------------------------
// A caption track the publisher shipped is human-authored, not guessed, so where
// it exists it outranks the recognizer outright. Two things follow. It becomes
// the text `index.md` carries, because that is the file the rest of the pipeline
// reads and it should read the true words. And the disagreement between the two
// becomes a *mechanical* finding: "by depth" for "by death" is a fluent mishearing
// that scores perfectly and no confidence threshold can see, but a second opinion
// on the same audio spots it without anyone reading a word.

export const CAPTIONS_FILE = "publisher-captions.vtt";

const CUE_TIME = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function cueSeconds(h, m, sec, frac) {
  const t = (Number(h ? h.slice(0, -1) : 0) * 3600) + (Number(m) * 60) + Number(sec)
    + (Number(frac) / 10 ** frac.length);
  // Rounded to the millisecond the caption file actually states: binary floats
  // otherwise turn 2.845 into 2.8449999999999998, which then reads as a real
  // difference when these times are compared with the recognizer's.
  return Math.round(t * 1000) / 1000;
}

// WebVTT and SRT, which is everything a publisher hands over in practice. Cue
// ids, WebVTT settings (align:, line:, position:) and inline tags are dropped;
// a cue wrapped over several lines is one cue, because a caption break is a
// display decision and has nothing to do with where a sentence ends.
export function parseCaptions(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!raw.trim() || !CUE_TIME.test(raw)) return null;
  const format = /^WEBVTT/.test(raw.trim()) ? "vtt" : "srt";
  const cues = [];
  for (const block of raw.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => CUE_TIME.test(l));
    if (i === -1) continue;
    const m = lines[i].match(CUE_TIME);
    const body = lines.slice(i + 1)
      .map((l) => l.replace(/<[^>]*>/g, "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!body) continue;
    cues.push({ start: cueSeconds(m[1], m[2], m[3], m[4]), end: cueSeconds(m[5], m[6], m[7], m[8]), text: body });
  }
  return cues.length ? { format, cues } : null;
}

// Cues are cut to fit a caption box — "In 2008, the New" / "York Life Foundation"
// — so they are rejoined and re-cut at sentence ends. Each sentence keeps the
// start time of the cue it began in, which is what makes the timestamps citable.
export function captionSegments(cues) {
  const out = [];
  let text = "";
  let start = null;
  let end = 0;
  const flush = () => {
    const body = text.trim();
    if (body) out.push({ start: start ?? 0, end, text: body });
    text = ""; start = null;
  };
  for (const cue of cues || []) {
    if (start === null) start = cue.start;
    end = cue.end;
    text += (text ? " " : "") + cue.text;
    // A gap long enough to be a new thought also ends the segment, so a caption
    // track with no terminal punctuation still yields more than one block.
    if (/[.!?…]["')\]]?$/.test(cue.text)) flush();
  }
  flush();
  return out;
}

// ---- comparing two accounts of the same audio ----------------------------------

// One entry per *comparable* word. A hyphenated token yields one entry per part,
// because "grief-sensitive" and "grief sensitive" are the same two words written
// two ways and flagging that pair would bury the handful of findings that are
// really about what was said. Each entry remembers the whole token it came from,
// so a difference inside one is still reported as the whole word.
function diffWords(segments) {
  const out = [];
  for (const seg of segments || []) {
    for (const token of String(seg.text || "").split(/\s+/).filter(Boolean)) {
      for (const part of token.split(/[-–—/]+/)) {
        const norm = normWord(part);
        if (norm) out.push({ norm, at: seg.start, src: token });
      }
    }
  }
  return out;
}

// The original tokens a run of differing entries came from, each named once —
// two halves of one hyphenated word must not print that word twice.
function spanText(words) {
  const out = [];
  for (const w of words) if (out[out.length - 1] !== w.src) out.push(w.src);
  return out.join(" ");
}

// Myers' O(ND) diff. The two accounts are near-identical, so D — the number of
// edits — is small and this stays fast on an hour of speech, where a full
// dynamic-programming table would not.
function editScript(a, b) {
  const n = a.length, m = b.length;
  const max = n + m;
  const trace = [];
  let v = new Map([[1, 0]]);
  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0)))
        ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
    v = new Map(v);
  }
  return [];
}

function backtrack(trace, a, b, d) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let step = d; step > 0; step--) {
    const v = trace[step];
    const k = x - y;
    const down = k === -step || (k !== step && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ op: "=", ai: x, bi: y }); }
    if (down) { y--; ops.push({ op: "+", ai: x, bi: y }); }
    else { x--; ops.push({ op: "-", ai: x, bi: y }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ op: "=", ai: x, bi: y }); }
  return ops.reverse();
}

export const MAX_CAPTION_FINDINGS = 60;

// Where the recognizer and the publisher's captions tell different stories.
// Comparison is on normalized words, so punctuation, casing and hyphenation drop
// out — those are transcription style, not disagreements about what was said,
// and reporting them would bury the handful of findings that matter.
export function diffTranscripts(asrSegments, capSegments) {
  const a = diffWords(asrSegments);
  const b = diffWords(capSegments);
  if (!a.length || !b.length) return [];
  const ops = editScript(a.map((x) => x.norm), b.map((x) => x.norm));

  const findings = [];
  let block = null;
  const close = () => {
    if (!block) return;
    if (block.asr.length || block.captions.length) {
      findings.push({
        at: fmtTime(block.at, false),
        seconds: block.at,
        asr: spanText(block.asr),
        captions: spanText(block.captions),
      });
    }
    block = null;
  };
  let lastAt = a[0].at;
  for (const op of ops) {
    if (op.op === "=") { lastAt = a[op.ai]?.at ?? lastAt; close(); continue; }
    if (!block) block = { at: (op.op === "-" ? a[op.ai]?.at : undefined) ?? lastAt, asr: [], captions: [] };
    if (op.op === "-") block.asr.push(a[op.ai]);
    else block.captions.push(b[op.bi]);
  }
  close();
  return findings.slice(0, MAX_CAPTION_FINDINGS);
}

// Fetch (or read) the publisher's caption track, store it verbatim, and record
// where it and the recognizer disagree. A failure here is a warning, never a
// stopped run: a transcript with no second opinion is worse than one with it, but
// it is still a transcript, and losing the whole run over an unreachable caption
// URL helps nobody.
export async function ingestCaptions({ captionsUrl, outDir, asrSegments, warnings = [] }) {
  if (!captionsUrl) return { captions: null, diff: null };
  try {
    const raw = /^https?:\/\//i.test(captionsUrl)
      ? await fetchText(captionsUrl, "caption track")
      : readFileSync(resolve(captionsUrl), "utf8");
    const parsed = parseCaptions(raw);
    if (!parsed) throw new Error("the file is neither WebVTT nor SRT");
    writeFileSync(join(outDir, CAPTIONS_FILE), raw, "utf8");
    const captions = captionSegments(parsed.cues);
    const diff = diffTranscripts(asrSegments, captions);
    writeFileSync(join(outDir, "caption-diff.json"), JSON.stringify({
      captions: CAPTIONS_FILE, format: parsed.format, cues: parsed.cues.length, differences: diff,
    }, null, 2), "utf8");
    if (diff.length) {
      warnings.push(`The publisher's caption track disagrees with the recognizer in ${diff.length} place(s) — each one is listed in PART 3, and \`index.md\` carries the caption wording rather than the recognizer's.`);
    }
    return { captions, diff, cues: parsed.cues.length, format: parsed.format };
  } catch (err) {
    warnings.push(`The caption track could not be used (${err.message}) — the transcript is the recognizer's alone, with nothing to check it against.`);
    return { captions: null, diff: null };
  }
}

// ---- Brightcove ----------------------------------------------------------------
// The one player page worth resolving in-tool. It is what a client hands over
// when they say "here is the video", the media behind it is a plain MP4, and the
// account usually carries a caption track next to it — so resolving it here is
// what turns a run that only worked because someone improvised into one that
// repeats. Everything else (YouTube, Vimeo, Loom) still needs a real downloader.
export async function fetchText(url, what = "file") {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${what}: HTTP ${r.status}`);
  return await r.text();
}

// The policy key is a public, embeddable credential baked into the player bundle
// — the same one the page itself uses to call the Playback API from a browser.
export async function resolveBrightcove(ref) {
  const bundle = await fetchText(
    `https://players.brightcove.net/${ref.account}/${ref.player}/index.min.js`, "player bundle");
  const key = (bundle.match(/policyKey\s*:\s*["']([^"']+)["']/)
    || bundle.match(/["']policyKey["']\s*:\s*["']([^"']+)["']/)
    || bundle.match(/(BCpkADaw[A-Za-z0-9_\-.]+)/) || [])[1];
  if (!key) throw new Error("no policy key in the player bundle — the player may be configured differently");
  const r = await fetch(
    `https://edge.api.brightcove.com/playback/v1/accounts/${ref.account}/videos/${ref.videoId}`,
    { headers: { Accept: `application/json;pk=${key}` } });
  if (!r.ok) throw new Error(`Playback API: HTTP ${r.status}${r.status === 403 ? " — the video may be geo- or domain-restricted" : ""}`);
  const j = await r.json();
  // Biggest MP4 wins: this is a transcription source, and the audio in the top
  // rendition is the audio the descriptive pass reads frames against.
  const mp4 = (j.sources || [])
    .filter((x) => x.src && /mp4/i.test(x.container || x.type || "") && /^https?:/i.test(x.src))
    .sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  if (!mp4) throw new Error("the Playback API returned no MP4 rendition for this video");
  const track = (j.text_tracks || []).find((t) => t.kind === "captions" && t.src);
  return {
    media: mp4.src,
    captions: track ? track.src : null,
    captionsLang: track ? track.srclang : null,
    title: j.name || null,
    description: j.description || null,
  };
}

export function brightcoveRef(source) {
  if (!/^https?:\/\//i.test(source || "")) return null;
  let u;
  try { u = new URL(source); } catch { return null; }
  if (!/(^|\.)brightcove\.net$/i.test(u.hostname)) return null;
  const path = u.pathname.match(/^\/(\d+)\/([^/]+)\//);
  const videoId = u.searchParams.get("videoId") || u.searchParams.get("videoid");
  if (!path || !videoId) return null;
  return { account: path[1], player: path[2], videoId };
}

// ---- the single-stream timeline ------------------------------------------------
// `transcript.md` is written for a reader: chapters, an orientation header, an
// index at the end. `timeline.md` is the same content with one thing added and one
// thing taken away — every beat carries its own `[mm:ss]`, and nothing that is not
// a beat is in the file. Who is speaking, what is on screen, and what is said sit
// together under the moment they happen, from the first frame to the last, so any
// moment can be cited without going back to the recording to find out when it was.
//
// It is derived, never authored: the prose is lifted verbatim out of the model's
// `transcript.md` and the timestamps are re-measured against the recording's own
// timings. That is the point of generating it rather than asking for it twice —
// two hand-written accounts of one recording drift, and the drift is invisible.

export const TIMELINE_FILE = "timeline.md";

const MARKER_RE = /^\[(Visual|On screen|On-screen|Sound|AD|No speech|Inaudible)\b/i;
const SPEAKER_RE = /^\*\*([^*]{1,120}?):\*\*\s*([\s\S]*)$/;
const CHAPTER_RE = /^###\s+\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/;
const NOSPEECH_RE = /^\[No speech\s+(\d{1,2}:\d{2}(?::\d{2})?)/i;

export function parseStamp(text) {
  const parts = String(text || "").split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// Blank-line-separated blocks of the `## Transcript` section, classified. A block
// is one marker, one speaker's line, one heading, or the odd list or framing line
// — whatever the model wrote, kept exactly as it wrote it.
export function parseTranscriptBlocks(prose) {
  const text = String(prose || "").replace(/\r\n?/g, "\n");
  const m = text.match(/^##\s+Transcript\s*$/m);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.match(/^##\s+(?!#)/m);
  const body = next ? rest.slice(0, next.index) : rest;

  const blocks = [];
  for (const raw of body.split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    // Re-flow: the source is hard-wrapped for reading, and a wrapped marker is
    // still one marker. The timeline puts one block on one line.
    const flat = chunk.replace(/\s*\n\s*/g, " ").trim();
    const chapter = flat.match(CHAPTER_RE);
    if (chapter) {
      blocks.push({ kind: "chapter", time: parseStamp(chapter[1]), title: chapter[2].trim(), text: flat });
      continue;
    }
    if (/^#{1,6}\s/.test(flat)) { blocks.push({ kind: "heading", text: flat }); continue; }
    const nospeech = flat.match(NOSPEECH_RE);
    if (nospeech) { blocks.push({ kind: "nospeech", time: parseStamp(nospeech[1]), text: flat }); continue; }
    if (MARKER_RE.test(flat)) { blocks.push({ kind: "marker", text: flat }); continue; }
    const speaker = flat.match(SPEAKER_RE);
    if (speaker) {
      blocks.push({ kind: "speech", speaker: speaker[1].trim(), speech: speaker[2].trim(), text: flat });
      continue;
    }
    // A list keeps its own line breaks — re-flowing it would destroy it.
    if (/^([-*+]|\d+[.)])\s/.test(chunk)) { blocks.push({ kind: "list", text: chunk }); continue; }
    blocks.push({ kind: "prose", text: flat });
  }
  return blocks;
}

// A beat is what a viewer takes in at one moment: the markers that set a line up,
// the line itself, and anything the model hung off it. Markers attach to the
// speech they precede, because that is the order the viewer meets them in.
export function beatsFromBlocks(blocks) {
  const beats = [];
  const chapters = [];
  let pending = [];
  let chapter = null;
  for (const b of blocks || []) {
    if (b.kind === "chapter") {
      if (pending.length) { beats.push({ kind: "markers", markers: pending, time: b.time, chapter }); pending = []; }
      chapter = { time: b.time, title: b.title };
      if (b.title) chapters.push(chapter);
      continue;
    }
    if (b.kind === "marker") { pending.push(b.text); continue; }
    if (b.kind === "nospeech") {
      beats.push({ kind: "nospeech", markers: pending, time: b.time, text: b.text, chapter });
      pending = [];
      continue;
    }
    if (b.kind === "speech") {
      beats.push({ kind: "speech", markers: pending, speaker: b.speaker, speech: b.speech, chapter });
      pending = [];
      continue;
    }
    // A list or a framing line belongs to the beat it followed, not to a new one.
    const last = beats[beats.length - 1];
    if (last && !pending.length) (last.after ||= []).push(b.text);
    else pending.push(b.text);
  }
  if (pending.length) beats.push({ kind: "markers", markers: pending, chapter });
  return { beats, chapters };
}

// ---- anchoring -----------------------------------------------------------------
// The model's speech is the publisher's or the recognizer's words, lightly tidied
// — em-dashes added, filler dropped, an obvious mangling repaired. So a beat is
// *located* by finding where its opening words sit in the reference stream, not by
// matching it exactly. The search only ever moves forward: a transcript runs in one
// direction, and a backwards match is wrong however well it scores.

const ANCHOR_WORDS = 10;
const ANCHOR_MIN = 0.45;      // fraction of the opening words that must line up
const ANCHOR_LOOKAHEAD = 600; // reference words searched forward from the cursor

function normWords(text) {
  return String(text || "")
    .replace(/\[[^\]]*\]/g, " ")     // [inaudible], [?] and friends are not words
    .replace(/[*_`]+/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// What to search the reference stream *for*. A stage direction — *(voice-over)*,
// *(off camera)* — is the model's note about how a line is delivered, not part of
// the line, and it is usually the first thing on it. Left in, it fills the query
// with words nobody says and drags the beat several seconds early: it is what put
// "It's not a one-time event" at 0:46 when the caption track says 0:48.
function matchText(speech) {
  return String(speech || "")
    .replace(/[*_]\([^)]*\)[*_]/g, " ")
    .replace(/^\s*\([^)]*\)\s*/, " ");
}

// One entry per reference word, carrying the time it is spoken at. Within a
// segment the time is interpolated: a 10-second segment starting at 0:40 puts its
// last word near 0:50, and rounding every word in it to 0:40 would make a beat
// that starts mid-segment claim a timestamp ten seconds early.
export function referenceWords(segments) {
  const out = [];
  for (const seg of segments || []) {
    const ws = normWords(seg.text);
    if (!ws.length) continue;
    const start = Number(seg.start) || 0;
    const span = Math.max(0, (Number(seg.end) || start) - start);
    ws.forEach((w, i) => out.push({ w, t: start + (ws.length > 1 ? (i / ws.length) * span : 0) }));
  }
  return out;
}

export function anchorBeats(beats, refWords) {
  const ref = refWords || [];
  let cursor = 0;
  let last = 0;
  const unmatched = [];
  for (const beat of beats) {
    if (typeof beat.time === "number" && Number.isFinite(beat.time)) {
      last = beat.time;
      // An explicit stamp moves the cursor too, so a chapter heading stops the
      // search drifting back into the previous chapter's words.
      while (cursor < ref.length && ref[cursor].t < beat.time - 0.5) cursor += 1;
      continue;
    }
    if (beat.kind !== "speech") { beat.time = last; beat.approx = true; continue; }
    const query = normWords(matchText(beat.speech)).slice(0, ANCHOR_WORDS);
    let best = { score: 0, at: -1 };
    if (query.length) {
      const stop = Math.min(ref.length, cursor + ANCHOR_LOOKAHEAD);
      for (let p = cursor; p < stop; p += 1) {
        let hits = 0;
        for (let i = 0; i < query.length && p + i < ref.length; i += 1) {
          if (ref[p + i].w === query[i]) hits += 1;
        }
        if (hits > best.score) best = { score: hits, at: p };
        if (hits === query.length) break;
      }
    }
    if (best.at >= 0 && query.length && best.score / query.length >= ANCHOR_MIN) {
      beat.time = ref[best.at].t;
      beat.confidence = Math.round((best.score / query.length) * 100) / 100;
      cursor = best.at + Math.max(1, Math.floor(query.length / 2));
      last = beat.time;
    } else {
      // Nothing found: keep the timeline monotonic rather than invent a time, and
      // record which line it happened to.
      beat.time = last;
      beat.approx = true;
      unmatched.push({ speaker: beat.speaker || "(unnamed)", opening: (beat.speech || "").slice(0, 60) });
    }
  }
  // Monotonic by construction, but a bad match can still land a beat before the
  // one above it. Clamp, rather than emit a timeline that runs backwards.
  //
  // The tolerance matters: a chapter heading's stamp is the model's, rounded to
  // the second, so a line the caption track puts at 1:24.99 sits a hundredth of a
  // second "before" a heading written as [1:25]. Clamping that is right; flagging
  // it as an unlocated line is not, and a `~` that means nothing teaches the
  // reader to ignore the ones that mean something.
  const CLAMP_TOLERANCE = 1.0;
  let floor = 0;
  for (const beat of beats) {
    if (!(beat.time >= floor)) {
      if (floor - beat.time > CLAMP_TOLERANCE) beat.approx = true;
      beat.time = floor;
    }
    floor = beat.time;
  }
  return { beats, unmatched };
}

export function buildTimelineMd({ beats, chapters, meta }) {
  const forceHours = (meta.durationSeconds || 0) >= 3600;
  const fm = [
    "---",
    `source: ${meta.source}`,
    "type: video",
    "kind: timeline",
    `title: ${meta.title}`,
    `duration: ${meta.duration}`,
    `language: ${meta.language}`,
    `text_source: ${meta.textSource}`,
    `beats: ${beats.length}`,
    "generated_from: transcript.md",
    `fetched_at: ${meta.fetchedAt}`,
    "---",
  ].join("\n");

  const out = [fm, "", `# ${meta.title} — timeline`, "",
    "_One stream, in time order: what is on screen, who starts speaking, and what they say, each"
    + " under the moment it happens. Generated from `transcript.md` and the recording's own"
    + " timings — regenerate it with `transcribe-video.mjs timeline`, never edit it by hand._", ""];

  if (chapters.length) {
    out.push("## Chapters", "");
    for (const c of chapters) out.push(`- **[${fmtTime(c.time, forceHours)}]** ${c.title}`);
    out.push("");
  }

  out.push("## Timeline", "");
  for (const beat of beats) {
    out.push(`### [${fmtTime(beat.time, forceHours)}]${beat.approx ? " ~" : ""}`);
    for (const marker of beat.markers || []) out.push(marker);
    if (beat.kind === "speech") out.push(`**${beat.speaker}:** ${beat.speech}`);
    else if (beat.text) out.push(beat.text);
    for (const extra of beat.after || []) out.push("", extra);
    out.push("");
  }
  out.push("---", "",
    "_A `~` on a timestamp means that line could not be located in the recording's own timings and"
    + " carries the previous beat's time instead. A marker takes the time of the line it introduces._",
    "");
  return out.join("\n");
}

// Reads the directory, builds the file, returns what it did. The reference stream
// is the publisher's caption track where there is one — its cues are two or three
// seconds long against the recognizer's five to ten, so it locates a line several
// times more precisely — and the recognizer's segments otherwise.
export function writeTimeline(dir) {
  const read = (name) => {
    try { return readFileSync(join(dir, name), "utf8"); } catch { return null; }
  };
  const prose = read("transcript.md");
  if (!prose) return { ok: false, problems: ["No transcript.md — there is nothing to build a timeline from. Assemble the descriptive pass first."] };

  const blocks = parseTranscriptBlocks(prose);
  if (!blocks) return { ok: false, problems: ["transcript.md has no `## Transcript` section — the timeline is built from that section and it is not there."] };
  const { beats, chapters } = beatsFromBlocks(blocks);
  if (!beats.length) return { ok: false, problems: ["transcript.md's `## Transcript` section holds no speech or markers."] };

  let refSegments = [];
  let textSource = "speech-recognition";
  const vtt = read(CAPTIONS_FILE);
  const parsed = vtt ? parseCaptions(vtt) : null;
  if (parsed) { refSegments = captionSegments(parsed.cues); textSource = "publisher-captions"; }
  if (!refSegments.length) {
    try { refSegments = JSON.parse(read("segments.json") || "{}").segments || []; } catch { refSegments = []; }
  }

  const { unmatched } = anchorBeats(beats, referenceWords(refSegments));

  const fm = (name, src) => ((src || "").match(new RegExp(`^${name}:\\s*(.+)\\s*$`, "m")) || [])[1] || null;
  const index = read("index.md") || "";
  const durationText = fm("duration", prose) || fm("duration", index) || "0:00:00";
  const meta = {
    source: fm("source", index) || fm("source", prose) || "(unknown)",
    title: (prose.match(/^#\s+(.+)$/m) || [])[1] || fm("title", index) || "Transcript",
    duration: durationText,
    durationSeconds: parseStamp(durationText) || 0,
    language: fm("language", index) || fm("language", prose) || "unknown",
    textSource,
    fetchedAt: fm("fetched_at", index) || new Date().toISOString().slice(0, 10),
  };

  const path = join(dir, TIMELINE_FILE);
  writeFileSync(path, buildTimelineMd({ beats, chapters, meta }), "utf8");
  return {
    ok: true,
    file: path,
    beats: beats.length,
    speech: beats.filter((b) => b.kind === "speech").length,
    markers: beats.reduce((n, b) => n + (b.markers || []).length, 0),
    chapters: chapters.length,
    reference: textSource,
    referenceSegments: refSegments.length,
    unmatched,
    problems: [],
  };
}

function doTimeline() {
  const dir = firstPositional();
  if (!dir) usage("timeline needs the transcript directory.");
  const result = writeTimeline(dir);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
  if (result.unmatched.length) {
    console.error(`note: ${result.unmatched.length} line(s) could not be located in the reference `
      + "timings and carry the previous beat's time (marked ~ in the file).");
  }
}

// ---- artifact verification -----------------------------------------------------
// A run is only finished when the whole declared set is on disk and the files
// agree with each other. This exists because they can come apart: output written
// to one directory and copied to another arrives piecemeal, a re-run against a
// stale directory leaves half of an older run in place, and a report written by
// hand instead of by the script passes every eyeball check while carrying none of
// the recognizer's own doubts. Each of those looks like success from the outside.

export const REQUIRED_FILES = ["index.md", "segments.json", "_meta.md", "transcript.txt"];
// The scaffolding buildReportTxt always emits. A report missing any of it was not
// produced by this script, whatever it says at the top.
const REPORT_MARKERS = ["PART 1 - ", "PART 2 - ", "PART 3 - POSSIBLE ISSUES", REVIEW_HEADING, "END OF REPORT"];

function countIn(text, re) {
  const m = String(text || "").match(re);
  return m ? Number(m[1]) : null;
}

export function verifyArtifacts(dir, { expectDescriptive = false } = {}) {
  const problems = [];
  const notes = [];
  const read = (name) => {
    try { return readFileSync(join(dir, name), "utf8"); } catch { return null; }
  };
  const present = (name) => existsSync(join(dir, name));

  const descriptive = ["transcript.md", "media.json", "frames.json", "outline.json"].some(present);
  const required = [...REQUIRED_FILES, ...(descriptive ? ["media.json", "outline.json"] : [])];

  for (const name of required) {
    if (!present(name)) { problems.push(`${name} is missing — the run did not finish, or only part of it was copied into place.`); continue; }
    let size = 0;
    try { size = statSync(join(dir, name)).size; } catch { /* treated as empty below */ }
    if (!size) problems.push(`${name} is empty.`);
  }

  const report = read("transcript.txt");
  if (report) {
    const absent = REPORT_MARKERS.filter((m) => !report.includes(m));
    if (absent.length) {
      problems.push(`transcript.txt is missing ${absent.map((a) => `"${a.trim()}"`).join(", ")} — `
        + "it was written by hand rather than produced by the script, so PARTS 1 and 2 are not "
        + "guaranteed to match segments.json and the recognizer's own findings are not in it.");
    }
  }

  // The four places the segment count is written down must agree. They disagree
  // exactly when a directory holds files from two different runs.
  const seg = read("segments.json");
  let counts = null;
  if (seg) {
    let parsed = null;
    try { parsed = JSON.parse(seg); } catch { problems.push("segments.json is not valid JSON."); }
    if (parsed) {
      counts = {
        "segments.json": (parsed.segments || []).length,
        "index.md": countIn(read("index.md"), /^segments:\s*(\d+)\s*$/m),
        "_meta.md": countIn(read("_meta.md"), /\*\*Segments:\*\*\s*(\d+)/),
        "transcript.txt": countIn(report, /PART 2 - TIMESTAMPED SEGMENTS \(all (\d+) items\)/),
      };
      const seen = new Map();
      for (const [where, n] of Object.entries(counts)) {
        if (n === null) continue;
        if (!seen.has(n)) seen.set(n, []);
        seen.get(n).push(where);
      }
      if (seen.size > 1) {
        problems.push("The segment count disagrees between files ("
          + [...seen].map(([n, where]) => `${where.join(", ")}: ${n}`).join("; ")
          + ") — these files are from different runs.");
      }
    }
  }

  if (descriptive) {
    const media = (() => { try { return JSON.parse(read("media.json")); } catch { return null; } })();
    if (media && media.has_video) {
      if (!present("frames.json")) {
        problems.push("frames.json is missing although the source has a video stream — the descriptive pass had no visuals to describe from.");
      } else {
        const listed = (() => { try { return (JSON.parse(read("frames.json")).frames || []).length; } catch { return null; } })();
        let onDisk = null;
        try { onDisk = readdirSync(join(dir, "frames")).length; } catch { onDisk = 0; }
        if (listed !== null && listed !== onDisk) {
          problems.push(`frames.json lists ${listed} keyframes but frames/ holds ${onDisk} — the descriptive pass cited frames that are not there.`);
        }
      }
    }
    // transcript.md is the deliverable, but it does not exist yet when `run`
    // verifies its own output — the model writes it afterwards, window by window.
    // So its absence is only a note here, and a problem when the caller says the
    // pass is supposed to be finished.
    const prose = read("transcript.md");
    if (!prose) {
      const missing = "No transcript.md — the descriptive pass has not been assembled.";
      if (expectDescriptive) problems.push(missing + " It is the deliverable, not an optional extra.");
      else notes.push(missing);
    } else {
      // A summary with no timeline under it is the failure mode worth catching:
      // it reads as a finished document while carrying none of the *when*.
      if (!/^##\s+Transcript\s*$/m.test(prose)) {
        problems.push("transcript.md has no `## Transcript` section — the descriptive detail was "
          + "written somewhere other than the timeline, which is what made it equivalent to watching.");
      } else if (!/^###\s+\[\d/m.test(prose)) {
        problems.push("transcript.md's timeline carries no `### [mm:ss]` heading — nothing in it says "
          + "when anything happens.");
      }
      // Catches the transcript.md of a *different* recording sitting in this
      // directory — a copy gone wrong, or a window pass that lost its place.
      const proseDur = (prose.match(/^duration:\s*(\S+)\s*$/m) || [])[1];
      const indexDur = ((read("index.md") || "").match(/^duration:\s*(\S+)\s*$/m) || [])[1];
      if (proseDur && indexDur && proseDur !== indexDur) {
        problems.push(`transcript.md says the recording runs ${proseDur} but index.md says ${indexDur} — `
          + "these two files describe different recordings.");
      }

      // timeline.md is derived from transcript.md, so the two come apart in one
      // direction only: the prose is edited and the timeline is not rebuilt. Then
      // the file that looks the most citable — every line stamped with a time —
      // is quietly the stale one, which is worse than not having it.
      const timeline = read(TIMELINE_FILE);
      if (!timeline) {
        const missing = `No ${TIMELINE_FILE} — the single-stream timeline has not been built.`;
        if (expectDescriptive) {
          problems.push(missing + ` Build it with \`timeline "<dir>"\`; it is generated, not written.`);
        } else notes.push(missing);
      } else {
        if (!/^##\s+Timeline\s*$/m.test(timeline) || !/^###\s+\[\d/m.test(timeline)) {
          problems.push(`${TIMELINE_FILE} carries no \`## Timeline\` section with \`### [mm:ss]\` beats — `
            + "it was not produced by this script.");
        }
        try {
          if (statSync(join(dir, "transcript.md")).mtimeMs > statSync(join(dir, TIMELINE_FILE)).mtimeMs + 1000) {
            problems.push(`${TIMELINE_FILE} is older than transcript.md — it was built from an earlier `
              + `draft. Re-run \`timeline "<dir>"\`.`);
          }
        } catch { /* a missing stat is already covered above */ }
      }

      // A name read off a downscaled keyframe is evidence, not a font specimen.
      // "TerriyIn" for "Terrilyn" is the shape this takes every time: a capital I
      // where a lowercase l stood, published as fact because it came from an
      // on-screen card and cards feel authoritative. The rule is to mark it [?];
      // this is the check that notices when the rule was not followed.
      const suspect = new Set();
      for (const m of prose.matchAll(/\*\*([A-Z][^*:]{1,60}?):\*\*/g)) {
        const name = m[1].trim();
        if (/\[\?\]/.test(name)) continue;
        for (const token of name.split(/[\s'’-]+/)) {
          const bare = token.replace(/^(Mc|Mac|De|Di|Du|La|Le|Van|Von|O)(?=[A-Z])/, "");
          if (/[a-z][A-Z]/.test(bare)) suspect.add(name);
        }
      }
      if (suspect.size) {
        notes.push(`Speaker name(s) with a capital letter inside a word and no \`[?]\`: `
          + `${[...suspect].map((n) => `"${n}"`).join(", ")}. That is what a lowercase l misread off a `
          + "name card looks like. Check the frame, or mark the name uncertain — an almost-right "
          + "spelling of a real person's name is worse than admitting the glyphs were unreadable.");
      }
    }
  }

  // The caption files travel together, and index.md's provenance line has to
  // match what is actually on disk: a directory holding a diff but no captions,
  // or captions that index.md does not claim, is a partly-copied run.
  const hasDiff = present("caption-diff.json");
  const hasVtt = present(CAPTIONS_FILE);
  if (hasDiff && !hasVtt) {
    problems.push(`caption-diff.json is here but ${CAPTIONS_FILE} is missing — the transcript cites a caption track that is not in the directory.`);
  }
  if (hasVtt || hasDiff) {
    const index = read("index.md") || "";
    if (!/^text_source:\s*publisher-captions\s*$/m.test(index)) {
      problems.push("A publisher caption track is present but index.md still declares "
        + "`text_source: speech-recognition` — downstream would read the recognizer's guess "
        + "while the publisher's own wording sits unused beside it.");
    }
  }

  const reviewed = Boolean(report) && !report.includes(REVIEW_PENDING);
  if (report && !reviewed) {
    notes.push("PART 3's review half is still pending — run `review`, then `annotate`. "
      + "Nothing mechanical can catch a fluent mishearing, so an unreviewed report is an unchecked one.");
  }

  return { ok: problems.length === 0, problems, notes, reviewed, descriptive, counts };
}

// ---- descriptive pass: deterministic extraction --------------------------------

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function pyProbe(py, args) {
  return spawnSync(py.exe, [...py.args, PROBE, ...args],
    { stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
}

function pyTranscribe(py, media, outJson) {
  return spawnSync(py.exe, [...py.args, WORKER, "--media", media, "--out", outJson,
    "--model", flag("--model", "base"), "--language", flag("--language", "auto")],
  { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
}

// Everything a descriptive transcript needs that a machine can settle: which
// streams exist, what the picture does, the file's own captions, and a real
// audio-description track if the publisher shipped one.
function enrichDescriptive({ py, mediaPath, outDir, result, warnings }) {
  const out = { frames: 0, captions: 0, audio_description: false, files: [] };

  const mediaJson = join(outDir, "media.json");
  if (pyProbe(py, ["probe", "--media", mediaPath, "--out", mediaJson]).status !== 0) {
    warnings.push("Stream probe failed — the descriptive extras (frames, captions, description track) were skipped.");
    return null;
  }
  const info = readJson(mediaJson) || {};
  out.files.push(mediaJson);
  out.streams = (info.streams || []).length;

  let frames = [];
  if (info.has_video) {
    const framesJson = join(outDir, "frames.json");
    const r = pyProbe(py, ["frames", "--media", mediaPath, "--out-dir", join(outDir, "frames"),
      "--out", framesJson, "--max", flag("--max-frames", "60"),
      "--min-gap", flag("--frame-gap", "4"), "--width", flag("--frame-width", "960"),
      "--threshold", flag("--frame-threshold", "0.06"),
      "--band-threshold", flag("--frame-band-threshold", "0.04"),
      "--card-probe", flag("--card-probe", "1.6")]);
    if (r.status === 0) {
      frames = (readJson(framesJson) || {}).frames || [];
      out.files.push(framesJson);
    } else {
      warnings.push("Frame extraction failed — the descriptive pass has no visuals to describe from.");
    }
  } else {
    warnings.push("No video stream in this source — on-screen text, actions, and visual description cannot be produced from it.");
  }
  out.frames = frames.length;

  let captions = [];
  if (info.subtitle_index !== null && info.subtitle_index !== undefined) {
    const capJson = join(outDir, "captions.json");
    if (pyProbe(py, ["subs", "--media", mediaPath, "--out", capJson]).status === 0) {
      captions = (readJson(capJson) || {}).cues || [];
      out.files.push(capJson);
    }
  } else if ((info.bitmap_subtitles || []).length) {
    warnings.push(`Subtitle stream(s) ${info.bitmap_subtitles.join(", ")} are bitmap subtitles — their text is only in the picture, so read it off the frames.`);
  }
  out.captions = captions.length;

  // A publisher-supplied description track is authoritative: it beats anything
  // inferred from frames, so transcribe it rather than paraphrasing the video.
  if (info.audio_description_index !== null && info.audio_description_index !== undefined) {
    const tmp = mkdtempSync(join(tmpdir(), "twt-video-ad-"));
    try {
      const wav = join(tmp, "audio-description.wav");
      const ex = pyProbe(py, ["audio", "--media", mediaPath,
        "--stream", String(info.audio_description_index), "--out", wav]);
      if (ex.status === 0) {
        console.error(`transcribing the audio-description track (stream ${info.audio_description_index}) …`);
        const adJson = join(outDir, "audio-description.json");
        if (pyTranscribe(py, wav, adJson).status === 0) {
          const ad = readJson(adJson);
          const forceHours = (result.duration || 0) >= 3600;
          const body = paragraphize(ad.segments || []).map(
            (p) => `**[${fmtTime(p.start, forceHours)}]** ${p.text}`).join("\n\n");
          const adMd = join(outDir, "audio-description.md");
          writeFileSync(adMd,
            `# Audio description track\n\n_Transcribed from audio stream ${info.audio_description_index} `
            + `of the source — the publisher's own description of the visuals. Prefer it over anything `
            + `inferred from the frames._\n\n${body || "_The description track carried no speech._"}\n`, "utf8");
          out.audio_description = true;
          out.files.push(adMd, adJson);
        } else {
          warnings.push("The audio-description track was found but could not be transcribed.");
        }
      } else {
        warnings.push(`Audio-description track (stream ${info.audio_description_index}) could not be extracted.`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Turn candidates and silences go back into segments.json; the outline is the
  // only whole-recording view the model is meant to read.
  const gaps = nonSpeechGaps(result.segments, result.duration);
  const segmentsPath = join(outDir, "segments.json");
  writeFileSync(segmentsPath, JSON.stringify({
    ...result, segments: assignTurns(result.segments), non_speech: gaps,
  }), "utf8");
  out.non_speech_spans = gaps.length;
  const turned = assignTurns(result.segments);
  out.turns = new Set(turned.map((s) => s.turn)).size;

  // Turn detection is pause detection, and some faster-whisper builds return
  // segments whose start is exactly the previous segment's end. Then there are no
  // pauses to find, the recording collapses to one or two turns, and the count
  // reads as "one speaker" when it means "this file cannot tell you". Say so,
  // rather than let a seven-speaker film go out reporting two turn candidates
  // under "Warnings: None".
  if (result.segments.length > 4) {
    const butts = result.segments.filter(
      (seg, i) => i && Math.abs(seg.start - result.segments[i - 1].end) < 0.005).length;
    out.contiguous_segments = butts;
    if (butts / (result.segments.length - 1) >= 0.8) {
      warnings.push("The recognizer returned back-to-back segment times (no measurable pauses), so "
        + "pause-based turn detection is blind on this file — the " + out.turns + " turn candidate(s) "
        + "in segments.json are an artefact of that, not a speaker count. Take speakers from the "
        + "frames and the content, and do not trust the turn numbers to mark handovers.");
    } else if (info.has_video && out.turns <= 2 && (result.duration || 0) >= 90) {
      warnings.push("Only " + out.turns + " speaker-turn candidate(s) across "
        + fmtTime(result.duration) + " of video — if more than one person speaks, the handovers "
        + "have no pause the detector can see. Take speakers from the frames, not the turn numbers.");
    }
  }

  const outlinePath = join(outDir, "outline.json");
  writeFileSync(outlinePath, JSON.stringify(buildOutline({
    segments: result.segments, gaps, frames, captions, duration: result.duration,
    windowSeconds: Number(flag("--window-seconds", String(WINDOW_SECONDS))) || WINDOW_SECONDS,
  }), null, 2), "utf8");
  out.files.push(outlinePath);
  out.windows = (readJson(outlinePath) || {}).windows?.length || 0;
  return out;
}

// ---- probe / slice -------------------------------------------------------------

function doProbe() {
  const source = firstPositional();
  if (!source) usage("Missing <path>.");
  if (/^https?:\/\//i.test(source)) {
    console.error("probe reads a local file. Download it first, or use `run --descriptive`, which probes the source itself.");
    process.exit(2);
  }
  if (!existsSync(source)) { console.error(`No such file: ${source}`); process.exit(2); }
  const py = findPython(flag("--python", null));
  if (!py) { console.error("No Python interpreter found. Run `check` for install guidance."); process.exit(3); }

  const tmp = mkdtempSync(join(tmpdir(), "twt-video-probe-"));
  try {
    const out = join(tmp, "media.json");
    if (pyProbe(py, ["probe", "--media", resolve(source), "--out", out]).status !== 0) {
      console.error("Could not read the media's stream layout.");
      process.exit(1);
    }
    console.log(JSON.stringify(readJson(out), null, 2));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function doSlice() {
  const dir = firstPositional();
  if (!dir) usage("Missing <transcript-dir>.");
  const segs = readJson(join(dir, "segments.json"));
  if (!segs) { console.error(`No segments.json under ${dir}. Run \`run --descriptive\` first.`); process.exit(2); }

  const windowSeconds = Number(flag("--window-seconds", String(WINDOW_SECONDS))) || WINDOW_SECONDS;
  let from = parseTime(flag("--from", "0"));
  const nth = flag("--window", null);
  if (nth !== null) from = (Math.max(1, Number(nth)) - 1) * windowSeconds;
  if (from === null) usage("--from must be seconds or mm:ss.");
  const to = parseTime(flag("--to", String(from + windowSeconds)));
  if (to === null || to <= from) usage("--to must be after --from.");

  process.stdout.write(buildSlice({
    from, to, duration: segs.duration, segments: segs.segments,
    gaps: segs.non_speech || nonSpeechGaps(segs.segments, segs.duration),
    frames: (readJson(join(dir, "frames.json")) || {}).frames || [],
    captions: (readJson(join(dir, "captions.json")) || {}).cues || [],
  }));
}

// ---- review / annotate ---------------------------------------------------------

function titleFromIndex(dir, slug) {
  try {
    const fm = readFileSync(join(dir, "index.md"), "utf8").split(/\r?\n/).slice(0, 15);
    const line = fm.find((l) => l.startsWith("title: "));
    if (line) return line.slice(7).trim();
  } catch { /* fall back to the slug */ }
  return titleFrom(slug);
}

// Everything the review pass needs and nothing it doesn't. Under the word budget
// that includes the full text — a fluent mishearing is invisible to every
// mechanical check, and the only way to catch it is to read the words.
export function buildReviewRequest({ title, result, issues, wordBudget = REVIEW_WORD_BUDGET }) {
  const forceHours = (result.duration || 0) >= 3600;
  const totalWords = result.segments.reduce((n, s) => n + wordCount(s.text), 0);
  const full = totalWords <= wordBudget;
  const L = [`# Review request — ${title}`, "",
    `${result.segments.length} segments, ${totalWords} words, ${fmtTime(result.duration, true)}, `
    + `model \`${result.model}\`, language ${result.language} (${result.language_probability}).`, ""];

  L.push(`Coverage: ${full
    ? "the full transcript is below — read all of it."
    : `${totalWords} words is over the ${wordBudget}-word read budget, so only the flagged excerpts are below. Say in your notes that the review covered flagged excerpts only.`}`, "");

  if (issues.run.length) {
    L.push("## Run-level flags", "", ...issues.run.map((r) => `- ${r}`), "");
  }
  if (issues.variants.length) {
    L.push("## Names spelled more than one way", "");
    for (const g of issues.variants) {
      L.push(...g.forms.map((f) => `- "${f.phrase}" — ${whereList(f.where)}`), "");
    }
  }
  if (issues.segments.length) {
    L.push("## Lines the recognizer was unsure of", "");
    const byStart = new Map(result.segments.map((s, i) => [s.start, i]));
    for (const f of issues.segments) {
      const i = byStart.get(f.start);
      const ctx = [result.segments[i - 1], result.segments[i], result.segments[i + 1]]
        .filter(Boolean).map((s) => s.text).join(" ");
      L.push(`### [${f.at}] ${f.severity === "high" ? "(high)" : "(medium)"}`,
        `flagged: "${f.text}"`, `in context: ${ctx}`, ...f.notes.map((n) => `- ${n}`), "");
    }
    if (issues.truncated) L.push(`(${issues.truncated} further flagged lines omitted.)`, "");
  }

  if (full) {
    L.push("## Full transcript", "");
    for (const p of paragraphize(result.segments)) L.push(`[${fmtTime(p.start, forceHours)}] ${p.text}`, "");
  }

  L.push("## What to write back", "",
    "A short list of the specific things in this transcript that are probably wrong, each with",
    "its timestamp, what the recognizer wrote, and what it was more likely to have been —",
    "plus one line on what you could not check. Claim nothing you cannot point at. If you",
    "found nothing, say that. Feed it back with:", "",
    "  transcribe-video.mjs annotate <dir> --notes <file>", "");
  return L.join("\n") + "\n";
}

function doReview() {
  const dir = firstPositional();
  if (!dir) usage("Missing <transcript-dir>.");
  const result = readJson(join(dir, "segments.json"));
  if (!result) { console.error(`No segments.json under ${dir}. Run \`run\` first.`); process.exit(2); }
  const title = titleFromIndex(dir, slugify(basename(resolve(dir))));
  const issues = detectIssues({ ...result, title });
  process.stdout.write(buildReviewRequest({
    title, result, issues,
    wordBudget: Number(flag("--word-budget", String(REVIEW_WORD_BUDGET))) || REVIEW_WORD_BUDGET,
  }));
}

function doAnnotate() {
  const dir = firstPositional();
  if (!dir) usage("Missing <transcript-dir>.");
  const notesFile = flag("--notes", null);
  const notesText = flag("--notes-text", null);
  if (!notesFile && !notesText) usage("Missing --notes <file> (or --notes-text <string>).");
  let notes = notesText;
  if (notesFile) {
    if (!existsSync(notesFile)) { console.error(`No such notes file: ${notesFile}`); process.exit(2); }
    notes = readFileSync(notesFile, "utf8");
  }
  if (!String(notes).trim()) usage("The notes are empty — write the review, or leave PART 3 pending.");

  const reportPath = join(dir, "transcript.txt");
  if (!existsSync(reportPath)) { console.error(`No transcript.txt under ${dir}. Run \`run\` first.`); process.exit(2); }
  const spliced = spliceReview(readFileSync(reportPath, "utf8"), notes);
  if (spliced === null) {
    console.error(`Could not find the "${REVIEW_HEADING}" section in ${reportPath} — it was edited by hand. Re-run with --force to rebuild it.`);
    process.exit(1);
  }
  writeFileSync(reportPath, spliced, "utf8");
  console.log(JSON.stringify({ ok: true, report: reportPath, reviewed: true }, null, 2));
}

function doVerify() {
  const dir = firstPositional();
  if (!dir) usage("Missing <transcript-dir>.");
  if (!existsSync(dir)) { console.error(`No such directory: ${dir}`); process.exit(2); }
  const v = verifyArtifacts(dir, { expectDescriptive: has("--expect-descriptive") });
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.ok ? 0 : 1);
}

// ---- run -----------------------------------------------------------------------

// One source failing must not take the rest of a batch down with it, so the
// per-source path reports failure by throwing this instead of exiting. A single
// source still exits with the same code it always did — the caller decides.
class RunFailure extends Error {
  constructor(code, lines) { super(lines[0]); this.code = code; this.lines = lines; }
}

// Every positional is a source: a URL, a media file, or a directory, which
// expands to the media sitting *directly* inside it. Deliberately not recursive —
// a nested tree is somebody's archive, and transcribing all of it is never what
// was meant by pointing at the folder.
export function expandSources(positionals, fs = { statSync, readdirSync }) {
  const sources = [];
  for (const p of positionals) {
    if (/^https?:\/\//i.test(p)) { sources.push(p); continue; }
    let st = null;
    try { st = fs.statSync(p); } catch { /* reported next */ }
    if (!st) throw new RunFailure(2, [`No such file or directory: ${p}`]);
    if (!st.isDirectory()) { sources.push(resolve(p)); continue; }
    const found = fs.readdirSync(p)
      .filter((n) => MEDIA_EXT.test(n)).sort()
      .map((n) => resolve(join(p, n)))
      .filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    if (!found.length) {
      throw new RunFailure(2, [
        `No media files directly inside ${p}.`,
        "Point at the files themselves, or at the directory that holds them — subdirectories are not searched.",
      ]);
    }
    sources.push(...found);
  }
  // A file named both directly and via its directory must not be transcribed twice.
  return [...new Set(sources)];
}

async function doRun() {
  const positionals = allPositionals();
  if (!positionals.length) usage("Missing <url-or-path>.");

  const py = findPython(flag("--python", null));
  if (!py) {
    console.error("No Python interpreter found. Run `check` for install guidance.");
    process.exit(3);
  }
  if (!hasFasterWhisper(py)) {
    console.error(`faster-whisper is not installed for ${py.executable}.`);
    console.error(`Install with: ${py.exe} -m pip install faster-whisper`);
    process.exit(3);
  }

  let sources;
  try {
    sources = expandSources(positionals);
  } catch (err) {
    if (!(err instanceof RunFailure)) throw err;
    for (const line of err.lines) console.error(line);
    process.exit(err.code);
  }

  const single = sources.length === 1;
  // These three name one recording. Silently applying a title to five files would
  // land four of them in directories named after the fifth — or, worse, on top of
  // each other, since the slug is what the exists-check keys on.
  if (!single) {
    for (const name of ["--title", "--slug", "--captions"]) {
      if (flag(name, null) !== null) {
        usage(`${name} names one recording, but ${sources.length} sources were given. `
          + `Run that one on its own, or drop ${name} — in a batch each output is named from its own filename.`);
      }
    }
  }

  const outRoot = resolve(flag("--out-dir", DEFAULT_OUT));
  const results = [];
  for (const [i, source] of sources.entries()) {
    if (!single) {
      console.error(`\n=== [${i + 1}/${sources.length}] ${redactUrl(source).url} ===`);
    }
    try {
      results.push({ ok: true, summary: await runOne({ source, py, outRoot }) });
    } catch (err) {
      if (!(err instanceof RunFailure)) throw err;
      if (single) {
        for (const line of err.lines) console.error(line);
        process.exit(err.code);
      }
      for (const line of err.lines) console.error(`  ${line}`);
      console.error("  — skipped; the rest of the batch continues.");
      results.push({ ok: false, exit: err.code, source: redactUrl(source).url, error: err.lines.join(" ") });
    }
  }

  if (single) {
    console.log(JSON.stringify(results[0].summary, null, 2));
    return;
  }

  const done = results.filter((r) => r.ok).map((r) => r.summary);
  const failed = results.filter((r) => !r.ok);
  const fetchedAt = new Date().toISOString().slice(0, 10);
  // A batch where nothing was transcribed has no set to index. Writing the file
  // anyway leaves a `_batch-…-2.md` listing only failures beside a directory of
  // real transcripts — an index that describes none of them.
  const indexFile = done.length
    ? writeBatchIndex({
      outRoot, slugs: done.map((s) => s.slug), fetchedAt, failed,
      file: pickBatchFile(outRoot, fetchedAt),
    })
    : null;

  console.log(JSON.stringify({
    ok: failed.length === 0,
    batch: true,
    sources: sources.length,
    transcribed: done.length,
    failed: failed.length,
    outDir: outRoot,
    batchIndex: indexFile,
    // The descriptive passes rewrite the speaker counts, so the index is not final
    // until they are done. Hand the caller the exact command rather than let it
    // improvise one with a different --file and leave two indexes behind.
    rebuildIndex: indexFile
      ? `transcribe-video.mjs batch-index "${outRoot}" --slugs "${done.map((s) => s.slug).join(",")}" --file "${basename(indexFile)}"`
      : null,
    results: done,
    failures: failed,
  }, null, 2));
  if (failed.length) process.exit(1);
}

async function runOne({ source, py, outRoot }) {
  // A Brightcove player page is the one watch page resolved in-tool: it is what a
  // client hands over, the media behind it is a plain MP4, and the account
  // usually carries the publisher's caption track right next to it. Resolving it
  // here is what makes such a run repeatable instead of dependent on somebody
  // improvising the Playback API call by hand.
  const bcRef = brightcoveRef(source);
  let mediaUrl = source;
  let captionsUrl = flag("--captions", null);
  let resolvedTitle = null;
  if (bcRef) {
    console.error(`resolving Brightcove video ${bcRef.videoId} (account ${bcRef.account}) …`);
    try {
      const bc = await resolveBrightcove(bcRef);
      mediaUrl = bc.media;
      resolvedTitle = bc.title;
      if (!captionsUrl && bc.captions) {
        captionsUrl = bc.captions;
        console.error(`found the publisher's ${bc.captionsLang || "default"} caption track`);
      }
    } catch (err) {
      throw new RunFailure(1, [
        `Could not resolve the Brightcove player page: ${err.message}`,
        "Supply the direct MP4 URL or a downloaded file instead.",
      ]);
    }
  }

  const isUrl = /^https?:\/\//i.test(mediaUrl);
  if (!isUrl && !existsSync(mediaUrl)) throw new RunFailure(2, [`No such file: ${mediaUrl}`]);

  const rawName = (isUrl ? nameFromUrl(mediaUrl) : basename(mediaUrl)).replace(MEDIA_EXT, "");
  // The page URL is the durable reference; the signed CDN link behind it expires.
  const sourceRef = bcRef ? source : mediaUrl;
  const title = flag("--title", null) || resolvedTitle;
  // --slug wins, then --title, then the filename. Naming is an *input* so that a
  // re-run lands on the same directory: a slug corrected by hand afterwards makes
  // the exists-check below look in the wrong place and silently duplicate the run.
  const slug = slugify(flag("--slug", null) || title || rawName);
  const outDir = join(outRoot, slug);
  const indexPath = join(outDir, "index.md");
  if (existsSync(indexPath) && !has("--force")) {
    throw new RunFailure(4, [`A transcript already exists at ${indexPath}. Re-run with --force to replace it.`]);
  }
  mkdirSync(outDir, { recursive: true });

  const warnings = [];
  if (!flag("--slug", null) && !title && isGenericName(rawName)) {
    warnings.push(`The source filename (\`${rawName}\`) is a placeholder, so the slug \`${slug}\` says nothing about this recording. Re-run with --title "<what it is>" to name the output directory and the transcript.`);
  }
  const keepSource = has("--keep-source");
  let tempDir = null;
  let mediaPath = isUrl ? null : resolve(mediaUrl);
  let bytes = mediaPath ? statSync(mediaPath).size : 0;

  try {
    if (isUrl) {
      const target = keepSource ? outDir : (tempDir = mkdtempSync(join(tmpdir(), "twt-video-")));
      console.error(`downloading ${redactUrl(mediaUrl).url} …`);
      let dl;
      try {
        dl = await downloadTo(mediaUrl, target);
      } catch (err) {
        // A dead host, a redirect to a login page, or a watch page instead of a
        // file — all user-fixable. Report the cause, not a Node stack trace.
        // Don't leave the empty slug directory behind for a source we never got.
        try { if (!readdirSync(outDir).length) rmSync(outDir, { recursive: true }); } catch { /* leave it */ }
        throw new RunFailure(1, [
          `Could not download the source: ${err.cause?.message || err.message}`,
          "Check the URL points directly at a media file and is reachable from this machine.",
        ]);
      }
      mediaPath = dl.path;
      bytes = dl.bytes;
      console.error(`downloaded ${(bytes / 1048576).toFixed(1)} MB (${dl.contentType || "unknown type"})`);
    }
    if (!MEDIA_EXT.test(mediaPath)) {
      warnings.push(`Unrecognized media extension on \`${basename(mediaPath)}\` — decoding was attempted anyway.`);
    }

    const jsonPath = join(outDir, "segments.json");
    const args = [...py.args, WORKER, "--media", mediaPath, "--out", jsonPath,
      "--model", flag("--model", "base"), "--language", flag("--language", "auto")];
    const run = spawnSync(py.exe, args, { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    // Exit 3 is the engine going missing mid-run — that is not this file's
    // problem, it is every remaining file's problem too, so it stops everything.
    if (run.status === 3) process.exit(3);
    if (run.status !== 0) throw new RunFailure(1, [`Transcription failed (exit ${run.status}).`]);

    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    if (!result.segments.length) warnings.push("No speech was detected — the transcript is empty.");
    if (result.language_probability && result.language_probability < 0.6) {
      warnings.push(`Low language-detection confidence (${result.language_probability}) — pass --language <code> to force one.`);
    }
    if (result.duration >= 1800 && ["tiny", "base"].includes(result.model)) {
      warnings.push(`Long recording transcribed with the \`${result.model}\` model — re-run with --model small (or medium) if accuracy matters.`);
    }
    // Surfaced here as well as in the report so `_meta.md` and the JSON summary
    // carry it: a caller that reads only the summary must still learn that the
    // mechanical check had nothing to work from.
    if (result.segments.length && !result.segments.some((s) => typeof s.avg_logprob === "number")) {
      warnings.push("This faster-whisper build returned no per-segment confidence scores, so no "
        + "line could be flagged mechanically — the report's PART 3 is empty for reasons that have "
        + "nothing to do with the audio being clean.");
    }

    const fetchedAt = new Date().toISOString().slice(0, 10);
    // The publisher's own caption track, if there is one. It is stored verbatim,
    // becomes the text index.md carries, and — the part that matters most — is
    // diffed against the recognizer. That diff is the only mechanical check in
    // this tool that can catch a mishearing the decoder was confident about.
    const { captions, diff: captionDiff } = await ingestCaptions({
      captionsUrl, outDir, asrSegments: result.segments, warnings,
    });

    writeFileSync(indexPath, buildIndexMd({
      source: sourceRef, slug, title, result, fetchedAt, captionSegments: captions,
    }), "utf8");

    // The verbatim transcript is complete at this point; the descriptive extras
    // are additive, so a failure in them never costs the run its transcript.
    // Extracted by default: the descriptive transcript is the deliverable people
    // actually read, and a run that skipped the frames cannot be upgraded into one
    // without re-decoding the media. --verbatim opts out where speech is all that
    // is wanted (and is what collect mode passes, having no budget for the pass).
    const descriptive = has("--verbatim")
      ? null
      : enrichDescriptive({ py, mediaPath, outDir, result, warnings });

    writeFileSync(join(outDir, "_meta.md"),
      buildMetaMd({ source: sourceRef, localPath: mediaPath, bytes, result, warnings, descriptive,
        keptSource: !isUrl || keepSource }), "utf8");

    // The human-readable report is written on every run, in both depths — it is
    // the deliverable a person actually opens, and PART 3 is the only place the
    // recognizer's own doubts are visible at all.
    const totalWords = result.segments.reduce((n, s) => n + wordCount(s.text), 0);
    const issues = detectIssues({ ...result, title: titleFrom(slug, title), warnings });
    const reportPath = join(outDir, "transcript.txt");
    writeFileSync(reportPath, buildReportTxt({
      source: sourceRef, slug, title, result, warnings, issues, fetchedAt, bytes, descriptive,
      captionDiff,
    }), "utf8");

    // The run is not finished until the set it just claimed to write is actually
    // on disk and self-consistent. Reporting success without checking is how a
    // half-written directory reaches the next step looking complete.
    const verified = verifyArtifacts(outDir);
    if (!verified.ok) {
      throw new RunFailure(5, ["The run finished but its output does not verify:",
        ...verified.problems.map((p) => `  - ${p}`)]);
    }

    return {
      ok: true, slug, outDir, title: titleFrom(slug, title),
      duration: fmtTime(result.duration, true),
      language: result.language, model: result.model,
      segments: result.segments.length,
      words: totalWords,
      report: reportPath,
      review: { pending: true, mode: totalWords <= REVIEW_WORD_BUDGET ? "full" : "flagged", words: totalWords },
      issues: issues.counts,
      descriptive,
      warnings,
      captions: captions
        ? { file: CAPTIONS_FILE, segments: captions.length, disagreements: captionDiff.length }
        : null,
      verified: { ok: verified.ok, reviewed: verified.reviewed, notes: verified.notes },
      files: [indexPath, jsonPath, join(outDir, "_meta.md"), reportPath, ...(descriptive?.files || [])],
    };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---- batch index ---------------------------------------------------------------

// A drop of ten recordings is ten sibling directories with nothing tying them
// together. This is the one file that says what the set is — and, like every
// other file here, it is written by the script: hand-maintaining a list of
// directories is exactly the thing that goes stale the first time one is re-run.

function readFrontmatter(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// Every fact here is read back off disk rather than carried over from the run,
// so a regenerated index describes what the directories actually hold now —
// including the descriptive transcripts that did not exist when the batch ended.
export function collectBatchEntries(outRoot, slugs, fs = { existsSync, readFrontmatter, readFileSync }) {
  return slugs.map((slug) => {
    const dir = join(outRoot, slug);
    const index = fs.readFrontmatter(join(dir, "index.md"));
    const descriptive = fs.existsSync(join(dir, "transcript.md"))
      ? fs.readFrontmatter(join(dir, "transcript.md"))
      : null;
    return { slug, dir, present: Boolean(index), index: index || {}, descriptive };
  });
}

export function buildBatchIndexMd({ entries, fetchedAt, failed = [] }) {
  const L = [`# Video transcripts — batch of ${fetchedAt}`, ""];
  const ok = entries.filter((e) => e.present);
  const withDescriptive = ok.filter((e) => e.descriptive).length;

  L.push(`${ok.length} recording${ok.length === 1 ? "" : "s"}, `
    + `${withDescriptive} of them with a descriptive transcript assembled.`
    + (failed.length ? ` ${failed.length} source${failed.length === 1 ? "" : "s"} failed — listed at the end.` : ""), "");
  L.push("In each directory: `transcript.md` is the descriptive transcript (speakers, on-screen",
    "text, and visible action woven into the timeline), `index.md` the machine-readable verbatim",
    "record, and `transcript.txt` the report — the same speech again with a list of what in it is",
    "most likely wrong.", "");

  for (const e of ok) {
    const fm = e.index;
    L.push(`## ${fm.title || titleFrom(e.slug)}`, "");
    L.push(`- **Directory:** [\`${e.slug}/\`](${e.slug}/)`);
    const runs = [fm.duration, fm.language, fm.model && `model \`${fm.model}\``,
      fm.segments && `${fm.segments} segments`].filter(Boolean);
    if (runs.length) L.push(`- **Runs:** ${runs.join(" · ")}`);
    if (e.descriptive) {
      const named = Number(e.descriptive.speakers_named ?? NaN);
      const unnamed = Number(e.descriptive.speakers_unnamed ?? NaN);
      const total = Number(e.descriptive.speakers ?? NaN);
      const who = Number.isFinite(named) || Number.isFinite(unnamed)
        ? `${Number.isFinite(named) ? named : 0} named`
          + (Number.isFinite(unnamed) && unnamed ? `, ${unnamed} identified by role only` : "")
        : Number.isFinite(total) ? `${total} speakers` : "speakers listed in the file";
      L.push(`- **Descriptive transcript:** [transcript.md](${e.slug}/transcript.md) — ${who}`);
    } else {
      L.push(`- **Descriptive transcript:** not assembled yet — the deterministic inputs `
        + `(frames, outline, captions) are in \`${e.slug}/\`, so it can be written without re-transcribing.`);
    }
    L.push(`- **Verbatim record:** [index.md](${e.slug}/index.md) · **Report:** [transcript.txt](${e.slug}/transcript.txt)`);
    if (fm.text_source) {
      L.push(`- **Speech comes from:** ${fm.text_source === "publisher-captions"
        ? "the publisher's own caption track (a person's wording, not the recognizer's guess)"
        : "speech recognition, with no caption track to check it against"}`);
    }
    if (fm.source) L.push(`- **Source:** ${fm.source}`);
    L.push("");
  }

  const missing = entries.filter((e) => !e.present);
  if (missing.length) {
    L.push("## Directories this index expected but did not find", "");
    for (const e of missing) L.push(`- \`${e.slug}/\` — no \`index.md\`; the run was removed or never finished.`);
    L.push("");
  }
  if (failed.length) {
    L.push("## Sources that failed", "");
    for (const f of failed) L.push(`- ${f.source} — ${f.error}`);
    L.push("");
  }
  L.push("---", "", "Machine transcription. Names, jargon, and numbers are its least reliable parts —",
    "check anything you plan to quote or treat as fact against the recording itself.", "");
  return L.join("\n");
}

// Never clobber an earlier batch that happens to share today's date: two drops in
// one afternoon are two different sets, and merging them silently loses one.
function pickBatchFile(outRoot, fetchedAt) {
  const base = `_batch-${fetchedAt}`;
  let name = `${base}.md`;
  for (let n = 2; existsSync(join(outRoot, name)) && !has("--force"); n++) name = `${base}-${n}.md`;
  return join(outRoot, name);
}

function writeBatchIndex({ outRoot, slugs, fetchedAt, failed = [], file }) {
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(file, buildBatchIndexMd({
    entries: collectBatchEntries(outRoot, slugs, { existsSync, readFrontmatter, readFileSync }),
    fetchedAt, failed,
  }), "utf8");
  return file;
}

function doBatchIndex() {
  const outRoot = firstPositional();
  if (!outRoot) usage("Missing <out-dir>.");
  if (!existsSync(outRoot)) { console.error(`No such directory: ${outRoot}`); process.exit(2); }
  const slugs = String(flag("--slugs", "")).split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) usage("Missing --slugs <a,b,c> — the recordings this index covers.");
  const fetchedAt = flag("--date", new Date().toISOString().slice(0, 10));
  const file = flag("--file", null)
    ? join(resolve(outRoot), flag("--file", null))
    : join(resolve(outRoot), `_batch-${fetchedAt}.md`);
  writeBatchIndex({ outRoot: resolve(outRoot), slugs, fetchedAt, file });
  const entries = collectBatchEntries(resolve(outRoot), slugs, { existsSync, readFrontmatter, readFileSync });
  console.log(JSON.stringify({
    ok: entries.every((e) => e.present), batchIndex: file,
    recordings: entries.length,
    descriptive: entries.filter((e) => e.descriptive).length,
    missing: entries.filter((e) => !e.present).map((e) => e.slug),
  }, null, 2));
}

// ---- dispatch ------------------------------------------------------------------

// Only dispatch when run as a program; tests import the pure helpers above.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (cmd === "check") doCheck();
  else if (cmd === "probe") doProbe();
  else if (cmd === "slice") doSlice();
  else if (cmd === "review") doReview();
  else if (cmd === "annotate") doAnnotate();
  else if (cmd === "verify") doVerify();
  else if (cmd === "batch-index") doBatchIndex();
  else if (cmd === "timeline") doTimeline();
  else if (cmd === "run") await doRun();
  else usage(cmd ? `Unknown command: ${cmd}` : "Missing command.");
}
