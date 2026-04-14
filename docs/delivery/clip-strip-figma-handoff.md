# Clip strip — Figma handoff

**Figma file:** [PulseHZ clip strip (Untitled)](https://www.figma.com/design/6uQ3n0FJ3vgJwwNaAWwtXr/Untitled?node-id=0-1)

**On canvas (Page 1):**

- **`PulseHZ — Clip strip — Desktop`** — four slot columns (`gap` 10), square **220×220** thumb frames (spec ref for 256px bitmap + CSS), Fit/Fill/blend row copy, annotation block for keyboard + tokens (`#121212` / `#1a1a1a` / `#3d3d3d` / `#b8d86b` aligned to `public/styles.css`).
- **`PulseHZ — Clip strip — Narrow`** — short note for ≤900px horizontal scroll behavior.

## Pixel targets (implementation reference)

- **Strip:** 4 equal columns, `gap: 10px` (tight; matches `--border` rhythm).
- **Thumb frame:** `aspect-ratio: 1 / 1`, `min-width: 0`, `border: 1px solid` muted outline; inner canvas fills frame.
- **Thumb bitmap:** 256×256 (square) for `drawImage` quality vs file size.
- **Control row** under thumb: `min-height: 44px` for hit targets; Fit/Fill as compact `role="radiogroup"` segment.
- **Narrow:** below `900px` workspace main column, clip strip uses horizontal scroll (`overflow-x: auto`, `flex-wrap: nowrap`) instead of crushing four columns.

## Variants (optional future component set)

- Slot: Empty | Loaded; Fit | Fill; Default | Focus | DragOver; More closed | open.
