/**
 * Presentation controls: modulation + MIDI bindings.
 * Keep in sync with `src/pulsehz/project_controls.py` (schemaVersion).
 */

export const PRESENTATION_CONTROLS_VERSION = 1;

/** @returns {{ schemaVersion: number, modulation: unknown[], midi: unknown[] }} */
export function createEmptyControlsPayload() {
  return {
    schemaVersion: PRESENTATION_CONTROLS_VERSION,
    modulation: [],
    midi: [],
  };
}
