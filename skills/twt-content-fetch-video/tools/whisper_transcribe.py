#!/usr/bin/env python3
"""whisper_transcribe.py — faster-whisper worker behind /twt-content-fetch-video.

Invoked only by transcribe-video.mjs; not a user-facing entry point.

  python whisper_transcribe.py --media <path> --out <json> [--model base]
                               [--language auto] [--device cpu]
                               [--compute-type int8]

Writes a single JSON object to --out:
  {language, language_probability, duration, model, device, compute_type,
   segments: [{start, end, text}, ...]}

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
    ap.add_argument("--model", default="base")
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
    segments, info = model.transcribe(
        args.media,
        beam_size=args.beam_size,
        language=language,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

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
                             "text": text})
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
        "segments": out_segments,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    print(f"done: {len(out_segments)} segments in {payload['transcribe_seconds']}s", file=sys.stderr)


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
