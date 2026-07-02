"""HTTP/API Pydantic models — no FastAPI imports (usable from tests and tooling)."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from pulsehz.project_controls import ProjectControls


class LayerMetadata(BaseModel):
    id: int
    blendMode: str = "normal"
    hasVideo: bool = False
    sourceName: Optional[str] = None
    sourceDurationSeconds: Optional[float] = None
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    """How many bars one full clip loop spans at the transport tempo (preview + FFmpeg setpts)."""
    barsPerLoop: int = Field(default=1, ge=1, le=4)
    """Letterbox (contain) vs center-crop (cover) when mapping the clip into the output frame."""
    canvasFit: Literal["fit", "fill"] = "fit"

    @field_validator("barsPerLoop")
    @classmethod
    def bars_per_loop_allowed(cls, value: int) -> int:
        if value in (1, 2, 4):
            return value
        return 1

    @field_validator("canvasFit", mode="before")
    @classmethod
    def canvas_fit_coerce(cls, value: object) -> str:
        if value is None or value == "":
            return "fit"
        s = str(value).lower()
        return "fill" if s == "fill" else "fit"


class TransportSettings(BaseModel):
    bpm: float = 120.0
    beatsPerBar: int = 4
    barDurationSeconds: Optional[float] = None
    renderDurationSeconds: Optional[float] = None


class ExportSettings(BaseModel):
    resolution: str = "1920x1080"
    frameRate: int = 60
    codec: str = "prores_4444"
    quality: str = "professional"
    backdrop: Literal["black", "white", "transparent"] = "transparent"


class ProjectMetadata(BaseModel):
    version: str
    projectName: str
    createdAt: str
    exportSettings: ExportSettings = ExportSettings()
    transport: TransportSettings = TransportSettings()
    layers: List[LayerMetadata]
    controls: Optional[ProjectControls] = None
