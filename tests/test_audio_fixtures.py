"""Tests for the golden reference audio (committed MP3 or ``PULSEHZ_TEST_WAV``)."""

from __future__ import annotations

import shutil
import subprocess
import wave

import pytest

from tests.support.audio_fixtures import (
    mp3_magic_looks_valid,
    resolve_golden_audio_path,
)


def _audio_duration_seconds(path) -> float:
    """Duration in seconds; supports WAV via stdlib, MP3 via ffprobe or librosa."""
    suffix = path.suffix.lower()
    if suffix == ".wav":
        with wave.open(str(path), "rb") as handle:
            return handle.getnframes() / float(handle.getframerate())
    if suffix == ".mp3":
        ffprobe = shutil.which("ffprobe")
        if ffprobe:
            result = subprocess.run(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(path),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            return float(result.stdout.strip())
        librosa = pytest.importorskip("librosa")
        y, sr = librosa.load(str(path), sr=None, mono=True)
        return float(len(y)) / float(sr)
    raise AssertionError(f"unsupported extension {suffix}")


@pytest.fixture(scope="module")
def golden_audio_path():
    path = resolve_golden_audio_path()
    if path is None:
        pytest.skip(
            "Set PULSEHZ_TEST_WAV or add tests/fixtures/audio/vco-berlin-deathbycuriosity-remix.mp3",
        )
    return path


def test_golden_audio_is_readable(golden_audio_path):
    """Sanity-check the file so BPM / export workflows have a known-good clip."""
    suffix = golden_audio_path.suffix.lower()
    if suffix == ".wav":
        with wave.open(str(golden_audio_path), "rb") as handle:
            assert handle.getnchannels() >= 1
            assert handle.getsampwidth() >= 1
            assert handle.getframerate() > 0
            assert handle.getnframes() > 0
    elif suffix == ".mp3":
        assert golden_audio_path.stat().st_size >= 4096
        assert mp3_magic_looks_valid(golden_audio_path)
    else:
        pytest.fail(f"unsupported golden audio extension: {suffix}")


def test_golden_audio_non_trivial_duration(golden_audio_path):
    duration = _audio_duration_seconds(golden_audio_path)
    assert duration >= 5.0, "Fixture should be long enough for onset/BPM analysis"


def test_golden_audio_librosa_bpm_plausible(golden_audio_path):
    """Requires ``uv sync --extra audio``; skipped when librosa is not installed."""
    librosa = pytest.importorskip("librosa")
    import numpy as np

    y, sr = librosa.load(str(golden_audio_path), sr=None, mono=True, duration=120.0)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    arr = np.asarray(tempo, dtype=float).ravel()
    bpm = float(np.mean(arr)) if arr.size else 0.0
    assert 85.0 < bpm < 175.0, f"unexpected librosa tempo {bpm}"
