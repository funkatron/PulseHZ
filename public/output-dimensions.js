/**
 * Output frame size from tier + aspect — pure helpers (no DOM).
 * @module output-dimensions
 */

/** Vertical resolution for 720p / 1080p / 2160p tiers (16∶9 height). */
export const OUTPUT_TIER_HEIGHT = {
  "720p": 720,
  "1080p": 1080,
  "2160p": 2160,
};

export const OUTPUT_FIXED_PRESETS = {
  "720x1720": { width: 720, height: 1720 },
  "1440x3440": { width: 1440, height: 3440 },
};

/**
 * Pixel size for the main canvas and ProRes export metadata.
 * Layers are letterboxed into this frame when using Fit (aspect ratio preserved).
 * @param {string} tierId
 * @param {string} aspectId
 * @returns {{ width: number, height: number }}
 */
export function getOutputDimensions(tierId, aspectId) {
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
