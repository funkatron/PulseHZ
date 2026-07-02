# README refresh — three-lens review (internal)

**TL;DR:** Replaced stale LT5K README with user-facing PulseHZ copy: what it is, why it matters, requirements, run paths (server `/app/`, desktop, client), dev/tests, license. Folded review risks into factual limitations (early software, FFmpeg, browser). **Do not** paste this file into the main README.

---

## Reading map

| Section | Purpose |
|---------|---------|
| Devil’s advocate | What could mislead or disappoint a reader |
| Expert technical writer | Clarity, scanability, ADHD-friendly structure |
| Senior staff engineer | Accuracy vs codebase, gaps, follow-ups |
| README implementation checklist | What shipped in `README.md` |
| Appendix (skippable) | pyproject alignment |

---

## 1. Devil’s advocate

| Risk | Mitigation in README |
|------|----------------------|
| “Launchpad for video” / hype without delivery | Stated as tempo-locked multi-layer compositor; no trademark claims. |
| Hiding FFmpeg requirement | Explicit table row + export section mention. |
| Wrong port / wrong URL | Documented default **6066** and **`/app/`** path. |
| Implied cloud upload | Explicit “locally in browser / no upload required **for editing**”. |
| Over-promising stability | Short “early software” line + issues link. |
| Confusion: package name vs brand | Title **PulseHZ**; repo/package name left as `pulsehz-video-glitch` in metadata (see appendix). |

---

## 2. Expert technical writer (scanability)

- **Lead with outcome** — First paragraph answers “what + for whom.”
- **“Why use it”** — Bulleted value, not a manifesto.
- **Requirements** — One compact table; scannable in ~10s.
- **Commands** — Copy-paste blocks, single primary path (`pulsehz-server` + URL).
- **Secondary entries** — Desktop and `pulsehz-client` without duplicating the whole tutorial.
- **Development** — Separated from “using the app”; optional Playwright note kept short.
- **No** three-lens narration or “as a reviewer…” in user-facing README.

---

## 3. Senior staff engineer (accuracy & boundaries)

| Claim in README | Grounding |
|-----------------|-----------|
| Four clip slots, 1/2/4 bars, blend/opacity | Matches `MAX_LAYERS` and UI in `public/app.js` / `index.html`. |
| BPM / Detect / live capture | Present in app; file segment analysis is implementation detail—omitted from README to avoid doc drift. |
| Port 6066 | `pulsehz.constants.DEFAULT_LISTEN_PORT`. |
| `/app/` | `server.py` mounts `StaticFiles` at `/app`. |
| FFmpeg for export + preview transcode | Server and export paths depend on FFmpeg. |
| Tests: `pytest tests`, `pytest e2e/` | Matches `pyproject.toml` `testpaths` and `e2e/` layout. |
| Playwright cache | Documented `conftest.py` + `PULSEHZ_KEEP_PLAYWRIGHT_PATH` behavior. |

**Follow-ups (not blocking README):** Align `pyproject.toml` `description` and `keywords` with browser-first story; add screenshot or GIF when available (previous `README-demo.gif` was missing).

---

## README implementation checklist

- [x] Remove obsolete LT5K / live-server / `examples/` content.
- [x] Single authoritative quick start: `uv sync` + `pulsehz-server` + URL with port and path.
- [x] Requirements: Python, uv, FFmpeg, browser.
- [x] Optional flows: desktop, client launcher, dev + e2e tests.
- [x] Honest limitation: early software; link to issues.
- [x] License pointer to `LICENSE.md`.
- [x] No internal three-lens voice in README body.

---

## Appendix (skippable): pyproject alignment

README describes the product as browser-first with optional desktop; **`pyproject.toml`** still has `description = "A desktop video glitch and blending tool with real-time preview"` and keywords centered on desktop/glitch. Consider a follow-up commit to update `description` and `keywords` to match README (e.g. browser, tempo, compositing, FFmpeg) without changing package name `pulsehz-video-glitch` unless you plan a rename.
