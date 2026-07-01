"""Browser smoke + test-harness hooks."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e


def test_app_page_smoke(page: Page, app_page_url: str) -> None:
    page.goto(f"{app_page_url}?autoload=off")
    expect(page).to_have_title("PulseHZ")
    expect(page.locator("#manual-bpm")).to_be_visible()
    expect(page.locator("#play-button")).to_be_visible()
    expect(page.locator("#preview-transport-label")).to_contain_text("Stopped")
    page.locator("details.sidebar-sheet:has(#detect-bpm-button) > summary").click()
    expect(page.locator("#detect-bpm-button")).to_be_visible()
    expect(page.locator("#bar-duration")).to_be_visible()


def test_test_harness_commits_bpm(page: Page, app_page_url: str) -> None:
    page.goto(f"{app_page_url}?test=1&autoload=off")
    page.evaluate("() => window.__PULSEHZ_TEST__.commitBpm(118.5)")
    expect(page.locator("#manual-bpm")).to_have_value("118.5")


def test_play_starts_transport_after_autoload(page: Page, app_page_url: str) -> None:
    """Loads a demo WebM via autoload, then Play — transport label must leave Stopped."""
    page.goto(f"{app_page_url}?autoload=first")
    expect(page.locator("#loaded-layers")).to_contain_text("1 / 4", timeout=20_000)
    expect(page.locator('.layer-card[data-layer-id="1"]')).to_have_attribute("aria-busy", "false", timeout=20_000)
    expect(page.locator("#preview-transport-label")).to_contain_text("Stopped", timeout=15_000)
    page.locator("#play-button").click()
    expect(page.locator("#preview-transport-label")).to_contain_text("Playing", timeout=15_000)


def test_loopback_dev_startup_loads_three_demo_layers(page: Page, app_page_url: str) -> None:
    """Loopback default: first visit without `autoload` fills layers 1–3 from manifest."""
    page.goto(app_page_url)
    expect(page.locator("#loaded-layers")).to_contain_text("3 / 4", timeout=20_000)
