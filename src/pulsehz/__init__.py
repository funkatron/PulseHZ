"""PulseHZ Video Glitch Tool - A desktop video glitch and blending tool"""

__version__ = "1.0.0"
__author__ = "PulseHZ"
__email__ = "coj@funkatron.com"

from .server import app

__all__ = ["app", "DesktopApp"]


def __getattr__(name: str):
    if name == "DesktopApp":
        from .desktop_app import DesktopApp

        return DesktopApp
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")