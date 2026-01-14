document.addEventListener('DOMContentLoaded', () => {
    let appData = null;
    let currentSeries = null;
    let currentImageIndex = 0;

    // --- Selection State ---
    let selectionMode = false;
    let selectedSeriesIds = new Set();

    // --- Tool State ---
    let currentZoom = 1;
    let currentTool = 'pan'; // 'pan', 'wl', 'crosshair', 'marker', 'measure'
    let isPanning = false;
    let isAdjustingWL = false;
    let startDrag = { x: 0, y: 0 };
    let panOffset = { x: 0, y: 0 };
    let startWL = { b: 100, c: 100 };

    // --- Annotation State ---
    let annotations = {}; // key: "seriesId-imageIndex", value: annotation object
    // activeMarkerNumber removed - using per-image counting
    let activeMeasurement = null; // For in-progress measurement
    let invertContrast = false; // Contrast invert toggle state
    let crosshairPosition = null; // Fixed crosshair position { x, y } in canvas coords


    // --- Favorites State ---
    let favoriteSeries = new Set(); // Set of favorited series IDs

    // Elements
    const els = {
        regionList: document.getElementById('region-list'),
        viewport: document.querySelector('.viewport'),
        mainImage: document.getElementById('main-image'),
        scrubber: document.getElementById('scrubber-slice'),
        sliceIdx: document.getElementById('vpc-slice-idx'),
        sliceTotal: document.getElementById('vpc-slice-total'),
        headerName: document.getElementById('header-patient-name'),
        headerDate: document.getElementById('header-date'),
        bright: document.getElementById('scrubber-brightness'),
        contrast: document.getElementById('scrubber-contrast'),
        canvas: document.getElementById('image-canvas'),
        totalSeriesCount: document.getElementById('total-series-count'),
        rightSeriesList: document.getElementById('right-series-list'),
        // Slice Navigation
        btnSlicePrev: document.getElementById('btn-slice-prev'),
        btnSliceNext: document.getElementById('btn-slice-next'),
        // Toolbar
        btnZoomIn: document.getElementById('btn-zoom-in'),
        btnZoomOut: document.getElementById('btn-zoom-out'),
        zoomLevelDisplay: document.getElementById('zoom-level-display'),
        btnWlReset: document.getElementById('btn-wl-reset'),
        btnWlTool: document.getElementById('btn-wl-tool'),
        btnMarker: document.getElementById('btn-marker'),
        btnMeasure: document.getElementById('btn-measure'),
        btnInvert: document.getElementById('btn-invert'),
        // Annotation Elements
        annotationOverlay: document.getElementById('annotation-overlay'),
        annotationGroup: document.getElementById('annotation-group'),
        // Selection Mode
        exportBar: document.getElementById('export-bar'),
        selectedCount: document.getElementById('selected-count'),
        btnExport: document.getElementById('btn-export'),
        // Sidebar
        seriesTitle: document.getElementById('vpc-series-desc'),
        seriesSubtitle: document.getElementById('vpc-series-tech'),
        seriesDate: document.getElementById('vpc-series-date'),
        infoDesc: document.getElementById('info-desc'),
        infoClinic: document.getElementById('info-clinic'),
        infoMachine: document.getElementById('info-machine'),
        infoProtocol: document.getElementById('info-protocol'),
        infoModality: document.getElementById('info-modality'),
        infoImages: document.getElementById('info-images'),
        infoThickness: document.getElementById('info-thickness'),
        infoTr: document.getElementById('info-tr'),
        infoTe: document.getElementById('info-te'),
        btnToggleSelect: document.getElementById('toggle-select-mode'),
        regionList: document.getElementById('region-list'),
        seqCard: document.getElementById('seq-card'),
        seqIcon: document.getElementById('seq-icon'),
        seqName: document.getElementById('seq-name'),
        seqDesc: document.getElementById('seq-desc'),

        // AI Analysis
        btnAiAnalyze: document.getElementById('btn-ai-analyze'),
        aiSettingsModal: document.getElementById('ai-settings-modal'),
        aiResultsModal: document.getElementById('ai-results-modal'),
        btnRunAi: document.getElementById('btn-run-ai'),
        btnCopyAi: document.getElementById('btn-copy-ai'),
        aiLoading: document.getElementById('ai-loading'),
        aiContent: document.getElementById('ai-content')
    };

    // ===== ANNOTATION COORDINATE UTILITIES =====
    const AnnotationCoordinates = {
        /**
         * Convert viewport click coordinates to image pixel coordinates
         * Accounts for zoom, pan, and image natural dimensions
         */
        viewportToImage(viewportX, viewportY) {
            if (!els.mainImage || !els.canvas) return { x: 0, y: 0, valid: false };

            const imageElement = els.mainImage;
            const canvas = els.canvas;
            const rect = imageElement.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();

            // Get click position relative to canvas
            const canvasX = viewportX - canvasRect.left;
            const canvasY = viewportY - canvasRect.top;

            // Get image center in canvas
            const imgCenterX = rect.left - canvasRect.left + rect.width / 2;
            const imgCenterY = rect.top - canvasRect.top + rect.height / 2;

            // Convert to image pixel coordinates accounting for zoom and pan
            const relX = (canvasX - imgCenterX) / currentZoom - panOffset.x;
            const relY = (canvasY - imgCenterY) / currentZoom - panOffset.y;

            // Convert from displayed size to natural image size
            const naturalWidth = imageElement.naturalWidth;
            const naturalHeight = imageElement.naturalHeight;
            const displayedWidth = rect.width / currentZoom;
            const displayedHeight = rect.height / currentZoom;

            const pixelX = (relX + displayedWidth / 2) * (naturalWidth / displayedWidth);
            const pixelY = (relY + displayedHeight / 2) * (naturalHeight / displayedHeight);

            return {
                x: Math.round(pixelX),
                y: Math.round(pixelY),
                valid: pixelX >= 0 && pixelX <= naturalWidth && pixelY >= 0 && pixelY <= naturalHeight
            };
        },

        /**
         * Convert image pixel coordinates to SVG overlay coordinates
         * For rendering annotations in the overlay
         */
        imageToSVG(imageX, imageY) {
            if (!els.mainImage || !els.annotationOverlay) return { x: 0, y: 0 };

            const imageElement = els.mainImage;
            const rect = imageElement.getBoundingClientRect();
            const canvasRect = els.canvas.getBoundingClientRect();

            const naturalWidth = imageElement.naturalWidth;
            const naturalHeight = imageElement.naturalHeight;

            // Scale to displayed size
            const displayedWidth = rect.width / currentZoom;
            const displayedHeight = rect.height / currentZoom;
            const scaleX = displayedWidth / naturalWidth;
            const scaleY = displayedHeight / naturalHeight;

            // Convert to displayed coordinates
            let svgX = imageX * scaleX;
            let svgY = imageY * scaleY;

            // Apply zoom
            svgX = svgX * currentZoom;
            svgY = svgY * currentZoom;

            // Apply pan offset
            svgX += panOffset.x * currentZoom;
            svgY += panOffset.y * currentZoom;

            // Center in canvas
            const imgCenterX = rect.left - canvasRect.left + rect.width / 2;
            const imgCenterY = rect.top - canvasRect.top + rect.height / 2;

            svgX += imgCenterX - (displayedWidth * currentZoom) / 2;
            svgY += imgCenterY - (displayedHeight * currentZoom) / 2;

            return { x: svgX, y: svgY };
        }
    };

    // ===== MARKER TOOL =====
    const MarkerTool = {
        placeMarker(imageX, imageY) {
            const key = `${currentSeries.id}-${currentImageIndex}`;

            if (!annotations[key]) {
                annotations[key] = {
                    seriesId: currentSeries.id,
                    imageIndex: currentImageIndex,
                    markers: [],
                    measurements: [],
                    pixelSpacing: this.calculatePixelSpacing(),
                    createdAt: new Date().toISOString(),
                    modifiedAt: new Date().toISOString()
                };
            }

            // Calculate next number based on current count
            const nextNumber = annotations[key].markers.length + 1;

            const marker = {
                id: `marker-${Date.now()}`,
                number: nextNumber,
                x: imageX,
                y: imageY,
                label: `Point ${nextNumber}`,
                color: "#ff0000"
            };

            annotations[key].markers.push(marker);
            annotations[key].modifiedAt = new Date().toISOString();

            this.saveAnnotations(key);
            this.renderAnnotations();
        },

        deleteMarker(markerId) {
            const key = `${currentSeries.id}-${currentImageIndex}`;
            const annot = annotations[key];

            if (annot) {
                annot.markers = annot.markers.filter(m => m.id !== markerId);

                // Re-index remaining markers to ensure 1, 2, 3...
                annot.markers.forEach((m, index) => {
                    m.number = index + 1;
                    m.label = `Point ${m.number}`;
                });

                annot.modifiedAt = new Date().toISOString();
                this.saveAnnotations(key);
                this.renderAnnotations();
            }
        },

        calculatePixelSpacing() {
            // Estimate mm per pixel from slice_thickness
            const thickness = parseFloat(currentSeries?.slice_thickness) || 1.0;
            return thickness / 10; // Rough approximation
        },

        saveAnnotations(key) {
            try {
                localStorage.setItem(`mri-annotations-${key}`, JSON.stringify(annotations[key]));
            } catch (e) {
                console.error('Failed to save annotations:', e);
            }
        },

        loadAnnotations(seriesId, imageIndex) {
            const key = `${seriesId}-${imageIndex}`;
            try {
                const stored = localStorage.getItem(`mri-annotations-${key}`);
                if (stored) {
                    annotations[key] = JSON.parse(stored);
                    return annotations[key];
                }
            } catch (e) {
                console.error('Failed to load annotations:', e);
            }
            return null;
        },

        renderAnnotations() {
            if (!els.annotationGroup || !els.mainImage) return;

            // Clear existing
            els.annotationGroup.innerHTML = '';

            const key = `${currentSeries?.id}-${currentImageIndex}`;
            const annot = annotations[key];

            if (!annot) return;

            // Render markers
            annot.markers.forEach(marker => {
                const svg = AnnotationCoordinates.imageToSVG(marker.x, marker.y);

                // Create marker group
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.classList.add('interactive');
                g.setAttribute('data-marker-id', marker.id);

                // Pin Icon using Path
                // Centered at bottom tip (svg.x, svg.y)
                const pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                // Shift so the tip (12, 23 in viewbox 0-24) is at 0,0
                // ViewBox 24x24. Tip is approx at 12,23. 
                // Let's draw a pin shape: M12 23 C12 23 3 16 3 9 A9 9 0 1 1 21 9 C21 16 12 23 12 23 Z
                // Inner circle: cx 12 cy 9 r 3

                const pinPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                pinPath.setAttribute('d', 'M12 23C12 23 3 16 3 9a9 9 0 1 1 18 0c0 7-9 14-9 14z');
                pinPath.setAttribute('fill', marker.color || '#ff0000');
                pinPath.setAttribute('stroke', 'white');
                pinPath.setAttribute('stroke-width', '2');
                pinPath.classList.add('annotation-marker-pin');

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', '12');
                circle.setAttribute('cy', '9');
                circle.setAttribute('r', '3');
                circle.setAttribute('fill', 'white');

                // Transform to place tip at svg.x, svg.y
                // The drawing has tip at 12,23. So we translate by -12, -23 relative to cursor
                pinGroup.setAttribute('transform', `translate(${svg.x - 12}, ${svg.y - 23})`);

                pinGroup.appendChild(pinPath);
                pinGroup.appendChild(circle);

                // Number label - place it inside the head of pin (cy=9)
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', '12');
                text.setAttribute('y', '13'); // Centered vertically in the head roughly
                text.classList.add('annotation-marker-label');
                text.style.fontSize = "10px";
                text.style.fontWeight = "bold";
                text.style.fill = "black";
                text.style.textAnchor = "middle";
                text.textContent = marker.number;

                pinGroup.appendChild(text);

                g.appendChild(pinGroup);

                // Delete on right-click
                g.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (confirm(`Delete marker ${marker.number}?`)) {
                        this.deleteMarker(marker.id);
                    }
                });

                els.annotationGroup.appendChild(g);
            });

            // Render measurements
            this.renderMeasurements(annot);

            // Render crosshairs
            if (typeof CrosshairTool !== 'undefined') {
                CrosshairTool.renderCrosshairs(annot);
            }
        },

        renderMeasurements(annot) {
            if (!annot) return;

            // Render active measurement (in progress)
            if (activeMeasurement) {
                const start = AnnotationCoordinates.imageToSVG(
                    activeMeasurement.startX, activeMeasurement.startY
                );
                const end = AnnotationCoordinates.imageToSVG(
                    activeMeasurement.endX, activeMeasurement.endY
                );

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', start.x);
                line.setAttribute('y1', start.y);
                line.setAttribute('x2', end.x);
                line.setAttribute('y2', end.y);
                line.classList.add('annotation-measure-line');
                line.style.strokeDasharray = '5,5'; // Dashed for temp
                els.annotationGroup.appendChild(line);
            }

            // Render saved measurements
            annot.measurements.forEach(measure => {
                const start = AnnotationCoordinates.imageToSVG(
                    measure.startX, measure.startY
                );
                const end = AnnotationCoordinates.imageToSVG(
                    measure.endX, measure.endY
                );

                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.classList.add('interactive');
                g.setAttribute('data-measure-id', measure.id);

                // Line
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', start.x);
                line.setAttribute('y1', start.y);
                line.setAttribute('x2', end.x);
                line.setAttribute('y2', end.y);
                line.classList.add('annotation-measure-line');

                // Endpoints
                const startCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                startCircle.setAttribute('cx', start.x);
                startCircle.setAttribute('cy', start.y);
                startCircle.setAttribute('r', '5');
                startCircle.classList.add('annotation-measure-endpoint');

                const endCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                endCircle.setAttribute('cx', end.x);
                endCircle.setAttribute('cy', end.y);
                endCircle.setAttribute('r', '5');
                endCircle.classList.add('annotation-measure-endpoint');

                // Label (midpoint)
                const midX = (start.x + end.x) / 2;
                const midY = (start.y + end.y) / 2;
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', midX);
                text.setAttribute('y', midY - 10);
                text.classList.add('annotation-measure-label');
                text.textContent = measure.label;

                g.appendChild(line);
                g.appendChild(startCircle);
                g.appendChild(endCircle);
                g.appendChild(text);

                // Delete on right-click
                g.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (confirm(`Delete measurement ${measure.label}?`)) {
                        MeasurementTool.deleteMeasurement(measure.id);
                    }
                });

                els.annotationGroup.appendChild(g);
            });
        }
    };

    // ===== MEASUREMENT TOOL =====
    const MeasurementTool = {
        startMeasurement(imageX, imageY) {
            activeMeasurement = {
                startX: imageX,
                startY: imageY,
                endX: imageX,
                endY: imageY
            };
            MarkerTool.renderAnnotations();
        },

        updateMeasurement(imageX, imageY) {
            if (activeMeasurement) {
                activeMeasurement.endX = imageX;
                activeMeasurement.endY = imageY;
                MarkerTool.renderAnnotations();
            }
        },

        completeMeasurement(imageX, imageY) {
            if (!activeMeasurement) return;

            const key = `${currentSeries.id}-${currentImageIndex}`;

            if (!annotations[key]) {
                annotations[key] = {
                    seriesId: currentSeries.id,
                    imageIndex: currentImageIndex,
                    markers: [],
                    measurements: [],
                    pixelSpacing: MarkerTool.calculatePixelSpacing(),
                    createdAt: new Date().toISOString(),
                    modifiedAt: new Date().toISOString()
                };
            }

            const dx = imageX - activeMeasurement.startX;
            const dy = imageY - activeMeasurement.startY;
            const pixelDistance = Math.sqrt(dx * dx + dy * dy);
            const pixelSpacing = annotations[key].pixelSpacing;
            const mmDistance = pixelDistance * pixelSpacing;

            const measurement = {
                id: `measure-${Date.now()}`,
                startX: activeMeasurement.startX,
                startY: activeMeasurement.startY,
                endX: imageX,
                endY: imageY,
                pixelDistance: Math.round(pixelDistance * 10) / 10,
                mmDistance: Math.round(mmDistance * 10) / 10,
                label: `${Math.round(mmDistance * 10) / 10} mm`
            };

            annotations[key].measurements.push(measurement);
            annotations[key].modifiedAt = new Date().toISOString();

            activeMeasurement = null;
            MarkerTool.saveAnnotations(key);
            MarkerTool.renderAnnotations();
        },

        cancelMeasurement() {
            activeMeasurement = null;
            MarkerTool.renderAnnotations();
        },

        deleteMeasurement(measureId) {
            const key = `${currentSeries.id}-${currentImageIndex}`;
            const annot = annotations[key];

            if (annot) {
                annot.measurements = annot.measurements.filter(m => m.id !== measureId);
                annot.modifiedAt = new Date().toISOString();
                MarkerTool.saveAnnotations(key);
                MarkerTool.renderAnnotations();
            }
        }
    };

    // ===== CROSSHAIR TOOL =====
    const CrosshairTool = {
        placeCrosshair(imageX, imageY) {
            const key = `${currentSeries.id}-${currentImageIndex}`;

            if (!annotations[key]) {
                annotations[key] = {
                    seriesId: currentSeries.id,
                    imageIndex: currentImageIndex,
                    markers: [],
                    measurements: [],
                    crosshairs: [], // New array for crosshairs
                    pixelSpacing: MarkerTool.calculatePixelSpacing(),
                    createdAt: new Date().toISOString(),
                    modifiedAt: new Date().toISOString()
                };
            }

            // Ensure crosshairs array exists (for migration)
            if (!annotations[key].crosshairs) annotations[key].crosshairs = [];

            const crosshair = {
                id: `crosshair-${Date.now()}`,
                x: imageX,
                y: imageY
            };

            annotations[key].crosshairs.push(crosshair);
            annotations[key].modifiedAt = new Date().toISOString();

            MarkerTool.saveAnnotations(key);
            MarkerTool.renderAnnotations();
        },

        deleteCrosshair(id) {
            const key = `${currentSeries.id}-${currentImageIndex}`;
            const annot = annotations[key];

            if (annot && annot.crosshairs) {
                annot.crosshairs = annot.crosshairs.filter(c => c.id !== id);
                annot.modifiedAt = new Date().toISOString();
                MarkerTool.saveAnnotations(key);
                MarkerTool.renderAnnotations();
            }
        },

        renderCrosshairs(annot) {
            if (!annot || !annot.crosshairs) return;

            annot.crosshairs.forEach(ch => {
                const svg = AnnotationCoordinates.imageToSVG(ch.x, ch.y);

                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.classList.add('interactive');
                g.setAttribute('data-crosshair-id', ch.id);

                // Crosshair Layout:
                // Gap in center, green horizontal, blue vertical
                const size = 2000; // Large enough to look like axes, or localized? 
                // "Follow markers placing logic" probably means localized points but distinct visual.
                // However, standard crosshairs span the whole image.
                // But markers move with the image. 
                // Let's make them fairly large but not infinite, or localized 50px?
                // User said "crosshair placing logic... left click... right click... need to see what its marking... green and blue x and y axis"
                // This implies a target. I'll make them 60px radius (120px span) for visibility.
                // Crosshair Layout:
                // Gap in center, green horizontal, blue vertical
                // User requested "wider", effectively spanning the view like standard medical crosshairs
                const len = 10000; // Very large to span the image
                const gap = 5;

                // Horizontal (X-axis) - Green
                const pathH = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // Left segment + Right segment
                const dH = `M ${svg.x - len} ${svg.y} L ${svg.x - gap} ${svg.y} M ${svg.x + gap} ${svg.y} L ${svg.x + len} ${svg.y}`;
                pathH.setAttribute('d', dH);
                pathH.setAttribute('stroke', '#4ade80'); // Green
                pathH.setAttribute('stroke-width', '2');

                // Vertical (Y-axis) - Blue
                const pathV = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // Top segment + Bottom segment
                const dV = `M ${svg.x} ${svg.y - len} L ${svg.x} ${svg.y - gap} M ${svg.x} ${svg.y + gap} L ${svg.x} ${svg.y + len}`;
                pathV.setAttribute('d', dV);
                pathV.setAttribute('stroke', '#3b82f6'); // Blue
                pathV.setAttribute('stroke-width', '2');

                g.appendChild(pathH);
                g.appendChild(pathV);

                // Invisible hit target for easier right-clicking
                const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                hit.setAttribute('cx', svg.x);
                hit.setAttribute('cy', svg.y);
                hit.setAttribute('r', '15');
                hit.setAttribute('fill', 'transparent');
                g.appendChild(hit);

                // Delete on right-click
                g.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (confirm(`Delete crosshair?`)) {
                        this.deleteCrosshair(ch.id);
                    }
                });

                els.annotationGroup.appendChild(g);
            });
        }
    };

    // ===== FAVORITES =====
    // Load favorites from localStorage
    function loadFavorites() {
        try {
            const stored = localStorage.getItem('mri-favorites');
            if (stored) {
                const favorites = JSON.parse(stored);
                favoriteSeries = new Set(favorites);
            }
        } catch (e) {
            console.error('Failed to load favorites:', e);
        }
    }

    // Save favorites to localStorage
    function saveFavorites() {
        try {
            localStorage.setItem('mri-favorites', JSON.stringify([...favoriteSeries]));
        } catch (e) {
            console.error('Failed to save favorites:', e);
        }
    }

    // Toggle favorite status for a series
    function toggleFavorite(seriesId) {
        if (favoriteSeries.has(seriesId)) {
            favoriteSeries.delete(seriesId);
        } else {
            favoriteSeries.add(seriesId);
        }
        saveFavorites();

        // Update UI
        const item = document.querySelector(`.series-item[data-id="${seriesId}"]`);
        if (item) {
            const btn = item.querySelector('.favorite-btn');
            const isFavorite = favoriteSeries.has(seriesId);

            if (isFavorite) {
                btn.classList.add('active');
                item.classList.add('favorited');
            } else {
                btn.classList.remove('active');
                item.classList.remove('favorited');
            }
        }
    }



    // Project-Based Initialization
    let currentProject = null;

    /**
     * Initialize viewer with project data
     */
    window.initializeViewer = function (project) {
        currentProject = project;
        appData = { series: project.series || [] };

        if (appData.series.length === 0) {
            // No series in project yet
            showEmptyProject();
        } else {
            // Initialize viewer with data
            init();
        }
    };

    /**
     * Show empty project state (no imports yet)
     */
    function showEmptyProject() {
        const mainWorkspace = document.getElementById('main-workspace');
        if (mainWorkspace) {
            mainWorkspace.innerHTML = `
            <div class="empty-project-state">
                <h2>Project: ${currentProject.name}</h2>
                <p>No scans imported yet.</p>
                <button class="btn-primary btn-large" onclick="window.importUI.showImportDialog('${currentProject.projectId}')">
                    <span class="icon">📥</span>
                    Import Scans
                </button>
            </div>
        `;
        }
    }

    // Check URL for patient/study parameters (new patient-centered workflow)
    // Also supports legacy project parameter for backward compatibility
    const urlParams = new URLSearchParams(window.location.search);
    const patientId = urlParams.get('patient');
    const studyId = urlParams.get('study');
    const projectId = urlParams.get('project');

    // Initialize PatientUI
    window.patientUI = new PatientUI();

    // Back button handler - navigate to main screen
    const backBtn = document.querySelector('.nav-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            // Clear URL parameters and go to main screen
            window.location.href = window.location.pathname;
        };
    }

    if (patientId && studyId) {
        // Patient + study URL: load single study
        window.patientUI.loadStudy(patientId, studyId);
    } else if (patientId) {
        // Patient-only URL: load ALL studies (unified view)
        window.patientUI.loadPatient(patientId);
    } else if (projectId) {
        // Legacy project URL: load project directly
        window.projectUI.loadProject(projectId);
    } else {
        // Show patient-centered empty state
        window.patientUI.showEmptyState();
    }



    // Render sidebar with series list
    function renderSidebar() {
        if (!appData || !els.regionList) return;

        // Group by Body Part, then by Date
        const groups = {};
        appData.series.forEach(s => {
            // Normalize body part name
            let bodyPart = (s.body_part || "Other").toUpperCase();
            bodyPart = bodyPart.charAt(0).toUpperCase() + bodyPart.slice(1).toLowerCase();

            // Get date
            const date = s.date || "Unknown";

            // Create nested structure
            if (!groups[bodyPart]) groups[bodyPart] = {};
            if (!groups[bodyPart][date]) groups[bodyPart][date] = [];
            groups[bodyPart][date].push(s);
        });

        // Render hierarchical structure
        els.regionList.innerHTML = '';
        Object.keys(groups).sort().forEach(bodyPart => {
            const dateGroups = groups[bodyPart];
            const totalSeries = Object.values(dateGroups).flat().length;

            // Body Part container
            const bodyPartDiv = document.createElement('div');
            bodyPartDiv.className = 'region-group expanded';

            // Body Part title
            const bodyPartTitle = document.createElement('div');
            bodyPartTitle.className = 'region-title';
            bodyPartTitle.innerHTML = `<span>${bodyPart}</span> <span class="count-badge">${totalSeries}</span>`;
            bodyPartTitle.onclick = () => bodyPartDiv.classList.toggle('expanded');

            // Date groups container
            const dateGroupsContainer = document.createElement('div');
            dateGroupsContainer.className = 'date-groups-container';

            // Render each date group
            Object.keys(dateGroups).sort().reverse().forEach(date => {
                const seriesInDate = dateGroups[date];

                // Date subgroup
                const dateDiv = document.createElement('div');
                dateDiv.className = 'date-group expanded';

                // Date title
                const dateTitle = document.createElement('div');
                dateTitle.className = 'date-title';
                dateTitle.innerHTML = `<span class="date-label">${formatDate(date)}</span> <span class="count-badge-small">${seriesInDate.length}</span>`;
                dateTitle.onclick = (e) => {
                    e.stopPropagation();
                    dateDiv.classList.toggle('expanded');
                };

                // Series list for this date
                const seriesList = document.createElement('div');
                seriesList.className = 'series-items';

                seriesInDate.forEach(s => {
                    const item = document.createElement('div');
                    item.className = 'series-item';
                    const isFavorite = favoriteSeries.has(s.id);
                    item.innerHTML = `
                    <input type="checkbox" class="series-checkbox" data-series-id="${s.id}">
                    <button class="favorite-btn ${isFavorite ? 'active' : ''}" data-series-id="${s.id}" title="Favorite">★</button>
                    <span class="series-name" title="${s.description}">${s.description}</span>
                    <span class="count-badge">${s.images.length}</span>
                `;

                    // Click handler - different behavior in selection mode
                    item.onclick = (e) => {
                        // Ignore clicks on favorite button
                        if (e.target.classList.contains('favorite-btn')) {
                            return;
                        }
                        if (selectionMode && !e.target.classList.contains('series-checkbox')) {
                            // Toggle selection when clicking anywhere on the item
                            toggleSeriesSelection(s.id, item);
                        } else if (!selectionMode) {
                            loadSeries(s, item);
                        }
                    };

                    // Checkbox click handler
                    const checkbox = item.querySelector('.series-checkbox');
                    checkbox.onclick = (e) => {
                        e.stopPropagation();
                        toggleSeriesSelection(s.id, item);
                    };

                    // Favorite button click handler
                    const favoriteBtn = item.querySelector('.favorite-btn');
                    favoriteBtn.onclick = (e) => {
                        e.stopPropagation();
                        toggleFavorite(s.id);
                    };

                    item.dataset.id = s.id;
                    if (isFavorite) {
                        item.classList.add('favorited');
                    }
                    seriesList.appendChild(item);
                });

                // Assemble date group
                dateDiv.appendChild(dateTitle);
                dateDiv.appendChild(seriesList);
                dateGroupsContainer.appendChild(dateDiv);
            });

            // Assemble body part group
            bodyPartDiv.appendChild(bodyPartTitle);
            bodyPartDiv.appendChild(dateGroupsContainer);
            els.regionList.appendChild(bodyPartDiv);
        });
    }

    // Helper function to format date
    function formatDate(dateStr) {
        if (!dateStr || dateStr === "Unknown") return "Unknown Date";
        // Format YYYYMMDD to readable date
        if (dateStr.length === 8) {
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            return `${year}-${month}-${day}`;
        }
        return dateStr;
    }

    function init() {
        if (!appData || !appData.series || !appData.series.length) {
            console.error("No data available to init");
            return;
        }


        // Load favorites
        loadFavorites();

        // Header Info
        const meta = appData.series[0];
        if (els.headerName) els.headerName.textContent = meta.patient || "Patient Unknown";
        if (els.headerDate) els.headerDate.textContent = meta.date || "N/A";
        if (els.totalSeriesCount) els.totalSeriesCount.textContent = appData.series.length;

        // Render sidebar
        renderSidebar();

        // Render mini-list in Report tab


        // Load First
        const first = document.querySelector('.series-item');
        if (first) first.click();

        // Global Listeners (Scrubbers)
        if (els.scrubber) {
            els.scrubber.oninput = (e) => showImage(parseInt(e.target.value));
        }

        // Slice Step Buttons
        if (els.btnSlicePrev) {
            els.btnSlicePrev.onclick = () => {
                if (!currentSeries) return;
                const nextIndex = Math.max(0, currentImageIndex - 1);
                showImage(nextIndex);
            };
        }

        if (els.btnSliceNext) {
            els.btnSliceNext.onclick = () => {
                if (!currentSeries) return;
                const nextIndex = Math.min(currentSeries.images.length - 1, currentImageIndex + 1);
                showImage(nextIndex);
            };
        }

        const brightVal = document.querySelector('#scrubber-brightness + .adj-val');
        const contrastVal = document.querySelector('#scrubber-contrast + .adj-val');

        // Contrast inversion helper
        const updateContrastInvert = () => {
            if (!els.mainImage) return;

            const b = els.bright?.value || 100;
            const c = els.contrast?.value || 100;

            if (invertContrast) {
                els.mainImage.style.filter = `invert(1) brightness(${b}%) contrast(${c}%)`;
            } else {
                els.mainImage.style.filter = `brightness(${b}%) contrast(${c}%)`;
            }
        };

        const updateFilters = () => {
            const b = els.bright?.value || 100;
            const c = els.contrast?.value || 100;
            if (els.mainImage) {
                // Use updateContrastInvert to handle invert state
                updateContrastInvert();
            }
            if (brightVal) brightVal.textContent = b + '%';
            if (contrastVal) contrastVal.textContent = c + '%';
        };
        if (els.bright) els.bright.oninput = updateFilters;
        if (els.contrast) els.contrast.oninput = updateFilters;

        // Scroll Wheel (Slice Change)
        if (els.canvas) {
            els.canvas.onwheel = (e) => {
                e.preventDefault();
                const delta = Math.sign(e.deltaY);
                let next = currentImageIndex + delta;
                if (next >= 0 && next < (currentSeries?.images?.length || 0)) {
                    showImage(next);
                }
            };
        }

        /*************************************************
         * TOOLBAR LOGIC (Zoom, WL, Crosshair)
         *************************************************/

        const updateZoom = () => {
            if (els.mainImage) {
                els.mainImage.style.transform = `scale(${currentZoom}) translate(${panOffset.x}px, ${panOffset.y}px)`;
            }
            if (els.zoomLevelDisplay) {
                els.zoomLevelDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
            }
            MarkerTool.renderAnnotations();

        };

        const updateCrosshairPosition = () => {
            const cx = document.getElementById('crosshair-x');
            const cy = document.getElementById('crosshair-y');

            if (cx && cy && crosshairPosition) {
                cx.style.top = `${crosshairPosition.y}px`;
                cy.style.left = `${crosshairPosition.x}px`;
                cx.classList.remove('hidden');
                cy.classList.remove('hidden');
            }
        };

        const updateToolState = () => {
            // Visual feedback
            const tools = {
                // 'pan': els.btnZoomReset, // Removed
                'wl': els.btnWlReset,
                'crosshair': els.btnLayout,
                'marker': els.btnMarker,
                'measure': els.btnMeasure
            };

            Object.keys(tools).forEach(k => {
                if (tools[k]) tools[k].style.color = (currentTool === k) ? 'white' : '#9ca3af';
            });

            // Invert button state
            if (els.btnInvert) {
                els.btnInvert.style.color = invertContrast ? 'white' : '#9ca3af';
            }

            // Crosshair visibility - handled by renderAnnotations now
            // Old global crosshair logic removed
            const cx = document.getElementById('crosshair-x');
            const cy = document.getElementById('crosshair-y');
            if (cx) cx.classList.add('hidden');
            if (cy) cy.classList.add('hidden');

            // Set cursor based on tool
            const cursorMap = {
                'pan': 'grab',
                'wl': 'ns-resize',
                'marker': 'copy',
                'crosshair': 'crosshair',
                'measure': 'crosshair'
            };
            els.mainImage.style.cursor = cursorMap[currentTool] || 'default';
        };

        // Initialize state
        updateToolState();

        // --- Buttons ---
        if (els.btnZoomIn) els.btnZoomIn.onclick = () => { currentZoom += 0.2; updateZoom(); };
        if (els.btnZoomOut) els.btnZoomOut.onclick = () => { currentZoom = Math.max(0.2, currentZoom - 0.2); updateZoom(); };



        // Circle Icon -> Activate W/L Tool
        // Reset Settings Button -> Reset all view settings
        if (els.btnWlReset) els.btnWlReset.onclick = () => {
            // Reset Zoom & Pan
            currentZoom = 1;
            panOffset = { x: 0, y: 0 };
            updateZoom();

            // Reset W/L
            if (els.bright) els.bright.value = 100;
            if (els.contrast) els.contrast.value = 100;
            updateFilters();

            // Reset Invert
            if (invertContrast) {
                invertContrast = false;
                updateContrastInvert();
            }

            // Reset Tool to default (Pan) if needed, or keep current. 
            // Usually reset implies bringing view to default state (Pan).
            if (currentTool !== 'pan') {
                currentTool = 'pan';
                updateToolState();
            }
        };

        // Square Icon (Layout) -> Crosshair Tool
        if (els.btnLayout) els.btnLayout.onclick = () => {
            if (currentTool !== 'crosshair') {
                currentTool = 'crosshair';
                crosshairPosition = null; // Reset position when activating
                updateToolState();
            } else {
                // Toggle off -> back to Pan
                currentTool = 'pan';
                crosshairPosition = null; // Clear crosshair
                updateToolState();
            }
        };

        // Marker Tool Button
        if (els.btnMarker) els.btnMarker.onclick = () => {
            if (currentTool !== 'marker') {
                currentTool = 'marker';
                updateToolState();
            } else {
                currentTool = 'pan';
                updateToolState();
            }
        };

        // Measure Tool Button
        if (els.btnMeasure) els.btnMeasure.onclick = () => {
            if (currentTool !== 'measure') {
                currentTool = 'measure';
                MeasurementTool.cancelMeasurement();
                updateToolState();
            } else {
                currentTool = 'pan';
                MeasurementTool.cancelMeasurement();
                updateToolState();
            }
        };

        // Window/Level Tool Button (Sun Icon)
        if (els.btnWlTool) els.btnWlTool.onclick = () => {
            if (currentTool !== 'wl') {
                currentTool = 'wl';
            } else {
                currentTool = 'pan';
            }
            updateToolState();
        };

        // Invert Contrast Button (Split Circle) - Restored to Flip Contrast
        if (els.btnInvert) els.btnInvert.onclick = () => {
            invertContrast = !invertContrast;
            updateContrastInvert();
            // Do not change tool state, just toggle filter
            updateToolState();
        };

        // --- Main Canvas Interactions ---
        if (els.mainImage) {
            els.mainImage.onmousedown = (e) => {
                e.preventDefault();
                startDrag = { x: e.clientX, y: e.clientY };

                // Handle crosshair tool - place persistent crosshair
                if (currentTool === 'crosshair') {
                    const coords = AnnotationCoordinates.viewportToImage(e.clientX, e.clientY);
                    if (coords.valid) {
                        CrosshairTool.placeCrosshair(coords.x, coords.y);
                    }
                    return;
                }

                // Handle marker tool
                if (currentTool === 'marker') {
                    const coords = AnnotationCoordinates.viewportToImage(e.clientX, e.clientY);
                    if (coords.valid) {
                        MarkerTool.placeMarker(coords.x, coords.y);
                    }
                    return;
                }

                // Handle measure tool
                if (currentTool === 'measure') {
                    const coords = AnnotationCoordinates.viewportToImage(e.clientX, e.clientY);
                    if (coords.valid) {
                        if (!activeMeasurement) {
                            MeasurementTool.startMeasurement(coords.x, coords.y);
                        } else {
                            MeasurementTool.completeMeasurement(coords.x, coords.y);
                        }
                    }
                    return;
                }

                if (currentTool === 'pan' && currentZoom > 1) {
                    isPanning = true;
                    els.mainImage.style.cursor = 'grabbing';
                } else if (currentTool === 'wl') {
                    isAdjustingWL = true;
                    startWL = {
                        b: parseInt(els.bright?.value || 100),
                        c: parseInt(els.contrast?.value || 100)
                    };
                }
            };

            document.onmousemove = (e) => {
                // Update active measurement
                if (currentTool === 'measure' && activeMeasurement) {
                    const coords = AnnotationCoordinates.viewportToImage(e.clientX, e.clientY);
                    if (coords.valid) {
                        MeasurementTool.updateMeasurement(coords.x, coords.y);
                    }
                }

                // Crosshair tool - no tracking, only show when placed
                // (crosshairs only appear after clicking, not following mouse)

                if (isPanning) {
                    const dx = e.clientX - startDrag.x;
                    const dy = e.clientY - startDrag.y;
                    panOffset.x += dx / currentZoom;
                    panOffset.y += dy / currentZoom;
                    startDrag = { x: e.clientX, y: e.clientY };
                    updateZoom();
                    // Re-render annotations to update their positions
                    MarkerTool.renderAnnotations();
                } else if (isAdjustingWL) {
                    const dx = e.clientX - startDrag.x;
                    const dy = e.clientY - startDrag.y;
                    // Drag Up/Down = Brightness, Left/Right = Contrast
                    const sensitivity = 0.5;
                    let newB = startWL.b - (dy * sensitivity);
                    let newC = startWL.c + (dx * sensitivity);

                    if (els.bright) els.bright.value = Math.max(0, Math.min(200, newB));
                    if (els.contrast) els.contrast.value = Math.max(0, Math.min(200, newC));
                    updateFilters();
                }
            };

            document.onmouseup = () => {
                if (isPanning) els.mainImage.style.cursor = 'grab';
                isPanning = false;
                isAdjustingWL = false;
            };
            // Prevent getting stuck in drag mode if mouse leaves window
            document.onmouseup = () => {
                if (isPanning) els.mainImage.style.cursor = 'grab';
                isPanning = false;
                isAdjustingWL = false;
            };
        }

        // --- Keyboard Shortcuts ---
        document.addEventListener('keydown', (e) => {
            // Escape - cancel active measurement or deselect tool
            if (e.key === 'Escape') {
                if (activeMeasurement) {
                    MeasurementTool.cancelMeasurement();
                } else if (currentTool !== 'pan') {
                    currentTool = 'pan';
                    updateToolState();
                }
            }

            // M - Marker tool
            if (e.key === 'm' || e.key === 'M') {
                if (!e.ctrlKey && !e.metaKey) {
                    els.btnMarker?.click();
                }
            }

            // R - Ruler/Measure tool
            if (e.key === 'r' || e.key === 'R') {
                if (!e.ctrlKey && !e.metaKey) {
                    els.btnMeasure?.click();
                }
            }

            // I - Invert contrast
            if (e.key === 'i' || e.key === 'I') {
                if (!e.ctrlKey && !e.metaKey) {
                    els.btnInvert?.click();
                }
            }

            // P - Pan tool
            if (e.key === 'p' || e.key === 'P') {
                if (!e.ctrlKey && !e.metaKey) {
                    currentTool = 'pan';
                    updateToolState();
                }
            }
        });

        // --- Selection Mode Toggle ---
        if (els.btnToggleSelect) {
            els.btnToggleSelect.onclick = () => {
                selectionMode = !selectionMode;
                els.btnToggleSelect.classList.toggle('active', selectionMode);
                els.sidebar?.classList.toggle('selection-mode', selectionMode);

                if (!selectionMode) {
                    // Exit selection mode - clear selections
                    clearAllSelections();
                }
                updateExportBar();
            };
        }

        // Export button handler
        if (els.btnExport) {
            els.btnExport.onclick = () => {
                if (selectedSeriesIds.size === 0) return;

                // Get selected series data
                const selectedSeries = appData.series.filter(s => selectedSeriesIds.has(s.id));

                // Trigger export (defined in export.js)
                if (typeof exportSelectedSeries === 'function') {
                    exportSelectedSeries(selectedSeries, appData.series[0]);
                } else {
                    console.error('Export function not available');
                }
            };
        }
    }

    // --- Selection Functions ---
    function toggleSeriesSelection(seriesId, itemElement) {
        if (selectedSeriesIds.has(seriesId)) {
            selectedSeriesIds.delete(seriesId);
            itemElement.classList.remove('selected');
            const checkbox = itemElement.querySelector('.series-checkbox');
            if (checkbox) checkbox.checked = false;
        } else {
            selectedSeriesIds.add(seriesId);
            itemElement.classList.add('selected');
            const checkbox = itemElement.querySelector('.series-checkbox');
            if (checkbox) checkbox.checked = true;
        }
        updateExportBar();
    }

    function clearAllSelections() {
        selectedSeriesIds.clear();
        document.querySelectorAll('.series-item').forEach(item => {
            item.classList.remove('selected');
            const checkbox = item.querySelector('.series-checkbox');
            if (checkbox) checkbox.checked = false;
        });
        updateExportBar();
    }

    function updateExportBar() {
        const count = selectedSeriesIds.size;
        const exportBar = document.getElementById('export-bar');
        const selectedCount = document.getElementById('selected-count');
        const btnExport = document.getElementById('btn-export');

        if (exportBar) {
            exportBar.classList.toggle('hidden', count === 0);
        }
        if (selectedCount) {
            selectedCount.textContent = `${count} selected`;
        }
        if (btnExport) {
            btnExport.disabled = count === 0;
        }
    }

    // Expose for export.js
    window.MRIViewerApp = {
        getAppData: () => appData,
        getSelectedSeriesIds: () => selectedSeriesIds
    };

    function loadSeries(series, domElement) {
        currentSeries = series;
        currentImageIndex = 0;

        document.querySelectorAll('.series-item').forEach(el => el.classList.remove('active'));
        if (domElement) domElement.classList.add('active');

        if (els.seriesDesc) els.seriesDesc.textContent = series.description;
        if (els.seriesTech) {
            const parts = [series.modality || "MR"];
            if (series.orientation) parts.push(series.orientation);
            parts.push(`${series.images.length} images`);
            els.seriesTech.textContent = parts.join(' • ');
        }

        if (els.scrubber) {
            els.scrubber.max = series.images.length - 1;
            els.scrubber.value = 0;
        }

        if (els.sliceTotal) els.sliceTotal.textContent = series.images.length;

        if (els.seriesSubtitle) {
            els.seriesSubtitle.textContent = `MR • ${series.orientation} • ${series.images.length} images`;
        }

        // Format Date: YYYYMMDD -> YYYY-MM-DD
        if (els.seriesDate && series.date) {
            const d = series.date;
            els.seriesDate.textContent = d.length === 8 ? `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}` : d;
        } else if (els.seriesDate) {
            els.seriesDate.textContent = '';
        }

        updateInfoTab(series);
        showImage(0);
    }

    function showImage(index) {
        if (!currentSeries || !currentSeries.images) return;

        // Bounds check
        if (index < 0) index = 0;
        if (index >= currentSeries.images.length) index = currentSeries.images.length - 1;

        currentImageIndex = index;

        // Update Scrubber
        if (els.scrubber) els.scrubber.value = index;
        if (els.sliceIdx) els.sliceIdx.innerText = index + 1;

        // Update Image
        let imgPath;
        if (currentSeries.imagePath) {
            // Project-based path - use projectId from currentProject or from series itself
            const projectId = currentProject?.projectId || currentSeries.projectId;
            if (projectId) {
                imgPath = `/projects/${projectId}/${currentSeries.imagePath}/${currentSeries.images[index]}`;
            } else {
                // Fallback if no projectId available
                imgPath = `img/${currentSeries.id}/${currentSeries.images[index]}`;
            }
        } else {
            // Legacy path (fallback)
            imgPath = `img/${currentSeries.id}/${currentSeries.images[index]}`;
        }
        if (els.mainImage) {
            els.mainImage.src = imgPath;
            els.mainImage.onload = () => {
                MarkerTool.renderAnnotations();

                if (typeof updateContrastInvert === 'function') updateContrastInvert();
            };
            els.mainImage.onerror = () => {
                console.error(`Failed to load image: ${imgPath}`);
                els.mainImage.alt = `Image load failed: ${imgPath}`;
            };
        }
    }

    function updateInfoTab(s) {
        if (els.infoDesc) els.infoDesc.textContent = s.description || "-";

        // Clinic/Machine from DICOM metadata
        if (els.infoClinic) els.infoClinic.textContent = s.institution || "-";
        if (els.infoMachine) {
            // Combine manufacturer + model if available, fallback to station name
            const machine = s.station || (s.manufacturer && s.model ? `${s.manufacturer} ${s.model}` : s.manufacturer || s.model || "-");
            els.infoMachine.textContent = machine;
        }

        if (els.infoProtocol) els.infoProtocol.textContent = s.protocol || "-";
        if (els.infoModality) els.infoModality.textContent = s.modality || "MR";
        if (els.infoImages) els.infoImages.textContent = s.images.length;
        if (els.infoThickness) els.infoThickness.textContent = s.slice_thickness ? `${s.slice_thickness}mm` : "-";
        if (els.infoTr) els.infoTr.textContent = s.tr || "-";
        if (els.infoTe) els.infoTe.textContent = s.te || "-";

        // Sequence Detection
        const desc = (s.description || "").toUpperCase();
        const protocol = (s.protocol || "").toUpperCase();

        let type = "Standard";
        let icon = "⚙️";
        let summary = "Standard MRI sequence for anatomical visualization.";

        if (desc.includes("SWI") || protocol.includes("SWI")) {
            type = "SWI"; icon = "🩸";
            summary = "Susceptibility-weighted imaging is sensitive to blood products, calcification, and iron. Used for detecting microbleeds.";
        } else if (desc.includes("T1")) {
            type = "T1-Weighted"; icon = "🧠";
            summary = "T1 sequences provide excellent anatomical detail where fat is bright and water (CSF) is dark.";
        } else if (desc.includes("T2")) {
            type = "T2-Weighted"; icon = "💧";
            summary = "T2 sequences are sensitive to pathology and inflammation, where water and CSF appear bright.";
        } else if (desc.includes("DWI") || desc.includes("ADC")) {
            type = "Diffusion"; icon = "✨";
            summary = "DWI measures water molecule movement and is critical for detecting acute stroke or high cellularity.";
        } else if (desc.includes("FLAIR")) {
            type = "FLAIR"; icon = "🌫️";
            summary = "Fluid-attenuated inversion recovery suppresses CSF signal to better visualize periventricular lesions.";
        }

        if (els.seqName) els.seqName.textContent = type;
        if (els.seqIcon) els.seqIcon.textContent = icon;
        if (els.seqDesc) els.seqDesc.textContent = summary;
    }

    // ===== AI ANALYSIS =====
    const AIAnalysis = {
        init() {
            if (!els.btnAiAnalyze) return;

            els.btnAiAnalyze.onclick = () => {
                if (!currentSeries) {
                    alert('Please select an MRI series first.');
                    return;
                }
                els.aiSettingsModal.classList.remove('hidden');
            };

            els.btnRunAi.onclick = () => this.runAnalysis();
            els.btnCopyAi.onclick = () => this.copyResults();

            // Mode selector buttons
            this.analysisMode = 'current'; // 'current' or 'series'
            const modeButtons = document.querySelectorAll('.analysis-mode-btn');
            const samplingGroup = document.getElementById('sampling-group');

            modeButtons.forEach(btn => {
                btn.onclick = () => {
                    modeButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.analysisMode = btn.dataset.mode;
                    // Show/hide sampling for series mode only
                    if (samplingGroup) {
                        samplingGroup.style.display = this.analysisMode === 'series' ? 'block' : 'none';
                    }
                };
            });

            // Initially hide sampling (current slice mode is default)
            if (samplingGroup) samplingGroup.style.display = 'none';

            // Close modals
            document.querySelectorAll('.close-modal').forEach(btn => {
                btn.onclick = () => {
                    const modal = btn.closest('.modal-overlay');
                    if (modal) modal.classList.add('hidden');
                };
            });
        },

        async runAnalysis() {
            const sample = document.getElementById('ai-sample').value;
            // user prompt removed in favor of specialist protocols
            const prompt = "";

            // Ensure we have IDs
            const projectId = currentSeries.projectId || (currentProject ? currentProject.projectId : null);
            const seriesId = currentSeries.id;

            if (!projectId || !seriesId) {
                console.error('Missing IDs:', { projectId, seriesId, currentSeries, currentProject });
                alert('Internal error: Missing project or series ID. Please try re-selecting the series.');
                return;
            }

            els.aiSettingsModal.classList.add('hidden');
            els.aiResultsModal.classList.remove('hidden');
            els.aiLoading.classList.remove('hidden');
            els.aiContent.innerHTML = '';

            const statusText = document.getElementById('ai-status-text');
            if (statusText) statusText.textContent = 'Connecting to LM Studio server...';

            // Determine which slice(s) to analyze
            const analyzeMode = this.analysisMode || 'current';
            const currentSliceIndex = currentImageIndex || 0;

            // Collect selected specialists
            const selectedSpecialists = Array.from(document.querySelectorAll('input[name="ai-specialist"]:checked'))
                .map(cb => cb.value);

            if (selectedSpecialists.length === 0) {
                alert('Please select at least one specialist.');
                return;
            }

            // Use fetch with streaming for SSE
            try {
                const response = await fetch('http://127.0.0.1:8000/api/analyze/ai/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: projectId,
                        seriesId: seriesId,
                        sample: analyzeMode === 'current' ? 1 : parseInt(sample),
                        prompt,
                        mode: analyzeMode,
                        sliceIndex: currentSliceIndex,
                        specialists: selectedSpecialists
                    })
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error || 'Server error');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop(); // Keep incomplete chunk

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const event = JSON.parse(line.slice(6));
                                this.handleStreamEvent(event, statusText);
                            } catch (e) {
                                console.warn('Failed to parse SSE event:', line);
                            }
                        }
                    }
                }

                // Hide loading when done
                els.aiLoading.classList.add('hidden');

            } catch (err) {
                els.aiLoading.classList.add('hidden');
                els.aiContent.innerHTML = `<div class="error-text">Error: ${err.message}</div>`;
            }
        },

        handleStreamEvent(event, statusText) {
            switch (event.type) {
                case 'status':
                    if (statusText) statusText.textContent = event.message;
                    break;
                case 'progress':
                    if (statusText) statusText.textContent = event.status || `Analyzing slice ${event.current} of ${event.total}...`;
                    break;
                case 'slice_start':
                    els.aiLoading.classList.add('hidden');
                    this.createPendingSliceCard(event);
                    break;
                case 'specialist_result':
                    // In non-streaming mode, this is the main event we get
                    this.appendSpecialistResult(event);
                    break;
                case 'specialist_delta':
                    // Kept for compatibility but likely unused now
                    this.handleSpecialistDelta(event);
                    break;
                case 'slice_complete':
                    this.finalizeSliceCard(event);
                    break;
                case 'error':
                    els.aiLoading.classList.add('hidden');
                    els.aiContent.innerHTML += `<div class="error-text">Error: ${event.message}</div>`;
                    break;
                case 'complete':
                    if (statusText) statusText.textContent = `Analysis complete! (${event.total} slices)`;
                    break;
                case 'slice': // Legacy/Backup
                    els.aiLoading.classList.add('hidden');
                    this.appendSliceCard(event);
                    break;
            }
        },

        createPendingSliceCard(slice) {
            const card = document.createElement('div');
            card.className = 'ai-slice-card pending';
            card.id = `ai-card-${slice.index}`;
            card.dataset.analysis = '';
            card.dataset.thumbnail = slice.thumbnail || '';

            const thumbnail = slice.thumbnail
                ? `<img src="data:image/jpeg;base64,${slice.thumbnail}" class="ai-slice-thumb" alt="${slice.filename}">`
                : '<div class="ai-slice-thumb-placeholder">No image</div>';

            card.innerHTML = `
                ${thumbnail}
                <div class="ai-slice-content">
                    <div class="ai-slice-header">Slice ${slice.index}/${slice.total}: ${slice.filename}</div>
                    <div class="ai-slice-results-container"></div>
                    <div class="ai-slice-spinner">
                        <span class="spinner-small"></span> <span class="ai-specialist-status">Waiting for specialists...</span>
                    </div>
                </div>
            `;

            const thumb = card.querySelector('.ai-slice-thumb');
            if (thumb) {
                thumb.onclick = () => this.openLightbox(slice.thumbnail, card.dataset.analysis, slice.filename, slice.series_index);
            }

            els.aiContent.appendChild(card);
            els.aiContent.scrollTop = els.aiContent.scrollHeight;
        },

        handleSpecialistDelta(event) {
            const card = document.getElementById(`ai-card-${event.index}`);
            if (!card) return;

            const container = card.querySelector('.ai-slice-results-container');
            const statusSpan = card.querySelector('.ai-specialist-status');

            // Find or create specialist section
            const sectionId = `specialist-${event.index}-${event.role.replace(/\s+/g, '-')}`;
            let section = document.getElementById(sectionId);

            if (!section) {
                section = document.createElement('div');
                section.id = sectionId;
                section.className = 'ai-specialist-section fade-in';
                section.innerHTML = `
                    <div class="specialist-header">
                        <span class="specialist-icon">👨‍⚕️</span> 
                        <strong>${event.role}</strong> 
                        <span class="specialist-focus">(${event.focus})</span>
                    </div>
                    <div class="ai-slice-text"></div>
                `;
                container.appendChild(section);
                els.aiContent.scrollTop = els.aiContent.scrollHeight;
            }

            const textDiv = section.querySelector('.ai-slice-text');
            if (textDiv && event.delta) {
                // Accumulate delta
                const currentText = (textDiv.dataset.rawText || "") + event.delta;
                textDiv.dataset.rawText = currentText;
                textDiv.innerHTML = this.formatMarkdown(currentText);

                // Auto-scroll
                const isAtBottom = els.aiContent.scrollHeight - els.aiContent.scrollTop <= els.aiContent.clientHeight + 100;
                if (isAtBottom) {
                    els.aiContent.scrollTop = els.aiContent.scrollHeight;
                }
            }

            // Update status
            if (statusSpan) statusSpan.textContent = `Receiving ${event.role} findings...`;
        },

        appendSpecialistResult(event) {
            const card = document.getElementById(`ai-card-${event.index}`);
            if (!card) return;

            const container = card.querySelector('.ai-slice-results-container');
            const statusSpan = card.querySelector('.ai-specialist-status');

            const sectionId = `specialist-${event.index}-${event.role.replace(/\s+/g, '-')}`;
            let section = document.getElementById(sectionId);

            if (!section) {
                // If we didn't get deltas (fallback), create full section
                section = document.createElement('div');
                section.id = sectionId;
                section.className = 'ai-specialist-section fade-in';
                container.appendChild(section);
            }

            section.innerHTML = `
                <div class="specialist-header">
                    <span class="specialist-icon">👨‍⚕️</span> 
                    <strong>${event.role}</strong> 
                    <span class="specialist-focus">(${event.focus})</span>
                </div>
                <div class="ai-slice-text">${this.formatMarkdown(event.analysis)}</div>
            `;

            // Update accumulated analysis for lightbox/copy
            let currentAnalysis = card.dataset.analysis || "";
            card.dataset.analysis = currentAnalysis + `\n\n#### ${event.focus} Findings\n${event.analysis}`;

            // Update status
            if (statusSpan) statusSpan.textContent = "Processing next specialist...";
        },

        finalizeSliceCard(event) {
            const card = document.getElementById(`ai-card-${event.index}`);
            if (!card) return;

            // Remove spinner
            const spinner = card.querySelector('.ai-slice-spinner');
            if (spinner) spinner.remove();

            card.classList.remove('pending');
            // Ensure dataset has full report
            card.dataset.analysis = event.full_report;
        },

        appendSliceCard(slice) {
            // Legacy/Fallback method
            const card = document.createElement('div');
            card.className = 'ai-slice-card';
            card.dataset.analysis = slice.analysis || '';
            card.dataset.thumbnail = slice.thumbnail || '';

            const thumbnail = slice.thumbnail
                ? `<img src="data:image/jpeg;base64,${slice.thumbnail}" class="ai-slice-thumb" alt="${slice.filename}">`
                : '<div class="ai-slice-thumb-placeholder">No image</div>';

            card.innerHTML = `
                ${thumbnail}
                <div class="ai-slice-content">
                    <div class="ai-slice-header">Slice ${slice.index}/${slice.total}: ${slice.filename}</div>
                    <div class="ai-slice-text">${this.formatMarkdown(slice.analysis)}</div>
                </div>
            `;

            const thumb = card.querySelector('.ai-slice-thumb');
            if (thumb) {
                thumb.onclick = () => this.openLightbox(slice.thumbnail, slice.analysis, slice.filename, slice.series_index);
            }

            els.aiContent.appendChild(card);
            els.aiContent.scrollTop = els.aiContent.scrollHeight;
        },

        openLightbox(imageB64, analysisText, filename, sliceIndex) {
            const lightbox = document.getElementById('ai-lightbox');
            const lightboxImg = document.getElementById('lightbox-image');
            const markersSvg = document.getElementById('lightbox-markers');
            const caption = document.getElementById('lightbox-caption');

            if (!lightbox || !lightboxImg) return;

            if (typeof sliceIndex === 'number' && currentSeries && currentSeries.images && currentSeries.images[sliceIndex]) {
                // Construct full resolution path
                let imgPath;
                if (currentSeries.imagePath) {
                    const projectId = currentSeries.projectId || (currentProject ? currentProject.projectId : null);
                    if (projectId) {
                        imgPath = `/projects/${projectId}/${currentSeries.imagePath}/${currentSeries.images[sliceIndex]}`;
                    } else {
                        imgPath = `img/${currentSeries.id}/${currentSeries.images[sliceIndex]}`;
                    }
                } else {
                    imgPath = `img/${currentSeries.id}/${currentSeries.images[sliceIndex]}`;
                }
                lightboxImg.src = imgPath;
            } else {
                // Fallback to thumbnail
                lightboxImg.src = `data:image/jpeg;base64,${imageB64}`;
            }
            caption.textContent = filename;
            markersSvg.innerHTML = '';

            // Parse coordinates like [25%, 40%] from analysis text
            const coordPattern = /\[(\d+)%?,?\s*(\d+)%?\]/g;
            let match;
            const markers = [];

            while ((match = coordPattern.exec(analysisText)) !== null) {
                const x = parseInt(match[1]);
                const y = parseInt(match[2]);
                if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
                    markers.push({ x, y });
                }
            }

            // Wait for image to load, then draw markers
            lightboxImg.onload = () => {
                const w = lightboxImg.clientWidth;
                const h = lightboxImg.clientHeight;
                markersSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
                markersSvg.style.width = w + 'px';
                markersSvg.style.height = h + 'px';

                markers.forEach((m, i) => {
                    const cx = (m.x / 100) * w;
                    const cy = (m.y / 100) * h;

                    // Draw circle marker
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', cx);
                    circle.setAttribute('cy', cy);
                    circle.setAttribute('r', 15);
                    circle.setAttribute('class', 'lightbox-marker');
                    markersSvg.appendChild(circle);

                    // Draw crosshairs
                    const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    hLine.setAttribute('x1', cx - 25);
                    hLine.setAttribute('y1', cy);
                    hLine.setAttribute('x2', cx + 25);
                    hLine.setAttribute('y2', cy);
                    hLine.setAttribute('class', 'lightbox-marker');
                    markersSvg.appendChild(hLine);

                    const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    vLine.setAttribute('x1', cx);
                    vLine.setAttribute('y1', cy - 25);
                    vLine.setAttribute('x2', cx);
                    vLine.setAttribute('y2', cy + 25);
                    vLine.setAttribute('class', 'lightbox-marker');
                    markersSvg.appendChild(vLine);
                });
            };

            lightbox.classList.remove('hidden');
        },

        formatMarkdown(text) {
            if (!text) return '<em>No analysis available</em>';
            return text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br>');
        },

        renderResults(markdown) {
            // Legacy method for non-streaming results
            let html = markdown
                .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                .replace(/^\* (.*$)/gim, '<li>$1</li>')
                .replace(/^\- (.*$)/gim, '<li>$1</li>')
                .replace(/\n\n/g, '<br><br>')
                .replace(/\*\*(.*)?\*\*/gim, '<b>$1</b>');

            if (html.includes('<li>')) {
                html = html.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');
            }

            els.aiContent.innerHTML = html;
        },

        copyResults() {
            const text = els.aiContent.innerText;
            navigator.clipboard.writeText(text).then(() => {
                const btn = els.btnCopyAi;
                const oldText = btn.innerText;
                btn.innerText = 'Copied!';
                setTimeout(() => btn.innerText = oldText, 2000);
            });
        }
    };

    AIAnalysis.init();
});
