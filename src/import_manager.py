#!/usr/bin/env python3
"""
Import Manager Module
Handles DICOM and JPEG import workflows
"""

import os
import json
import shutil
import subprocess
import time
from datetime import datetime
from collections import defaultdict
from project_manager import ProjectManager
from patient_manager import PatientManager


class ImportManager:
    def __init__(self, project_manager=None, patient_manager=None):
        self.project_manager = project_manager or ProjectManager()
        self.patient_manager = patient_manager or PatientManager(self.project_manager.projects_root)
        self.active_imports = {}  # Track progress

    def _detect_dicomdir(self, source_path):
        """
        Detect DICOMDIR media and find the actual DICOM files location.
        Returns tuple: (resolved_path, is_dicomdir_media)
        """
        # Check for DICOMDIR file (standard DICOM media format)
        dicomdir_file = os.path.join(source_path, 'DICOMDIR')
        if not os.path.exists(dicomdir_file):
            # Also check case-insensitive
            for item in os.listdir(source_path):
                if item.upper() == 'DICOMDIR':
                    dicomdir_file = os.path.join(source_path, item)
                    break
            else:
                return source_path, False

        # DICOMDIR found - look for actual DICOM files
        # Common locations: DICOM/, IMAGES/, or numbered folders
        search_dirs = ['DICOM', 'IMAGES', 'Images', 'dicom', 'images']

        # First check common subdirectory names
        for subdir in search_dirs:
            candidate = os.path.join(source_path, subdir)
            if os.path.isdir(candidate):
                # Verify it contains DICOM files
                if self._contains_dicom_files(candidate):
                    # Traverse to find actual series root (handles nested patient/study structure)
                    series_root = self._find_series_root(candidate)
                    return series_root, True

        # Check inside .app bundles (macOS) - some DICOM media embeds data in viewer apps
        for item in os.listdir(source_path):
            if item.endswith('.app'):
                app_dicom = os.path.join(source_path, item, 'Contents', 'DICOM')
                if os.path.isdir(app_dicom) and self._contains_dicom_files(app_dicom):
                    series_root = self._find_series_root(app_dicom)
                    return series_root, True

        # If not found, search for any directory with DICOM files
        for item in os.listdir(source_path):
            item_path = os.path.join(source_path, item)
            if os.path.isdir(item_path) and item.upper() not in ['DICOMDIR']:
                if self._contains_dicom_files(item_path):
                    series_root = self._find_series_root(item_path)
                    return series_root, True

        # Last resort: use the source path itself if it has DICOM files in subdirs
        if self._contains_dicom_files(source_path):
            series_root = self._find_series_root(source_path)
            return series_root, True

        return source_path, False

    def _find_series_root(self, path):
        """
        Traverse down through nested DICOMDIR structure to find the series root.
        DICOMDIR media often has structure: DICOM/PatientID/StudyID/SeriesID/files
        We need to find the level that contains the series folders.
        """
        # Get subdirectories that contain DICOM files
        subdirs_with_dicom = []
        try:
            for item in os.listdir(path):
                if item.startswith('.'):
                    continue
                item_path = os.path.join(path, item)
                if os.path.isdir(item_path) and self._contains_dicom_files(item_path):
                    subdirs_with_dicom.append(item_path)
        except OSError:
            return path

        # If multiple subdirectories have DICOM files, this is likely the series root
        if len(subdirs_with_dicom) > 1:
            return path

        # If exactly one subdirectory, recurse into it (patient/study level)
        if len(subdirs_with_dicom) == 1:
            return self._find_series_root(subdirs_with_dicom[0])

        # No subdirectories with DICOM - check if current dir has DICOM files directly
        return path

    def _contains_dicom_files(self, path):
        """Check if directory (or subdirectories) contains DICOM files"""
        for root, dirs, files in os.walk(path):
            for file in files:
                # DICOM files: .dcm extension or no extension with DICOM content
                if file.endswith(('.dcm', '.DCM')):
                    return True
                # Files without extension are common in DICOM media
                if '.' not in file and file not in ['DICOMDIR', 'Autorun', 'autorun']:
                    filepath = os.path.join(root, file)
                    # Quick check for DICOM magic bytes (DICM at offset 128)
                    try:
                        with open(filepath, 'rb') as f:
                            f.seek(128)
                            if f.read(4) == b'DICM':
                                return True
                    except:
                        pass
        return False

    def start_import(self, project_id, source_type, source_path):
        """Start import process"""
        import_id = f"import_{int(datetime.utcnow().timestamp())}"

        # Validate source
        if not os.path.exists(source_path):
            raise ValueError(f"Source path does not exist: {source_path}")

        # Initialize progress tracking
        self.active_imports[import_id] = {
            'status': 'initializing',
            'progress': 0,
            'message': 'Starting import...',
            'projectId': project_id,
            'sourceType': source_type,
            'sourcePath': source_path
        }

        # Dispatch based on type
        if source_type == 'dicom':
            self._import_dicom(project_id, import_id, source_path)
        elif source_type == 'jpeg':
            self._import_jpeg(project_id, import_id, source_path)
        else:
            raise ValueError(f"Unknown source type: {source_type}")

        return import_id

    def _extract_patient_from_dicom(self, source_path):
        """Extract patient info from first DICOM file"""
        try:
            # Find first DICOM file
            dicom_file = None
            for root, dirs, files in os.walk(source_path):
                for file in files:
                    if file.endswith(('.dcm', '.DCM')) or not '.' in file:
                        dicom_file = os.path.join(root, file)
                        break
                if dicom_file:
                    break

            if not dicom_file:
                return {'name': 'Unknown', 'studyDate': datetime.now().strftime('%Y%m%d')}

            # Use ImageMagick to extract metadata
            try:
                result = subprocess.run([
                    'magick', 'identify', '-verbose', dicom_file
                ], capture_output=True, text=True)

                output = result.stdout

                # Extract patient name
                patient_name = 'Unknown'
                for line in output.split('\n'):
                    if "dcm:Patient'sName:" in line or "dcm:PatientsName:" in line:
                        patient_name = line.split(':', 1)[1].strip()
                        break

                # Extract study date
                study_date = datetime.now().strftime('%Y%m%d')
                for line in output.split('\n'):
                    if 'dcm:StudyDate:' in line:
                        study_date = line.split(':', 1)[1].strip()
                        break

                return {'name': patient_name, 'studyDate': study_date}

            except Exception as e:
                print(f"Warning: Could not extract DICOM metadata: {e}")
                return {'name': 'Unknown', 'studyDate': datetime.now().strftime('%Y%m%d')}

        except Exception as e:
            print(f"Warning: Patient extraction failed: {e}")
            return {'name': 'Unknown', 'studyDate': datetime.now().strftime('%Y%m%d')}

    def _import_dicom(self, project_id, import_id, source_path):
        """Process DICOM import"""
        # Track if we're in auto-patient mode (patient creation deferred until success)
        auto_patient_mode = project_id is None
        patient_info = None
        patient_name = None
        study_date = None
        temp_import_dir = None

        try:
            # Detect DICOMDIR media (USB/CD/DVD)
            self.active_imports[import_id].update({
                'status': 'detecting',
                'progress': 2,
                'message': 'Detecting DICOM structure...'
            })

            resolved_path, is_dicomdir = self._detect_dicomdir(source_path)

            if is_dicomdir:
                self.active_imports[import_id].update({
                    'progress': 4,
                    'message': f'DICOM media detected, found images in: {os.path.basename(resolved_path)}/',
                    'isDicomMedia': True,
                    'resolvedPath': resolved_path
                })
                source_path = resolved_path

            # Auto-patient workflow: extract info but DON'T create patient yet
            if auto_patient_mode:
                self.active_imports[import_id].update({
                    'status': 'extracting',
                    'progress': 5,
                    'message': 'Extracting patient info from DICOM...'
                })

                # Extract patient info (just info, no creation)
                patient_info = self._extract_patient_from_dicom(source_path)
                patient_name = patient_info['name']
                study_date = patient_info['studyDate']

                self.active_imports[import_id].update({
                    'progress': 8,
                    'message': f'Patient: {patient_name}, Study Date: {study_date}',
                    'patientName': patient_name,
                    'studyDate': study_date
                })

                # Process to temporary directory first
                temp_import_dir = os.path.join(
                    self.project_manager.projects_root,
                    '.temp_imports',
                    import_id
                )
                os.makedirs(temp_import_dir, exist_ok=True)
                import_dir = temp_import_dir
            else:
                # Existing project - use project path directly
                project_path = self.project_manager.get_project_path(project_id)
                import_dir = os.path.join(project_path, 'img', import_id)
                os.makedirs(import_dir, exist_ok=True)

            # Update progress
            self.active_imports[import_id].update({
                'status': 'processing',
                'progress': 10,
                'message': 'Processing DICOM files...'
            })

            # Call modified process_mri.py
            # Locate script relative to this file
            script_dir = os.path.dirname(os.path.abspath(__file__))
            script_path = os.path.join(script_dir, 'process_mri.py')
            
            cmd = [
                sys.executable,
                script_path,
                '--input', source_path,
                '--output', import_dir,
                '--format', 'json'
            ]
            process = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

            # Read progress from stderr
            for line in iter(process.stderr.readline, ''):
                if line.startswith('PROGRESS:'):
                    try:
                        progress_data = json.loads(line[9:])
                        self.active_imports[import_id].update({
                            'progress': min(90, 10 + int(progress_data.get('progress', 0) * 0.8)),
                            'message': progress_data.get('message', 'Processing...')
                        })
                    except json.JSONDecodeError:
                        pass

            # Wait for completion
            process.wait()

            if process.returncode != 0:
                raise Exception(f"Processing failed with code {process.returncode}")

            # Parse output metadata
            data_file = os.path.join(import_dir, 'data.json')
            if not os.path.exists(data_file):
                raise Exception("Processing did not generate data.json")

            with open(data_file, 'r') as f:
                metadata = json.load(f)

            # Verify we have actual series data
            if not metadata.get('series') or len(metadata['series']) == 0:
                raise Exception("No DICOM series found in the selected folder")

            # NOW create patient/study after successful processing (auto-patient mode)
            if auto_patient_mode:
                self.active_imports[import_id].update({
                    'progress': 92,
                    'message': 'Creating patient record...'
                })

                # Find or create patient
                patient_id = self.patient_manager.find_patient_by_name(patient_name)

                if patient_id is None:
                    patient_id = self.patient_manager.create_patient(patient_name)
                    self.active_imports[import_id]['action'] = 'created_patient'
                else:
                    self.active_imports[import_id]['action'] = 'matched_patient'

                # Create study under patient
                study_id = str(__import__('uuid').uuid4())
                project_id = self.patient_manager.create_study_project(
                    patient_id,
                    study_id,
                    study_date
                )

                # Store IDs
                self.active_imports[import_id]['patientId'] = patient_id
                self.active_imports[import_id]['studyId'] = study_id
                self.active_imports[import_id]['projectId'] = project_id

                # Move processed files from temp to final project location
                project_path = self.project_manager.get_project_path(project_id)
                final_import_dir = os.path.join(project_path, 'img', import_id)
                os.makedirs(os.path.dirname(final_import_dir), exist_ok=True)
                shutil.move(temp_import_dir, final_import_dir)
                import_dir = final_import_dir

                # Clean up temp directory parent if empty
                temp_parent = os.path.join(self.project_manager.projects_root, '.temp_imports')
                if os.path.exists(temp_parent) and not os.listdir(temp_parent):
                    os.rmdir(temp_parent)

            # Update progress
            self.active_imports[import_id].update({
                'progress': 95,
                'message': 'Categorizing series...'
            })

            # Categorize series
            categorization = self._categorize_series(metadata['series'])

            # Update project manifest
            self._update_project_manifest(
                project_id,
                import_id,
                metadata,
                categorization,
                source_path,
                'dicom'
            )

            # Complete
            self.active_imports[import_id].update({
                'status': 'completed',
                'progress': 100,
                'message': 'Import completed',
                'seriesCount': len(metadata['series']),
                'imageCount': sum(len(s.get('images', [])) for s in metadata['series'])
            })

        except Exception as e:
            # Clean up temp directory on failure
            if temp_import_dir and os.path.exists(temp_import_dir):
                shutil.rmtree(temp_import_dir, ignore_errors=True)

            self.active_imports[import_id].update({
                'status': 'failed',
                'progress': 0,
                'message': f'Import failed: {str(e)}'
            })

    def _import_jpeg(self, project_id, import_id, source_path):
        """Copy JPEG folder as-is"""
        try:
            project_path = self.project_manager.get_project_path(project_id)
            import_dir = os.path.join(project_path, 'img', import_id)

            self.active_imports[import_id].update({
                'status': 'processing',
                'progress': 10,
                'message': 'Copying images...'
            })

            # Check for existing data.json
            data_file = os.path.join(source_path, 'data.json')

            if os.path.exists(data_file):
                # Copy entire structure
                shutil.copytree(os.path.join(source_path, 'img'), import_dir)
                with open(data_file, 'r') as f:
                    metadata = json.load(f)

                self.active_imports[import_id].update({
                    'progress': 70,
                    'message': 'Images copied, processing metadata...'
                })
            else:
                # Infer structure
                metadata = self._infer_metadata_from_folders(source_path, import_dir)

                self.active_imports[import_id].update({
                    'progress': 70,
                    'message': 'Inferred metadata from folder structure...'
                })

            # Categorize and update project
            self.active_imports[import_id].update({
                'progress': 90,
                'message': 'Categorizing series...'
            })

            categorization = self._categorize_series(metadata['series'])
            self._update_project_manifest(
                project_id,
                import_id,
                metadata,
                categorization,
                source_path,
                'jpeg'
            )

            self.active_imports[import_id].update({
                'status': 'completed',
                'progress': 100,
                'message': 'Import completed',
                'seriesCount': len(metadata['series']),
                'imageCount': sum(len(s.get('images', [])) for s in metadata['series'])
            })

        except Exception as e:
            self.active_imports[import_id].update({
                'status': 'failed',
                'progress': 0,
                'message': f'Import failed: {str(e)}'
            })

    def _infer_metadata_from_folders(self, source_path, dest_path):
        """Infer metadata from folder structure"""
        # Copy folders and build basic metadata
        series_list = []
        series_dirs = [d for d in os.listdir(source_path)
                      if os.path.isdir(os.path.join(source_path, d))
                      and d.isdigit()]

        for series_dir in sorted(series_dirs):
            src_series_path = os.path.join(source_path, series_dir)
            dst_series_path = os.path.join(dest_path, series_dir)

            # Copy series folder
            shutil.copytree(src_series_path, dst_series_path)

            # Get list of images
            images = sorted([f for f in os.listdir(dst_series_path)
                           if f.endswith(('.jpg', '.jpeg', '.png'))])

            # Build basic metadata
            series_list.append({
                'id': series_dir,
                'description': f'Series {series_dir}',
                'modality': 'MR',
                'patient': 'Unknown',
                'date': datetime.now().strftime('%Y%m%d'),
                'body_part': 'Other',
                'protocol': 'Unknown',
                'orientation': 'Unknown',
                'slice_thickness': '0',
                'tr': '0',
                'te': '0',
                'images': images
            })

        return {'series': series_list}

    def _categorize_series(self, series_list):
        """Categorize series by date and body part"""
        by_date = defaultdict(list)
        by_body_part = defaultdict(list)

        for series in series_list:
            # Date categorization
            date = series.get('date', 'Unknown')
            by_date[date].append(series['id'])

            # Body part categorization
            body_part = self._normalize_body_part(
                series.get('body_part', 'Other')
            )
            by_body_part[body_part].append(series['id'])

        return {
            'byDate': dict(by_date),
            'byBodyPart': dict(by_body_part)
        }

    def _normalize_body_part(self, raw_value):
        """Normalize body part names"""
        if not raw_value:
            return 'Other'

        mapping = {
            'BRAIN': 'Brain',
            'HEAD': 'Brain',
            'CEREBRAL': 'Brain',
            'SPINE': 'Spine',
            'C-SPINE': 'Cervical Spine',
            'CERVICAL': 'Cervical Spine',
            'T-SPINE': 'Thoracic Spine',
            'THORACIC': 'Thoracic Spine',
            'L-SPINE': 'Lumbar Spine',
            'LUMBAR': 'Lumbar Spine',
            'CHEST': 'Chest',
            'THORAX': 'Chest',
            'ABDOMEN': 'Abdomen',
            'PELVIS': 'Pelvis',
            'KNEE': 'Knee',
            'SHOULDER': 'Shoulder',
            'ANKLE': 'Ankle',
            'WRIST': 'Wrist'
        }
        return mapping.get(raw_value.upper(), raw_value.title())

    def _update_project_manifest(self, project_id, import_id,
                                  metadata, categorization,
                                  source_path, source_type):
        """Update project.json with new import data"""
        project = self.project_manager.load_project(project_id)

        # Auto-populate patient info from first series if empty
        if metadata['series'] and not project.get('patient', {}).get('name'):
            first_series = metadata['series'][0]
            if first_series.get('patient'):
                project['patient'] = {
                    'name': first_series.get('patient'),
                    'mrn': project.get('patient', {}).get('mrn', ''),
                    'dob': ''
                }

        # Add import record
        now = datetime.utcnow().isoformat() + 'Z'
        project['imports'].append({
            'importId': import_id,
            'timestamp': now,
            'sourceType': source_type,
            'sourcePath': source_path,
            'seriesCount': len(metadata['series']),
            'imageCount': sum(len(s.get('images', [])) for s in metadata['series']),
            'status': 'completed'
        })

        # Add series (with import reference)
        for series in metadata['series']:
            series['importId'] = import_id
            series['imagePath'] = f"img/{import_id}/{series['id']}"
            project['series'].append(series)

        # Update categorization (merge with existing)
        self._merge_categorization(
            project['categorization'],
            categorization
        )

        # Update project
        self.project_manager.update_project(project_id, project)

        # Update patient study series count if patient-linked
        if project.get('patientId') and project.get('studyId'):
            try:
                self.patient_manager.update_study_series_count(
                    project['patientId'],
                    project['studyId'],
                    len(project['series'])
                )
            except Exception as e:
                print(f"Warning: Could not update patient series count: {e}")

        # Save import metadata
        project_path = self.project_manager.get_project_path(project_id)
        import_meta_file = os.path.join(
            project_path,
            'imports',
            f'{import_id}_meta.json'
        )

        import_meta = {
            'importId': import_id,
            'timestamp': now,
            'sourceType': source_type,
            'sourcePath': source_path,
            'seriesCount': len(metadata['series']),
            'imageCount': sum(len(s.get('images', [])) for s in metadata['series']),
            'status': 'completed'
        }

        with open(import_meta_file, 'w') as f:
            json.dump(import_meta, f, indent=2)

    def _merge_categorization(self, existing, new):
        """Merge new categorization into existing"""
        for date, series_ids in new['byDate'].items():
            if date not in existing['byDate']:
                existing['byDate'][date] = []
            existing['byDate'][date].extend(series_ids)

        for body_part, series_ids in new['byBodyPart'].items():
            if body_part not in existing['byBodyPart']:
                existing['byBodyPart'][body_part] = []
            existing['byBodyPart'][body_part].extend(series_ids)

    def track_progress(self, import_id):
        """Generator for SSE progress updates"""
        while True:
            if import_id in self.active_imports:
                yield self.active_imports[import_id]

                status = self.active_imports[import_id]['status']
                if status in ['completed', 'failed']:
                    break

            time.sleep(0.5)

    def get_status(self, import_id):
        """Get current import status"""
        return self.active_imports.get(import_id, {
            'status': 'unknown',
            'message': 'Import not found'
        })


if __name__ == '__main__':
    # Test the import manager
    im = ImportManager()
    print("Import manager initialized")
