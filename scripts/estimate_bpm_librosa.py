#!/usr/bin/env python3
"""Global tempo estimate using librosa (install: ``uv sync --extra audio``)."""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Report BPM via librosa.beat.beat_track (good sanity check vs browser onset heuristic).",
    )
    parser.add_argument("audio_path", help="WAV, MP3, etc. (anything librosa/soundfile can load)")
    parser.add_argument(
        "--seconds",
        type=float,
        default=None,
        help="Load only the first N seconds (faster on long files)",
    )
    parser.add_argument(
        "--sr",
        type=int,
        default=None,
        help="Resample to this sample rate (default: native)",
    )
    args = parser.parse_args(argv)

    try:
        import librosa
        import numpy as np
    except ImportError:
        print("Missing librosa. Run: uv sync --extra audio", file=sys.stderr)
        return 1

    y, sr = librosa.load(
        args.audio_path,
        sr=args.sr,
        mono=True,
        duration=args.seconds,
    )
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    arr = np.asarray(tempo).astype(float).ravel()
    bpm = float(np.mean(arr)) if arr.size else float("nan")
    print(f"{bpm:.2f} BPM (librosa beat_track, sr={sr})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
