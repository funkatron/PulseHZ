import valueHelpers from "./valueHelpers.js";
import {
    DEFAULT_BARS_PER_LOOP,
    DEFAULT_STEP_INCREMENT,
    DEFAULT_STEP_INCREMENT_SINE,
    DEFAULT_STEPS_PER_BAR,
    GEN_MAX,
    GEN_MIN
} from "./consts.js";

export const valueFunctions = {
    ramp(syncStep = 0, minVal = GEN_MIN, maxVal = GEN_MAX, offset = 0, rendererSettings = {lengthBars:DEFAULT_BARS_PER_LOOP, stepsPerBar:DEFAULT_STEPS_PER_BAR, stepIncrement:DEFAULT_STEP_INCREMENT}) {

        let {lengthBars, stepsPerBar, stepIncrement} = rendererSettings;
        let stepsPerLoop = stepsPerBar * lengthBars;
        let step = syncStep % stepsPerLoop + offset;
        let value = valueHelpers.scaleValue(step, [minVal, maxVal], [0, stepsPerLoop]);
        return value
    },

    /**
     *
     * a generator function that returns a pattern of sign wave values
     * @param {Number} syncStep the current sync step
     * @param {Number} minVal the minimum value to return
     * @param {Number} maxVal the maximum value to return
     * @param offset
     * @param rendererSettings
     */
    sine: function (syncStep = 0, minVal = GEN_MIN, maxVal = GEN_MAX, offset = 0, rendererSettings = {lengthBars:DEFAULT_BARS_PER_LOOP, stepsPerBar:DEFAULT_STEPS_PER_BAR, stepIncrement:DEFAULT_STEP_INCREMENT_SINE}) {
        let {lengthBars, stepsPerBar, stepIncrement} = rendererSettings;
        let stepsPerLoop = stepsPerBar * lengthBars;
        let step = syncStep % stepsPerLoop;

        let radiansOffset = offset * 2 * Math.PI;

        let sinVal = Math.sin(step * stepIncrement * Math.PI * 2 + radiansOffset);

        // calculate the value with offset
        let value = valueHelpers.scaleValue(sinVal, [minVal, maxVal], [-1, 1]);

        return value
    }
};
