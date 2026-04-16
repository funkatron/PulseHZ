"""Root JSON, health, and capability discovery."""

from __future__ import annotations

from fastapi import APIRouter

from pulsehz.rendering import SUPPORTED_BLEND_MODES

router = APIRouter(tags=["meta"])


@router.get("/")
async def root():
    """Root endpoint returns API metadata."""
    return {
        "service": "PulseHZ Video Export API",
        "version": "1.0.0",
        "status": "ok",
        "app": "/app/",
    }


@router.get("/api/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy", "service": "PulseHZ Video Export API"}


@router.get("/api/info")
async def get_info():
    """Get API information and capabilities"""
    return {
        "name": "PulseHZ Video Export API",
        "version": "1.0.0",
        "capabilities": {
            "formats": ["ProRes 4444 (yuv444p10le)", "ProRes 4444+alpha (yuva444p10le)", "ProRes 422", "H.264"],
            "resolutions": [
                "1280x720",
                "1920x1080",
                "3840x2160",
                "720x1280",
                "1080x1920",
                "2160x3840",
                "1680x720",
                "2520x1080",
                "5040x2160",
                "720x1680",
                "1080x2520",
                "2160x5040",
                "720x720",
                "1080x1080",
                "2160x2160",
                "720x1720",
                "1440x3440",
            ],
            "frameRates": [24, 30, 60],
            "blendModes": SUPPORTED_BLEND_MODES,
        },
        "performance": {
            "async": True,
            "streaming": True,
            "timeout": "5 minutes",
        },
    }
