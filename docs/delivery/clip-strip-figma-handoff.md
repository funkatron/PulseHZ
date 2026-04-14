# Clip strip — Figma handoff (waived MCP)

**Status:** Figma file was not linked in-repo; `use_figma` requires a `fileKey`. This note records the **implementation spec** used for CSS/JS so the layout stays traceable.

**Waived:** Live Figma frames / PR URL. Revisit when a PulseHZ Figma file exists.

## Pixel targets (desktop reference)

- **Strip:** 4 equal columns, `gap: 10px` (tight; matches `--border` rhythm).
- **Thumb frame:** `aspect-ratio: 1 / 1`, `min-width: 0`, `border: 1px solid` muted outline; inner canvas fills frame.
- **Thumb bitmap:** 256×256 (square) for `drawImage` quality vs file size.
- **Control row** under thumb: `min-height: 44px` for hit targets; FIT/FILL as compact `role="radiogroup"` segment.
- **Narrow:** below `900px` workspace main column, clip strip uses horizontal scroll (`overflow-x: auto`, `flex-wrap: nowrap`) instead of crushing four columns.

## Variants (for future Figma)

- Slot: Empty | Loaded; Fit | Fill; Default | Focus | DragOver; More closed | open.
