"""Tests for CLI entry helpers in pulsehz.main."""

from unittest.mock import Mock

from pulsehz.main import run_client


def test_run_client_uses_existing_server_and_opens_browser(monkeypatch):
    opened: list[str] = []

    def fake_urlopen(url, timeout=1):
        assert "/api/health" in url
        mock_resp = Mock()
        mock_resp.getcode = Mock(return_value=200)
        return mock_resp

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("webbrowser.open", lambda url: opened.append(url))

    run_client()

    assert opened == ["http://127.0.0.1:6066/app/"]
