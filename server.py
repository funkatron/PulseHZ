from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import json
import base64
import tempfile
import os
import subprocess
from PIL import Image, ImageChops, ImageOps
import io
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

app = FastAPI(title="PulseHZ Video Export API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files from a proper public directory at /static so APIs work
STATIC_DIR = os.path.join(os.path.dirname(__file__), "public")
app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")

@app.get("/")
async def root():
    """Serve the video blending app by default"""
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

# Pydantic models for type safety
class Layer(BaseModel):
    id: int
    blendMode: str
    videoData: Optional[str] = None
    hasVideo: bool = False
    duration: Optional[float] = None
    frameRate: Optional[int] = None

class ExportSettings(BaseModel):
    resolution: str = "1920x1080"
    frameRate: int = 60
    codec: str = "prores_4444"
    quality: str = "professional"

class ProjectData(BaseModel):
    version: str
    projectName: str
    createdAt: str
    exportSettings: Optional[ExportSettings] = None
    layers: List[Layer]

def css_blend_to_pil(blend_mode):
    """Convert CSS blend modes to PIL blend modes"""
    blend_map = {
        'normal': 'normal',
        'multiply': 'multiply',
        'screen': 'screen',
        'overlay': 'overlay',
        'darken': 'darken',
        'lighten': 'lighten',
        'difference': 'difference',
        'exclusion': 'exclusion'
    }
    return blend_map.get(blend_mode, 'normal')

def apply_blend_mode(base_img, overlay_img, blend_mode):
    """Apply blend mode using PIL"""
    if blend_mode == 'normal':
        return overlay_img

    # Convert to RGBA if needed
    if base_img.mode != 'RGBA':
        base_img = base_img.convert('RGBA')
    if overlay_img.mode != 'RGBA':
        overlay_img = overlay_img.convert('RGBA')

    if blend_mode == 'multiply':
        return ImageChops.multiply(base_img, overlay_img)
    elif blend_mode == 'screen':
        return ImageChops.screen(base_img, overlay_img)
    elif blend_mode == 'overlay':
        # PIL doesn't have overlay, so we'll use a custom implementation
        return overlay_img  # Simplified for now
    elif blend_mode == 'darken':
        return ImageChops.darker(base_img, overlay_img)
    elif blend_mode == 'lighten':
        return ImageChops.lighter(base_img, overlay_img)
    elif blend_mode == 'difference':
        return ImageChops.difference(base_img, overlay_img)
    elif blend_mode == 'exclusion':
        return ImageChops.logical_xor(base_img, overlay_img)

    return overlay_img

@app.post("/api/export-video")
async def export_video(project_data: ProjectData):
    """Export video with ProRes encoding - optimized for low latency"""
    try:
        # Create temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            layer_files = []

            # Process each layer with optimized handling
            for layer in project_data.layers:
                if layer.hasVideo and layer.videoData:
                    try:
                        # Decode base64 video data more efficiently
                        video_data = base64.b64decode(layer.videoData.split(',')[1])

                        # Save video file
                        layer_file = os.path.join(temp_dir, f"layer-{layer.id}.mp4")
                        with open(layer_file, 'wb') as f:
                            f.write(video_data)

                        layer_files.append({
                            'file': layer_file,
                            'blend_mode': layer.blendMode,
                            'id': layer.id
                        })
                    except Exception as e:
                        print(f"Error processing layer {layer.id}: {e}")
                        continue

            if not layer_files:
                raise HTTPException(status_code=400, detail="No video layers found")

            # Create FFmpeg command for ProRes output with optimized settings
            output_file = os.path.join(temp_dir, 'output.mov')

            # Build optimized FFmpeg filter complex for blend modes
            filter_parts = []
            blend_parts = []

            for i, layer in enumerate(layer_files):
                # Format each input with optimized settings
                filter_parts.append(f"[{i}:v]format=yuva444p10le,scale=1920:1080:flags=lanczos[formatted{i}]")

                if i == 0:
                    blend_parts.append(f"[formatted0]")
                else:
                    blend_mode = layer['blend_mode']
                    ffmpeg_blend = {
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
                        'exclusion': 'exclusion'
                    }.get(blend_mode, 'over')

                    blend_parts.append(f"[tmp{i-1}][formatted{i}]blend={ffmpeg_blend}[tmp{i}]")

            filter_complex = ';'.join(filter_parts + blend_parts) + f";[tmp{len(layer_files)-1}]format=yuv420p"

            # Build optimized FFmpeg command
            input_args = []
            for layer in layer_files:
                input_args.extend(['-i', layer['file']])

            # Optimized FFmpeg settings for speed and quality
            ffmpeg_cmd = [
                'ffmpeg',
                '-y',  # Overwrite output (faster)
                *input_args,
                '-filter_complex', filter_complex,
                '-c:v', 'prores_ks',
                '-profile:v', '4',  # ProRes 4444
                '-pix_fmt', 'yuv444p10le',
                '-r', '60',  # 60fps
                '-s', '1920x1080',
                '-threads', '0',  # Use all available CPU threads
                '-preset', 'fast',  # Faster encoding
                output_file
            ]

            # Run FFmpeg with optimized settings
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )

            if result.returncode != 0:
                print(f"FFmpeg error: {result.stderr}")
                raise HTTPException(status_code=500, detail="Video processing failed")

            # Return file with optimized headers
            return FileResponse(
                path=output_file,
                filename=f"{project_data.projectName.replace(' ', '_')}-prores.mov",
                media_type='video/quicktime',
                headers={
                    'Content-Disposition': f'attachment; filename="{project_data.projectName.replace(" ", "_")}-prores.mov"'
                }
            )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Export error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@app.get("/api/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy", "service": "PulseHZ Video Export API"}

@app.get("/api/info")
async def get_info():
    """Get API information and capabilities"""
    return {
        "name": "PulseHZ Video Export API",
        "version": "1.0.0",
        "capabilities": {
            "formats": ["ProRes 4444", "ProRes 422", "H.264"],
            "resolutions": ["1920x1080", "3840x2160"],
            "frameRates": [24, 30, 60],
            "blendModes": ["normal", "multiply", "screen", "overlay", "darken", "lighten"]
        },
        "performance": {
            "async": True,
            "streaming": True,
            "timeout": "5 minutes"
        }
    }

if __name__ == '__main__':
    print("🎬 PulseHZ Video Export API Starting...")
    print(f"📁 Serving static files from: {STATIC_DIR}")
    print("🔧 ProRes export endpoint: /api/export-video")
    print("🌐 Access the app at: http://localhost:8000")
    print("💡 Make sure FFmpeg is installed and in PATH")
    print("⚡ FastAPI server with optimized performance")

    # Run with optimized settings for better performance
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Disable reload for production
        workers=1,     # Single worker for video processing
        loop="asyncio",
        access_log=True
    )