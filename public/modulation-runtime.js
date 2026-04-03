import { LAYER_PARAMS } from "./param-catalog.js";

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * @param {number} phase01
 * @param {string} waveform
 * @returns {number} roughly -1..1 for most shapes
 */
export function waveformValueAt(phase01, waveform) {
  const p = ((phase01 % 1) + 1) % 1;
  switch (waveform) {
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "triangle":
      return 4 * Math.abs(p - 0.5) - 1;
    case "square":
      return p < 0.5 ? 1 : -1;
    case "saw_up":
      return 2 * p - 1;
    case "saw_down":
      return 1 - 2 * p;
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

/**
 * @param {object} source LFO source (kind, waveform, rateBeats | rateHz, phaseTurns, depth, offset)
 * @param {number} transportSeconds
 * @param {number} bpm
 * @returns {number} phase 0..1 for waveform sampling
 */
export function lfoPhase01(source, transportSeconds, bpm) {
  const phaseTurns = source.phaseTurns ?? 0;
  let cycles;
  if (source.rateBeats != null && source.rateBeats > 0) {
    const beatSec = 60 / Math.max(bpm, 1);
    cycles = transportSeconds / (beatSec * source.rateBeats);
  } else if (source.rateHz != null && source.rateHz > 0) {
    cycles = transportSeconds * source.rateHz;
  } else {
    cycles = 0;
  }
  return (cycles + phaseTurns) % 1;
}

/**
 * Effective layer opacity after enabled modulation routes (additive on base, clamped).
 * @param {{ id: number, opacity: number }} layer
 * @param {number} transportSeconds
 * @param {number} bpm
 * @param {unknown[]} modulationRoutes
 */
export function resolveModulatedLayerOpacity(layer, transportSeconds, bpm, modulationRoutes) {
  const spec = LAYER_PARAMS.opacity;
  let v = typeof layer.opacity === "number" ? layer.opacity : spec.default;

  if (!Array.isArray(modulationRoutes)) {
    return clamp(v, spec.min, spec.max);
  }

  for (const route of modulationRoutes) {
    if (route == null || route.enabled === false) {
      continue;
    }
    const tgt = route.target;
    if (tgt?.scope !== "layer" || tgt.layerId !== layer.id || tgt.paramId !== "opacity") {
      continue;
    }
    const src = route.source;
    if (src?.kind !== "lfo") {
      continue;
    }

    const phase = lfoPhase01(src, transportSeconds, bpm);
    const w = waveformValueAt(phase, src.waveform || "sine");
    const depth = src.depth ?? 1;
    const offset = src.offset ?? 0;
    const contrib = offset + depth * w;
    const amount = route.amount ?? 1;
    v += amount * contrib;
  }

  return clamp(v, spec.min, spec.max);
}
