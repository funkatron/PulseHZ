import valueHelpers from "../valueHelpers.js";

export default {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{x: Number?, y: Number?, rotation: Number?}?} options
     * @param {Number} options.x the x position of the canvas. Default is 0
     * @param {Number} options.y the y position of the canvas. Default is 0
     *
     * @returns {CanvasRenderingContext2D}
     */
    renderXYAxes(canvas, options) {  // x = NaN, y = NaN, rotation = NaN) {
        const ctx = canvas.getContext('2d')

        let x = canvas.width / 2;
        let y = canvas.height / 2;
        let rotation = 0;

        let canvasXRange = [0, canvas.width];
        let canvasYRange = [0, canvas.height];
        let bleedX = 0;
        let bleedY = 0;

        if (options && options["rotation"]) {
            // if we are rotating, we should draw "wider" so that the axes don't get cut off
            canvasXRange = [0 - canvas.width, canvas.width * 3];
            canvasYRange = [0 - canvas.height, canvas.height * 3];
            bleedX = canvas.width;
            bleedY = canvas.height;
            rotation = options["rotation"];
        }

        if (options && options["x"]) {
            x = valueHelpers.scaleValue(options["x"], canvasXRange);
        }

        if (options && options["y"]) {
            y = valueHelpers.scaleValue(options["y"], canvasYRange);
        }

        // rotate the canvas if needed
        if (rotation !== 0) {
            // translate to rotate around the center of the canvas
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(rotation);
            // translate back to the original position
            ctx.translate(-(canvas.width / 2), -(canvas.height / 2));
        }

        // draw the X axis line
        ctx.beginPath();
        ctx.moveTo(0 - bleedX, y);
        ctx.lineTo(canvas.width + bleedX, y);
        ctx.stroke();

        // draw the Y axis line
        ctx.beginPath();
        ctx.moveTo(x, 0 - bleedY);
        ctx.lineTo(x, canvas.height + bleedY);
        ctx.stroke();

        return ctx
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue the value from the value function of the renderer
     * @param options
     */
    renderCircle(canvas, genValue, options = {}) {
        const circleRadius = canvas.height / 2;
        const circleX = 0;
        const circleY = valueHelpers.scaleValue(genValue, [0, canvas.height]);

        let ctx = canvas.getContext('2d')
        ctx.beginPath()
        ctx.arc(
            options.x || circleX,
            options.y || circleY,
            options.radius || circleRadius,
            0,
            2 * Math.PI
        )
        ctx.fillStyle = options.fillStyle || 'black'
        // ctx.fill();
        ctx.stroke();
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue
     */
    renderRedVerticalLine(canvas, genValue) {
        let ctx = canvas.getContext('2d');
        // draw a line from top to bottom of the canvas
        let line_x = valueHelpers.scaleValue(genValue, [0, canvas.width])
        let line_width = valueHelpers.scaleValue(genValue, [1, canvas.width / 2])

        ctx.beginPath()
        ctx.moveTo(line_x, 0)
        ctx.lineTo(line_x, canvas.height)
        ctx.strokeStyle = "red";
        ctx.lineWidth = line_width;
        ctx.stroke();
        ctx.closePath();

        // this.renderText(canvas, `GEN:${genValue} \\\ SCALED ${line_x}`);
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue
     */
    renderGreenCircles(canvas, genValue) {
        let ctx = canvas.getContext('2d')
        let dot_val = valueHelpers.scaleValue(genValue, [0, canvas.width])
        let radius_val = valueHelpers.scaleValue(genValue, [0, canvas.width / 2])
        ctx.beginPath()
        ctx.arc(0 + dot_val, 0 + dot_val, Math.abs(radius_val), 0, 2 * Math.PI)
        ctx.strokeStyle = "green";
        ctx.stroke()
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue
     */
    renderCircleLine(canvas, genValue) {
        let ctx = document.getElementById('canvas4').getContext('2d')
        ctx.beginPath()
        genValue = valueHelpers.scaleValue(genValue, [0 - (canvas.width / 2), canvas.width / 2]);
        // this.renderText(canvas, `GEN:${genValue}`);
        ctx.arc(canvas.width / 2 + genValue, canvas.height / 2 - genValue, Math.abs(genValue), 0, 20)
        ctx.strokeStyle = "black";
        ctx.stroke()
    },

    /**
     * @param {HTMLElement} canvas
     * @param {Number|string} text
     * @param {{}|{x: number, y: Number, fillStyle: string, font: string}} options
     */
    renderText(canvas, text, options) {
        let ctx = canvas.getContext('2d');

        let x = 5
        let y = canvas.height - 17;
        let font = "12px Deja Vu Sans Mono";
        let fillStyle = "black";

        if (options && options["x"]) {
            x = valueHelpers.scaleValue(options["x"], [0, canvas.width]);
        }
        if (options && options["y"]) {
            y = valueHelpers.scaleValue(options["y"], [0, canvas.height]);
        }


        // save existing context
        const oldFillStyle = ctx.fillStyle;
        const oldFont = ctx.font;

        if (options && options["font"]) {
            ctx.font = options["font"];
        }
        if (options && options["fillStyle"]) {
            ctx.fillStyle = options["fillStyle"];
        }

        ctx.fillText(text, x, y);

        // restore old context
        ctx.fillStyle = oldFillStyle;
        ctx.font = oldFont;
    },

    async clearCanvas(canvas) {
        let ctx = canvas.getContext('2d')
        let clearX = 0 - canvas.width;
        let clearY = 0 - canvas.height;
        let clearWidth = canvas.width * 3;
        let clearHeight = canvas.height * 3;
        ctx.clearRect(clearX, clearY, clearWidth, clearHeight);
    }
}
