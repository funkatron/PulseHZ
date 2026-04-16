"""Browser preview transcode: upload → H.264 MP4."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from pulsehz import ffmpeg_cli
from pulsehz.rendering import build_preview_transcode_command
from pulsehz.upload_utils import persist_upload_to_dir

router = APIRouter(tags=["preview"])


def _cleanup_dir(path: str) -> None:
    import shutil

    shutil.rmtree(path, ignore_errors=True)


@router.post("/api/preview-video")
async def preview_video(video: UploadFile = File(...)):
    """Transcode a clip to H.264 MP4 for <video> preview when the browser cannot decode the source."""
    if not video.filename:
        raise HTTPException(status_code=400, detail="Missing video filename")

    suffix = Path(video.filename).suffix or ".mp4"
    temp_dir = tempfile.mkdtemp(prefix="pulsehz-preview-")

    try:
        source_path = await persist_upload_to_dir(video, temp_dir, f"source{suffix}")
        output_path = str(Path(temp_dir) / "preview.mp4")
        cmd = build_preview_transcode_command(source_path, output_path)
        result = ffmpeg_cli.run_ffmpeg_preview(cmd, timeout=600)
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=result.stderr[:4000] if result.stderr else "FFmpeg preview transcode failed",
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
