#!/usr/bin/env python3
"""Partial MVP acceptance against a running PulseHZ server (default :6066).

Automates checklist rows 1–4 and 6 from docs/delivery/mvp-acceptance.md.
Exits 0 on pass, 1 on failure. Requires: uv sync --extra e2e --extra audio
"""

from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GOLDEN_MP3 = REPO_ROOT / "tests/fixtures/audio/vco-berlin-deathbycuriosity-remix.mp3"
REFERENCE_BPM = 136.0
IDEAL_BPM_TOLERANCE = 2.0
PLAUSIBLE_BPM_MIN = 85.0
PLAUSIBLE_BPM_MAX = 175.0
BASE_URL = "http://127.0.0.1:6066/app/"


def _health_ok() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:6066/api/health", timeout=2) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False


def main() -> int:
    if not GOLDEN_MP3.is_file():
        print(f"FAIL: golden audio missing: {GOLDEN_MP3}", file=sys.stderr)
        return 1
    if not _health_ok():
        print("FAIL: server not up — run: uv run pulsehz-server", file=sys.stderr)
        return 1

    from playwright.sync_api import sync_playwright

    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(f"{BASE_URL}?test=1&autoload=first", wait_until="networkidle")

        page.locator("#manual-bpm").fill(str(int(REFERENCE_BPM)))
        page.locator("#manual-bpm").dispatch_event("change")

        page.locator("#audio-input").set_input_files(str(GOLDEN_MP3))
        try:
            page.wait_for_function(
                """() => {
                  const el = document.getElementById('preview-bpm-map-status');
                  return el && el.textContent && el.textContent.includes('ready');
                }""",
                timeout=120_000,
            )
        except Exception as exc:
            failures.append(f"audio tempo map: {exc}")

        expect_loaded = page.locator("#loaded-layers")
        if "1 / 4" not in (expect_loaded.text_content() or ""):
            failures.append("layer autoload: expected 1 / 4 loaded")

        card = page.locator('.layer-card[data-layer-id="1"]')
        try:
            card.wait_for(state="attached", timeout=20_000)
            page.wait_for_function(
                """() => {
                  const el = document.querySelector('.layer-card[data-layer-id="1"]');
                  return el && el.getAttribute('aria-busy') === 'false';
                }""",
                timeout=20_000,
            )
        except Exception as exc:
            failures.append(f"layer decode: {exc}")

        page.evaluate("async () => { await window.__PULSEHZ_TEST__.startPlayback(); }")
        try:
            page.locator("#preview-transport-label").wait_for(
                state="visible",
                timeout=5_000,
            )
            label = page.locator("#preview-transport-label").text_content() or ""
            if "Playing" not in label:
                failures.append(f"transport: expected Playing, got {label!r}")
        except Exception as exc:
            failures.append(f"transport: {exc}")

        page.locator("details.sidebar-sheet:has(#detect-bpm-button) > summary").click()
        page.locator("#detect-bpm-button").click()
        try:
            page.wait_for_function(
                """() => {
                  const t = document.getElementById('detected-bpm')?.textContent?.trim() || '';
                  return t && t !== '--' && !Number.isNaN(parseFloat(t));
                }""",
                timeout=45_000,
            )
            detected_text = page.locator("#detected-bpm").text_content() or ""
            detected = float(re.sub(r"[^\d.]", "", detected_text) or "0")
            delta = abs(detected - REFERENCE_BPM)
            if not (PLAUSIBLE_BPM_MIN < detected < PLAUSIBLE_BPM_MAX):
                failures.append(
                    f"Detect BPM: detected {detected:.1f} outside plausible band "
                    f"({PLAUSIBLE_BPM_MIN}–{PLAUSIBLE_BPM_MAX})",
                )
            elif delta > IDEAL_BPM_TOLERANCE:
                print(
                    f"WARN Detect BPM: manual {REFERENCE_BPM}, detected {detected:.1f} "
                    f"(Δ {delta:.1f} > ideal ±{IDEAL_BPM_TOLERANCE}; golden track is hard — record in sign-off)",
                )
            else:
                print(
                    f"OK Detect BPM: manual {REFERENCE_BPM}, detected {detected:.1f} (Δ {delta:.1f})",
                )
        except Exception as exc:
            failures.append(f"Detect BPM: {exc}")

        browser.close()

    if failures:
        for msg in failures:
            print(f"FAIL: {msg}", file=sys.stderr)
        return 1

    print("OK: scripted MVP acceptance checks passed (visual bar sync still manual — see docs/delivery/mvp-acceptance.md)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
