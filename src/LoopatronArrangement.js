import {DEFAULT_FPS, LOOPATRON_DEBUG} from "./consts.js";
import canvasOutputFunctions from "./canvas/canvasRenderFunctions.js";

/**
 * @typedef {Object} LoopatronArrangement
 * @property {Number} syncStep
 * @property {Number} fps
 * @property {Array[LoopatronRenderer]} renderers
 * @property {function(): void} play
 * @property {function(): void} pause
 * @property {function(): void} stop
 * @property {function(LoopatronRenderer): void} addRenderer
 * @property {function(LoopatronRenderer): void} removeRenderer
 * @property {function(): void} stepForward
 * @property {function(): void} stepBackward
 * @property {function(): void} resume
 * @constructor
 */

/**
 * A LoopatronArrangement is a collection of LoopatronRenderers (right now).
 * @param {Array[LoopatronRenderer]} renderers
 * @param {Number} fps defaults to DEFAULT_FPS (60)
 * @returns {LoopatronArrangement} a LoopatronArrangement
 */
let LoopatronArrangement = function (renderers = [], fps = DEFAULT_FPS) {

    return {
        /**
         * @type {Number}
         */
        syncStep: 0,
        /**
         * @type {Number} default to 60
         */
        fps: fps,
        /**
         * @type {Array[LoopatronRenderer]}
         */
        renderers: renderers,

        _mainLoopInterval: null,

        /**
         * @returns {void}
         * @param {LoopatronRenderer} renderer
         */
        addRenderer: function (renderer) {
            this.renderers.push(renderer)
        },

        /**
         * @returns {void}
         * @param {LoopatronRenderer} renderer
         */
        removeRenderer: function (renderer) {
            this.renderers = this.renderers.filter(r => r !== renderer)
        },

        play: function (syncStep = 0) {
            this.syncStep = syncStep;

            this._mainLoopInterval = setInterval(async () => {

                // clear outputs
                let clearPromises = this.renderers.map(r => {
                    if (r.output instanceof HTMLCanvasElement) {
                        // if this is an HTMLCanvasElement, clear it
                        return canvasOutputFunctions.clearCanvas(r.renderTarget);
                    } else if (r.output instanceof HTMLElement) {
                        // if this is an HTMLElement, clear it
                        return r.output.innerHTML = "";
                    }
                });
                await Promise.all(clearPromises);

                // render
                let renderPromises = this.renderers.map(r => {
                    // log the render function name
                    return r.render(this.syncStep);
                });
                await Promise.all(renderPromises);
                this.syncStep++;

            }, 1000 / this.fps);
        },

        pause: function () {
            clearInterval(this._mainLoopInterval);
        },

        resume: function () {
            this.play(this.syncStep);
        },

        stepForward: function () {
            this.renderers.map(r => {
                r.render(this.syncStep);
            });
            this.syncStep++;
        },

        stepBackward: function () {
            this.syncStep--;
            this.renderers.map(r => {
                r.render(this.syncStep);
            });
        },

        stop: function () {
            clearInterval(this._mainLoopInterval);
            this.syncStep = 0;
        }
    }
}

export {LoopatronArrangement}
