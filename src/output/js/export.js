/**
 * MRI Viewer Export Module
 * Creates a self-contained ZIP package with selected series for sharing
 */

// Progress overlay management
function showExportProgress() {
    let overlay = document.getElementById('export-progress-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'export-progress-overlay';
        overlay.className = 'export-progress';
        overlay.innerHTML = `
            <div class="export-progress-content">
                <h3>📦 Creating Export Package...</h3>
                <div class="export-progress-bar">
                    <div id="export-progress-fill" class="export-progress-fill"></div>
                </div>
                <div id="export-progress-text" class="export-progress-text">Preparing...</div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    overlay.classList.remove('hidden');
}

function updateExportProgress(percent, text) {
    const fill = document.getElementById('export-progress-fill');
    const textEl = document.getElementById('export-progress-text');
    if (fill) fill.style.width = `${percent}%`;
    if (textEl) textEl.textContent = text;
}

function hideExportProgress() {
    const overlay = document.getElementById('export-progress-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// Generate the standalone HTML for export (uses Arial for offline compatibility)
function generateExportHTML(patientInfo) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MRI Viewer - ${patientInfo.patient || 'Patient'}</title>
    <link rel="stylesheet" href="css/style.css">
    <style>
        /* Override font for offline compatibility */
        body { font-family: Arial, Helvetica, sans-serif; }
    </style>
</head>
<body>
    <div class="app-layout">
        <!-- Top Bar -->
        <header class="top-bar">
            <div class="left-nav">
                <div class="app-badge">MR</div>
                <h1 class="app-title">MRI Viewer</h1>
            </div>
            <div class="patient-card">
                <div class="patient-line">
                    <span class="label">PATIENT</span>
                    <span class="value" id="header-patient-name">Loading...</span>
                </div>
                <div class="patient-line">
                    <span class="label">STUDY DATE</span>
                    <span class="value" id="header-date">...</span>
                </div>
            </div>
        </header>

        <div class="main-workspace">
            <!-- Left Sidebar: Body Regions -->
            <aside class="sidebar-left">
                <div class="sidebar-header">
                    <span>SERIES</span>
                </div>
                <div id="region-list" class="region-list">
                    <!-- Populated by JS -->
                </div>
            </aside>

            <!-- Center: Viewport -->
            <main class="viewport">
                <div class="viewport-header">
                    <div class="viewport-tools-container">
                        <div class="tool-group">
                            <button id="btn-zoom-out" class="tool-icon" title="Zoom Out">⊖</button>
                            <button id="btn-zoom-reset" class="tool-icon" title="Reset Zoom">🔍</button>
                            <button id="btn-zoom-in" class="tool-icon" title="Zoom In">⊕</button>
                        </div>
                        <div class="tool-separator"></div>
                        <div class="tool-group">
                            <button id="btn-wl-reset" class="tool-icon" title="Window/Level">○</button>
                        </div>
                    </div>
                    <div class="series-overlay-info">
                        <div class="series-title" id="vpc-series-desc">...</div>
                        <div class="series-subtitle" id="vpc-series-tech">...</div>
                    </div>
                </div>

                <!-- Main Image Canvas -->
                <div class="image-canvas" id="image-canvas">
                    <img id="main-image" src="" draggable="false">
                    <div class="hud-marker top-left">R</div>
                    <div class="hud-marker top-right">L</div>
                    <div class="hud-marker bottom-left">P</div>
                    <div class="hud-marker bottom-right">A</div>
                </div>

                <!-- Bottom Controls -->
                <div class="bottom-controls">
                    <div class="slice-row">
                        <div class="slice-label">Slice: <span id="vpc-slice-idx">0</span> / <span id="vpc-slice-total">0</span></div>
                        <input type="range" id="scrubber-slice" min="0" value="0" step="1" class="slice-scrubber">
                    </div>
                    <div class="divider-line"></div>
                    <div class="adjustment-row">
                        <div class="adj-group">
                            <label>BRIGHTNESS</label>
                            <input type="range" id="scrubber-brightness" min="50" max="150" value="100">
                            <span class="adj-val">100%</span>
                        </div>
                        <div class="adj-group">
                            <label>CONTRAST</label>
                            <input type="range" id="scrubber-contrast" min="50" max="150" value="100">
                            <span class="adj-val">100%</span>
                        </div>
                    </div>
                </div>
            </main>

            <!-- Right Sidebar: Info -->
            <aside class="sidebar-right">
                <div class="tabs">
                    <button class="tab-btn active" data-tab="info">Series Info</button>
                </div>
                <div class="tab-content active" id="tab-info">
                    <div class="info-viewport">
                        <section class="info-section">
                            <h3 class="section-label">SERIES INFORMATION</h3>
                            <div class="info-row">
                                <span class="info-key">Description</span>
                                <span class="info-val bold" id="info-desc">-</span>
                            </div>
                            <div class="info-row">
                                <span class="info-key">Protocol</span>
                                <span class="info-val" id="info-protocol">-</span>
                            </div>
                            <div class="info-row">
                                <span class="info-key">Modality</span>
                                <span class="info-val right" id="info-modality">-</span>
                            </div>
                            <div class="info-row">
                                <span class="info-key">Images</span>
                                <span class="info-val right" id="info-images">-</span>
                            </div>
                        </section>

                        <section class="info-section">
                            <h3 class="section-label">SCAN PARAMETERS</h3>
                            <div class="info-row">
                                <span class="info-key">Slice Thickness</span>
                                <span class="info-val right" id="info-thickness">-</span>
                            </div>
                            <div class="info-row">
                                <span class="info-key">TR (ms)</span>
                                <span class="info-val right" id="info-tr">-</span>
                            </div>
                            <div class="info-row">
                                <span class="info-key">TE (ms)</span>
                                <span class="info-val right" id="info-te">-</span>
                            </div>
                        </section>

                        <section class="info-section">
                            <h3 class="section-label">SEQUENCE TYPE</h3>
                            <div class="sequence-card" id="seq-card">
                                <div class="seq-icon" id="seq-icon">⚙️</div>
                                <div class="seq-name" id="seq-name">Standard</div>
                            </div>
                            <p class="sequence-desc" id="seq-desc">Standard MRI sequence.</p>
                        </section>
                    </div>
                </div>
            </aside>
        </div>
    </div>
    <script src="js/data.js"></script>
    <script src="js/viewer.js"></script>
</body>
</html>`;
}

// Generate simplified viewer JS for export
function generateViewerJS() {
    return `document.addEventListener('DOMContentLoaded', () => {
    let appData = null;
    let currentSeries = null;
    let currentImageIndex = 0;
    let currentZoom = 1;
    let currentTool = 'pan';
    let isPanning = false;
    let isAdjustingWL = false;
    let startDrag = { x: 0, y: 0 };
    let panOffset = { x: 0, y: 0 };
    let startWL = { b: 100, c: 100 };

    const els = {
        regionList: document.getElementById('region-list'),
        mainImage: document.getElementById('main-image'),
        scrubber: document.getElementById('scrubber-slice'),
        sliceIdx: document.getElementById('vpc-slice-idx'),
        sliceTotal: document.getElementById('vpc-slice-total'),
        headerName: document.getElementById('header-patient-name'),
        headerDate: document.getElementById('header-date'),
        seriesDesc: document.getElementById('vpc-series-desc'),
        seriesTech: document.getElementById('vpc-series-tech'),
        bright: document.getElementById('scrubber-brightness'),
        contrast: document.getElementById('scrubber-contrast'),
        canvas: document.getElementById('image-canvas'),
        btnZoomIn: document.getElementById('btn-zoom-in'),
        btnZoomOut: document.getElementById('btn-zoom-out'),
        btnZoomReset: document.getElementById('btn-zoom-reset'),
        btnWlReset: document.getElementById('btn-wl-reset'),
        infoDesc: document.getElementById('info-desc'),
        infoProtocol: document.getElementById('info-protocol'),
        infoModality: document.getElementById('info-modality'),
        infoImages: document.getElementById('info-images'),
        infoThickness: document.getElementById('info-thickness'),
        infoTR: document.getElementById('info-tr'),
        infoTE: document.getElementById('info-te'),
        seqIcon: document.getElementById('seq-icon'),
        seqName: document.getElementById('seq-name'),
        seqDesc: document.getElementById('seq-desc')
    };

    if (typeof MRI_DATA !== 'undefined') {
        appData = MRI_DATA;
        init();
    }

    function init() {
        if (!appData || !appData.series.length) return;

        const meta = appData.series[0];
        if (els.headerName) els.headerName.textContent = meta.patient || "Patient";
        if (els.headerDate) els.headerDate.textContent = meta.date || "N/A";

        // Render series list
        if (els.regionList) {
            els.regionList.innerHTML = '';
            appData.series.forEach(s => {
                const item = document.createElement('div');
                item.className = 'series-item';
                item.innerHTML = \`<span class="series-name" title="\${s.description}">\${s.description}</span>
                    <span class="count-badge">\${s.images.length}</span>\`;
                item.onclick = () => loadSeries(s, item);
                els.regionList.appendChild(item);
            });
        }

        // Load first series
        if (appData.series.length) {
            const first = document.querySelector('.series-item');
            if (first) first.click();
        }

        // Scrubber
        if (els.scrubber) els.scrubber.oninput = (e) => showImage(parseInt(e.target.value));

        // Brightness/Contrast
        const brightVal = document.querySelector('#scrubber-brightness + .adj-val');
        const contrastVal = document.querySelector('#scrubber-contrast + .adj-val');
        const updateFilters = () => {
            const b = els.bright?.value || 100;
            const c = els.contrast?.value || 100;
            if (els.mainImage) els.mainImage.style.filter = \`brightness(\${b}%) contrast(\${c}%)\`;
            if (brightVal) brightVal.textContent = b + '%';
            if (contrastVal) contrastVal.textContent = c + '%';
        };
        if (els.bright) els.bright.oninput = updateFilters;
        if (els.contrast) els.contrast.oninput = updateFilters;

        // Scroll wheel
        if (els.canvas) {
            els.canvas.onwheel = (e) => {
                e.preventDefault();
                const delta = Math.sign(e.deltaY);
                let next = currentImageIndex + delta;
                if (next >= 0 && next < (currentSeries?.images?.length || 0)) showImage(next);
            };
        }

        // Zoom
        const updateZoom = () => {
            if (els.mainImage) els.mainImage.style.transform = \`scale(\${currentZoom}) translate(\${panOffset.x}px, \${panOffset.y}px)\`;
        };

        if (els.btnZoomIn) els.btnZoomIn.onclick = () => { currentZoom += 0.2; updateZoom(); };
        if (els.btnZoomOut) els.btnZoomOut.onclick = () => { currentZoom = Math.max(0.2, currentZoom - 0.2); updateZoom(); };
        if (els.btnZoomReset) els.btnZoomReset.onclick = () => {
            if (currentTool !== 'pan') { currentTool = 'pan'; }
            else { currentZoom = 1; panOffset = { x: 0, y: 0 }; updateZoom(); }
        };
        if (els.btnWlReset) els.btnWlReset.onclick = () => {
            if (currentTool !== 'wl') { currentTool = 'wl'; }
            else { if (els.bright) els.bright.value = 100; if (els.contrast) els.contrast.value = 100; updateFilters(); }
        };

        // Pan/WL drag
        if (els.mainImage) {
            els.mainImage.onmousedown = (e) => {
                e.preventDefault();
                startDrag = { x: e.clientX, y: e.clientY };
                if (currentTool === 'pan' && currentZoom > 1) {
                    isPanning = true;
                    els.mainImage.style.cursor = 'grabbing';
                } else if (currentTool === 'wl') {
                    isAdjustingWL = true;
                    startWL = { b: parseInt(els.bright?.value || 100), c: parseInt(els.contrast?.value || 100) };
                }
            };

            document.onmousemove = (e) => {
                if (isPanning) {
                    panOffset.x += (e.clientX - startDrag.x) / currentZoom;
                    panOffset.y += (e.clientY - startDrag.y) / currentZoom;
                    startDrag = { x: e.clientX, y: e.clientY };
                    updateZoom();
                } else if (isAdjustingWL) {
                    const dx = e.clientX - startDrag.x;
                    const dy = e.clientY - startDrag.y;
                    if (els.bright) els.bright.value = Math.max(0, Math.min(200, startWL.b - dy * 0.5));
                    if (els.contrast) els.contrast.value = Math.max(0, Math.min(200, startWL.c + dx * 0.5));
                    updateFilters();
                }
            };

            document.onmouseup = () => {
                if (isPanning) els.mainImage.style.cursor = 'grab';
                isPanning = false;
                isAdjustingWL = false;
            };
        }
    }

    function loadSeries(series, domElement) {
        currentSeries = series;
        currentImageIndex = 0;
        document.querySelectorAll('.series-item').forEach(el => el.classList.remove('active'));
        if (domElement) domElement.classList.add('active');

        if (els.seriesDesc) els.seriesDesc.textContent = series.description;
        if (els.seriesTech) {
            const parts = [series.modality || "MR"];
            if (series.orientation) parts.push(series.orientation);
            parts.push(\`\${series.images.length} images\`);
            els.seriesTech.textContent = parts.join(' • ');
        }

        if (els.scrubber) { els.scrubber.max = series.images.length - 1; els.scrubber.value = 0; }
        if (els.sliceTotal) els.sliceTotal.textContent = series.images.length;

        updateInfoTab(series);
        showImage(0);
    }

    function showImage(index) {
        if (!currentSeries || !currentSeries.images.length) return;
        currentImageIndex = index;
        if (els.mainImage) els.mainImage.src = \`img/\${currentSeries.id}/\${currentSeries.images[index]}\`;
        if (els.sliceIdx) els.sliceIdx.textContent = index + 1;
        if (els.scrubber) els.scrubber.value = index;
    }

    function updateInfoTab(s) {
        if (els.infoDesc) els.infoDesc.textContent = s.description || "-";
        if (els.infoProtocol) els.infoProtocol.textContent = s.protocol || "-";
        if (els.infoModality) els.infoModality.textContent = s.modality || "MR";
        if (els.infoImages) els.infoImages.textContent = s.images.length;
        if (els.infoThickness) els.infoThickness.textContent = s.slice_thickness ? parseFloat(s.slice_thickness).toFixed(1) + "mm" : "-";
        if (els.infoTR) els.infoTR.textContent = s.tr ? Math.round(parseFloat(s.tr)) : "-";
        if (els.infoTE) els.infoTE.textContent = s.te ? parseFloat(s.te).toFixed(1) : "-";

        const desc = (s.description || "").toUpperCase();
        let type = "Standard", icon = "⚙️", summary = "Standard MRI sequence.";
        if (desc.includes("SWI")) { type = "SWI"; icon = "🩸"; summary = "Susceptibility-weighted imaging."; }
        else if (desc.includes("T1")) { type = "T1-Weighted"; icon = "🧠"; summary = "T1 sequences show anatomical detail."; }
        else if (desc.includes("T2")) { type = "T2-Weighted"; icon = "💧"; summary = "T2 sequences highlight pathology."; }
        else if (desc.includes("FLAIR")) { type = "FLAIR"; icon = "🌫️"; summary = "FLAIR suppresses CSF signal."; }

        if (els.seqName) els.seqName.textContent = type;
        if (els.seqIcon) els.seqIcon.textContent = icon;
        if (els.seqDesc) els.seqDesc.textContent = summary;
    }
});`;
}

// Fetch image as blob
async function fetchImageAsBlob(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    return await response.blob();
}

// Main export function
async function exportSelectedSeries(selectedSeries, patientMeta) {
    if (!selectedSeries || selectedSeries.length === 0) {
        alert('No series selected for export.');
        return;
    }

    if (typeof JSZip === 'undefined') {
        alert('JSZip library not loaded. Please check your internet connection.');
        return;
    }

    showExportProgress();
    updateExportProgress(0, 'Initializing...');

    try {
        const zip = new JSZip();

        // Calculate total images for progress
        let totalImages = 0;
        selectedSeries.forEach(s => totalImages += s.images.length);
        let processedImages = 0;

        // Add HTML
        updateExportProgress(5, 'Creating viewer files...');
        zip.file('index.html', generateExportHTML(patientMeta));

        // Add CSS (fetch from current page)
        const cssResponse = await fetch('css/style.css');
        const cssContent = await cssResponse.text();
        zip.folder('css').file('style.css', cssContent);

        // Add viewer JS
        zip.folder('js').file('viewer.js', generateViewerJS());

        // Create filtered data.js
        const exportData = {
            series: selectedSeries
        };
        zip.folder('js').file('data.js', 'const MRI_DATA = ' + JSON.stringify(exportData, null, 2) + ';');

        // Collect annotation data
        updateExportProgress(8, 'Collecting annotations...');
        const annotationsExport = await collectAnnotationsForExport(selectedSeries);

        // Add annotations JSON file if any exist
        if (annotationsExport.length > 0) {
            zip.folder('annotations').file(
                'annotations.json',
                JSON.stringify(annotationsExport, null, 2)
            );
        }

        // Add images for each selected series
        updateExportProgress(10, 'Packaging images...');
        const imgFolder = zip.folder('img');

        for (const series of selectedSeries) {
            const seriesFolder = imgFolder.folder(series.id);

            for (let i = 0; i < series.images.length; i++) {
                const imageName = series.images[i];
                const imagePath = `img/${series.id}/${imageName}`;
                try {
                    const blob = await fetchImageAsBlob(imagePath);

                    // Check if this image has annotations
                    const hasAnnotations = annotationsExport.some(
                        a => a.seriesId === series.id && a.imageIndex === i
                    );

                    if (hasAnnotations) {
                        // Render annotations onto image
                        const annotatedBlob = await renderAnnotationsToImage(
                            blob, series.id, i
                        );
                        seriesFolder.file(imageName, annotatedBlob);
                    } else {
                        seriesFolder.file(imageName, blob);
                    }
                } catch (err) {
                    console.warn(`Could not fetch ${imagePath}:`, err);
                }

                processedImages++;
                const progress = 10 + Math.round((processedImages / totalImages) * 80);
                updateExportProgress(progress, `Packaging: ${series.description} (${processedImages}/${totalImages})`);
            }
        }

        // Generate ZIP
        updateExportProgress(92, 'Compressing...');
        const content = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        }, (metadata) => {
            const progress = 92 + Math.round(metadata.percent * 0.08);
            updateExportProgress(progress, `Compressing: ${Math.round(metadata.percent)}%`);
        });

        // Trigger download
        updateExportProgress(100, 'Starting download...');
        const patientName = (patientMeta.patient || 'MRI_Export').replace(/[^a-zA-Z0-9]/g, '_');
        const date = patientMeta.date || new Date().toISOString().split('T')[0].replace(/-/g, '');
        const filename = `${patientName}_${date}_${selectedSeries.length}series.zip`;

        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        hideExportProgress();

    } catch (error) {
        console.error('Export failed:', error);
        hideExportProgress();

        // Show friendly error with instructions
        if (error.message.includes('fetch') ||
            error.message.includes('Network') ||
            error.message.includes('Failed to execute') ||
            error.message.includes('Load failed')) {
            showExportError();
        } else {
            alert('Export failed: ' + error.message);
        }
    }
}

function showExportError() {
    let modal = document.getElementById('export-error-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'export-error-modal';
        modal.className = 'error-modal';
        modal.innerHTML = `
            <h3>⚠️ Export Blocked</h3>
            <p>
                Your browser is blocking access to local files for security reasons.
                To enable export, you need to run the viewer on a local server.
            </p>
            <p>Run these commands in your terminal:</p>
            <div class="code-block">
cd ${window.location.pathname.split('/output')[0]}
./start_viewer.sh
            </div>
            <div class="modal-actions">
                <button class="close-btn" onclick="document.getElementById('export-error-modal').classList.remove('visible')">Close</button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.add('visible');
}

// Annotation collection function
async function collectAnnotationsForExport(selectedSeries) {
    const annotations = [];

    for (const series of selectedSeries) {
        for (let i = 0; i < series.images.length; i++) {
            const key = `mri-annotations-${series.id}-${i}`;
            const stored = localStorage.getItem(key);

            if (stored) {
                try {
                    const annot = JSON.parse(stored);
                    if (annot.markers.length > 0 || annot.measurements.length > 0 || (annot.crosshairs && annot.crosshairs.length > 0)) {
                        annotations.push(annot);
                    }
                } catch (e) {
                    console.warn(`Failed to parse annotations for ${key}`);
                }
            }
        }
    }

    return annotations;
}

// Render annotations onto image using canvas
async function renderAnnotationsToImage(imageBlob, seriesId, imageIndex) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(imageBlob);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');

            // Draw original image
            ctx.drawImage(img, 0, 0);

            // Load annotations
            const key = `mri-annotations-${seriesId}-${imageIndex}`;
            const stored = localStorage.getItem(key);

            if (stored) {
                try {
                    const annot = JSON.parse(stored);

                    // Render markers
                    annot.markers.forEach(marker => {
                        // Circle
                        ctx.beginPath();
                        ctx.arc(marker.x, marker.y, 15, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
                        ctx.fill();
                        ctx.strokeStyle = 'white';
                        ctx.lineWidth = 2;
                        ctx.stroke();

                        // Number
                        ctx.fillStyle = 'white';
                        ctx.font = 'bold 14px Arial';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                        ctx.lineWidth = 3;
                        ctx.strokeText(marker.number.toString(), marker.x, marker.y);
                        ctx.fillText(marker.number.toString(), marker.x, marker.y);
                    });

                    // Render measurements
                    annot.measurements.forEach(measure => {
                        // Line
                        ctx.beginPath();
                        ctx.moveTo(measure.startX, measure.startY);
                        ctx.lineTo(measure.endX, measure.endY);
                        ctx.strokeStyle = '#00ff00';
                        ctx.lineWidth = 2;
                        ctx.stroke();

                        // Endpoints
                        ctx.beginPath();
                        ctx.arc(measure.startX, measure.startY, 5, 0, Math.PI * 2);
                        ctx.fillStyle = '#00ff00';
                        ctx.fill();
                        ctx.strokeStyle = 'white';
                        ctx.lineWidth = 2;
                        ctx.stroke();

                        ctx.beginPath();
                        ctx.arc(measure.endX, measure.endY, 5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // Label
                        const midX = (measure.startX + measure.endX) / 2;
                        const midY = (measure.startY + measure.endY) / 2;
                        ctx.font = '600 12px Arial';
                        ctx.fillStyle = '#00ff00';
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
                        ctx.lineWidth = 3;
                        ctx.strokeText(measure.label, midX, midY - 10);
                        ctx.fillText(measure.label, midX, midY - 10);
                    });

                    // Render crosshairs
                    if (annot.crosshairs && annot.crosshairs.length > 0) {
                        annot.crosshairs.forEach(ch => {
                            const len = 10000;
                            const gap = 5;

                            // Horizontal (Green)
                            ctx.beginPath();
                            ctx.moveTo(ch.x - len, ch.y);
                            ctx.lineTo(ch.x - gap, ch.y);
                            ctx.moveTo(ch.x + gap, ch.y);
                            ctx.lineTo(ch.x + len, ch.y);
                            ctx.strokeStyle = '#4ade80';
                            ctx.lineWidth = 2;
                            ctx.stroke();

                            // Vertical (Blue)
                            ctx.beginPath();
                            ctx.moveTo(ch.x, ch.y - len);
                            ctx.lineTo(ch.x, ch.y - gap);
                            ctx.moveTo(ch.x, ch.y + gap);
                            ctx.lineTo(ch.x, ch.y + len);
                            ctx.strokeStyle = '#3b82f6';
                            ctx.lineWidth = 2;
                            ctx.stroke();
                        });
                    }
                } catch (e) {
                    console.warn('Failed to render annotations:', e);
                }
            }

            // Convert canvas to blob
            canvas.toBlob((blob) => {
                URL.revokeObjectURL(url);
                resolve(blob);
            }, 'image/jpeg', 0.95);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };

        img.src = url;
    });
}

// Expose globally for app.js to call
window.exportSelectedSeries = exportSelectedSeries;
