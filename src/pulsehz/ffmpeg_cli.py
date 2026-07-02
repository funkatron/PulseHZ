"""Single place for invoking FFmpeg via subprocess (tests monkeypatch `run_ffmpeg`)."""

from __future__ import annotations

import subprocess


def run_ffmpeg(
    cmd: list[str],
    *,
    capture_output: bool = True,
    text: bool = True,
    timeout: int = 300,
) -> subprocess.CompletedProcess[str]:
    """Run an FFmpeg command line; default timeout 5 minutes (export)."""
    return subprocess.run(
        cmd,
        capture_output=capture_output,
        text=text,
        timeout=timeout,
    )


def run_ffmpeg_preview(
    cmd: list[str],
    *,
    capture_output: bool = True,
    text: bool = True,
    timeout: int = 600,
) -> subprocess.CompletedProcess[str]:
    """Preview transcode may run longer than a short export."""
    return run_ffmpeg(cmd, capture_output=capture_output, text=text, timeout=timeout)
