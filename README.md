# PulseHZ Video Glitch Tool

A desktop video glitch and blending tool with real-time preview, built with Python, OpenCV, and PyQt6.

## Features

- **Real-time video blending** with multiple blend modes
- **Drag & drop interface** for easy video loading
- **Project save/load** functionality
- **High-quality export** (ProRes 4444) for professional use
- **Web-quality fallback** export for sharing
- **Automatic file reloading** when loading projects
- **FastAPI backend** for optimized video processing

## Quick Start

### Prerequisites

- Python 3.8 or higher
- [UV](https://docs.astral.sh/uv/) package manager
- FFmpeg (for high-quality exports)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/pulsehz-video-glitch.git
   cd pulsehz-video-glitch
   ```

2. **Install with UV:**
   ```bash
   uv sync
   ```

3. **Run the web interface (static):**
   ```bash
   npx --yes live-server public --port=5500 --no-browser
   # Open http://127.0.0.1:5500
   ```

4. **Run the API server (optional):**
   ```bash
   uv run pulsehz-server
   # API: http://localhost:8000
   # Health: http://localhost:8000/api/health
   ```

5. **Run the desktop app (optional):**
   ```bash
   uv run pulsehz-desktop
   ```

## Usage

### Desktop App

The desktop app provides a full-featured interface:

1. **Load videos** by dragging and dropping into the layer zones
2. **Adjust blend modes** for each layer using the dropdown menus
3. **Save projects** to preserve your settings
4. **Load projects** and automatically reload video files
5. **Export videos** in high-quality ProRes format

### Web Interface

The web interface is served statically from `public/` (via Live Server) and provides:

- Real-time preview of video blending
- Project management
- Direct video export

Note: The API does not serve static files. Use a static server (e.g., Live Server) for `public/`.

## Development

### Setup Development Environment

```bash
# Install with development dependencies
uv sync --extra dev

# Run tests
uv run pytest

# Format code
uv run black .

# Lint code
uv run flake8
```

### Project Structure

```
pulsehz-video-glitch/
├── public/                # Static web UI (served via Live Server)
├── src/pulsehz/           # Main Python package
├── tests/                 # Test files
├── run_server.py          # Thin wrapper to run server (optional)
├── run_desktop.py         # Thin wrapper to run desktop (optional)
├── pyproject.toml         # Project configuration
└── README.md              # This file
```

## Dependencies

- **FastAPI** - High-performance web framework
- **PyQt6** - Desktop GUI framework
- **OpenCV** - Video and image processing
- **NumPy** - Numerical computing
- **Pillow** - Image processing
- **Uvicorn** - ASGI server

## Building

### Create a Distribution

```bash
# Build wheel
uv run python -m build

# Install in development mode
uv pip install -e .
```

### Create Executable

```bash
# Install PyInstaller
uv add pyinstaller

# Build executable
uv run pyinstaller --onefile --windowed desktop_app.py
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `uv run pytest`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Roadmap

- [ ] GPU acceleration for video processing
- [ ] More blend modes and effects
- [ ] Batch processing capabilities
- [ ] Plugin system for custom effects
- [ ] Cross-platform packaging with PyInstaller
