#!/usr/bin/env python3
"""Manual acceptance rows 5, 7, 8 from docs/delivery/mvp-acceptance.md."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:6066/app/"


def _health_ok() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:6066/api/health", timeout=2):
            return True
    except (urllib.error.URLError, OSError):
        return False


def main() -> int:
    if not _health_ok():
        print("FAIL: server not up — run: uv run pulsehz-server", file=sys.stderr)
        return 1

    from playwright.sync_api import sync_playwright

    results: dict[str, object] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(f"{BASE}?test=1&autoload=first", wait_until="networkidle")

        page.wait_for_function(
            """() => document.getElementById('loaded-layers')?.textContent?.includes('1 / 4')""",
            timeout=20_000,
        )
        page.wait_for_function(
            """() => document.querySelector('.layer-card[data-layer-id="1"]')?.getAttribute('aria-busy') === 'false'""",
            timeout=20_000,
        )

        # --- 1) Visual / transport bar sync (instrumented) ---
        page.evaluate("async () => { await window.__PULSEHZ_TEST__.startPlayback(); }")
        page.wait_for_timeout(400)
        samples = page.evaluate(
            """async () => {
              const rows = [];
              const videoT = () => {
                const v = document.getElementById('video-load-staging')?.querySelector('video');
                return v ? v.currentTime : null;
              };
              for (let i = 0; i < 16; i++) {
                rows.push({
                  beat: parseFloat(document.getElementById('current-beat')?.textContent || '0'),
                  progress: document.getElementById('transport-progress-bar')?.style.width || '0%',
                  videoT: videoT(),
                  playing: document.getElementById('preview-transport-label')?.textContent?.includes('Playing'),
                });
                await new Promise(r => setTimeout(r, 200));
              }
              return rows;
            }""",
        )
        beat_start = samples[0]["beat"]
        beat_end = samples[-1]["beat"]
        progress_moved = any(s["progress"] != samples[0]["progress"] for s in samples[1:])
        video_moved = any(
            s["videoT"] is not None and samples[0]["videoT"] is not None and abs(s["videoT"] - samples[0]["videoT"]) > 0.01
            for s in samples[1:]
        )
        playing = all(s["playing"] for s in samples)
        bar_sync_pass = playing and beat_end > beat_start + 0.05 and (progress_moved or video_moved)
        results["bar_sync"] = {
            "pass": bar_sync_pass,
            "beat_start": beat_start,
            "beat_end": beat_end,
            "progress_moved": progress_moved,
            "video_moved": video_moved,
        }

        # --- 2) Autosave reload ---
        page.wait_for_timeout(900)
        snap_raw = page.evaluate("() => localStorage.getItem('pulsehz:autosave-v1')")
        snap = json.loads(snap_raw) if snap_raw else None
        has_media = bool(snap and snap.get("layers") and any(l.get("hasVideo") for l in snap.get("layers", [])))

        page.goto(f"{BASE}?test=1&autoload=off", wait_until="networkidle")
        page.wait_for_timeout(1500)
        restored = page.locator("#loaded-layers").text_content() or ""
        page.wait_for_function(
            """() => {
              const card = document.querySelector('.layer-card[data-layer-id="1"]');
              return card && card.getAttribute('aria-busy') === 'false' && document.getElementById('loaded-layers')?.textContent?.includes('1 / 4');
            }""",
            timeout=25_000,
        )
        status_after = page.locator("#status-line").text_content() or ""
        autosave_pass = "1 / 4" in restored and has_media
        results["autosave"] = {
            "pass": autosave_pass,
            "had_snapshot": has_media,
            "loaded_after_reload": restored.strip(),
            "status": status_after.strip(),
        }

        # --- 3) WebM export (one bar, no audio) ---
        blob_size = page.evaluate(
            """async () => {
              let capturedSize = 0;
              const origCreate = URL.createObjectURL;
              URL.createObjectURL = function (blob) {
                capturedSize = blob?.size || 0;
                return origCreate.call(URL, blob);
              };
              try {
                await window.pulsehzApp.exportWeb();
              } finally {
                URL.createObjectURL = origCreate;
              }
              const status = document.getElementById('status-line')?.textContent || '';
              return {
                status,
                size: capturedSize,
                ok: status.toLowerCase().includes('finished') && capturedSize > 1024,
              };
            }""",
        )
        results["webm_export"] = {
            "pass": bool(blob_size.get("ok")),
            "bytes": blob_size.get("size", 0),
            "status": blob_size.get("status", ""),
        }

        browser.close()

    failures = [name for name, data in results.items() if isinstance(data, dict) and not data.get("pass")]
    print(json.dumps(results, indent=2))
    if failures:
        print(f"FAIL: {', '.join(failures)}", file=sys.stderr)
        return 1
    print("OK: manual acceptance rows 5, 7, 8 passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
