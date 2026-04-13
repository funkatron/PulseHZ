"""On-disk audio files for tests and manual BPM / sync checks."""

from __future__ import annotations

import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Committed golden track (MP3). Override with PULSEHZ_TEST_WAV for another path.
_GOLDEN_REL = Path("tests/fixtures/audio/vco-berlin-deathbycuriosity-remix.mp3")

# Legacy default: external WAV on T7 (used only if env unset and committed file missing).
_TOOL_N_DIE_LEGACY = Path("/Volumes/T7-1TB/dbrecovered/Tool'n'Die remix.wav")


def resolve_golden_audio_path() -> Path | None:
    """Return path to the golden reference audio if available, else ``None``.

    Resolution order:

    1. ``PULSEHZ_TEST_WAV`` if set and the path exists (any supported extension).
    2. Committed file under ``tests/fixtures/audio/`` if present.
    3. Legacy T7 Tool'n'Die WAV path if present (backwards compatibility).
    """
    env = os.environ.get("PULSEHZ_TEST_WAV", "").strip()
    if env:
        candidate = Path(env).expanduser()
        return candidate if candidate.is_file() else None
    committed = _REPO_ROOT / _GOLDEN_REL
    if committed.is_file():
        return committed
    return _TOOL_N_DIE_LEGACY if _TOOL_N_DIE_LEGACY.is_file() else None


def resolve_tool_n_die_remix_path() -> Path | None:
    """Deprecated alias for :func:`resolve_golden_audio_path`."""
    return resolve_golden_audio_path()


def mp3_magic_looks_valid(path: Path) -> bool:
    """Lightweight check that ``path`` looks like an MP3 (ID3v2 or MPEG frame sync)."""
    data = path.read_bytes()[:4096]
    if len(data) < 4:
        return False
    if data[:3] == b"ID3":
        return True
    for i in range(len(data) - 1):
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            return True
    return False
