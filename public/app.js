import { createEmptyControlsPayload } from "./control-model.js?v=20260412";
import { resolveModulatedLayerOpacity } from "./modulation-runtime.js?v=20260412";
import { emit, EVT_TRANSPORT_BPM_CHANGED } from "./app-events.js?v=20260412";
import {
  DEFAULT_BPM,
  normalizeBpm,
  estimateBpmFromAudioBuffer,
  downmixToMonoBuffer,
  buildBpmSegmentsAsync,
  bpmAtTime,
  medianBpmFromSegments,
} from "./bpm-analysis.js?v=20260415";

const MAX_LAYERS = 4;

/** Bitmap size for layer slot thumbnails (CSS scales the canvas). */
const SLOT_THUMB_BITMAP_W = 320;
const SLOT_THUMB_BITMAP_H = 180;

/** Manual BPM `input` is debounced so typing does not spam the transport; arrow keys still feel responsive. */
const MANUAL_BPM_INPUT_DEBOUNCE_MS = 120;
let manualBpmInputTimer = null;
/** Throttle commits from file segment map (same ballpark as live estimator). */
let fileBpmFollowLastApplyMs = 0;

/**
 * HTMLMediaElement.playbackRate range is engine-specific (Chromium often ~0.0625–16; some WebViews lower).
 * Long clips need high desired rates; we clamp + walk down until the assignment sticks or we give up.
 */
const MEDIA_PLAYBACK_RATE_MIN = 0.0625;
const MEDIA_PLAYBACK_RATE_MAX = 16;
/** Descending steps tried after the ideal clamp (handles stricter embeds / WebKit caps). */
const PLAYBACK_RATE_FALLBACK_STEPS = [
  16, 12, 10, 8, 6, 4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25, 0.125, MEDIA_PLAYBACK_RATE_MIN,
];

/** @typedef {"black" | "white" | "transparent"} BackdropKind */
const BACKDROP_OPTIONS = /** @type {const} */ (["black", "white", "transparent"]);

/** Vertical resolution for 720p / 1080p / 2160p tiers (16∶9 height). */
const OUTPUT_TIER_HEIGHT = {
  "720p": 720,
  "1080p": 1080,
  "2160p": 2160,
};

const OUTPUT_FIXED_PRESETS = {
  "720x1720": { width: 720, height: 1720 },
  "1440x3440": { width: 1440, height: 3440 },
};

/**
 * Pixel size for the main canvas and ProRes export metadata.
 * Layers are letterboxed into this frame by default (aspect ratio preserved; no crop).
 */
function getOutputDimensions(tierId, aspectId) {
  const fixed = OUTPUT_FIXED_PRESETS[tierId];
  if (fixed) {
    return { ...fixed };
  }

  const h0 = OUTPUT_TIER_HEIGHT[tierId];
  if (!h0) {
    return { width: 1920, height: 1080 };
  }

  if (aspectId === "16:9") {
    if (tierId === "720p") {
      return { width: 1280, height: 720 };
    }
    if (tierId === "1080p") {
      return { width: 1920, height: 1080 };
    }
    return { width: 3840, height: 2160 };
  }

  if (aspectId === "9:16") {
    if (tierId === "720p") {
      return { width: 720, height: 1280 };
    }
    if (tierId === "1080p") {
      return { width: 1080, height: 1920 };
    }
    return { width: 2160, height: 3840 };
  }

  if (aspectId === "21:9") {
    const height = h0;
    const width = Math.round((height * 21) / 9);
    return { width, height };
  }

  if (aspectId === "9:21") {
    const width = h0;
    const height = Math.round((width * 21) / 9);
    return { width, height };
  }

  if (aspectId === "1:1") {
    const side = h0;
    return { width: side, height: side };
  }

  return { width: 1920, height: 1080 };
}

const SUPPORTED_BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "difference",
  "exclusion",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
];

/** Fallback when opening index.html as file:// — match pulsehz.constants.DEFAULT_LISTEN_PORT */
const DEFAULT_DEV_API_PORT = "6066";

/**
 * URL for API `fetch()`. Prefer root-relative `/api/...` for http(s) so the browser always
 * targets the same host+port as the page (works behind typical `/app` static mounts).
 * Set `window.PULSEHZ_API_BASE` (no trailing slash) if `/api` lives under a path prefix.
 */
function pulsehzApiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const override =
    typeof window.PULSEHZ_API_BASE === "string" ? window.PULSEHZ_API_BASE.trim() : "";
  if (override) {
    return `${override.replace(/\/$/, "")}${p}`;
  }
  if (window.location.protocol === "file:") {
    return new URL(p, `http://127.0.0.1:${DEFAULT_DEV_API_PORT}/`).href;
  }
  return p;
}

function pulsehzPreviewNotFoundHelp(requestUrl) {
  const origin = window.location.origin || "(unknown origin)";
  return [
    `Preview API returned 404 for: ${requestUrl}`,
    `Page origin: ${origin}`,
    "This almost always means the page is not served by PulseHZ FastAPI (e.g. only static files), or a proxy routes /app but not /api.",
    `Check: open ${origin}/docs — you should see POST /api/preview-video. Run: uv run pulsehz-server (or pulsehz-client).`,
  ].join(" ");
}

function isProbablyVideoFile(file) {
  if (!file) {
    return false;
  }
  if (file.type && file.type.startsWith("video/")) {
    return true;
  }
  return /\.(mp4|m4v|webm|mov|mkv|ogv|avi)$/i.test(file.name);
}

/** Detached <video> decode is flaky in some WebEngine builds; load while attached off-screen. */
let videoLoadStaging = null;
function ensureVideoLoadStaging() {
  if (!videoLoadStaging) {
    videoLoadStaging = document.createElement("div");
    videoLoadStaging.id = "pulsehz-video-load-staging";
    videoLoadStaging.className = "hidden";
    videoLoadStaging.setAttribute("aria-hidden", "true");
    document.body.appendChild(videoLoadStaging);
  }
  return videoLoadStaging;
}

function describeMediaError(mediaEl) {
  const err = mediaEl.error;
  if (!err) {
    return "unknown media error (no MediaError code)";
  }
  const labels = {
    [MediaError.MEDIA_ERR_ABORTED]: "MEDIA_ERR_ABORTED",
    [MediaError.MEDIA_ERR_NETWORK]: "MEDIA_ERR_NETWORK",
    [MediaError.MEDIA_ERR_DECODE]: "MEDIA_ERR_DECODE",
    [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: "MEDIA_ERR_SRC_NOT_SUPPORTED",
  };
  const label = labels[err.code] ?? `MEDIA_ERR_code_${err.code}`;
  if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return `${label} (browser cannot decode this codec — server transcode will be attempted)`;
  }
  if (err.code === MediaError.MEDIA_ERR_DECODE) {
    return `${label} (decode error — server transcode will be attempted)`;
  }
  return label;
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      video.removeEventListener("loadedmetadata", onOk);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener("loadedmetadata", onOk);
      video.removeEventListener("error", onErr);
      reject(new Error(`${describeMediaError(video)}`));
    };
    video.addEventListener("loadedmetadata", onOk);
    video.addEventListener("error", onErr);
  });
}

async function loadVideoElementFromUrl(video, url) {
  video.src = url;
  video.load();
  await waitForVideoMetadata(video);
}

/** @param {File} file */
async function transcodeVideoForPreview(file) {
  const form = new FormData();
  form.append("video", file, file.name);
  const url = pulsehzApiUrl("/api/preview-video");
  const res = await fetch(url, {
    method: "POST",
    body: form,
  });
  const finalUrl = res.url || url;
  if (!res.ok) {
    if (res.status === 404) {
      console.error("PulseHZ:", pulsehzPreviewNotFoundHelp(finalUrl));
      throw new Error(pulsehzPreviewNotFoundHelp(finalUrl));
    }
    let detail = await res.text();
    try {
      const data = JSON.parse(detail);
      if (typeof data.detail === "string") {
        detail = data.detail;
      } else if (data.detail !== undefined) {
        detail = JSON.stringify(data.detail);
      }
    } catch {
      /* keep raw text */
    }
    throw new Error(
      typeof detail === "string" ? detail.slice(0, 800) : `HTTP ${res.status}`,
    );
  }
  return res.blob();
}

/**
 * @param {unknown} value
 * @returns {1 | 2 | 4}
 */
function normalizeBarsPerLoop(value) {
  const n = Number(value);
  if (n === 2 || n === 4) {
    return n;
  }
  return 1;
}

/**
 * Guess whether a clip is written as one bar, two bars, or four at the current tempo.
 * @param {number} durationSeconds
 * @param {number} barSeconds
 * @returns {1 | 2 | 4}
 */
function inferBarsPerLoopFromDuration(durationSeconds, barSeconds) {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(barSeconds) ||
    barSeconds <= 0
  ) {
    return 1;
  }
  /** @type {(1 | 2 | 4)[]} */
  const candidates = [1, 2, 4];
  let best = 1;
  let bestErr = Infinity;
  for (const k of candidates) {
    const target = k * barSeconds;
    const err = Math.abs(durationSeconds - target) / target;
    if (err < bestErr - 1e-9) {
      bestErr = err;
      best = k;
    } else if (Math.abs(err - bestErr) <= 1e-9 && k < best) {
      best = k;
    }
  }
  return best;
}

/**
 * Recompute 1/2/4-bar guess for every loaded layer when tempo changes, unless the user locked "Clip loop".
 */
function refreshBarsPerLoopFromTempoForAutoLayers() {
  const barSec = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
  let changed = false;
  for (const layer of state.layers) {
    if (!layer.file || !layer.duration || !layer.ready || layer.barsPerLoopLocked) {
      continue;
    }
    const next = inferBarsPerLoopFromDuration(layer.duration, barSec);
    if (next !== layer.barsPerLoop) {
      layer.barsPerLoop = next;
      changed = true;
    }
  }
  if (changed) {
    renderLayers();
  }
}

/**
 * Single path after the musical tempo changes: layer loop inference, rates, sync, UI, then bus emit.
 * @param {number} nextBpm
 * @param {string} source e.g. manual-input | detect-file | detect-live | live-estimator
 */
function commitTransportBpm(nextBpm, source) {
  if (!Number.isFinite(nextBpm) || nextBpm <= 0) {
    return;
  }
  const previousBpm = state.playback.bpm;
  if (Math.abs(nextBpm - previousBpm) < 1e-6) {
    return;
  }
  state.playback.bpm = nextBpm;
  elements.manualBpm.value = nextBpm.toFixed(1);
  refreshBarsPerLoopFromTempoForAutoLayers();
  applyPlaybackRates();
  updateTransportDisplays(getTransportSeconds());
  if (state.playback.isPlaying) {
    syncLayerVideos(getTransportSeconds());
  }
  if (state.playback.isPlaying && state.autoDemo.grid !== "off") {
    syncAutoDemoAnchors(getTransportSeconds());
  }
  drawPreview(getTransportSeconds());
  emit(EVT_TRANSPORT_BPM_CHANGED, {
    bpm: nextBpm,
    previousBpm,
    source,
  });
}

/**
 * Decode loaded file to mono, build sliding-window BPM segments (idle-yielding).
 * Does not block load; runs in background.
 */
async function runFileBpmAnalysis() {
  if (!state.audio.file) {
    return;
  }
  state.audio.bpmSegmentsStatus = "building";
  state.audio.bpmSegments = null;
  state.audio.analysisMono = null;
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextCtor();
    const bytes = await state.audio.file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    await ctx.close();
    const mono = downmixToMonoBuffer(decoded);
    state.audio.analysisMono = mono;
    const segments = await buildBpmSegmentsAsync(mono, {
      windowSec: 12,
      hopSec: 6,
      maxSeconds: 600,
    });
    state.audio.bpmSegments = segments;
    state.audio.bpmSegmentsStatus = "ready";
  } catch (error) {
    console.warn("PulseHZ: file BPM segment analysis failed", error);
    state.audio.bpmSegmentsStatus = "error";
  }
}

/**
 * While a file is playing (not live), map current playback time to segment BPM and nudge transport.
 */
function updateFileBpmFromSegments() {
  if (state.liveInput.active) {
    return;
  }
  if (!state.audio.file || !state.playback.isPlaying) {
    return;
  }
  if (state.audio.bpmSegmentsStatus !== "ready" || !state.audio.bpmSegments?.length) {
    return;
  }
  const t = elements.audioElement.currentTime || 0;
  const target = bpmAtTime(state.audio.bpmSegments, t);
  if (target == null || !Number.isFinite(target)) {
    return;
  }
  const rounded = Math.round(target * 10) / 10;
  const now = performance.now();
  if (now - fileBpmFollowLastApplyMs < 140) {
    return;
  }
  if (Math.abs(rounded - state.playback.bpm) < 0.15) {
    return;
  }
  fileBpmFollowLastApplyMs = now;
  state.playback.detectedBpm = rounded;
  commitTransportBpm(rounded, "file-segments");
}

function barDurationSeconds(bpm, beatsPerBar = 4) {
  return (60 / bpm) * beatsPerBar;
}

/** Onset + beat-interval BPM estimator (~60fps) while live capture is active. */
const realtimeBpmEstimator = {
  prevRms: 0,
  onsetHistory: [],
  lastBeatMs: 0,
  beatTimes: [],
  smoothedBpm: null,
  lastApplyMs: 0,
};

function medianSortedCopy(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function resetRealtimeBpmEstimator({ clearDetected = false } = {}) {
  realtimeBpmEstimator.prevRms = 0;
  realtimeBpmEstimator.onsetHistory.length = 0;
  realtimeBpmEstimator.lastBeatMs = 0;
  realtimeBpmEstimator.beatTimes.length = 0;
  realtimeBpmEstimator.smoothedBpm = null;
  realtimeBpmEstimator.lastApplyMs = 0;
  if (clearDetected) {
    state.playback.detectedBpm = null;
  }
}

/**
 * Cheap RMS onset peaks → beat times → median interval → smoothed BPM.
 * Drives transport BPM + layer rates (throttled) for loopback / live use.
 */
function updateRealtimeBpmFromLive() {
  if (!state.liveInput.active || !state.analyserNode || state.audioAnalysisInFlight) {
    return;
  }

  const analyzer = state.analyserNode;
  const timeData = new Float32Array(analyzer.fftSize);
  analyzer.getFloatTimeDomainData(timeData);

  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    sumSquares += timeData[i] * timeData[i];
  }
  const rms = Math.sqrt(sumSquares / timeData.length);

  const prev = realtimeBpmEstimator.prevRms;
  const flux = Math.max(0, rms - prev);
  realtimeBpmEstimator.prevRms = rms * 0.18 + prev * 0.82;

  const history = realtimeBpmEstimator.onsetHistory;
  history.push(flux);
  if (history.length > 52) {
    history.shift();
  }
  if (history.length < 12) {
    return;
  }

  const floor = medianSortedCopy(history);
  const threshold = floor * 2.75 + 0.022;

  const now = performance.now();
  if (flux > threshold && now - realtimeBpmEstimator.lastBeatMs > 250) {
    realtimeBpmEstimator.lastBeatMs = now;
    const beats = realtimeBpmEstimator.beatTimes;
    beats.push(now);
    if (beats.length > 20) {
      beats.shift();
    }
  }

  const beats = realtimeBpmEstimator.beatTimes;
  if (beats.length < 4) {
    return;
  }

  const intervals = [];
  for (let i = 1; i < beats.length; i += 1) {
    const gap = beats[i] - beats[i - 1];
    if (gap > 280 && gap < 1600) {
      intervals.push(gap);
    }
  }
  if (intervals.length < 3) {
    return;
  }

  let bpm = 60000 / medianSortedCopy(intervals);
  bpm = normalizeBpm(bpm);
  bpm = Math.max(58, Math.min(200, bpm));

  const prevSmooth = realtimeBpmEstimator.smoothedBpm;
  realtimeBpmEstimator.smoothedBpm =
    prevSmooth == null ? bpm : prevSmooth * 0.78 + bpm * 0.22;
  state.playback.detectedBpm = realtimeBpmEstimator.smoothedBpm;

  if (now - realtimeBpmEstimator.lastApplyMs < 140) {
    return;
  }
  realtimeBpmEstimator.lastApplyMs = now;

  const rounded = Math.round(realtimeBpmEstimator.smoothedBpm * 10) / 10;
  if (Math.abs(rounded - state.playback.bpm) < 0.15) {
    return;
  }

  commitTransportBpm(rounded, "live-estimator");
}

function createLayerState(id) {
  return {
    id,
    blendMode: id === 1 ? "normal" : "screen",
    opacity: 1,
    file: null,
    objectUrl: "",
    video: document.createElement("video"),
    duration: 0,
    ready: false,
    /** @type {1 | 2 | 4} */
    barsPerLoop: 1,
    /** If true, "Clip loop" was chosen manually and tempo changes won't re-infer. */
    barsPerLoopLocked: false,
  };
}

const state = {
  /** @type {{ schemaVersion: number, modulation: unknown[], midi: unknown[] }} */
  controls: createEmptyControlsPayload(),
  output: {
    tier: "1080p",
    aspect: "16:9",
    backdrop: /** @type {BackdropKind} */ ("black"),
  },
  audioContext: null,
  mediaElementSource: null,
  liveStreamSource: null,
  liveInput: {
    active: false,
    stream: null,
  },
  analyserNode: null,
  exportAudioDestination: null,
  animationFrameId: null,
  idleMeterFrameId: null,
  audioAnalysisInFlight: false,
  layers: Array.from({ length: MAX_LAYERS }, (_, index) => createLayerState(index + 1)),
  playback: {
    beatsPerBar: 4,
    bpm: DEFAULT_BPM,
    detectedBpm: null,
    isPlaying: false,
    usingAudioClock: false,
    startOffsetSeconds: 0,
    startedAtMs: 0,
  },
  audio: {
    file: null,
    objectUrl: "",
    duration: 0,
    /** Decoded mono buffer for full-file analysis; cleared with audio track. */
    /** @type {AudioBuffer | null} */
    analysisMono: null,
    /** @type {Array<{ tCenter: number, bpm: number }> | null} */
    bpmSegments: null,
    /** @type {"idle" | "building" | "ready" | "error"} */
    bpmSegmentsStatus: "idle",
  },
  /** Editor-only: discrete steps on musical grid. Not serialized to export metadata. */
  autoDemo: {
    /** @type {"off" | "beat" | "bar" | "both"} */
    grid: "off",
    _lastBar: /** @type {number | null} */ (null),
    _lastBeat: /** @type {number | null} */ (null),
  },
};

const elements = {
  projectName: document.getElementById("project-name"),
  audioInput: document.getElementById("audio-input"),
  audioElement: document.getElementById("audio-element"),
  detectBpmButton: document.getElementById("detect-bpm-button"),
  clearAudioButton: document.getElementById("clear-audio-button"),
  liveAudioButton: document.getElementById("live-audio-button"),
  audioDeviceSelect: document.getElementById("audio-device-select"),
  refreshAudioDevicesButton: document.getElementById("refresh-audio-devices-button"),
  manualBpm: document.getElementById("manual-bpm"),
  currentBeat: document.getElementById("current-beat"),
  detectedBpm: document.getElementById("detected-bpm"),
  barDuration: document.getElementById("bar-duration"),
  loadedLayers: document.getElementById("loaded-layers"),
  meterBar: document.getElementById("meter-bar"),
  transportProgressBar: document.getElementById("transport-progress-bar"),
  statusLine: document.getElementById("status-line"),
  previewStatus: document.getElementById("preview-status"),
  previewOutputLabel: document.getElementById("preview-output-label"),
  previewTransportLabel: document.getElementById("preview-transport-label"),
  previewCanvas: document.getElementById("preview-canvas"),
  layersGrid: document.getElementById("layers-grid"),
  playButton: document.getElementById("play-button"),
  pauseButton: document.getElementById("pause-button"),
  exportHighButton: document.getElementById("export-high-button"),
  exportWebButton: document.getElementById("export-web-button"),
  outputTierSelect: document.getElementById("output-tier-select"),
  outputAspectSelect: document.getElementById("output-aspect-select"),
  outputDimensionsLabel: document.getElementById("output-dimensions-label"),
  previewCanvasWrap: document.getElementById("preview-canvas-wrap"),
  outputBackdropSelect: document.getElementById("output-backdrop-select"),
  demoLfoOpacityButton: document.getElementById("demo-lfo-opacity-button"),
  autoDemoGridSelect: document.getElementById("auto-demo-grid-select"),
};

const previewContext =
  elements.previewCanvas.getContext("2d", { alpha: true, desynchronized: true }) ??
  elements.previewCanvas.getContext("2d", { alpha: true }) ??
  elements.previewCanvas.getContext("2d");

/** Offscreen buffer for compositing; `drawImage(<video>)` + blend mode is unreliable in some engines. */
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

function setStatus(message, { error = false } = {}) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle("is-error", error);
  console.log(`PulseHZ: ${message}`);
}

function updateTransportDisplays(transportSeconds = 0) {
  const barSeconds = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
  const phase = barSeconds > 0 ? transportSeconds % barSeconds : 0;
  const currentBeat = (phase / (barSeconds / state.playback.beatsPerBar)) + 1;

  elements.currentBeat.textContent = currentBeat.toFixed(2);
  elements.barDuration.textContent = `${barSeconds.toFixed(2)}s`;
  elements.transportProgressBar.style.width = `${(phase / barSeconds) * 100}%`;
  elements.detectedBpm.textContent = state.playback.detectedBpm
    ? state.playback.detectedBpm.toFixed(1)
    : "--";
  elements.loadedLayers.textContent = `${state.layers.filter((layer) => layer.file).length} / ${MAX_LAYERS}`;
  elements.previewTransportLabel.textContent = state.playback.isPlaying
    ? `Playing bar ${(transportSeconds / barSeconds).toFixed(2)}`
    : "Stopped";
}

function getTransportSeconds() {
  if (!state.playback.isPlaying) {
    return state.playback.startOffsetSeconds;
  }

  if (state.playback.usingAudioClock && !elements.audioElement.paused) {
    return elements.audioElement.currentTime || 0;
  }

  const elapsed = (performance.now() - state.playback.startedAtMs) / 1000;
  return state.playback.startOffsetSeconds + elapsed;
}

/** All layers with a ready clip (auto-demo steps each row; index uses layer id as offset). */
function activeLoadedLayers() {
  return state.layers.filter((layer) => layer.file && layer.ready);
}

const AUTO_DEMO_BLEND_CYCLE = [
  "normal",
  "screen",
  "multiply",
  "overlay",
  "difference",
  "color-dodge",
];

const AUTO_DEMO_OPACITY_STEPS = [1, 0.78, 0.52, 0.9, 0.66];

function syncAutoDemoAnchors(transportSeconds) {
  const barSec = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
  if (barSec <= 0) {
    return;
  }
  const beatDur = barSec / state.playback.beatsPerBar;
  state.autoDemo._lastBar = Math.floor(transportSeconds / barSec);
  state.autoDemo._lastBeat = Math.floor(transportSeconds / beatDur);
}

function autoDemoOnBeat(globalBeatIndex) {
  const layers = activeLoadedLayers();
  if (!layers.length) {
    return;
  }
  const len = AUTO_DEMO_BLEND_CYCLE.length;
  for (const layer of layers) {
    const idx = ((globalBeatIndex + layer.id) % len + len) % len;
    layer.blendMode = AUTO_DEMO_BLEND_CYCLE[idx];
  }
  renderLayers();
}

function autoDemoOnBar(barIndex) {
  const layers = activeLoadedLayers();
  if (!layers.length) {
    return;
  }
  const len = AUTO_DEMO_OPACITY_STEPS.length;
  for (const layer of layers) {
    const idx = ((barIndex + layer.id) % len + len) % len;
    layer.opacity = AUTO_DEMO_OPACITY_STEPS[idx];
  }
  renderLayers();
}

function applyAutoDemo(transportSeconds) {
  const ad = state.autoDemo;
  if (ad.grid === "off" || !state.playback.isPlaying) {
    return;
  }
  const barSec = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
  if (barSec <= 0) {
    return;
  }
  const beatDur = barSec / state.playback.beatsPerBar;
  const currentBar = Math.floor(transportSeconds / barSec);
  const currentBeatGlobal = Math.floor(transportSeconds / beatDur);

  if (ad._lastBar === null || ad._lastBeat === null) {
    syncAutoDemoAnchors(transportSeconds);
    return;
  }

  const barChanged = ad._lastBar !== currentBar;
  const beatChanged = ad._lastBeat !== currentBeatGlobal;
  if (barChanged) {
    ad._lastBar = currentBar;
  }
  if (beatChanged) {
    ad._lastBeat = currentBeatGlobal;
  }

  if ((ad.grid === "bar" || ad.grid === "both") && barChanged) {
    autoDemoOnBar(currentBar);
  }
  if ((ad.grid === "beat" || ad.grid === "both") && beatChanged) {
    autoDemoOnBeat(currentBeatGlobal);
  }
}

function handleAutoDemoGridChange() {
  const raw = elements.autoDemoGridSelect?.value ?? "off";
  const allowed = ["off", "beat", "bar", "both"];
  state.autoDemo.grid = allowed.includes(raw) ? raw : "off";
  state.autoDemo._lastBar = null;
  state.autoDemo._lastBeat = null;
  if (state.playback.isPlaying && state.autoDemo.grid !== "off") {
    syncAutoDemoAnchors(getTransportSeconds());
  }
  if (elements.autoDemoGridSelect) {
    elements.autoDemoGridSelect.value = state.autoDemo.grid;
  }
}

function ensureAudioBase() {
  if (state.audioContext) {
    return;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    setStatus("Web Audio API is unavailable in this browser.", { error: true });
    return;
  }

  state.audioContext = new AudioContextCtor();
  state.analyserNode = state.audioContext.createAnalyser();
  state.analyserNode.fftSize = 1024;
  state.exportAudioDestination = state.audioContext.createMediaStreamDestination();
}

function stopIdleLiveMeter() {
  cancelAnimationFrame(state.idleMeterFrameId);
  state.idleMeterFrameId = null;
}

function tickIdleLiveMeter() {
  updateAudioMeter();
  if (state.liveInput.active && !state.playback.isPlaying) {
    state.idleMeterFrameId = requestAnimationFrame(tickIdleLiveMeter);
  }
}

function startIdleLiveMeter() {
  stopIdleLiveMeter();
  if (state.liveInput.active && !state.playback.isPlaying) {
    state.idleMeterFrameId = requestAnimationFrame(tickIdleLiveMeter);
  }
}

function syncLiveAudioButton() {
  if (!elements.liveAudioButton) {
    return;
  }
  elements.liveAudioButton.textContent = state.liveInput.active ? "Stop live capture" : "Live capture";
  elements.liveAudioButton.classList.toggle("button-accent", state.liveInput.active);
}

function stopLiveStreamsOnly() {
  if (state.liveInput.stream) {
    for (const track of state.liveInput.stream.getTracks()) {
      track.stop();
    }
  }
  state.liveInput.stream = null;
  if (state.liveStreamSource) {
    try {
      state.liveStreamSource.disconnect();
    } catch (_) {
      /* ignore */
    }
    state.liveStreamSource = null;
  }
  state.liveInput.active = false;
  stopIdleLiveMeter();
  syncLiveAudioButton();
  resetRealtimeBpmEstimator();
}

function connectFileSources() {
  ensureAudioBase();
  if (!state.audioContext) {
    return;
  }

  stopLiveStreamsOnly();

  if (state.mediaElementSource) {
    try {
      state.mediaElementSource.disconnect();
    } catch (_) {
      /* ignore */
    }
  }

  if (!state.audio.file) {
    return;
  }

  if (!state.mediaElementSource) {
    state.mediaElementSource = state.audioContext.createMediaElementSource(elements.audioElement);
  }
  state.mediaElementSource.connect(state.analyserNode);
  state.mediaElementSource.connect(state.exportAudioDestination);
  state.mediaElementSource.connect(state.audioContext.destination);
}

async function resumeAudioContext() {
  ensureAudioBase();
  if (state.audioContext && state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
}

async function refreshAudioInputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return;
  }
  const select = elements.audioDeviceSelect;
  if (!select) {
    return;
  }
  const previous = select.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput");
  select.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Default input";
  select.appendChild(defaultOpt);
  for (const device of inputs) {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.textContent = device.label || `Audio input (${device.deviceId.slice(0, 6)}…)`;
    select.appendChild(opt);
  }
  const optValues = [...select.options].map((o) => o.value);
  if (previous && optValues.includes(previous)) {
    select.value = previous;
  }
}

async function startLiveAudioInput() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("getUserMedia unavailable (open the app over http://localhost, not file://).", { error: true });
    return;
  }

  await resumeAudioContext();
  if (!state.audioContext) {
    return;
  }

  if (state.mediaElementSource) {
    try {
      state.mediaElementSource.disconnect();
    } catch (_) {
      /* ignore */
    }
  }
  stopLiveStreamsOnly();

  const deviceId = elements.audioDeviceSelect?.value || "";
  const audioConstraint = deviceId
    ? {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

  resetRealtimeBpmEstimator({ clearDetected: true });

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraint,
    video: false,
  });

  state.liveInput.stream = stream;
  state.liveStreamSource = state.audioContext.createMediaStreamSource(stream);
  state.liveStreamSource.connect(state.analyserNode);
  state.liveStreamSource.connect(state.exportAudioDestination);
  state.liveStreamSource.connect(state.audioContext.destination);
  state.liveInput.active = true;
  elements.audioElement.pause();
  syncLiveAudioButton();
  await refreshAudioInputDevices();
  setStatus(
    "Live capture on. Loopback devices (e.g. BlackHole) appear here as inputs—route your app into that device in system audio settings.",
  );
  startIdleLiveMeter();
}

function stopLiveAudioInput() {
  connectFileSources();
  setStatus(
    state.audio.file ? "Live capture stopped; audio file routing restored." : "Live capture stopped.",
  );
}

async function toggleLiveAudioInput() {
  if (state.liveInput.active) {
    stopLiveAudioInput();
    return;
  }
  try {
    await startLiveAudioInput();
  } catch (error) {
    stopLiveStreamsOnly();
    setStatus(`Live capture failed: ${error.message}`, { error: true });
  }
}

/**
 * @param {HTMLVideoElement} video
 * @param {number} desired
 */
function setLayerVideoPlaybackRate(video, desired) {
  if (!Number.isFinite(desired) || desired <= 0) {
    try {
      video.playbackRate = 1;
    } catch {
      /* ignore */
    }
    return;
  }

  const clampToEngine = (r) =>
    Math.min(Math.max(r, MEDIA_PLAYBACK_RATE_MIN), MEDIA_PLAYBACK_RATE_MAX);

  const ideal = clampToEngine(desired);
  /** @type {number[]} */
  const attempts = [];
  const pushU = (r) => {
    const x = clampToEngine(r);
    if (!attempts.includes(x)) {
      attempts.push(x);
    }
  };
  pushU(ideal);
  for (const step of PLAYBACK_RATE_FALLBACK_STEPS) {
    if (step < ideal - 1e-9) {
      pushU(step);
    }
  }

  for (const rate of attempts) {
    try {
      video.playbackRate = rate;
      return;
    } catch {
      /* try next fallback */
    }
  }
  try {
    video.playbackRate = 1;
  } catch {
    /* ignore */
  }
}

function applyPlaybackRates() {
  const barSeconds = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
  for (const layer of state.layers) {
    if (!layer.file || !layer.duration) {
      continue;
    }
    try {
      layer.video.loop = true;
      layer.video.muted = true;
      const n = normalizeBarsPerLoop(layer.barsPerLoop);
      const loopSeconds = barSeconds * n;
      const desired = loopSeconds > 0 ? layer.duration / loopSeconds : 1;
      setLayerVideoPlaybackRate(layer.video, desired);
    } catch (err) {
      console.warn(`PulseHZ: layer ${layer.id} playback rate skipped`, err);
    }
  }
}

function syncLayerVideos(transportSeconds) {
  const barSeconds = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);

  for (const layer of state.layers) {
    if (!layer.file || !layer.duration || !layer.ready) {
      continue;
    }

    const n = normalizeBarsPerLoop(layer.barsPerLoop);
    const loopSeconds = barSeconds * n;
    const phase = loopSeconds > 0 ? transportSeconds % loopSeconds : 0;
    const desiredTime =
      loopSeconds > 0 ? ((phase / loopSeconds) * layer.duration) % layer.duration : 0;
    const currentTime = Number.isFinite(layer.video.currentTime) ? layer.video.currentTime : 0;
    if (Math.abs(currentTime - desiredTime) > 0.08) {
      layer.video.currentTime = desiredTime;
    }
  }
}

/**
 * Uniform scale + center — matches CSS object-fit: **contain** (full frame visible, letterboxing).
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement | HTMLImageElement} media
 */
function drawMediaContain(ctx, media, cw, ch) {
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

/** Keep decode `<video>` under the off-screen staging host (not in layer cards). */
function mountLayerVideoInStaging(layer) {
  const host = ensureVideoLoadStaging();
  if (layer.video.parentNode !== host) {
    host.appendChild(layer.video);
  }
}

/**
 * Visible fallback for layer slot canvas before a decoded video frame exists.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawLayerSlotPlaceholder(ctx, cw, ch) {
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

function refreshLayerSlotThumb(layer) {
  const canvas = layer.slotThumbCanvas;
  const v = layer.video;
  if (!canvas || !v || !layer.ready) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const vw = v.videoWidth || 0;
  const vh = v.videoHeight || 0;
  if (!vw || !vh) {
    drawLayerSlotPlaceholder(ctx, SLOT_THUMB_BITMAP_W, SLOT_THUMB_BITMAP_H);
    return;
  }
  ctx.fillStyle = "#16161a";
  ctx.fillRect(0, 0, SLOT_THUMB_BITMAP_W, SLOT_THUMB_BITMAP_H);
  drawMediaContain(ctx, v, SLOT_THUMB_BITMAP_W, SLOT_THUMB_BITMAP_H);
}

function queueSlotThumbPaint(layer) {
  const paint = () => refreshLayerSlotThumb(layer);
  requestAnimationFrame(() => {
    requestAnimationFrame(paint);
  });
  if (layer.video && layer.slotThumbCanvas) {
    const v = layer.video;
    v.addEventListener("loadeddata", paint, { once: true });
    v.addEventListener("canplay", paint, { once: true });
    v.addEventListener("seeked", paint, { once: true });
    if (typeof v.requestVideoFrameCallback === "function") {
      try {
        v.requestVideoFrameCallback(() => paint());
      } catch {
        /* ignore */
      }
    }
  }
}

function refreshAllLayerSlotThumbs() {
  for (const layer of state.layers) {
    if (layer.file && layer.ready && layer.slotThumbCanvas) {
      refreshLayerSlotThumb(layer);
    }
  }
}

function applyPreviewBackdrop(ctx, cw, ch) {
  const b = state.output.backdrop;
  if (b === "black") {
    ctx.fillStyle = "#000000";
    ctx.globalCompositeOperation = "source-over";
    ctx.fillRect(0, 0, cw, ch);
    return;
  }
  if (b === "white") {
    ctx.fillStyle = "#ffffff";
    ctx.globalCompositeOperation = "source-over";
    ctx.fillRect(0, 0, cw, ch);
    return;
  }
  ctx.clearRect(0, 0, cw, ch);
}

function syncPreviewBackdropChrome() {
  if (!elements.previewCanvasWrap) {
    return;
  }
  elements.previewCanvasWrap.classList.toggle(
    "preview-canvas-wrap--checker",
    state.output.backdrop === "transparent",
  );
}

function drawPreview(transportSeconds) {
  const cw = elements.previewCanvas.width;
  const ch = elements.previewCanvas.height;
  const scratchCtx = ensureLayerScratch(cw, ch);
  const bpm = state.playback.bpm || DEFAULT_BPM;
  const modulationRoutes = state.controls?.modulation ?? [];

  applyPreviewBackdrop(previewContext, cw, ch);

  let hasVisual = false;
  for (const layer of state.layers) {
    if (!layer.file || !layer.ready) {
      continue;
    }

    scratchCtx.globalCompositeOperation = "source-over";
    scratchCtx.globalAlpha = 1;
    scratchCtx.clearRect(0, 0, cw, ch);
    drawMediaContain(scratchCtx, layer.video, cw, ch);

    const opacity = resolveModulatedLayerOpacity(layer, transportSeconds, bpm, modulationRoutes);

    previewContext.globalCompositeOperation =
      layer.blendMode === "normal" ? "source-over" : layer.blendMode;
    previewContext.globalAlpha = opacity;
    previewContext.drawImage(layerScratchCanvas, 0, 0);
    previewContext.globalAlpha = 1;
    hasVisual = true;
  }

  previewContext.globalCompositeOperation = "source-over";
  elements.previewStatus.classList.toggle("hidden", hasVisual);
}

function updateAudioMeter() {
  if (!state.analyserNode) {
    elements.meterBar.style.width = "0%";
    return;
  }

  const data = new Uint8Array(state.analyserNode.frequencyBinCount);
  state.analyserNode.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  elements.meterBar.style.width = `${Math.min(100, (average / 255) * 100)}%`;

  updateRealtimeBpmFromLive();
}

function renderLoop() {
  const transportSeconds = getTransportSeconds();
  syncLayerVideos(transportSeconds);
  applyAutoDemo(transportSeconds);
  drawPreview(transportSeconds);
  updateAudioMeter();
  updateFileBpmFromSegments();
  updateTransportDisplays(transportSeconds);
  state.animationFrameId = requestAnimationFrame(renderLoop);
}

async function startPlayback() {
  if (state.playback.isPlaying) {
    return;
  }

  const hasVideo = state.layers.some((layer) => layer.file);
  if (!hasVideo) {
    setStatus("Load at least one video layer before playing.", { error: true });
    return;
  }

  stopIdleLiveMeter();
  await resumeAudioContext();
  if (!state.liveInput.active) {
    connectFileSources();
  }
  applyPlaybackRates();
  syncLayerVideos(state.playback.startOffsetSeconds);

  for (const layer of state.layers) {
    if (!layer.file || !layer.ready) {
      continue;
    }
    try {
      await layer.video.play();
    } catch (error) {
      console.warn(error);
    }
  }

  state.playback.isPlaying = true;
  state.playback.startedAtMs = performance.now();

  if (state.audio.file) {
    state.playback.usingAudioClock = true;
    elements.audioElement.currentTime = state.playback.startOffsetSeconds;
    await elements.audioElement.play();
  } else {
    state.playback.usingAudioClock = false;
  }

  cancelAnimationFrame(state.animationFrameId);
  renderLoop();
  setStatus("Realtime playback running on the browser canvas.");
}

function pausePlayback() {
  if (!state.playback.isPlaying) {
    return;
  }

  state.playback.startOffsetSeconds = getTransportSeconds();
  state.playback.isPlaying = false;
  cancelAnimationFrame(state.animationFrameId);
  state.animationFrameId = null;

  for (const layer of state.layers) {
    if (layer.file) {
      layer.video.pause();
    }
  }

  elements.audioElement.pause();
  updateTransportDisplays(state.playback.startOffsetSeconds);
  if (state.liveInput.active) {
    startIdleLiveMeter();
  }
  setStatus("Playback paused.");
  refreshAllLayerSlotThumbs();
}

function resetTransport() {
  state.playback.startOffsetSeconds = 0;
  elements.audioElement.currentTime = 0;
  updateTransportDisplays(0);
  syncLayerVideos(0);
  drawPreview(0);
  refreshAllLayerSlotThumbs();
}

function clearLayer(id) {
  const layer = state.layers[id - 1];
  if (layer.objectUrl) {
    URL.revokeObjectURL(layer.objectUrl);
  }
  layer.file = null;
  layer.objectUrl = "";
  layer.duration = 0;
  layer.ready = false;
  layer.barsPerLoop = 1;
  layer.barsPerLoopLocked = false;
  layer.opacity = 1;
  layer.slotThumbCanvas = null;
  layer.video.removeAttribute("src");
  layer.video.load();
  renderLayers();
  drawPreview(getTransportSeconds());
  updateTransportDisplays(getTransportSeconds());
}

function renderLayers() {
  elements.layersGrid.innerHTML = "";

  for (const layer of state.layers) {
    const card = document.createElement("section");
    card.className = "panel layer-card";

    const header = document.createElement("div");
    header.className = "layer-header";
    header.innerHTML = `<strong>Layer ${layer.id}</strong><span class="muted">${layer.file ? layer.file.name : "Empty"}</span>`;

    const slot = document.createElement("label");
    slot.className = "layer-slot";
    slot.setAttribute("data-layer-id", String(layer.id));

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "video/*";
    fileInput.className = "hidden";
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

    slot.appendChild(fileInput);

    if (layer.file) {
      mountLayerVideoInStaging(layer);
      layer.video.controls = false;
      layer.video.playsInline = true;

      const thumb = document.createElement("canvas");
      thumb.className = "layer-slot-thumb";
      thumb.width = SLOT_THUMB_BITMAP_W;
      thumb.height = SLOT_THUMB_BITMAP_H;
      layer.slotThumbCanvas = thumb;
      const tctx = thumb.getContext("2d");
      if (tctx) {
        drawLayerSlotPlaceholder(tctx, SLOT_THUMB_BITMAP_W, SLOT_THUMB_BITMAP_H);
      }
      slot.appendChild(thumb);
      queueSlotThumbPaint(layer);

      const meta = document.createElement("div");
      meta.className = "layer-slot-meta";
      const bp = normalizeBarsPerLoop(layer.barsPerLoop);
      meta.textContent = `${layer.duration.toFixed(2)}s · ${bp === 1 ? "1-bar" : `${bp}-bar`} loop`;
      slot.appendChild(meta);
    } else {
      const empty = document.createElement("div");
      empty.className = "layer-slot-empty";
      empty.textContent = `Drop or pick a video for layer ${layer.id}`;
      slot.appendChild(empty);
    }

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

    const controls = document.createElement("div");
    controls.className = "layer-actions";

    const rowBlend = document.createElement("div");
    rowBlend.className = "layer-actions-row";
    const blendSelect = document.createElement("select");
    blendSelect.className = "select";
    blendSelect.setAttribute("data-blend-layer", String(layer.id));
    blendSelect.innerHTML = SUPPORTED_BLEND_MODES.map(
      (mode) => `<option value="${mode}">${mode}</option>`,
    ).join("");
    blendSelect.value = layer.blendMode;
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "button button-danger";
    clearBtn.textContent = "Clear";
    rowBlend.appendChild(blendSelect);
    rowBlend.appendChild(clearBtn);

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
    };
    opacityRange.addEventListener("input", syncOpacity);
    rowOpacity.appendChild(opacityLabel);
    rowOpacity.appendChild(opacityRange);
    rowOpacity.appendChild(opacityValue);

    controls.appendChild(rowBlend);
    controls.appendChild(rowBars);
    controls.appendChild(rowOpacity);

    card.appendChild(header);
    card.appendChild(slot);
    card.appendChild(controls);
    elements.layersGrid.appendChild(card);

    blendSelect.addEventListener("change", (event) => {
      layer.blendMode = event.target.value;
      drawPreview(getTransportSeconds());
    });

    clearBtn.addEventListener("click", () => clearLayer(layer.id));
  }
}

/**
 * @param {number} id
 * @param {File} file
 * @param {{ devAutoloadBatch?: boolean }} [options]
 */
async function loadVideoLayer(id, file, options = {}) {
  const { devAutoloadBatch = false } = options;
  const layer = state.layers[id - 1];
  if (layer.objectUrl) {
    URL.revokeObjectURL(layer.objectUrl);
  }

  const firstUrl = URL.createObjectURL(file);
  layer.file = file;
  layer.objectUrl = firstUrl;
  layer.ready = false;
  layer.video = document.createElement("video");
  layer.video.muted = true;
  layer.video.loop = true;
  layer.video.playsInline = true;
  layer.video.preload = "metadata";

  ensureVideoLoadStaging().appendChild(layer.video);

  let previewViaTranscode = false;

  const failCleanup = (urlToRevoke) => {
    URL.revokeObjectURL(urlToRevoke);
    layer.file = null;
    layer.objectUrl = "";
    layer.duration = 0;
    layer.ready = false;
    layer.barsPerLoop = 1;
    layer.barsPerLoopLocked = false;
    if (layer.video.parentNode) {
      layer.video.remove();
    }
    layer.video = document.createElement("video");
  };

  try {
    await loadVideoElementFromUrl(layer.video, firstUrl);
  } catch (error) {
    const code = layer.video.error?.code;
    const canTryServer =
      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
      code === MediaError.MEDIA_ERR_DECODE;

    if (canTryServer) {
      try {
        setStatus(`Transcoding ${file.name} for browser preview (FFmpeg)…`);
        const blob = await transcodeVideoForPreview(file);
        URL.revokeObjectURL(firstUrl);
        const fallbackUrl = URL.createObjectURL(blob);
        layer.objectUrl = fallbackUrl;
        await loadVideoElementFromUrl(layer.video, fallbackUrl);
        previewViaTranscode = true;
      } catch (e2) {
        failCleanup(layer.objectUrl);
        const message = e2 instanceof Error ? e2.message : String(e2);
        setStatus(`${file.name}: preview transcode failed — ${message}`, { error: true });
        renderLayers();
        drawPreview(getTransportSeconds());
        updateTransportDisplays(getTransportSeconds());
        throw e2;
      }
    } else {
      failCleanup(firstUrl);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`${file.name}: ${message}`, { error: true });
      renderLayers();
      drawPreview(getTransportSeconds());
      updateTransportDisplays(getTransportSeconds());
      throw error;
    }
  }

  layer.duration = layer.video.duration || 0;
  layer.ready = true;
  const bpmForInfer = Number(elements.manualBpm.value) || state.playback.bpm || DEFAULT_BPM;
  const barSecForInfer = barDurationSeconds(bpmForInfer, state.playback.beatsPerBar);
  layer.barsPerLoop = inferBarsPerLoopFromDuration(layer.duration, barSecForInfer);
  layer.barsPerLoopLocked = false;
  applyPlaybackRates();

  renderLayers();
  syncLayerVideos(getTransportSeconds());
  drawPreview(getTransportSeconds());
  updateTransportDisplays(getTransportSeconds());
  if (!devAutoloadBatch) {
    setStatus(
      previewViaTranscode
        ? `Loaded ${file.name} into layer ${id} (browser preview via server transcode; export still uses the original file).`
        : `Loaded ${file.name} into layer ${id}.`,
    );
  }

  if (!state.playback.isPlaying) {
    try {
      layer.video.pause();
    } catch {
      /* ignore */
    }
  } else {
    try {
      await layer.video.play();
    } catch (e) {
      console.warn(e);
    }
  }
}

function getResolutionKeyForExport() {
  const { width, height } = getOutputDimensions(
    state.output.tier,
    state.output.aspect,
  );
  return `${width}x${height}`;
}

function applyOutputCanvasFromState() {
  const tier = state.output.tier;
  const aspect = state.output.aspect;
  const { width, height } = getOutputDimensions(tier, aspect);

  elements.previewCanvas.width = width;
  elements.previewCanvas.height = height;

  if (elements.previewCanvasWrap) {
    elements.previewCanvasWrap.style.setProperty("--canvas-aspect", `${width} / ${height}`);
    elements.previewCanvasWrap.style.setProperty("--canvas-ar-w", String(width));
    elements.previewCanvasWrap.style.setProperty("--canvas-ar-h", String(height));
  }
  if (elements.outputDimensionsLabel) {
    elements.outputDimensionsLabel.textContent = `Canvas: ${width}×${height}`;
  }

  const fixedTier = Boolean(OUTPUT_FIXED_PRESETS[tier]);
  if (elements.outputAspectSelect) {
    elements.outputAspectSelect.disabled = fixedTier;
    elements.outputAspectSelect.classList.toggle("is-disabled", fixedTier);
  }

  if (elements.previewOutputLabel) {
    elements.previewOutputLabel.textContent = `Canvas ${width}×${height}, captureStream()`;
  }

  syncPreviewBackdropChrome();
}

function serializeProjectState() {
  const bpm = Number(elements.manualBpm.value) || DEFAULT_BPM;
  return {
    version: "2.0",
    projectName: elements.projectName.value || "PulseHZ Project",
    createdAt: new Date().toISOString(),
    exportSettings: {
      resolution: getResolutionKeyForExport(),
      frameRate: 60,
      codec: "prores_4444",
      quality: "professional",
      backdrop: state.output.backdrop,
    },
    transport: {
      bpm,
      beatsPerBar: state.playback.beatsPerBar,
      barDurationSeconds: barDurationSeconds(bpm, state.playback.beatsPerBar),
      renderDurationSeconds: state.audio.file ? null : barDurationSeconds(bpm, state.playback.beatsPerBar),
    },
    layers: state.layers.map((layer) => ({
      id: layer.id,
      blendMode: layer.blendMode,
      opacity: typeof layer.opacity === "number" ? layer.opacity : 1,
      hasVideo: Boolean(layer.file),
      sourceName: layer.file ? layer.file.name : null,
      sourceDurationSeconds: layer.file ? layer.duration : null,
      barsPerLoop: normalizeBarsPerLoop(layer.barsPerLoop),
    })),
    controls: structuredClone(state.controls),
  };
}

async function exportHighQuality() {
  const videoFiles = state.layers.filter((layer) => layer.file).map((layer) => layer.file);
  if (!videoFiles.length) {
    setStatus("Add at least one video layer before exporting.", { error: true });
    return;
  }

  const metadata = serializeProjectState();
  const formData = new FormData();
  formData.append("metadata", JSON.stringify(metadata));
  for (const file of videoFiles) {
    formData.append("video_files", file, file.name);
  }
  if (state.audio.file) {
    formData.append("audio_file", state.audio.file, state.audio.file.name);
  }

  setStatus("Uploading media for ProRes render...");
  const response = await fetch(pulsehzApiUrl("/api/export-video"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let detail = "Server export failed";
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch (error) {
      // Ignore JSON parsing errors.
    }
    throw new Error(detail);
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `${metadata.projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}-prores.mov`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
  setStatus("High-quality export finished.");
}

async function createExportStream() {
  const canvasStream = elements.previewCanvas.captureStream(60);
  const combinedStream = new MediaStream([...canvasStream.getVideoTracks()]);
  if (state.exportAudioDestination && (state.audio.file || state.liveInput.active)) {
    for (const track of state.exportAudioDestination.stream.getAudioTracks()) {
      combinedStream.addTrack(track);
    }
  }
  return combinedStream;
}

async function exportWeb() {
  const codec = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  );

  if (!codec) {
    setStatus("This browser cannot record WebM output.", { error: true });
    return;
  }

  const durationSeconds =
    state.audio.file && !state.liveInput.active
      ? Math.max(0.1, elements.audioElement.duration || barDurationSeconds(state.playback.bpm))
      : barDurationSeconds(state.playback.bpm);

  resetTransport();
  await startPlayback();

  const stream = await createExportStream();
  const recorder = new MediaRecorder(stream, {
    mimeType: codec,
    videoBitsPerSecond: 12_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const finished = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  recorder.start();
  setStatus("Recording browser output to WebM...");
  await new Promise((resolve) => window.setTimeout(resolve, durationSeconds * 1000));
  recorder.stop();
  await finished;
  pausePlayback();
  resetTransport();

  const blob = new Blob(chunks, { type: codec });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `${serializeProjectState().projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}-browser.webm`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
  setStatus("Browser capture export finished.");
}

/** ~16s window; same estimator as decoded files (onset envelopes on hop-sized chunks). */
const LIVE_BPM_CAPTURE_SECONDS = 16;

function audioBufferFromMonoFloat32(channelData, sampleRate) {
  const buffer = new AudioBuffer({
    length: channelData.length,
    numberOfChannels: 1,
    sampleRate,
  });
  buffer.copyToChannel(channelData, 0, 0);
  return buffer;
}

/**
 * Tap the live graph with ScriptProcessorNode (deprecated but widely available).
 * Keeps existing connections: only disconnects source→processor in cleanup.
 */
async function detectBpmFromLiveInput() {
  if (!state.liveInput.active || !state.liveStreamSource || !state.audioContext) {
    setStatus("Start live capture first (e.g. loopback from your app).", { error: true });
    return;
  }

  const ctx = state.audioContext;
  const sampleRate = ctx.sampleRate;
  const targetSamples = Math.floor(sampleRate * LIVE_BPM_CAPTURE_SECONDS);
  const accum = new Float32Array(targetSamples);
  let written = 0;

  const bufferSize = 4096;
  let processor = null;
  const mute = ctx.createGain();
  mute.gain.value = 0;

  state.audioAnalysisInFlight = true;
  setStatus(
    `Detecting BPM from live input (~${LIVE_BPM_CAPTURE_SECONDS}s — keep audio playing through this capture)...`,
  );

  try {
    if (!ctx.createScriptProcessor) {
      throw new Error("Live BPM needs ScriptProcessorNode (unsupported in this engine).");
    }

    processor = ctx.createScriptProcessor(bufferSize, 1, 1);
    processor.onaudioprocess = (event) => {
      if (written >= targetSamples) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const take = Math.min(input.length, targetSamples - written);
      accum.set(input.subarray(0, take), written);
      written += take;
    };

    state.liveStreamSource.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);

    const deadline = performance.now() + (LIVE_BPM_CAPTURE_SECONDS + 8) * 1000;
    while (written < targetSamples && state.liveInput.active && performance.now() < deadline) {
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
    }

    const minSamples = Math.floor(sampleRate * 5);
    if (written < minSamples) {
      throw new Error(
        "Not enough live audio captured—keep Live capture on with the signal playing, then try again.",
      );
    }

    const slice = accum.subarray(0, written);
    const audioBuffer = audioBufferFromMonoFloat32(slice, sampleRate);
    const bpm = estimateBpmFromAudioBuffer(audioBuffer);

    state.playback.detectedBpm = bpm;
    commitTransportBpm(bpm, "detect-live");
    setStatus(`Detected BPM from live input: ${bpm.toFixed(1)}`);
  } catch (error) {
    setStatus(`BPM detection failed: ${error.message}`, { error: true });
  } finally {
    state.audioAnalysisInFlight = false;
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch (_) {
        /* ignore */
      }
      try {
        mute.disconnect();
      } catch (_) {
        /* ignore */
      }
      try {
        if (state.liveStreamSource) {
          state.liveStreamSource.disconnect(processor);
        }
      } catch (_) {
        /* ignore */
      }
    }
  }
}

async function detectBpmFromFile() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is unavailable");
  }
  let bpm;
  if (state.audio.bpmSegmentsStatus === "ready" && state.audio.bpmSegments?.length) {
    bpm = medianBpmFromSegments(state.audio.bpmSegments);
  } else {
    const analysisContext = new AudioContextCtor();
    const audioBytes = await state.audio.file.arrayBuffer();
    const audioBuffer = await analysisContext.decodeAudioData(audioBytes.slice(0));
    bpm = estimateBpmFromAudioBuffer(audioBuffer);
    await analysisContext.close();
  }
  state.playback.detectedBpm = bpm;
  commitTransportBpm(bpm, "detect-file");
  setStatus(`Detected BPM: ${bpm.toFixed(1)}`);
}

async function detectBpm() {
  if (state.audioAnalysisInFlight) {
    return;
  }
  if (state.liveInput.active) {
    await detectBpmFromLiveInput();
    return;
  }
  if (!state.audio.file) {
    setStatus("Load an audio file or start live capture (loopback) to detect BPM.", { error: true });
    return;
  }

  state.audioAnalysisInFlight = true;
  setStatus("Analysing audio in the browser...");
  try {
    await detectBpmFromFile();
  } catch (error) {
    setStatus(`BPM detection failed: ${error.message}`, { error: true });
  } finally {
    state.audioAnalysisInFlight = false;
  }
}

function clearAudio() {
  if (state.audio.objectUrl) {
    URL.revokeObjectURL(state.audio.objectUrl);
  }
  state.audio.file = null;
  state.audio.objectUrl = "";
  state.audio.duration = 0;
  state.audio.analysisMono = null;
  state.audio.bpmSegments = null;
  state.audio.bpmSegmentsStatus = "idle";
  fileBpmFollowLastApplyMs = 0;
  elements.audioElement.pause();
  elements.audioElement.removeAttribute("src");
  elements.audioElement.classList.add("hidden");
  state.playback.usingAudioClock = false;
  connectFileSources();
  setStatus("Audio track cleared.");
}

async function loadAudio(file) {
  if (state.audio.objectUrl) {
    URL.revokeObjectURL(state.audio.objectUrl);
  }

  const objectUrl = URL.createObjectURL(file);
  state.audio.file = file;
  state.audio.objectUrl = objectUrl;
  elements.audioElement.src = objectUrl;
  elements.audioElement.classList.remove("hidden");

  await new Promise((resolve, reject) => {
    elements.audioElement.onloadedmetadata = () => {
      state.audio.duration = elements.audioElement.duration || 0;
      resolve();
    };
    elements.audioElement.onerror = () =>
      reject(new Error(`${file.name}: ${describeMediaError(elements.audioElement)}`));
  });

  connectFileSources();
  setStatus(`Loaded audio track ${file.name}.`);
  void runFileBpmAnalysis();
}

function handleManualBpmChange() {
  const bpm = Number(elements.manualBpm.value);
  if (!Number.isFinite(bpm) || bpm <= 0) {
    setStatus("BPM must be a positive number.", { error: true });
    return;
  }
  commitTransportBpm(bpm, "manual-input");
}

function scheduleManualBpmFromInput() {
  if (manualBpmInputTimer !== null) {
    clearTimeout(manualBpmInputTimer);
  }
  manualBpmInputTimer = window.setTimeout(() => {
    manualBpmInputTimer = null;
    handleManualBpmChange();
  }, MANUAL_BPM_INPUT_DEBOUNCE_MS);
}

async function handleHighExportClick() {
  try {
    await exportHighQuality();
  } catch (error) {
    setStatus(error.message, { error: true });
  }
}

async function handleWebExportClick() {
  try {
    await exportWeb();
  } catch (error) {
    setStatus(error.message, { error: true });
  }
}

function syncOutputControlsFromState() {
  if (elements.outputTierSelect) {
    elements.outputTierSelect.value = state.output.tier;
  }
  if (elements.outputAspectSelect) {
    elements.outputAspectSelect.value = state.output.aspect;
  }
  if (elements.outputBackdropSelect && BACKDROP_OPTIONS.includes(state.output.backdrop)) {
    elements.outputBackdropSelect.value = state.output.backdrop;
  }
  applyOutputCanvasFromState();
}

function handleOutputSettingsChange() {
  const tier = elements.outputTierSelect?.value || state.output.tier;
  const aspect = elements.outputAspectSelect?.value || state.output.aspect;
  const backdropRaw = elements.outputBackdropSelect?.value || state.output.backdrop;
  const backdrop = BACKDROP_OPTIONS.includes(/** @type {BackdropKind} */ (backdropRaw))
    ? /** @type {BackdropKind} */ (backdropRaw)
    : state.output.backdrop;
  state.output.tier = tier;
  state.output.aspect = aspect;
  state.output.backdrop = backdrop;
  applyOutputCanvasFromState();
  drawPreview(getTransportSeconds());
}

const DEMO_LFO_ROUTE_ID = "pulsehz-demo-lfo-opacity";

function toggleDemoLfoOpacity() {
  const mod = state.controls.modulation;
  const idx = mod.findIndex((r) => r && r.id === DEMO_LFO_ROUTE_ID);
  if (idx >= 0) {
    mod.splice(idx, 1);
    setStatus("Removed demo LFO route (layer 1 opacity).");
  } else {
    mod.push({
      id: DEMO_LFO_ROUTE_ID,
      enabled: true,
      target: { scope: "layer", layerId: 1, paramId: "opacity" },
      source: {
        kind: "lfo",
        waveform: "sine",
        rateBeats: 1,
        phaseTurns: 0,
        depth: 0.35,
        offset: 0,
      },
      amount: 1,
    });
    setStatus("Demo LFO on layer 1 opacity (one sine cycle per beat). Toggle again to remove.");
  }
  drawPreview(getTransportSeconds());
}

function wireEvents() {
  elements.outputTierSelect?.addEventListener("change", handleOutputSettingsChange);
  elements.outputAspectSelect?.addEventListener("change", handleOutputSettingsChange);
  elements.outputBackdropSelect?.addEventListener("change", handleOutputSettingsChange);
  elements.playButton.addEventListener("click", () => {
    startPlayback().catch((error) => setStatus(error.message, { error: true }));
  });
  elements.pauseButton.addEventListener("click", pausePlayback);
  elements.detectBpmButton.addEventListener("click", detectBpm);
  elements.clearAudioButton.addEventListener("click", clearAudio);
  elements.liveAudioButton?.addEventListener("click", () => {
    toggleLiveAudioInput().catch((error) => setStatus(error.message, { error: true }));
  });
  elements.refreshAudioDevicesButton?.addEventListener("click", () => {
    refreshAudioInputDevices().catch((error) => setStatus(error.message, { error: true }));
  });
  elements.audioDeviceSelect?.addEventListener("change", async () => {
    if (!state.liveInput.active) {
      return;
    }
    stopLiveStreamsOnly();
    try {
      await startLiveAudioInput();
    } catch (error) {
      setStatus(`Live capture failed: ${error.message}`, { error: true });
    }
  });
  elements.manualBpm.addEventListener("input", scheduleManualBpmFromInput);
  elements.manualBpm.addEventListener("change", handleManualBpmChange);
  elements.audioInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (file) {
      await loadAudio(file);
    }
  });
  elements.exportHighButton.addEventListener("click", handleHighExportClick);
  elements.exportWebButton.addEventListener("click", handleWebExportClick);
  elements.demoLfoOpacityButton?.addEventListener("click", toggleDemoLfoOpacity);
  elements.autoDemoGridSelect?.addEventListener("change", handleAutoDemoGridChange);
}

function installTestHarness() {
  if (new URLSearchParams(window.location.search).get("test") !== "1") {
    return;
  }
  window.__PULSEHZ_TEST__ = {
    setMockBpmSegments(segments) {
      state.audio.bpmSegments = segments;
      state.audio.bpmSegmentsStatus = "ready";
    },
    commitBpm(bpm) {
      commitTransportBpm(bpm, "test");
    },
    getTransportBpm() {
      return state.playback.bpm;
    },
  };
}

function initialize() {
  if (elements.autoDemoGridSelect) {
    elements.autoDemoGridSelect.value = state.autoDemo.grid;
  }
  syncOutputControlsFromState();
  renderLayers();
  updateTransportDisplays(0);
  drawPreview(0);
  wireEvents();
  syncLiveAudioButton();
  void refreshAudioInputDevices();
  installTestHarness();
  setStatus("Browser canvas output is ready. Add video layers to begin.");
}

/**
 * Base URL for resolving dev autoload paths (`demo-clips/...`) so it works when the
 * page is `/app` (no trailing slash) — relative URLs must not drop the `/app/` prefix.
 * @returns {URL}
 */
function devAutoloadAppDirectoryBase() {
  const u = new URL(window.location.href);
  let path = u.pathname;
  if (!path.endsWith("/")) {
    const parts = path.split("/").filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : "";
    if (last && last.includes(".")) {
      parts.pop();
    }
    path = `/${parts.join("/")}`;
    if (path !== "/") {
      path = `${path}/`;
    }
  }
  u.pathname = path || "/";
  return u;
}

/**
 * Safe filename for a demo WebM (manifest entries and demo-clips/ children).
 * Rejects path separators, traversal, and odd encodings.
 * @param {string} name
 */
function assertSafeDemoWebmFilename(name) {
  if (typeof name !== "string" || !name || name.length > 200) {
    throw new Error("invalid clip filename");
  }
  if (name !== name.trim() || name.includes("/") || name.includes("\\")) {
    throw new Error("invalid clip filename");
  }
  if (!/^[\w.-]+\.webm$/.test(name)) {
    throw new Error("invalid clip filename");
  }
}

/**
 * Resolve a dev-only autoload path to a same-origin URL + safe filename.
 * Blocks absolute URLs, scheme-relative URLs, traversal, and paths outside
 * `demo-clips/<name>.webm` or `fixture-debug.webm` next to the app.
 * @param {string} rawPath from query string (e.g. `demo-clips/11-mandelbrot.webm`)
 * @returns {{ url: URL, filename: string }}
 */
function resolveAutoloadWebmPath(rawPath) {
  const trimmed = rawPath.trim();
  if (!trimmed.endsWith(".webm")) {
    throw new Error("autoload path must end with .webm");
  }
  if (trimmed.includes("://") || trimmed.startsWith("//")) {
    throw new Error("autoload path must be relative (no URL scheme)");
  }
  const forward = trimmed.replace(/\\/g, "/");
  if (forward.includes("../") || forward.split("/").includes("..")) {
    throw new Error("path traversal is not allowed");
  }
  let decoded;
  try {
    decoded = decodeURIComponent(forward);
  } catch {
    throw new Error("invalid path encoding");
  }
  if (decoded.includes("../") || decoded.split("/").includes("..")) {
    throw new Error("path traversal is not allowed");
  }
  const url = new URL(decoded, devAutoloadAppDirectoryBase());
  if (url.origin !== window.location.origin) {
    throw new Error("cross-origin autoload is not allowed");
  }
  if (url.pathname.includes("/../") || url.pathname.includes("/..")) {
    throw new Error("invalid path");
  }

  const p = url.pathname;
  const demo = /\/demo-clips\/([^/]+)$/.exec(p);
  if (demo) {
    assertSafeDemoWebmFilename(demo[1]);
    return { url, filename: demo[1] };
  }
  if (/\/fixture-debug\.webm$/.test(p)) {
    return { url, filename: "fixture-debug.webm" };
  }
  throw new Error("autoload path must be demo-clips/<name>.webm or fixture-debug.webm");
}

/**
 * Dev-only: load demo WebM clips generated by `scripts/generate-demo-clips.sh`.
 * Query `autoload`:
 * - `1` or `first` — first clip in `demo-clips/manifest.json` → layer 1 (stable for smoke tests).
 * - `random` — random clip from manifest → layer 1.
 * - `all` — first min(4, N) clips → layers 1–4.
 * - `fixture` — legacy single file `fixture-debug.webm` next to the app (optional).
 * - path ending in `.webm` (e.g. `demo-clips/11-mandelbrot.webm`) → layer 1 (same-origin, allowlisted paths only).
 */
async function loadClipFromResolvedUrl(url, filename, layerId, batch = false) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${url}`);
  }
  const blob = await res.blob();
  const file = new File([blob], filename, {
    type: blob.type || "video/webm",
  });
  await loadVideoLayer(layerId, file, { devAutoloadBatch: batch });
}

async function maybeDevAutoload() {
  const q = new URLSearchParams(window.location.search);
  const raw = q.get("autoload");
  if (raw === null || raw === "") {
    return;
  }
  const trimmed = raw.trim();
  const kw = trimmed.toLowerCase();

  try {
    if (trimmed.endsWith(".webm")) {
      const path = trimmed.replace(/^\//, "");
      const { url, filename } = resolveAutoloadWebmPath(path);
      await loadClipFromResolvedUrl(url, filename, 1, false);
      return;
    }

    if (kw === "fixture") {
      const { url, filename } = resolveAutoloadWebmPath("fixture-debug.webm");
      await loadClipFromResolvedUrl(url, filename, 1, false);
      return;
    }

    const manifestUrl = new URL("demo-clips/manifest.json", devAutoloadAppDirectoryBase());
    const manRes = await fetch(manifestUrl);
    if (!manRes.ok) {
      throw new Error(
        `No ${manifestUrl.pathname} (${manRes.status}). Run: bash scripts/generate-demo-clips.sh`,
      );
    }
    const manifest = await manRes.json();
    const clips = Array.isArray(manifest) ? manifest : manifest.clips;
    if (!Array.isArray(clips) || clips.length === 0) {
      throw new Error("demo-clips/manifest.json has no clips");
    }

    if (kw === "1" || kw === "first") {
      assertSafeDemoWebmFilename(clips[0]);
      const { url, filename } = resolveAutoloadWebmPath(`demo-clips/${clips[0]}`);
      await loadClipFromResolvedUrl(url, filename, 1, false);
      return;
    }
    if (kw === "random") {
      const pick = clips[Math.floor(Math.random() * clips.length)];
      assertSafeDemoWebmFilename(pick);
      const { url, filename } = resolveAutoloadWebmPath(`demo-clips/${pick}`);
      await loadClipFromResolvedUrl(url, filename, 1, false);
      return;
    }
    if (kw === "all") {
      const n = Math.min(4, clips.length);
      for (let i = 0; i < n; i++) {
        assertSafeDemoWebmFilename(clips[i]);
        const { url, filename } = resolveAutoloadWebmPath(`demo-clips/${clips[i]}`);
        await loadClipFromResolvedUrl(url, filename, i + 1, true);
      }
      setStatus(`Dev autoload: loaded ${n} demo clips into layers 1–${n}.`);
      return;
    }

    setStatus(
      `Unknown autoload=${trimmed}. Use: 1, first, random, all, fixture, or a path ending in .webm`,
      { error: true },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`Dev autoload failed: ${msg}`, { error: true });
  }
}

window.pulsehzApp = {
  exportHighQuality,
  exportWeb,
  getPreviewStream: () => elements.previewCanvas.captureStream(60),
  getSerializableProjectState: serializeProjectState,
  getControls: () => state.controls,
  toggleDemoLfoOpacity,
};

initialize();
void maybeDevAutoload();
