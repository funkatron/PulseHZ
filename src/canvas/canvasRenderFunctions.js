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
            rotation = options["rotation"];
        }

        if (options && options["x"]) {
            x = valueHelpers.scaleToLogValue(options["x"], canvasXRange);
        }

        if (options && options["y"]) {
            y = valueHelpers.scaleValue(options["y"], canvasYRange);
        }

        // backup the current ctx options
        const prevFillStyle = ctx.fillStyle;
        const prevStrokeStyle = ctx.strokeStyle;
        const prevLineWidth = ctx.lineWidth;

        ctx.strokeStyle = options.strokeStyle || "black";
        ctx.fillStyle = options.fillStyle || "black";
        ctx.lineWidth = options.lineWidth || 1;

        // draw an x axis and a y axis in the middle of the canvas, rotated if necessary
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.beginPath();
        ctx.moveTo(-canvas.width - bleedX, 0);
        ctx.lineTo(canvas.width + bleedX, 0);
        ctx.moveTo(0, -canvas.height - bleedY);
        ctx.lineTo(0, canvas.height + bleedY);

        // draw dashes on the X axis
        const NUM_DASHES = 10;
        for (let i = -canvas.width - bleedX; i < canvas.width + bleedX; i += NUM_DASHES) {
            ctx.moveTo(i, 0);
            ctx.lineTo(i, 5);

        }

        ctx.stroke();
        ctx.restore();

        // restore the previous ctx options
        ctx.fillStyle = prevFillStyle;
        ctx.strokeStyle = prevStrokeStyle;
        ctx.lineWidth = prevLineWidth;

        return ctx;
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
        const startAngle = 0;
        const endAngle = 2 * Math.PI;

        if (options.fill !== false) {
            options.fill = true;
        }
        if (options.stroke !== false) {
            options.stroke = true;
        }

        let ctx = canvas.getContext('2d')
        ctx.beginPath()
        ctx.arc(
            options.x || circleX,
            options.y || circleY,
            options.radius || circleRadius,
            options.startAngle || startAngle,
            options.endAngle || endAngle
        )

        // store previous ctx options
        const previousFillStyle = ctx.fillStyle;
        const previousStrokeStyle = ctx.strokeStyle;
        const previousLineWidth = ctx.lineWidth;

        if (options.fillStyle) {
            ctx.fillStyle = options.fillStyle || "black";
        }
        if (options.strokeStyle) {
            ctx.strokeStyle = options.strokeStyle || "black";
        }
        if (options.lineWidth) {
            ctx.lineWidth = options.lineWidth || 1;
        }

        if (!!options.fill) {
            ctx.fill();
        }
        if (!!options.stroke) {
            ctx.stroke();
        }

        // restore previous ctx options
        ctx.fillStyle = previousFillStyle;
        ctx.strokeStyle = previousStrokeStyle;
        ctx.lineWidth = previousLineWidth;
    },

    /**
     * draws a line on the canvas. Genvalue is the y value of the line by default.
     * @param canvas
     * @param genValue
     * @param {x1, y1, x2, y2, strokeStyle, lineWidth} options
     */
    renderLine(canvas, genValue, options = {}) {
        const ctx = canvas.getContext('2d')

        // store previous ctx options
        const previousStrokeStyle = ctx.strokeStyle;
        const previousLineWidth = ctx.lineWidth;

        ctx.beginPath()
        ctx.moveTo(options.x1 || 0, options.y1 || 0);
        ctx.lineTo(options.x2 || canvas.width, options.y2 || valueHelpers.scaleValue(genValue, [0, canvas.height]));
        ctx.strokeStyle = options.strokeStyle || "black";
        ctx.lineWidth = options.lineWidth || 1;
        ctx.stroke();

        // restore previous ctx options
        ctx.strokeStyle = previousStrokeStyle;
        ctx.lineWidth = previousLineWidth;
    },

    renderCircleGrid(canvas, genValue, options = {}) {

        let colorScaleValue = valueHelpers.scaleValue(genValue, [0, 255]);

        function getXYColor(x, y) {
            return `rgba(${Math.floor(colorScaleValue - 1 * (x + y))}, ${Math.floor(colorScaleValue - 1 * x)}, ${Math.floor(colorScaleValue - 1 * y)}, 0.5)`;
        }

        function getArcXY(row, col, radius, padding = 5) {
            const width = radius * 2 + padding;
            const height = radius * 2 + padding;

            if (!row) {
                row = 0;
            }

            if (!col) {
                col = 0;
            }

            return {
                x: (col * width),
                y: (row * height),
            }
        }

        options = {
            lineWidth: 1,
            strokeStyle: getXYColor(0, 0),
            fill: false,
            stroke: true,
            radius: canvas.height / 64,
            padding: 0,
            ...options
        };

        const ctx = canvas.getContext('2d')

        // store previous ctx options
        const previousStrokeStyle = ctx.strokeStyle;
        const previousLineWidth = ctx.lineWidth;
        const previousFillStyle = ctx.fillStyle;

        const gridCellWidth = getArcXY(1, 1, options.radius).x
        const maxRows = Math.ceil(canvas.width / gridCellWidth);
        const maxCols = Math.ceil(valueHelpers.scaleValue(genValue, [0, canvas.width]) / gridCellWidth);

        for (let rowIdx = 0; rowIdx <= maxRows; rowIdx++) {
            for (let colIdx = 0; colIdx <= maxCols; colIdx++) {
                ctx.strokeStyle = getXYColor(rowIdx, colIdx);
                ctx.fillStyle = getXYColor(rowIdx, colIdx);
                ctx.lineWidth = options.lineWidth;
                ctx.beginPath();
                ctx.arc(getArcXY(rowIdx, colIdx, options.radius).x, getArcXY(rowIdx, colIdx, options.radius).y, options.radius, 0, 2 * Math.PI);
                // ctx.arc(options.padding + colIdx * (options.radius * 2 + options.padding / 2), options.padding + rowIdx * (options.radius * 2 + options.padding / 2), options.radius, 0, Math.PI * 2, true);
                if (!!options.stroke) {
                    ctx.stroke();
                }
                if (!!options.fill) {
                    ctx.fill();
                }
            }
        }

        // restore previous ctx options
        ctx.strokeStyle = previousStrokeStyle;
        ctx.lineWidth = previousLineWidth;
        ctx.fillStyle = previousFillStyle;
    },


    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue
     */
    renderRedVerticalLine(canvas, genValue) {
        let ctx = canvas.getContext('2d');
        // draw a line from top to bottom of the canvas
        let lineX = valueHelpers.scaleValue(genValue, [0, canvas.width])
        let lineWidth = valueHelpers.scaleToLogValue(genValue, [1, lineX / 2])
        lineX = lineX - lineWidth / 2;

        // store previous ctx options
        const previousStrokeStyle = ctx.strokeStyle;
        const previousLineWidth = ctx.lineWidth;
        const previousFillStyle = ctx.fillStyle;

        ctx.strokeStyle = "rgba(0, 0, 0, 1)";
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.fillRect(lineX, 0, lineWidth, canvas.height);
        ctx.strokeRect(lineX, 0, lineWidth, canvas.height);

        // restore previous ctx options
        ctx.strokeStyle = previousStrokeStyle;
        ctx.lineWidth = previousLineWidth;
        ctx.fillStyle = previousFillStyle;
        // this.renderText(canvas, `GEN:${genValue} \\\ SCALED ${line_x}`);
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue
     */
    renderRedHorizontalLine(canvas, genValue) {
        let ctx = canvas.getContext('2d');
        // draw a line from top to bottom of the canvas
        let lineY = valueHelpers.scaleValue(genValue, [0, canvas.height])
        let lineWidth = valueHelpers.scaleToLogValue(genValue, [1, lineY / 2])
        lineY = lineY - lineWidth / 2;

        // store previous ctx options
        const previousStrokeStyle = ctx.strokeStyle;
        const previousLineWidth = ctx.lineWidth;
        const previousFillStyle = ctx.fillStyle;

        // get color based on gen value
        ctx.strokeStyle = "rgba(0, 0, 0, 1)";
        ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
        ctx.fillRect(0, lineY, canvas.width, lineWidth);
        ctx.strokeRect(0, lineY, canvas.width, lineWidth);

        // restore previous ctx options
        ctx.strokeStyle = previousStrokeStyle;
        ctx.lineWidth = previousLineWidth;
        ctx.fillStyle = previousFillStyle;
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue
     */
    renderCornerZoomCircles(canvas, genValue) {
        let ctx = canvas.getContext('2d')

        // store previous ctx options
        const previousStrokeStyle = ctx.strokeStyle;
        const previousLineWidth = ctx.lineWidth;

        let dot_val = valueHelpers.scaleValue(genValue, [0, canvas.width])
        let radius_val = valueHelpers.scaleValue(genValue, [0, canvas.width / 2])
        ctx.beginPath()
        ctx.arc(dot_val, dot_val, Math.abs(radius_val), 0, 2 * Math.PI)

        // a purple circle
        ctx.strokeStyle = "rgb(114,22,194)";

        ctx.lineWidth = 8;
        ctx.stroke();

        // restore previous ctx options
        ctx.strokeStyle = previousStrokeStyle;
        ctx.lineWidth = previousLineWidth;
    },

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Number} genValue
     */
    renderCircleLine(canvas, genValue) {
        let ctx = canvas.getContext('2d')

        // store previous ctx options
        const previousStrokeStyle = ctx.strokeStyle;
        const previousLineWidth = ctx.lineWidth;

        ctx.beginPath()
        genValue = valueHelpers.scaleValue(genValue, [0 - (canvas.width / 2), canvas.width / 2]);
        // this.renderText(canvas, `GEN:${genValue}`);
        ctx.arc(canvas.width / 2 + genValue, canvas.height / 2 - genValue, Math.abs(genValue), 0, 20)
        ctx.strokeStyle = "black";
        ctx.lineWidth = 8;
        ctx.stroke()

        // restore previous ctx options
        ctx.strokeStyle = previousStrokeStyle;
        ctx.lineWidth = previousLineWidth;
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
