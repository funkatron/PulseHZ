/**
 * Layer strip DOM: cards, thumbs, clip rings, fit/fill, blend, opacity.
 * @module layer-ui
 */

import { DEFAULT_BPM } from "./bpm-analysis.js?v=20260415";
import { polarFromAngleDegrees } from "./geometry-utils.js?v=20260415";
import { barDurationSeconds } from "./transport-math.js";

/**
 * @param {object} d
 * @param {() => object} d.getState
 * @param {() => object} d.getElements
 * @param {number} d.slotThumbBitmapW
 * @param {number} d.slotThumbBitmapH
 * @param {readonly string[]} d.supportedBlendModes
 * @param {(layer: object) => void} d.mountLayerVideoInStaging
 * @param {(ctx: CanvasRenderingContext2D, cw: number, ch: number) => void} d.drawLayerSlotPlaceholder
 * @param {(layer: object) => void} d.queueSlotThumbPaint
 * @param {(v: unknown) => number} d.normalizeBarsPerLoop
 * @param {(id: number, file: File, options?: object) => Promise<void>} d.loadVideoLayer
 * @param {(msg: string, opts?: { error?: boolean }) => void} d.setStatus
 * @param {() => number} d.getTransportSeconds
 * @param {(t: number) => void} d.drawPreview
 * @param {() => void} d.scheduleAutosave
 * @param {() => void} d.applyPlaybackRates
 * @param {(t: number) => void} d.syncLayerVideos
 * @param {(id: number) => void} d.clearLayer
 * @param {(file: File) => boolean} d.isProbablyVideoFile
 */
export function createLayerUi(d) {
  const {
    getState,
    getElements,
    slotThumbBitmapW,
    slotThumbBitmapH,
    supportedBlendModes,
    mountLayerVideoInStaging,
    drawLayerSlotPlaceholder,
    queueSlotThumbPaint,
    normalizeBarsPerLoop,
    loadVideoLayer,
    setStatus,
    getTransportSeconds,
    drawPreview,
    scheduleAutosave,
    applyPlaybackRates,
    syncLayerVideos,
    clearLayer,
    isProbablyVideoFile,
  } = d;

  function createLayerClipRingSvg(layer) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "layer-clip-ring");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("data-clip-ring-for", String(layer.id));
    const n = Math.max(1, normalizeBarsPerLoop(layer.barsPerLoop));
    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "layer-clip-ring__track");
    track.setAttribute("cx", "50");
    track.setAttribute("cy", "50");
    track.setAttribute("r", "44");
    track.setAttribute("pathLength", "100");
    svg.appendChild(track);
    for (let i = 0; i < n; i += 1) {
      const ang = -90 + (i * 360) / n;
      const outer = polarFromAngleDegrees(50, 50, 47, ang);
      const inner = polarFromAngleDegrees(50, 50, 36, ang);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(inner.x));
      line.setAttribute("y1", String(inner.y));
      line.setAttribute("x2", String(outer.x));
      line.setAttribute("y2", String(outer.y));
      line.setAttribute("class", "layer-clip-ring__tick");
      line.dataset.barTick = String(i);
      svg.appendChild(line);
    }
    const prog = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    prog.setAttribute("class", "layer-clip-ring__progress");
    prog.setAttribute("cx", "50");
    prog.setAttribute("cy", "50");
    prog.setAttribute("r", "44");
    prog.setAttribute("pathLength", "100");
    prog.setAttribute("stroke-dasharray", "100");
    prog.setAttribute("stroke-dashoffset", "100");
    svg.appendChild(prog);
    return svg;
  }

  function updateLayerClipRings(transportSeconds) {
    const state = getState();
    const playing = state.playback.isPlaying;
    const bpm = state.playback.bpm || DEFAULT_BPM;
    const barSec = barDurationSeconds(bpm, state.playback.beatsPerBar);
    for (const layer of state.layers) {
      const card = document.querySelector(`.layer-card[data-layer-id="${layer.id}"]`);
      if (!(card instanceof HTMLElement)) {
        continue;
      }
      card.classList.toggle("is-clip-playing", playing && Boolean(layer.file && layer.ready));
      const svg = card.querySelector("svg.layer-clip-ring");
      if (!(svg instanceof SVGSVGElement)) {
        continue;
      }
      if (!layer.file) {
        svg.classList.remove("layer-clip-ring--loading");
        svg.dataset.clipUi = "empty";
        continue;
      }
      if (layer.loading || !layer.ready) {
        svg.classList.add("layer-clip-ring--loading");
        svg.dataset.clipUi = "loading";
        continue;
      }
      svg.classList.remove("layer-clip-ring--loading");
      const n = normalizeBarsPerLoop(layer.barsPerLoop);
      const loopSec = barSec * n;
      const p = loopSec > 0 ? (transportSeconds % loopSec) / loopSec : 0;
      const prog = svg.querySelector(".layer-clip-ring__progress");
      if (prog instanceof SVGCircleElement) {
        prog.setAttribute("stroke-dashoffset", String(100 - p * 100));
      }
      const barInLoop = Math.min(n - 1, Math.floor(p * n + 1e-9));
      svg.querySelectorAll(".layer-clip-ring__tick").forEach((el, i) => {
        el.setAttribute(
          "class",
          i <= barInLoop ? "layer-clip-ring__tick layer-clip-ring__tick--on" : "layer-clip-ring__tick",
        );
      });
      svg.dataset.clipUi = playing ? "playing" : "idle";
    }
  }

  function renderLayers() {
    const state = getState();
    const elements = getElements();

    elements.layersGrid.innerHTML = "";

    for (const layer of state.layers) {
      const card = document.createElement("section");
      card.className = "panel layer-card";
      card.setAttribute("data-layer-id", String(layer.id));
      card.tabIndex = 0;

      const fullName = layer.file ? layer.file.name : "";
      const shortName =
        layer.file && layer.file.name.length > 14
          ? `${layer.file.name.slice(0, 12)}…`
          : layer.file
            ? layer.file.name
            : "Empty";

      const header = document.createElement("div");
      header.className = "layer-header";
      header.innerHTML = `<strong>L${layer.id}</strong><span class="muted"></span>`;
      const mutedEl = header.querySelector(".muted");
      if (mutedEl instanceof HTMLElement) {
        mutedEl.textContent = shortName;
        mutedEl.title = fullName;
      }

      const slot = document.createElement("div");
      slot.className = "layer-slot";

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "video/*";
      fileInput.className = "hidden";
      fileInput.id = `layer-file-${layer.id}`;
      fileInput.addEventListener("change", async (event) => {
        const input = event.target;
        const [file] = input.files || [];
        input.value = "";
        if (!file) {
          return;
        }
        if (!isProbablyVideoFile(file)) {
          setStatus(`Not a supported video type: ${file.name}`, { error: true });
          return;
        }
        try {
          await loadVideoLayer(layer.id, file);
        } catch {
          /* loadVideoLayer sets status */
        }
      });

      const thumbArea = document.createElement("label");
      thumbArea.className = "layer-slot-thumb-area";
      thumbArea.setAttribute("for", fileInput.id);

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "layer-slot-thumb-wrap";

      thumbArea.appendChild(fileInput);
      thumbArea.appendChild(thumbWrap);
      slot.appendChild(thumbArea);

      if (layer.file) {
        mountLayerVideoInStaging(layer);
        layer.video.controls = false;
        layer.video.playsInline = true;

        const ringHost = document.createElement("div");
        ringHost.className = "layer-slot-thumb-ring-host";

        const thumb = document.createElement("canvas");
        thumb.className = "layer-slot-thumb";
        thumb.width = slotThumbBitmapW;
        thumb.height = slotThumbBitmapH;
        layer.slotThumbCanvas = thumb;
        const tctx = thumb.getContext("2d");
        if (tctx) {
          drawLayerSlotPlaceholder(tctx, slotThumbBitmapW, slotThumbBitmapH);
        }
        ringHost.appendChild(thumb);
        ringHost.appendChild(createLayerClipRingSvg(layer));
        thumbWrap.appendChild(ringHost);
        queueSlotThumbPaint(layer);

        const meta = document.createElement("div");
        meta.className = "layer-slot-meta";
        const bp = normalizeBarsPerLoop(layer.barsPerLoop);
        meta.textContent = `${layer.duration.toFixed(2)}s · ${bp === 1 ? "1" : bp} bar`;
        thumbWrap.appendChild(meta);
      } else {
        layer.slotThumbCanvas = null;
        const empty = document.createElement("div");
        empty.className = "layer-slot-empty";
        empty.textContent = "Drop or pick clip";
        thumbWrap.appendChild(empty);
      }

      card.setAttribute("aria-busy", layer.file && !layer.ready ? "true" : "false");

      slot.addEventListener("dragover", (event) => {
        event.preventDefault();
        slot.classList.add("is-dragover");
      });
      slot.addEventListener("dragleave", () => slot.classList.remove("is-dragover"));
      slot.addEventListener("drop", async (event) => {
        event.preventDefault();
        slot.classList.remove("is-dragover");
        const [file] = event.dataTransfer.files;
        if (!file || !isProbablyVideoFile(file)) {
          setStatus("Drop a video file (.mp4, .webm, .mov, …).", { error: true });
          return;
        }
        try {
          await loadVideoLayer(layer.id, file);
        } catch {
          /* loadVideoLayer sets status */
        }
      });

      const prime = document.createElement("div");
      prime.className = "layer-controls-prime";

      const fitGroup = document.createElement("div");
      fitGroup.className = "layer-canvas-fit";
      fitGroup.setAttribute("role", "radiogroup");
      fitGroup.setAttribute("aria-label", `Layer ${layer.id} canvas fit`);

      const btnFit = document.createElement("button");
      btnFit.type = "button";
      btnFit.className = "layer-canvas-fit__btn";
      btnFit.textContent = "Fit";
      btnFit.setAttribute("role", "radio");

      const btnFill = document.createElement("button");
      btnFill.type = "button";
      btnFill.className = "layer-canvas-fit__btn";
      btnFill.textContent = "Fill";
      btnFill.setAttribute("role", "radio");

      const syncFitButtons = () => {
        const isFit = layer.canvasFit !== "fill";
        btnFit.classList.toggle("is-selected", isFit);
        btnFill.classList.toggle("is-selected", !isFit);
        btnFit.setAttribute("aria-checked", String(isFit));
        btnFill.setAttribute("aria-checked", String(!isFit));
      };
      syncFitButtons();
      btnFit.addEventListener("click", () => {
        layer.canvasFit = "fit";
        syncFitButtons();
        drawPreview(getTransportSeconds());
        scheduleAutosave();
      });
      btnFill.addEventListener("click", () => {
        layer.canvasFit = "fill";
        syncFitButtons();
        drawPreview(getTransportSeconds());
        scheduleAutosave();
      });
      fitGroup.appendChild(btnFit);
      fitGroup.appendChild(btnFill);

      const blendSelect = document.createElement("select");
      blendSelect.className = "select";
      blendSelect.setAttribute("data-blend-layer", String(layer.id));
      blendSelect.setAttribute("aria-label", `Layer ${layer.id} blend mode`);
      blendSelect.innerHTML = supportedBlendModes
        .map((mode) => `<option value="${mode}">${mode}</option>`)
        .join("");
      blendSelect.value = layer.blendMode;

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "button button-danger";
      clearBtn.textContent = "Clear";

      prime.appendChild(fitGroup);
      prime.appendChild(blendSelect);
      prime.appendChild(clearBtn);

      const more = document.createElement("details");
      more.className = "layer-controls-more";
      const moreSum = document.createElement("summary");
      moreSum.textContent = "Layer options";
      const moreBody = document.createElement("div");
      moreBody.className = "layer-controls-more__body";

      const rowBars = document.createElement("div");
      rowBars.className = "layer-actions-row layer-bars-row";
      const barsLabel = document.createElement("label");
      barsLabel.className = "muted";
      barsLabel.textContent = "Clip loop";
      barsLabel.setAttribute("for", `layer-bars-${layer.id}`);
      const barsSelect = document.createElement("select");
      barsSelect.id = `layer-bars-${layer.id}`;
      barsSelect.className = "select";
      for (const n of [1, 2, 4]) {
        const opt = document.createElement("option");
        opt.value = String(n);
        opt.textContent = n === 1 ? "1 bar" : `${n} bars`;
        barsSelect.appendChild(opt);
      }
      barsSelect.value = String(normalizeBarsPerLoop(layer.barsPerLoop));
      barsSelect.disabled = !layer.file;
      barsSelect.addEventListener("change", () => {
        const v = Number(barsSelect.value);
        layer.barsPerLoop = v === 2 || v === 4 ? v : 1;
        layer.barsPerLoopLocked = true;
        applyPlaybackRates();
        syncLayerVideos(getTransportSeconds());
        renderLayers();
        drawPreview(getTransportSeconds());
        scheduleAutosave();
      });
      rowBars.appendChild(barsLabel);
      rowBars.appendChild(barsSelect);

      const rowOpacity = document.createElement("div");
      rowOpacity.className = "layer-opacity-row";
      const opacityLabel = document.createElement("label");
      opacityLabel.className = "muted layer-opacity-label";
      opacityLabel.textContent = "Opacity";
      opacityLabel.setAttribute("for", `layer-opacity-${layer.id}`);
      const opacityRange = document.createElement("input");
      opacityRange.id = `layer-opacity-${layer.id}`;
      opacityRange.className = "input layer-opacity-range";
      opacityRange.type = "range";
      opacityRange.min = "0";
      opacityRange.max = "100";
      opacityRange.step = "1";
      opacityRange.value = String(Math.round((layer.opacity ?? 1) * 100));
      const opacityValue = document.createElement("span");
      opacityValue.className = "opacity-value";
      opacityValue.textContent = `${opacityRange.value}%`;
      const syncOpacity = () => {
        layer.opacity = Number(opacityRange.value) / 100;
        opacityValue.textContent = `${opacityRange.value}%`;
        drawPreview(getTransportSeconds());
        scheduleAutosave();
      };
      opacityRange.addEventListener("input", syncOpacity);
      rowOpacity.appendChild(opacityLabel);
      rowOpacity.appendChild(opacityRange);
      rowOpacity.appendChild(opacityValue);

      moreBody.appendChild(rowBars);
      moreBody.appendChild(rowOpacity);
      more.appendChild(moreSum);
      more.appendChild(moreBody);

      const controls = document.createElement("div");
      controls.className = "layer-actions";
      controls.appendChild(prime);
      controls.appendChild(more);

      card.appendChild(header);
      card.appendChild(slot);
      card.appendChild(controls);
      elements.layersGrid.appendChild(card);

      blendSelect.addEventListener("change", (event) => {
        layer.blendMode = event.target.value;
        drawPreview(getTransportSeconds());
        scheduleAutosave();
      });

      clearBtn.addEventListener("click", () => clearLayer(layer.id));
    }
  }

  return { renderLayers, updateLayerClipRings };
}
