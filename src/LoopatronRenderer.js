import {LOOPATRON_DEBUG} from "./consts.js";
import canvasRenderFunctions from "./canvas/canvasRenderFunctions.js";

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

/**
 * @class LoopatronRenderer
 * @param {function(Number): Number} valueFunction
 * @param {HTMLElement} renderTarget
 * @param {function(Number, Number, HTMLElement)} renderFunction
 * @returns {LoopatronRenderer} a LoopatronRenderer
 */
let LoopatronRenderer = function (valueFunction, renderTarget, renderFunction) {

    if (!valueFunction) {
        throw new Error("valueFunction is required");
    }
    if (!renderTarget) {
        throw new Error("renderTarget is required");
    }
    if (!renderFunction) {
        throw new Error("renderFunction is required");
    }

    let loopatronRenderer = {
        /**
         * @type {function(Number): Number}
         */
        valueFunction: null,
        /**
         * @type {function(Number, Number, HTMLElement)}
         */
        renderFunction: null,
        /**
         * @type {HTMLElement}
         */
        renderTarget: null,

        /**
         * @param {Number} syncStep
         */
        async render(syncStep = 0) {
            let value = this.valueFunction(syncStep);
            this.renderFunction(syncStep, value, this.renderTarget);
            // if (LOOPATRON_DEBUG === true) {
            //     canvasRenderFunctions.renderText(this.renderTarget, `S[${syncStep}] == ${value}`, {});
            // }
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
        },

        /**
         * @param {function(Number, Number, HTMLElement)} outputFunction a function that takes a value and an output target and interacts with the output target in some way
         */
        setRenderFunction(outputFunction) {
            this.renderFunction = outputFunction;
        }
    }

    loopatronRenderer.setValueFunction(valueFunction);
    loopatronRenderer.setRenderTarget(renderTarget);
    loopatronRenderer.setRenderFunction(renderFunction);
    return loopatronRenderer;
}


export {LoopatronRenderer}
