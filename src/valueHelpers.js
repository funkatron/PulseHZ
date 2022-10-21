import {DEFAULT_RANGE} from "./consts.js";

export default {
    /**
     * Interpolates a value between two ranges
     * @param {Number} originalValue the pre-interpolated value. Represents a value in the fromRange. Required.
     * @param {[number,number]} toRange the range to interpolate to. Required.
     * @param {[number,number]} fromRange the range to interpolate from. Default is DEFAULT_RANGE (0-127)
     * @returns {Number} the interpolated value
     */
    scaleValue(originalValue, toRange, fromRange = DEFAULT_RANGE) {
        const scaledValue = (originalValue - fromRange[0])
            * (toRange[1] - toRange[0])
            / (fromRange[1] - fromRange[0])
            + toRange[0];
        return scaledValue;
    },

    /**
     * converts a value and range from a linear scale to a logarithmic scale
     *
     * log(y) == (x - x0) / (x1 - x0) * (log(y1) - log(y0)) + log(y0)
     *
     * @param {Number} originalValue the pre-interpolated value. Represents a value in the fromRange. Required.
     * @param {[number,number]} toRange the range to interpolate to. Required.
     * @param {[number,number]} fromRange the range to interpolate from. Default is DEFAULT_RANGE (0-127).
     * @returns {Number} the number, scaled to the new logarithmic range
     */
    scaleToLogValue(originalValue, toRange, fromRange = DEFAULT_RANGE) {
        const logY0 = toRange[0] !== 0 ? Math.log(toRange[0]) : 0;
        const logY1 = Math.log(toRange[1]);
        const logY = (originalValue - fromRange[0])
            * (logY1 - logY0)
            / (fromRange[1] - fromRange[0])
            + logY0;
        return Math.exp(logY);

        // const logRange = [fromRange[0], Math.pow(2, fromRange[1])];
        // const logValue = Math.pow(2, originalValue);
        // let logScaledValue = this.scaleValue(logValue, toRange, logRange);
        // return logScaledValue;
    }
}
