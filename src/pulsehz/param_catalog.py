"""Registered modulatable parameters (ids + bounds).

Keep ids aligned with ``public/param-catalog.js``.
"""

from __future__ import annotations

# Layer-local parameters (extend as the UI grows).
LAYER_PARAM_IDS = frozenset({"opacity"})
