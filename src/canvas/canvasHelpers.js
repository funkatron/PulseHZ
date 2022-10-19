export default {
    async clearCanvas(canvas) {
        let ctx = canvas.getContext('2d')
        let clearX = 0 - canvas.width;
        let clearY = 0 - canvas.height;
        let clearWidth = canvas.width * 3;
        let clearHeight = canvas.height * 3;
        ctx.clearRect(clearX, clearY, clearWidth, clearHeight);
    }
}
