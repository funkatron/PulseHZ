"""Thin wrapper to expose app from package and action to run server."""

import os
import sys

# Ensure src-based package is importable without editable install
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from pulsehz.server import app  # re-export for tests/tools that import server:app
from pulsehz.main import run_server  # action entry

__all__ = ["app", "run_server"]