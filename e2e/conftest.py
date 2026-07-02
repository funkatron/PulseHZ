"""Playwright + local PulseHZ server for UI tests."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

import pytest

def _free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


@pytest.fixture(scope="session")
def pulsehz_server():
    port = _free_port()
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO_ROOT / "src")
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "pulsehz.server:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{base}/api/health", timeout=0.5)
            break
        except (urllib.error.URLError, OSError):
            if proc.poll() is not None:
                err = proc.stderr.read().decode() if proc.stderr else ""
                raise RuntimeError(f"uvicorn exited early: {err}") from None
            time.sleep(0.1)
    else:
        proc.terminate()
        err = proc.stderr.read().decode() if proc.stderr else ""
        raise RuntimeError(f"server did not become ready: {err}")

    yield base

    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture
def app_page_url(pulsehz_server: str) -> str:
    """Base app URL without query (tests append their own `?…` / `&…`)."""
    return f"{pulsehz_server}/app/"
