# Rendering roadmap & capture notes (internal)

**TL;DR:** Future direction: **per-clip FX stacks** → composite → **main-canvas FX stack**; **heterogeneous layer sources** (video, images, rasterized DOM/canvas/SVG/components). **Pixi.js** explicitly **not** adopted now—defer until GPU-scale needs justify migration or a time-boxed spike. **60fps stutter** today: treat as **main-thread / per-frame work** first (measure, throttle HUD), not as “only fixed by WebGL.” **Guardrails:** keep **`preview-compositor.js`** as the single preview pixel contract; evolve **layer state** toward `fx: []` before building shaders.

**Source:** Team conversation (2026-04), post–JS modularization (`dev-autoload`, `transport-ui`, `layer-ui`). **Not** a commitment to ship dates or a particular library.

---

## Reading map

| If you need… | See… |
|----------------|------|
| Future compositing shape | **Target architecture (conceptual)** |
| Why not Pixi now | **Renderer decisions** |
| Stutter / capture | **60fps & captureStream** |
| What to do in code before spikes | **Implementation guardrails** |

---

## Target architecture (conceptual)

1. **Clip filters (shaders / FX stack)**  
   - Each clip has a **base** (video, image, or rasterized source) with an **ordered FX stack** on top.

2. **Main canvas FX**  
   - After layer composite, apply a **separate global FX stack** on the program output.

3. **Non-video clips** (same FX model)  
   - **Images** — straightforward texture / bitmap path.  
   - **DOM-like sources** — treat as **sources that become pixels** for the compositor: e.g. canvas, SVG, or “arbitrary” components via **rasterization** or layered composition. **Live arbitrary HTML inside a GPU path** is usually **not** literal DOM at 60fps; plan for **snapshots / offscreen surfaces** or **stacked planes** unless requirements prove otherwise.

This maps to a **render graph** regardless of whether the implementation is **WebGL**, **Canvas2D multi-pass**, or a **hybrid**.

---

## Renderer decisions

| Topic | Decision |
|-------|----------|
| **Pixi.js (or similar) now** | **No.** Adds bundle and migration cost; does not remove the hard problems (decode, upload, export parity) for a small-layer MVP. **Revisit** if the product needs many sprites, particles, heavy GPU filters, or a clear perf ceiling on Canvas2D. |
| **Spike** | **Not** scheduled from this note. Any future spike should be **time-boxed** (one layer, one effect, measure FPS + export). |

---

## 60fps & captureStream

**Observation:** Smooth output is not guaranteed by `captureStream(60)` alone; painting is driven by **`requestAnimationFrame`** and everything that runs in the same turn.

**Likely contributors (investigate before jumping to WebGL):**

- **Composite cost** at full output resolution (multiple `drawImage` / blend passes).
- **Per-frame non-composite work** in the hot loop (e.g. transport HUD, clip rings, meters, BPM helpers)—worth **throttling** or moving off the visual critical path once measured.
- **Main-thread contention** (audio analysis, decode, layout).

**Future tuning:** Performance panel / frame timing; separate **“paint preview”** from **“update chrome”** where possible.

---

## Implementation guardrails (until FX ships)

1. **Single preview pixel contract** — Keep compositing centered in **`public/preview-compositor.js`** (and the `drawPreview` / `drawPreviewFrame` path) so FX stacks can attach as **passes** or **wrappers** later instead of spreading logic across `app.js`.

2. **Layer model** — Prefer evolving toward **`type` + asset reference + `fx: []`** (even if empty) so new source kinds and effects do not require another global refactor.

3. **Transport / chrome** — DOM/SVG for beat rings and sidebar is **fine** until a reason appears to unify them with GL.

---

## Related code (pointers)

- Preview composite: `public/preview-compositor.js`
- Main RAF loop (composite + HUD + meters): `public/app.js` (`renderLoop`, `drawPreview`)
- Export stream: `captureStream(60)` on the preview canvas (see `app.js` export / `window.pulsehzApp`)

---

## Open questions (when you pick this up)

- Exact **export path** (codec, alpha, resolution) after adding GPU passes—re-validate **`MediaRecorder` / `captureStream`** behavior.
- **DOM-in-stack** product requirements vs **rasterize-on-a-timer** tradeoffs.
