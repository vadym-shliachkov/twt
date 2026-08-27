#!/usr/bin/env python3
"""whisper_transcribe.py — faster-whisper worker behind /twt-content-fetch-video.

Invoked only by transcribe-video.mjs; not a user-facing entry point.

  python whisper_transcribe.py --media <path> --out <json> [--model medium]
                               [--language auto] [--device cpu]
                               [--compute-type int8]

Writes a single JSON object to --out:
  {language, language_probability, duration, model, device, compute_type,
   decode, faster_whisper,
   segments: [{start, end, text, avg_logprob, no_speech_prob,
               compression_ratio}, ...]}

The three per-segment scores are the recognizer's own confidence signals and
are what the caller's issue detector reads: avg_logprob falls when the audio
was hard, no_speech_prob rises when there may have been nothing to transcribe,
and compression_ratio rises when the decoder fell into a repetition loop.

Progress goes to stderr so the caller can stream it. Exit 0 on success,
3 when faster-whisper is not importable, 1 on any other failure.
"""
import argparse
import json
import sys
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="medium")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", dest="compute_type", default="int8")
    ap.add_argument("--beam-size", dest="beam_size", type=int, default=5)
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(f"faster-whisper is not installed: {exc}", file=sys.stderr)
        sys.exit(3)

    print(f"loading model '{args.model}' ({args.device}/{args.compute_type}) …", file=sys.stderr)
    print("first use of a model size downloads its weights from HuggingFace", file=sys.stderr)
    t0 = time.time()
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    print(f"model ready in {time.time() - t0:.1f}s; transcribing …", file=sys.stderr)

    language = None if args.language in ("auto", "", None) else args.language
    # Decoding is pinned rather than left to the defaults, so two runs of the same
    # file are comparable. temperature=0 removes the temperature-fallback ladder,
    # whose retries are the loudest source of run-to-run drift; turning off
    # condition_on_previous_text stops one diverging segment from re-steering
    # every segment after it, which is how the same recording came back as 24
    # segments one run and 31 the next. Exact bit-for-bit reproduction is still
    # not promised — CTranslate2's CPU kernels vary with thread count — so the
    # settings travel with the output instead of being assumed.
    decode = {
        "beam_size": args.beam_size,
        "temperature": 0.0,
        "condition_on_previous_text": False,
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 500},
    }
    segments, info = model.transcribe(args.media, language=language, **decode)

    duration = float(getattr(info, "duration", 0.0) or 0.0)
    out_segments = []
    t1 = time.time()
    last_report = 0.0
    # segments is a generator: transcription happens as it is consumed.
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        out_segments.append({"start": round(float(seg.start), 3),
                             "end": round(float(seg.end), 3),
                             "text": text,
                             "avg_logprob": score(seg, "avg_logprob"),
                             "no_speech_prob": score(seg, "no_speech_prob"),
                             "compression_ratio": score(seg, "compression_ratio")})
        if seg.end - last_report >= 30.0:
            last_report = seg.end
            elapsed = time.time() - t1
            pct = f" ({seg.end / duration * 100:.0f}%)" if duration else ""
            print(f"  … {fmt(seg.end)} of {fmt(duration)}{pct} — {elapsed:.0f}s elapsed",
                  file=sys.stderr)

    payload = {
        "language": getattr(info, "language", None),
        "language_probability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 3),
        "duration": round(duration, 3),
        "model": args.model,
        "device": args.device,
        "compute_type": args.compute_type,
        "transcribe_seconds": round(time.time() - t1, 1),
        "decode": decode,
        "faster_whisper": _engine_version(),
        "segments": out_segments,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    print(f"done: {len(out_segments)} segments in {payload['transcribe_seconds']}s", file=sys.stderr)


def _engine_version():
    """The faster-whisper build that produced this file.

    Recorded because the payload's shape depends on it: a build that does not
    expose the per-segment confidence scores yields a transcript nothing can
    check mechanically, and without the version stamped here that is invisible
    after the fact."""
    try:
        import faster_whisper
        return getattr(faster_whisper, "__version__", None)
    except Exception:  # noqa: BLE001 — a missing version never fails a run
        return None


def score(seg, name):
    """One of the recognizer's confidence scores, or None if this build omits it.

    Returned as None rather than 0 on purpose: a missing score must not read as
    a confident one downstream, and the issue detector skips None."""
    value = getattr(seg, name, None)
    if value is None:
        return None
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def fmt(seconds):
    seconds = int(seconds or 0)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001 — the caller only sees stderr + exit code
        print(f"transcription failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
