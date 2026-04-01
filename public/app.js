const MAX_LAYERS = 4;
const DEFAULT_BPM = 120;
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

function barDurationSeconds(bpm, beatsPerBar = 4) {
  return (60 / bpm) * beatsPerBar;
}

function createLayerState(id) {
  return {
    id,
    blendMode: id === 1 ? "normal" : "screen",
    file: null,
    objectUrl: "",
    video: document.createElement("video"),
    duration: 0,
    ready: false,
  };
}

const state = {
  audioContext: null,
  audioSourceNode: null,
  analyserNode: null,
  exportAudioDestination: null,
  animationFrameId: null,
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
  },
};

const elements = {
  projectName: document.getElementById("project-name"),
  audioInput: document.getElementById("audio-input"),
  audioElement: document.getElementById("audio-element"),
  detectBpmButton: document.getElementById("detect-bpm-button"),
  clearAudioButton: document.getElementById("clear-audio-button"),
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
};

const previewContext = elements.previewCanvas.getContext("2d");

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

function ensureAudioGraph() {
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
  state.audioSourceNode = state.audioContext.createMediaElementSource(elements.audioElement);
  state.audioSourceNode.connect(state.analyserNode);
  state.audioSourceNode.connect(state.audioContext.destination);
  state.audioSourceNode.connect(state.exportAudioDestination);
}

async function resumeAudioContext() {
  ensureAudioGraph();
  if (state.audioContext && state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
}

function applyPlaybackRates() {
  const barSeconds = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
  for (const layer of state.layers) {
    if (!layer.file || !layer.duration) {
      continue;
    }
    layer.video.loop = true;
    layer.video.muted = true;
    layer.video.playbackRate = layer.duration / barSeconds;
  }
}

function syncLayerVideos(transportSeconds) {
  const barSeconds = barDurationSeconds(state.playback.bpm, state.playback.beatsPerBar);
  const phase = barSeconds > 0 ? transportSeconds % barSeconds : 0;

  for (const layer of state.layers) {
    if (!layer.file || !layer.duration || !layer.ready) {
      continue;
    }

    const desiredTime = ((phase / barSeconds) * layer.duration) % layer.duration;
    const currentTime = Number.isFinite(layer.video.currentTime) ? layer.video.currentTime : 0;
    if (Math.abs(currentTime - desiredTime) > 0.08) {
      layer.video.currentTime = desiredTime;
    }
  }
}

function drawPreview(transportSeconds) {
  previewContext.fillStyle = "#000";
  previewContext.fillRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);

  let hasVisual = false;
  for (const layer of state.layers) {
    if (!layer.file || !layer.ready) {
      continue;
    }
    previewContext.globalCompositeOperation =
      layer.blendMode === "normal" ? "source-over" : layer.blendMode;
    previewContext.drawImage(layer.video, 0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
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
}

function renderLoop() {
  const transportSeconds = getTransportSeconds();
  syncLayerVideos(transportSeconds);
  drawPreview(transportSeconds);
  updateAudioMeter();
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

  await resumeAudioContext();
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
  setStatus("Playback paused.");
}

function resetTransport() {
  state.playback.startOffsetSeconds = 0;
  elements.audioElement.currentTime = 0;
  updateTransportDisplays(0);
  syncLayerVideos(0);
  drawPreview(0);
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
      layer.video.controls = false;
      layer.video.playsInline = true;
      slot.appendChild(layer.video);

      const meta = document.createElement("div");
      meta.className = "layer-slot-meta";
      meta.textContent = `${layer.duration.toFixed(2)}s`;
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
    controls.innerHTML = `
      <select class="select" data-blend-layer="${layer.id}">
        ${SUPPORTED_BLEND_MODES.map((mode) => `<option value="${mode}">${mode}</option>`).join("")}
      </select>
      <button class="button button-danger" type="button" data-clear-layer="${layer.id}">Clear</button>
    `;

    card.appendChild(header);
    card.appendChild(slot);
    card.appendChild(controls);
    elements.layersGrid.appendChild(card);

    const blendSelect = controls.querySelector("select");
    blendSelect.value = layer.blendMode;
    blendSelect.addEventListener("change", (event) => {
      layer.blendMode = event.target.value;
      drawPreview(getTransportSeconds());
    });

    controls.querySelector("button").addEventListener("click", () => clearLayer(layer.id));
  }
}

async function loadVideoLayer(id, file) {
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
  layer.video.preload = "auto";

  ensureVideoLoadStaging().appendChild(layer.video);

  let previewViaTranscode = false;

  const failCleanup = (urlToRevoke) => {
    URL.revokeObjectURL(urlToRevoke);
    layer.file = null;
    layer.objectUrl = "";
    layer.duration = 0;
    layer.ready = false;
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

  renderLayers();
  syncLayerVideos(getTransportSeconds());
  drawPreview(getTransportSeconds());
  updateTransportDisplays(getTransportSeconds());
  setStatus(
    previewViaTranscode
      ? `Loaded ${file.name} into layer ${id} (browser preview via server transcode; export still uses the original file).`
      : `Loaded ${file.name} into layer ${id}.`,
  );
}

function serializeProjectState() {
  const bpm = Number(elements.manualBpm.value) || DEFAULT_BPM;
  return {
    version: "2.0",
    projectName: elements.projectName.value || "PulseHZ Project",
    createdAt: new Date().toISOString(),
    exportSettings: {
      resolution: "1920x1080",
      frameRate: 60,
      codec: "prores_4444",
      quality: "professional",
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
      hasVideo: Boolean(layer.file),
      sourceName: layer.file ? layer.file.name : null,
      sourceDurationSeconds: layer.file ? layer.duration : null,
    })),
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
  if (state.exportAudioDestination && state.audio.file) {
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

  const durationSeconds = state.audio.file
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

function normalizeBpm(bpm) {
  let value = bpm;
  while (value < 70) {
    value *= 2;
  }
  while (value > 180) {
    value /= 2;
  }
  return value;
}

function estimateBpmFromAudioBuffer(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const hopSize = 1024;
  const energies = [];

  for (let offset = 0; offset < channelData.length; offset += hopSize) {
    let sum = 0;
    const end = Math.min(channelData.length, offset + hopSize);
    for (let index = offset; index < end; index += 1) {
      sum += Math.abs(channelData[index]);
    }
    energies.push(sum / (end - offset));
  }

  const sorted = [...energies].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.86)] || 0;
  const peaks = [];
  for (let index = 1; index < energies.length - 1; index += 1) {
    const current = energies[index];
    if (current > threshold && current >= energies[index - 1] && current >= energies[index + 1]) {
      peaks.push(index);
    }
  }

  const counts = new Map();
  for (let index = 0; index < peaks.length; index += 1) {
    for (let lookahead = 1; lookahead <= 8; lookahead += 1) {
      const next = peaks[index + lookahead];
      if (next == null) {
        break;
      }
      const interval = next - peaks[index];
      if (!interval) {
        continue;
      }
      const bpm = normalizeBpm((60 * sampleRate) / (interval * hopSize));
      const rounded = Math.round(bpm * 10) / 10;
      counts.set(rounded, (counts.get(rounded) || 0) + 1);
    }
  }

  let winner = DEFAULT_BPM;
  let winnerCount = -1;
  for (const [bpm, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = bpm;
      winnerCount = count;
    }
  }
  return winner;
}

async function detectBpm() {
  if (!state.audio.file) {
    setStatus("Load an audio track before detecting BPM.", { error: true });
    return;
  }
  if (state.audioAnalysisInFlight) {
    return;
  }

  state.audioAnalysisInFlight = true;
  setStatus("Analysing audio in the browser...");

  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio API is unavailable");
    }
    const analysisContext = new AudioContextCtor();
    const audioBytes = await state.audio.file.arrayBuffer();
    const audioBuffer = await analysisContext.decodeAudioData(audioBytes.slice(0));
    const bpm = estimateBpmFromAudioBuffer(audioBuffer);
    state.playback.detectedBpm = bpm;
    state.playback.bpm = bpm;
    elements.manualBpm.value = bpm.toFixed(1);
    updateTransportDisplays(getTransportSeconds());
    applyPlaybackRates();
    setStatus(`Detected BPM: ${bpm.toFixed(1)}`);
    await analysisContext.close();
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
  elements.audioElement.pause();
  elements.audioElement.removeAttribute("src");
  elements.audioElement.classList.add("hidden");
  state.playback.usingAudioClock = false;
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

  ensureAudioGraph();
  setStatus(`Loaded audio track ${file.name}.`);
}

function handleManualBpmChange() {
  const bpm = Number(elements.manualBpm.value);
  if (!Number.isFinite(bpm) || bpm <= 0) {
    setStatus("BPM must be a positive number.", { error: true });
    return;
  }
  state.playback.bpm = bpm;
  updateTransportDisplays(getTransportSeconds());
  applyPlaybackRates();
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

function wireEvents() {
  elements.playButton.addEventListener("click", () => {
    startPlayback().catch((error) => setStatus(error.message, { error: true }));
  });
  elements.pauseButton.addEventListener("click", pausePlayback);
  elements.detectBpmButton.addEventListener("click", detectBpm);
  elements.clearAudioButton.addEventListener("click", clearAudio);
  elements.manualBpm.addEventListener("change", handleManualBpmChange);
  elements.audioInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (file) {
      await loadAudio(file);
    }
  });
  elements.exportHighButton.addEventListener("click", handleHighExportClick);
  elements.exportWebButton.addEventListener("click", handleWebExportClick);
}

function initialize() {
  renderLayers();
  updateTransportDisplays(0);
  drawPreview(0);
  wireEvents();
  setStatus("Browser canvas output is ready. Add video layers to begin.");
}

window.pulsehzApp = {
  exportHighQuality,
  exportWeb,
  getPreviewStream: () => elements.previewCanvas.captureStream(60),
  getSerializableProjectState: serializeProjectState,
};

initialize();
