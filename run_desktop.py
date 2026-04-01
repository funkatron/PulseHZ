"""Thin wrapper to expose DesktopApp from package and action to run desktop."""

import os
import sys

# Ensure src-based package is importable without editable install
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from pulsehz.desktop_app import DesktopApp  # re-export for tools/tests
from pulsehz.main import run_desktop  # action entry

__all__ = ["DesktopApp", "run_desktop"]
