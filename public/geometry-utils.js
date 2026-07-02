/**
 * Shared SVG layout helpers.
 * @module geometry-utils
 */

/** @param {number} cx @param {number} cy @param {number} r @param {number} angleDeg angle from +x axis (12 o'clock = -90). */
export function polarFromAngleDegrees(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
