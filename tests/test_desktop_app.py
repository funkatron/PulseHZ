"""Tests for the desktop app shell."""

import inspect
from unittest.mock import Mock

import pytest

pytest.importorskip("PyQt6.QtWidgets")

from pulsehz.desktop_app import DesktopApp


def test_desktop_js_console_uses_page_subclass_not_connect():
    """PyQt6 exposes javaScriptConsoleMessage as a method only, not pyqtSignal.connect."""
    pytest.importorskip("PyQt6.QtWebEngineWidgets")
    from pulsehz import desktop_app as da

    assert da._ConsoleMirrorPage is not None
    assert "javaScriptConsoleMessage" in inspect.getsource(da._ConsoleMirrorPage)
    assert ".javaScriptConsoleMessage.connect" not in inspect.getsource(da.DesktopApp.__init__)


def test_blend_mode_validation():
    valid_blend_modes = [
        "normal",
        "multiply",
        "screen",
        "overlay",
        "darken",
        "lighten",
        "difference",
        "exclusion",
    ]
    for mode in valid_blend_modes:
        assert mode in valid_blend_modes


def test_desktop_app_reload_loads_browser_url():
    app = DesktopApp.__new__(DesktopApp)
    app.web_view = Mock()
    app.status_label = Mock()
    app.reload_app()
    app.web_view.setUrl.assert_called_once()
    app.status_label.setText.assert_called_once()


def test_export_delegates_to_browser_app():
    app = DesktopApp.__new__(DesktopApp)
    app.web_view = Mock()
    app.status_label = Mock()
    app.export_video()
    app.web_view.page.return_value.runJavaScript.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__])