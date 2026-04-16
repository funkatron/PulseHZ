/**
 * Pure transport timing — no app singletons (testable, reusable).
 * @module transport-math
 */

/**
 * Bar length in seconds at the given BPM and meter.
 * @param {number} bpm
 * @param {number} [beatsPerBar]
 */
export function barDurationSeconds(bpm, beatsPerBar = 4) {
  return (60 / bpm) * beatsPerBar;
}

/**
 * Current transport time (seconds) from playback + optional audio clock.
 * @param {object} playback App `state.playback`-shaped object
 * @param {HTMLMediaElement} audioElement
 */
export function getTransportSeconds(playback, audioElement) {
  if (!playback.isPlaying) {
    return playback.startOffsetSeconds;
  }

  if (playback.usingAudioClock && !audioElement.paused) {
    return audioElement.currentTime || 0;
  }

  const elapsed = (performance.now() - playback.startedAtMs) / 1000;
  return playback.startOffsetSeconds + elapsed;
}
