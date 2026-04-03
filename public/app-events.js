/**
 * Lightweight pub/sub for app-wide signals (transport, export hooks, etc.).
 * Handlers run synchronously; keep them cheap.
 */

/** @type {Map<string, Set<(detail: unknown) => void>>} */
const listeners = new Map();

export const EVT_TRANSPORT_BPM_CHANGED = "pulsehz:transport-bpm-changed";

/**
 * @param {string} eventType
 * @param {(detail: unknown) => void} handler
 * @returns {() => void} unsubscribe
 */
export function on(eventType, handler) {
  let set = listeners.get(eventType);
  if (!set) {
    set = new Set();
    listeners.set(eventType, set);
  }
  set.add(handler);
  return () => off(eventType, handler);
}

/**
 * @param {string} eventType
 * @param {(detail: unknown) => void} handler
 */
export function off(eventType, handler) {
  listeners.get(eventType)?.delete(handler);
}

/**
 * @param {string} eventType
 * @param {unknown} [detail]
 */
export function emit(eventType, detail) {
  const set = listeners.get(eventType);
  if (!set?.size) {
    return;
  }
  for (const handler of set) {
    try {
      handler(detail);
    } catch (err) {
      console.error(`PulseHZ event "${eventType}" handler failed`, err);
    }
  }
}
