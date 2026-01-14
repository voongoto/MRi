#!/usr/bin/env python3
"""
Patient Manager Module
Handles patient-centric organization of MRI studies
"""

import os
import json
import uuid
from datetime import datetime
from pathlib import Path
from project_manager import ProjectManager


class PatientManager:
    def __init__(self, patients_root=None):
        self.patients_root = patients_root or self._get_default_root()
        self.metadata_file = os.path.join(
            self.patients_root,
            'patient-metadata.json'
        )
        self.project_manager = ProjectManager(self.patients_root)
        self._ensure_root_exists()

    def _get_default_root(self):
        """Get default patients root directory"""
        home = Path.home()
        return os.path.join(home, 'MRIViewerProjects')

    def _ensure_root_exists(self):
        """Create patients root if it doesn't exist"""
        os.makedirs(self.patients_root, exist_ok=True)
        if not os.path.exists(self.metadata_file):
            self._init_metadata_file()

    def _init_metadata_file(self):
        """Initialize patient metadata file"""
        metadata = {
            'version': '2.0',
            'patientsRoot': self.patients_root,
            'patients': [],
            'settings': {
                'defaultImportBehavior': 'auto_match',
                'autoSaveAnnotations': True
            }
        }
        with open(self.metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

    def _load_metadata(self):
        """Load patient metadata"""
        with open(self.metadata_file, 'r') as f:
            return json.load(f)

    def _save_metadata(self, metadata):
        """Save patient metadata"""
        with open(self.metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

    def list_patients(self):
        """List all patients with their study counts"""
        metadata = self._load_metadata()
        return metadata['patients']

    def find_patient_by_name(self, patient_name):
        """Find patient by exact name match"""
        metadata = self._load_metadata()
        for patient in metadata['patients']:
            if patient['name'] == patient_name:
                return patient['patientId']
        return None

    def create_patient(self, patient_name, mrn="", dob=""):
        """Create new patient record"""
        patient_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + 'Z'

        metadata = self._load_metadata()

        patient = {
            'patientId': patient_id,
            'name': patient_name,
            'mrn': mrn,
            'dob': dob,
            'created': now,
            'lastOpened': now,
            'studyCount': 0,
            'seriesCount': 0,
            'studies': []
        }

        metadata['patients'].append(patient)
        self._save_metadata(metadata)

        return patient_id

    def create_study_project(self, patient_id, study_id, study_date):
        """Create a project for a new study under a patient"""
        metadata = self._load_metadata()

        # Find patient
        patient = None
        for p in metadata['patients']:
            if p['patientId'] == patient_id:
                patient = p
                break

        if not patient:
            raise ValueError(f"Patient not found: {patient_id}")

        # Create project name
        project_name = f"{patient['name']}_{study_date}_{study_id[:8]}"

        # Create project through project_manager
        project_result = self.project_manager.create_project(
            name=project_name,
            patient_info={
                'name': patient['name'],
                'mrn': patient.get('mrn', ''),
                'dob': patient.get('dob', '')
            }
        )
        project_id = project_result['projectId']

        # Load and update project with patient linkage
        project_data = self.project_manager.load_project(project_id)
        project_data['patientId'] = patient_id
        project_data['studyId'] = study_id
        project_data['studyDate'] = study_date
        self.project_manager.update_project(project_id, project_data)

        # Add study to patient
        study = {
            'studyId': study_id,
            'studyDate': study_date,
            'projectId': project_id,
            'seriesCount': 0
        }
        patient['studies'].append(study)
        patient['studyCount'] = len(patient['studies'])
        patient['lastOpened'] = datetime.utcnow().isoformat() + 'Z'

        self._save_metadata(metadata)

        return project_id

    def get_patient_with_studies(self, patient_id):
        """Get patient with all studies"""
        metadata = self._load_metadata()

        for patient in metadata['patients']:
            if patient['patientId'] == patient_id:
                # Update last opened
                patient['lastOpened'] = datetime.utcnow().isoformat() + 'Z'
                self._save_metadata(metadata)
                return patient

        raise ValueError(f"Patient not found: {patient_id}")

    def get_study(self, patient_id, study_id):
        """Get specific study (loads underlying project)"""
        metadata = self._load_metadata()

        # Find patient
        for patient in metadata['patients']:
            if patient['patientId'] == patient_id:
                # Find study
                for study in patient['studies']:
                    if study['studyId'] == study_id:
                        # Load project data
                        project_id = study['projectId']
                        project_data = self.project_manager.load_project(project_id)

                        # Update last opened
                        patient['lastOpened'] = datetime.utcnow().isoformat() + 'Z'
                        self._save_metadata(metadata)

                        return project_data

                raise ValueError(f"Study not found: {study_id}")

        raise ValueError(f"Patient not found: {patient_id}")

    def get_all_patient_series(self, patient_id):
        """Get all series from all studies for a patient, merged into one list"""
        metadata = self._load_metadata()

        # Find patient
        patient = None
        for p in metadata['patients']:
            if p['patientId'] == patient_id:
                patient = p
                break

        if not patient:
            raise ValueError(f"Patient not found: {patient_id}")

        # Collect all series from all studies
        all_series = []
        for study in patient.get('studies', []):
            project_id = study.get('projectId')
            if not project_id:
                continue

            try:
                project_data = self.project_manager.load_project(project_id)
                series_list = project_data.get('series', [])

                # Add study metadata to each series
                for series in series_list:
                    series['studyId'] = study['studyId']
                    series['studyDate'] = study.get('studyDate', '')
                    series['projectId'] = project_id
                    all_series.append(series)
            except Exception as e:
                print(f"Warning: Could not load project {project_id}: {e}")

        # Update last opened
        patient['lastOpened'] = datetime.utcnow().isoformat() + 'Z'
        self._save_metadata(metadata)

        return {
            'patientId': patient_id,
            'patientName': patient['name'],
            'series': all_series
        }

    def update_study_series_count(self, patient_id, study_id, series_count):
        """Update the series count for a study"""
        metadata = self._load_metadata()

        for patient in metadata['patients']:
            if patient['patientId'] == patient_id:
                for study in patient['studies']:
                    if study['studyId'] == study_id:
                        study['seriesCount'] = series_count

                        # Recalculate total series count for patient
                        total_series = sum(s['seriesCount'] for s in patient['studies'])
                        patient['seriesCount'] = total_series

                        self._save_metadata(metadata)
                        return

        raise ValueError(f"Patient or study not found")

    def delete_patient(self, patient_id):
        """Delete patient and all associated studies/projects"""
        import shutil

        metadata = self._load_metadata()

        # Find patient
        patient = None
        patient_index = None
        for i, p in enumerate(metadata['patients']):
            if p['patientId'] == patient_id:
                patient = p
                patient_index = i
                break

        if patient is None:
            raise ValueError(f"Patient not found: {patient_id}")

        # Delete all study project directories
        for study in patient.get('studies', []):
            project_id = study.get('projectId')
            if project_id:
                try:
                    project_path = self.project_manager.get_project_path(project_id)
                    if os.path.exists(project_path):
                        shutil.rmtree(project_path)
                except Exception as e:
                    print(f"Warning: Could not delete project {project_id}: {e}")

        # Remove patient from metadata
        metadata['patients'].pop(patient_index)
        self._save_metadata(metadata)

        return {'deleted': patient_id, 'studiesDeleted': len(patient.get('studies', []))}
