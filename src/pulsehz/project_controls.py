"""Shared project schema for transport-locked modulation and MIDI control.

See ``docs/presentation-model.md`` for how this fits the single presentation
document shared by realtime (browser) and offline (FFmpeg) interpreters.

Live playback applies these routes in the browser; offline export may either
sample them at export frame rate or ignore them until bake support exists.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ParamRef(BaseModel):
    """Stable address for a modulatable value (browser + future FFmpeg)."""

    model_config = ConfigDict(populate_by_name=True)

    scope: Literal["global", "layer", "master"]
    """global = project/canvas; layer = numbered video layer; master = reserved."""

    layerId: Optional[int] = Field(default=None, ge=1, le=32)
    """Required when scope is ``layer`` (matches PulseHZ layer ids)."""

    paramId: str
    """Catalog id, e.g. ``opacity``, ``contrast``, ``hueShift``."""

    @model_validator(mode="after")
    def _layer_matches_scope(self) -> ParamRef:
        if self.scope == "layer" and self.layerId is None:
            raise ValueError("layerId required when scope is 'layer'")
        if self.scope != "layer" and self.layerId is not None:
            raise ValueError("layerId only valid when scope is 'layer'")
        return self


class LfoConfig(BaseModel):
    """BPM-relative or free-running low-frequency oscillator."""

    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["lfo"] = "lfo"
    waveform: Literal["sine", "triangle", "square", "saw_up", "saw_down"] = "sine"
    rateBeats: Optional[float] = Field(default=None, gt=0)
    """Period in **beats** (quarter notes) at project BPM."""

    rateHz: Optional[float] = Field(default=None, gt=0)
    """Absolute rate when not locking to transport."""

    phaseTurns: float = Field(default=0.0, ge=0.0, lt=1.0)
    """Phase offset as fraction of one LFO cycle."""

    depth: float = Field(default=1.0, ge=-4.0, le=4.0)
    offset: float = Field(default=0.0, ge=-4.0, le=4.0)

    @model_validator(mode="after")
    def _rate_xor(self) -> LfoConfig:
        if self.rateBeats is None and self.rateHz is None:
            raise ValueError("set either rateBeats or rateHz")
        if self.rateBeats is not None and self.rateHz is not None:
            raise ValueError("use only one of rateBeats or rateHz")
        return self


class ModulationRoute(BaseModel):
    """One continuous mapping from a generator to a parameter."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    enabled: bool = True
    target: ParamRef
    source: LfoConfig
    amount: float = Field(default=1.0, ge=0.0, le=4.0)


class MidiCcBinding(BaseModel):
    """Map a MIDI control change to a parameter (Web MIDI in browser)."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    enabled: bool = True
    channel: int = Field(default=-1, ge=-1, le=15)
    """0–15 specific; **-1** = any channel (learn / omni)."""

    controller: int = Field(ge=0, le=127)
    target: ParamRef
    mode: Literal["absolute", "rel_encoded"] = "absolute"
    minOut: float = 0.0
    maxOut: float = 1.0


class ProjectControls(BaseModel):
    """Extension block; optional on project metadata."""

    model_config = ConfigDict(populate_by_name=True)

    schemaVersion: int = 1
    modulation: list[ModulationRoute] = Field(default_factory=list)
    midi: list[MidiCcBinding] = Field(default_factory=list)


def default_project_controls() -> dict:
    """Empty payload matching what the web app serializes today."""

    return ProjectControls().model_dump(mode="json")
