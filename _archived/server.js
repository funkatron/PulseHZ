const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static('examples'));

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// API endpoint for video export
app.post('/api/export-video', async (req, res) => {
    try {
        const projectData = req.body;

        // Create temporary directory for processing
        const tempDir = path.join(__dirname, 'temp', Date.now().toString());
        fs.mkdirSync(tempDir, { recursive: true });

        // Process each layer
        const layerFiles = [];
        for (const layer of projectData.layers) {
            if (layer.hasVideo && layer.videoData) {
                // Convert base64 to video file
                const videoBuffer = Buffer.from(layer.videoData.split(',')[1], 'base64');
                const layerFile = path.join(tempDir, `layer-${layer.id}.mp4`);
                fs.writeFileSync(layerFile, videoBuffer);
                layerFiles.push({
                    file: layerFile,
                    blendMode: layer.blendMode,
                    id: layer.id
                });
            }
        }

        // Create FFmpeg command for ProRes output
        const outputFile = path.join(tempDir, 'output.mov');
        let command = ffmpeg();

        // Add input files with blend modes
        layerFiles.forEach(layer => {
            command = command.input(layer.file);
        });

        // Complex filter for blend modes
        const filterComplex = layerFiles.map((layer, index) => {
            const inputIndex = index;
            const blendMode = layer.blendMode;

            // Convert CSS blend modes to FFmpeg blend modes
            const ffmpegBlendMode = {
                'normal': 'over',
                'multiply': 'multiply',
                'screen': 'screen',
                'overlay': 'overlay',
                'darken': 'darken',
                'lighten': 'lighten',
                'color-dodge': 'colordodge',
                'color-burn': 'colorburn',
                'hard-light': 'hardlight',
                'soft-light': 'softlight',
                'difference': 'difference',
                'exclusion': 'exclusion',
                'hue': 'hue',
                'saturation': 'saturation',
                'color': 'color',
                'luminosity': 'luminosity'
            }[blendMode] || 'over';

            return `[${inputIndex}:v]format=yuva444p10le[${inputIndex}formatted]`;
        }).join(';') + ';' +
        layerFiles.map((layer, index) => {
            if (index === 0) {
                return `[0formatted]`;
            } else {
                const blendMode = {
                    'normal': 'over',
                    'multiply': 'multiply',
                    'screen': 'screen',
                    'overlay': 'overlay',
                    'darken': 'darken',
                    'lighten': 'lighten',
                    'color-dodge': 'colordodge',
                    'color-burn': 'colorburn',
                    'hard-light': 'hardlight',
                    'soft-light': 'softlight',
                    'difference': 'difference',
                    'exclusion': 'exclusion',
                    'hue': 'hue',
                    'saturation': 'saturation',
                    'color': 'color',
                    'luminosity': 'luminosity'
                }[layer.blendMode] || 'over';

                return `[tmp${index-1}][${index}formatted]blend=${blendMode}[tmp${index}]`;
            }
        }).join(';') + ';' +
        `[tmp${layerFiles.length-1}]format=yuv420p`;

        command
            .complexFilter(filterComplex)
            .outputOptions([
                '-c:v prores_ks',
                '-profile:v 4', // ProRes 4444
                '-pix_fmt yuv444p10le',
                '-r 60', // 60fps
                '-s 1920x1080'
            ])
            .output(outputFile)
            .on('end', () => {
                // Send the ProRes file
                res.sendFile(outputFile, (err) => {
                    // Cleanup
                    fs.rmSync(tempDir, { recursive: true, force: true });
                });
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                res.status(500).json({ error: 'Video processing failed' });
            })
            .run();

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
});

app.listen(port, () => {
    console.log(`Video export server running on http://localhost:${port}`);
    console.log('Make sure FFmpeg is installed and available in PATH');
});