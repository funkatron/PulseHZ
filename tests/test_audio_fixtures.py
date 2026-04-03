"""Optional tests gated on the Tool'n'Die remix fixture (or ``PULSEHZ_TEST_WAV``)."""

from __future__ import annotations

import wave

import pytest

from tests.support.audio_fixtures import resolve_tool_n_die_remix_path


@pytest.fixture(scope="module")
def tool_n_die_remix_path():
    path = resolve_tool_n_die_remix_path()
    if path is None:
        pytest.skip(
            "Mount T7 fixture or set PULSEHZ_TEST_WAV to a WAV path "
            "(e.g. .../Tool'n'Die remix.wav).",
        )
    return path


def test_tool_n_die_remix_is_readable_pcm_wav(tool_n_die_remix_path):
    """Sanity-check the file so browser BPM / export tests have a known-good clip."""
    with wave.open(str(tool_n_die_remix_path), "rb") as handle:
        assert handle.getnchannels() >= 1
        assert handle.getsampwidth() >= 1
        assert handle.getframerate() > 0
        assert handle.getnframes() > 0


def test_tool_n_die_remix_non_trivial_duration(tool_n_die_remix_path):
    with wave.open(str(tool_n_die_remix_path), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
        duration = frames / float(rate)
    assert duration >= 5.0, "Fixture should be long enough for onset/BPM analysis"


def test_tool_n_die_remix_librosa_bpm_plausible(tool_n_die_remix_path):
    """Requires ``uv sync --extra audio``; skipped when librosa is not installed."""
    librosa = pytest.importorskip("librosa")
    import numpy as np

    y, sr = librosa.load(str(tool_n_die_remix_path), sr=None, mono=True, duration=120.0)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    arr = np.asarray(tempo, dtype=float).ravel()
    bpm = float(np.mean(arr)) if arr.size else 0.0
    assert 85.0 < bpm < 175.0, f"unexpected librosa tempo {bpm}"
