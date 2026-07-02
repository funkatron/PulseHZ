/**
 * Canvas2D compositing for the program preview (layers + scratch buffer).
 * Owns offscreen scratch canvas; keeps drawMedia* pure for thumbnails too.
 * @module preview-compositor
 */

import { DEFAULT_BPM } from "./bpm-analysis.js?v=20260415";
import { resolveModulatedLayerOpacity } from "./modulation-runtime.js?v=20260412";

/** Offscreen buffer for compositing; drawImage(<video>) + blend in one step is unreliable in some engines. */
let layerScratchCanvas = null;
let layerScratchContext = null;

function ensureLayerScratch(cw, ch) {
  if (!layerScratchCanvas || layerScratchCanvas.width !== cw || layerScratchCanvas.height !== ch) {
    layerScratchCanvas = document.createElement("canvas");
    layerScratchCanvas.width = cw;
    layerScratchCanvas.height = ch;
    layerScratchContext =
      layerScratchCanvas.getContext("2d", { alpha: true, desynchronized: true }) ??
      layerScratchCanvas.getContext("2d", { alpha: true }) ??
      layerScratchCanvas.getContext("2d");
  }
  return layerScratchContext;
}

/**
 * Uniform scale + center — matches CSS object-fit: **contain**.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement | HTMLImageElement} media
 */
export function drawMediaContain(ctx, media, cw, ch) {
  const vw = media.videoWidth || media.width || 0;
  const vh = media.videoHeight || media.height || 0;
  if (!vw || !vh) {
    return;
  }
  const scale = Math.min(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  ctx.drawImage(media, 0, 0, vw, vh, dx, dy, dw, dh);
}

/**
 * Uniform scale + center crop — matches CSS object-fit: **cover**.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement | HTMLImageElement} media
 */
export function drawMediaCover(ctx, media, cw, ch) {
  const vw = media.videoWidth || media.width || 0;
  const vh = media.videoHeight || media.height || 0;
  if (!vw || !vh) {
    return;
  }
  const scale = Math.max(cw / vw, ch / vh);
  const sw = cw / scale;
  const sh = ch / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  ctx.drawImage(media, sx, sy, sw, sh, 0, 0, cw, ch);
}

/**
 * Visible fallback for layer slot canvas before a decoded video frame exists.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawLayerSlotPlaceholder(ctx, cw, ch) {
  ctx.save();
  ctx.fillStyle = "#16161a";
  ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
  ctx.lineWidth = 1;
  const step = 14;
  for (let x = -ch; x < cw + ch; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + ch, ch);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(180, 178, 170, 0.4)";
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Clip preview", cw / 2, ch / 2);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cw
 * @param {number} ch
 * @param {"black" | "white" | "transparent"} backdrop
 */
export function applyPreviewBackdrop(ctx, cw, ch, backdrop) {
  if (backdrop === "black") {
    ctx.fillStyle = "#000000";
    ctx.globalCompositeOperation = "source-over";
    ctx.fillRect(0, 0, cw, ch);
    return;
  }
  if (backdrop === "white") {
    ctx.fillStyle = "#ffffff";
    ctx.globalCompositeOperation = "source-over";
    ctx.fillRect(0, 0, cw, ch);
    return;
  }
  ctx.clearRect(0, 0, cw, ch);
}

/**
 * Toggle checkerboard underlay for transparent export backdrop.
 * @param {HTMLElement | null} wrapEl
 * @param {boolean} transparent
 */
export function syncPreviewBackdropChrome(wrapEl, transparent) {
  if (!wrapEl) {
    return;
  }
  wrapEl.classList.toggle("preview-canvas-wrap--checker", transparent);
}

/**
 * @param {object} deps
 * @param {CanvasRenderingContext2D} deps.previewContext
 * @param {HTMLCanvasElement} deps.previewCanvas
 * @param {HTMLElement} deps.previewStatusEl
 * @param {Array} deps.layers
 * @param {"black" | "white" | "transparent"} deps.backdrop
 * @param {number} deps.transportSeconds
 * @param {number | null | undefined} deps.bpm
 * @param {unknown[]} deps.modulationRoutes
 */
export function drawPreviewFrame(deps) {
  const {
    previewContext,
    previewCanvas,
    previewStatusEl,
    layers,
    backdrop,
    transportSeconds,
    bpm,
    modulationRoutes,
  } = deps;

  const cw = previewCanvas.width;
  const ch = previewCanvas.height;
  const scratchCtx = ensureLayerScratch(cw, ch);
  const bpmEffective = bpm || DEFAULT_BPM;

  applyPreviewBackdrop(previewContext, cw, ch, backdrop);

  let hasVisual = false;
  for (const layer of layers) {
    if (!layer.file || !layer.ready) {
      continue;
    }

    scratchCtx.globalCompositeOperation = "source-over";
    scratchCtx.globalAlpha = 1;
    scratchCtx.clearRect(0, 0, cw, ch);
    if (layer.canvasFit === "fill") {
      drawMediaCover(scratchCtx, layer.video, cw, ch);
    } else {
      drawMediaContain(scratchCtx, layer.video, cw, ch);
    }

    const opacity = resolveModulatedLayerOpacity(
      layer,
      transportSeconds,
      bpmEffective,
      modulationRoutes,
    );

    previewContext.globalCompositeOperation =
      layer.blendMode === "normal" ? "source-over" : layer.blendMode;
    previewContext.globalAlpha = opacity;
    previewContext.drawImage(layerScratchCanvas, 0, 0);
    previewContext.globalAlpha = 1;
    hasVisual = true;
  }

  previewContext.globalCompositeOperation = "source-over";
  previewStatusEl.classList.toggle("hidden", hasVisual);
}
