"""Browser smoke + test-harness hooks."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e


def test_app_page_smoke(page: Page, app_page_url: str) -> None:
    page.goto(app_page_url)
    expect(page).to_have_title("PulseHZ")
    expect(page.locator("#manual-bpm")).to_be_visible()
    expect(page.locator("#detect-bpm-button")).to_be_visible()
    expect(page.locator("#bar-duration")).to_be_visible()


def test_test_harness_commits_bpm(page: Page, app_page_url: str) -> None:
    page.goto(f"{app_page_url}?test=1")
    page.evaluate("() => window.__PULSEHZ_TEST__.commitBpm(118.5)")
    expect(page.locator("#manual-bpm")).to_have_value("118.5")
