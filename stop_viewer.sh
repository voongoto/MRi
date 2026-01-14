#!/bin/bash
# Stop the MRI Viewer server

if lsof -ti:8000 > /dev/null 2>&1; then
    echo "Stopping MRI Viewer server..."
    kill -9 $(lsof -ti:8000) 2>/dev/null
    echo "Server stopped."
else
    echo "No server running on port 8000."
fi
