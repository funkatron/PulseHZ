"""FastAPI application: compose routers and static `/app` shell."""

from __future__ import annotations

from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pulsehz.api_models import (
    ExportSettings,
    LayerMetadata,
    ProjectMetadata,
    TransportSettings,
)
from pulsehz.constants import DEFAULT_LISTEN_PORT
from pulsehz.routes.export_video import router as export_video_router
from pulsehz.routes.meta import router as meta_router
from pulsehz.routes.preview_video import router as preview_video_router

APP_DIR = Path(__file__).resolve().parents[2]
PUBLIC_DIR = APP_DIR / "public"

app = FastAPI(title="PulseHZ Video Export API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta_router)
app.include_router(export_video_router)
app.include_router(preview_video_router)

if PUBLIC_DIR.exists():
    app.mount("/app", StaticFiles(directory=PUBLIC_DIR, html=True), name="app")

if __name__ == "__main__":
    print("🎬 PulseHZ Video Export API Starting...")
    print("🔧 ProRes export endpoint: /api/export-video")
    print(f"🌐 API at: http://localhost:{DEFAULT_LISTEN_PORT}")
    print(f"🖥️ Browser app at: http://localhost:{DEFAULT_LISTEN_PORT}/app/")
    print("💡 Make sure FFmpeg is installed and in PATH")
    print("⚡ FastAPI server with optimized performance")

    uvicorn.run(
        "pulsehz.server:app",
        host="0.0.0.0",
        port=DEFAULT_LISTEN_PORT,
        reload=False,
        workers=1,
        loop="asyncio",
        access_log=True,
    )
