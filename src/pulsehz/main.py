#!/usr/bin/env python3
"""Main entry point for PulseHZ Video Glitch Tool"""

import sys
import argparse
from pathlib import Path

# Add the src directory to the path so we can import our modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from pulsehz.desktop_app import DesktopApp
from pulsehz.server import app
import uvicorn

def main():
    """Main entry point for the application"""
    parser = argparse.ArgumentParser(
        description="PulseHZ Video Glitch Tool - Desktop video glitch and blending tool"
    )
    parser.add_argument(
        "--mode",
        choices=["desktop", "server"],
        default="desktop",
        help="Run mode: desktop app or web server (default: desktop)"
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host for web server (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port for web server (default: 8000)"
    )
    parser.add_argument(
        "--version",
        action="version",
        version="PulseHZ Video Glitch Tool v1.0.0"
    )

    args = parser.parse_args()

    if args.mode == "desktop":
        print("🎬 Starting PulseHZ Video Glitch Tool (Desktop Mode)")
        print("📁 Loading desktop application...")

        # Import here to avoid GUI issues in server mode
        from PyQt6.QtWidgets import QApplication
        import sys

        app = QApplication(sys.argv)
        window = DesktopApp()
        window.show()

        print("✅ Desktop app started successfully!")
        sys.exit(app.exec())

    elif args.mode == "server":
        print("🎬 Starting PulseHZ Video Glitch Tool (Server Mode)")
        print(f"🌐 Server will be available at http://{args.host}:{args.port}")
        print("💡 Make sure FFmpeg is installed and in PATH")

        uvicorn.run(
            "pulsehz.server:app",
            host=args.host,
            port=args.port,
            reload=False,
            access_log=True
        )

if __name__ == "__main__":
    main()