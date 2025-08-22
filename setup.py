#!/usr/bin/env python3
"""
Setup script for PulseHZ Video Glitch Tool
Uses UV for dependency management
"""

import subprocess
import sys
import os
import time
import urllib.request
import urllib.error

def check_uv():
    """Check if UV is installed"""
    try:
        subprocess.run(["uv", "--version"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def install_uv():
    """Install UV if not present"""
    print("📦 Installing UV package manager...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "uv"], check=True)
        print("✅ UV installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install UV: {e}")
        print("Please install UV manually: https://docs.astral.sh/uv/getting-started/installation/")
        return False

def install_dependencies():
    """Install project dependencies with UV"""
    print("📦 Installing dependencies with UV...")
    try:
        subprocess.check_call(["uv", "sync"])
        print("✅ Dependencies installed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to install dependencies: {e}")
        return False

def check_server():
    """Check if the FastAPI server is running"""
    try:
        response = urllib.request.urlopen('http://localhost:8000/api/health', timeout=2)
        return response.getcode() == 200
    except:
        return False

def start_server():
    """Start the FastAPI server"""
    print("🚀 Starting FastAPI server...")
    try:
        # Start server in background
        process = subprocess.Popen([sys.executable, "server.py"])

        # Wait for server to start
        print("⏳ Waiting for server to start...")
        for i in range(30):  # Wait up to 30 seconds
            if check_server():
                print("✅ Server is running at http://localhost:8000")
                return process
            time.sleep(1)
            print(f"⏳ Still starting... ({i+1}/30)")

        print("❌ Server failed to start within 30 seconds")
        return None

    except Exception as e:
        print(f"❌ Failed to start server: {e}")
        return None

def main():
    print("🎬 PulseHZ Video Glitch Tool Setup")
    print("=" * 50)

    # Check if UV is installed
    if not check_uv():
        print("UV not found. Installing...")
        if not install_uv():
            return
    else:
        print("✅ UV is already installed")

    # Install dependencies
    if not install_dependencies():
        print("❌ Setup failed. Please check the error messages above.")
        return

    # Check if server is already running
    if check_server():
        print("✅ Server is already running at http://localhost:8000")
        print("🌐 You can now:")
        print("   - Open http://localhost:8000 in your browser")
        print("   - Run 'uv run python desktop_app.py' for the desktop app")
        return

    # Start server
    process = start_server()
    if process:
        print("\n🎉 Setup complete!")
        print("🌐 Access the app at: http://localhost:8000")
        print("🖥️  Run 'uv run python desktop_app.py' for the desktop app")
        print("🛑 Press Ctrl+C to stop the server")

        try:
            process.wait()
        except KeyboardInterrupt:
            print("\n🛑 Stopping server...")
            process.terminate()
            process.wait()
            print("✅ Server stopped")

if __name__ == "__main__":
    main()