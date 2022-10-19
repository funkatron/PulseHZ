import valueHelpers from "./valueHelpers.js";
import {DEFAULT_STEP_INCREMENT, DEFAULT_STEP_INCREMENT_SINE, GEN_MAX, GEN_MIN} from "./consts.js";

export const LoopatronGenerators = {
    ramp(syncStep = 0, minVal = GEN_MIN, maxVal = GEN_MAX, stepIncrement = DEFAULT_STEP_INCREMENT) {
        let val = syncStep * stepIncrement;
        if (syncStep > maxVal) {
            val = minVal + syncStep % maxVal;
        }
        return val;
    },

    /**
     *
     * a generator function that returns a pattern of sign wave values
     * @param {Number} syncStep the current sync step
     * @param {Number} minVal the minimum value to return. Default is GEN_MIN (0)
     * @param {number} maxVal the maximum value to return. Default is GEN_MAX (127)
     * @param {Number} stepIncrement the amount to increment the sync step by. Default is DEFAULT_STEP_INCREMENT_SINE (0.01). Increasing this will increase the frewquency of the sine wave
     */
    sine: function (syncStep = 0, minVal = GEN_MIN, maxVal = GEN_MAX, stepIncrement = DEFAULT_STEP_INCREMENT_SINE) {
        let val = Math.sin(syncStep * stepIncrement);
        // scale the possible sine values (-1 to 1) to the range of minVal to maxVal
        return valueHelpers.scaleValue(val, [minVal, maxVal], [-1, 1]);
    }
};
