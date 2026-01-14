/**
 * Patient UI Module
 * Handles patient-centered UI for the MRI viewer
 */

class PatientUI {
    constructor() {
        this.apiBase = '/api';
        this.currentPatient = null;
        this.currentStudy = null;
    }

    /**
     * Show empty state when no patients exist
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
                    <p class="subtitle">Patient-Centered Medical Image Viewer</p>

                    <div class="empty-state-actions">
                        <button id="btn-import-dicom" class="btn-primary">
                            <span class="icon">+</span>
                            Import DICOM Scans
                        </button>
                    </div>

                    <div class="recent-patients-container">
                        <h2>Recent Patients</h2>
                        <div id="recent-patients-list" class="recent-projects-list">
                            <div class="loading">Loading...</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Attach event listeners
        document.getElementById('btn-import-dicom').onclick = () => this.showImportDialog();

        // Load recent patients
        this.loadRecentPatients();
    }

    /**
     * Load and display recent patients
     */
    async loadRecentPatients() {
        console.log('[Patients] Loading patient list...');
        const listEl = document.getElementById('recent-patients-list');

        try {
            const response = await fetch(`${this.apiBase}/patients`);
            const data = await response.json();
            const patients = data.patients || [];
            console.log('[Patients] Loaded', patients.length, 'patients');

            if (patients.length === 0) {
                listEl.innerHTML = '<p class="no-projects">No patients yet. Import DICOM scans to get started!</p>';
                return;
            }

            listEl.innerHTML = patients.map(patient => `
                <div class="project-card patient-card" data-patient-id="${patient.patientId}">
                    <div class="project-card-header">
                        <h3>${this.escapeHtml(patient.name)}</h3>
                        <span class="project-badge">${patient.studyCount || 0} ${patient.studyCount === 1 ? 'study' : 'studies'}</span>
                        <button class="btn-delete-patient" data-patient-id="${patient.patientId}" title="Delete patient">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                    <div class="project-card-meta">
                        <span class="project-patient">${patient.seriesCount || 0} series</span>
                        <span class="project-date">${this.formatDate(patient.lastOpened)}</span>
                    </div>
                    ${this.renderStudyList(patient)}
                </div>
            `).join('');

            // Attach click handlers
            document.querySelectorAll('.patient-card').forEach(card => {
                card.onclick = (e) => {
                    // Check if clicking delete button
                    const deleteBtn = e.target.closest('.btn-delete-patient');
                    if (deleteBtn) {
                        e.stopPropagation();
                        const patientId = deleteBtn.dataset.patientId;
                        this.confirmDeletePatient(patientId);
                        return;
                    }

                    const patientId = card.dataset.patientId;

                    // Check if clicking on a specific study (optional single-study load)
                    const studyItem = e.target.closest('.study-item');
                    if (studyItem) {
                        const studyId = studyItem.dataset.studyId;
                        this.loadStudy(patientId, studyId);
                    } else {
                        // Click on patient card header - load ALL studies (unified view)
                        this.loadPatient(patientId);
                    }
                };
            });

        } catch (error) {
            console.error('Failed to load patients:', error);
            listEl.innerHTML = '<p class="error">Failed to load patients</p>';
        }
    }

    /**
     * Render study list for a patient
     */
    renderStudyList(patient) {
        if (!patient.studies || patient.studies.length === 0) {
            return '<div class="study-list"><p class="no-studies">No studies</p></div>';
        }

        const studies = patient.studies.map(study => {
            const formattedDate = this.formatStudyDate(study.studyDate);
            return `
                <div class="study-item" data-study-id="${study.studyId}">
                    <span class="study-date">${formattedDate}</span>
                    <span class="study-series">${study.seriesCount || 0} series</span>
                </div>
            `;
        }).join('');

        return `<div class="study-list">${studies}</div>`;
    }

    /**
     * Show import dialog
     */
    showImportDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Import DICOM Scans</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="import-info">Enter the path to your DICOM folder. Patient information will be automatically extracted from the DICOM metadata.</p>
                    <div class="form-group">
                        <label for="dicom-path">DICOM Folder Path *</label>
                        <div class="input-with-button">
                            <input type="text" id="dicom-path" placeholder="/path/to/your/dicom/folder" required>
                            <button type="button" id="btn-browse-folder" class="btn-secondary">Browse...</button>
                        </div>
                    </div>
                    <div id="import-status" class="import-status hidden">
                        <div class="import-progress-bar">
                            <div class="import-progress-fill" style="width: 0%"></div>
                        </div>
                        <p class="import-message">Starting import...</p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary modal-cancel">Cancel</button>
                    <button class="btn-primary" id="btn-start-import">Start Import</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // Event listeners
        dialog.querySelector('.modal-close').onclick = () => dialog.remove();
        dialog.querySelector('.modal-cancel').onclick = () => dialog.remove();
        dialog.querySelector('#btn-start-import').onclick = () => this.startImport(dialog);
        dialog.querySelector('#btn-browse-folder').onclick = () => this.browseFolder();

        // Focus path input
        setTimeout(() => document.getElementById('dicom-path').focus(), 100);
    }

    /**
     * Open native folder browser dialog
     */
    async browseFolder() {
        const browseBtn = document.getElementById('btn-browse-folder');
        const pathInput = document.getElementById('dicom-path');

        // Disable button while browsing
        browseBtn.disabled = true;
        browseBtn.textContent = 'Opening...';

        try {
            const response = await fetch(`${this.apiBase}/browse/folder`);
            const data = await response.json();

            if (data.path) {
                pathInput.value = data.path;
                pathInput.focus();
            } else if (data.cancelled) {
                // User cancelled, do nothing
            } else if (data.error) {
                console.warn('Folder picker error:', data.error);
            }
        } catch (error) {
            console.error('Failed to open folder picker:', error);
        } finally {
            browseBtn.disabled = false;
            browseBtn.textContent = 'Browse...';
        }
    }

    /**
     * Start DICOM import
     */
    async startImport(dialog) {
        const pathInput = document.getElementById('dicom-path');
        const sourcePath = pathInput.value.trim();

        console.log('[Import] Starting import from:', sourcePath);

        if (!sourcePath) {
            console.warn('[Import] No path provided');
            alert('Please enter a DICOM folder path');
            return;
        }

        // Show progress
        const statusEl = dialog.querySelector('#import-status');
        const progressFill = statusEl.querySelector('.import-progress-fill');
        const messageEl = statusEl.querySelector('.import-message');
        statusEl.classList.remove('hidden');

        // Disable buttons and show importing state
        const startBtn = dialog.querySelector('#btn-start-import');
        const cancelBtn = dialog.querySelector('.modal-cancel');
        const browseBtn = dialog.querySelector('#btn-browse-folder');

        startBtn.disabled = true;
        startBtn.textContent = 'Importing...';
        browseBtn.disabled = true;
        pathInput.disabled = true;

        // Track eventSource for cancellation
        let activeEventSource = null;

        // Update cancel button to allow cancellation
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
            console.log('[Import] User cancelled import');
            if (activeEventSource) {
                activeEventSource.close();
            }
            dialog.remove();
            this.showEmptyState();
        };

        try {
            // Start import
            console.log('[Import] Sending POST request to /api/import/dicom');
            const response = await fetch(`${this.apiBase}/import/dicom`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourcePath })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('[Import] Server returned error:', error);
                throw new Error(error.error || 'Import failed');
            }

            const { importId } = await response.json();
            console.log('[Import] Import started with ID:', importId);

            // Track progress via SSE (using generic endpoint)
            console.log('[Import] Connecting to SSE progress stream...');
            activeEventSource = new EventSource(`${this.apiBase}/import/${importId}/progress`);
            const eventSource = activeEventSource;

            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('[Import] Progress:', data.progress + '%', '-', data.message, data.status ? `(${data.status})` : '');

                progressFill.style.width = `${data.progress}%`;
                messageEl.textContent = data.message || 'Processing...';

                if (data.status === 'completed') {
                    console.log('[Import] Import completed successfully!', data);
                    eventSource.close();
                    messageEl.textContent = 'Import completed!';

                    // Redirect to unified patient view (shows all studies)
                    setTimeout(async () => {
                        dialog.remove();
                        if (data.patientId) {
                            console.log('[Import] Loading patient (unified view):', data.patientId);
                            this.loadPatient(data.patientId);
                        } else {
                            // Patient ID missing from SSE - try to get it from status endpoint
                            console.log('[Import] No patient ID in SSE, checking status endpoint...');
                            try {
                                const statusResponse = await fetch(`${this.apiBase}/import/${importId}/status`);
                                const statusData = await statusResponse.json();
                                if (statusData.patientId) {
                                    console.log('[Import] Got patient ID from status:', statusData.patientId);
                                    this.loadPatient(statusData.patientId);
                                    return;
                                }
                            } catch (e) {
                                console.error('[Import] Status check failed:', e);
                            }
                            console.log('[Import] Fallback: refreshing patient list');
                            this.showEmptyState();
                        }
                    }, 1000);
                } else if (data.status === 'failed') {
                    console.error('[Import] Import failed:', data.message);
                    eventSource.close();
                    throw new Error(data.message || 'Import failed');
                }
            };

            eventSource.onerror = async (err) => {
                console.error('[Import] SSE connection error:', err);
                eventSource.close();

                // Actually check if import succeeded despite SSE error
                try {
                    console.log('[Import] Checking import status after SSE error...');
                    const statusResponse = await fetch(`${this.apiBase}/import/${importId}/status`);
                    const statusData = await statusResponse.json();
                    console.log('[Import] Status check result:', statusData);

                    if (statusData.status === 'completed' && statusData.patientId) {
                        console.log('[Import] Import succeeded! Loading patient (unified view)...');
                        messageEl.textContent = 'Import completed!';
                        setTimeout(() => {
                            dialog.remove();
                            this.loadPatient(statusData.patientId);
                        }, 1000);
                        return;
                    }
                } catch (statusErr) {
                    console.error('[Import] Failed to check import status:', statusErr);
                }

                // Fallback to patient list if status check fails
                setTimeout(() => {
                    dialog.remove();
                    this.showEmptyState();
                }, 1000);
            };

        } catch (error) {
            console.error('[Import] Import failed:', error);
            messageEl.textContent = `Import failed: ${error.message}`;
            progressFill.style.backgroundColor = '#ef4444';

            // Re-enable buttons for retry
            startBtn.disabled = false;
            startBtn.textContent = 'Start Import';
            browseBtn.disabled = false;
            pathInput.disabled = false;

            // Restore cancel to close dialog
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => dialog.remove();
        }
    }

    /**
     * Load a specific study
     */
    async loadStudy(patientId, studyId) {
        console.log('[Study] Loading study:', patientId, studyId);

        // Check if we need to reload page (viewer HTML may have been replaced by empty state)
        const viewerElements = document.getElementById('region-list');
        if (!viewerElements) {
            // Viewer HTML not present - reload page with correct URL
            console.log('[Study] Viewer not ready, reloading page...');
            const url = new URL(window.location);
            url.searchParams.set('patient', patientId);
            url.searchParams.set('study', studyId);
            window.location.href = url.toString();
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/patients/${patientId}/studies/${studyId}`);
            if (!response.ok) {
                console.error('[Study] Server returned error:', response.status);
                throw new Error('Failed to load study');
            }

            const studyData = await response.json();
            console.log('[Study] Study data loaded:', studyData.series?.length || 0, 'series');

            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('patient', patientId);
            url.searchParams.set('study', studyId);
            window.history.pushState({}, '', url);

            // Initialize viewer with study data
            if (typeof window.initializeViewer === 'function') {
                console.log('[Study] Initializing viewer...');
                window.initializeViewer(studyData);
            } else {
                console.error('[Study] initializeViewer function not found!');
            }

        } catch (error) {
            console.error('[Study] Failed to load study:', error);
            alert('Failed to load study: ' + error.message);
        }
    }

    /**
     * Load all studies for a patient (unified view)
     */
    async loadPatient(patientId) {
        console.log('[Patient] Loading all studies for patient:', patientId);

        // Check if we need to reload page (viewer HTML may have been replaced by empty state)
        const viewerElements = document.getElementById('region-list');
        if (!viewerElements) {
            // Viewer HTML not present - reload page with correct URL
            console.log('[Patient] Viewer not ready, reloading page...');
            const url = new URL(window.location);
            url.searchParams.set('patient', patientId);
            url.searchParams.delete('study'); // Remove study param for unified view
            window.location.href = url.toString();
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/patients/${patientId}/all-series`);
            if (!response.ok) {
                console.error('[Patient] Server returned error:', response.status);
                throw new Error('Failed to load patient data');
            }

            const patientData = await response.json();
            console.log('[Patient] Patient data loaded:', patientData.series?.length || 0, 'series from all studies');

            // Update URL (patient only, no study)
            const url = new URL(window.location);
            url.searchParams.set('patient', patientId);
            url.searchParams.delete('study');
            window.history.pushState({}, '', url);

            // Initialize viewer with combined series data
            if (typeof window.initializeViewer === 'function') {
                console.log('[Patient] Initializing viewer with unified data...');
                window.initializeViewer(patientData);
            } else {
                console.error('[Patient] initializeViewer function not found!');
            }

        } catch (error) {
            console.error('[Patient] Failed to load patient:', error);
            alert('Failed to load patient: ' + error.message);
        }
    }

    /**
     * Format date for display
     */
    formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        try {
            const date = new Date(dateStr);
            const now = new Date();
            const diff = now - date;

            if (diff < 60000) return 'Just now';
            if (diff < 3600000) return `${Math.floor(diff/60000)} min ago`;
            if (diff < 86400000) return `${Math.floor(diff/3600000)} hours ago`;
            if (diff < 604800000) return `${Math.floor(diff/86400000)} days ago`;

            return date.toLocaleDateString();
        } catch {
            return dateStr;
        }
    }

    /**
     * Format DICOM study date (YYYYMMDD) for display
     */
    formatStudyDate(studyDate) {
        if (!studyDate || studyDate.length !== 8) return studyDate || 'Unknown';
        try {
            const year = studyDate.substring(0, 4);
            const month = studyDate.substring(4, 6);
            const day = studyDate.substring(6, 8);
            return `${month}/${day}/${year}`;
        } catch {
            return studyDate;
        }
    }

    /**
     * Confirm patient deletion
     */
    confirmDeletePatient(patientId) {
        console.log('[Delete] Confirming delete for patient:', patientId);
        if (confirm('Are you sure you want to delete this patient and all their studies? This cannot be undone.')) {
            this.deletePatient(patientId);
        }
    }

    /**
     * Delete patient
     */
    async deletePatient(patientId) {
        console.log('[Delete] Deleting patient:', patientId);
        try {
            const response = await fetch(`${this.apiBase}/patients/${patientId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                console.error('[Delete] Server returned error:', response.status);
                throw new Error('Failed to delete patient');
            }

            console.log('[Delete] Patient deleted successfully');
            // Refresh the patient list
            this.loadRecentPatients();

        } catch (error) {
            console.error('[Delete] Failed to delete patient:', error);
            alert('Failed to delete patient: ' + error.message);
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use
window.PatientUI = PatientUI;
