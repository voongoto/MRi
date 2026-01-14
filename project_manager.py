#!/usr/bin/env python3
"""
Project Manager Module
Handles CRUD operations for MRI viewer projects
"""

import os
import json
import uuid
from datetime import datetime
from pathlib import Path


class ProjectManager:
    def __init__(self, projects_root=None):
        self.projects_root = projects_root or self._get_default_root()
        self.metadata_file = os.path.join(
            self.projects_root,
            'project-metadata.json'
        )
        self._ensure_root_exists()

    def _get_default_root(self):
        """Get default projects root directory"""
        home = Path.home()
        return os.path.join(home, 'MRIViewerProjects')

    def _ensure_root_exists(self):
        """Create projects root if it doesn't exist"""
        os.makedirs(self.projects_root, exist_ok=True)
        if not os.path.exists(self.metadata_file):
            self._init_metadata_file()

    def _init_metadata_file(self):
        """Initialize global metadata file"""
        metadata = {
            'version': '1.0',
            'projectsRoot': self.projects_root,
            'recentProjects': [],
            'settings': {
                'defaultImportBehavior': 'process_dicom',
                'autoSaveAnnotations': True
            }
        }
        with open(self.metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

    def list_projects(self):
        """List all projects with metadata"""
        with open(self.metadata_file, 'r') as f:
            metadata = json.load(f)

        return metadata['recentProjects']

    def create_project(self, name, patient_info=None):
        """Create new project"""
        project_id = str(uuid.uuid4())

        # Sanitize name for folder
        folder_name = self._sanitize_folder_name(name)
        project_path = os.path.join(self.projects_root, folder_name)

        # Handle duplicate folder names
        counter = 1
        original_path = project_path
        while os.path.exists(project_path):
            project_path = f"{original_path}_{counter}"
            counter += 1

        # Create directory structure
        os.makedirs(project_path)
        os.makedirs(os.path.join(project_path, 'img'))
        os.makedirs(os.path.join(project_path, 'annotations'))
        os.makedirs(os.path.join(project_path, 'imports'))

        # Create .gitignore for project
        gitignore_content = """# Patient images (privacy protection)
img/
imports/
annotations/

# Thumbnails
thumbnails/

# Exports
exports/

# Keep only manifest
!project.json
!.gitignore
"""
        with open(os.path.join(project_path, '.gitignore'), 'w') as f:
            f.write(gitignore_content)

        # Create project manifest
        now = datetime.utcnow().isoformat() + 'Z'
        project = {
            'version': '1.0',
            'projectId': project_id,
            'name': name,
            'created': now,
            'modified': now,
            'patient': patient_info or {},
            'imports': [],
            'series': [],
            'categorization': {
                'byDate': {},
                'byBodyPart': {}
            }
        }

        project_file = os.path.join(project_path, 'project.json')
        with open(project_file, 'w') as f:
            json.dump(project, f, indent=2)

        # Update global metadata
        self._add_to_recent_projects(project_id, name, project_path)

        return {
            'projectId': project_id,
            'name': name,
            'path': project_path
        }

    def load_project(self, project_id):
        """Load project by ID"""
        # Find project path from metadata
        with open(self.metadata_file, 'r') as f:
            metadata = json.load(f)

        project_entry = next(
            (p for p in metadata['recentProjects']
             if p['projectId'] == project_id),
            None
        )

        if not project_entry:
            raise ValueError(f"Project {project_id} not found")

        # Load project manifest
        project_file = os.path.join(project_entry['path'], 'project.json')
        if not os.path.exists(project_file):
            raise FileNotFoundError(f"Project manifest not found: {project_file}")

        with open(project_file, 'r') as f:
            project = json.load(f)

        # Add path to response
        project['path'] = project_entry['path']

        # Update last opened
        project_entry['lastOpened'] = datetime.utcnow().isoformat() + 'Z'
        self._save_metadata(metadata)

        return project

    def get_project_path(self, project_id):
        """Get project path by ID"""
        with open(self.metadata_file, 'r') as f:
            metadata = json.load(f)

        project_entry = next(
            (p for p in metadata['recentProjects']
             if p['projectId'] == project_id),
            None
        )

        if not project_entry:
            raise ValueError(f"Project {project_id} not found")

        return project_entry['path']

    def update_project(self, project_id, project_data):
        """Update project manifest"""
        project_path = self.get_project_path(project_id)
        project_file = os.path.join(project_path, 'project.json')

        # Update modified timestamp
        project_data['modified'] = datetime.utcnow().isoformat() + 'Z'

        with open(project_file, 'w') as f:
            json.dump(project_data, f, indent=2)

        # Update recent projects metadata
        with open(self.metadata_file, 'r') as f:
            metadata = json.load(f)

        for project_entry in metadata['recentProjects']:
            if project_entry['projectId'] == project_id:
                project_entry['name'] = project_data.get('name', project_entry['name'])
                project_entry['seriesCount'] = len(project_data.get('series', []))
                break

        self._save_metadata(metadata)

    def delete_project(self, project_id):
        """Delete project (remove from registry, optionally delete files)"""
        import shutil

        project_path = self.get_project_path(project_id)

        # Remove from metadata
        with open(self.metadata_file, 'r') as f:
            metadata = json.load(f)

        metadata['recentProjects'] = [
            p for p in metadata['recentProjects']
            if p['projectId'] != project_id
        ]

        self._save_metadata(metadata)

        # Delete project folder
        if os.path.exists(project_path):
            shutil.rmtree(project_path)

    def _sanitize_folder_name(self, name):
        """Convert project name to safe folder name"""
        # Replace spaces and special chars
        safe_name = "".join(
            c if c.isalnum() or c in ['-', '_'] else '_'
            for c in name
        )
        # Limit length
        return safe_name[:100]

    def _add_to_recent_projects(self, project_id, name, path):
        """Add project to recent list"""
        with open(self.metadata_file, 'r') as f:
            metadata = json.load(f)

        # Add to recent (at beginning)
        metadata['recentProjects'].insert(0, {
            'projectId': project_id,
            'name': name,
            'path': path,
            'lastOpened': datetime.utcnow().isoformat() + 'Z',
            'seriesCount': 0,
            'patient': '',
            'thumbnail': ''
        })

        # Keep only last 20
        metadata['recentProjects'] = metadata['recentProjects'][:20]

        self._save_metadata(metadata)

    def _save_metadata(self, metadata):
        """Save global metadata"""
        with open(self.metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)

    def load_annotations(self, project_id):
        """Load project annotations"""
        project_path = self.get_project_path(project_id)

        annotations_file = os.path.join(
            project_path,
            'annotations',
            'annotations.json'
        )

        if os.path.exists(annotations_file):
            with open(annotations_file, 'r') as f:
                return json.load(f)

        return {'version': '1.0', 'annotations': []}

    def save_annotations(self, project_id, annotations_data):
        """Save project annotations"""
        project_path = self.get_project_path(project_id)
        annotations_file = os.path.join(
            project_path,
            'annotations',
            'annotations.json'
        )

        with open(annotations_file, 'w') as f:
            json.dump(annotations_data, f, indent=2)


if __name__ == '__main__':
    # Test the project manager
    pm = ProjectManager()
    print(f"Projects root: {pm.projects_root}")
    print(f"Projects: {pm.list_projects()}")
