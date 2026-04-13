"""Repo-wide pytest hooks. Keep minimal — only env needed before plugins load."""

from __future__ import annotations

import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
# Stable browser dir (override sandbox defaults from some runners). Install once:
#   uv run playwright install chromium
_PW = _ROOT / ".cache" / "playwright"
if os.environ.get("PULSEHZ_KEEP_PLAYWRIGHT_PATH") != "1":
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(_PW)
