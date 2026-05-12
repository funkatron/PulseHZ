/**
 * Transport HUD: beat readout, ring, metronome flash, sidebar kickers.
 * @module transport-ui
 */

import { DEFAULT_BPM } from "./bpm-analysis.js?v=20260415";
import { polarFromAngleDegrees } from "./geometry-utils.js";
import { barDurationSeconds } from "./transport-math.js";

/** @type {string} */
let transportBeatTicksSignature = "";
let lastMetronomeBarIndex = -1;
/** @type {number | null} */
let lastAnnouncedTransportBeat = null;
/** @type {AudioContext | null} */
let metronomeClickContext = null;

/**
 * @param {object} deps
 * @param {() => object} deps.getState
 * @param {() => object} deps.getElements
 * @param {number} deps.maxLayers
 * @param {typeof import("./output-dimensions.js").getOutputDimensions} deps.getOutputDimensions
 * @param {(name: string, max: number) => string} deps.truncateMiddleEllipsis
 */
export function createTransportUi(deps) {
  const { getState, getElements, maxLayers, getOutputDimensions, truncateMiddleEllipsis } = deps;

  function updateSidebarSheetKickers() {
    const state = getState();
    const patchEl = document.getElementById("sidebar-kicker-patch");
    const exportEl = document.getElementById("sidebar-kicker-export");
    const statusEl = document.getElementById("sidebar-kicker-status");
    const bpm = (state.playback.bpm || DEFAULT_BPM).toFixed(1);

    if (patchEl) {
      if (state.liveInput.active) {
        patchEl.textContent = ` · live · ${bpm} BPM`;
      } else if (state.audio.file?.name) {
        patchEl.textContent = ` · ${truncateMiddleEllipsis(state.audio.file.name, 20)} · ${bpm} BPM`;
      } else {
        patchEl.textContent = ` · no audio file · ${bpm} BPM`;
      }
    }

    if (exportEl) {
      const { width, height } = getOutputDimensions(state.output.tier, state.output.aspect);
      exportEl.textContent = ` · ${state.output.tier} · ${width}×${height}`;
    }

    if (statusEl) {
      const n = state.layers.filter((l) => l.file).length;
      statusEl.textContent = ` · ${n} clip${n === 1 ? "" : "s"}`;
    }
  }

  function playMetronomeClick() {
    const elements = getElements();
    if (!elements.metroClickToggle?.checked) {
      return;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        return;
      }
      if (!metronomeClickContext) {
        metronomeClickContext = new Ctor();
      }
      const ctx = metronomeClickContext;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 1180;
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.06);
    } catch {
      /* ignore */
    }
  }

  function tickMetronomeUi(transportSeconds) {
    const state = getState();
    const elements = getElements();
    const bpm = state.playback.bpm || DEFAULT_BPM;
    const beats = state.playback.beatsPerBar || 4;
    const barSec = barDurationSeconds(bpm, beats);
    if (barSec <= 0) {
      return;
    }
    const barIdx = Math.floor(transportSeconds / barSec);
    if (!state.playback.isPlaying) {
      lastMetronomeBarIndex = barIdx;
      return;
    }
    if (barIdx === lastMetronomeBarIndex) {
      return;
    }
    lastMetronomeBarIndex = barIdx;
    if (elements.metroVisualToggle?.checked) {
      const wrap = elements.previewCanvasWrap;
      if (wrap) {
        wrap.classList.remove("preview-metronome-flash");
        void wrap.offsetWidth;
        wrap.classList.add("preview-metronome-flash");
        window.setTimeout(() => wrap.classList.remove("preview-metronome-flash"), 340);
      }
    }
    playMetronomeClick();
  }

  function updateTransportBeatRing(transportSeconds) {
    const state = getState();
    const elements = getElements();
    const ticksEl = elements.transportBeatRingTicks;
    const progEl = elements.transportBeatRingProgress;
    if (!(ticksEl instanceof SVGGElement) || !(progEl instanceof SVGCircleElement)) {
      return;
    }
    const bpm = state.playback.bpm || DEFAULT_BPM;
    const beats = state.playback.beatsPerBar || 4;
    const sig = `${beats}`;
    if (sig !== transportBeatTicksSignature) {
      transportBeatTicksSignature = sig;
      ticksEl.replaceChildren();
      for (let i = 0; i < beats; i += 1) {
        const ang = -90 + (i * 360) / beats;
        const outer = polarFromAngleDegrees(50, 50, 40, ang);
        const inner = polarFromAngleDegrees(50, 50, 30, ang);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(inner.x));
        line.setAttribute("y1", String(inner.y));
        line.setAttribute("x2", String(outer.x));
        line.setAttribute("y2", String(outer.y));
        line.setAttribute("class", "transport-beat-ring__tick");
        ticksEl.appendChild(line);
      }
    }
    const barSec = barDurationSeconds(bpm, beats);
    const phase = barSec > 0 ? transportSeconds % barSec : 0;
    const beatIdx =
      barSec > 0 ? Math.min(beats - 1, Math.floor(phase / (barSec / beats))) : 0;
    const lines = ticksEl.querySelectorAll("line");
    lines.forEach((ln, i) => {
      ln.setAttribute(
        "class",
        i === beatIdx ? "transport-beat-ring__tick transport-beat-ring__tick--active" : "transport-beat-ring__tick",
      );
    });
    const frac = barSec > 0 ? phase / barSec : 0;
    progEl.setAttribute("stroke-dashoffset", String(100 - frac * 100));
  }

  function updateTransportDisplays(transportSeconds = 0) {
    const state = getState();
    const elements = getElements();
    const barSeconds = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
    const phase = barSeconds > 0 ? transportSeconds % barSeconds : 0;
    const currentBeat = (phase / (barSeconds / state.playback.beatsPerBar)) + 1;

    elements.currentBeat.textContent = currentBeat.toFixed(2);
    elements.barDuration.textContent = `${barSeconds.toFixed(2)}s`;
    elements.transportProgressBar.style.width = `${(phase / barSeconds) * 100}%`;
    elements.detectedBpm.textContent = state.playback.detectedBpm
      ? state.playback.detectedBpm.toFixed(1)
      : "--";
    elements.loadedLayers.textContent = `${state.layers.filter((layer) => layer.file).length} / ${maxLayers}`;
    elements.previewTransportLabel.textContent = state.playback.isPlaying ? "Playing" : "Stopped";

    if (elements.previewDetectedBpm) {
      elements.previewDetectedBpm.textContent = state.playback.detectedBpm
        ? `BPM ${state.playback.detectedBpm.toFixed(1)}`
        : "BPM --";
    }
    if (elements.previewBarDuration) {
      elements.previewBarDuration.textContent = `Bar ${barSeconds.toFixed(2)}s`;
    }
    if (elements.previewBpmMapStatus) {
      const st = state.audio.bpmSegmentsStatus;
      elements.previewBpmMapStatus.textContent =
        st === "building"
          ? "Tempo map: building…"
          : st === "ready"
            ? "Tempo map: ready"
            : st === "error"
              ? "Tempo map: error"
              : "";
    }

    const beatDur =
      barSeconds > 0 ? barSeconds / (state.playback.beatsPerBar || 4) : 0;
    const globalBeat = beatDur > 0 ? Math.floor(transportSeconds / beatDur + 1e-9) : 0;
    const ann = elements.transportGridAnnounce;
    if (ann && beatDur > 0) {
      if (state.playback.isPlaying) {
        if (lastAnnouncedTransportBeat !== globalBeat) {
          lastAnnouncedTransportBeat = globalBeat;
          const beats = state.playback.beatsPerBar || 4;
          const beatInBar = (globalBeat % beats) + 1;
          const barNumber = Math.floor(globalBeat / beats) + 1;
          ann.textContent = `Bar ${barNumber}, beat ${beatInBar}`;
        }
      } else {
        lastAnnouncedTransportBeat = globalBeat;
      }
    }

    updateSidebarSheetKickers();
    updateTransportBeatRing(transportSeconds);
  }

  async function resumeMetronomeClickContextIfNeeded() {
    const elements = getElements();
    if (!elements.metroClickToggle?.checked) {
      return;
    }
    if (!metronomeClickContext) {
      return;
    }
    if (metronomeClickContext.state === "suspended") {
      await metronomeClickContext.resume();
    }
  }

  return {
    updateSidebarSheetKickers,
    updateTransportDisplays,
    tickMetronomeUi,
    updateTransportBeatRing,
    resumeMetronomeClickContextIfNeeded,
  };
}
