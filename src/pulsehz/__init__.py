"""PulseHZ Video Glitch Tool - A desktop video glitch and blending tool"""

__version__ = "1.0.0"
__author__ = "PulseHZ"
__email__ = "coj@funkatron.com"

from .server import app
from .desktop_app import DesktopApp

__all__ = ["app", "DesktopApp"]