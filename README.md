# PulseHZ

**Tempo-locked, multi-layer video in the browser** — stack clips like a live set, keep everything on the musical grid, and export when you are ready.

PulseHZ is for people who want **performance energy** (layers, blend modes, opacity, short loops) without giving up a **clear transport**: one BPM, bar-aligned video, optional audio track or live input, and preview that matches what you intend to ship to disk.

---

## Why use it

- **One clock** — Manual BPM, file-based tempo hints, or live capture; transport drives layer sync and export metadata.
- **Up to four clip slots** — Each layer: video, blend mode, opacity, and loop length in bars (1 / 2 / 4 at 4/4).
- **Browser-first** — Compositing and preview run locally in Chromium/WebKit-class engines; no upload required for editing.
- **Export** — High-quality ProRes or WebM paths via FFmpeg (install FFmpeg and keep it on your `PATH`).

It is **early software**: rough edges are expected. If you try it, [open an issue](https://github.com/funkatron/PulseHZ/issues) or send feedback.

---

## Requirements

| | |
|---|---|
| **Python** | 3.9+ |
| **Package manager** | [uv](https://docs.astral.sh/uv/) recommended (`pip` works with care) |
| **FFmpeg** | Required for export and some browser preview transcodes |
| **Browser** | Modern Chromium or Safari-class engine for `/app/` |

---

## Quick start (web UI)

```bash
git clone https://github.com/funkatron/PulseHZ.git
cd PulseHZ
uv sync
uv run pulsehz-server
```

Default listen port is **6066**. Open:

**http://127.0.0.1:6066/app/**

Load one or more videos into the clip slots, add an audio file or use live capture (e.g. loopback), set BPM or use Detect BPM, then **Play**. Use the sidebar for export and output resolution.

---

## Desktop shell

To run the PyQt wrapper that hosts the same web app:

```bash
uv run pulsehz-desktop
```

---

## Client launcher (browser)

Starts the server if needed and opens the app in your default browser:

```bash
uv run pulsehz-client
```

---

## Development

```bash
uv sync --extra dev --extra audio
uv run pytest tests -q
```

Browser UI tests (Playwright; optional extra):

```bash
uv sync --extra e2e
uv run playwright install chromium
uv run pytest e2e/
```

Root `conftest.py` pins Playwright browsers under `.cache/playwright` (gitignored). Set `PULSEHZ_KEEP_PLAYWRIGHT_PATH=1` if you need to use a custom `PLAYWRIGHT_BROWSERS_PATH`.

---

## License

MIT — see [LICENSE.md](LICENSE.md).

---

## Repository

- **Homepage / issues:** [github.com/funkatron/PulseHZ](https://github.com/funkatron/PulseHZ)
