"""ProRes export: multipart uploads + FFmpeg."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from pulsehz import ffmpeg_cli
from pulsehz.export_build import build_prores_ffmpeg_command
from pulsehz.metadata_parse import parse_project_metadata
from pulsehz.upload_utils import persist_upload_to_dir

router = APIRouter(tags=["export"])


def _cleanup_dir(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)


@router.post("/api/export-video")
async def export_video(
    metadata: str = Form(...),
    video_files: List[UploadFile] = File(default_factory=list),
    audio_file: Optional[UploadFile] = File(default=None),
):
    """Export video from uploaded media and project metadata."""
    project = parse_project_metadata(metadata)
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
                await persist_upload_to_dir(upload, temp_dir, f"layer-{index}{suffix}")
            )

        persisted_audio_path: Optional[str] = None
        if audio_file is not None and audio_file.filename:
            suffix = Path(audio_file.filename).suffix or ".wav"
            persisted_audio_path = await persist_upload_to_dir(audio_file, temp_dir, f"audio{suffix}")

        output_file = str(Path(temp_dir) / "output.mov")
        ffmpeg_cmd = build_prores_ffmpeg_command(
            project, persisted_video_paths, persisted_audio_path, output_file
        )
        result = ffmpeg_cli.run_ffmpeg(ffmpeg_cmd, timeout=300)

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
