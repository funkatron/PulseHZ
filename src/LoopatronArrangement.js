import {DEFAULT_FPS, LOOPATRON_DEBUG} from "./consts.js";
import canvasOutputFunctions from "./canvas/canvasRenderFunctions.js";
import {LoopatronRenderer} from "./LoopatronRenderer.js";
import {valueFunctions} from "./valueFunctions.js";

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
 * @property {function(HTMLElement): void} addControls
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
         * @type {boolean} defaults to true. If true, the arrangement will clear every renderTarget before rendering
         */
        clearBeforeEveryFrame: true,
        /**
         * @type {Number} default to 60
         */
        fps: fps,
        /**
         * @type {Array[LoopatronRenderer]}
         */
        renderers: renderers,

        _mainLoopInterval: null,

        isPlaying: false,

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
            this.syncStep = Math.abs(syncStep);

            this.isPlaying = true;

            this._mainLoopInterval = setInterval(async () => {

                // clear outputs
                if (!!this.clearBeforeEveryFrame) {
                    let clearPromises = this.renderers.map(r => {
                        if (r.renderTarget instanceof HTMLCanvasElement) {
                            // if this is an HTMLCanvasElement, clear it
                            return canvasOutputFunctions.clearCanvas(r.renderTarget);
                        } else if (r.renderTarget instanceof HTMLElement) {
                            // if this is an HTMLElement, clear it
                            return r.renderTarget.innerHTML = "";
                        } else {
                            // otherwise, do nothing
                            console.log(`LoopatronArrangement.play: no clear function for this renderTarget type (${r.renderTarget.constructor.name})`);
                            return Promise.resolve();
                        }
                    });
                    await Promise.all(clearPromises);
                }

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
            this.isPlaying = false;
        },

        resume: function () {
            if (!this.isPlaying) {
                this.play(this.syncStep);
            }
        },

        stepForward: function () {
            if (this.isPlaying) {
                this.pause();
            }

            this.renderers.map(r => {
                r.render(this.syncStep);
            });
            this.syncStep++;
        },

        stepBackward: function () {
            if (this.syncStep > 0) {
                this.syncStep--;
                this.renderers.map(r => {
                    r.render(this.syncStep);
                });
            }
        },

        stop: function () {
            clearInterval(this._mainLoopInterval);
            this.syncStep = 1;
            this.stepBackward();
            this.isPlaying = false;
        },

        /**
         * @returns {void}
         * @param {HTMLElement} controlsRootElement
         */
        addControls: function (controlsRootElement) {
            controlsRootElement.innerHTML = `
    <!-- the current syncstep value -->
    <div id="sync-step">
    </div>

    <!-- an svg arrow to step backwards -->
    <div id="step-backward">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            <path d="M0 0h24v24H0z" fill="none"/>
        </svg>
    </div>

    <!-- and svg square to stop -->
    <div id="stop">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M6 6h12v12H6z"/>
            <path d="M0 0h24v24H0z" fill="none"/>
        </svg>
    </div>

    <!-- an svg pause button -->
    <div id="pause">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            <path d="M0 0h24v24H0z" fill="none"/>
        </svg>
    </div>

    <!-- an svg play button -->
    <div id="play">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
            <path d="M0 0h24v24H0z" fill="none"/>
        </svg>
    </div>

    <!-- an svg arrow to skip forward -->
    <div id="step-forward">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            <path d="M0 0h24v24H0z" fill="none"/>
        </svg>
    </div>
    
    <!-- a chechbox to toggle clearBeforeEveryFrame -->
    <div id="clear-before-every-frame">
        
        <label for="clear-before-every-frame-checkbox"><input type="checkbox" id="clear-before-every-frame-checkbox" checked> Clear before every frame</label>
    </div>
    `;

            // add handler for clear-before-every-frame-checkbox
            if (!!this.clearBeforeEveryFrame) {  // initialize the checkbox first
                document.getElementById("clear-before-every-frame-checkbox").setAttribute("checked", "checked");
            } else {
                document.getElementById("clear-before-every-frame-checkbox").removeAttribute("checked");
            }

            controlsRootElement.querySelector("#clear-before-every-frame-checkbox").addEventListener("change", (e) => {
                e.stopPropagation();
                this.clearBeforeEveryFrame = e.target.checked;
            });

            // play/resume handler
            controlsRootElement.querySelector(`#play`).addEventListener("click", (e) => {
                e.stopPropagation();
                this.resume();
            });

            // stop handler
            controlsRootElement.querySelector("#stop").addEventListener("click", (e) => {
                e.stopPropagation();
                this.stop();
            });

            // pausee handler
            controlsRootElement.querySelector("#pause").addEventListener("click", (e) => {
                e.stopPropagation();
                this.pause();
            });

            // step-backward handler
            controlsRootElement.querySelector("#step-backward").addEventListener("click", (e) => {
                e.stopPropagation();
                this.stepBackward();
            });

            // step-forward handler
            controlsRootElement.querySelector("#step-forward").addEventListener("click", (e) => {
                e.stopPropagation();
                this.stepForward();
            });

            // add a renderer for the syncstep HTML
            const syncStepRenderer = new LoopatronRenderer(
                valueFunctions.ramp,
                document.getElementById("sync-step"),
                /**
                 * @param {Number} syncStep
                 * @param {Number} v
                 * @param {HTMLElement} t
                 */
                (syncStep, v, t) => {
                    // pad syncstep with 6 leading zeroes
                    t.innerHTML = `SS:${syncStep.toString().padStart(6, '0')}`;
                }
            );
            this.addRenderer(syncStepRenderer);
        }
    }
}

export {LoopatronArrangement}
