/**
 * @constructor
 * @typedef {Object} LoopatronRenderer
 * @property {function(Number): Number} valueFunction
 * @property {function(Number, HTMLElement): Number} outputFunction
 * @property {HTMLElement} outputTarget
 * @property {function(Number): void} render
 * @property {function(HTMLElement): void} setOutputTarget
 * @property {function(function(Number, HTMLElement): Number): void} setOutputFunction
 * @property {function(function(Number): Number): void} setValueFunction
 */

/**
 * @param {function(Number): Number} valueFunction
 * @param {HTMLElement} outputTarget
 * @param {function(Number, Number, *)} outputFunction a function that takes a value and an outputTarget and renders it. The outputTarget can be anything, but is usually an HTML element.
 * @returns {LoopatronRenderer}
 */
let LoopatronRenderer = function (valueFunction, outputTarget, outputFunction) {

    return {
        valueFunction: valueFunction,
        outputFunction: outputFunction,
        outputTarget: outputTarget,

        /**
         * @param {Number} syncStep
         */
        async render(syncStep = 0) {
            let value = this.valueFunction(syncStep);
            this.outputFunction(syncStep, value, this.outputTarget);
        },

        /**
         * @param {HTMLElement} target
         */
        setOutputTarget(target) {
            this.outputTarget = target;
        },

        /**
         * @param {function(Number, HTMLElement): Number} outputFunction a function that takes a value and an output target and interacts with the output target in some way
         */
        setOutputFunction(outputFunction) {
            this.outputFunction = outputFunction;
        }
    }
}


export {LoopatronRenderer}
