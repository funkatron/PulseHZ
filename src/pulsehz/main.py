#!/usr/bin/env python3
"""Main entry point for PulseHZ Video Glitch Tool"""

import argparse
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

# Add the src directory to the path so we can import our modules
sys.path.insert(0, str(Path(__file__).parent.parent))

import uvicorn

from pulsehz.constants import DEFAULT_LISTEN_PORT

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
        default=DEFAULT_LISTEN_PORT,
        help=f"Port for web server (default: {DEFAULT_LISTEN_PORT})",
    )
    parser.add_argument(
        "--version",
        action="version",
        version="PulseHZ Video Glitch Tool v1.0.0"
    )

    args = parser.parse_args()

    if args.mode == "desktop":
        from pulsehz.desktop_app import DesktopApp

        print("🎬 Starting PulseHZ Video Glitch Tool (Desktop Mode)")
        print("📁 Loading desktop application...")

        # Import here to avoid GUI issues in server mode
        from PyQt6.QtCore import Qt
        from PyQt6.QtWidgets import QApplication
        import sys

        QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
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

def run_server(host: str = "0.0.0.0", port: int = DEFAULT_LISTEN_PORT) -> None:
    """Action: run the FastAPI server."""
    print("🎬 Starting PulseHZ Video Glitch Tool (Server Mode)")
    print(f"🌐 Server will be available at http://{host}:{port}")
    print("💡 Make sure FFmpeg is installed and in PATH")

    uvicorn.run(
        "pulsehz.server:app",
        host=host,
        port=port,
        reload=False,
        access_log=True
    )

def run_desktop() -> None:
    """Action: run the desktop app."""
    from pulsehz.desktop_app import DesktopApp

    print("🎬 Starting PulseHZ Video Glitch Tool (Desktop Mode)")
    print("📁 Loading desktop application...")

    from PyQt6.QtCore import Qt
    from PyQt6.QtWidgets import QApplication
    import sys as _sys

    QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    qapp = QApplication(_sys.argv)
    window = DesktopApp()
    window.show()
    print("✅ Desktop app started successfully!")
    _sys.exit(qapp.exec())


def run_client(host: str = "127.0.0.1", port: int = DEFAULT_LISTEN_PORT) -> None:
    """Start the local API server if needed, then open the browser app (/app/)."""
    base = f"http://{host}:{port}"
    health_url = f"{base}/api/health"
    app_url = f"{base}/app/"

    def _server_ready() -> bool:
        try:
            response = urllib.request.urlopen(health_url, timeout=1)
            return response.getcode() == 200
        except Exception:
            return False

    if _server_ready():
        print(f"Using existing server — opening {app_url}")
        webbrowser.open(app_url)
        return

    print("🎬 Starting PulseHZ server for browser client")
    print(f"🌐 Will open {app_url}")
    print("💡 Make sure FFmpeg is installed and in PATH")
    print("Stop with Ctrl+C.")

    def _serve() -> None:
        uvicorn.run(
            "pulsehz.server:app",
            host=host,
            port=port,
            reload=False,
            access_log=True,
        )

    thread = threading.Thread(target=_serve, daemon=True, name="pulsehz-uvicorn")
    thread.start()

    for _ in range(150):
        if _server_ready():
            break
        time.sleep(0.2)
    else:
        print("Server did not become ready in time.")
        sys.exit(1)

    webbrowser.open(app_url)

    try:
        thread.join()
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    main()