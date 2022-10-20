import {DEFAULT_FPS} from "./consts.js";
import canvasOutputFunctions from "./canvas/canvasRenderFunctions.js";

/**
 * @typedef {Object} LoopatronArrangement
 * @property {Number} syncStep
 * @property {Number} fps
 * @property {Array[LoopatronRenderer]} renderers
 * @property {function(): void} play
 * @property {function(): void} stop
 * @property {function(LoopatronRenderer): void} addRenderer
 * @property {function(LoopatronRenderer): void} removeRenderer
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

        play: function () {
            this.syncStep = 0;

            this._mainLoopInterval = setInterval(async () => {

                // clear outputs
                let clearPromises = this.renderers.map(r => {
                    return canvasOutputFunctions.clearCanvas(r.renderTarget);
                });
                await Promise.all(clearPromises);
                console.debug(`S[${this.syncStep}] cleared ${clearPromises.length} canvasses`);

                // render
                let renderPromises = this.renderers.map(r => {
                    // log the render function name
                    return r.render(this.syncStep);
                });
                await Promise.all(renderPromises);
                console.debug(`S[${this.syncStep}] rendered ${renderPromises.length} renderers`);

                this.syncStep++;

            }, 1000 / this.fps);
        },
        stop: function () {
            clearInterval(this._mainLoopInterval);
            this.syncStep = 0;
        }
    }
}

export {LoopatronArrangement}
