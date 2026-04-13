import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PyQt6.QtCore import QUrl

from pulsehz.constants import DEFAULT_LISTEN_PORT
from PyQt6.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

try:
    from PyQt6.QtWebEngineCore import QWebEnginePage  # type: ignore
    from PyQt6.QtWebEngineWidgets import QWebEngineView  # type: ignore

    class _ConsoleMirrorPage(QWebEnginePage):
        """PyQt6 only exposes JS console as a virtual method, not a signal."""

        def __init__(self, on_console, parent=None):
            super().__init__(parent)
            self._on_console = on_console

        def javaScriptConsoleMessage(self, level, message, line_number, source_id):
            super().javaScriptConsoleMessage(level, message, line_number, source_id)
            self._on_console(level, message, line_number, source_id)

except Exception:  # pragma: no cover
    QWebEngineView = None  # type: ignore
    _ConsoleMirrorPage = None  # type: ignore


class DesktopApp(QMainWindow):
    """Thin desktop shell for the browser-first PulseHZ app."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("PulseHZ")
        self.setGeometry(100, 100, 1440, 920)
        self.server_process = None

        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)

        controls = QWidget()
        controls_layout = QHBoxLayout(controls)
        controls_layout.setContentsMargins(8, 8, 8, 8)

        self.reload_button = QPushButton("Reload App")
        self.reload_button.clicked.connect(self.reload_app)
        controls_layout.addWidget(self.reload_button)

        self.export_button = QPushButton("Export ProRes")
        self.export_button.clicked.connect(self.export_video)
        controls_layout.addWidget(self.export_button)

        self.status_label = QLabel("Starting PulseHZ browser app...")
        controls_layout.addWidget(self.status_label)

        layout.addWidget(controls)

        self.web_view = QWebEngineView() if QWebEngineView is not None else None
        if self.web_view is not None and _ConsoleMirrorPage is not None:
            self.web_view.setPage(_ConsoleMirrorPage(self.handle_console_message))
            layout.addWidget(self.web_view, stretch=1)

        self.ensure_server_running()

        if self.web_view is None:
            self.status_label.setText(
                "Qt WebEngine missing: install pyqt6-webengine (e.g. uv sync) and restart."
            )
        else:
            self.reload_app()

    def ensure_server_running(self) -> None:
        """Check if the FastAPI server is running, and start it if not."""
        if self.check_server_status():
            self.status_label.setText("Server connected")
            return

        self.status_label.setText("Starting server...")
        try:
            # Checkout layout: package lives under src/. Subprocess has no run_desktop.py path injection.
            src_root = Path(__file__).resolve().parents[1]
            env = os.environ.copy()
            prev = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = str(src_root) + (os.pathsep + prev if prev else "")
            self.server_process = subprocess.Popen(
                [sys.executable, "-m", "pulsehz.main", "--mode", "server"],
                env=env,
            )
        except Exception as exc:
            self.status_label.setText("Failed to start server")
            QMessageBox.critical(
                self,
                "Server Error",
                f"Failed to start FastAPI server automatically.\n\nError: {exc}",
            )
            return

        for attempt in range(30):
            if self.check_server_status():
                self.status_label.setText("Server started")
                return
            time.sleep(1)
            self.status_label.setText(f"Waiting for server... ({attempt + 1}/30)")

        self.status_label.setText("Server failed to start")
        QMessageBox.critical(
            self,
            "Server Error",
            "FastAPI server could not be started automatically.\n\nRun `uv run pulsehz-server` manually.",
        )

    def check_server_status(self) -> bool:
        """Check if the FastAPI server is running."""
        try:
            response = urllib.request.urlopen(
                f"http://127.0.0.1:{DEFAULT_LISTEN_PORT}/api/health", timeout=2
            )
            return response.getcode() == 200
        except Exception:
            return False

    def reload_app(self) -> None:
        """Reload the browser-first app shell."""
        if self.web_view is None:
            return
        self.web_view.setUrl(QUrl(f"http://127.0.0.1:{DEFAULT_LISTEN_PORT}/app/"))
        self.status_label.setText("PulseHZ app loaded")

    def export_video(self) -> None:
        """Delegate export to the browser app."""
        if self.web_view is None:
            return
        self.status_label.setText("Export requested in browser app")
        self.web_view.page().runJavaScript(
            "window.pulsehzApp && window.pulsehzApp.exportHighQuality && window.pulsehzApp.exportHighQuality();"
        )

    def handle_console_message(self, level, message, line, source) -> None:
        """Mirror app events into the shell status line."""
        if message and "PulseHZ:" in message:
            self.status_label.setText(message.replace("PulseHZ: ", "", 1))


def main() -> None:
    from PyQt6.QtCore import Qt

    QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    app = QApplication(sys.argv)
    window = DesktopApp()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()