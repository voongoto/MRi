#!/bin/bash
cd "$(dirname "$0")"

echo "MRI Viewer - Starting Server"
echo "============================="
echo ""

# Check for dependencies
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 not found"
    exit 1
fi

# Kill any existing process on port 8000
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "Stopping existing server on port 8000..."
    kill -9 $(lsof -ti:8000) 2>/dev/null
    sleep 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

# Start Flask server
echo ""
echo "Starting server on http://localhost:8000"
echo "Press Ctrl+C to stop"
echo ""

# Open browser after delay
(sleep 2 && open "http://localhost:8000") &

# Run server
python3 mri_server.py
