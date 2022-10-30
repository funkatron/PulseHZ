/**
 *
 * @property {function(Number): Number} valueFunction
 * @property {function(Number, Number, HTMLElement)} renderFunction
 * @property {HTMLElement} renderTarget
 * @property {function(Number)} render
 * @property {function(function(Number, Number, HTMLElement)): void} setOutputFunction
 * @property {function(HTMLElement): void} setOutputTarget
 * @property {function(function(Number): Number): void} setValueFunction
 */

import {DEFAULT_BARS_PER_LOOP, DEFAULT_STEP_INCREMENT, DEFAULT_STEPS_PER_BAR, GEN_MAX, GEN_MIN} from "./consts.js";
import {valueFunctions} from "./valueFunctions.js";

/**
 * @class RenderLoop
 * @param {function(Number): Number} valueFunction
 * @param {HTMLElement} renderTarget
 * @param {function(Number, Number, HTMLElement)} renderFunction
 * @param lengthBars
 * @param stepsPerBar
 * @param stepIncrement
 * @param offset
 * @param minVal
 * @param maxVal
 * @returns {RenderLoop} a RenderLoop object
 */
let RenderLoop = function ({
                               valueFunction = () => Math.random(),
                               renderTarget,
                               renderFunction = (ss, v, t) => console.log("no render function defined"),
                               lengthBars = DEFAULT_BARS_PER_LOOP,
                               stepsPerBar = DEFAULT_STEPS_PER_BAR,
                               stepIncrement = DEFAULT_STEP_INCREMENT,
                               offset = 0,
                               minVal = GEN_MIN,
                               maxVal = GEN_MAX
                           }) {

    if (!valueFunction) {
        throw new Error("valueFunction is required");
    }
    if (!renderTarget) {
        throw new Error("renderTarget is required");
    }
    if (!renderFunction) {
        throw new Error("renderFunction is required");
    }

    let pulseHZRenderer = {
        /**
         * @type {function(Number, Number, Number, Number, {}): Number}
         */
        valueFunction: null,
        /**
         * @type {function(Number, Number, HTMLElement, {})}
         */
        renderFunction: null,
        /**
         * @type {HTMLElement}
         */
        renderTarget: null,

        settings: {
            lengthBars,
            stepsPerBar,
            stepIncrement,
            offset,
            minVal,
            maxVal
        },

        /**
         * @param {Number} syncStep
         */
        async render(syncStep = 0) {
            let value = this.valueFunction(syncStep, GEN_MIN, GEN_MAX, offset, this.settings);
            console.log(`Render ${renderTarget.id} with value ${value}`);
            this.renderFunction(syncStep, value, this.renderTarget, this.settings);
            // let value = valueFunctions.ramp(syncStep, {}, this.settings);
            // console.log(`Render ${renderTarget.id} with value ${value}`);
            // this.renderFunction(syncStep, value, this.renderTarget, this.settings);
        },

        /**
         * @param {function(Number): Number} valueFunction
         */
        setValueFunction: function (valueFunction) {
            this.valueFunction = valueFunction;
        },

        /**
         * @param {HTMLElement} target
         */
        setRenderTarget(target) {
            this.renderTarget = target;

            // if the target is a canvas, we do special setup
            if (target instanceof HTMLCanvasElement) {
                // Get the device pixel ratio, falling back to 1.
                const dpr = window.devicePixelRatio || 1;

                // Get the size of the canvas in CSS pixels.
                const rect = target.getBoundingClientRect();

                // Give the canvas pixel dimensions of their CSS
                // size * the device pixel ratio.
                target.width = rect.width * dpr;
                target.height = rect.height * dpr;

                let ctx = target.getContext('2d');
                // ctx.scale(dpr, dpr);
                return ctx;
            }
        },

        /**
         * @param {function(Number, Number, HTMLElement)} outputFunction a function that takes a value and an output target and interacts with the output target in some way
         */
        setRenderFunction(outputFunction) {
            this.renderFunction = outputFunction;
        }
    }

    pulseHZRenderer.setValueFunction(valueFunction);
    pulseHZRenderer.setRenderTarget(renderTarget);
    pulseHZRenderer.setRenderFunction(renderFunction);
    return pulseHZRenderer;
}


export {RenderLoop}
