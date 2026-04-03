# Presentation as structured data

PulseHZ treats a **show** as data, not as a one-off GUI state. The same JSON-shaped **project** can drive:

1. **Realtime** — the browser interprets it every frame (canvas, Web Audio, future MIDI/LFO).
2. **Offline** — the server interprets it for FFmpeg (master file, baked timeline).

That is the same idea as clip layouts in a DAW or scene graphs in real-time graphics: **one document, multiple renderers**.

## What lives in the document today

| Block | Role |
|--------|------|
| `transport` | BPM, bar length, render duration — shared clock for live and export. |
| `exportSettings` | Frame size, frame rate, codec profile, backdrop — offline output contract. |
| `layers` | Stack order, blend mode, source identity, clip duration, **opacity** (0–1) — compositor inputs. Opacity is honored in the browser today; FFmpeg can be extended to match. |
| `controls` | Modulation routes, MIDI bindings, parameter IDs — how values move over time (see `src/pulsehz/project_controls.py`). |

The **parameter catalog** (which `paramId` values exist, ranges, units) will grow in one place and stay aligned between interpreters.

## Interpreters

- **Realtime (`public/app.js`)** evaluates transport + layers (+ future `controls`) into pixels and audio. Low latency and interaction are the goals.
- **Offline (`src/pulsehz/rendering.py` + FFmpeg)** evaluates the same layers (and eventually sampled or baked `controls`) into ProRes. Fidelity and pipeline compatibility are the goals.

Drift between interpreters is managed by **shared schema**, **contract tests**, and (where needed) **golden** frame or checksum tests — not by collapsing everything into a single runtime.

## Export when `controls` is non-empty

Until automation is fully baked into FFmpeg filters, options are:

- **Sample** parameter curves at export FPS and emit per-frame or keyframed data; or
- **Record** the realtime output (WebM / stream) for a performance capture; or
- **Ignore** `controls` for static export and document the limitation.

The schema is versioned (`controls.schemaVersion`) so these strategies can evolve without breaking old projects.

## Related code

- `src/pulsehz/project_controls.py` — Pydantic models for `controls`.
- `src/pulsehz/param_catalog.py` — registered `paramId` names (Python mirror).
- `src/pulsehz/server.py` — `ProjectMetadata` + `LayerMetadata.opacity`.
- `public/control-model.js` — empty `controls` payload and schema version.
- `public/param-catalog.js` — parameter bounds (e.g. layer opacity).
- `public/modulation-runtime.js` — BPM-locked LFO evaluation for the canvas.
