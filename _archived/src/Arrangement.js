import {DEFAULT_BEATS_PER_BAR, DEFAULT_BPM, DEFAULT_FPS, PULSEHZ_DEBUG} from "./consts.js";
import canvasOutputFunctions from "./canvas/canvasRenderFunctions.js";
import {RenderLoop} from "./RenderLoop.js";
import {valueFunctions} from "./valueFunctions.js";
import valueHelpers from "./valueHelpers.js";
import {DEFAULT_STEPS_PER_BEAT} from "./consts.js";

/**
 * @typedef {Object} Arrangement
 * @property {Number} syncStep
 * @property {Number} fps
 * @property {Array[RenderLoop]} renderers
 * @property {function(): void} play
 * @property {function(): void} pause
 * @property {function(): void} stop
 * @property {function(RenderLoop): void} addRenderer
 * @property {function(RenderLoop): void} removeRenderer
 * @property {function(): void} stepForward
 * @property {function(): void} stepBackward
 * @property {function(): void} resume
 * @property {function(HTMLElement): void} addControls
 * @constructor
 */

/**
 * A Arrangement is a collection of RenderLoops objects.
 * @param {Array[RenderLoop]} renderers
 * @param {number} bpm
 * @returns {Arrangement} a Arrangement
 */
let Arrangement = function (renderers = [], bpm = DEFAULT_BPM) {

    return {
        /**
         * @type {Number}
         */
        syncStep: 0,
        /**
         * @type {boolean} defaults to true. If true, the arrangement will clear every renderTarget before rendering
         */
        clearBeforeEveryFrame: true,

        settings: {
            bpm: bpm,
        },

        state: {
            fps: bpm / 60 * DEFAULT_STEPS_PER_BEAT,
            // the time between syncSteps
            stepInterval:  1000 / (bpm / 60 * DEFAULT_STEPS_PER_BEAT),
            get currentBeat() {
                return this.syncStep / DEFAULT_STEPS_PER_BEAT;
            },
            get currentBar() {
                return this.syncStep / (DEFAULT_STEPS_PER_BEAT * DEFAULT_BEATS_PER_BAR);
            }
        },

        get bpm() {
            return this.settings.bpm;
        },

        /**
         * @type {Array[RenderLoop]}
         */
        renderers: renderers,

        _mainLoopInterval: null,

        isPlaying: false,

        /**
         * @returns {void}
         * @param {RenderLoop} renderer
         */
        addRenderer: function (renderer) {
            this.renderers.push(renderer)
        },

        /**
         * @returns {void}
         * @param {RenderLoop} renderer
         */
        removeRenderer: function (renderer) {
            this.renderers = this.renderers.filter(r => r !== renderer)
        },

        renderCurrentFrame: async function() {
            // console.log(`Rendering frame ${this.syncStep} at
            // ${this.bpm} bpm
            // ${this.state.fps} fps
            // ${this.state.stepInterval} ms per step
            // ${this.state.currentBeat} current beat
            // ${this.state.currentBar} current bar
            // `);

            // clear outputs
            if (!!this.clearBeforeEveryFrame) {
                await this.clearAllRenderTargets();
            }

            // run all renderers
            await this.renderAllTargets();
        },

        play: function (syncStep = 0) {
            this.syncStep = Math.abs(syncStep);

            this.isPlaying = true;

            this._mainLoopInterval = setInterval(async () => {

                await this.renderCurrentFrame();

                this.syncStep++;

            }, this.state.stepInterval);
        },

        pause: async function () {
            clearInterval(this._mainLoopInterval);
            this.isPlaying = false;
        },

        resume: async function () {
            if (!this.isPlaying) {
                this.play(this.syncStep);
            }
        },

        stepForward: async function () {
            if (this.isPlaying) {
                this.pause();
            }
            this.syncStep++;

            await this.renderCurrentFrame();
        },

        stepBackward: async function () {
            if (this.syncStep < 0) {
                this.syncStep = 0;
            }

            this.syncStep--;

            await this.renderCurrentFrame();
        },

        stop: async function () {
            clearInterval(this._mainLoopInterval);
            this.syncStep = 0;
            await this.renderCurrentFrame();
            this.isPlaying = false;
        },

        /**
         * @returns {void}
         * @param {HTMLElement} controlsRootElement
         */
        addControls: function (controlsRootElement) {
            controlsRootElement.innerHTML = `
    <div class="pulsehz-controls__container">
        <!-- the current syncstep value -->
        <div id="pulsehz-controls__debug-ascii-spinner" class="pulsehz-controls__text-debug"></div>
        <div id="pulsehz-controls__debug-sync-step" class="pulsehz-controls__text-debug">
        </div>
        <div id="pulsehz-controls__debug-fps" class="pulsehz-controls__text-debug">
        </div>
        <div id="pulsehz-controls__debug-bpm" class="pulsehz-controls__text-debug"">
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
        <div id="clear-before-every-frame"  class="pulsehz-controls__checkbox">
            
            <label for="clear-before-every-frame-checkbox"><input type="checkbox" id="clear-before-every-frame-checkbox" checked> Clear before every frame</label>
        </div>
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
            const syncStepRenderer = new RenderLoop(
                {
                    valueFunction: valueFunctions.ramp,
                    renderTarget: document.getElementById("pulsehz-controls__debug-sync-step"),
                    renderFunction: /**
                     * @param {Number} syncStep
                     * @param {Number} v
                     * @param {HTMLElement} t
                     */
                        (syncStep, v, t) => {
                        // pad syncstep with 6 leading zeroes
                        t.innerHTML = `SS:${syncStep.toString().padStart(6, '0')}`;
                    }
                }
            );

            // add a renderer for the fps HTML
            const fpsRenderer = new RenderLoop(
                {
                    valueFunction: () => this.state.fps,
                    renderTarget: document.getElementById("pulsehz-controls__debug-fps"),
                    renderFunction: (syncStep, v, t) => {
                        t.innerHTML = `FPS:${v.toFixed(2).padStart(2, '0')}`;
                    }
                },
            )

            const bpmRenderer = new RenderLoop(
                {
                    valueFunction: () => this.bpm,
                    renderTarget: document.getElementById("pulsehz-controls__debug-bpm"),
                    renderFunction: (syncStep, v, t) => {
                        t.innerHTML = `BPM:${v.toFixed(2).padStart(3, '0')}`;
                    }
                }
            );

            const asciiSpinnerRenderer = new RenderLoop(
                {
                    valueFunction: valueFunctions.ramp,
                    renderTarget: document.getElementById("pulsehz-controls__debug-ascii-spinner"),
                    renderFunction: (syncStep, v, t) => {
                        const spinner = ['|', '/', '-', '\\'];
                        let idx = Math.floor(
                            valueHelpers.scaleValue(v, [1, spinner.length * 8])
                        ) % spinner.length;
                        t.innerHTML = `[${spinner[idx]}]`;
                    }
                }
            );
            this.addRenderer(syncStepRenderer);
            this.addRenderer(fpsRenderer);
            this.addRenderer(bpmRenderer);
            this.addRenderer(asciiSpinnerRenderer)
        },
        async clearAllRenderTargets() {
            let clearPromises = this.renderers.map(r => {
                if (r.renderTarget instanceof HTMLCanvasElement) {
                    // if this is an HTMLCanvasElement, clear it
                    return canvasOutputFunctions.clearCanvas(r.renderTarget);
                } else if (r.renderTarget instanceof HTMLElement) {
                    // if this is an HTMLElement, clear it
                    return r.renderTarget.innerHTML = "";
                } else {
                    // otherwise, do nothing
                    console.log(`Arrangement.play: no clear function for this renderTarget type (${r.renderTarget.constructor.name})`);
                    return Promise.resolve();
                }
            });
            return Promise.all(clearPromises);
        },
        async renderAllTargets() {
            let renderPromises = this.renderers.map(r => {
                return r.render(this.syncStep);
            });
            await Promise.all(renderPromises);
        }
    }
}

export {Arrangement as Arrangement}
