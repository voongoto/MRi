# MRI Viewer

A web-based medical imaging viewer for MRI scans with annotation and export capabilities.

## Features

- **Series Browser**: Navigate through multiple MRI series with favorites functionality
- **Image Viewer**: View DICOM-derived JPEG images with medical-grade controls
- **Annotation Tools**:
  - Markers: Place numbered points on images
  - Measurements: Draw lines with distance calculations
  - Crosshairs: Place targeting crosshairs with X/Y axes
- **Image Controls**: Pan, zoom, brightness, contrast, window/level adjustments
- **Export**: Export selected series to ZIP files with embedded annotations
- **Local LLM Analysis**: Integrate with LM Studio for local, privacy-focused AI analysis of MRI slices using vision models
- **Medical UI**: Professional medical imaging interface

## Setup

### Quick Start

1. **Start the viewer**:

   ```bash
   ./start_viewer.sh
   ```

   This automatically creates a Python virtual environment, installs dependencies, and starts the server on port 8000

2. **Open in browser**:

   ```
   http://localhost:8000
   ```

### Manual Setup (Alternative)

If you prefer to set up manually:

```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server
python3 mri_server.py
```

### Local AI Setup (Optional)

To enable the AI analysis features:

1. **Install LM Studio**: Download from [lmstudio.ai](https://lmstudio.ai/)
2. **Load a Vision Model**:
   - We recommend **`ministral-3-14b-reasoning`** (or other vision-capable models like `llava-v1.6-mistral-7b`).
   - Search for the model in LM Studio and download it.
3. **Hardware Recommendations**:
   - **Minimum**: M1 Mac or NVIDIA GPU with 8GB VRAM.
   - **Recommended**: M2/M3 Max or NVIDIA RTX 3090/4090 (24GB VRAM) for faster analysis.
4. **Start Server**:
   - Go to the **Local Server** tab in LM Studio.
   - Start the server on port `1234` (default).
   - Ensure "Cross-Origin-Resource-Sharing (CORS)" is ON (usually default).
5. **Privacy**: All analysis runs locally on your machine; no data is sent to the cloud.

### Using AI Analysis

1. **Select a Series**: Open an MRI series in the viewer.
2. **Open AI Tools**: Click the **AI** button in the top toolbar.
3. **Configure**:
   - **Current Slice**: Analyze only the currently visible image.
   - **Full Series**: Analyze the entire set (optionally sample every Nth slice).
4. **Run**: Click "Run Analysis" and wait for the findings to stream in.

## User Guide

### 1. Import Scans (Start Here)

Everything starts with importing data. There is no manual "Create Project" step; the system automatically organizes scans by Patient and Study.

1. Click **"Import DICOM Scans"**.
2. Enter the **full absolute path** to your data folder.
   - Example: `/Users/username/Documents/DICOM_DATA`
3. Click **"Start Import"**.
4. The system will read the files, extract metadata, and automatically create/update the Patient record.

### 2. View Patient

1. After import, the patient appearing in the **"Recent Patients"** list.
2. Click the patient card to view all their studies.
3. Select a specific study or view them all in the unified viewer.

## Developer API

The Flask backend provides REST endpoints for the patient-centric architecture:

### Patients

- `GET /api/patients` - List all patients
- `GET /api/patients/:id` - Get patient details
- `DELETE /api/patients/:id` - Delete patient and all studies

### Studies

- `GET /api/patients/:id/studies/:studyId` - Load specific study
- `GET /api/patients/:id/all-series` - Load all series for a patient

### Imports

- `POST /api/import/dicom` - Start DICOM import (auto-categorization)
- `GET /api/import/:importId/progress` - Track progress (SSE)

## File Structure

```
MRi/
├── output/                   # Web application files
│   ├── index.html           # Main HTML page
│   ├── css/
│   │   └── style.css        # Viewer styling
│   ├── js/
│   │   ├── app.js           # Main application logic
│   │   ├── data.js          # MRI series metadata
│   │   └── export.js        # Export functionality
│   ├── img/                 # Image directories
│   └── data.json            # Series metadata (JSON format)
├── process_mri.py           # DICOM processing script
├── start_viewer.sh          # Server startup script
└── README.md                # This file
```

## Important Notes

- **DICOM files**: Original DICOM files should be stored outside this repository
- **Image files**: Currently tracked in Git. If repo becomes too large, uncomment the image exclusions in [.gitignore](.gitignore)
- **Server requirement**: The viewer must be run through an HTTP server (not file://) due to CORS restrictions

## Troubleshooting

### Python dependencies error

If you see "ModuleNotFoundError: No module named 'flask'":

```bash
# Remove old virtual environment
rm -rf venv/

# Run the startup script again
./start_viewer.sh
```

The script will create a fresh virtual environment and install all dependencies.

### Images not loading

1. Make sure the server is running: `./start_viewer.sh`
2. Check that you're accessing via <http://localhost:8000> (not file://)
3. Check browser console for errors (F12)
