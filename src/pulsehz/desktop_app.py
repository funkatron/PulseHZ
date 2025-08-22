import sys
import os
from PyQt6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QWidget, QPushButton, QHBoxLayout, QLabel, QProgressBar, QFileDialog, QMessageBox
try:
    from PyQt6.QtWebEngineWidgets import QWebEngineView  # type: ignore
except Exception:  # pragma: no cover
    QWebEngineView = None  # type: ignore
from PyQt6.QtCore import QUrl, QThread, pyqtSignal, QTimer
from PyQt6.QtGui import QIcon
import subprocess
import tempfile
import json
import base64
from pathlib import Path
import time
import urllib.request
import urllib.error

class VideoProcessor(QThread):
    """Background thread for video processing"""
    progress = pyqtSignal(int)
    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(self, project_data, output_path):
        super().__init__()
        self.project_data = project_data
        self.output_path = output_path

    def run(self):
        try:
            # Create temporary directory
            with tempfile.TemporaryDirectory() as temp_dir:
                layer_files = []

                # Process each layer
                for i, layer in enumerate(self.project_data['layers']):
                    if layer.get('hasVideo') and layer.get('videoData'):
                        # Decode base64 video data
                        video_data = base64.b64decode(layer['videoData'].split(',')[1])

                        # Save video file
                        layer_file = os.path.join(temp_dir, f"layer-{layer['id']}.mp4")
                        with open(layer_file, 'wb') as f:
                            f.write(video_data)

                        layer_files.append({
                            'file': layer_file,
                            'blend_mode': layer['blendMode'],
                            'id': layer['id']
                        })

                        # Update progress
                        self.progress.emit((i + 1) * 20)

                if not layer_files:
                    self.error.emit('No video layers found')
                    return

                # Build FFmpeg command
                input_args = []
                for layer in layer_files:
                    input_args.extend(['-i', layer['file']])

                # Simple blend for now (can be enhanced)
                ffmpeg_cmd = [
                    'ffmpeg',
                    *input_args,
                    '-filter_complex', '[0:v][1:v]blend=screen[tmp1];[tmp1][2:v]blend=screen[tmp2];[tmp2][3:v]blend=screen',
                    '-c:v', 'prores_ks',
                    '-profile:v', '4',
                    '-pix_fmt', 'yuv444p10le',
                    '-r', '60',
                    '-s', '1920x1080',
                    '-y',
                    self.output_path
                ]

                # Run FFmpeg
                result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)

                if result.returncode != 0:
                    self.error.emit(f'FFmpeg error: {result.stderr}')
                    return

                self.progress.emit(100)
                self.finished.emit(self.output_path)

        except Exception as e:
            self.error.emit(f'Processing error: {str(e)}')

class DesktopApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("PulseHZ Video Blender")
        self.setGeometry(100, 100, 1400, 900)

        self.current_project_data = None
        self.video_file_paths = {}
        self.server_process = None

        # Create central widget
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)

        # Create web view
        self.web_view = QWebEngineView() if QWebEngineView is not None else None
        if self.web_view is not None:
            layout.addWidget(self.web_view)

        # Create control panel
        control_panel = QWidget()
        control_layout = QHBoxLayout(control_panel)

        self.export_btn = QPushButton("Export ProRes")
        self.export_btn.clicked.connect(self.export_video)
        control_layout.addWidget(self.export_btn)

        self.load_project_btn = QPushButton("Load Project")
        self.load_project_btn.clicked.connect(self.load_project)
        control_layout.addWidget(self.load_project_btn)

        self.reload_files_btn = QPushButton("Reload Files")
        self.reload_files_btn.clicked.connect(self.reload_video_files)
        self.reload_files_btn.setEnabled(False)
        control_layout.addWidget(self.reload_files_btn)

        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        control_layout.addWidget(self.progress_bar)

        self.status_label = QLabel("Ready")
        control_layout.addWidget(self.status_label)

        layout.addWidget(control_panel)

        # Load the web interface - use local server for better performance
        if self.web_view is not None:
            self.web_view.setUrl(QUrl("http://localhost:8000"))

        if self.web_view is not None:
            self.web_view.page().javaScriptConsoleMessage.connect(self.handle_console_message)
        self.video_processor = None

        # On startup, ensure server is running
        self.ensure_server_running()

    def ensure_server_running(self):
        """Check if the FastAPI server is running, and start it if not."""
        if self.check_server_status():
            self.status_label.setText("✅ Server connected")
            return
        # Try to start the server
        self.status_label.setText("⏳ Starting server...")
        try:
            self.server_process = subprocess.Popen([sys.executable, "server.py"])  # Start in background
        except Exception as e:
            self.status_label.setText("❌ Failed to start server")
            QMessageBox.critical(self, "Server Error", f"Failed to start FastAPI server automatically.\n\nError: {e}")
            return
        # Wait for server to become available
        for i in range(30):  # Wait up to 30 seconds
            if self.check_server_status():
                self.status_label.setText("✅ Server started and connected")
                return
            time.sleep(1)
            self.status_label.setText(f"⏳ Waiting for server... ({i+1}/30)")
        # If still not running
        self.status_label.setText("❌ Server failed to start")
        QMessageBox.critical(self, "Server Error", "FastAPI server could not be started automatically.\n\nPlease run 'python server.py' manually.")

    def check_server_status(self):
        """Check if the FastAPI server is running"""
        try:
            response = urllib.request.urlopen('http://localhost:8000/api/health', timeout=2)
            return response.getcode() == 200
        except Exception:
            return False

    def handle_console_message(self, level, message, line, source):
        """Handle messages from the web interface"""
        if "export" in message.lower():
            print(f"Web console: {message}")

    def load_project(self):
        """Load a project file and automatically reload video files"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Load Project",
            "",
            "JSON Files (*.json);;All Files (*)"
        )

        if not file_path:
            return

        try:
            with open(file_path, 'r') as f:
                project_data = json.load(f)

            self.current_project_data = project_data
            self.video_file_paths = {}

            # Load project data into web interface
            self.load_project_to_web(project_data)

            # Automatically prompt for video files
            self.reload_video_files()

            self.status_label.setText(f"Project loaded: {project_data.get('projectName', 'Unknown')}")
            self.reload_files_btn.setEnabled(True)

        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to load project: {str(e)}")

    def load_project_to_web(self, project_data):
        """Load project data into the web interface"""
        # Set project name
        js_code = f"""
        document.getElementById('project-name').value = '{project_data.get('projectName', 'My Video Project')}';
        """
        if self.web_view is not None:
            self.web_view.page().runJavaScript(js_code)

        # Set blend modes
        for layer in project_data.get('layers', []):
            layer_id = layer.get('id')
            blend_mode = layer.get('blendMode', 'normal')
            js_code = f"""
            document.getElementById('blend-mode-{layer_id}').value = '{blend_mode}';
            """
            if self.web_view is not None:
                self.web_view.page().runJavaScript(js_code)

        # Update blend modes in preview
        if self.web_view is not None:
            self.web_view.page().runJavaScript("updateBlendMode();")

    def reload_video_files(self):
        """Prompt user to reload video files for the loaded project"""
        if not self.current_project_data:
            QMessageBox.warning(self, "Warning", "No project loaded. Please load a project first.")
            return

        # Get layers that had videos
        video_layers = [layer for layer in self.current_project_data.get('layers', [])
                       if layer.get('hasVideo')]

        if not video_layers:
            QMessageBox.information(self, "Info", "This project has no video layers.")
            return

        # Prompt for each video file
        for layer in video_layers:
            layer_id = layer['id']
            layer_name = f"Layer {layer_id}"

            file_path, _ = QFileDialog.getOpenFileName(
                self,
                f"Select video file for {layer_name}",
                "",
                "Video Files (*.mp4 *.mov *.avi *.mkv *.webm);;All Files (*)"
            )

            if file_path:
                self.video_file_paths[layer_id] = file_path
                # Load video into web interface
                self.load_video_to_layer(layer_id, file_path)
            else:
                # User cancelled for this layer
                break

        self.status_label.setText(f"Loaded {len(self.video_file_paths)} video files")

    def load_video_to_layer(self, layer_id, file_path):
        """Load a video file into a specific layer in the web interface"""
        # Convert file path to file:// URL for web interface
        file_url = QUrl.fromLocalFile(file_path).toString()

        js_code = f"""
        (function() {{
            const zoneEl = document.querySelector('#zone-{layer_id}');
            let vid = zoneEl.querySelector('video');

            if (!vid) {{
                vid = document.createElement('video');
                vid.loop = true;
                vid.autoplay = true;
                vid.muted = true;
                zoneEl.innerHTML = '';
                zoneEl.appendChild(vid);
            }}

            vid.src = '{file_url}';
            vid.play();

            // Update preview
            updatePreview();
        }})();
        """

        if self.web_view is not None:
            self.web_view.page().runJavaScript(js_code)

    def export_video(self):
        """Export video using the web interface data"""
        # Execute JavaScript to get project data
        js_code = """
        (function() {
            const projectData = {
                version: "1.0",
                projectName: document.getElementById('project-name').value || 'My Video Project',
                createdAt: new Date().toISOString(),
                layers: []
            };

            for (let i = 1; i <= 4; i++) {
                const zoneVideo = document.querySelector(`#zone-${i} video`);
                const blendMode = document.getElementById(`blend-mode-${i}`).value;

                if (zoneVideo && zoneVideo.src) {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = zoneVideo.videoWidth;
                    canvas.height = zoneVideo.videoHeight;
                    ctx.drawImage(zoneVideo, 0, 0);
                    const videoData = canvas.toDataURL('image/jpeg', 0.95);

                    projectData.layers.push({
                        id: i,
                        blendMode: blendMode,
                        videoData: videoData,
                        hasVideo: true
                    });
                } else {
                    projectData.layers.push({
                        id: i,
                        blendMode: blendMode,
                        hasVideo: false
                    });
                }
            }

            return JSON.stringify(projectData);
        })();
        """

        if self.web_view is not None:
            self.web_view.page().runJavaScript(js_code, self.handle_project_data)

    def handle_project_data(self, result):
        """Handle project data from web interface"""
        try:
            project_data = json.loads(result)

            # Check if we have videos
            has_videos = any(layer.get('hasVideo') for layer in project_data['layers'])
            if not has_videos:
                self.status_label.setText("No videos to export")
                return

            # Start video processing
            output_path = f"{project_data['projectName'].replace(' ', '_')}-prores.mov"

            self.video_processor = VideoProcessor(project_data, output_path)
            self.video_processor.progress.connect(self.update_progress)
            self.video_processor.finished.connect(self.export_finished)
            self.video_processor.error.connect(self.export_error)

            self.export_btn.setEnabled(False)
            self.progress_bar.setVisible(True)
            self.progress_bar.setValue(0)
            self.status_label.setText("Processing...")

            self.video_processor.start()

        except Exception as e:
            self.status_label.setText(f"Error: {str(e)}")

    def update_progress(self, value):
        """Update progress bar"""
        self.progress_bar.setValue(value)

    def export_finished(self, output_path):
        """Handle successful export"""
        self.export_btn.setEnabled(True)
        self.progress_bar.setVisible(False)
        self.status_label.setText(f"Export complete: {output_path}")

    def export_error(self, error):
        """Handle export error"""
        self.export_btn.setEnabled(True)
        self.progress_bar.setVisible(False)
        self.status_label.setText(f"Export failed: {error}")

def main():
    app = QApplication(sys.argv)

    # Set application icon (optional)
    # app.setWindowIcon(QIcon('icon.png'))

    window = DesktopApp()
    window.show()

    sys.exit(app.exec())

if __name__ == '__main__':
    main()