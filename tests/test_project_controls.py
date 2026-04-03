"""Contract tests for modulation + MIDI schema."""

import pytest
from pydantic import ValidationError

from pulsehz.project_controls import (
    LfoConfig,
    MidiCcBinding,
    ModulationRoute,
    ParamRef,
    ProjectControls,
    default_project_controls,
)
from pulsehz.server import ProjectMetadata


def test_default_controls_round_trip():
    raw = default_project_controls()
    parsed = ProjectControls.model_validate(raw)
    assert parsed.schemaVersion == 1
    assert parsed.modulation == []
    assert parsed.midi == []


def test_lfo_requires_exactly_one_rate():
    with pytest.raises(ValidationError):
        LfoConfig(rateBeats=None, rateHz=None)
    with pytest.raises(ValidationError):
        LfoConfig(rateBeats=1.0, rateHz=0.5)


def test_param_ref_layer_requires_layer_id():
    with pytest.raises(ValidationError):
        ParamRef(scope="layer", paramId="opacity")
    ParamRef(scope="layer", layerId=2, paramId="opacity")


def test_modulation_route_example():
    route = ModulationRoute(
        id="hue-drift-l1",
        target=ParamRef(scope="layer", layerId=1, paramId="hueShift"),
        source=LfoConfig(rateBeats=4.0, waveform="sine", depth=0.2, phaseTurns=0.0),
        amount=1.0,
    )
    dumped = route.model_dump(mode="json")
    assert dumped["target"]["paramId"] == "hueShift"


def test_layer_metadata_opacity_bounds():
    from pulsehz.server import LayerMetadata

    with pytest.raises(ValidationError):
        LayerMetadata(id=1, blendMode="normal", hasVideo=True, opacity=1.5)
    layer = LayerMetadata(id=1, blendMode="normal", hasVideo=True, opacity=0.4)
    assert layer.opacity == 0.4


def test_project_metadata_accepts_controls():
    payload = {
        "version": "2.0",
        "projectName": "X",
        "createdAt": "2025-01-01T00:00:00Z",
        "layers": [],
        "controls": {
            "schemaVersion": 1,
            "modulation": [
                {
                    "id": "m1",
                    "target": {"scope": "global", "paramId": "unknownYet"},
                    "source": {
                        "kind": "lfo",
                        "waveform": "sine",
                        "rateBeats": 0.5,
                        "phaseTurns": 0.0,
                        "depth": 1.0,
                        "offset": 0.0,
                    },
                    "amount": 1.0,
                }
            ],
            "midi": [
                {
                    "id": "k1",
                    "channel": -1,
                    "controller": 7,
                    "target": {"scope": "layer", "layerId": 1, "paramId": "opacity"},
                    "minOut": 0.0,
                    "maxOut": 1.0,
                }
            ],
        },
    }
    meta = ProjectMetadata.model_validate(payload)
    assert meta.controls is not None
    assert len(meta.controls.modulation) == 1
    assert meta.controls.midi[0].controller == 7
