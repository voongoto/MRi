/**
 * Import UI Module
 * Handles DICOM and JPEG import workflows
 */

class ImportUI {
    constructor() {
        this.apiBase = '/api';
        this.activeImportId = null;
        this.eventSource = null;
    }

    /**
     * Show import dialog
     */
    showImportDialog(projectId) {
        this.projectId = projectId;

        const dialog = document.createElement('div');
        dialog.id = 'import-dialog';
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2>Import Scans</h2>
                    <button class="modal-close">&times;</button>
                </div>

                <div class="modal-body">
                    <div class="import-tabs">
                        <button class="import-tab active" data-type="dicom">
                            DICOM Folder
                        </button>
                        <button class="import-tab" data-type="jpeg">
                            JPEG Folder
                        </button>
                    </div>

                    <div class="import-content">
                        <div class="import-form" id="import-form">
                            <div class="form-group">
                                <label for="import-source-path">Source Path:</label>
                                <input type="text"
                                       id="import-source-path"
                                       placeholder="/path/to/dicom/folder"
                                       class="input-large">
                                <p class="help-text">
                                    Enter the full path to the folder containing DICOM files
                                </p>
                            </div>

                            <button class="btn-primary btn-large" id="btn-start-import">
                                <span class="icon">📥</span>
                                Start Import
                            </button>
                        </div>

                        <div class="import-progress hidden" id="import-progress">
                            <div class="progress-header">
                                <h3 id="progress-title">Importing...</h3>
                                <span id="progress-percent">0%</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" id="progress-bar"></div>
                            </div>
                            <p class="progress-message" id="progress-message">Initializing...</p>
                            <div class="progress-stats" id="progress-stats"></div>
                        </div>
                    </div>
                </div>

                <div class="modal-footer">
                    <button class="btn-secondary" id="btn-cancel-import">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Event listeners
        const closeDialog = () => {
            if (this.eventSource) {
                this.eventSource.close();
            }
            dialog.remove();
        };

        dialog.querySelector('.modal-close').onclick = closeDialog;
        dialog.querySelector('#btn-cancel-import').onclick = closeDialog;

        // Tab switching
        dialog.querySelectorAll('.import-tab').forEach(tab => {
            tab.onclick = () => {
                dialog.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.updatePlaceholder(tab.dataset.type);
            };
        });

        // Start import
        dialog.querySelector('#btn-start-import').onclick = () => {
            const activeTab = dialog.querySelector('.import-tab.active');
            const sourceType = activeTab.dataset.type;
            const sourcePath = dialog.querySelector('#import-source-path').value.trim();

            if (!sourcePath) {
                alert('Please enter a source path');
                return;
            }

            this.startImport(sourceType, sourcePath);
        };

        // Focus input
        setTimeout(() => document.getElementById('import-source-path').focus(), 100);
    }

    /**
     * Update placeholder based on import type
     */
    updatePlaceholder(type) {
        const input = document.getElementById('import-source-path');
        if (type === 'dicom') {
            input.placeholder = '/path/to/dicom/folder';
        } else {
            input.placeholder = '/path/to/jpeg/folder';
        }
    }

    /**
     * Start import process
     */
    async startImport(sourceType, sourcePath) {
        try {
            // Show progress UI
            document.getElementById('import-form').classList.add('hidden');
            document.getElementById('import-progress').classList.remove('hidden');

            // Start import
            const response = await fetch(`${this.apiBase}/projects/${this.projectId}/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceType: sourceType,
                    sourcePath: sourcePath
                })
            });

            if (!response.ok) {
                throw new Error('Failed to start import');
            }

            const data = await response.json();
            this.activeImportId = data.importId;

            // Track progress via SSE
            this.trackProgress(data.importId);

        } catch (error) {
            console.error('Import failed:', error);
            alert('Failed to start import. Please check the path and try again.');
            document.getElementById('import-form').classList.remove('hidden');
            document.getElementById('import-progress').classList.add('hidden');
        }
    }

    /**
     * Track import progress via Server-Sent Events
     */
    trackProgress(importId) {
        const url = `${this.apiBase}/projects/${this.projectId}/import/${importId}/progress`;
        this.eventSource = new EventSource(url);

        this.eventSource.onmessage = (event) => {
            const progress = JSON.parse(event.data);
            this.updateProgress(progress);

            // Close connection when complete or failed
            if (progress.status === 'completed' || progress.status === 'failed') {
                this.eventSource.close();
                this.eventSource = null;

                if (progress.status === 'completed') {
                    setTimeout(() => {
                        this.onImportComplete(progress);
                    }, 1000);
                }
            }
        };

        this.eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            this.eventSource.close();
            this.eventSource = null;
        };
    }

    /**
     * Update progress UI
     */
    updateProgress(progress) {
        const progressBar = document.getElementById('progress-bar');
        const progressPercent = document.getElementById('progress-percent');
        const progressMessage = document.getElementById('progress-message');
        const progressStats = document.getElementById('progress-stats');

        // Update progress bar
        progressBar.style.width = `${progress.progress}%`;
        progressPercent.textContent = `${Math.round(progress.progress)}%`;

        // Update message
        progressMessage.textContent = progress.message || 'Processing...';

        // Update stats if available
        if (progress.seriesCount !== undefined) {
            progressStats.innerHTML = `
                <div class="stat">
                    <span class="stat-label">Series:</span>
                    <span class="stat-value">${progress.seriesCount}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Images:</span>
                    <span class="stat-value">${progress.imageCount || 0}</span>
                </div>
            `;
        }

        // Update title based on status
        const title = document.getElementById('progress-title');
        if (progress.status === 'completed') {
            title.textContent = 'Import Complete!';
            title.className = 'success';
        } else if (progress.status === 'failed') {
            title.textContent = 'Import Failed';
            title.className = 'error';
        } else {
            title.textContent = 'Importing...';
        }
    }

    /**
     * Handle import completion
     */
    onImportComplete(progress) {
        // Close dialog
        const dialog = document.getElementById('import-dialog');
        if (dialog) {
            dialog.remove();
        }

        // Show success message
        alert(`Import completed!\n\nSeries: ${progress.seriesCount}\nImages: ${progress.imageCount}`);

        // Reload project to show new data
        if (window.projectUI && window.projectUI.currentProject) {
            window.projectUI.loadProject(this.projectId);
        }
    }
}

// Initialize global instance
window.importUI = new ImportUI();
