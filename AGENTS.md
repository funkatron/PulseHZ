# AGENTS.md — PulseHZ

Handbook for **human developers** and **coding agents** (Cursor, Copilot, etc.). User-facing docs: **`README.md`**, **`docs/demo-clips.md`**, **`LICENSE.md`**.

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [Repository layout](#2-repository-layout)
3. [Runtime & entry points](#3-runtime--entry-points)
4. [Python backend](#4-python-backend)
5. [Browser app (`public/`)](#5-browser-app-public)
6. [Testing](#6-testing)
7. [CI](#7-ci)
8. [Documentation index](#8-documentation-index)
9. [Conventions for changes](#9-conventions-for-changes)
10. [Dependencies & tooling](#10-dependencies--tooling)
11. [Environment variables](#11-environment-variables)
12. [Security & local-dev notes](#12-security--local-dev-notes)
13. [Legacy / experimental JS](#13-legacy--experimental-js)
14. [Future direction (internal)](#14-future-direction-internal)

---

## 1. What this project is

- **Product:** Realtime, **music-aligned** video performance in the browser: up to **four** video layers, shared **BPM** / bar grid, blend + opacity, optional **audio file** or **live** input for tempo, **Canvas 2D** preview, export via **FFmpeg** (ProRes / WebM).
- **Stack:** **FastAPI** + **Uvicorn** serve static **`/app/`** and JSON/video **APIs**; optional **PyQt6** desktop shell loads the same web UI.
- **Package name (PyPI / metadata):** `pulsehz-video-glitch` — **brand / UI name:** PulseHZ.

---

## 2. Repository layout

| Path | Role |
|------|------|
| **`src/pulsehz/`** | Python package: server, routes, export/preview pipelines, desktop, constants |
| **`public/`** | Browser app: **`index.html`**, **`app.js`**, ES modules (`*-ui.js`, `preview-compositor.js`, `bpm-analysis.js`, …), **`styles.css`**, **`demo-clips/`** |
| **`tests/`** | Pytest unit/integration tests |
| **`e2e/`** | Playwright UI tests (session server fixture) |
| **`docs/`** | User + internal docs (`docs/delivery/` = delivery / roadmap notes) |
| **`scripts/`** | e.g. `generate-demo-clips.sh`, BPM helper scripts |
| **`examples/`** | Standalone HTML demos (Loopatron / canvas experiments) — **not** the main product shell |

---

## 3. Runtime & entry points

Defined in **`pyproject.toml`** `[project.scripts]`:

| Command | Purpose |
|---------|---------|
| **`uv run pulsehz-server`** | Uvicorn: **`pulsehz.server:app`**, default **`0.0.0.0:6066`** |
| **`uv run pulsehz-desktop`** | PyQt6 + WebEngine hosting **`/app/`** |
| **`uv run pulsehz-client`** | If **`http://127.0.0.1:6066/api/health`** is up → open browser; else start server in a thread and open **`/app/`** |
| **`uv run pulsehz`** | Legacy CLI: **`--mode desktop`** (default) or **`server`** |

**Default port:** **`6066`** (`pulsehz.constants.DEFAULT_LISTEN_PORT`) — chosen to avoid common **`8000`** conflicts.

**URLs (typical):**

- App: **`http://127.0.0.1:6066/app/`** (trailing slash matters for static mount)
- Health: **`GET /api/health`**
- API info: **`GET /api/info`**

---

## 4. Python backend

### 4.1 Application

- **`src/pulsehz/server.py`** — Builds **`FastAPI`** app, **CORS** `allow_origins=["*"]` (local tool), mounts **`StaticFiles`** at **`/app`** → **`public/`**.

### 4.2 Routers

| Module | Tag | Notable routes |
|--------|-----|----------------|
| **`routes/meta.py`** | meta | **`GET /`**, **`GET /api/health`**, **`GET /api/info`** |
| **`routes/export_video.py`** | export | **`POST /api/export-video`** (multipart upload + FFmpeg) |
| **`routes/preview_video.py`** | preview | **`POST /api/preview-video`** (server-side transcode when browser cannot decode) |

Blend modes and capabilities exposed via **`/api/info`** align with **`pulsehz.rendering`** / **`SUPPORTED_BLEND_MODES`** — keep **Python** and **`public/`** lists in sync when adding modes.

### 4.3 Supporting modules (non-exhaustive)

- **`api_models.py`** — Pydantic models for export/project metadata
- **`ffmpeg_cli.py`**, **`export_build.py`**, **`rendering.py`** — Export pipeline
- **`timing.py`** — Timing utilities (tests)
- **`desktop_app.py`** — PyQt shell
- **`project_controls.py`**, **`param_catalog.py`** — Control / parameter surfaces as needed by APIs

### 4.4 Static app path

Server resolves **`PUBLIC_DIR`** = repo root **`public/`**. The browser loads **`/app/index.html`** → **`app.js`** (ES modules).

---

## 5. Browser app (`public/`)

### 5.1 Orchestration

- **`app.js`** — Global state, **`requestAnimationFrame`** render loop, autosave, audio/video/layer lifecycle, export hooks, test harness (`?test=1`). **Preview pixels** go through **`preview-compositor.js`**.

### 5.2 Modular JS (import graph — evolve as files split)

| Area | Modules (representative) |
|------|---------------------------|
| **Composite / preview** | **`preview-compositor.js`**, **`output-dimensions.js`**, **`modulation-runtime.js`** |
| **Transport / tempo** | **`transport-math.js`**, **`transport-ui.js`**, **`bpm-analysis.js`**, **`app-events.js`** |
| **Layers UI** | **`layer-ui.js`**, **`geometry-utils.js`** |
| **Dev** | **`dev-autoload.js`** (`?autoload=`, loopback startup) |
| **Persistence** | **`clip-cache-idb.js`**, autosave in **`app.js`** |
| **Control model** | **`control-model.js`**, **`param-catalog.js`** |

### 5.3 Cache busting

`index.html` references scripts with **`?v=…`** query params. **Bump** these when changing a module so browsers reload (grep **`?v=`** in **`index.html`** and imports).

### 5.4 Demo clips

**`public/demo-clips/`** + **`manifest.json`** — see **`docs/demo-clips.md`**. Regenerate: **`bash scripts/generate-demo-clips.sh`** (FFmpeg + VP9).

---

## 6. Testing

### 6.1 Install (dev)

```bash
uv sync --extra dev --extra audio
```

**E2E (optional):**

```bash
uv sync --extra e2e
uv run playwright install chromium
```

Root **`conftest.py`** sets **`PLAYWRIGHT_BROWSERS_PATH`** to **`.cache/playwright`** (gitignored). Override with **`PULSEHZ_KEEP_PLAYWRIGHT_PATH=1`** to preserve a custom path.

### 6.2 Commands

| Suite | Command |
|-------|---------|
| **Unit / integration** | `uv run pytest tests/ -q` |
| **Browser UI** | `uv run pytest e2e/ -q` |

**E2E:** **`e2e/conftest.py`** starts **`uvicorn pulsehz.server:app`** on a **free port**, yields **`http://127.0.0.1:<port>/app/`** for Playwright.

### 6.3 Fixtures

- Audio/video samples under **`tests/fixtures/`** (large binaries may be gitignored — see **`.gitignore`**).
- **`tests/support/`** — shared helpers (e.g. audio fixtures).

---

## 7. CI

**`.github/workflows/ci.yml`**

- **Python 3.12**, **`uv sync --extra dev --extra audio --extra e2e`**
- **`pytest tests/`** then **`playwright install chromium`** then **`pytest e2e/`**

Agents should run the same before pushing when touching Python or **`public/`** behavior.

---

## 8. Documentation index

| Doc | Audience |
|-----|----------|
| **`README.md`** | End users: install, URLs, dev commands |
| **`docs/demo-clips.md`** | Demo WebM clips, autoload query, regeneration |
| **`docs/presentation-model.md`** | Internal: presentation / control concepts |
| **`docs/delivery/*.md`** | Internal: delivery write-ups, BPM task notes, Figma handoff, **rendering roadmap** |

**Rendering / capture roadmap (FX stacks, 60fps posture, guardrails):**  
**`docs/delivery/roadmap-rendering-and-capture.md`**

---

## 9. Conventions for changes

### 9.1 Scope

- Prefer **minimal diffs** aligned with the user request; avoid drive-by refactors and unrelated files.
- **Preview / composite** logic: extend **`preview-compositor.js`** (or small helpers) rather than scattering draws in **`app.js`**.

### 9.2 Blend modes & API parity

- Browser uses Canvas **`globalCompositeOperation`**; server/export uses **`rendering`** — naming must stay **consistent** when adding blend modes.

### 9.3 Type hints & tests

- Python: maintain **type hints** where the codebase already uses them; add tests for **behavior** (avoid brittle string assertions unless intentional).

### 9.4 User-facing docs

- **`README.md`** / **`docs/`** user guides: **direct**, no internal “three-lens” roleplay. Internal review artifacts belong in **`docs/delivery/`** or PR descriptions.

### 9.5 Markdown

- Do not add new top-level docs unless the task asks for documentation updates.

---

## 10. Dependencies & tooling

| Dependency | Why |
|------------|-----|
| **Python 3.9+** | Declared in **`pyproject.toml`** |
| **uv** | Recommended install / lockfile (**`uv.lock`**) |
| **FFmpeg** | Export + some preview transcodes — must be on **`PATH`** for server features |
| **Chromium** (e2e) | Via Playwright; install browsers once |

**Optional extras:** **`dev`**, **`audio`** (librosa / soundfile for some tests or scripts), **`e2e`**.

---

## 11. Environment variables

| Variable | Effect |
|----------|--------|
| **`PULSEHZ_KEEP_PLAYWRIGHT_PATH=1`** | Do not force **`PLAYWRIGHT_BROWSERS_PATH`** to **`.cache/playwright`** (see **`conftest.py`**) |

Add new env vars to **`README.md`** or operator docs when they become part of the supported UX.

---

## 12. Security & local-dev notes

- **CORS `*`** and **open host** are intended for **local** creative tooling, not a hardened internet deployment.
- **No secrets** in repo; export endpoints accept uploads — treat as **trusted local network** unless you harden for remote use.
- Browser **autoload** / **demo clips** are **dev-oriented**; validate paths server-side where applicable.

---

## 13. Legacy / experimental JS

**`src/Loopatron*.js`**, **`src/canvas/`**, **`src/valueFunctions.js`**, etc., power **`examples/`** (Loopatron demos). They are **not** imported by **`public/app.js`**. Do not assume they ship with the main app unless wired explicitly.

---

## 14. Future direction (internal)

Shader / FX stacks, heterogeneous clip sources, and capture performance are discussed in:

**`docs/delivery/roadmap-rendering-and-capture.md`**

This file is **not** a committed product roadmap; it aligns implementation guardrails when those features are scheduled.

---

## Quick checklist (agents)

- [ ] Run **`uv run pytest tests/ -q`** (and **`e2e/`** if UI changed meaningfully)
- [ ] Bump **`?v=`** on **`public/`** script URLs when module behavior changes
- [ ] Keep **`preview-compositor.js`** as the primary preview pixel path for new composite features
- [ ] Update **`AGENTS.md`** / **`README.md`** only when adding stable commands, env vars, or structural facts
