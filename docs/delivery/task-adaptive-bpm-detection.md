# Task: fast adaptive BPM detection (file playback)

**Status (implemented):** Loaded files are decoded to **mono** and kept on `state.audio.analysisMono` until the track is cleared, then analyzed into **sliding-window BPM segments** (`public/bpm-analysis.js`: 12s window, 6s hop, 600s cap on analysis length). On playback, `updateFileBpmFromSegments` maps `audioElement.currentTime` → local BPM (lerp) and calls `commitTransportBpm` with source `file-segments` (throttled like live). **Detect BPM** uses **median of segments** when the segment map is ready; otherwise falls back to full-buffer `estimateBpmFromAudioBuffer`. **Playwright** UI tests live under `e2e/` (`?test=1` harness + smoke).

---

## Problem (historical)

| Path | Behavior |
|------|------------|
| Live input | RMS onset → beat times → median interval → smoothed BPM → `commitTransportBpm` (throttled). |
| File (before) | Full decode → single global `estimateBpmFromAudioBuffer` → one BPM for the entire buffer. |

---

## North star (unchanged)

**File playback and live input** should converge on one streaming graph when files are routed like live input. **Analysis** for files can still be richer (full-buffer segments) than the live RMS path.

---

## Automated UI tests

- **Stack:** `pytest-playwright` (optional extra `e2e`), Chromium via `uv run playwright install chromium`.
- **Browser path:** root [`conftest.py`](../../conftest.py) sets `PLAYWRIGHT_BROWSERS_PATH` to `.cache/playwright` (override with `PULSEHZ_KEEP_PLAYWRIGHT_PATH=1` if needed).
- **Run:** `uv run pytest e2e/` (after sync `--extra e2e` and browser install).
- **Cases:** smoke (shell loads, BPM controls visible); `?test=1` calls `window.__PULSEHZ_TEST__.commitBpm` and asserts manual BPM field.

---

## Out of scope

- Per-bar tempo map or FFmpeg time-varying tempo export.
- librosa in the browser hot path.
