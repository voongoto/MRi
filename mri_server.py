#!/usr/bin/env python3
"""
MRI Viewer Flask Server
Provides REST API and serves static files
"""

from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import os
import json
import threading
import subprocess
from project_manager import ProjectManager
from import_manager import ImportManager
from patient_manager import PatientManager
from ai_analyzer import analyze_series_ai

app = Flask(__name__)
CORS(app)

# Initialize managers - use current working directory for projects
project_manager = ProjectManager(os.getcwd())
patient_manager = PatientManager(project_manager.projects_root)
import_manager = ImportManager(project_manager)


# ===== PROJECT ENDPOINTS =====

@app.route('/api/projects', methods=['GET'])
def list_projects():
    """List all projects"""
    try:
        projects = project_manager.list_projects()
        return jsonify({'projects': projects}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects', methods=['POST'])
def create_project():
    """Create new project"""
    try:
        data = request.json
        name = data.get('name')
        patient_info = data.get('patientInfo', {})

        if not name:
            return jsonify({'error': 'Project name is required'}), 400

        project = project_manager.create_project(name, patient_info)
        return jsonify(project), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<project_id>', methods=['GET'])
def get_project(project_id):
    """Get project details"""
    try:
        project = project_manager.load_project(project_id)
        return jsonify(project), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    """Delete project"""
    try:
        project_manager.delete_project(project_id)
        return '', 204
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== PATIENT ENDPOINTS =====

@app.route('/api/patients', methods=['GET'])
def list_patients():
    """List all patients"""
    try:
        patients = patient_manager.list_patients()
        return jsonify({'patients': patients}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/patients/<patient_id>', methods=['GET'])
def get_patient(patient_id):
    """Get patient with all studies"""
    try:
        patient = patient_manager.get_patient_with_studies(patient_id)
        return jsonify(patient), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/patients/<patient_id>/studies/<study_id>', methods=['GET'])
def get_study(patient_id, study_id):
    """Get specific study (loads underlying project)"""
    try:
        study = patient_manager.get_study(patient_id, study_id)
        return jsonify(study), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/patients/<patient_id>/all-series', methods=['GET'])
def get_all_patient_series(patient_id):
    """Get all series from all studies for a patient, merged into one list"""
    try:
        result = patient_manager.get_all_patient_series(patient_id)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/patients/<patient_id>', methods=['DELETE'])
def delete_patient(patient_id):
    """Delete patient and all associated data"""
    try:
        result = patient_manager.delete_patient(patient_id)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== FOLDER PICKER =====

@app.route('/api/browse/folder', methods=['GET'])
def browse_folder():
    """Open native folder picker dialog"""
    import sys

    try:
        if sys.platform == 'darwin':  # macOS
            # Use AppleScript to open folder picker
            script = '''
            tell application "System Events"
                activate
                set folderPath to POSIX path of (choose folder with prompt "Select DICOM Folder")
            end tell
            return folderPath
            '''
            result = subprocess.run(
                ['osascript', '-e', script],
                capture_output=True,
                text=True,
                timeout=120  # 2 minute timeout for user interaction
            )

            if result.returncode == 0:
                folder_path = result.stdout.strip()
                return jsonify({'path': folder_path}), 200
            else:
                # User cancelled or error
                return jsonify({'cancelled': True}), 200

        elif sys.platform == 'win32':  # Windows
            # Use PowerShell to open folder picker
            script = '''
            Add-Type -AssemblyName System.Windows.Forms
            $browser = New-Object System.Windows.Forms.FolderBrowserDialog
            $browser.Description = "Select DICOM Folder"
            $null = $browser.ShowDialog()
            $browser.SelectedPath
            '''
            result = subprocess.run(
                ['powershell', '-Command', script],
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode == 0 and result.stdout.strip():
                return jsonify({'path': result.stdout.strip()}), 200
            else:
                return jsonify({'cancelled': True}), 200

        else:  # Linux
            # Try zenity first, fall back to kdialog
            try:
                result = subprocess.run(
                    ['zenity', '--file-selection', '--directory', '--title=Select DICOM Folder'],
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                if result.returncode == 0:
                    return jsonify({'path': result.stdout.strip()}), 200
            except FileNotFoundError:
                try:
                    result = subprocess.run(
                        ['kdialog', '--getexistingdirectory', '.', '--title', 'Select DICOM Folder'],
                        capture_output=True,
                        text=True,
                        timeout=120
                    )
                    if result.returncode == 0:
                        return jsonify({'path': result.stdout.strip()}), 200
                except FileNotFoundError:
                    pass

            return jsonify({'cancelled': True, 'error': 'No folder picker available'}), 200

    except subprocess.TimeoutExpired:
        return jsonify({'cancelled': True, 'error': 'Timeout'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== IMPORT ENDPOINTS =====

@app.route('/api/import/dicom', methods=['POST'])
def import_dicom_auto():
    """Auto-import DICOM with patient matching"""
    try:
        data = request.json
        source_path = data.get('sourcePath')

        if not source_path:
            return jsonify({'error': 'sourcePath is required'}), 400

        # Start import in background thread (project_id=None triggers auto-patient workflow)
        def run_import():
            import_manager.start_import(None, 'dicom', source_path)

        import_id = f"import_{int(__import__('time').time())}"
        thread = threading.Thread(target=run_import)
        thread.daemon = True
        thread.start()

        # Wait a moment for import to initialize
        __import__('time').sleep(0.5)

        # Get the actual import ID
        for iid in import_manager.active_imports.keys():
            import_id = iid
            break

        return jsonify({'importId': import_id}), 202
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== IMPORT ENDPOINTS =====

@app.route('/api/projects/<project_id>/import', methods=['POST'])
def start_import(project_id):
    """Start import process"""
    try:
        data = request.json
        source_type = data.get('sourceType')
        source_path = data.get('sourcePath')

        if not source_type or not source_path:
            return jsonify({'error': 'sourceType and sourcePath are required'}), 400

        # Start import in background thread
        def run_import():
            import_manager.start_import(project_id, source_type, source_path)

        import_id = f"import_{int(__import__('time').time())}"
        thread = threading.Thread(target=lambda: import_manager.start_import(
            project_id, source_type, source_path
        ))
        thread.daemon = True
        thread.start()

        # Wait a moment for import to initialize
        __import__('time').sleep(0.5)

        # Get the actual import ID
        for iid in import_manager.active_imports.keys():
            if import_manager.active_imports[iid]['projectId'] == project_id:
                import_id = iid
                break

        return jsonify({'importId': import_id}), 202
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/import/<import_id>/progress')
def import_progress_generic(import_id):
    """SSE endpoint for import progress (generic, no project required)"""
    def generate():
        for progress in import_manager.track_progress(import_id):
            yield f"data: {json.dumps(progress)}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/projects/<project_id>/import/<import_id>/progress')
def import_progress(project_id, import_id):
    """SSE endpoint for import progress (legacy, project-based)"""
    def generate():
        for progress in import_manager.track_progress(import_id):
            yield f"data: {json.dumps(progress)}\n\n"

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/import/<import_id>/status', methods=['GET'])
def get_import_status_generic(import_id):
    """Get import status (generic, no project required)"""
    try:
        status = import_manager.get_status(import_id)
        return jsonify(status), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<project_id>/import/<import_id>', methods=['GET'])
def get_import_status(project_id, import_id):
    """Get import status (legacy, project-based)"""
    try:
        status = import_manager.get_status(import_id)
        return jsonify(status), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== ANNOTATION ENDPOINTS =====

@app.route('/api/projects/<project_id>/annotations', methods=['GET'])
def get_annotations(project_id):
    """Get all annotations for project"""
    try:
        annotations = project_manager.load_annotations(project_id)
        return jsonify(annotations), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<project_id>/annotations', methods=['POST'])
def save_annotations(project_id):
    """Save annotations for project"""
    try:
        data = request.json
        project_manager.save_annotations(project_id, data)
        return '', 204
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== AI ANALYSIS ENDPOINTS =====

@app.route('/api/analyze/ai/stream', methods=['POST'])
def run_ai_analysis_stream():
    """Run AI analysis on a series with SSE streaming"""
    from flask import Response, stream_with_context
    
    try:
        data = request.json
        project_id = data.get('projectId')
        series_id = data.get('seriesId')
        sample = int(data.get('sample', 1))
        prompt = data.get('prompt', "Analyze these MRI slices.")
        mode = data.get('mode', 'series')  # 'current' or 'series'
        slice_index = int(data.get('sliceIndex', 0))

        if not project_id or not series_id:
            return jsonify({'error': 'projectId and seriesId are required'}), 400

        # Get the actual path to the series
        project_path = project_manager.get_project_path(project_id)
        project_data = project_manager.load_project(project_id)
        
        # Find series in project series list to get imagePath
        series_data = next((s for s in project_data.get('series', []) if s['id'] == series_id), None)
        
        if not series_data:
            return jsonify({'error': f'Series {series_id} not found in project {project_id}'}), 404
            
        relative_series_path = series_data.get('imagePath', f"img/{series_id}")
        series_path = os.path.join(project_path, relative_series_path)

        if not os.path.exists(series_path):
            return jsonify({'error': f'Series path not found: {series_path}'}), 404

        def generate():
            from ai_analyzer import analyze_series_ai_streaming
            
            for event in analyze_series_ai_streaming(series_path, sample, prompt, mode, slice_index):
                yield f"data: {json.dumps(event)}\n\n"
        
        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===== PROJECT DATA SERVING =====

@app.route('/projects/<project_id>/img/<path:file_path>')
def serve_project_image(project_id, file_path):
    """Serve project images"""
    try:
        project_path = project_manager.get_project_path(project_id)
        img_dir = os.path.join(project_path, 'img')
        return send_from_directory(img_dir, file_path)
    except Exception as e:
        return jsonify({'error': str(e)}), 404


# ===== STATIC FILE SERVING =====

@app.route('/')
def index():
    """Serve main page"""
    return send_from_directory('output', 'index.html')


@app.route('/<path:path>')
def static_files(path):
    """Serve static assets"""
    return send_from_directory('output', path)


# ===== ERROR HANDLERS =====

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error'}), 500


# ===== MAIN =====

if __name__ == '__main__':
    print("=" * 50)
    print("MRI Viewer Server")
    print("=" * 50)
    print(f"Projects root: {project_manager.projects_root}")
    print(f"Server: http://127.0.0.1:8000")
    print("=" * 50)
    print()

    app.run(host='127.0.0.1', port=8000, debug=True, threaded=True)
