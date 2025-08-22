"""Tests for the FastAPI server functionality"""

import pytest
from fastapi.testclient import TestClient
import tempfile
import os
import json

# Import the app from server.py
import sys
sys.path.append('.')
from server import app

client = TestClient(app)

def test_health_endpoint():
    """Test the health check endpoint"""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "PulseHZ Video Export API"

def test_info_endpoint():
    """Test the info endpoint"""
    response = client.get("/api/info")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "PulseHZ Video Export API"
    assert "capabilities" in data
    assert "performance" in data

def test_root_endpoint():
    """Test the root endpoint serves the web interface"""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]

def test_export_video_no_data():
    """Test export endpoint with no video data"""
    project_data = {
        "version": "1.0",
        "projectName": "Test Project",
        "createdAt": "2025-01-01T00:00:00Z",
        "layers": [
            {
                "id": 1,
                "blendMode": "normal",
                "hasVideo": False
            }
        ]
    }

    response = client.post("/api/export-video", json=project_data)
    assert response.status_code == 400
    data = response.json()
    assert "No video layers found" in data["detail"]

def test_export_video_invalid_data():
    """Test export endpoint with invalid data"""
    response = client.post("/api/export-video", json={"invalid": "data"})
    assert response.status_code == 422  # Validation error

if __name__ == "__main__":
    pytest.main([__file__])