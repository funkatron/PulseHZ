"""Tests for the FastAPI server functionality."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from pulsehz.rendering import build_filter_complex
from pulsehz.server import app

client = TestClient(app)


def _metadata_payload(**overrides):
    payload = {
        "version": "2.0",
        "projectName": "Test Project",
        "createdAt": "2025-01-01T00:00:00Z",
        "exportSettings": {
            "resolution": "1920x1080",
            "frameRate": 60,
            "codec": "prores_4444",
            "quality": "professional",
        },
        "transport": {
            "bpm": 120,
            "beatsPerBar": 4,
            "barDurationSeconds": 2.0,
            "renderDurationSeconds": 2.0,
        },
        "layers": [
            {
                "id": 1,
                "blendMode": "normal",
                "hasVideo": True,
                "sourceName": "layer-1.mp4",
                "sourceDurationSeconds": 2.0,
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_preview_video_get_is_method_not_allowed():
    """Route exists → GET must not be 404 (helps distinguish dead server / proxy from wrong method)."""
    response = client.get("/api/preview-video")
    assert response.status_code == 405


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "PulseHZ Video Export API"


def test_info_endpoint():
    response = client.get("/api/info")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "PulseHZ Video Export API"
    assert "capabilities" in data
    assert "normal" in data["capabilities"]["blendModes"]


def test_root_endpoint_returns_json():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "PulseHZ Video Export API"
    assert data["app"] == "/app/"


def test_app_shell_is_served():
    response = client.get("/app/")
    assert response.status_code == 200
    assert "PulseHZ" in response.text


def test_build_filter_complex_supports_single_layer():
    filter_complex = build_filter_complex(
        layers=[{"blendMode": "normal", "sourceDurationSeconds": 4.0}],
        width=1920,
        height=1080,
        frame_rate=60,
        bar_duration_seconds=2.0,
        render_duration_seconds=2.0,
    )
    assert "setpts=0.500000*PTS" in filter_complex
    assert "[outv]" in filter_complex
    assert "overlay" not in filter_complex


def test_build_filter_complex_supports_multiple_layers():
    filter_complex = build_filter_complex(
        layers=[
            {"blendMode": "normal", "sourceDurationSeconds": 2.0},
            {"blendMode": "screen", "sourceDurationSeconds": 1.0},
        ],
        width=1920,
        height=1080,
        frame_rate=60,
        bar_duration_seconds=2.0,
        render_duration_seconds=6.0,
    )
    assert "blend=all_mode=screen" in filter_complex
    assert "trim=duration=6.000000" in filter_complex


def test_export_video_no_layers():
    metadata = _metadata_payload(layers=[{"id": 1, "blendMode": "normal", "hasVideo": False}])
    response = client.post("/api/export-video", files={"metadata": (None, json.dumps(metadata))})
    assert response.status_code == 400
    assert "No video layers found" in response.json()["detail"]


def test_export_video_requires_matching_upload_count():
    metadata = _metadata_payload()
    response = client.post("/api/export-video", files={"metadata": (None, json.dumps(metadata))})
    assert response.status_code == 400
    assert "count must match" in response.json()["detail"]


def test_export_video_returns_rendered_file(monkeypatch, tmp_path):
    metadata = _metadata_payload(
        layers=[
            {
                "id": 1,
                "blendMode": "normal",
                "hasVideo": True,
                "sourceName": "layer-1.mp4",
                "sourceDurationSeconds": 2.0,
            },
            {
                "id": 2,
                "blendMode": "screen",
                "hasVideo": True,
                "sourceName": "layer-2.mp4",
                "sourceDurationSeconds": 1.0,
            },
        ],
        transport={
            "bpm": 120,
            "beatsPerBar": 4,
            "barDurationSeconds": 2.0,
            "renderDurationSeconds": 5.0,
        },
    )

    def fake_run(command, capture_output, text, timeout):
        output_path = Path(command[-1])
        output_path.write_bytes(b"movdata")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("pulsehz.server.subprocess.run", fake_run)

    response = client.post(
        "/api/export-video",
        files=[
            ("metadata", (None, json.dumps(metadata))),
            ("video_files", ("layer-1.mp4", b"video-one", "video/mp4")),
            ("video_files", ("layer-2.mp4", b"video-two", "video/mp4")),
            ("audio_file", ("audio.wav", b"audio", "audio/wav")),
        ],
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "video/quicktime"
    assert response.content == b"movdata"


def test_preview_video_returns_transcoded_mp4(monkeypatch):
    def fake_run(command, capture_output, text, timeout):
        output_path = Path(command[-1])
        output_path.write_bytes(b"h264preview")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("pulsehz.server.subprocess.run", fake_run)

    response = client.post(
        "/api/preview-video",
        files={"video": ("clip.mp4", b"opaque-source-bytes", "video/mp4")},
    )

    assert response.status_code == 200
    assert "video/mp4" in response.headers["content-type"]
    assert response.content == b"h264preview"


if __name__ == "__main__":
    pytest.main([__file__])