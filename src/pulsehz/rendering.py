"""Render helpers for FFmpeg export."""

from __future__ import annotations

from typing import Iterable, Literal, Sequence

BackdropKind = Literal["black", "white", "transparent"]


BLEND_MODE_MAP = {
    "multiply": "multiply",
    "screen": "screen",
    "overlay": "overlay",
    "darken": "darken",
    "lighten": "lighten",
    "difference": "difference",
    "exclusion": "exclusion",
    "color-dodge": "colordodge",
    "color-burn": "colorburn",
    "hard-light": "hardlight",
    "soft-light": "softlight",
}

SUPPORTED_BLEND_MODES = ["normal", *BLEND_MODE_MAP.keys()]


def build_preview_transcode_command(input_path: str, output_path: str) -> list[str]:
    """FFmpeg args: emit an MP4 that Chromium / WebEngine can decode for <video> preview.

    Strips audio (layer previews are muted). Original files are unchanged for export.
    """
    return [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input_path,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-vf",
        "scale='min(1920,iw)':-2",
        output_path,
    ]



def parse_resolution(resolution: str) -> tuple[int, int]:
    """Parse a WIDTHxHEIGHT string."""
    try:
        width_str, height_str = resolution.lower().split("x", 1)
        width = int(width_str)
        height = int(height_str)
    except (AttributeError, ValueError) as exc:
        raise ValueError(f"invalid resolution: {resolution!r}") from exc

    if width <= 0 or height <= 0:
        raise ValueError("resolution dimensions must be positive")
    return width, height


def validate_blend_mode(blend_mode: str) -> str:
    if blend_mode not in SUPPORTED_BLEND_MODES:
        raise ValueError(f"unsupported blend mode: {blend_mode}")
    return blend_mode


def build_filter_complex(
    layers: Sequence[dict],
    width: int,
    height: int,
    frame_rate: int,
    bar_duration_seconds: float,
    render_duration_seconds: float,
    backdrop: BackdropKind = "transparent",
) -> str:
    """Build the FFmpeg filter graph for layered compositing.

    When ``backdrop`` is ``black`` or ``white``, callers must prepend a lavfi ``color=``
    input as FFmpeg input 0; video files start at input index 1.

    ``transparent`` matches the historical graph: the first video file is input 0 and acts
    as the compositing base (no solid plate).
    """
    if not layers:
        raise ValueError("at least one layer is required")
    if bar_duration_seconds <= 0 or render_duration_seconds <= 0:
        raise ValueError("durations must be positive")
    if backdrop not in ("black", "white", "transparent"):
        raise ValueError(f"invalid backdrop: {backdrop!r}")

    filter_parts: list[str] = []
    current_label = ""
    has_solid = backdrop in ("black", "white")

    if has_solid:
        filter_parts.append(
            f"[0:v]setsar=1,format=rgba,"
            f"trim=duration={render_duration_seconds:.6f},setpts=PTS-STARTPTS[bg]"
        )

    for index, layer in enumerate(layers):
        blend_mode = validate_blend_mode(layer["blendMode"])
        source_duration = float(layer.get("sourceDurationSeconds") or bar_duration_seconds)
        raw_bars = layer.get("barsPerLoop", 1)
        try:
            bars_loop = int(raw_bars)
        except (TypeError, ValueError):
            bars_loop = 1
        if bars_loop not in (1, 2, 4):
            bars_loop = 1
        speed_factor = (bar_duration_seconds * bars_loop) / max(source_duration, 0.001)
        in_idx = index + (1 if has_solid else 0)
        source_label = f"vl{index}"
        filter_parts.append(
            f"[{in_idx}:v]fps={frame_rate},"
            f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={width}:{height},setsar=1,setpts={speed_factor:.6f}*PTS,format=rgba,"
            f"trim=duration={render_duration_seconds:.6f},setpts=PTS-STARTPTS[{source_label}]"
        )

        if index == 0:
            if has_solid:
                next_label = "mix0"
                if blend_mode == "normal":
                    filter_parts.append(
                        f"[bg][{source_label}]overlay=shortest=1:format=auto[{next_label}]"
                    )
                else:
                    ffmpeg_mode = BLEND_MODE_MAP[blend_mode]
                    filter_parts.append(
                        f"[bg][{source_label}]blend=all_mode={ffmpeg_mode}:all_opacity=1[{next_label}]"
                    )
                current_label = next_label
            else:
                current_label = source_label
            continue

        next_label = f"mix{index}"
        if blend_mode == "normal":
            filter_parts.append(
                f"[{current_label}][{source_label}]overlay=shortest=1:format=auto[{next_label}]"
            )
        else:
            ffmpeg_mode = BLEND_MODE_MAP[blend_mode]
            filter_parts.append(
                f"[{current_label}][{source_label}]blend=all_mode={ffmpeg_mode}:all_opacity=1[{next_label}]"
            )
        current_label = next_label

    # Transparent compositor: preserve alpha for ProRes 4444 (yuva444p10le). Solid plates are opaque.
    out_pix_fmt = "yuva444p10le" if backdrop == "transparent" else "yuv444p10le"
    filter_parts.append(f"[{current_label}]format={out_pix_fmt}[outv]")
    return ";".join(filter_parts)


def iter_video_layers(layers: Iterable[dict]) -> list[dict]:
    """Collect supported layer metadata for layers backed by uploaded video."""
    normalized = []
    for layer in layers:
        if layer.get("hasVideo"):
            normalized.append(
                {
                    "blendMode": validate_blend_mode(layer["blendMode"]),
                    "sourceDurationSeconds": layer.get("sourceDurationSeconds"),
                    "barsPerLoop": layer.get("barsPerLoop", 1),
                }
            )
    return normalized
