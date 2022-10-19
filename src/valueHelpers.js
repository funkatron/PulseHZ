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
    }
}
