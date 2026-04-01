"""Tests for transport timing helpers."""

import pytest

from pulsehz.timing import bar_duration_seconds


def test_bar_duration_seconds_for_common_bpms():
    assert bar_duration_seconds(120) == pytest.approx(2.0)
    assert bar_duration_seconds(60) == pytest.approx(4.0)
    assert bar_duration_seconds(90) == pytest.approx(2.666666, rel=1e-5)


def test_bar_duration_seconds_validates_input():
    with pytest.raises(ValueError):
        bar_duration_seconds(0)

    with pytest.raises(ValueError):
        bar_duration_seconds(120, beats_per_bar=0)
