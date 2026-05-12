import { createEmptyControlsPayload } from "./control-model.js?v=20260412";
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
import { getOutputDimensions, OUTPUT_FIXED_PRESETS } from "./output-dimensions.js";
import {
  idbGetClipBlob,
  persistClipBlobsToIdb,
} from "./clip-cache-idb.js";
import { barDurationSeconds, getTransportSeconds as computeTransportSeconds } from "./transport-math.js";
import {
  drawMediaContain,
  drawLayerSlotPlaceholder,
  drawPreviewFrame,
  syncPreviewBackdropChrome as wirePreviewBackdropChromeToDom,
} from "./preview-compositor.js";
import { createTransportUi } from "./transport-ui.js?v=20260415";
import { createLayerUi } from "./layer-ui.js?v=20260415";
import { maybeDevAutoload, resolveAutoloadWebmPath } from "./dev-autoload.js?v=20260415";

const MAX_LAYERS = 4;

/** Square bitmap for layer slot thumbnails (CSS scales the canvas). */
const SLOT_THUMB_BITMAP_W = 256;
const SLOT_THUMB_BITMAP_H = 256;

/** Manual BPM `input` is debounced so typing does not spam the transport; arrow keys still feel responsive. */
const MANUAL_BPM_INPUT_DEBOUNCE_MS = 120;
let manualBpmInputTimer = null;
/** Throttle commits from file segment map (same ballpark as live estimator). */
let fileBpmFollowLastApplyMs = 0;

/** Debounced automatic BPM so layer sync / composite does not jump on noisy estimates. */
const COMPOSITOR_BPM_DEBOUNCE_MS = 480;
const COMPOSITOR_BPM_MIN_DELTA = 0.45;
let compositorBpmDebounceTimer = null;
/** @type {{ bpm: number, source: string } | null} */
let compositorBpmPending = null;

/** FCP-style: settings + last-known filenames only (no clip/audio blobs in browser storage). */
const AUTOSAVE_LS_KEY = "pulsehz:autosave-v1";
const AUTOSAVE_DEBOUNCE_MS = 650;
let autosaveTimer = null;
/** When true, `scheduleAutosave` no-ops (e.g. during restore). */
let suppressAutosave = false;
/** Skip loopback demo startup once if last autosave had media attached (avoid clobbering empty slots). */
let skipNextDefaultDevAutoload = false;

function tryConsumeDefaultDevAutoloadSkip() {
  if (!skipNextDefaultDevAutoload) {
    return false;
  }
  skipNextDefaultDevAutoload = false;
  return true;
}

function cancelCompositorBpmDebounce() {
  if (compositorBpmDebounceTimer !== null) {
    clearTimeout(compositorBpmDebounceTimer);
    compositorBpmDebounceTimer = null;
  }
  compositorBpmPending = null;
}

function flushCompositorBpmPending() {
  compositorBpmDebounceTimer = null;
  const pending = compositorBpmPending;
  compositorBpmPending = null;
  if (!pending) {
    return;
  }
  commitTransportBpm(pending.bpm, pending.source);
}

/**
 * Queue a BPM change from automatic sources (live estimator, file segment follower).
 * Manual input, detect button, and audio prescan use `commitTransportBpm` directly.
 * @param {number} nextBpm
 * @param {string} source
 */
function requestDebouncedCompositorBpm(nextBpm, source) {
  if (!Number.isFinite(nextBpm) || nextBpm <= 0) {
    return;
  }
  const rounded = Math.round(nextBpm * 10) / 10;
  if (Math.abs(rounded - state.playback.bpm) < COMPOSITOR_BPM_MIN_DELTA) {
    return;
  }
  compositorBpmPending = { bpm: rounded, source };
  if (compositorBpmDebounceTimer !== null) {
    clearTimeout(compositorBpmDebounceTimer);
  }
  compositorBpmDebounceTimer = window.setTimeout(
    flushCompositorBpmPending,
    COMPOSITOR_BPM_DEBOUNCE_MS,
  );
}

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
  cancelCompositorBpmDebounce();
  const previousBpm = state.playback.bpm;
  if (Math.abs(nextBpm - previousBpm) < 1e-6) {
    return;
  }
  state.playback.bpm = nextBpm;
  elements.manualBpm.value = nextBpm.toFixed(1);
  refreshBarsPerLoopFromTempoForAutoLayers();
  applyPlaybackRates();
  transportUi.updateTransportDisplays(getTransportSeconds());
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
  scheduleAutosave();
}

/**
 * Decode loaded file to mono, build sliding-window BPM segments (idle-yielding).
 * Does not block load; runs in background.
 */
/**
 * One-shot decode + quick BPM + segment map for the loaded audio file.
 * @param {{ skipQuickCommit?: boolean }} [opts]
 */
async function runFileBpmAnalysis(opts = {}) {
  if (!state.audio.file) {
    return;
  }
  const { skipQuickCommit = false } = opts;
  state.audio.bpmSegmentsStatus = "building";
  state.audio.bpmSegments = null;
  state.audio.analysisMono = null;
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextCtor();
    const bytes = await state.audio.file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    await ctx.close();
    if (!skipQuickCommit) {
      const quick = estimateBpmFromAudioBuffer(decoded);
      state.playback.detectedBpm = quick;
      commitTransportBpm(normalizeBpm(quick), "audio-file-quick-bpm");
    }
    const mono = downmixToMonoBuffer(decoded);
    state.audio.analysisMono = mono;
    const segments = await buildBpmSegmentsAsync(mono, {
      windowSec: 12,
      hopSec: 6,
      maxSeconds: 600,
    });
    state.audio.bpmSegments = segments;
    state.audio.bpmSegmentsStatus = "ready";
    if (segments?.length) {
      const med = medianBpmFromSegments(segments);
      state.playback.detectedBpm = med;
      commitTransportBpm(med, "audio-file-segments");
    }
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
  requestDebouncedCompositorBpm(rounded, "file-segments");
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

  requestDebouncedCompositorBpm(rounded, "live-estimator");
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
    /** True while a clip file is being opened/decoded for this slot. */
    loading: false,
    /** @type {"fit" | "fill"} — letterbox vs center-crop into the output canvas. */
    canvasFit: /** @type {"fit" | "fill"} */ ("fit"),
    /** @type {1 | 2 | 4} */
    barsPerLoop: 1,
    /** If true, "Clip loop" was chosen manually and tempo changes won't re-infer. */
    barsPerLoopLocked: false,
    /**
     * How to restore this slot after reload: same-origin demo path (re-fetch) or IndexedDB user upload.
     * @type {{ kind: "demo"; path: string } | { kind: "idb"; name: string; mime: string } | null}
     */
    clipPersist: null,
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
    /** @type {"idle" | "running"} */
    prescanStatus: "idle",
    /** Cached file identity for autosave (blob in IndexedDB). */
    /** @type {{ kind: "idb"; name: string; mime: string } | null} */
    persist: null,
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
  meterBarPreview: document.getElementById("meter-bar-preview"),
  transportProgressBar: document.getElementById("transport-progress-bar"),
  audioPrescanHint: document.getElementById("audio-prescan-hint"),
  metroVisualToggle: document.getElementById("metro-visual-toggle"),
  metroClickToggle: document.getElementById("metro-click-toggle"),
  transportBeatRing: document.getElementById("transport-beat-ring"),
  transportBeatRingProgress: document.getElementById("transport-beat-ring-progress"),
  transportBeatRingTicks: document.getElementById("transport-beat-ring-ticks"),
  previewDetectedBpm: document.getElementById("preview-detected-bpm"),
  previewBarDuration: document.getElementById("preview-bar-duration"),
  previewBpmMapStatus: document.getElementById("preview-bpm-map-status"),
  transportGridAnnounce: document.getElementById("transport-grid-announce"),
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

function getTransportSeconds() {
  return computeTransportSeconds(state.playback, elements.audioElement);
}

function setStatus(message, { error = false } = {}) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle("is-error", error);
  console.log(`PulseHZ: ${message}`);
}

/**
 * @param {string} name
 * @param {number} max
 */
function truncateMiddleEllipsis(name, max) {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max - 1)}…`;
}

const transportUi = createTransportUi({
  getState: () => state,
  getElements: () => elements,
  maxLayers: MAX_LAYERS,
  getOutputDimensions,
  truncateMiddleEllipsis,
});

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
  scheduleAutosave();
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

/** Keep decode `<video>` under the off-screen staging host (not in layer cards). */
function mountLayerVideoInStaging(layer) {
  const host = ensureVideoLoadStaging();
  if (layer.video.parentNode !== host) {
    host.appendChild(layer.video);
  }
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

function syncPreviewBackdropChrome() {
  wirePreviewBackdropChromeToDom(
    elements.previewCanvasWrap,
    state.output.backdrop === "transparent",
  );
}

function drawPreview(transportSeconds) {
  drawPreviewFrame({
    previewContext,
    previewCanvas: elements.previewCanvas,
    previewStatusEl: elements.previewStatus,
    layers: state.layers,
    backdrop: state.output.backdrop,
    transportSeconds,
    bpm: state.playback.bpm,
    modulationRoutes: state.controls?.modulation ?? [],
  });
}

function updateAudioMeter() {
  if (!state.analyserNode) {
    elements.meterBar.style.width = "0%";
    if (elements.meterBarPreview) {
      elements.meterBarPreview.style.width = "0%";
    }
    return;
  }

  const data = new Uint8Array(state.analyserNode.frequencyBinCount);
  state.analyserNode.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  const pct = `${Math.min(100, (average / 255) * 100)}%`;
  elements.meterBar.style.width = pct;
  if (elements.meterBarPreview) {
    elements.meterBarPreview.style.width = pct;
  }

  updateRealtimeBpmFromLive();
}

function renderLoop() {
  const transportSeconds = getTransportSeconds();
  syncLayerVideos(transportSeconds);
  applyAutoDemo(transportSeconds);
  drawPreview(transportSeconds);
  updateAudioMeter();
  updateFileBpmFromSegments();
  transportUi.updateTransportDisplays(transportSeconds);
  transportUi.tickMetronomeUi(transportSeconds);
  layerUi.updateLayerClipRings(transportSeconds);
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
  lastAnnouncedTransportBeat = null;

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
  transportUi.updateTransportDisplays(state.playback.startOffsetSeconds);
  layerUi.updateLayerClipRings(state.playback.startOffsetSeconds);
  if (state.liveInput.active) {
    startIdleLiveMeter();
  }
  setStatus("Playback paused.");
  refreshAllLayerSlotThumbs();
}

function resetTransport() {
  state.playback.startOffsetSeconds = 0;
  elements.audioElement.currentTime = 0;
  transportUi.updateTransportDisplays(0);
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
  layer.loading = false;
  layer.barsPerLoop = 1;
  layer.barsPerLoopLocked = false;
  layer.opacity = 1;
  layer.canvasFit = "fit";
  layer.slotThumbCanvas = null;
  layer.video.removeAttribute("src");
  layer.video.load();
  layer.clipPersist = null;
  renderLayers();
  drawPreview(getTransportSeconds());
  transportUi.updateTransportDisplays(getTransportSeconds());
  scheduleAutosave();
}

/**
 * @param {number} id
 * @param {File} file
 * @param {{
 *   devAutoloadBatch?: boolean;
 *   clipPersist?: { kind: "demo"; path: string } | { kind: "idb"; name: string; mime: string } | null;
 * }} [options]
 */
async function loadVideoLayer(id, file, options = {}) {
  const { devAutoloadBatch = false, clipPersist: clipPersistOption } = options;
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
  layer.loading = true;
  renderLayers();

  let previewViaTranscode = false;

  const failCleanup = (urlToRevoke) => {
    URL.revokeObjectURL(urlToRevoke);
    layer.file = null;
    layer.objectUrl = "";
    layer.duration = 0;
    layer.ready = false;
    layer.loading = false;
    layer.barsPerLoop = 1;
    layer.barsPerLoopLocked = false;
    layer.canvasFit = "fit";
    if (layer.video.parentNode) {
      layer.video.remove();
    }
    layer.video = document.createElement("video");
    layer.clipPersist = null;
    scheduleAutosave();
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
        transportUi.updateTransportDisplays(getTransportSeconds());
        throw e2;
      }
    } else {
      failCleanup(firstUrl);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`${file.name}: ${message}`, { error: true });
      renderLayers();
      drawPreview(getTransportSeconds());
      transportUi.updateTransportDisplays(getTransportSeconds());
      throw error;
    }
  }

  layer.duration = layer.video.duration || 0;
  layer.ready = true;
  layer.loading = false;
  const bpmForInfer = Number(elements.manualBpm.value) || state.playback.bpm || DEFAULT_BPM;
  const barSecForInfer = barDurationSeconds(bpmForInfer, state.playback.beatsPerBar);
  layer.barsPerLoop = inferBarsPerLoopFromDuration(layer.duration, barSecForInfer);
  layer.barsPerLoopLocked = false;
  applyPlaybackRates();

  renderLayers();
  syncLayerVideos(getTransportSeconds());
  drawPreview(getTransportSeconds());
  transportUi.updateTransportDisplays(getTransportSeconds());
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
  if (clipPersistOption === undefined) {
    layer.clipPersist = {
      kind: "idb",
      name: file.name,
      mime: file.type || "application/octet-stream",
    };
  } else {
    layer.clipPersist = clipPersistOption;
  }
  scheduleAutosave();
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
      canvasFit: layer.canvasFit === "fill" ? "fill" : "fit",
    })),
    controls: structuredClone(state.controls),
  };
}

const VALID_AUTOSAVE_OUTPUT_TIERS = new Set([
  "720p",
  "1080p",
  "2160p",
  "720x1720",
  "1440x3440",
]);
const VALID_AUTOSAVE_OUTPUT_ASPECTS = new Set(["16:9", "9:16", "21:9", "9:21", "1:1"]);

/**
 * @param {unknown} value
 * @returns {number}
 */
function coerceRestoredBeatsPerBar(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 4;
  }
  const i = Math.floor(n);
  if (i < 2) {
    return 2;
  }
  if (i > 12) {
    return 12;
  }
  return i;
}

function buildAutosaveSnapshot() {
  const bpm = Number(elements.manualBpm.value) || DEFAULT_BPM;
  return {
    kind: "pulsehz-autosave",
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    hadMediaAtLastSave:
      state.layers.some((layer) => layer.file) || Boolean(state.audio.file),
    projectName: elements.projectName.value || "PulseHZ Project",
    output: {
      tier: state.output.tier,
      aspect: state.output.aspect,
      backdrop: state.output.backdrop,
    },
    transport: {
      bpm,
      beatsPerBar: state.playback.beatsPerBar,
    },
    layers: state.layers.map((layer) => ({
      id: layer.id,
      blendMode: layer.blendMode,
      opacity: typeof layer.opacity === "number" ? layer.opacity : 1,
      hasVideo: Boolean(layer.file),
      sourceName: layer.file ? layer.file.name : null,
      barsPerLoop: normalizeBarsPerLoop(layer.barsPerLoop),
      barsPerLoopLocked: Boolean(layer.barsPerLoopLocked),
      canvasFit: layer.canvasFit === "fill" ? "fill" : "fit",
      clipPersist: layer.file ? layer.clipPersist : null,
    })),
    audioSourceName: state.audio.file ? state.audio.file.name : null,
    audioPersist: state.audio.file ? state.audio.persist : null,
    controls: structuredClone(state.controls),
    autoDemo: { grid: state.autoDemo.grid },
    ui: {
      metroVisual: Boolean(elements.metroVisualToggle?.checked),
      metroClick: Boolean(elements.metroClickToggle?.checked),
    },
  };
}

async function flushAutosaveToDisk() {
  if (suppressAutosave) {
    return;
  }
  try {
    const snap = buildAutosaveSnapshot();
    localStorage.setItem(AUTOSAVE_LS_KEY, JSON.stringify(snap));
    await persistClipBlobsToIdb(state, MAX_LAYERS);
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? /** @type {{ name?: string }} */ (err).name : "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      console.warn("PulseHZ: autosave skipped (storage full).");
    } else {
      console.warn("PulseHZ: autosave failed", err);
    }
  }
}

function scheduleAutosave() {
  if (suppressAutosave) {
    return;
  }
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer);
  }
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    void flushAutosaveToDisk();
  }, AUTOSAVE_DEBOUNCE_MS);
}

const layerUi = createLayerUi({
  getState: () => state,
  getElements: () => elements,
  slotThumbBitmapW: SLOT_THUMB_BITMAP_W,
  slotThumbBitmapH: SLOT_THUMB_BITMAP_H,
  supportedBlendModes: SUPPORTED_BLEND_MODES,
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
});

function renderLayers() {
  layerUi.renderLayers();
}

/**
 * @param {unknown} blendMode
 * @returns {string}
 */
function coerceRestoredBlendMode(blendMode) {
  if (typeof blendMode === "string" && SUPPORTED_BLEND_MODES.includes(blendMode)) {
    return blendMode;
  }
  return "normal";
}

/**
 * @param {unknown} transport
 */
function applyRestoredPlaybackFromSnapshot(transport) {
  const rawBpm = transport && typeof transport === "object" ? Number(transport.bpm) : Number.NaN;
  const bpm = Number.isFinite(rawBpm) && rawBpm > 0 ? rawBpm : DEFAULT_BPM;
  const rounded = Math.round(bpm * 10) / 10;
  state.playback.bpm = rounded;
  elements.manualBpm.value = rounded.toFixed(1);
  state.playback.beatsPerBar = coerceRestoredBeatsPerBar(
    transport && typeof transport === "object" ? transport.beatsPerBar : 4,
  );
  refreshBarsPerLoopFromTempoForAutoLayers();
  applyPlaybackRates();
}

/**
 * @param {{ layers: Record<string, unknown>[]; audioPersist?: unknown }} snap
 * @returns {Promise<boolean>} false if any expected IndexedDB blob was missing or a load failed
 */
async function restoreClipsFromSnapshot(snap) {
  const rows = snap.layers;
  let ok = true;
  const batch = true;
  for (let i = 0; i < MAX_LAYERS; i += 1) {
    const id = i + 1;
    const row = rows[i];
    const cp = row && typeof row === "object" ? row.clipPersist : null;
    if (!cp || typeof cp !== "object") {
      continue;
    }
    if (cp.kind === "demo" && typeof cp.path === "string") {
      try {
        const { url, filename } = resolveAutoloadWebmPath(cp.path.trim());
        await loadClipFromResolvedUrl(url, filename, id, batch, cp.path.trim());
      } catch (e) {
        ok = false;
        console.warn(`PulseHZ: could not restore demo clip L${id}`, e);
      }
    } else if (cp.kind === "idb") {
      const blob = await idbGetClipBlob(`layer-${id}`);
      if (!blob) {
        ok = false;
        continue;
      }
      const name = typeof cp.name === "string" && cp.name ? cp.name : `layer-${id}.bin`;
      const mime = typeof cp.mime === "string" ? cp.mime : "application/octet-stream";
      const file = new File([blob], name, { type: mime });
      try {
        await loadVideoLayer(id, file, {
          devAutoloadBatch: batch,
          clipPersist: { kind: "idb", name, mime },
        });
      } catch (e) {
        ok = false;
        console.warn(`PulseHZ: could not restore cached clip L${id}`, e);
      }
    }
  }
  const ap = snap.audioPersist;
  if (ap && typeof ap === "object" && ap.kind === "idb") {
    const blob = await idbGetClipBlob("audio");
    if (!blob) {
      ok = false;
    } else {
      const name = typeof ap.name === "string" && ap.name ? ap.name : "audio";
      const mime = typeof ap.mime === "string" ? ap.mime : "application/octet-stream";
      const file = new File([blob], name, { type: mime });
      try {
        await loadAudio(file);
      } catch (e) {
        ok = false;
        console.warn("PulseHZ: could not restore cached audio", e);
      }
    }
  }
  return ok;
}

/**
 * Reapply saved settings from localStorage; v2 also reloads clips from IndexedDB or same-origin demo paths.
 * @returns {Promise<boolean>}
 */
async function tryRestoreAutosaveAsync() {
  let raw = null;
  try {
    raw = localStorage.getItem(AUTOSAVE_LS_KEY);
  } catch {
    return false;
  }
  if (!raw) {
    return false;
  }

  /** @type {unknown} */
  let snap;
  try {
    snap = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!snap || typeof snap !== "object" || /** @type {{ kind?: string }} */ (snap).kind !== "pulsehz-autosave") {
    return false;
  }
  const verRaw = /** @type {{ schemaVersion?: unknown }} */ (snap).schemaVersion;
  const ver = typeof verRaw === "number" && Number.isFinite(verRaw) ? verRaw : 1;
  if (ver !== 1 && ver !== 2) {
    return false;
  }
  if (!Array.isArray(/** @type {{ layers?: unknown }} */ (snap).layers)) {
    return false;
  }
  if (/** @type {{ layers: unknown[] }} */ (snap).layers.length !== MAX_LAYERS) {
    return false;
  }

  suppressAutosave = true;
  try {
    skipNextDefaultDevAutoload = Boolean(/** @type {{ hadMediaAtLastSave?: boolean }} */ (snap).hadMediaAtLastSave);

    if (elements.projectName && typeof /** @type {{ projectName?: unknown }} */ (snap).projectName === "string") {
      elements.projectName.value = /** @type {{ projectName: string }} */ (snap).projectName;
    }

    const out = /** @type {{ output?: Record<string, unknown> }} */ (snap).output;
    if (out && typeof out === "object") {
      const tier = out.tier;
      if (typeof tier === "string" && VALID_AUTOSAVE_OUTPUT_TIERS.has(tier)) {
        state.output.tier = tier;
      }
      const aspect = out.aspect;
      if (typeof aspect === "string" && VALID_AUTOSAVE_OUTPUT_ASPECTS.has(aspect)) {
        state.output.aspect = aspect;
      }
      if (BACKDROP_OPTIONS.includes(/** @type {BackdropKind} */ (out.backdrop))) {
        state.output.backdrop = /** @type {BackdropKind} */ (out.backdrop);
      }
    }
    syncOutputControlsFromState();
    applyOutputCanvasFromState();
    drawPreview(getTransportSeconds());

    applyRestoredPlaybackFromSnapshot(/** @type {{ transport?: unknown }} */ (snap).transport);

    const ctrl = /** @type {{ controls?: unknown }} */ (snap).controls;
    if (
      ctrl &&
      typeof ctrl === "object" &&
      typeof /** @type {{ schemaVersion?: unknown }} */ (ctrl).schemaVersion === "number"
    ) {
      state.controls = structuredClone(/** @type {typeof state.controls} */ (ctrl));
    } else {
      state.controls = createEmptyControlsPayload();
    }

    const ad = /** @type {{ autoDemo?: { grid?: string } }} */ (snap).autoDemo;
    if (ad && typeof ad === "object" && typeof ad.grid === "string") {
      const g = ad.grid;
      state.autoDemo.grid = ["off", "beat", "bar", "both"].includes(g) ? /** @type {typeof state.autoDemo.grid} */ (g) : "off";
    }
    if (elements.autoDemoGridSelect) {
      elements.autoDemoGridSelect.value = state.autoDemo.grid;
    }
    state.autoDemo._lastBar = null;
    state.autoDemo._lastBeat = null;

    const ui = /** @type {{ ui?: { metroVisual?: unknown; metroClick?: unknown } }} */ (snap).ui;
    if (ui && typeof ui === "object") {
      if (elements.metroVisualToggle) {
        elements.metroVisualToggle.checked = Boolean(ui.metroVisual);
      }
      if (elements.metroClickToggle) {
        elements.metroClickToggle.checked = Boolean(ui.metroClick);
      }
    }

    const layerRows = /** @type {{ layers: Record<string, unknown>[] }} */ (snap).layers;
    let clipsOk = true;
    if (ver >= 2) {
      clipsOk = await restoreClipsFromSnapshot(snap);
    }

    for (let i = 0; i < MAX_LAYERS; i += 1) {
      const layer = state.layers[i];
      const row = layerRows[i];
      if (!row || typeof row !== "object") {
        continue;
      }
      layer.blendMode = coerceRestoredBlendMode(row.blendMode);
      const op = Number(row.opacity);
      layer.opacity = Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : 1;
      layer.barsPerLoop = normalizeBarsPerLoop(row.barsPerLoop);
      layer.barsPerLoopLocked = Boolean(row.barsPerLoopLocked);
      layer.canvasFit = row.canvasFit === "fill" ? "fill" : "fit";
    }

    renderLayers();
    transportUi.updateTransportDisplays(getTransportSeconds());
    layerUi.updateLayerClipRings(getTransportSeconds());
    drawPreview(getTransportSeconds());

    const had = Boolean(/** @type {{ hadMediaAtLastSave?: boolean }} */ (snap).hadMediaAtLastSave);
    if (ver >= 2 && had) {
      setStatus(
        clipsOk
          ? "Restored project, cached media (clips/audio), and layout."
          : "Restored project and layout; some clips or audio could not be reloaded from cache.",
      );
    } else {
      const names = [];
      for (let i = 0; i < MAX_LAYERS; i += 1) {
        const row = layerRows[i];
        const nm = row && typeof row === "object" ? row.sourceName : null;
        if (typeof nm === "string" && nm.trim()) {
          names.push(`L${i + 1}: ${nm}`);
        }
      }
      const audioNm = /** @type {{ audioSourceName?: unknown }} */ (snap).audioSourceName;
      if (typeof audioNm === "string" && audioNm.trim()) {
        names.push(`Audio: ${audioNm}`);
      }
      const hint =
        had && names.length > 0
          ? `Restored settings. Re-add files: ${names.join("; ")}.`
          : "Restored saved project settings.";
      setStatus(hint);
    }
    return true;
  } catch (e) {
    console.warn("PulseHZ: autosave restore failed", e);
    skipNextDefaultDevAutoload = false;
    return false;
  } finally {
    suppressAutosave = false;
  }
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

  if (!state.layers.some((layer) => layer.file && layer.ready)) {
    setStatus("Add at least one loaded video layer before WebM export.", { error: true });
    return;
  }

  const durationSeconds =
    state.audio.file && !state.liveInput.active
      ? Math.max(0.1, elements.audioElement.duration || barDurationSeconds(state.playback.bpm))
      : barDurationSeconds(state.playback.bpm);

  // If we only call resetTransport() while already playing, startPlayback() returns immediately
  // (isPlaying guard) and transport/clock state never re-initializes — capture breaks or looks like a no-op.
  pausePlayback();
  resetTransport();
  await startPlayback();

  const stream = await createExportStream();
  /** @type {MediaRecorder | null} */
  let recorder = null;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: codec,
      videoBitsPerSecond: 12_000_000,
    });
  } catch (error) {
    pausePlayback();
    resetTransport();
    throw error;
  }

  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const finished = new Promise((resolve, reject) => {
    recorder.onerror = () => {
      reject(recorder.error || new Error("MediaRecorder failed during WebM export."));
    };
    recorder.onstop = () => resolve();
  });

  try {
    recorder.start(1000);
    const src =
      state.audio.file && !state.liveInput.active
        ? "full audio length"
        : "one bar at current BPM (no audio file)";
    setStatus(
      `Recording WebM — ${durationSeconds.toFixed(1)}s (${src}). Transport runs; download starts when this finishes.`,
    );
    await new Promise((resolve) => window.setTimeout(resolve, durationSeconds * 1000));
    if (recorder.state === "recording") {
      recorder.stop();
    }
    await finished;
  } catch (error) {
    try {
      if (recorder && recorder.state === "recording") {
        recorder.stop();
      }
    } catch {
      /* ignore */
    }
    pausePlayback();
    resetTransport();
    throw error;
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  pausePlayback();
  resetTransport();

  if (!chunks.length) {
    setStatus("WebM export produced no video data (try again or use Export ProRes).", { error: true });
    return;
  }

  const blobMime = codec.includes(";") ? codec.slice(0, codec.indexOf(";")) : codec;
  const blob = new Blob(chunks, { type: blobMime || "video/webm" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `${serializeProjectState().projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}-browser.webm`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
  setStatus("WebM export finished — check your browser downloads for the .webm file.");
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
  state.audio.prescanStatus = "idle";
  state.audio.persist = null;
  if (elements.audioPrescanHint) {
    elements.audioPrescanHint.classList.add("hidden");
    elements.audioPrescanHint.textContent = "";
  }
  fileBpmFollowLastApplyMs = 0;
  elements.audioElement.pause();
  elements.audioElement.removeAttribute("src");
  elements.audioElement.classList.add("hidden");
  state.playback.usingAudioClock = false;
  connectFileSources();
  scheduleAutosave();
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
  state.audio.prescanStatus = "running";
  if (elements.audioPrescanHint) {
    elements.audioPrescanHint.classList.remove("hidden");
    elements.audioPrescanHint.textContent = "Analyzing tempo (may take a couple seconds)…";
  }
  setStatus(`Analyzing ${file.name} for tempo…`);
  try {
    await runFileBpmAnalysis({ skipQuickCommit: false });
  } catch (error) {
    console.warn("PulseHZ: audio prescan failed", error);
  } finally {
    state.audio.prescanStatus = "idle";
    if (elements.audioPrescanHint) {
      elements.audioPrescanHint.classList.add("hidden");
    }
  }
  state.audio.persist = {
    kind: "idb",
    name: file.name,
    mime: file.type || "application/octet-stream",
  };
  setStatus(`Loaded audio track ${file.name}.`);
  scheduleAutosave();
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
  scheduleAutosave();
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
  scheduleAutosave();
}

let clipStripKeyboardInstalled = false;

function isEditableKeyboardTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "OPTION" ||
    target.getAttribute("contenteditable") === "true"
  );
}

function installClipStripKeyboard() {
  if (clipStripKeyboardInstalled) {
    return;
  }
  clipStripKeyboardInstalled = true;
  document.addEventListener("keydown", (ev) => {
    if (isEditableKeyboardTarget(ev.target)) {
      return;
    }
    const key = ev.key;
    if (key === "1" || key === "2" || key === "3" || key === "4") {
      const card = document.querySelector(`.layer-card[data-layer-id="${key}"]`);
      if (card instanceof HTMLElement) {
        card.focus();
        ev.preventDefault();
      }
      return;
    }
    if (key === "f" || key === "F") {
      const card = document.activeElement?.closest?.(".layer-card");
      if (!(card instanceof HTMLElement)) {
        return;
      }
      const id = Number(card.getAttribute("data-layer-id"));
      const layer = state.layers[id - 1];
      if (!layer) {
        return;
      }
      layer.canvasFit = layer.canvasFit === "fill" ? "fit" : "fill";
      renderLayers();
      drawPreview(getTransportSeconds());
      scheduleAutosave();
      document.querySelector(`.layer-card[data-layer-id="${String(id)}"]`)?.focus();
      ev.preventDefault();
      return;
    }
    if (key === "Backspace" || key === "Delete") {
      const card = document.activeElement?.closest?.(".layer-card");
      if (!(card instanceof HTMLElement)) {
        return;
      }
      const id = Number(card.getAttribute("data-layer-id"));
      if (!Number.isFinite(id) || id < 1) {
        return;
      }
      clearLayer(id);
      ev.preventDefault();
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const card = document.activeElement?.closest?.(".layer-card");
      if (!(card instanceof HTMLElement)) {
        return;
      }
      const id = Number(card.getAttribute("data-layer-id"));
      if (!Number.isFinite(id)) {
        return;
      }
      const next = key === "ArrowLeft" ? id - 1 : id + 1;
      if (next < 1 || next > MAX_LAYERS) {
        return;
      }
      const nextCard = document.querySelector(`.layer-card[data-layer-id="${String(next)}"]`);
      if (nextCard instanceof HTMLElement) {
        nextCard.focus();
        ev.preventDefault();
      }
    }
  });
}

function wireEvents() {
  elements.outputTierSelect?.addEventListener("change", handleOutputSettingsChange);
  elements.outputAspectSelect?.addEventListener("change", handleOutputSettingsChange);
  elements.outputBackdropSelect?.addEventListener("change", handleOutputSettingsChange);
  elements.projectName?.addEventListener("input", scheduleAutosave);
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
  elements.metroVisualToggle?.addEventListener("change", scheduleAutosave);
  elements.metroClickToggle?.addEventListener("change", async () => {
    try {
      await resumeAudioContext();
      await transportUi.resumeMetronomeClickContextIfNeeded();
    } catch {
      /* ignore */
    }
    scheduleAutosave();
  });
  installClipStripKeyboard();
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
  transportUi.updateTransportDisplays(0);
  layerUi.updateLayerClipRings(0);
  drawPreview(0);
  wireEvents();
  syncLiveAudioButton();
  void refreshAudioInputDevices();
  installTestHarness();
  setStatus("Browser canvas output is ready. Add video layers to begin.");
}

/**
 * Fetch one demo clip blob and assign it to a layer (dev autoload / startup).
 * @param {string} [demoRelPath] allowlisted relative path (e.g. `demo-clips/foo.webm`) for autosave restore
 */
async function loadClipFromResolvedUrl(url, filename, layerId, batch = false, demoRelPath = "") {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${url}`);
  }
  const blob = await res.blob();
  const file = new File([blob], filename, {
    type: blob.type || "video/webm",
  });
  const trimmed = typeof demoRelPath === "string" ? demoRelPath.trim() : "";
  /** @type {{ devAutoloadBatch: boolean; clipPersist?: { kind: "demo"; path: string } }} */
  const opts = { devAutoloadBatch: batch };
  if (trimmed) {
    opts.clipPersist = { kind: "demo", path: trimmed };
  }
  await loadVideoLayer(layerId, file, opts);
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
void (async () => {
  await tryRestoreAutosaveAsync();
  await maybeDevAutoload({
    loadClipFromResolvedUrl,
    setStatus,
    tryConsumeDefaultDevAutoloadSkip,
  });
})();
