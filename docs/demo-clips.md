# Demo WebM clips

Small **VP9 WebM** files under `public/demo-clips/` for manual QA, screenshots, and **dev autoload** in the browser app. They are generated from FFmpeg **lavfi** sources (test patterns, generators)—not production footage.

## Layout

| File | Notes |
|------|--------|
| `manifest.json` | Ordered list of clip filenames; used by `autoload` keywords (see below). |
| `01-testsrc-landscape.webm` … `15-dual-testsrc-hstack.webm` | Numbered VP9 clips; regenerate together so `manifest.json` stays in sync. |

`public/fixture-debug.webm` is **optional** and **gitignored**—drop a local file there for `?autoload=fixture` without committing it.

## Regenerate from FFmpeg

From the repo root (requires **ffmpeg** with **libvpx-vp9**):

```bash
bash scripts/generate-demo-clips.sh
```

This overwrites `public/demo-clips/*.webm`, then writes `public/demo-clips/manifest.json` from whatever `.webm` files exist in that folder. Defaults are ~3 seconds per clip (2 seconds for `10-life`).

## Dev autoload (`autoload` query)

With the app served (e.g. `uv run pulsehz-server` on port **6066**), open the shell under **`/app/`** and append a query string. Only same-origin, allowlisted paths are accepted (see `resolveAutoloadWebmPath` in `public/app.js`).

### Loopback startup (no query)

On **`localhost`**, **`127.0.0.1`**, or **`[::1]`** only, opening **`/app/`** with **no** `autoload` parameter loads the first **min(3, N)** clips from `manifest.json` into layers **1–3** (small dev “startup project”). Use **`?autoload=off`** (or **`none`**) for an empty stack on loopback.

| `?autoload=` | Behavior |
|----------------|----------|
| *(omitted, loopback only)* | First **min(3, N)** manifest clips → layers **1–3**. |
| `off` or `none` | Skip all demo loading (including that startup behavior). |
| `1` or `first` | First entry in `manifest.json` → **layer 1** (stable for smoke tests). |
| `random` | Random clip from manifest → layer 1. |
| `all` | First **min(4, N)** clips → layers **1–4** (batch). |
| `fixture` | `fixture-debug.webm` next to the app (must exist locally). |
| *path ending in `.webm`* | Example: `demo-clips/11-mandelbrot.webm` (URL-encoded if needed) → layer 1. |

Examples (host/path may vary):

```text
http://127.0.0.1:6066/app/?autoload=first
http://127.0.0.1:6066/app/?autoload=all
http://127.0.0.1:6066/app/?autoload=demo-clips/03-smptebars.webm
```

If `manifest.json` is missing, the app suggests running `bash scripts/generate-demo-clips.sh`.

## Preview vs export scaling

The compositor draws each layer with **aspect ratio preserved** (letterbox / *contain*) into the output frame. The on-screen preview canvas uses **`object-fit: contain`** so the bitmap is not non-uniformly stretched in the layout. Export uses FFmpeg **scale (decrease) + pad** to match that intent for file output.
