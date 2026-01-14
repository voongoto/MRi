/**
 * Project UI Module
 * Handles project selection, creation, and management UI
 */

class ProjectUI {
    constructor() {
        this.currentProject = null;
        this.apiBase = '/api';
    }

    /**
     * Show empty state when no project is loaded
     */
    showEmptyState() {
        const mainWorkspace = document.getElementById('main-workspace');
        if (!mainWorkspace) {
            console.error('Main workspace element not found');
            return;
        }

        mainWorkspace.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-content">
                    <h1>MRI Viewer</h1>
                    <p class="subtitle">Project-Based Medical Image Viewer</p>

                    <div class="empty-state-actions">
                        <button id="btn-create-project" class="btn-primary">
                            <span class="icon">+</span>
                            Create New Project
                        </button>
                        <button id="btn-open-project" class="btn-secondary">
                            <span class="icon">📂</span>
                            Open Project
                        </button>
                    </div>

                    <div class="recent-projects-container">
                        <h2>Recent Projects</h2>
                        <div id="recent-projects-list" class="recent-projects-list">
                            <div class="loading">Loading...</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Attach event listeners
        document.getElementById('btn-create-project').onclick = () => this.showCreateProjectDialog();
        document.getElementById('btn-open-project').onclick = () => this.showOpenProjectDialog();

        // Load recent projects
        this.loadRecentProjects();
    }

    /**
     * Load and display recent projects
     */
    async loadRecentProjects() {
        const listEl = document.getElementById('recent-projects-list');

        try {
            const response = await fetch(`${this.apiBase}/projects`);
            const data = await response.json();
            const projects = data.projects || [];

            if (projects.length === 0) {
                listEl.innerHTML = '<p class="no-projects">No recent projects. Create one to get started!</p>';
                return;
            }

            listEl.innerHTML = projects.map(project => `
                <div class="project-card" data-project-id="${project.projectId}">
                    <div class="project-card-header">
                        <h3>${this.escapeHtml(project.name)}</h3>
                        <span class="project-badge">${project.seriesCount || 0} series</span>
                    </div>
                    <div class="project-card-meta">
                        <span class="project-patient">${this.escapeHtml(project.patient || 'Unknown')}</span>
                        <span class="project-date">${this.formatDate(project.lastOpened)}</span>
                    </div>
                </div>
            `).join('');

            // Attach click handlers
            document.querySelectorAll('.project-card').forEach(card => {
                card.onclick = () => {
                    const projectId = card.dataset.projectId;
                    this.loadProject(projectId);
                };
            });

        } catch (error) {
            console.error('Failed to load projects:', error);
            listEl.innerHTML = '<p class="error">Failed to load projects</p>';
        }
    }

    /**
     * Show create project dialog
     */
    showCreateProjectDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Create New Project</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="project-name">Project Name *</label>
                        <input type="text" id="project-name" placeholder="e.g., Patient_Brain_20240508" required>
                    </div>
                    <div class="form-group">
                        <label for="patient-name">Patient Name (Optional)</label>
                        <input type="text" id="patient-name" placeholder="e.g., SMITH^JOHN">
                    </div>
                    <div class="form-group">
                        <label for="patient-mrn">MRN (Optional)</label>
                        <input type="text" id="patient-mrn" placeholder="e.g., 000-00-0000">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary modal-cancel">Cancel</button>
                    <button class="btn-primary" id="btn-confirm-create">Create Project</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Event listeners
        dialog.querySelector('.modal-close').onclick = () => dialog.remove();
        dialog.querySelector('.modal-cancel').onclick = () => dialog.remove();
        dialog.querySelector('#btn-confirm-create').onclick = () => this.createProject(dialog);

        // Focus name input
        setTimeout(() => document.getElementById('project-name').focus(), 100);
    }

    /**
     * Create new project
     */
    async createProject(dialog) {
        const name = document.getElementById('project-name').value.trim();
        const patientName = document.getElementById('patient-name').value.trim();
        const patientMRN = document.getElementById('patient-mrn').value.trim();

        if (!name) {
            alert('Project name is required');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    patientInfo: {
                        name: patientName,
                        mrn: patientMRN
                    }
                })
            });

            if (!response.ok) {
                throw new Error('Failed to create project');
            }

            const project = await response.json();
            dialog.remove();

            // Ask if user wants to import now
            if (confirm('Project created! Import scans now?')) {
                this.currentProject = project;
                if (window.importUI) {
                    window.importUI.showImportDialog(project.projectId);
                }
            } else {
                // Load the empty project
                this.loadProject(project.projectId);
            }

        } catch (error) {
            console.error('Failed to create project:', error);
            alert('Failed to create project. Please try again.');
        }
    }

    /**
     * Show open project dialog (file picker simulation)
     */
    showOpenProjectDialog() {
        // For now, just show recent projects
        alert('Please select a project from the recent projects list below');
    }

    /**
     * Load project by ID
     */
    async loadProject(projectId) {
        try {
            const response = await fetch(`${this.apiBase}/projects/${projectId}`);
            if (!response.ok) {
                throw new Error('Failed to load project');
            }

            const project = await response.json();
            this.currentProject = project;

            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('project', projectId);
            window.history.pushState({}, '', url);

            // Initialize the viewer with project data
            if (window.initializeViewer) {
                window.initializeViewer(project);
            } else {
                console.error('Viewer initialization function not found');
            }

        } catch (error) {
            console.error('Failed to load project:', error);
            alert('Failed to load project. Please try again.');
        }
    }

    /**
     * Get image URL for project
     */
    getImageUrl(imagePath) {
        if (!this.currentProject) {
            console.error('No project loaded');
            return null;
        }
        return `/projects/${this.currentProject.projectId}/${imagePath}`;
    }

    /**
     * Helper: Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Helper: Format date
     */
    formatDate(isoString) {
        if (!isoString) return 'Unknown';
        try {
            const date = new Date(isoString);
            const now = new Date();
            const diff = now - date;
            const hours = Math.floor(diff / (1000 * 60 * 60));

            if (hours < 1) return 'Just now';
            if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

            const days = Math.floor(hours / 24);
            if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

            return date.toLocaleDateString();
        } catch {
            return 'Unknown';
        }
    }
}

// Initialize global instance
window.projectUI = new ProjectUI();
