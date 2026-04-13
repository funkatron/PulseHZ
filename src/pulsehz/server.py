from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Literal, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, field_validator
from starlette.background import BackgroundTask

from pulsehz.rendering import (
    SUPPORTED_BLEND_MODES,
    build_filter_complex,
    build_preview_transcode_command,
    iter_video_layers,
    parse_resolution,
)
from pulsehz.constants import DEFAULT_LISTEN_PORT
from pulsehz.project_controls import ProjectControls
from pulsehz.timing import bar_duration_seconds

APP_DIR = Path(__file__).resolve().parents[2]
PUBLIC_DIR = APP_DIR / "public"

app = FastAPI(title="PulseHZ Video Export API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Root endpoint returns API metadata."""
    return {
        "service": "PulseHZ Video Export API",
        "version": "1.0.0",
        "status": "ok",
        "app": "/app/",
    }


class LayerMetadata(BaseModel):
    id: int
    blendMode: str = "normal"
    hasVideo: bool = False
    sourceName: Optional[str] = None
    sourceDurationSeconds: Optional[float] = None
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    """How many bars one full clip loop spans at the transport tempo (preview + FFmpeg setpts)."""
    barsPerLoop: int = Field(default=1, ge=1, le=4)

    @field_validator("barsPerLoop")
    @classmethod
    def bars_per_loop_allowed(cls, value: int) -> int:
        if value in (1, 2, 4):
            return value
        return 1


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


def _cleanup_dir(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)


def _parse_metadata(metadata: str) -> ProjectMetadata:
    try:
        payload = json.loads(metadata)
        return ProjectMetadata.model_validate(payload)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid metadata: {exc}") from exc


async def _persist_upload(upload: UploadFile, target_dir: str, filename: str) -> str:
    destination = Path(target_dir) / filename
    with destination.open("wb") as output:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    await upload.close()
    return str(destination)


def _default_render_duration(metadata: ProjectMetadata, has_audio: bool) -> float:
    transport = metadata.transport
    if transport.renderDurationSeconds and transport.renderDurationSeconds > 0:
        return transport.renderDurationSeconds
    if transport.barDurationSeconds and transport.barDurationSeconds > 0:
        return transport.barDurationSeconds
    if has_audio:
        return 3600.0
    return bar_duration_seconds(transport.bpm, transport.beatsPerBar)


def _build_ffmpeg_command(
    metadata: ProjectMetadata,
    video_paths: list[str],
    audio_path: Optional[str],
    output_file: str,
) -> list[str]:
    width, height = parse_resolution(metadata.exportSettings.resolution)
    frame_rate = metadata.exportSettings.frameRate
    render_duration = _default_render_duration(metadata, bool(audio_path))
    bar_duration = metadata.transport.barDurationSeconds or bar_duration_seconds(
        metadata.transport.bpm, metadata.transport.beatsPerBar
    )
    video_layers = iter_video_layers([layer.model_dump() for layer in metadata.layers])
    backdrop = metadata.exportSettings.backdrop
    filter_complex = build_filter_complex(
        layers=video_layers,
        width=width,
        height=height,
        frame_rate=frame_rate,
        bar_duration_seconds=bar_duration,
        render_duration_seconds=render_duration,
        backdrop=backdrop,
    )

    video_input_offset = 1 if backdrop in ("black", "white") else 0
    command: list[str] = ["ffmpeg", "-y"]
    if video_input_offset:
        command.extend(
            [
                "-f",
                "lavfi",
                "-i",
                f"color=c={backdrop}:s={width}x{height}:r={frame_rate}:d={render_duration:.6f}",
            ]
        )
    for path in video_paths:
        command.extend(["-stream_loop", "-1", "-i", path])

    if audio_path:
        command.extend(["-i", audio_path])

    video_pix_fmt = "yuva444p10le" if backdrop == "transparent" else "yuv444p10le"
    command.extend(
        [
            "-filter_complex",
            filter_complex,
            "-map",
            "[outv]",
            "-c:v",
            "prores_ks",
            "-profile:v",
            "4",
            "-pix_fmt",
            video_pix_fmt,
        ]
    )

    if audio_path:
        audio_input_index = len(video_paths) + video_input_offset
        command.extend(["-map", f"{audio_input_index}:a", "-c:a", "aac", "-shortest"])
    else:
        command.extend(["-t", f"{render_duration:.6f}"])

    command.append(output_file)
    return command


@app.post("/api/export-video")
async def export_video(
    metadata: str = Form(...),
    video_files: List[UploadFile] = File(default_factory=list),
    audio_file: Optional[UploadFile] = File(default=None),
):
    """Export video from uploaded media and project metadata."""
    project = _parse_metadata(metadata)
    video_layers = [layer for layer in project.layers if layer.hasVideo]

    if not video_layers:
        raise HTTPException(status_code=400, detail="No video layers found")
    if len(video_files) != len(video_layers):
        raise HTTPException(
            status_code=400,
            detail="Uploaded video file count must match layers marked hasVideo=true",
        )

    temp_dir = tempfile.mkdtemp(prefix="pulsehz-export-")

    try:
        persisted_video_paths: list[str] = []
        for index, upload in enumerate(video_files):
            suffix = Path(upload.filename or f"layer-{index}.mp4").suffix or ".mp4"
            persisted_video_paths.append(
                await _persist_upload(upload, temp_dir, f"layer-{index}{suffix}")
            )

        persisted_audio_path: Optional[str] = None
        if audio_file is not None and audio_file.filename:
            suffix = Path(audio_file.filename).suffix or ".wav"
            persisted_audio_path = await _persist_upload(audio_file, temp_dir, f"audio{suffix}")

        output_file = str(Path(temp_dir) / "output.mov")
        ffmpeg_cmd = _build_ffmpeg_command(project, persisted_video_paths, persisted_audio_path, output_file)
        result = subprocess.run(
            ffmpeg_cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr or "Video processing failed")

        filename = f"{project.projectName.replace(' ', '_')}-prores.mov"
        return FileResponse(
            path=output_file,
            filename=filename,
            media_type="video/quicktime",
            background=BackgroundTask(_cleanup_dir, temp_dir),
        )
    except HTTPException:
        _cleanup_dir(temp_dir)
        raise
    except ValueError as exc:
        _cleanup_dir(temp_dir)
        raise HTTPException(
            status_code=422,
            detail=str(exc) or "Invalid export parameters",
        ) from exc
    except Exception as exc:
        _cleanup_dir(temp_dir)
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}") from exc

@app.post("/api/preview-video")
async def preview_video(video: UploadFile = File(...)):
    """Transcode a clip to H.264 MP4 for <video> preview when the browser cannot decode the source."""
    if not video.filename:
        raise HTTPException(status_code=400, detail="Missing video filename")

    suffix = Path(video.filename).suffix or ".mp4"
    temp_dir = tempfile.mkdtemp(prefix="pulsehz-preview-")

    try:
        source_path = await _persist_upload(video, temp_dir, f"source{suffix}")
        output_path = str(Path(temp_dir) / "preview.mp4")
        cmd = build_preview_transcode_command(source_path, output_path)
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=result.stderr[:4000] or "FFmpeg preview transcode failed",
            )

        return FileResponse(
            path=output_path,
            media_type="video/mp4",
            filename="pulsehz-preview.mp4",
            background=BackgroundTask(_cleanup_dir, temp_dir),
        )
    except HTTPException:
        _cleanup_dir(temp_dir)
        raise
    except Exception as exc:
        _cleanup_dir(temp_dir)
        raise HTTPException(status_code=500, detail=f"Preview transcode failed: {exc}") from exc


@app.get("/api/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy", "service": "PulseHZ Video Export API"}

@app.get("/api/info")
async def get_info():
    """Get API information and capabilities"""
    return {
        "name": "PulseHZ Video Export API",
        "version": "1.0.0",
        "capabilities": {
            "formats": ["ProRes 4444 (yuv444p10le)", "ProRes 4444+alpha (yuva444p10le)", "ProRes 422", "H.264"],
            "resolutions": [
                "1280x720",
                "1920x1080",
                "3840x2160",
                "720x1280",
                "1080x1920",
                "2160x3840",
                "1680x720",
                "2520x1080",
                "5040x2160",
                "720x1680",
                "1080x2520",
                "2160x5040",
                "720x720",
                "1080x1080",
                "2160x2160",
                "720x1720",
                "1440x3440",
            ],
            "frameRates": [24, 30, 60],
            "blendModes": SUPPORTED_BLEND_MODES,
        },
        "performance": {
            "async": True,
            "streaming": True,
            "timeout": "5 minutes",
        },
    }


if PUBLIC_DIR.exists():
    app.mount("/app", StaticFiles(directory=PUBLIC_DIR, html=True), name="app")

if __name__ == '__main__':
    print("🎬 PulseHZ Video Export API Starting...")
    print("🔧 ProRes export endpoint: /api/export-video")
    print(f"🌐 API at: http://localhost:{DEFAULT_LISTEN_PORT}")
    print(f"🖥️ Browser app at: http://localhost:{DEFAULT_LISTEN_PORT}/app/")
    print("💡 Make sure FFmpeg is installed and in PATH")
    print("⚡ FastAPI server with optimized performance")

    uvicorn.run(
        "pulsehz.server:app",
        host="0.0.0.0",
        port=DEFAULT_LISTEN_PORT,
        reload=False,
        workers=1,
        loop="asyncio",
        access_log=True,
    )