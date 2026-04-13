# PulseHZ

Multi-layer video compositing in the browser with a shared **BPM** and **bar-aligned** loops. You load clips into up to four slots, set blend and opacity, optionally attach audio or a live input, and export through FFmpeg.

---

## What it does

- **Transport** — One BPM (manual entry, detection from a file, or live input). Layer playback and export metadata follow that tempo.
- **Layers** — Up to four video slots; per layer: blend mode, opacity, loop length in bars (1, 2, or 4 at 4/4).
- **Runtime** — Compositing and preview run in the browser locally; nothing is uploaded for editing.
- **Export** — ProRes or WebM via FFmpeg (`ffmpeg` on your `PATH`).

The project is **in development**; behavior and UI may change. [Issues](https://github.com/funkatron/PulseHZ/issues) are welcome.

---

## Requirements

| | |
|---|---|
| **Python** | 3.9+ |
| **Packages** | [uv](https://docs.astral.sh/uv/) recommended; `pip` is possible with manual care |
| **FFmpeg** | Required for export and some preview transcodes |
| **Browser** | A current Chromium- or WebKit-based browser for `/app/` |

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

---

## License

MIT — see [LICENSE.md](LICENSE.md).

---

## Repository

[github.com/funkatron/PulseHZ](https://github.com/funkatron/PulseHZ)
