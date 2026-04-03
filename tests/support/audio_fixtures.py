"""Optional on-disk audio files for manual / optional automated checks."""

from __future__ import annotations

import os
from pathlib import Path

# Default: user's recovered remix on T7. Override with PULSEHZ_TEST_WAV for CI or other machines.
TOOL_N_DIE_REMIX_DEFAULT = Path(
    "/Volumes/T7-1TB/dbrecovered/Tool'n'Die remix.wav",
)


def resolve_tool_n_die_remix_path() -> Path | None:
    """Return path to the Tool'n'Die remix WAV if it exists, else ``None``."""
    env = os.environ.get("PULSEHZ_TEST_WAV", "").strip()
    if env:
        candidate = Path(env).expanduser()
        return candidate if candidate.is_file() else None
    return TOOL_N_DIE_REMIX_DEFAULT if TOOL_N_DIE_REMIX_DEFAULT.is_file() else None
