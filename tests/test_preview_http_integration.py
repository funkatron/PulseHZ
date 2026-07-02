"""Live HTTP smoke: real uvicorn + real FFmpeg preview transcode (guards against 404 / broken wiring)."""

from __future__ import annotations

import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not on PATH")


def _free_tcp_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def test_preview_video_endpoint_over_tcp(tmp_path: Path) -> None:
    in_mp4 = tmp_path / "in.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=0.4:size=320x240:rate=30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(in_mp4),
            "-loglevel",
            "error",
        ],
        check=True,
    )

    port = _free_tcp_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "pulsehz.server:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=Path(__file__).resolve().parents[1],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 25.0
        while time.time() < deadline:
            try:
                r = httpx.get(f"{base}/api/health", timeout=0.5)
                if r.status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        else:
            pytest.fail("uvicorn did not become ready")

        wrong = httpx.post(f"{base}/api/preview-videos", timeout=2.0)
        assert wrong.status_code == 404

        with in_mp4.open("rb") as fh:
            post = httpx.post(
                f"{base}/api/preview-video",
                files={"video": ("smoke.mp4", fh, "video/mp4")},
                timeout=120.0,
            )

        assert post.status_code == 200, post.text[:500]
        assert "video/mp4" in post.headers.get("content-type", "")
        assert len(post.content) > 500
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
