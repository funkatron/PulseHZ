"""Timing helpers shared by preview and export code."""

from __future__ import annotations


def bar_duration_seconds(bpm: float, beats_per_bar: int = 4) -> float:
    """Return the duration of one bar in seconds."""
    if bpm <= 0:
        raise ValueError("bpm must be greater than 0")
    if beats_per_bar <= 0:
        raise ValueError("beats_per_bar must be greater than 0")

    return (60.0 / bpm) * beats_per_bar
