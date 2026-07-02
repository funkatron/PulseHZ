"""Build FFmpeg argument lists for ProRes export from validated project metadata."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from pulsehz.api_models import ProjectMetadata
from pulsehz.rendering import build_filter_complex, iter_video_layers, parse_resolution
from pulsehz.timing import bar_duration_seconds


def default_render_duration_seconds(metadata: ProjectMetadata, has_audio: bool) -> float:
    transport = metadata.transport
    if transport.renderDurationSeconds and transport.renderDurationSeconds > 0:
        return transport.renderDurationSeconds
    if transport.barDurationSeconds and transport.barDurationSeconds > 0:
        return transport.barDurationSeconds
    if has_audio:
        return 3600.0
    return bar_duration_seconds(transport.bpm, transport.beatsPerBar)


def build_prores_ffmpeg_command(
    metadata: ProjectMetadata,
    video_paths: list[str],
    audio_path: Optional[str],
    output_file: str,
) -> list[str]:
    width, height = parse_resolution(metadata.exportSettings.resolution)
    frame_rate = metadata.exportSettings.frameRate
    render_duration = default_render_duration_seconds(metadata, bool(audio_path))
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
