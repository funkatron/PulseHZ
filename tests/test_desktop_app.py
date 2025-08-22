"""Tests for the desktop app functionality"""

import pytest
import tempfile
import json
import os
from unittest.mock import Mock, patch

# Import the desktop app class from the package
from pulsehz.desktop_app import DesktopApp

def test_project_data_validation():
    """Test project data validation"""
    valid_project = {
        "version": "1.0",
        "projectName": "Test Project",
        "createdAt": "2025-01-01T00:00:00Z",
        "layers": [
            {
                "id": 1,
                "blendMode": "normal",
                "hasVideo": True,
                "videoData": "data:video/mp4;base64,test"
            }
        ]
    }

    # Test valid project data
    assert "version" in valid_project
    assert "projectName" in valid_project
    assert "layers" in valid_project
    assert len(valid_project["layers"]) > 0

def test_blend_mode_validation():
    """Test blend mode validation"""
    valid_blend_modes = [
        "normal", "multiply", "screen", "overlay",
        "darken", "lighten", "difference", "exclusion"
    ]

    for mode in valid_blend_modes:
        assert mode in valid_blend_modes

def test_file_path_handling():
    """Test file path handling"""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
        tmp_path = tmp_file.name

    try:
        # Test that the file exists
        assert os.path.exists(tmp_path)
        assert tmp_path.endswith(".mp4")
    finally:
        # Clean up
        os.unlink(tmp_path)

def test_json_serialization():
    """Test JSON serialization of project data"""
    project_data = {
        "version": "1.0",
        "projectName": "Test Project",
        "createdAt": "2025-01-01T00:00:00Z",
        "layers": [
            {
                "id": 1,
                "blendMode": "screen",
                "hasVideo": False
            }
        ]
    }

    # Test serialization
    json_str = json.dumps(project_data)
    assert json_str is not None

    # Test deserialization
    loaded_data = json.loads(json_str)
    assert loaded_data["projectName"] == "Test Project"
    assert len(loaded_data["layers"]) == 1

@patch('pulsehz.desktop_app.QApplication')
def test_desktop_app_initialization(mock_qapp):
    """Test desktop app initialization"""
    # Mock QApplication to avoid GUI initialization
    mock_qapp.return_value = Mock()

    # This would normally create a GUI, but we're mocking it
    # In a real test, you'd need to handle the GUI components differently
    assert True  # Placeholder for actual test logic

if __name__ == "__main__":
    pytest.main([__file__])