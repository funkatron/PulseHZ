# PulseHZ

A **realtime** tool for **music-aligned video performance**: layered clips stay on a shared **BPM** and **bar grid**. You work while the transport runs—preview, blend, tempo, and loop length—not only offline batch export. Up to four slots, blend and opacity per layer, optional audio file or live input for tempo, and export through FFmpeg.

It does not replace a DAW or a hardware controller. The layout borrows from **grid clip launch** (pad-style slots), **session** layering under one clock (similar to Ableton Live’s session view), and **tracker-style** bar-length loops—applied to **video**, not audio stems.

---

## What it does

- **Tempo** — One BPM (manual entry, detection from a file, or live input). Playback and export follow that clock.
- **Layers** — Up to four video slots; per layer: blend mode, opacity, loop length in bars (1, 2, or 4 at 4/4).
- **Runtime** — Realtime preview and compositing on your machine; nothing is uploaded for editing.
- **Export** — ProRes or WebM via FFmpeg (`ffmpeg` on your `PATH`).

The project is **in development**; behavior and UI may change. [Issues](https://github.com/funkatron/PulseHZ/issues) are welcome.

---

## Requirements

| | |
|---|---|
| **Python** | 3.9+ |
| **Packages** | [uv](https://docs.astral.sh/uv/) recommended; `pip` is possible with manual care |
| **FFmpeg** | Required for export and some preview transcodes |
| **Browser** | Only if you use the web UI: a current Chromium- or WebKit-based engine |

---

## Quick start (web UI)

```bash
git clone https://github.com/funkatron/PulseHZ.git
cd PulseHZ
uv sync
uv run pulsehz-server
```

Default port **6066**. Open:

**http://127.0.0.1:6066/app/**

Add videos to the slots, optional audio or live capture, set BPM or run Detect BPM, then Play. Export and resolution options are in the sidebar.

---

## Desktop shell

PyQt host for the same web UI:

```bash
uv run pulsehz-desktop
```

---

## Client launcher

If no server is listening on the configured host/port, starts one and opens the app in your default browser:

```bash
uv run pulsehz-client
```

---

## Development

```bash
uv sync --extra dev --extra audio
uv run pytest tests -q
```

Optional browser UI tests (Playwright):

```bash
uv sync --extra e2e
uv run playwright install chromium
uv run pytest e2e/
```

Root `conftest.py` sets `PLAYWRIGHT_BROWSERS_PATH` to `.cache/playwright` (gitignored). Use `PULSEHZ_KEEP_PLAYWRIGHT_PATH=1` to keep a custom `PLAYWRIGHT_BROWSERS_PATH`.

### Demo WebM clips

Bundled VP9 patterns live in **`public/demo-clips/`** (see **`manifest.json`**). Regenerate with **`bash scripts/generate-demo-clips.sh`** (needs FFmpeg + libvpx-vp9). For dev-only autoload via URL query parameters (`?autoload=first`, `all`, a path to a clip, etc.), see **[docs/demo-clips.md](docs/demo-clips.md)**.

---

## License

MIT — see [LICENSE.md](LICENSE.md).

---

## Repository

[github.com/funkatron/PulseHZ](https://github.com/funkatron/PulseHZ)
