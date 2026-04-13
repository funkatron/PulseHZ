/**
 * Pure tempo helpers for decoded audio (file path).
 */

export const DEFAULT_BPM = 120;

export function normalizeBpm(bpm, fallback = DEFAULT_BPM) {
  let value = !Number.isFinite(bpm) || bpm <= 0 ? fallback : bpm;
  while (value < 70) {
    value *= 2;
  }
  while (value > 180) {
    value /= 2;
  }
  return value;
}

/**
 * Onset-energy voting BPM estimate for a mono buffer.
 * @param {AudioBuffer} audioBuffer
 */
export function estimateBpmFromAudioBuffer(audioBuffer) {
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

/**
 * @param {AudioBuffer} buffer
 * @returns {AudioBuffer}
 */
export function downmixToMonoBuffer(buffer) {
  if (buffer.numberOfChannels === 1) {
    return buffer;
  }
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    mono[i] = (left[i] + right[i]) * 0.5;
  }
  const out = new AudioBuffer({
    length: len,
    numberOfChannels: 1,
    sampleRate: buffer.sampleRate,
  });
  out.copyToChannel(mono, 0, 0);
  return out;
}

/**
 * @param {AudioBuffer} buffer
 * @param {number} startSec
 * @param {number} endSec
 * @returns {AudioBuffer}
 */
export function sliceAudioBuffer(buffer, startSec, endSec) {
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.floor(startSec * sr));
  const s1 = Math.min(buffer.length, Math.floor(endSec * sr));
  const len = Math.max(0, s1 - s0);
  if (len === 0) {
    return new AudioBuffer({ length: 1, numberOfChannels: 1, sampleRate: sr });
  }
  const ch0 = buffer.getChannelData(0);
  const slice = ch0.subarray(s0, s1);
  const out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: sr });
  out.copyToChannel(slice, 0, 0);
  return out;
}

/**
 * Sliding-window BPM series (mono buffer). Yields between windows to keep the main thread responsive.
 * @param {AudioBuffer} monoBuffer
 * @param {{ windowSec?: number, hopSec?: number, maxSeconds?: number }} options
 * @returns {Promise<Array<{ tCenter: number, bpm: number }>>}
 */
export async function buildBpmSegmentsAsync(monoBuffer, options = {}) {
  const windowSec = options.windowSec ?? 12;
  const hopSec = options.hopSec ?? 6;
  const maxSeconds = options.maxSeconds ?? 600;
  const duration = Math.min(monoBuffer.duration, maxSeconds);

  if (duration <= 0) {
    return [];
  }

  if (duration < windowSec) {
    const bpm = estimateBpmFromAudioBuffer(monoBuffer);
    return [{ tCenter: duration / 2, bpm }];
  }

  const segments = [];
  let t = 0;
  while (t + windowSec <= duration + 1e-6) {
    const slice = sliceAudioBuffer(monoBuffer, t, t + windowSec);
    const bpm = estimateBpmFromAudioBuffer(slice);
    segments.push({ tCenter: t + windowSec / 2, bpm });
    t += hopSec;
    await yieldToMain();
  }
  return segments;
}

function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 80 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Linear interpolation of BPM at time `t` (seconds).
 * @param {Array<{ tCenter: number, bpm: number }> | null | undefined} segments
 * @param {number} t
 * @returns {number | null}
 */
export function bpmAtTime(segments, t) {
  if (!segments?.length) {
    return null;
  }
  if (t <= segments[0].tCenter) {
    return segments[0].bpm;
  }
  const last = segments[segments.length - 1];
  if (t >= last.tCenter) {
    return last.bpm;
  }
  for (let i = 0; i < segments.length - 1; i += 1) {
    const a = segments[i];
    const b = segments[i + 1];
    if (t >= a.tCenter && t <= b.tCenter) {
      const span = b.tCenter - a.tCenter;
      if (span <= 1e-9) {
        return a.bpm;
      }
      const u = (t - a.tCenter) / span;
      return a.bpm + u * (b.bpm - a.bpm);
    }
  }
  return last.bpm;
}

/**
 * @param {Array<{ bpm: number }> | null | undefined} segments
 */
export function medianBpmFromSegments(segments) {
  if (!segments?.length) {
    return DEFAULT_BPM;
  }
  const vals = segments.map((s) => s.bpm).sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}
