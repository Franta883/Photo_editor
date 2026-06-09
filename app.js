C:\photo-editor
Fix 2: Batch download race condition

Fix 3: updateVideoUI reassignment — let me check current state:

Fix 3 is already wrapped in try/catch — and since the file is loaded as <script type="module">, function declarations create mutable bindings, so it works fine. No change needed.

Fix 4: rotateImageFine() mask destruction

Fix 5: TDZ — move maskCanvas/maskCtx declarations to top of file

All 5 fixed:

applyCrop() variable shadowing — renamed inner vars to cropSx/cropSy/cropSw/cropSh (lines 1279–1284)
downloadBatchIndividual() race condition — wrapped revokeObjectURL in setTimeout(..., 1000)
updateVideoUI reassignment — already wrapped in try/catch; works fine in module mode (function declarations are mutable in ESM)
rotateImageFine() mask destruction — changed fillRect(#000) → clearRect() so the mask stays transparent
loadImage() TDZ — moved let maskCanvas/maskCtx to line 60 (top of file, with the other globals)
Re-zip and publish.

const state = {
    originalImage: null,
    currentImage: null,
    zoom: 1,
    activeTool: 'adjust',
    activeFilter: 'none',
    filterIntensity: 100,
    adjustments: {
        brightness: 0, contrast: 0, saturation: 0, exposure: 0,
        highlights: 0, shadows: 0, temperature: 0, vibrance: 0,
        sharpness: 0, vignette: 0
    },
    curves: {
        rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    },
    curvesChannel: 'rgb',
    curvesDragging: null,
    crop: { x: 0, y: 0, w: 0, h: 0, ratio: 'free', dragging: null, startMouse: null, startCrop: null },
    localMask: null,
    localBrush: { size: 40, hardness: 50, mode: 'paint' },
    localPainting: false,
    color: {
        tint: 0,
        cbShadows: { cr: 0, mg: 0, yb: 0 },
        cbMidtones: { cr: 0, mg: 0, yb: 0 },
        cbHighlights: { cr: 0, mg: 0, yb: 0 },
        hsl: {
            red: { h: 0, s: 0, l: 0 },
            orange: { h: 0, s: 0, l: 0 },
            yellow: { h: 0, s: 0, l: 0 },
            green: { h: 0, s: 0, l: 0 },
            aqua: { h: 0, s: 0, l: 0 },
            blue: { h: 0, s: 0, l: 0 },
            purple: { h: 0, s: 0, l: 0 },
            magenta: { h: 0, s: 0, l: 0 }
        }
    },
    lens: {
        distortion: 0,
        distortion2: 0,
        ca: 0,
        vignette: 0,
        perspH: 0,
        perspV: 0,
        rotation: 0,
        scale: 100
    },
    layers: [],
    activeLayerId: null,
    history: [],
    historyIndex: -1,
    aiModel: null
};

const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let maskCanvas = null;
let maskCtx = null;
const curvesCanvas = document.getElementById('curves-canvas');
const curvesCtx = curvesCanvas.getContext('2d');

function cloneImageData(imgData) {
    return new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height);
}

function saveHistory() {
    if (!state.currentImage) return;
    syncActiveLayerFromCurrent();
    const snapshot = {
        layers: state.layers.map(l => ({
            id: l.id,
            name: l.name,
            data: cloneImageData(l.data),
            visible: l.visible,
            opacity: l.opacity,
            blendMode: l.blendMode
        })),
        activeLayerId: state.activeLayerId,
        composite: compositeLayers()
    };
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    state.historyIndex = state.history.length - 1;
    updateHistoryUI();
}

function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    const snap = state.history[state.historyIndex];
    restoreSnapshot(snap);
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    const snap = state.history[state.historyIndex];
    restoreSnapshot(snap);
}

function restoreSnapshot(snap) {
    if (!snap) return;
    if (snap.layers) {
        state.layers = snap.layers.map(l => ({
            id: l.id,
            name: l.name,
            data: cloneImageData(l.data),
            visible: l.visible,
            opacity: l.opacity,
            blendMode: l.blendMode
        }));
        state.activeLayerId = snap.activeLayerId;
    }
    if (snap.composite) {
        state.currentImage = cloneImageData(snap.composite);
        if (canvas.width !== snap.composite.width || canvas.height !== snap.composite.height) {
            canvas.width = snap.composite.width;
            canvas.height = snap.composite.height;
        }
    }
    renderLayerList();
    renderCanvas();
    resetSlidersToCurrent();
    updateHistoryUI();
}

function updateHistoryUI() {
    document.getElementById('btn-undo').disabled = state.historyIndex <= 0;
    document.getElementById('btn-redo').disabled = state.historyIndex >= state.history.length - 1;
    document.getElementById('history-count').textContent =
        state.history.length > 0 ? `${state.historyIndex + 1}/${state.history.length}` : '';
}

function resetSlidersToCurrent() {
    Object.keys(state.adjustments).forEach(key => {
        state.adjustments[key] = 0;
        const el = document.getElementById(`adj-${key}`);
        if (el) { el.value = 0; document.getElementById(`val-${key}`).textContent = '0'; }
    });
    state.activeFilter = 'none';
    state.filterIntensity = 100;
    document.getElementById('filter-intensity').value = 100;
    document.getElementById('val-filter-intensity').textContent = '100';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'none'));
}

function loadImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            state.originalImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
            state.currentImage = cloneImageData(state.originalImage);
            canvas.style.display = 'block';
            document.getElementById('drop-zone').classList.add('hidden');
            state.history = [];
            state.historyIndex = -1;
            maskCanvas = null;
            maskCtx = null;
            state.localMask = false;
            const overlay = document.getElementById('mask-overlay');
            if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
            state.layers = [{
                id: Date.now() + Math.random(),
                name: 'Background',
                data: cloneImageData(state.originalImage),
                visible: true,
                opacity: 100,
                blendMode: 'normal'
            }];
            state.activeLayerId = state.layers[0].id;
            saveHistory();
            resetSlidersToCurrent();
            renderCanvas();
            fitZoom();
            renderLayerList();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function renderCanvas() {
    if (!state.currentImage) return;
    const src = state.currentImage;
    const w = src.width, h = src.height;

    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }

    let imageData = cloneImageData(src);
    applyAdjustments(imageData);
    applyColorCorrection(imageData);
    applyFilter(imageData);
    applyCurves(imageData);
    applyVignette(imageData);

    ctx.putImageData(imageData, 0, 0);
    if (state.activeTool === 'draw' && drawState.drawCanvas && drawState.drawCtx) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(drawState.drawCanvas, 0, 0);
        ctx.restore();
    }
}

function clamp(v, min = 0, max = 255) {
    return v < min ? min : v > max ? max : v;
}

function applyAdjustments(imageData) {
    const d = imageData.data;
    const a = state.adjustments;
    const brightness = a.brightness * 2.55;
    const contrastFactor = (259 * (a.contrast + 255)) / (255 * (259 - a.contrast));
    const exposure = Math.pow(2, a.exposure / 100);
    const sat = (a.saturation + 100) / 100;
    const temp = a.temperature / 100;
    const vib = a.vibrance / 100;

    for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];

        r += brightness; g += brightness; b += brightness;
        r = contrastFactor * (r - 128) + 128;
        g = contrastFactor * (g - 128) + 128;
        b = contrastFactor * (b - 128) + 128;
        r *= exposure; g *= exposure; b *= exposure;

        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = gray + sat * (r - gray);
        g = gray + sat * (g - gray);
        b = gray + sat * (b - gray);

        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const avg = (maxC + minC) / 2;
        const satVal = maxC === minC ? 0 : (maxC - minC) / (1 - Math.abs(2 * avg - 1) || 1);
        const vibFactor = 1 + vib * (1 - satVal);
        r = avg + vibFactor * (r - avg);
        g = avg + vibFactor * (g - avg);
        b = avg + vibFactor * (b - avg);

        r += temp * 15; b -= temp * 15;

        if (a.highlights !== 0) {
            const highlightMask = Math.max(0, (gray - 128) / 127);
            const hlAdj = a.highlights * 0.5 * highlightMask;
            r += hlAdj; g += hlAdj; b += hlAdj;
        }
        if (a.shadows !== 0) {
            const shadowMask = Math.max(0, (128 - gray) / 128);
            const shAdj = a.shadows * 0.5 * shadowMask;
            r += shAdj; g += shAdj; b += shAdj;
        }

        d[i] = clamp(r);
        d[i + 1] = clamp(g);
        d[i + 2] = clamp(b);
    }

    if (a.sharpness > 0) applySharpen(imageData, a.sharpness / 100);
}

function applySharpen(imageData, amount) {
    const d = imageData.data;
    const w = imageData.width;
    const copy = new Uint8ClampedArray(d);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 1; y < imageData.height - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            for (let c = 0; c < 3; c++) {
                let val = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        val += copy[((y + ky) * w + (x + kx)) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
                    }
                }
                const idx = (y * w + x) * 4 + c;
                d[idx] = clamp(d[idx] + (val - d[idx]) * amount);
            }
        }
    }
}

const filterPresets = {
    grayscale: (r, g, b) => {
        const v = 0.299 * r + 0.587 * g + 0.114 * b;
        return [v, v, v];
    },
    sepia: (r, g, b) => [
        clamp(r * 0.393 + g * 0.769 + b * 0.189),
        clamp(r * 0.349 + g * 0.686 + b * 0.168),
        clamp(r * 0.272 + g * 0.534 + b * 0.131)
    ],
    vintage: (r, g, b) => [
        clamp(r * 0.6 + g * 0.3 + b * 0.1 + 20),
        clamp(r * 0.2 + g * 0.6 + b * 0.2 + 10),
        clamp(r * 0.1 + g * 0.3 + b * 0.6 - 10)
    ],
    dramatic: (r, g, b) => {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const factor = 1.5;
        return [
            clamp(gray + factor * (r - gray)),
            clamp(gray + factor * (g - gray)),
            clamp(gray + factor * (b - gray))
        ];
    },
    cool: (r, g, b) => [clamp(r - 10), clamp(g), clamp(b + 20)],
    warm: (r, g, b) => [clamp(r + 20), clamp(g + 10), clamp(b - 15)],
    fade: (r, g, b) => [clamp(r * 0.8 + 50), clamp(g * 0.8 + 50), clamp(b * 0.8 + 50)],
    highContrast: (r, g, b) => {
        const f = 1.8;
        return [
            clamp(f * (r - 128) + 128),
            clamp(f * (g - 128) + 128),
            clamp(f * (b - 128) + 128)
        ];
    },
    invert: (r, g, b) => [255 - r, 255 - g, 255 - b],
    posterize: (r, g, b) => {
        const levels = 4;
        const step = 255 / (levels - 1);
        return [
        Math.round(Math.round(r / step) * step),
        Math.round(Math.round(g / step) * step),
        Math.round(Math.round(b / step) * step)
        ];
    },
    emboss: () => [128, 128, 128]
};

function applyFilter(imageData) {
    if (state.activeFilter === 'none') return;
    const d = imageData.data;
    const intensity = state.filterIntensity / 100;
    const preset = filterPresets[state.activeFilter];
    if (!preset) return;

    if (state.activeFilter === 'emboss') {
        applyEmbossFilter(imageData, intensity);
        return;
    }

    for (let i = 0; i < d.length; i += 4) {
        const [nr, ng, nb] = preset(d[i], d[i + 1], d[i + 2]);
        d[i] = clamp(d[i] + (nr - d[i]) * intensity);
        d[i + 1] = clamp(d[i + 1] + (ng - d[i + 1]) * intensity);
        d[i + 2] = clamp(d[i + 2] + (nb - d[i + 2]) * intensity);
    }
}

function applyEmbossFilter(imageData, intensity) {
    const d = imageData.data;
    const w = imageData.width;
    const copy = new Uint8ClampedArray(d);
    const kernel = [-2, -1, 0, -1, 1, 1, 0, 1, 2];
    for (let y = 1; y < imageData.height - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            for (let c = 0; c < 3; c++) {
                let val = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        val += copy[((y + ky) * w + (x + kx)) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
                    }
                }
                const idx = (y * w + x) * 4 + c;
                d[idx] = clamp(d[idx] + (val + 128 - d[idx]) * intensity);
            }
        }
    }
}

function applyVignette(imageData) {
    if (state.adjustments.vignette === 0) return;
    const d = imageData.data;
    const w = imageData.width, h = imageData.height;
    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    const strength = state.adjustments.vignette / 100;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = x - cx, dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
            const factor = 1 - dist * dist * strength * 1.5;
            const idx = (y * w + x) * 4;
            d[idx] = clamp(d[idx] * factor);
            d[idx + 1] = clamp(d[idx + 1] * factor);
            d[idx + 2] = clamp(d[idx + 2] * factor);
        }
    }
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
    h /= 360;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [r * 255, g * 255, b * 255];
}

const hslColorRanges = {
    red: [0, 15],
    orange: [15, 45],
    yellow: [45, 70],
    green: [70, 165],
    aqua: [165, 200],
    blue: [200, 255],
    purple: [255, 290],
    magenta: [290, 345]
};

function getHslWeight(hue, colorName) {
    const [hMin, hMax] = hslColorRanges[colorName];
    const range = hMax - hMin;
    let dist;
    if (hue >= hMin && hue <= hMax) {
        return 1;
    } else {
        const before = (hue - hMin + 360) % 360;
        const after = (hMax - hue + 360) % 360;
        dist = Math.min(before, after);
    }
    return Math.max(0, 1 - (dist / (range / 2)));
}

function applyColorCorrection(imageData) {
    const c = state.color;
    const d = imageData.data;
    const hasTint = c.tint !== 0;
    const hasCB = c.cbShadows.cr !== 0 || c.cbShadows.mg !== 0 || c.cbShadows.yb !== 0 ||
                  c.cbMidtones.cr !== 0 || c.cbMidtones.mg !== 0 || c.cbMidtones.yb !== 0 ||
                  c.cbHighlights.cr !== 0 || c.cbHighlights.mg !== 0 || c.cbHighlights.yb !== 0;
    let hasHsl = false;
    for (const k in c.hsl) {
        if (c.hsl[k].h !== 0 || c.hsl[k].s !== 0 || c.hsl[k].l !== 0) { hasHsl = true; break; }
    }
    if (!hasTint && !hasCB && !hasHsl) return;

    for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];

        if (hasTint) {
            const tintAmount = c.tint * 0.3;
            g += tintAmount;
            r -= tintAmount * 0.3;
            b -= tintAmount * 0.3;
        }

        if (hasCB) {
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const shadowMask = Math.max(0, 1 - lum / 128);
            const highlightMask = Math.max(0, (lum - 128) / 127);
            const midtoneMask = 1 - shadowMask - highlightMask;
            const shadowMask2 = shadowMask * shadowMask;
            const highlightMask2 = highlightMask * highlightMask;

            const cbS = c.cbShadows;
            const cbM = c.cbMidtones;
            const cbH = c.cbHighlights;
            const totalCR = (cbS.cr * shadowMask2 + cbM.cr * midtoneMask + cbH.cr * highlightMask2) * 0.5;
            const totalMG = (cbS.mg * shadowMask2 + cbM.mg * midtoneMask + cbH.mg * highlightMask2) * 0.5;
            const totalYB = (cbS.yb * shadowMask2 + cbM.yb * midtoneMask + cbH.yb * highlightMask2) * 0.5;

            r += totalCR - totalYB * 0.5;
            g += totalMG * 0.7 - totalCR * 0.3;
            b += totalYB - totalMG * 0.3;
        }

        if (hasHsl) {
            const [h, s, l] = rgbToHsl(r, g, b);
            let newH = h, newS = s, newL = l;
            let totalWeight = 0;

            for (const colorName in c.hsl) {
                const adj = c.hsl[colorName];
                if (adj.h === 0 && adj.s === 0 && adj.l === 0) continue;
                const weight = getHslWeight(h, colorName);
                if (weight <= 0) continue;
                newH += adj.h * weight;
                newS += (adj.s / 100) * weight;
                newL += (adj.l / 100) * weight;
                totalWeight += weight;
            }

            if (totalWeight > 0) {
                newH = ((newH % 360) + 360) % 360;
                newS = Math.max(0, Math.min(1, newS));
                newL = Math.max(0, Math.min(1, newL));
                const [nr, ng, nb] = hslToRgb(newH, newS, newL);
                const blendAmount = Math.min(1, totalWeight);
                r = r + (nr - r) * blendAmount;
                g = g + (ng - g) * blendAmount;
                b = b + (nb - b) * blendAmount;
            }
        }

        d[i] = clamp(r);
        d[i + 1] = clamp(g);
        d[i + 2] = clamp(b);
    }
}

function applyLensCorrection(src, lens) {
    const w = src.width, h = src.height;
    const cx = w / 2, cy = h / 2;
    const k1 = lens.distortion / 5000;
    const k2 = lens.distortion2 / 100000;
    const ca = lens.ca / 100;
    const vignette = lens.vignette / 100;
    const perspH = lens.perspH / 100;
    const perspV = lens.perspV / 100;
    const rotation = (lens.rotation * Math.PI) / 180;
    const scale = lens.scale / 100;

    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    const maxR = Math.sqrt(cx * cx + cy * cy);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.putImageData(src, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = w;
    dstCanvas.height = h;
    const dstCtx = dstCanvas.getContext('2d');
    const dstData = dstCtx.createImageData(w, h);
    const d = dstData.data;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = x - cx;
            const dy = y - cy;

            const rx = dx * cosR - dy * sinR;
            const ry = dx * sinR + dy * cosR;
            const sx = rx / scale;
            const sy = ry / scale;

            let px = sx + cx;
            let py = sy + cy;

            if (perspH !== 0 || perspV !== 0) {
                const u = (px - cx) / cx;
                const v = (py - cy) / cy;
                const perspFactorX = 1 + perspV * v;
                const perspFactorY = 1 + perspH * u;
                px = cx + (px - cx) * perspFactorX;
                py = cy + (py - cy) * perspFactorY;
            }

            if (k1 !== 0 || k2 !== 0) {
                const ndx = (px - cx) / maxR;
                const ndy = (py - cy) / maxR;
                const r2 = ndx * ndx + ndy * ndy;
                const distortFactor = 1 + k1 * r2 + k2 * r2 * r2;
                px = cx + (px - cx) * distortFactor;
                py = cy + (py - cy) * distortFactor;
            }

            let r, g, b, a;
            if (px < 0 || px >= w - 1 || py < 0 || py >= h - 1) {
                r = g = b = 0; a = 255;
            } else {
                const x0 = Math.floor(px), y0 = Math.floor(py);
                const x1 = x0 + 1, y1 = y0 + 1;
                const fx = px - x0, fy = py - y0;

                let caR_x = px, caB_x = px;
                if (ca > 0) {
                    const r2 = ((px - cx) * (px - cx) + (py - cy) * (py - cy)) / (maxR * maxR);
                    const caShift = ca * r2 * 8;
                    caR_x = px - caShift;
                    caB_x = px + caShift;
                }

                const sampleChannel = (chan, sx2) => {
                    if (sx2 < 0 || sx2 >= w - 1) return 0;
                    const xx0 = Math.floor(sx2);
                    const fxx = sx2 - xx0;
                    const idx00 = (y0 * w + xx0) * 4 + chan;
                    const idx10 = (y0 * w + (xx0 + 1)) * 4 + chan;
                    const idx01 = ((y0 + 1) * w + xx0) * 4 + chan;
                    const idx11 = ((y0 + 1) * w + (xx0 + 1)) * 4 + chan;
                    const v00 = src.data[idx00], v10 = src.data[idx10];
                    const v01 = src.data[idx01], v11 = src.data[idx11];
                    return v00 * (1 - fxx) * (1 - fy) + v10 * fxx * (1 - fy) +
                           v01 * (1 - fxx) * fy + v11 * fxx * fy;
                };

                r = sampleChannel(0, caR_x);
                g = sampleChannel(1, px);
                b = sampleChannel(2, caB_x);
                a = 255;
            }

            const idx = (y * w + x) * 4;

            if (vignette !== 0) {
                const dxC = (x - cx) / cx;
                const dyC = (y - cy) / cy;
                const dist2 = dxC * dxC + dyC * dyC;
                const vigFactor = vignette > 0
                    ? 1 - (vignette * dist2 * 0.8)
                    : 1 + ((-vignette) * dist2 * 0.5);
                r = clamp(r * vigFactor);
                g = clamp(g * vigFactor);
                b = clamp(b * vigFactor);
            }

            d[idx] = clamp(r);
            d[idx + 1] = clamp(g);
            d[idx + 2] = clamp(b);
            d[idx + 3] = a;
        }
    }

    dstCtx.putImageData(dstData, 0, 0);
    return dstCtx.getImageData(0, 0, w, h);
}

function applyCurves(imageData) {
    const d = imageData.data;
    const lookupR = buildLookupTable(state.curves.red);
    const lookupG = buildLookupTable(state.curves.green);
    const lookupB = buildLookupTable(state.curves.blue);
    const lookupRGB = buildLookupTable(state.curves.rgb);

    for (let i = 0; i < d.length; i += 4) {
        d[i] = lookupRGB[lookupR[d[i]]];
        d[i + 1] = lookupRGB[lookupG[d[i + 1]]];
        d[i + 2] = lookupRGB[lookupB[d[i + 2]]];
    }
}

function buildLookupTable(points) {
    const table = new Uint8Array(256);
    const sorted = [...points].sort((a, b) => a.x - b.x);
    for (let i = 0; i < 256; i++) {
        const x = i / 255;
        let y = 0;
        if (sorted.length === 0) { y = x; }
        else if (x <= sorted[0].x) { y = sorted[0].y; }
        else if (x >= sorted[sorted.length - 1].x) { y = sorted[sorted.length - 1].y; }
        else {
            for (let j = 0; j < sorted.length - 1; j++) {
                if (x >= sorted[j].x && x <= sorted[j + 1].x) {
                    const t = (x - sorted[j].x) / (sorted[j + 1].x - sorted[j].x);
                    y = sorted[j].y + t * (sorted[j + 1].y - sorted[j].y);
                    break;
                }
            }
        }
        table[i] = clamp(Math.round(y * 255));
    }
    return table;
}

function getActiveLayer() {
    return state.layers.find(l => l.id === state.activeLayerId) || state.layers[0] || null;
}

function syncActiveLayerFromCurrent() {
    const layer = getActiveLayer();
    if (layer && state.currentImage) {
        if (layer.data.width !== state.currentImage.width || layer.data.height !== state.currentImage.height) {
            layer.data = cloneImageData(state.currentImage);
        } else {
            layer.data.data.set(state.currentImage.data);
        }
    }
}

function compositeLayers() {
    if (!state.layers.length) return null;
    const w = state.layers[0].data.width;
    const h = state.layers[0].data.height;
    const result = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
    const r = result.data;
    for (let i = 3; i < r.length; i += 4) r[i] = 255;

    for (let i = state.layers.length - 1; i >= 0; i--) {
        const layer = state.layers[i];
        if (!layer.visible) continue;
        const ld = layer.data.data;
        const opacity = layer.opacity / 100;

        if (layer.blendMode === 'normal' || !layer.blendMode) {
            for (let p = 0; p < ld.length; p += 4) {
                const srcA = (ld[p + 3] / 255) * opacity;
                const dstA = r[p + 3] / 255;
                const outA = srcA + dstA * (1 - srcA);
                if (outA < 0.001) continue;
                r[p] = (ld[p] * srcA + r[p] * dstA * (1 - srcA)) / outA;
                r[p + 1] = (ld[p + 1] * srcA + r[p + 1] * dstA * (1 - srcA)) / outA;
                r[p + 2] = (ld[p + 2] * srcA + r[p + 2] * dstA * (1 - srcA)) / outA;
                r[p + 3] = outA * 255;
            }
        } else {
            for (let p = 0; p < ld.length; p += 4) {
                if (ld[p + 3] === 0) continue;
                const srcA = (ld[p + 3] / 255) * opacity;
                if (srcA < 0.001) continue;
                const dr = r[p] / 255, dg = r[p + 1] / 255, db = r[p + 2] / 255;
                const sr = ld[p] / 255, sg = ld[p + 1] / 255, sb = ld[p + 2] / 255;
                let brR, brG, brB;
                switch (layer.blendMode) {
                    case 'multiply': brR = sr * dr; brG = sg * dg; brB = sb * db; break;
                    case 'screen': brR = 1 - (1 - sr) * (1 - dr); brG = 1 - (1 - sg) * (1 - dg); brB = 1 - (1 - sb) * (1 - db); break;
                    case 'overlay':
                        brR = dr < 0.5 ? 2 * sr * dr : 1 - 2 * (1 - sr) * (1 - dr);
                        brG = dg < 0.5 ? 2 * sg * dg : 1 - 2 * (1 - sg) * (1 - dg);
                        brB = db < 0.5 ? 2 * sb * db : 1 - 2 * (1 - sb) * (1 - db);
                        break;
                    case 'soft-light':
                        brR = sr < 0.5 ? dr - (1 - 2 * sr) * dr * (1 - dr) : dr + (2 * sr - 1) * (Math.sqrt(dr) - dr);
                        brG = sg < 0.5 ? dg - (1 - 2 * sg) * dg * (1 - dg) : dg + (2 * sg - 1) * (Math.sqrt(dg) - dg);
                        brB = sb < 0.5 ? db - (1 - 2 * sb) * db * (1 - db) : db + (2 * sb - 1) * (Math.sqrt(db) - db);
                        break;
                    case 'hard-light':
                        brR = sr < 0.5 ? 2 * sr * dr : 1 - 2 * (1 - sr) * (1 - dr);
                        brG = sg < 0.5 ? 2 * sg * dg : 1 - 2 * (1 - sg) * (1 - dg);
                        brB = sb < 0.5 ? 2 * sb * db : 1 - 2 * (1 - sb) * (1 - db);
                        break;
                    case 'color-dodge':
                        brR = sr >= 1 ? 1 : Math.min(1, dr / (1 - sr));
                        brG = sg >= 1 ? 1 : Math.min(1, dg / (1 - sg));
                        brB = sb >= 1 ? 1 : Math.min(1, db / (1 - sb));
                        break;
                    case 'color-burn':
                        brR = sr <= 0 ? 0 : 1 - Math.min(1, (1 - dr) / sr);
                        brG = sg <= 0 ? 0 : 1 - Math.min(1, (1 - dg) / sg);
                        brB = sb <= 0 ? 0 : 1 - Math.min(1, (1 - db) / sb);
                        break;
                    case 'darken': brR = Math.min(sr, dr); brG = Math.min(sg, dg); brB = Math.min(sb, db); break;
                    case 'lighten': brR = Math.max(sr, dr); brG = Math.max(sg, dg); brB = Math.max(sb, db); break;
                    case 'difference': brR = Math.abs(sr - dr); brG = Math.abs(sg - dg); brB = Math.abs(sb - db); break;
                    case 'exclusion': brR = sr + dr - 2 * sr * dr; brG = sg + dg - 2 * sg * dg; brB = sb + db - 2 * sb * db; break;
                    case 'hue': {
                        const [hh] = rgbToHsl(sr * 255, sg * 255, sb * 255);
                        const [, ss, ll] = rgbToHsl(dr * 255, dg * 255, db * 255);
                        [brR, brG, brB] = hslToRgb(hh, ss, ll).map(v => v / 255);
                        break;
                    }
                    case 'saturation': {
                        const [hh, , ll] = rgbToHsl(dr * 255, dg * 255, db * 255);
                        const [, ss2] = rgbToHsl(sr * 255, sg * 255, sb * 255);
                        [brR, brG, brB] = hslToRgb(hh, ss2, ll).map(v => v / 255);
                        break;
                    }
                    case 'color': {
                        const [hh, ss2] = rgbToHsl(sr * 255, sg * 255, sb * 255);
                        const [, , ll] = rgbToHsl(dr * 255, dg * 255, db * 255);
                        [brR, brG, brB] = hslToRgb(hh, ss2, ll).map(v => v / 255);
                        break;
                    }
                    case 'luminosity': {
                        const [hh, ss2, ] = rgbToHsl(dr * 255, dg * 255, db * 255);
                        const [, , ll2] = rgbToHsl(sr * 255, sg * 255, sb * 255);
                        [brR, brG, brB] = hslToRgb(hh, ss2, ll2).map(v => v / 255);
                        break;
                    }
                    default: brR = sr; brG = sg; brB = sb;
                }
                const blended = [Math.round(brR * 255), Math.round(brG * 255), Math.round(brB * 255)];
                const dstA = r[p + 3] / 255;
                const outA = srcA + dstA * (1 - srcA);
                r[p] = (blended[0] * srcA + r[p] * dstA * (1 - srcA)) / outA;
                r[p + 1] = (blended[1] * srcA + r[p + 1] * dstA * (1 - srcA)) / outA;
                r[p + 2] = (blended[2] * srcA + r[p + 2] * dstA * (1 - srcA)) / outA;
                r[p + 3] = outA * 255;
            }
        }
    }
    return result;
}

function refreshComposite() {
    const composite = compositeLayers();
    if (!composite) return;
    state.currentImage = composite;
    if (canvas.width !== composite.width || canvas.height !== composite.height) {
        canvas.width = composite.width;
        canvas.height = composite.height;
    }
}

function addLayer(data, name) {
    if (!state.currentImage) return;
    const w = data.width;
    const h = data.height;
    const layer = {
        id: Date.now() + Math.random(),
        name: name || `Layer ${state.layers.length + 1}`,
        data: data,
        visible: true,
        opacity: 100,
        blendMode: 'normal'
    };
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    state.currentImage = cloneImageData(data);
    saveHistory();
    renderLayerList();
    renderCanvas();
}

function deleteLayer(id) {
    if (state.layers.length <= 1) return;
    const idx = state.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    state.layers.splice(idx, 1);
    if (state.activeLayerId === id) {
        const newActive = state.layers[Math.min(idx, state.layers.length - 1)];
        state.activeLayerId = newActive.id;
        state.currentImage = cloneImageData(newActive.data);
    }
    saveHistory();
    renderLayerList();
    renderCanvas();
}

function duplicateLayer(id) {
    const layer = state.layers.find(l => l.id === id);
    if (!layer) return;
    const newLayer = {
        id: Date.now() + Math.random(),
        name: layer.name + ' copy',
        data: cloneImageData(layer.data),
        visible: true,
        opacity: layer.opacity,
        blendMode: layer.blendMode
    };
    const idx = state.layers.findIndex(l => l.id === id);
    state.layers.splice(idx + 1, 0, newLayer);
    state.activeLayerId = newLayer.id;
    state.currentImage = cloneImageData(newLayer.data);
    saveHistory();
    renderLayerList();
    renderCanvas();
}

function moveLayer(id, direction) {
    const idx = state.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= state.layers.length) return;
    [state.layers[idx], state.layers[newIdx]] = [state.layers[newIdx], state.layers[idx]];
    saveHistory();
    renderLayerList();
    refreshComposite();
    renderCanvas();
}

function mergeLayerDown(id) {
    const idx = state.layers.findIndex(l => l.id === id);
    if (idx <= 0) return;
    const top = state.layers[idx];
    const bottom = state.layers[idx - 1];

    const w = top.data.width;
    const h = top.data.height;
    const merged = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
    const d = merged.data;
    const topD = top.data.data;
    const botD = bottom.data.data;
    const topA = top.opacity / 100;
    const botA = bottom.opacity / 100;

    for (let i = 0; i < d.length; i += 4) {
        const ta = (topD[i + 3] / 255) * topA;
        const ba = (botD[i + 3] / 255) * botA;
        const oa = ta + ba * (1 - ta);
        if (oa < 0.001) continue;
        d[i] = (topD[i] * ta + botD[i] * ba * (1 - ta)) / oa;
        d[i + 1] = (topD[i + 1] * ta + botD[i + 1] * ba * (1 - ta)) / oa;
        d[i + 2] = (topD[i + 2] * ta + botD[i + 2] * ba * (1 - ta)) / oa;
        d[i + 3] = oa * 255;
    }

    bottom.data = merged;
    bottom.opacity = 100;
    state.layers.splice(idx, 1);
    state.activeLayerId = bottom.id;
    state.currentImage = cloneImageData(merged);
    saveHistory();
    renderLayerList();
    renderCanvas();
}

function flattenImage() {
    const composite = compositeLayers();
    if (!composite) return;
    state.layers = [{
        id: Date.now() + Math.random(),
        name: 'Background',
        data: composite,
        visible: true,
        opacity: 100,
        blendMode: 'normal'
    }];
    state.activeLayerId = state.layers[0].id;
    state.currentImage = cloneImageData(composite);
    saveHistory();
    renderLayerList();
    renderCanvas();
}

function setActiveLayer(id) {
    syncActiveLayerFromCurrent();
    const layer = state.layers.find(l => l.id === id);
    if (!layer) return;
    state.activeLayerId = id;
    state.currentImage = cloneImageData(layer.data);
    renderLayerList();
    renderCanvas();
    updateLayerControls();
}

function toggleLayerVisibility(id) {
    const layer = state.layers.find(l => l.id === id);
    if (!layer) return;
    layer.visible = !layer.visible;
    saveHistory();
    refreshComposite();
    renderCanvas();
    renderLayerList();
}

function renderLayerList() {
    const list = document.getElementById('layer-list');
    if (!list) return;
    list.innerHTML = '';

    state.layers.forEach((layer, idx) => {
        const item = document.createElement('div');
        item.className = 'layer-item' + (layer.id === state.activeLayerId ? ' active' : '');

        const vis = document.createElement('span');
        vis.className = 'layer-visibility';
        vis.textContent = layer.visible ? '👁' : '⊘';
        vis.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLayerVisibility(layer.id);
        });
        item.appendChild(vis);

        const thumb = document.createElement('div');
        thumb.className = 'layer-thumb';
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 32;
        thumbCanvas.height = 32;
        const tctx = thumbCanvas.getContext('2d');
        const scale = Math.min(32 / layer.data.width, 32 / layer.data.height);
        const sw = layer.data.width * scale;
        const sh = layer.data.height * scale;
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = layer.data.width;
        srcCanvas.height = layer.data.height;
        srcCanvas.getContext('2d').putImageData(layer.data, 0, 0);
        tctx.drawImage(srcCanvas, (32 - sw) / 2, (32 - sh) / 2, sw, sh);
        thumb.style.backgroundImage = `url(${thumbCanvas.toDataURL()})`;
        item.appendChild(thumb);

        const info = document.createElement('div');
        info.className = 'layer-info';
        const name = document.createElement('div');
        name.className = 'layer-name';
        name.textContent = layer.name;
        info.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'layer-meta';
        meta.textContent = `${layer.blendMode} · ${layer.opacity}%`;
        info.appendChild(meta);
        item.appendChild(info);

        item.addEventListener('click', () => setActiveLayer(layer.id));
        list.appendChild(item);
    });

    updateLayerControls();
}

function updateLayerControls() {
    const layer = getActiveLayer();
    if (!layer) return;
    document.getElementById('layer-opacity').value = layer.opacity;
    document.getElementById('val-layer-opacity').textContent = layer.opacity;
    document.getElementById('layer-blend').value = layer.blendMode;
}

function fitZoom() {
    if (!state.originalImage && !videoState.el) return;
    const area = document.getElementById('canvas-area');
    const padding = 40;
    const availW = area.clientWidth - padding;
    const availH = area.clientHeight - padding - (videoState.el ? 110 : 0);
    const scaleX = availW / canvas.width;
    const scaleY = availH / canvas.height;
    state.zoom = Math.min(scaleX, scaleY, 1);
    canvas.style.transform = `scale(${state.zoom})`;
    const zl = document.getElementById('zoom-level');
    if (zl) zl.textContent = Math.round(state.zoom * 100) + '%';
}

// Curves rendering
function renderCurves() {
    const w = curvesCanvas.width, h = curvesCanvas.height;
    curvesCtx.clearRect(0, 0, w, h);
    curvesCtx.fillStyle = '#1a1a2e';
    curvesCtx.fillRect(0, 0, w, h);

    // Grid
    curvesCtx.strokeStyle = '#2a3a5e';
    curvesCtx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const pos = (i / 4) * w;
        curvesCtx.beginPath(); curvesCtx.moveTo(pos, 0); curvesCtx.lineTo(pos, h); curvesCtx.stroke();
        curvesCtx.beginPath(); curvesCtx.moveTo(0, pos); curvesCtx.lineTo(w, pos); curvesCtx.stroke();
    }

    // Diagonal reference
    curvesCtx.strokeStyle = '#445577';
    curvesCtx.lineWidth = 1;
    curvesCtx.beginPath(); curvesCtx.moveTo(0, h); curvesCtx.lineTo(w, 0); curvesCtx.stroke();

    // Draw curve for each active channel
    const channels = state.curvesChannel === 'rgb' ? ['rgb'] : [state.curvesChannel];
    const colors = { rgb: '#ffffff', red: '#ff6b6b', green: '#51cf66', blue: '#339af0' };

    channels.forEach(ch => {
        const points = state.curves[ch];
        if (!points || points.length < 2) return;
        curvesCtx.strokeStyle = colors[ch];
        curvesCtx.lineWidth = 2;
        curvesCtx.beginPath();
        const sorted = [...points].sort((a, b) => a.x - b.x);
        sorted.forEach((p, i) => {
            const px = p.x * w, py = (1 - p.y) * h;
            if (i === 0) curvesCtx.moveTo(px, py);
            else {
                const prev = sorted[i - 1];
                const cpx1 = prev.x * w + (px - prev.x * w) * 0.5;
                const cpx2 = px - (px - prev.x * w) * 0.5;
                curvesCtx.bezierCurveTo(cpx1, (1 - prev.y) * h, cpx2, py, px, py);
            }
        });
        curvesCtx.stroke();

        // Draw points
        points.forEach(p => {
            curvesCtx.fillStyle = colors[ch];
            curvesCtx.beginPath();
            curvesCtx.arc(p.x * w, (1 - p.y) * h, 5, 0, Math.PI * 2);
            curvesCtx.fill();
            curvesCtx.strokeStyle = '#fff';
            curvesCtx.lineWidth = 1;
            curvesCtx.stroke();
        });
    });
}

function getCurvesMousePos(e) {
    const rect = curvesCanvas.getBoundingClientRect();
    return {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
    };
}

curvesCanvas.addEventListener('mousedown', (e) => {
    const pos = getCurvesMousePos(e);
    const points = state.curves[state.curvesChannel];
    let closestIdx = -1, closestDist = 0.05;
    points.forEach((p, i) => {
        const dist = Math.sqrt((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2);
        if (dist < closestDist) { closestDist = dist; closestIdx = i; }
    });
    if (closestIdx >= 0) {
        state.curvesDragging = closestIdx;
    } else {
        points.push({ x: pos.x, y: pos.y });
        state.curvesDragging = points.length - 1;
    }
    renderCurves();
    renderCanvas();
});

curvesCanvas.addEventListener('mousemove', (e) => {
    if (state.curvesDragging === null) return;
    const pos = getCurvesMousePos(e);
    const points = state.curves[state.curvesChannel];
    if (state.curvesDragging === 0 || state.curvesDragging === points.length - 1) {
        points[state.curvesDragging].y = pos.y;
    } else {
        points[state.curvesDragging] = { x: pos.x, y: pos.y };
    }
    renderCurves();
    renderCanvas();
});

curvesCanvas.addEventListener('mouseup', () => { state.curvesDragging = null; });
curvesCanvas.addEventListener('mouseleave', () => { state.curvesDragging = null; });

curvesCanvas.addEventListener('dblclick', (e) => {
    const pos = getCurvesMousePos(e);
    const points = state.curves[state.curvesChannel];
    const closestIdx = points.findIndex(p => Math.sqrt((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2) < 0.05);
    if (closestIdx > 0 && closestIdx < points.length - 1) {
        points.splice(closestIdx, 1);
        renderCurves();
        renderCanvas();
    }
});

// Crop logic
function showCropOverlay() {
    if (!state.originalImage) return;
    const overlay = document.getElementById('crop-overlay');
    const box = document.getElementById('crop-box');
    overlay.style.display = 'block';

    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const margin = 20;
    state.crop = {
        x: margin, y: margin,
        w: cw - margin * 2, h: ch - margin * 2,
        ratio: 'free', dragging: null, startMouse: null, startCrop: null
    };
    updateCropBox();
}

function hideCropOverlay() {
    document.getElementById('crop-overlay').style.display = 'none';
}

function updateCropBox() {
    const box = document.getElementById('crop-box');
    const c = state.crop;
    box.style.left = c.x + 'px';
    box.style.top = c.y + 'px';
    box.style.width = c.w + 'px';
    box.style.height = c.h + 'px';
}

const cropBox = document.getElementById('crop-box');
cropBox.addEventListener('mousedown', (e) => {
    const rect = cropBox.getBoundingClientRect();
    const target = e.target;
    let dragType = 'move';
    if (target.classList.contains('crop-handle')) {
        const classes = [...target.classList];
        if (classes.includes('tl')) dragType = 'tl';
        else if (classes.includes('tr')) dragType = 'tr';
        else if (classes.includes('bl')) dragType = 'bl';
        else if (classes.includes('br')) dragType = 'br';
    }
    state.crop.dragging = dragType;
    state.crop.startMouse = { x: e.clientX, y: e.clientY };
    state.crop.startCrop = { ...state.crop };
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!state.crop.dragging) return;
    const dx = e.clientX - state.crop.startMouse.x;
    const dy = e.clientY - state.crop.startMouse.y;
    const s = state.crop.startCrop;
    const overlay = document.getElementById('crop-overlay');
    const maxW = overlay.clientWidth;
    const maxH = overlay.clientHeight;

    if (state.crop.dragging === 'move') {
        state.crop.x = Math.max(0, Math.min(maxW - s.w, s.x + dx));
        state.crop.y = Math.max(0, Math.min(maxH - s.h, s.y + dy));
    } else {
        let { x, y, w, h } = s;
        if (state.crop.dragging === 'br') { w = Math.max(20, s.w + dx); h = Math.max(20, s.h + dy); }
        else if (state.crop.dragging === 'bl') { x = s.x + dx; w = Math.max(20, s.w - dx); h = Math.max(20, s.h + dy); }
        else if (state.crop.dragging === 'tr') { y = s.y + dy; w = Math.max(20, s.w + dx); h = Math.max(20, s.h - dy); }
        else if (state.crop.dragging === 'tl') { x = s.x + dx; y = s.y + dy; w = Math.max(20, s.w - dx); h = Math.max(20, s.h - dy); }

        if (state.crop.ratio !== 'free') {
            const [rw, rh] = state.crop.ratio.split(':').map(Number);
            h = w * (rh / rw);
        }

        state.crop.x = Math.max(0, x);
        state.crop.y = Math.max(0, y);
        state.crop.w = Math.min(w, maxW - state.crop.x);
        state.crop.h = Math.min(h, maxH - state.crop.y);
    }
    updateCropBox();
});

document.addEventListener('mouseup', () => { state.crop.dragging = null; });

function applyCrop() {
    if (!state.currentImage) return;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;
    const c = state.crop;

    const sx = (c.x - (canvasRect.left - document.getElementById('canvas-area').getBoundingClientRect().left)) * scaleX;
    const sy = (c.y - (canvasRect.top - document.getElementById('canvas-area').getBoundingClientRect().top)) * scaleY;
    const sw = c.w * scaleX;
    const sh = c.h * scaleY;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.round(sw);
    tempCanvas.height = Math.round(sh);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(state.currentImage, 0, 0);

    const croppedData = tempCtx.getImageData(
        Math.max(0, Math.round(sx)),
        Math.max(0, Math.round(sy)),
        Math.min(Math.round(sw), canvas.width),
        Math.min(Math.round(sh), canvas.height)
    );

    canvas.width = croppedData.width;
    canvas.height = croppedData.height;
    state.currentImage = croppedData;
    if (maskCanvas) {
        const oldMask = maskCanvas;
        const newMask = document.createElement('canvas');
        newMask.width = croppedData.width;
        newMask.height = croppedData.height;
        const newCtx = newMask.getContext('2d');
        const cropSx = Math.max(0, Math.round(sx));
        const cropSy = Math.max(0, Math.round(sy));
        const cropSw = Math.min(Math.round(sw), oldMask.width - cropSx);
        const cropSh = Math.min(Math.round(sh), oldMask.height - cropSy);
        if (cropSw > 0 && cropSh > 0) {
            newCtx.drawImage(oldMask, cropSx, cropSy, cropSw, cropSh, 0, 0, croppedData.width, croppedData.height);
        }
        maskCanvas = newMask;
        maskCtx = newMask.getContext('2d');
    }
    saveHistory();
    renderCanvas();
    hideCropOverlay();
    fitZoom();
}

// AI Features using Hugging Face Transformers with WebGPU
let transformersLib = null;

async function loadTransformers() {
    if (transformersLib) return transformersLib;
    try {
        const module = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1/+esm');
        module.env.allowLocalModels = false;
        module.env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1/dist/';
        transformersLib = module;
        return module;
    } catch (err) {
        console.error('Failed to load transformers:', err);
        throw err;
    }
}

function showAIStatus(text, progress = 0) {
    const status = document.getElementById('ai-status');
    status.style.display = 'block';
    document.getElementById('ai-status-text').textContent = text;
    document.getElementById('ai-progress').style.width = progress + '%';
}

function hideAIStatus() {
    document.getElementById('ai-status').style.display = 'none';
}

function setAIButtonsDisabled(disabled) {
    document.querySelectorAll('.btn-ai').forEach(b => b.disabled = disabled);
}

let imglyLib = null;

async function loadImgly() {
    if (imglyLib) return imglyLib;
    try {
        const module = await import('https://esm.sh/@imgly/background-removal@1.4.5');
        imglyLib = module;
        return module;
    } catch (err) {
        console.error('Failed to load imgly:', err);
        throw err;
    }
}

async function aiRemoveBackground() {
    if (!state.currentImage) return;
    setAIButtonsDisabled(true);
    showAIStatus('Loading background removal...', 10);

    try {
        const { removeBackground } = await loadImgly();
        showAIStatus('Preparing image...', 30);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = state.currentImage.width;
        tempCanvas.height = state.currentImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(state.currentImage, 0, 0);

        const blob = await new Promise(r => tempCanvas.toBlob(r, 'image/png'));

        showAIStatus('Removing background...', 50);

        const resultBlob = await removeBackground(blob, {
            progress: (key, current, total) => {
                if (total > 0) {
                    showAIStatus('Processing: ' + key, 50 + Math.round((current / total) * 40));
                }
            }
        });

        showAIStatus('Applying result...', 95);

        const resultUrl = URL.createObjectURL(resultBlob);
        const resultImg = new Image();
        await new Promise((resolve, reject) => {
            resultImg.onload = resolve;
            resultImg.onerror = reject;
            resultImg.src = resultUrl;
        });
        URL.revokeObjectURL(resultUrl);

        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = resultImg.width;
        resultCanvas.height = resultImg.height;
        const resultCtx = resultCanvas.getContext('2d');
        resultCtx.drawImage(resultImg, 0, 0);

        state.currentImage = resultCtx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
        saveHistory();
        renderCanvas();
        showAIStatus('Background removed!', 100);
        setTimeout(hideAIStatus, 2000);
    } catch (err) {
        console.error('AI remove background failed:', err);
        showAIStatus('Error: ' + err.message, 0);
        setTimeout(hideAIStatus, 3000);
    } finally {
        setAIButtonsDisabled(false);
    }
}

async function aiUpscale() {
    if (!state.currentImage) return;
    setAIButtonsDisabled(true);
    showAIStatus('Upscaling 2x...', 20);

    try {
        const src = state.currentImage;
        const srcWidth = src.width;
        const srcHeight = src.height;
        const newWidth = srcWidth * 2;
        const newHeight = srcHeight * 2;

        showAIStatus('Processing pixels...', 50);

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = srcWidth;
        srcCanvas.height = srcHeight;
        const srcCtx = srcCanvas.getContext('2d');
        srcCtx.putImageData(src, 0, 0);
        const srcData = srcCtx.getImageData(0, 0, srcWidth, srcHeight);

        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = newWidth;
        dstCanvas.height = newHeight;
        const dstCtx = dstCanvas.getContext('2d');

        dstCtx.imageSmoothingEnabled = true;
        dstCtx.imageSmoothingQuality = 'high';
        dstCtx.drawImage(srcCanvas, 0, 0, newWidth, newHeight);

        showAIStatus('Sharpening details...', 80);

        const result = dstCtx.getImageData(0, 0, newWidth, newHeight);
        applySharpen(result, 0.4);

        canvas.width = newWidth;
        canvas.height = newHeight;
        state.currentImage = result;
        saveHistory();
        renderCanvas();
        fitZoom();
        showAIStatus('Upscaled 2x!', 100);
        setTimeout(hideAIStatus, 2000);
    } catch (err) {
        console.error('AI upscale failed:', err);
        showAIStatus('Error: ' + err.message, 0);
        setTimeout(hideAIStatus, 3000);
    } finally {
        setAIButtonsDisabled(false);
    }
}

async function aiEnhance() {
    if (!state.currentImage) return;
    setAIButtonsDisabled(true);
    showAIStatus('Running AI enhancement...', 10);

    try {
        showAIStatus('Analyzing image...', 30);

        const src = state.currentImage;
        const result = cloneImageData(src);
        const d = result.data;

        const canvasWidth = src.width;
        const canvasHeight = src.height;

        const histogram = new Array(256).fill(0);
        for (let i = 0; i < d.length; i += 4) {
            const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
            histogram[lum]++;
        }

        const totalPixels = canvasWidth * canvasHeight;
        const clipLimit = 2.0;
        const avgBins = totalPixels / 256;
        let excess = 0;
        for (let i = 0; i < 256; i++) {
            if (histogram[i] > avgBins * clipLimit) {
                excess += histogram[i] - avgBins * clipLimit;
                histogram[i] = Math.round(avgBins * clipLimit);
            }
        }

        const bonus = Math.floor(excess / 256);
        for (let i = 0; i < 256; i++) {
            histogram[i] += bonus;
        }

        const cdf = new Array(256);
        cdf[0] = histogram[0];
        for (let i = 1; i < 256; i++) {
            cdf[i] = cdf[i - 1] + histogram[i];
        }
        const cdfMin = cdf.find(v => v > 0);

        showAIStatus('Enhancing contrast...', 50);

        for (let i = 0; i < d.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                const val = d[i + c];
                const newVal = Math.min(255, Math.max(0, Math.round((cdf[val] - cdfMin) / (totalPixels - cdfMin) * 255)));
                d[i + c] = Math.min(255, Math.max(0, val + (newVal - val) * 0.6));
            }
        }

        showAIStatus('Sharpening details...', 70);
        if (typeof applySharpen === 'function') {
            applySharpen(result, 0.3);
        }

        showAIStatus('Denoising details...', 85);
        for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
            if (sat < 15 && lum > 20 && lum < 235) {
                const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
                d[i] = Math.min(255, Math.max(0, d[i] + (avg - d[i]) * 0.1));
                d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + (avg - d[i + 1]) * 0.1));
                d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + (avg - d[i + 2]) * 0.1));
            }
        }

        state.currentImage = result;
        if (typeof applyMaskToResult === 'function' && hasActiveMask()) {
            state.currentImage = applyMaskToResult(result);
        }
        if (typeof saveHistory === 'function') saveHistory();
        if (typeof renderCanvas === 'function') renderCanvas();
        if (state.activeTool === 'local') renderMaskOverlay();

        showAIStatus('Image Enhanced!', 100);
        setTimeout(hideAIStatus, 2000);

    } catch (err) {
        console.error('AI enhance failed:', err);
        showAIStatus('Error: ' + err.message, 0);
        setTimeout(hideAIStatus, 3000);
    } finally {
        setAIButtonsDisabled(false);
    }
}

async function aiDenoise() {
    if (!state.currentImage) return;
    setAIButtonsDisabled(true);
    showAIStatus('Running AI denoise...', 10);

    try {
        showAIStatus('Analyzing noise...', 30);

        const src = state.currentImage;
        const result = cloneImageData(src);
        const d = result.data;
        const canvasWidth = src.width;
        const canvasHeight = src.height;

        const copy = new Uint8ClampedArray(d);
        const radius = 2;
        const sigmaSpace = 3.0;
        const sigmaColor = 25.0;

        showAIStatus('Applying denoise filter...', 60);

        for (let y = radius; y < canvasHeight - radius; y++) {
            for (let x = radius; x < canvasWidth - radius; x++) {
                for (let c = 0; c < 3; c++) {
                    let sum = 0, weightSum = 0;
                    const centerVal = copy[(y * canvasWidth + x) * 4 + c];
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const neighborVal = copy[((y + dy) * canvasWidth + (x + dx)) * 4 + c];
                            const spatialDist = Math.sqrt(dx * dx + dy * dy);
                            const colorDist = Math.abs(centerVal - neighborVal);
                            const spatialW = Math.exp(-(spatialDist * spatialDist) / (2 * sigmaSpace * sigmaSpace));
                            const colorW = Math.exp(-(colorDist * colorDist) / (2 * sigmaColor * sigmaColor));
                            const weight = spatialW * colorW;
                            sum += neighborVal * weight;
                            weightSum += weight;
                        }
                    }
                    result.data[(y * canvasWidth + x) * 4 + c] = clamp(Math.round(sum / weightSum));
                }
            }
        }

        showAIStatus('Finalizing...', 90);

        state.currentImage = result;
        if (typeof applyMaskToResult === 'function' && hasActiveMask()) {
            state.currentImage = applyMaskToResult(result);
        }
        saveHistory();
        renderCanvas();
        if (state.activeTool === 'local') renderMaskOverlay();
        showAIStatus('Denoise complete!', 100);
        setTimeout(hideAIStatus, 2000);
    } catch (err) {
        console.error('AI denoise failed:', err);
        showAIStatus('Error: ' + err.message, 0);
        setTimeout(hideAIStatus, 3000);
    } finally {
        setAIButtonsDisabled(false);
    }
}

// Custom Model - Bring Your Own Model
let customModel = {
    session: null,
    fileName: null,
    inputName: null,
    outputName: null
};

async function loadCustomModelFile(file) {
    if (!file) return;
    setAIButtonsDisabled(true);
    showAIStatus('Loading model...', 10);

    try {
        showAIStatus('Reading model file...', 30);

        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        showAIStatus('Initializing ONNX runtime...', 50);

        const ort = await import('https://esm.sh/onnxruntime-web@1.17.1');
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/';

        showAIStatus('Compiling model...', 70);

        const session = await ort.InferenceSession.create(bytes, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });

        customModel.session = session;
        customModel.fileName = file.name;
        customModel.inputName = session.inputNames[0];
        customModel.outputName = session.outputNames[0];

        document.getElementById('custom-model-name').textContent = file.name;
        document.getElementById('custom-model-info').style.display = 'flex';
        document.getElementById('custom-mode-group').style.display = 'block';
        document.getElementById('custom-intensity-group').style.display = 'block';
        document.getElementById('btn-apply-custom').style.display = 'block';
        document.getElementById('btn-apply-custom').disabled = false;

        showAIStatus('Model loaded!', 100);
        setTimeout(hideAIStatus, 1500);
    } catch (err) {
        console.error('Failed to load model:', err);
        showAIStatus('Error: ' + err.message, 0);
        setTimeout(hideAIStatus, 3000);
        customModel = { session: null, fileName: null, inputName: null, outputName: null };
    } finally {
        setAIButtonsDisabled(false);
    }
}

function clearCustomModel() {
    customModel = { session: null, fileName: null, inputName: null, outputName: null };
    document.getElementById('custom-model-info').style.display = 'none';
    document.getElementById('custom-mode-group').style.display = 'none';
    document.getElementById('custom-intensity-group').style.display = 'none';
    document.getElementById('btn-apply-custom').style.display = 'none';
    document.getElementById('btn-apply-custom').disabled = true;
    document.getElementById('custom-model-input').value = '';
}

function imageDataToTensor(imageData, targetSize) {
    const w = targetSize || imageData.width;
    const h = targetSize || imageData.height;
    const float32Data = new Float32Array(1 * 3 * h * w);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = imageData.width;
    srcCanvas.height = imageData.height;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.putImageData(imageData, 0, 0);

    tempCtx.drawImage(srcCanvas, 0, 0, w, h);
    const resizedData = tempCtx.getImageData(0, 0, w, h).data;

    for (let i = 0, j = 0; i < resizedData.length; i += 4, j += 3) {
        float32Data[j] = (resizedData[i] / 255 - mean[0]) / std[0];
        float32Data[j + 1] = (resizedData[i + 1] / 255 - mean[1]) / std[1];
        float32Data[j + 2] = (resizedData[i + 2] / 255 - mean[2]) / std[2];
    }

    return new ort.Tensor('float32', float32Data, [1, 3, h, w]);
}

function tensorToImageData(tensor, origWidth, origHeight) {
    const data = tensor.data;
    const dims = tensor.dims;
    let channels, modelH, modelW;

    if (dims.length === 4) {
        [, channels, modelH, modelW] = dims;
    } else if (dims.length === 3) {
        [channels, modelH, modelW] = dims;
    } else {
        throw new Error('Unexpected output shape: ' + dims);
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = modelW;
    tempCanvas.height = modelH;
    const tempCtx = tempCanvas.getContext('2d');
    const tempData = tempCtx.createImageData(modelW, modelH);

    const isFloat = tensor.type === 'float32';
    let min = Infinity, max = -Infinity;
    if (isFloat) {
        for (let i = 0; i < data.length; i++) {
            if (data[i] < min) min = data[i];
            if (data[i] > max) max = data[i];
        }
    }

    if (channels === 1) {
        for (let i = 0; i < modelW * modelH; i++) {
            let v = isFloat ? (data[i] - min) / (max - min || 1) * 255 : data[i];
            v = clamp(Math.round(v));
            const idx = i * 4;
            tempData.data[idx] = v;
            tempData.data[idx + 1] = v;
            tempData.data[idx + 2] = v;
            tempData.data[idx + 3] = 255;
        }
    } else {
        const planeSize = modelW * modelH;
        for (let i = 0; i < modelW * modelH; i++) {
            for (let c = 0; c < 3; c++) {
                let v = isFloat ? (data[c * planeSize + i] - min) / (max - min || 1) * 255 : data[c * planeSize + i];
                tempData.data[i * 4 + c] = clamp(Math.round(v));
            }
            tempData.data[i * 4 + 3] = 255;
        }
    }
    tempCtx.putImageData(tempData, 0, 0);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = origWidth;
    outCanvas.height = origHeight;
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(tempCanvas, 0, 0, origWidth, origHeight);

    return outCtx.getImageData(0, 0, origWidth, origHeight);
}

async function applyCustomModel() {
    if (!customModel.session || !state.currentImage) return;

    const ort = await import('https://esm.sh/onnxruntime-web@1.17.1');
    setAIButtonsDisabled(true);
    showAIStatus('Running custom model...', 10);

    try {
        const src = state.currentImage;
        const inputDims = customModel.session.inputNames;
        const inputMeta = customModel.session;

        const targetSize = Math.min(src.width, src.height, 512);
        showAIStatus('Preprocessing image...', 30);

        const tensor = imageDataToTensor(src, targetSize);
        const feeds = {};
        feeds[customModel.inputName] = tensor;

        showAIStatus('Running inference...', 60);

        const outputMap = await customModel.session.run(feeds);
        const outputTensor = outputMap[customModel.outputName];

        showAIStatus('Postprocessing...', 85);

        const modelOutput = tensorToImageData(outputTensor, src.width, src.height);

        const mode = document.getElementById('custom-mode-select').value;
        const intensity = parseInt(document.getElementById('custom-intensity').value) / 100;

        const result = cloneImageData(src);

        if (mode === 'replace') {
            for (let i = 0; i < result.data.length; i += 4) {
                result.data[i] = clamp(src.data[i] + (modelOutput.data[i] - src.data[i]) * intensity);
                result.data[i + 1] = clamp(src.data[i + 1] + (modelOutput.data[i + 1] - src.data[i + 1]) * intensity);
                result.data[i + 2] = clamp(src.data[i + 2] + (modelOutput.data[i + 2] - src.data[i + 2]) * intensity);
                result.data[i + 3] = 255;
            }
        } else if (mode === 'mask') {
            for (let i = 0; i < result.data.length; i += 4) {
                const maskVal = (modelOutput.data[i] + modelOutput.data[i + 1] + modelOutput.data[i + 2]) / 3 / 255;
                result.data[i + 3] = clamp(Math.round(maskVal * 255 * intensity));
            }
        } else if (mode === 'multiply') {
            for (let i = 0; i < result.data.length; i += 4) {
                const blend = (a, b) => clamp(Math.round((a / 255 * b / 255) * 255 * intensity + a * (1 - intensity)));
                result.data[i] = blend(src.data[i], modelOutput.data[i]);
                result.data[i + 1] = blend(src.data[i + 1], modelOutput.data[i + 1]);
                result.data[i + 2] = blend(src.data[i + 2], modelOutput.data[i + 2]);
            }
        } else if (mode === 'screen') {
            for (let i = 0; i < result.data.length; i += 4) {
                const blend = (a, b) => {
                    const sa = 1 - a / 255;
                    const sb = 1 - b / 255;
                    return clamp(Math.round((1 - sa * sb) * 255 * intensity + a * (1 - intensity)));
                };
                result.data[i] = blend(src.data[i], modelOutput.data[i]);
                result.data[i + 1] = blend(src.data[i + 1], modelOutput.data[i + 1]);
                result.data[i + 2] = blend(src.data[i + 2], modelOutput.data[i + 2]);
            }
        } else {
            for (let i = 0; i < result.data.length; i += 4) {
                result.data[i] = clamp(src.data[i] + (modelOutput.data[i] - src.data[i]) * intensity);
                result.data[i + 1] = clamp(src.data[i + 1] + (modelOutput.data[i + 1] - src.data[i + 1]) * intensity);
                result.data[i + 2] = clamp(src.data[i + 2] + (modelOutput.data[i + 2] - src.data[i + 2]) * intensity);
            }
        }

        state.currentImage = result;
        saveHistory();
        renderCanvas();
        showAIStatus('Custom model applied!', 100);
        setTimeout(hideAIStatus, 2000);
    } catch (err) {
        console.error('Custom model failed:', err);
        showAIStatus('Error: ' + err.message, 0);
        setTimeout(hideAIStatus, 3000);
    } finally {
        setAIButtonsDisabled(false);
    }
}

// Local Mask - paint a region to apply edits to
let lastMaskPoint = null;

function initLocalMask() {
    if (!state.currentImage) return;
    if (!maskCanvas || maskCanvas.width !== state.currentImage.width || maskCanvas.height !== state.currentImage.height) {
        maskCanvas = document.createElement('canvas');
        maskCanvas.width = state.currentImage.width;
        maskCanvas.height = state.currentImage.height;
        maskCtx = maskCanvas.getContext('2d');
    }
}

function getMaskOverlay() {
    let overlay = document.getElementById('mask-overlay');
    if (!overlay) {
        overlay = document.createElement('canvas');
        overlay.id = 'mask-overlay';
        overlay.className = 'mask-overlay';
        document.getElementById('canvas-area').appendChild(overlay);
    }
    return overlay;
}

function renderMaskOverlay() {
    if (!maskCanvas || !state.currentImage) return;
    const overlay = getMaskOverlay();
    overlay.width = canvas.clientWidth;
    overlay.height = canvas.clientHeight;
    const octx = overlay.getContext('2d');
    octx.clearRect(0, 0, overlay.width, overlay.height);

    if (!state.localMask) return;

    const scaleX = canvas.clientWidth / canvas.width;
    const scaleY = canvas.clientHeight / canvas.height;

    const display = document.createElement('canvas');
    display.width = canvas.clientWidth;
    display.height = canvas.clientHeight;
    const dctx = display.getContext('2d');
    dctx.drawImage(maskCanvas, 0, 0, display.width, display.height);

    const data = dctx.getImageData(0, 0, display.width, display.height);
    for (let i = 0; i < data.data.length; i += 4) {
        const v = data.data[i + 3];
        if (v > 0) {
            data.data[i] = 233;
            data.data[i + 1] = 69;
            data.data[i + 2] = 96;
            data.data[i + 3] = Math.round(v * 0.4);
        }
    }
    dctx.putImageData(data, 0, 0);
    octx.drawImage(display, 0, 0);
}

function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
}

function paintMaskAt(x, y) {
    if (!maskCtx) return;
    const size = state.localBrush.size;
    const hardness = state.localBrush.hardness / 100;
    const mode = state.localBrush.mode;

    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const radius = size * scale / 2;

    const gradient = maskCtx.createRadialGradient(x, y, radius * hardness, x, y, radius);

    if (mode === 'paint') {
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        maskCtx.globalCompositeOperation = 'source-over';
    } else {
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        maskCtx.globalCompositeOperation = 'destination-out';
    }

    maskCtx.fillStyle = gradient;
    maskCtx.beginPath();
    maskCtx.arc(x, y, radius, 0, Math.PI * 2);
    maskCtx.fill();

    state.localMask = true;
    renderMaskOverlay();
}

function clearLocalMask() {
    if (!maskCtx) return;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    state.localMask = false;
    renderMaskOverlay();
}

function applyMaskToResult(result) {
    if (!state.localMask || !maskCanvas) return result;
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const src = state.currentImage;
    for (let i = 0; i < result.data.length; i += 4) {
        const alpha = maskData.data[i + 3] / 255;
        result.data[i] = clamp(src.data[i] + (result.data[i] - src.data[i]) * alpha);
        result.data[i + 1] = clamp(src.data[i + 1] + (result.data[i + 1] - src.data[i + 1]) * alpha);
        result.data[i + 2] = clamp(src.data[i + 2] + (result.data[i + 2] - src.data[i + 2]) * alpha);
        result.data[i + 3] = src.data[i + 3];
    }
    return result;
}

function hasActiveMask() {
    return state.localMask === true;
}

// Export
function exportImage() {
    if (!state.currentImage) return;
    renderCanvas();
    const link = document.createElement('a');
    link.download = 'edited-photo.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// Event listeners
document.getElementById('btn-open').addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
});
document.getElementById('btn-export').addEventListener('click', exportImage);
document.getElementById('btn-open-video').addEventListener('click', () => document.getElementById('video-input').click());
document.getElementById('video-input').addEventListener('change', (e) => {
    if (e.target.files[0]) loadVideo(e.target.files[0]);
    e.target.value = '';
});

// Drag and drop
const dropZone = document.getElementById('drop-zone');
const canvasArea = document.getElementById('canvas-area');
canvasArea.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
canvasArea.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.type.startsWith('image/')) loadImage(file);
    else if (file.type.startsWith('video/')) loadVideo(file);
});

// Tool switching
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeTool = btn.dataset.tool;

        document.querySelectorAll('.panel-section').forEach(p => p.style.display = 'none');
        document.getElementById(`panel-${state.activeTool}`).style.display = 'block';

        if (state.activeTool === 'crop' && state.currentImage) showCropOverlay();
        else hideCropOverlay();

        if (state.activeTool === 'curves') renderCurves();

        const overlay = document.getElementById('mask-overlay');
        if (state.activeTool === 'local') {
            canvas.classList.add('local-mode');
            if (state.currentImage) {
                initLocalMask();
                renderMaskOverlay();
            }
        } else {
            canvas.classList.remove('local-mode');
            if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
        }

        if (state.activeTool === 'draw') {
            canvas.classList.add('draw-mode');
            if (state.currentImage) {
                initDrawCanvas();
                renderCanvas();
            }
        } else {
            canvas.classList.remove('draw-mode');
        }
    });
});

// Adjustment sliders
Object.keys(state.adjustments).forEach(key => {
    const slider = document.getElementById(`adj-${key}`);
    if (!slider) return;
    slider.addEventListener('input', () => {
        state.adjustments[key] = parseInt(slider.value);
        document.getElementById(`val-${key}`).textContent = slider.value;
        if (videoState.el && videoState.el.readyState >= 2) {
            ctx.drawImage(videoState.el, 0, 0, canvas.width, canvas.height);
            if (videoState.applyColor) {
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
                applyAdjustments(data);
                applyColorCorrection(data);
                ctx.putImageData(data, 0, 0);
            }
        } else {
            renderCanvas();
        }
    });
    slider.addEventListener('change', () => {
        saveHistory();
    });
});

document.getElementById('btn-reset-adj').addEventListener('click', () => {
    Object.keys(state.adjustments).forEach(key => {
        state.adjustments[key] = 0;
        const el = document.getElementById(`adj-${key}`);
        if (el) { el.value = 0; document.getElementById(`val-${key}`).textContent = '0'; }
    });
    renderCanvas();
    saveHistory();
});

// Filters
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeFilter = btn.dataset.filter;
        renderCanvas();
        saveHistory();
    });
});

document.getElementById('filter-intensity').addEventListener('input', (e) => {
    state.filterIntensity = parseInt(e.target.value);
    document.getElementById('val-filter-intensity').textContent = e.target.value;
    renderCanvas();
});

// Curves channel
document.querySelectorAll('.channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.channel-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.curvesChannel = btn.dataset.channel;
        renderCurves();
    });
});

document.getElementById('btn-reset-curves').addEventListener('click', () => {
    Object.keys(state.curves).forEach(ch => {
        state.curves[ch] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    });
    renderCurves();
    renderCanvas();
    saveHistory();
});

// Crop
document.querySelectorAll('.crop-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.crop-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.crop.ratio = btn.dataset.ratio;
        if (state.crop.ratio !== 'free') {
            const [rw, rh] = state.crop.ratio.split(':').map(Number);
            state.crop.h = state.crop.w * (rh / rw);
            updateCropBox();
        }
    });
});

document.getElementById('btn-apply-crop').addEventListener('click', applyCrop);
document.getElementById('btn-cancel-crop').addEventListener('click', hideCropOverlay);

// Rotate & Flip
function rotateImage90(direction) {
    if (!state.currentImage) return;
    const src = state.currentImage;
    const w = src.width, h = src.height;
    const newW = h, newH = w;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    srcCanvas.getContext('2d').putImageData(src, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = newW;
    dstCanvas.height = newH;
    const dstCtx = dstCanvas.getContext('2d');

    dstCtx.translate(newW / 2, newH / 2);
    dstCtx.rotate(direction * Math.PI / 2);
    dstCtx.drawImage(srcCanvas, -w / 2, -h / 2);

    canvas.width = newW;
    canvas.height = newH;
    state.currentImage = dstCtx.getImageData(0, 0, newW, newH);

    if (maskCanvas) {
        const oldMask = maskCanvas;
        maskCanvas = document.createElement('canvas');
        maskCanvas.width = newW;
        maskCanvas.height = newH;
        maskCtx = maskCanvas.getContext('2d');
        const mCtx = maskCanvas.getContext('2d');
        mCtx.translate(newW / 2, newH / 2);
        mCtx.rotate(direction * Math.PI / 2);
        mCtx.drawImage(oldMask, -w / 2, -h / 2);
    }

    saveHistory();
    renderCanvas();
    fitZoom();
    if (state.activeTool === 'local') renderMaskOverlay();
}

function flipImage(horizontal) {
    if (!state.currentImage) return;
    const src = state.currentImage;
    const w = src.width, h = src.height;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    srcCanvas.getContext('2d').putImageData(src, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = w;
    dstCanvas.height = h;
    const dstCtx = dstCanvas.getContext('2d');

    if (horizontal) {
        dstCtx.translate(w, 0);
        dstCtx.scale(-1, 1);
    } else {
        dstCtx.translate(0, h);
        dstCtx.scale(1, -1);
    }
    dstCtx.drawImage(srcCanvas, 0, 0);

    state.currentImage = dstCtx.getImageData(0, 0, w, h);

    if (maskCanvas) {
        const oldMask = maskCanvas;
        maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        maskCtx = maskCanvas.getContext('2d');
        const mCtx = maskCtx;
        if (horizontal) {
            mCtx.translate(w, 0);
            mCtx.scale(-1, 1);
        } else {
            mCtx.translate(0, h);
            mCtx.scale(1, -1);
        }
        mCtx.drawImage(oldMask, 0, 0);
    }

    saveHistory();
    renderCanvas();
    if (state.activeTool === 'local') renderMaskOverlay();
}

function rotateImageFine(angleDegrees) {
    if (!state.currentImage) return;
    const src = state.currentImage;
    const w = src.width, h = src.height;
    const angleRad = angleDegrees * Math.PI / 180;
    const cos = Math.abs(Math.cos(angleRad));
    const sin = Math.abs(Math.sin(angleRad));
    const newW = Math.round(w * cos + h * sin);
    const newH = Math.round(w * sin + h * cos);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    srcCanvas.getContext('2d').putImageData(src, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = newW;
    dstCanvas.height = newH;
    const dstCtx = dstCanvas.getContext('2d');

    dstCtx.fillStyle = '#000';
    dstCtx.fillRect(0, 0, newW, newH);
    dstCtx.translate(newW / 2, newH / 2);
    dstCtx.rotate(angleRad);
    dstCtx.drawImage(srcCanvas, -w / 2, -h / 2);

    canvas.width = newW;
    canvas.height = newH;
    state.currentImage = dstCtx.getImageData(0, 0, newW, newH);

    if (maskCanvas) {
        const oldMask = maskCanvas;
        maskCanvas = document.createElement('canvas');
        maskCanvas.width = newW;
        maskCanvas.height = newH;
        maskCtx = maskCanvas.getContext('2d');
        maskCtx.clearRect(0, 0, newW, newH);
        maskCtx.translate(newW / 2, newH / 2);
        maskCtx.rotate(angleRad);
        maskCtx.drawImage(oldMask, -w / 2, -h / 2);
    }

    saveHistory();
    renderCanvas();
    fitZoom();
    if (state.activeTool === 'local') renderMaskOverlay();
}

document.getElementById('btn-rotate-left').addEventListener('click', () => {
    rotateImage90(-1);
    const slider = document.getElementById('rotate-angle');
    slider.value = 0;
    document.getElementById('val-rotate-angle').textContent = '0';
});
document.getElementById('btn-rotate-right').addEventListener('click', () => {
    rotateImage90(1);
    const slider = document.getElementById('rotate-angle');
    slider.value = 0;
    document.getElementById('val-rotate-angle').textContent = '0';
});
document.getElementById('btn-flip-h').addEventListener('click', () => flipImage(true));
document.getElementById('btn-flip-v').addEventListener('click', () => flipImage(false));
document.getElementById('rotate-angle').addEventListener('input', (e) => {
    document.getElementById('val-rotate-angle').textContent = e.target.value;
});
document.getElementById('btn-apply-rotate').addEventListener('click', () => {
    const angle = parseInt(document.getElementById('rotate-angle').value);
    if (angle === 0) return;
    rotateImageFine(angle);
    const slider = document.getElementById('rotate-angle');
    slider.value = 0;
    document.getElementById('val-rotate-angle').textContent = '0';
});

// Color Correction
function buildHslGrid() {
    const grid = document.getElementById('hsl-grid');
    grid.innerHTML = '';
    const colors = Object.keys(state.color.hsl);

    const headers = ['', 'Hue', 'Sat', 'Lum'];
    headers.forEach(h => {
        const div = document.createElement('div');
        div.className = 'hsl-header';
        div.textContent = h;
        grid.appendChild(div);
    });

    colors.forEach(color => {
        const label = document.createElement('div');
        label.className = 'hsl-color-label';
        label.dataset.color = color;
        label.textContent = color;
        grid.appendChild(label);

        ['h', 's', 'l'].forEach(prop => {
            const input = document.createElement('input');
            input.type = 'range';
            input.id = `hsl-${color}-${prop}`;
            input.min = prop === 'h' ? -180 : -100;
            input.max = 100;
            input.value = 0;
            input.addEventListener('input', (e) => {
                const val = prop === 'h' ? parseInt(e.target.value) : parseInt(e.target.value);
                state.color.hsl[color][prop] = val;
                renderCanvas();
            });
            input.addEventListener('change', () => {
                saveHistory();
            });
            grid.appendChild(input);
        });
    });
}

function resetColorCorrection() {
    state.color.tint = 0;
    state.color.cbShadows = { cr: 0, mg: 0, yb: 0 };
    state.color.cbMidtones = { cr: 0, mg: 0, yb: 0 };
    state.color.cbHighlights = { cr: 0, mg: 0, yb: 0 };
    for (const k in state.color.hsl) {
        state.color.hsl[k] = { h: 0, s: 0, l: 0 };
    }

    document.getElementById('adj-tint').value = 0;
    document.getElementById('val-tint').textContent = '0';

    ['shadows', 'midtones', 'highlights'].forEach(group => {
        ['cr', 'mg', 'yb'].forEach(axis => {
            const slider = document.getElementById(`cb-${group}-${axis}`);
            slider.value = 0;
            document.getElementById(`val-cb-${group}-${axis}`).textContent = '0';
        });
    });

    for (const color in state.color.hsl) {
        ['h', 's', 'l'].forEach(prop => {
            const slider = document.getElementById(`hsl-${color}-${prop}`);
            if (slider) slider.value = 0;
        });
    }

    renderCanvas();
    saveHistory();
}

document.getElementById('adj-tint').addEventListener('input', (e) => {
    state.color.tint = parseInt(e.target.value);
    document.getElementById('val-tint').textContent = e.target.value;
    renderCanvas();
});
document.getElementById('adj-tint').addEventListener('change', () => saveHistory());

['shadows', 'midtones', 'highlights'].forEach(group => {
    ['cr', 'mg', 'yb'].forEach(axis => {
        const slider = document.getElementById(`cb-${group}-${axis}`);
        const key = group === 'shadows' ? 'cbShadows' : group === 'midtones' ? 'cbMidtones' : 'cbHighlights';
        slider.addEventListener('input', (e) => {
            state.color[key][axis] = parseInt(e.target.value);
            document.getElementById(`val-cb-${group}-${axis}`).textContent = e.target.value;
            renderCanvas();
        });
        slider.addEventListener('change', () => saveHistory());
    });
});

document.getElementById('btn-reset-color').addEventListener('click', resetColorCorrection);

// Lens Correction
const lensControls = [
    { id: 'lens-distortion', key: 'distortion', valId: 'val-lens-distortion' },
    { id: 'lens-distortion2', key: 'distortion2', valId: 'val-lens-distortion2' },
    { id: 'lens-ca', key: 'ca', valId: 'val-lens-ca' },
    { id: 'lens-vignette', key: 'vignette', valId: 'val-lens-vignette' },
    { id: 'persp-h', key: 'perspH', valId: 'val-persp-h' },
    { id: 'persp-v', key: 'perspV', valId: 'val-persp-v' },
    { id: 'lens-rotation', key: 'rotation', valId: 'val-lens-rotation' },
    { id: 'lens-scale', key: 'scale', valId: 'val-lens-scale' }
];

lensControls.forEach(ctrl => {
    const slider = document.getElementById(ctrl.id);
    slider.addEventListener('input', (e) => {
        state.lens[ctrl.key] = parseFloat(e.target.value);
        document.getElementById(ctrl.valId).textContent = e.target.value;
    });
});

document.getElementById('btn-apply-lens').addEventListener('click', () => {
    if (!state.currentImage) return;
    const lens = state.lens;
    const hasLens = lens.distortion !== 0 || lens.distortion2 !== 0 || lens.ca !== 0 ||
                    lens.perspH !== 0 || lens.perspV !== 0 || lens.rotation !== 0 || lens.scale !== 100 ||
                    lens.vignette !== 0;
    if (!hasLens) return;

    saveHistory();
    const result = applyLensCorrection(state.currentImage, lens);
    state.currentImage = result;
    canvas.width = result.width;
    canvas.height = result.height;
    state.lens = { distortion: 0, distortion2: 0, ca: 0, vignette: 0, perspH: 0, perspV: 0, rotation: 0, scale: 100 };
    lensControls.forEach(ctrl => {
        document.getElementById(ctrl.id).value = ctrl.id === 'lens-scale' ? 100 : 0;
        document.getElementById(ctrl.valId).textContent = ctrl.id === 'lens-scale' ? '100' : '0';
    });
    renderCanvas();
    fitZoom();
    if (state.activeTool === 'local') renderMaskOverlay();
});

document.getElementById('btn-reset-lens').addEventListener('click', () => {
    state.lens = { distortion: 0, distortion2: 0, ca: 0, vignette: 0, perspH: 0, perspV: 0, rotation: 0, scale: 100 };
    lensControls.forEach(ctrl => {
        document.getElementById(ctrl.id).value = ctrl.id === 'lens-scale' ? 100 : 0;
        document.getElementById(ctrl.valId).textContent = ctrl.id === 'lens-scale' ? '100' : '0';
    });
});

document.querySelectorAll('[data-lens-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
        const preset = btn.dataset.lensPreset;
        const presetMap = {
            wideangle: { distortion: -40, distortion2: 30, ca: 20, vignette: -20, perspH: 0, perspV: 0, rotation: 0, scale: 100 },
            fisheye: { distortion: 80, distortion2: -50, ca: 50, vignette: 20, perspH: 0, perspV: 0, rotation: 0, scale: 100 },
            portrait: { distortion: -15, distortion2: 5, ca: 5, vignette: -10, perspH: 0, perspV: 0, rotation: 0, scale: 100 },
            building: { distortion: 10, distortion2: 0, ca: 0, vignette: 0, perspH: -30, perspV: 0, rotation: 0, scale: 100 }
        };
        const p = presetMap[preset];
        if (p) {
            state.lens = { ...p };
            lensControls.forEach(ctrl => {
                const val = state.lens[ctrl.key];
                document.getElementById(ctrl.id).value = val;
                document.getElementById(ctrl.valId).textContent = val;
            });
        }
    });
});

// Layers
document.getElementById('btn-layer-add').addEventListener('click', () => {
    if (!state.currentImage) return;
    const w = state.currentImage.width;
    const h = state.currentImage.height;
    const data = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
    addLayer(data, `Layer ${state.layers.length + 1}`);
});

document.getElementById('btn-layer-duplicate').addEventListener('click', () => {
    if (state.activeLayerId) duplicateLayer(state.activeLayerId);
});

document.getElementById('btn-layer-delete').addEventListener('click', () => {
    if (state.activeLayerId) deleteLayer(state.activeLayerId);
});

document.getElementById('btn-layer-up').addEventListener('click', () => {
    if (state.activeLayerId) moveLayer(state.activeLayerId, 'up');
});

document.getElementById('btn-layer-down').addEventListener('click', () => {
    if (state.activeLayerId) moveLayer(state.activeLayerId, 'down');
});

document.getElementById('btn-layer-merge').addEventListener('click', () => {
    if (state.activeLayerId) mergeLayerDown(state.activeLayerId);
});

document.getElementById('btn-flatten').addEventListener('click', () => {
    if (confirm('Flatten all layers? This cannot be undone except via Undo.')) {
        flattenImage();
    }
});

// Batch Processing
let batchPreset = null;
let batchFiles = [];
let batchResults = [];

function captureBatchPreset() {
    syncActiveLayerFromCurrent();
    batchPreset = {
        adjustments: JSON.parse(JSON.stringify(state.adjustments)),
        activeFilter: state.activeFilter,
        filterIntensity: state.filterIntensity,
        curves: JSON.parse(JSON.stringify(state.curves)),
        color: JSON.parse(JSON.stringify(state.color)),
        lens: JSON.parse(JSON.stringify(state.lens))
    };
    const info = document.getElementById('batch-preset-info');
    info.classList.add('active');
    const filterName = batchPreset.activeFilter !== 'none' ? ` + ${batchPreset.activeFilter}` : '';
    info.textContent = `Preset captured (${Object.keys(batchPreset.adjustments).filter(k => batchPreset.adjustments[k] !== 0).length} adjustments${filterName})`;
}

function applyPresetToImageData(imageData, preset) {
    const w = imageData.width, h = imageData.height;
    const src = imageData;

    let result = cloneImageData(src);
    const oldAdj = state.adjustments;
    const oldFilter = state.activeFilter;
    const oldFilterInt = state.filterIntensity;
    const oldCurves = state.curves;
    const oldColor = state.color;
    const oldLens = state.lens;

    state.adjustments = JSON.parse(JSON.stringify(preset.adjustments));
    state.activeFilter = preset.activeFilter;
    state.filterIntensity = preset.filterIntensity;
    state.curves = JSON.parse(JSON.stringify(preset.curves));
    state.color = JSON.parse(JSON.stringify(preset.color));

    applyAdjustments(result);
    applyColorCorrection(result);
    applyFilter(result);
    applyCurves(result);
    applyVignette(result);

    state.adjustments = oldAdj;
    state.activeFilter = oldFilter;
    state.filterIntensity = oldFilterInt;
    state.curves = oldCurves;
    state.color = oldColor;
    state.lens = oldLens;

    if (preset.lens && (preset.lens.distortion !== 0 || preset.lens.distortion2 !== 0 || preset.lens.ca !== 0 ||
        preset.lens.perspH !== 0 || preset.lens.perspV !== 0 || preset.lens.rotation !== 0 || preset.lens.scale !== 100 ||
        preset.lens.vignette !== 0)) {
        result = applyLensCorrection(result, preset.lens);
    }

    return result;
}

function renderBatchList() {
    const list = document.getElementById('batch-list');
    const header = document.getElementById('batch-list-header');
    list.innerHTML = '';
    header.style.display = batchFiles.length ? 'flex' : 'none';
    header.querySelector('span').textContent = `${batchFiles.length} file${batchFiles.length === 1 ? '' : 's'}`;

    batchFiles.forEach((entry, idx) => {
        const item = document.createElement('div');
        item.className = 'batch-item';

        const thumb = document.createElement('div');
        thumb.className = 'batch-item-thumb';
        if (entry.thumb) thumb.style.backgroundImage = `url(${entry.thumb})`;
        item.appendChild(thumb);

        const name = document.createElement('div');
        name.className = 'batch-item-name';
        name.textContent = entry.file.name;
        item.appendChild(name);

        const status = document.createElement('div');
        status.className = 'batch-item-status';
        status.id = `batch-status-${idx}`;
        status.textContent = entry.status || 'pending';
        item.appendChild(status);

        list.appendChild(item);
    });

    document.getElementById('btn-batch-process').disabled = batchFiles.length === 0 || !batchPreset;
}

async function addBatchFiles(fileList) {
    const newFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    for (const file of newFiles) {
        const entry = { file: file, status: 'pending', result: null, thumb: null };
        try {
            const url = URL.createObjectURL(file);
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = () => {
                    const tc = document.createElement('canvas');
                    const size = 32;
                    const scale = Math.min(size / img.width, size / img.height);
                    tc.width = img.width * scale;
                    tc.height = img.height * scale;
                    tc.getContext('2d').drawImage(img, 0, 0, tc.width, tc.height);
                    entry.thumb = tc.toDataURL();
                    URL.revokeObjectURL(url);
                    resolve();
                };
                img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
                img.src = url;
            });
        } catch (e) { /* ignore */ }
        batchFiles.push(entry);
    }
    renderBatchList();
}

function clearBatchList() {
    batchFiles = [];
    batchResults = [];
    renderBatchList();
    document.getElementById('batch-download-row').style.display = 'none';
}

function setBatchProgress(text, pct) {
    const wrap = document.getElementById('batch-progress');
    wrap.style.display = 'block';
    document.getElementById('batch-progress-text').textContent = text;
    document.getElementById('batch-progress-fill').style.width = pct + '%';
}

function hideBatchProgress() {
    document.getElementById('batch-progress').style.display = 'none';
}

async function processBatch() {
    if (!batchPreset || !batchFiles.length) return;
    batchResults = [];
    setBatchProgress('Starting...', 0);

    const format = document.getElementById('batch-format').value;
    const quality = parseInt(document.getElementById('batch-quality').value) / 100;
    const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const ext = format === 'png' ? '.png' : format === 'webp' ? '.webp' : '.jpg';

    for (let i = 0; i < batchFiles.length; i++) {
        const entry = batchFiles[i];
        const statusEl = document.getElementById(`batch-status-${i}`);
        statusEl.className = 'batch-item-status processing';
        statusEl.textContent = 'processing';
        setBatchProgress(`Processing ${i + 1}/${batchFiles.length}: ${entry.file.name}`, (i / batchFiles.length) * 100);

        try {
            const blob = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = e.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(entry.file);
            });

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = blob.width;
            tempCanvas.height = blob.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(blob, 0, 0);
            const imgData = tempCtx.getImageData(0, 0, blob.width, blob.height);

            const processed = applyPresetToImageData(imgData, batchPreset);

            const outCanvas = document.createElement('canvas');
            outCanvas.width = processed.width;
            outCanvas.height = processed.height;
            outCanvas.getContext('2d').putImageData(processed, 0, 0);

            const resultBlob = await new Promise(r => {
                if (format === 'png') {
                    outCanvas.toBlob(r, 'image/png');
                } else {
                    outCanvas.toBlob(r, mimeType, quality);
                }
            });

            const baseName = entry.file.name.replace(/\.[^.]+$/, '');
            entry.result = { blob: resultBlob, name: baseName + ext };
            batchResults.push({ name: baseName + ext, blob: resultBlob });
            statusEl.className = 'batch-item-status done';
            statusEl.textContent = 'done';
        } catch (err) {
            console.error('Batch error for', entry.file.name, err);
            statusEl.className = 'batch-item-status error';
            statusEl.textContent = 'error';
        }
    }

    setBatchProgress(`Done! ${batchResults.length}/${batchFiles.length} processed`, 100);
    document.getElementById('batch-download-row').style.display = batchResults.length ? 'flex' : 'none';
    setTimeout(hideBatchProgress, 3000);
}

async function downloadBatchZip() {
    if (!batchResults.length) return;
    setBatchProgress('Building ZIP...', 95);
    try {
        const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
        const zip = new JSZip();
        for (const r of batchResults) {
            zip.file(r.name, r.blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'batch-processed.zip';
        a.click();
        URL.revokeObjectURL(url);
        hideBatchProgress();
    } catch (err) {
        console.error('ZIP failed:', err);
        setBatchProgress('ZIP failed: ' + err.message, 0);
    }
}

function downloadBatchIndividual() {
    batchResults.forEach((r, i) => {
        setTimeout(() => {
            const url = URL.createObjectURL(r.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = r.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, i * 200);
    });
}

document.getElementById('btn-batch-select').addEventListener('click', () => {
    document.getElementById('batch-file-input').click();
});
document.getElementById('batch-file-input').addEventListener('change', (e) => {
    if (e.target.files.length) addBatchFiles(e.target.files);
    e.target.value = '';
});
document.getElementById('btn-batch-select-folder').addEventListener('click', () => {
    document.getElementById('batch-folder-input').click();
});
document.getElementById('batch-folder-input').addEventListener('change', (e) => {
    if (e.target.files.length) addBatchFiles(e.target.files);
    e.target.value = '';
});
document.getElementById('btn-batch-clear').addEventListener('click', clearBatchList);
document.getElementById('btn-batch-capture').addEventListener('click', () => {
    captureBatchPreset();
    renderBatchList();
});
document.getElementById('btn-batch-process').addEventListener('click', processBatch);
document.getElementById('btn-batch-download-zip').addEventListener('click', downloadBatchZip);
document.getElementById('btn-batch-download-all').addEventListener('click', downloadBatchIndividual);
document.getElementById('batch-quality').addEventListener('input', (e) => {
    document.getElementById('val-batch-quality').textContent = e.target.value;
});
document.getElementById('batch-format').addEventListener('change', (e) => {
    document.getElementById('batch-quality-group').style.display = e.target.value === 'png' ? 'none' : 'block';
});

// Drawing
let drawState = {
    tool: 'brush',
    color: '#e94560',
    size: 8,
    opacity: 100,
    hardness: 100,
    strokeWidth: 2,
    shapeMode: 'fill',
    drawing: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    drawCanvas: null,
    drawCtx: null,
    previewCanvas: null,
    previewCtx: null,
    drawingLayerId: null
};

const defaultPalette = [
    '#000000', '#ffffff', '#e94560', '#ff8c00',
    '#ffd700', '#51cf66', '#339af0', '#9b59b6',
    '#ff44ff', '#7f8c8d', '#2c3e50', '#ecf0f1',
    '#e74c3c', '#f39c12', '#27ae60', '#2980b9'
];

function initDrawCanvas() {
    if (!state.currentImage) return;
    const w = state.currentImage.width;
    const h = state.currentImage.height;

    if (!drawState.drawCanvas || drawState.drawCanvas.width !== w || drawState.drawCanvas.height !== h) {
        drawState.drawCanvas = document.createElement('canvas');
        drawState.drawCanvas.width = w;
        drawState.drawCanvas.height = h;
        drawState.drawCtx = drawState.drawCanvas.getContext('2d');
        drawState.drawCtx.clearRect(0, 0, w, h);
    }

    if (!drawState.previewCanvas) {
        drawState.previewCanvas = document.createElement('canvas');
    }
    drawState.previewCanvas.width = w;
    drawState.previewCanvas.height = h;
    drawState.previewCtx = drawState.previewCanvas.getContext('2d');
}

function renderDrawOverlay() {
    if (state.activeTool !== 'draw' || !drawState.drawCanvas) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(drawState.drawCanvas, 0, 0);
    ctx.restore();
}

function hexToRgb(hex) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return [233, 69, 96];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function drawBrushStroke(ctx, x0, y0, x1, y1, color, size, opacity, hardness) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity / 100;

    if (hardness >= 100) {
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    } else {
        const r = size / 2;
        const innerR = r * (hardness / 100);
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r / 2)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const cx = x0 + (x1 - x0) * t;
            const cy = y0 + (y1 - y0) * t;
            const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, r);
            grad.addColorStop(0, color);
            grad.addColorStop(1, color + '00');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawEraserStroke(ctx, x0, y0, x1, y1, size) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = size;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
}

function drawShape(ctx, shape, x0, y0, x1, y1, color, strokeWidth, shapeMode) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape === 'line') {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    } else if (shape === 'rect') {
        const x = Math.min(x0, x1);
        const y = Math.min(y0, y1);
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        if (shapeMode === 'fill') {
            ctx.fillRect(x, y, w, h);
        } else {
            ctx.strokeRect(x, y, w, h);
        }
    } else if (shape === 'ellipse') {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const rx = Math.abs(x1 - x0) / 2;
        const ry = Math.abs(y1 - y0) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (shapeMode === 'fill') ctx.fill();
        else ctx.stroke();
    }
    ctx.restore();
}

function floodFill(imageData, startX, startY, fillColor) {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const idx = (startY * w + startX) * 4;
    const targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2], targetA = data[idx + 3];
    if (targetR === fillColor[0] && targetG === fillColor[1] && targetB === fillColor[2]) return;

    const stack = [[startX, startY]];
    const visited = new Uint8Array(w * h);

    while (stack.length) {
        const [x, y] = stack.pop();
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const flatIdx = y * w + x;
        if (visited[flatIdx]) continue;
        const pi = flatIdx * 4;
        if (data[pi] !== targetR || data[pi + 1] !== targetG || data[pi + 2] !== targetB || data[pi + 3] !== targetA) continue;
        visited[flatIdx] = 1;
        data[pi] = fillColor[0];
        data[pi + 1] = fillColor[1];
        data[pi + 2] = fillColor[2];
        data[pi + 3] = 255;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
}

function commitDrawToLayer() {
    if (!drawState.drawCanvas || !state.currentImage) return;
    const w = drawState.drawCanvas.width;
    const h = drawState.drawCanvas.height;
    const merged = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
    const d = merged.data;
    const baseD = state.currentImage.data;
    const drawD = drawState.drawCtx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
        const a = drawD[i + 3] / 255;
        d[i] = drawD[i] * a + baseD[i] * (1 - a);
        d[i + 1] = drawD[i + 1] * a + baseD[i + 1] * (1 - a);
        d[i + 2] = drawD[i + 2] * a + baseD[i + 2] * (1 - a);
        d[i + 3] = 255;
    }
    state.currentImage = merged;
    drawState.drawCtx.clearRect(0, 0, w, h);
    saveHistory();
    renderCanvas();
}

function newDrawLayer() {
    if (!state.currentImage) return;
    const w = state.currentImage.width;
    const h = state.currentImage.height;
    const data = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
    for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255;
    addLayer(data, 'Drawing');
    initDrawCanvas();
    drawState.drawCtx.clearRect(0, 0, w, h);
    renderCanvas();
}

function setupDrawPalette() {
    const pal = document.getElementById('draw-palette');
    pal.innerHTML = '';
    defaultPalette.forEach(color => {
        const sw = document.createElement('div');
        sw.className = 'palette-swatch';
        sw.style.background = color;
        sw.addEventListener('click', () => {
            drawState.color = color;
            document.getElementById('draw-color').value = color;
            document.getElementById('draw-color-hex').value = color;
        });
        pal.appendChild(sw);
    });
}

setupDrawPalette();

document.querySelectorAll('[data-draw-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-draw-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        drawState.tool = btn.dataset.drawTool;
    });
});

document.querySelectorAll('[data-shape-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-shape-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        drawState.shapeMode = btn.dataset.shapeMode;
    });
});

document.getElementById('draw-color').addEventListener('input', (e) => {
    drawState.color = e.target.value;
    document.getElementById('draw-color-hex').value = e.target.value;
});
document.getElementById('draw-color-hex').addEventListener('change', (e) => {
    const val = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
    if (/^#[0-9a-f]{6}$/i.test(val)) {
        drawState.color = val;
        document.getElementById('draw-color').value = val;
    }
});
document.getElementById('draw-size').addEventListener('input', (e) => {
    drawState.size = parseInt(e.target.value);
    document.getElementById('val-draw-size').textContent = e.target.value;
});
document.getElementById('draw-opacity').addEventListener('input', (e) => {
    drawState.opacity = parseInt(e.target.value);
    document.getElementById('val-draw-opacity').textContent = e.target.value;
});
document.getElementById('draw-hardness').addEventListener('input', (e) => {
    drawState.hardness = parseInt(e.target.value);
    document.getElementById('val-draw-hardness').textContent = e.target.value;
});
document.getElementById('draw-stroke').addEventListener('input', (e) => {
    drawState.strokeWidth = parseInt(e.target.value);
    document.getElementById('val-draw-stroke').textContent = e.target.value;
});

document.getElementById('btn-draw-newlayer').addEventListener('click', newDrawLayer);
document.getElementById('btn-draw-commit').addEventListener('click', commitDrawToLayer);

canvas.addEventListener('mousedown', (e) => {
    if (state.activeTool !== 'draw' || !state.currentImage) return;
    const p = getCanvasCoords(e);
    initDrawCanvas();

    if (drawState.tool === 'eyedropper') {
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = state.currentImage.width;
        tmpCanvas.height = state.currentImage.height;
        tmpCanvas.getContext('2d').putImageData(state.currentImage, 0, 0);
        const tmpCtx = tmpCanvas.getContext('2d');
        const pixel = tmpCtx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        drawState.color = hex;
        document.getElementById('draw-color').value = hex;
        document.getElementById('draw-color-hex').value = hex;
        return;
    }

    if (drawState.tool === 'fill') {
        const targetCanvas = document.createElement('canvas');
        targetCanvas.width = state.currentImage.width;
        targetCanvas.height = state.currentImage.height;
        targetCanvas.getContext('2d').putImageData(state.currentImage, 0, 0);
        const data = targetCanvas.getContext('2d').getImageData(0, 0, targetCanvas.width, targetCanvas.height);
        const [r, g, b] = hexToRgb(drawState.color);
        floodFill(data, Math.round(p.x), Math.round(p.y), [r, g, b]);
        state.currentImage = data;
        saveHistory();
        renderCanvas();
        return;
    }

    drawState.drawing = true;
    drawState.startX = p.x;
    drawState.startY = p.y;
    drawState.lastX = p.x;
    drawState.lastY = p.y;

    if (drawState.tool === 'brush') {
        drawBrushStroke(drawState.drawCtx, p.x, p.y, p.x + 0.01, p.y + 0.01, drawState.color, drawState.size, drawState.opacity, drawState.hardness);
    } else if (drawState.tool === 'eraser') {
        drawEraserStroke(drawState.drawCtx, p.x, p.y, p.x + 0.01, p.y + 0.01, drawState.size);
    } else if (['line', 'rect', 'ellipse'].includes(drawState.tool)) {
        drawState.previewCtx.clearRect(0, 0, drawState.previewCanvas.width, drawState.previewCanvas.height);
    }

    renderCanvas();
    renderDrawOverlay();
});

canvas.addEventListener('mousemove', (e) => {
    if (!drawState.drawing || state.activeTool !== 'draw') return;
    const p = getCanvasCoords(e);

    if (drawState.tool === 'brush') {
        drawBrushStroke(drawState.drawCtx, drawState.lastX, drawState.lastY, p.x, p.y, drawState.color, drawState.size, drawState.opacity, drawState.hardness);
    } else if (drawState.tool === 'eraser') {
        drawEraserStroke(drawState.drawCtx, drawState.lastX, drawState.lastY, p.x, p.y, drawState.size);
    } else if (['line', 'rect', 'ellipse'].includes(drawState.tool)) {
        drawState.previewCtx.clearRect(0, 0, drawState.previewCanvas.width, drawState.previewCanvas.height);
        drawShape(drawState.previewCtx, drawState.tool, drawState.startX, drawState.startY, p.x, p.y, drawState.color, drawState.strokeWidth, drawState.shapeMode);
        ctx.save();
        ctx.drawImage(drawState.previewCanvas, 0, 0);
        ctx.restore();
    }

    drawState.lastX = p.x;
    drawState.lastY = p.y;

    if (drawState.tool !== 'line' && drawState.tool !== 'rect' && drawState.tool !== 'ellipse') {
        renderCanvas();
        renderDrawOverlay();
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (!drawState.drawing || state.activeTool !== 'draw') return;
    const p = getCanvasCoords(e);

    if (['line', 'rect', 'ellipse'].includes(drawState.tool)) {
        drawShape(drawState.drawCtx, drawState.tool, drawState.startX, drawState.startY, p.x, p.y, drawState.color, drawState.strokeWidth, drawState.shapeMode);
    }

    drawState.drawing = false;
    if (drawState.previewCtx) drawState.previewCtx.clearRect(0, 0, drawState.previewCanvas.width, drawState.previewCanvas.height);
    renderCanvas();
    renderDrawOverlay();
});

canvas.addEventListener('mouseleave', () => {
    if (drawState.drawing) {
        drawState.drawing = false;
        if (drawState.previewCtx) drawState.previewCtx.clearRect(0, 0, drawState.previewCanvas.width, drawState.previewCanvas.height);
    }
});

document.getElementById('layer-opacity').addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.opacity = parseInt(e.target.value);
    document.getElementById('val-layer-opacity').textContent = e.target.value;
    renderLayerList();
    refreshComposite();
    renderCanvas();
});
document.getElementById('layer-opacity').addEventListener('change', () => saveHistory());

document.getElementById('layer-blend').addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.blendMode = e.target.value;
    saveHistory();
    renderLayerList();
    refreshComposite();
    renderCanvas();
});

document.getElementById('btn-layer-from-file').addEventListener('click', () => {
    document.getElementById('layer-file-input').click();
});

document.getElementById('layer-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const w = state.currentImage ? state.currentImage.width : img.width;
            const h = state.currentImage ? state.currentImage.height : img.height;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tctx = tempCanvas.getContext('2d');
            tctx.drawImage(img, 0, 0, w, h);
            const data = tctx.getImageData(0, 0, w, h);
            addLayer(data, file.name.replace(/\.[^.]+$/, ''));
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
});

document.getElementById('btn-layer-from-canvas').addEventListener('click', () => {
    if (state.activeLayerId) duplicateLayer(state.activeLayerId);
});

// AI
document.getElementById('btn-ai-remove-bg').addEventListener('click', aiRemoveBackground);
document.getElementById('btn-ai-upscale-2x').addEventListener('click', aiUpscale);
document.getElementById('btn-ai-enhance').addEventListener('click', aiEnhance);
document.getElementById('btn-ai-denoise').addEventListener('click', aiDenoise);

document.getElementById('btn-load-model').addEventListener('click', () => {
    document.getElementById('custom-model-input').click();
});
document.getElementById('custom-model-input').addEventListener('change', (e) => {
    if (e.target.files[0]) loadCustomModelFile(e.target.files[0]);
});
document.getElementById('btn-clear-model').addEventListener('click', clearCustomModel);
document.getElementById('btn-apply-custom').addEventListener('click', applyCustomModel);
document.getElementById('custom-intensity').addEventListener('input', (e) => {
    document.getElementById('val-custom-intensity').textContent = e.target.value;
});

// Stable Diffusion
let sdPipeline = null;
let sdModelId = null;

async function checkWebGPU() {
    if (!navigator.gpu) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return !!adapter;
    } catch {
        return false;
    }
}

async function loadSDModel() {
    const modelId = document.getElementById('sd-model-id').value.trim();
    if (!modelId) {
        showAIStatus('Please enter a model ID', 0);
        setTimeout(hideAIStatus, 2000);
        return;
    }

    setAIButtonsDisabled(true);
    showAIStatus('Checking WebGPU support...', 5);

    try {
        const hasWebGPU = await checkWebGPU();
        if (!hasWebGPU) {
            showAIStatus('WebGPU not available - SD requires Chrome/Edge 113+', 0);
            setTimeout(hideAIStatus, 4000);
            setAIButtonsDisabled(false);
            return;
        }

        showAIStatus('Loading Transformers library...', 10);
        const { pipeline, env } = await loadTransformers();

        env.allowLocalModels = false;
        env.useFs = false;

        showAIStatus('Loading SD model (this can take a few minutes)...', 20);

        sdPipeline = await pipeline('text-to-image', modelId, {
            device: 'webgpu',
            dtype: 'fp16',
            progress_callback: (data) => {
                if (data.status === 'progress') {
                    const pct = 20 + Math.round((data.progress || 0) * 0.7);
                    showAIStatus(`Loading ${data.file || 'model'}: ${Math.round(data.progress || 0)}%`, pct);
                } else if (data.status === 'done') {
                    showAIStatus('Model loaded!', 90);
                }
            }
        });

        sdModelId = modelId;
        document.getElementById('sd-model-name').textContent = modelId;
        document.getElementById('sd-info').style.display = 'flex';
        document.getElementById('sd-controls').style.display = 'block';

        showAIStatus('SD Model loaded!', 100);
        setTimeout(hideAIStatus, 2000);
    } catch (err) {
        console.error('SD load failed:', err);
        let msg = err.message;
        if (msg.includes('401') || msg.includes('unauthorized')) {
            msg = 'Model requires authentication or is gated. Use a public model like Xenova/sd-turbo';
        } else if (msg.includes('fetch')) {
            msg = 'Failed to fetch model. Check your internet connection and model ID';
        } else if (msg.includes('memory') || msg.includes('OOM')) {
            msg = 'Out of memory. SD requires ~4GB+ GPU memory';
        }
        showAIStatus('Error: ' + msg, 0);
        setTimeout(hideAIStatus, 5000);
        sdPipeline = null;
    } finally {
        setAIButtonsDisabled(false);
    }
}

function unloadSDModel() {
    sdPipeline = null;
    sdModelId = null;
    document.getElementById('sd-info').style.display = 'none';
    document.getElementById('sd-controls').style.display = 'none';
    document.getElementById('sd-model-id').value = '';
}

async function generateSD() {
    if (!sdPipeline) return;
    if (!state.currentImage && document.getElementById('sd-mode-select').value === 'img2img') {
        showAIStatus('Please open an image first', 0);
        setTimeout(hideAIStatus, 2000);
        return;
    }

    const prompt = document.getElementById('sd-prompt').value.trim();
    if (!prompt) {
        showAIStatus('Please enter a prompt', 0);
        setTimeout(hideAIStatus, 2000);
        return;
    }

    setAIButtonsDisabled(true);
    const mode = document.getElementById('sd-mode-select').value;
    const negativePrompt = document.getElementById('sd-negative-prompt').value.trim() || undefined;
    const numSteps = parseInt(document.getElementById('sd-steps').value);
    const guidance = parseFloat(document.getElementById('sd-guidance').value);
    const strength = parseInt(document.getElementById('sd-strength').value) / 100;
    const seedInput = document.getElementById('sd-seed').value;
    const seed = seedInput ? parseInt(seedInput) : Math.floor(Math.random() * 2147483647);

    showAIStatus(`Generating (${mode}, ${numSteps} steps)...`, 20);

    try {
        const options = {
            num_inference_steps: numSteps,
            guidance_scale: guidance,
            seed: seed
        };
        if (negativePrompt) options.negative_prompt = negativePrompt;

        let result;
        if (mode === 'img2img') {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = state.currentImage.width;
            tempCanvas.height = state.currentImage.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(state.currentImage, 0, 0);
            const blob = await new Promise(r => tempCanvas.toBlob(r, 'image/png'));
            options.image = blob;
            options.strength = strength;
            showAIStatus('Encoding image...', 40);
        }

        showAIStatus('Running diffusion...', 60);
        result = await sdPipeline(prompt, options);

        showAIStatus('Processing result...', 90);

        let resultImage;
        if (typeof result === 'object' && result.images && result.images[0]) {
            resultImage = result.images[0];
        } else if (result instanceof Blob) {
            resultImage = result;
        } else {
            resultImage = result;
        }

        const resultUrl = resultImage instanceof Blob
            ? URL.createObjectURL(resultImage)
            : resultImage.toDataURL ? resultImage.toDataURL() : null;

        if (!resultUrl) throw new Error('Unexpected result format from SD pipeline');

        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = resultUrl;
        });
        if (resultImage instanceof Blob) URL.revokeObjectURL(resultUrl);

        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = img.width;
        resultCanvas.height = img.height;
        const resultCtx = resultCanvas.getContext('2d');
        resultCtx.drawImage(img, 0, 0);

        state.currentImage = resultCtx.getImageData(0, 0, img.width, img.height);
        canvas.width = img.width;
        canvas.height = img.height;
        saveHistory();
        renderCanvas();
        fitZoom();

        showAIStatus('Generation complete!', 100);
        setTimeout(hideAIStatus, 2000);
    } catch (err) {
        console.error('SD generation failed:', err);
        showAIStatus('Error: ' + err.message, 0);
        setTimeout(hideAIStatus, 4000);
    } finally {
        setAIButtonsDisabled(false);
    }
}

document.getElementById('btn-load-sd').addEventListener('click', loadSDModel);
document.getElementById('btn-unload-sd').addEventListener('click', unloadSDModel);
document.getElementById('btn-generate-sd').addEventListener('click', generateSD);

document.getElementById('sd-strength').addEventListener('input', (e) => {
    document.getElementById('val-sd-strength').textContent = e.target.value;
});
document.getElementById('sd-steps').addEventListener('input', (e) => {
    document.getElementById('val-sd-steps').textContent = e.target.value;
});
document.getElementById('sd-guidance').addEventListener('input', (e) => {
    document.getElementById('val-sd-guidance').textContent = e.target.value;
});

// Local Edit
document.getElementById('brush-size').addEventListener('input', (e) => {
    state.localBrush.size = parseInt(e.target.value);
    document.getElementById('val-brush-size').textContent = e.target.value;
});
document.getElementById('brush-hardness').addEventListener('input', (e) => {
    state.localBrush.hardness = parseInt(e.target.value);
    document.getElementById('val-brush-hardness').textContent = e.target.value;
});
document.querySelectorAll('[data-brush-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-brush-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.localBrush.mode = btn.dataset.brushMode;
    });
});
document.getElementById('btn-clear-mask').addEventListener('click', clearLocalMask);
document.getElementById('local-sharpen-amount').addEventListener('input', (e) => {
    document.getElementById('val-local-sharpen').textContent = e.target.value;
});

document.getElementById('btn-local-sharpen').addEventListener('click', () => {
    if (!hasActiveMask() || !state.currentImage) return;
    const amount = parseInt(document.getElementById('local-sharpen-amount').value) / 100;
    saveHistory();
    const copy = new ImageData(new Uint8ClampedArray(state.currentImage.data), state.currentImage.width, state.currentImage.height);
    applySharpen(copy, amount);
    state.currentImage = applyMaskToResult(copy);
    renderCanvas();
    renderMaskOverlay();
});

document.getElementById('btn-apply-local').addEventListener('click', () => {
    if (!hasActiveMask() || !state.currentImage) return;
    if (confirm('Apply current image as the result for masked area? This will re-render with current adjustments.')) {
        saveHistory();
        renderCanvas();
        renderMaskOverlay();
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (state.activeTool !== 'local' || !state.currentImage) return;
    initLocalMask();
    state.localPainting = true;
    const p = getCanvasCoords(e);
    paintMaskAt(p.x, p.y);
    lastMaskPoint = p;
});
canvas.addEventListener('mousemove', (e) => {
    if (!state.localPainting || state.activeTool !== 'local') return;
    const p = getCanvasCoords(e);
    if (lastMaskPoint) {
        const dx = p.x - lastMaskPoint.x;
        const dy = p.y - lastMaskPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rect = canvas.getBoundingClientRect();
        const step = Math.max(1, state.localBrush.size * canvas.width / rect.width / 4);
        const steps = Math.ceil(dist / step);
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            paintMaskAt(lastMaskPoint.x + dx * t, lastMaskPoint.y + dy * t);
        }
    } else {
        paintMaskAt(p.x, p.y);
    }
    lastMaskPoint = p;
});
canvas.addEventListener('mouseup', () => {
    state.localPainting = false;
    lastMaskPoint = null;
});
canvas.addEventListener('mouseleave', () => {
    state.localPainting = false;
    lastMaskPoint = null;
});

window.addEventListener('resize', () => {
    if (state.activeTool === 'local') renderMaskOverlay();
});

// Zoom
document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.zoom = Math.min(state.zoom * 1.25, 5);
    canvas.style.transform = `scale(${state.zoom})`;
    document.getElementById('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.zoom = Math.max(state.zoom / 1.25, 0.1);
    canvas.style.transform = `scale(${state.zoom})`;
    document.getElementById('zoom-level').textContent = Math.round(state.zoom * 100) + '%';
});

document.getElementById('btn-zoom-fit').addEventListener('click', fitZoom);

// History
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    if (e.ctrlKey && e.key === 'o') { e.preventDefault(); document.getElementById('file-input').click(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); exportImage(); }
});

window.addEventListener('resize', fitZoom);

// Initialize
document.getElementById('panel-filters').style.display = 'none';
document.getElementById('panel-curves').style.display = 'none';
document.getElementById('panel-crop').style.display = 'none';
document.getElementById('panel-ai').style.display = 'none';
document.getElementById('panel-local').style.display = 'none';
document.getElementById('panel-color').style.display = 'none';
document.getElementById('panel-lens').style.display = 'none';
document.getElementById('panel-layers').style.display = 'none';
document.getElementById('panel-batch').style.display = 'none';
document.getElementById('panel-draw').style.display = 'none';
document.getElementById('panel-video').style.display = 'none';

buildHslGrid();

// ============================================================================
// VIDEO EDITOR
// ============================================================================
let videoState = {
    el: null,
    fileName: '',
    duration: 0,
    fps: 30,
    speed: 1.0,
    inPoint: 0,
    outPoint: 0,
    playing: false,
    rafId: null,
    applyColor: true,
    applyFilter: true,
    applyCurves: true,
    applyLens: true,
    bitrate: 5,
    format: 'video/webm',
    rec: null,
    recChunks: [],
    isExporting: false
};

function formatTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t * 100) % 100);
    return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function loadVideo(file) {
    const url = URL.createObjectURL(file);
    if (videoState.el) {
        videoState.el.pause();
        videoState.el.src = '';
    }
    const v = document.createElement('video');
    v.src = url;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.playsInline = true;
    v.muted = false;
    v.volume = 1.0;
    videoState.el = v;
    videoState.fileName = file.name;

    v.addEventListener('loadedmetadata', () => {
        videoState.duration = v.duration;
        videoState.inPoint = 0;
        videoState.outPoint = v.duration;
        v.currentTime = 0;
        document.getElementById('video-timeline').style.display = 'block';
        document.getElementById('drop-zone').style.display = 'none';
        canvas.style.display = 'block';

        const w = v.videoWidth;
        const h = v.videoHeight;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        fitZoom();
        updateVideoUI();
        updateFbfMemoryEstimate();
        connectVideoToAudio();
        videoFrameLoop();
    });
}

function videoFrameLoop() {
    if (videoState.rafId) cancelAnimationFrame(videoState.rafId);
    if (!videoState.el) return;

    const draw = () => {
        if (!videoState.el) return;
        const v = videoState.el;
        if (v.readyState >= 2 && v.videoWidth > 0) {
            if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
            }
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            if (videoState.applyColor || videoState.applyFilter || videoState.applyCurves || videoState.applyLens) {
                applyVideoAdjustments();
            }
        }
        updateAudioFades();
        if (state.activeTool === 'video') {
            updateVideoUI();
        }
        if (!v.paused && v.currentTime >= videoState.outPoint) {
            v.pause();
            v.currentTime = videoState.outPoint;
            videoState.playing = false;
            stopMusicPlayback();
        }
        videoState.rafId = requestAnimationFrame(draw);
    };
    draw();
}

function applyVideoAdjustments() {
    if (canvas.width === 0) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (videoState.applyColor) {
        applyAdjustments(imageData);
        applyColorCorrection(imageData);
    }
    if (videoState.applyFilter) {
        applyFilter(imageData);
    }
    if (videoState.applyCurves) {
        applyCurves(imageData);
    }
    if (videoState.applyLens) {
        applyVignette(imageData);
    }
    ctx.putImageData(imageData, 0, 0);
}

function updateVideoUI() {
    const v = videoState.el;
    if (!v) return;
    const dur = videoState.duration;
    const t = v.currentTime;
    document.getElementById('video-time-current').textContent = formatTime(t);
    document.getElementById('video-time-total').textContent = formatTime(dur);
    document.getElementById('video-in-label').textContent = formatTime(videoState.inPoint);
    document.getElementById('video-out-label').textContent = formatTime(videoState.outPoint);
    document.getElementById('video-length-label').textContent = formatTime(videoState.outPoint - videoState.inPoint);

    const track = document.getElementById('video-track');
    if (!track) return;
    const trackW = track.clientWidth;
    const inPct = dur > 0 ? (videoState.inPoint / dur) * 100 : 0;
    const outPct = dur > 0 ? (videoState.outPoint / dur) * 100 : 100;
    const playPct = dur > 0 ? (t / dur) * 100 : 0;
    document.getElementById('video-trim-in').style.left = `calc(${inPct}% - 4px)`;
    document.getElementById('video-trim-out').style.left = `calc(${outPct}% - 4px)`;
    document.getElementById('video-playhead').style.left = `${playPct}%`;
    const playBtn = document.getElementById('btn-video-play');
    if (playBtn) playBtn.classList.toggle('playing', videoState.playing);
    playBtn.textContent = videoState.playing ? '⏸' : '▶';
}

function toggleVideoPlay() {
    if (!videoState.el) return;
    const v = videoState.el;
    if (v.paused) {
        if (v.currentTime < videoState.inPoint || v.currentTime >= videoState.outPoint) {
            v.currentTime = videoState.inPoint;
        }
        if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') audioEngine.ctx.resume();
        v.playbackRate = videoState.speed;
        v.play().then(() => {
            videoState.playing = true;
            if (audioEngine.musicBuffer) startMusicPlayback();
        }).catch(() => {});
    } else {
        v.pause();
        videoState.playing = false;
        stopMusicPlayback();
    }
}

function setVideoIn() {
    if (!videoState.el) return;
    const t = videoState.el.currentTime;
    videoState.inPoint = Math.min(t, videoState.outPoint - 0.1);
    updateVideoUI();
    updateFbfMemoryEstimate();
}

function setVideoOut() {
    if (!videoState.el) return;
    const t = videoState.el.currentTime;
    videoState.outPoint = Math.max(t, videoState.inPoint + 0.1);
    updateVideoUI();
    updateFbfMemoryEstimate();
}

function resetVideoTrim() {
    if (!videoState.el) return;
    videoState.inPoint = 0;
    videoState.outPoint = videoState.duration;
    updateVideoUI();
    updateFbfMemoryEstimate();
}

function extractVideoFrame() {
    if (!videoState.el || !state.currentImage) return;
    const v = videoState.el;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `frame-${formatTime(v.currentTime).replace(/:/g, '-')}.png`;
        a.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

async function exportVideo() {
    if (!videoState.el || videoState.isExporting) return;
    const v = videoState.el;
    v.pause();
    videoState.playing = false;

    if (typeof MediaRecorder === 'undefined') {
        alert('MediaRecorder is not supported in this browser. Try Chrome or Edge.');
        return;
    }
    if (!v.captureStream && !v.mozCaptureStream) {
        alert('Video captureStream is not supported in this browser.');
        return;
    }

    videoState.isExporting = true;
    const progressBox = document.getElementById('video-export-progress');
    const fill = document.getElementById('video-export-fill');
    const text = document.getElementById('video-export-text');
    progressBox.style.display = 'block';
    fill.style.width = '0%';
    text.textContent = 'Preparing…';

    const fps = videoState.fps;
    const trimStart = videoState.inPoint;
    const trimEnd = videoState.outPoint;
    const trimLen = trimEnd - trimStart;

    const recCanvas = document.createElement('canvas');
    recCanvas.width = v.videoWidth;
    recCanvas.height = v.videoHeight;
    const recCtx = recCanvas.getContext('2d');

    const stream = recCanvas.captureStream(fps);
    const processedAudio = getProcessedAudioStream();
    if (processedAudio) {
        processedAudio.getAudioTracks().forEach(t => stream.addTrack(t));
    } else {
        const captureStream = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
        if (captureStream) {
            captureStream.getAudioTracks().forEach(t => stream.addTrack(t));
        }
    }

    const mime = MediaRecorder.isTypeSupported(videoState.format + ';codecs=vp9,opus') ? videoState.format + ';codecs=vp9,opus'
        : MediaRecorder.isTypeSupported(videoState.format + ';codecs=vp8,opus') ? videoState.format + ';codecs=vp8,opus'
        : MediaRecorder.isTypeSupported(videoState.format) ? videoState.format
        : 'video/webm';
    const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: videoState.bitrate * 1_000_000
    });
    videoState.recChunks = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) videoState.recChunks.push(e.data); };
    rec.onstop = () => {
        const blob = new Blob(videoState.recChunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const base = videoState.fileName.replace(/\.[^.]+$/, '') || 'video';
        a.download = `${base}-edited.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click();
        URL.revokeObjectURL(url);
        text.textContent = 'Done! Download started.';
        fill.style.width = '100%';
        setTimeout(() => { progressBox.style.display = 'none'; }, 3000);
        videoState.isExporting = false;
        stopMusicPlayback();
        v.muted = false;
    };

    v.currentTime = trimStart;
    await new Promise(r => v.addEventListener('seeked', r, { once: true }));
    if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') await audioEngine.ctx.resume();

    rec.start(100);
    v.playbackRate = 1.0;
    await v.play();

    const startTime = performance.now();
    const totalMs = trimLen * 1000;
    const drawRec = () => {
        if (!videoState.isExporting) return;
        recCtx.drawImage(v, 0, 0, recCanvas.width, recCanvas.height);
        const recData = recCtx.getImageData(0, 0, recCanvas.width, recCanvas.height);
        if (videoState.applyColor) {
            applyAdjustments(recData);
            applyColorCorrection(recData);
        }
        if (videoState.applyFilter) applyFilter(recData);
        if (videoState.applyCurves) applyCurves(recData);
        if (videoState.applyLens) applyVignette(recData);
        recCtx.putImageData(recData, 0, 0);

        const elapsed = (performance.now() - startTime);
        const pct = Math.min(100, (elapsed / totalMs) * 100);
        fill.style.width = pct + '%';
        text.textContent = `Rendering… ${pct.toFixed(0)}% (${formatTime(v.currentTime - trimStart)} / ${formatTime(trimLen)})`;

        if (v.currentTime >= trimEnd - 0.05 || v.ended) {
            setTimeout(() => rec.stop(), 200);
            return;
        }
        requestAnimationFrame(drawRec);
    };
    requestAnimationFrame(drawRec);
}

// Video event listeners
document.getElementById('btn-video-play').addEventListener('click', toggleVideoPlay);
document.getElementById('btn-video-stop').addEventListener('click', () => {
    if (!videoState.el) return;
    videoState.el.pause();
    videoState.el.currentTime = videoState.inPoint;
    videoState.playing = false;
});
document.getElementById('btn-video-skip-back').addEventListener('click', () => {
    if (!videoState.el) return;
    videoState.el.currentTime = Math.max(0, videoState.el.currentTime - 5);
});
document.getElementById('btn-video-skip-fwd').addEventListener('click', () => {
    if (!videoState.el) return;
    videoState.el.currentTime = Math.min(videoState.duration, videoState.el.currentTime + 5);
});
document.getElementById('btn-video-set-in').addEventListener('click', setVideoIn);
document.getElementById('btn-video-set-out').addEventListener('click', setVideoOut);
document.getElementById('btn-video-reset-trim').addEventListener('click', resetVideoTrim);
document.getElementById('btn-video-export').addEventListener('click', exportVideo);
document.getElementById('btn-video-extract-frames').addEventListener('click', extractVideoFrame);

document.getElementById('video-fps').addEventListener('input', (e) => {
    videoState.fps = parseInt(e.target.value);
    document.getElementById('val-video-fps').textContent = e.target.value;
    updateFbfMemoryEstimate();
});
document.getElementById('video-speed').addEventListener('input', (e) => {
    videoState.speed = parseInt(e.target.value) / 100;
    document.getElementById('val-video-speed').textContent = videoState.speed.toFixed(1);
    if (videoState.el) videoState.el.playbackRate = videoState.speed;
});
document.getElementById('video-bitrate').addEventListener('input', (e) => {
    videoState.bitrate = parseInt(e.target.value);
    document.getElementById('val-video-bitrate').textContent = e.target.value;
});
document.getElementById('video-volume').addEventListener('input', (e) => {
    if (videoState.el) videoState.el.volume = parseInt(e.target.value) / 100;
});
document.getElementById('video-apply-color').addEventListener('change', (e) => videoState.applyColor = e.target.checked);
document.getElementById('video-apply-filter').addEventListener('change', (e) => videoState.applyFilter = e.target.checked);
document.getElementById('video-apply-curves').addEventListener('change', (e) => videoState.applyCurves = e.target.checked);
document.getElementById('video-apply-lens').addEventListener('change', (e) => videoState.applyLens = e.target.checked);

document.querySelectorAll('[data-video-format]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-video-format]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        videoState.format = btn.dataset.videoFormat;
    });
});

document.getElementById('video-track').addEventListener('click', (e) => {
    if (!videoState.el) return;
    const track = document.getElementById('video-track');
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoState.el.currentTime = pct * videoState.duration;
});

function makeDraggable(handle, isIn) {
    let dragging = false;
    const onDown = (e) => {
        if (!videoState.el) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        document.body.style.cursor = 'ew-resize';
    };
    const onMove = (e) => {
        if (!dragging || !videoState.el) return;
        const track = document.getElementById('video-track');
        const rect = track.getBoundingClientRect();
        const x = (e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0) - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        const t = pct * videoState.duration;
        if (isIn) videoState.inPoint = Math.min(t, videoState.outPoint - 0.1);
        else videoState.outPoint = Math.max(t, videoState.inPoint + 0.1);
        updateVideoUI();
    };
    const onUp = () => { dragging = false; document.body.style.cursor = ''; };
    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    handle.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
}
makeDraggable(document.getElementById('video-trim-in'), true);
makeDraggable(document.getElementById('video-trim-out'), false);

// Frame-by-frame engine
videoState.frames = [];
videoState.fbf = {
    enabled: false,
    processing: false,
    total: 0
};

function updateFbfMemoryEstimate() {
    const el = document.getElementById('video-fbf-mem');
    if (!el) return;
    if (!videoState.el) { el.textContent = '—'; return; }
    const fps = videoState.fps;
    const dur = Math.max(0, videoState.outPoint - videoState.inPoint);
    const total = Math.max(1, Math.floor(dur * fps));
    const bytesPerFrame = canvas.width * canvas.height * 4;
    const totalMB = (total * bytesPerFrame) / (1024 * 1024);
    el.textContent = `~${total} frames × ${(bytesPerFrame / (1024 * 1024)).toFixed(1)} MB = ${totalMB.toFixed(0)} MB RAM`;
}

async function seekVideoTo(t) {
    return new Promise((resolve) => {
        const v = videoState.el;
        if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) { resolve(); return; }
        const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
        v.addEventListener('seeked', onSeeked);
        v.currentTime = t;
    });
}

async function processAllFrames() {
    if (!videoState.el || videoState.fbf.processing) return;
    if (videoState.el.videoWidth === 0) { alert('Video is not ready yet.'); return; }

    videoState.fbf.processing = true;
    videoState.frames = [];
    const fps = videoState.fps;
    const start = videoState.inPoint;
    const end = videoState.outPoint;
    const total = Math.max(1, Math.floor((end - start) * fps));
    const w = videoState.el.videoWidth;
    const h = videoState.el.videoHeight;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext('2d');

    videoState.el.pause();
    videoState.playing = false;

    const progressBox = document.getElementById('video-export-progress');
    const fill = document.getElementById('video-export-fill');
    const text = document.getElementById('video-export-text');
    progressBox.style.display = 'block';
    fill.style.width = '0%';
    text.textContent = `Processing frame 0 / ${total}…`;

    let cancelled = false;
    const cancelHandler = () => { cancelled = true; };
    document.getElementById('btn-video-fbf-process').addEventListener('click', cancelHandler, { once: true });

    for (let i = 0; i < total; i++) {
        if (cancelled) {
            text.textContent = `Cancelled at frame ${i} / ${total}.`;
            break;
        }
        const t = start + i / fps;
        await seekVideoTo(t);
        offCtx.drawImage(videoState.el, 0, 0, w, h);
        const data = offCtx.getImageData(0, 0, w, h);

        if (videoState.applyColor) {
            applyAdjustments(data);
            applyColorCorrection(data);
        }
        if (videoState.applyFilter) applyFilter(data);
        if (videoState.applyCurves) applyCurves(data);
        if (videoState.applyLens) applyVignette(data);

        videoState.frames.push({
            time: t,
            data: new ImageData(new Uint8ClampedArray(data.data), w, h)
        });

        const pct = ((i + 1) / total) * 100;
        fill.style.width = pct + '%';
        text.textContent = `Processing frame ${i + 1} / ${total}…`;
        if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
    }

    videoState.fbf.processing = false;
    if (!cancelled) {
        text.textContent = `Done! ${videoState.frames.length} frames ready.`;
    }
    const zipBtn = document.getElementById('btn-video-fbf-export-zip');
    const vidBtn = document.getElementById('btn-video-fbf-export-video');
    if (videoState.frames.length > 0) {
        zipBtn.disabled = false;
        vidBtn.disabled = false;
    }
}

async function exportFramesAsZip() {
    if (videoState.frames.length === 0) return;
    const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
    const zip = new JSZip();
    const folder = zip.folder('frames');
    const progressBox = document.getElementById('video-export-progress');
    const fill = document.getElementById('video-export-fill');
    const text = document.getElementById('video-export-text');
    progressBox.style.display = 'block';
    fill.style.width = '0%';

    const tmp = document.createElement('canvas');
    const f0 = videoState.frames[0];
    tmp.width = f0.data.width;
    tmp.height = f0.data.height;
    const tmpCtx = tmp.getContext('2d');

    for (let i = 0; i < videoState.frames.length; i++) {
        const f = videoState.frames[i];
        tmpCtx.putImageData(f.data, 0, 0);
        const blob = await new Promise(r => tmp.toBlob(r, 'image/png'));
        const name = `frame_${String(i).padStart(5, '0')}_${f.time.toFixed(3)}s.png`;
        folder.file(name, blob);
        const pct = ((i + 1) / videoState.frames.length) * 100;
        fill.style.width = pct + '%';
        text.textContent = `Packing ZIP… ${i + 1} / ${videoState.frames.length}`;
    }
    text.textContent = 'Generating ZIP…';
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = videoState.fileName.replace(/\.[^.]+$/, '') || 'video';
    a.download = `${base}-frames.zip`;
    a.click();
    URL.revokeObjectURL(url);
    text.textContent = `ZIP saved! ${videoState.frames.length} PNG frames.`;
}

async function exportFramesAsVideo() {
    if (videoState.frames.length === 0 || videoState.isExporting) return;
    if (typeof MediaRecorder === 'undefined') {
        alert('MediaRecorder is not supported in this browser.');
        return;
    }

    const fps = videoState.fps;
    videoState.isExporting = true;
    const progressBox = document.getElementById('video-export-progress');
    const fill = document.getElementById('video-export-fill');
    const text = document.getElementById('video-export-text');
    progressBox.style.display = 'block';
    fill.style.width = '0%';
    text.textContent = 'Encoding…';

    const f0 = videoState.frames[0];
    const recCanvas = document.createElement('canvas');
    recCanvas.width = f0.data.width;
    recCanvas.height = f0.data.height;
    const recCtx = recCanvas.getContext('2d');
    const stream = recCanvas.captureStream(0);
    const track = stream.getVideoTracks()[0];

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8'
        : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: videoState.bitrate * 1_000_000 });
    videoState.recChunks = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) videoState.recChunks.push(e.data); };
    rec.onstop = () => {
        const blob = new Blob(videoState.recChunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const base = videoState.fileName.replace(/\.[^.]+$/, '') || 'video';
        a.download = `${base}-frames.webm`;
        a.click();
        URL.revokeObjectURL(url);
        text.textContent = `Video saved! ${videoState.frames.length} frames encoded.`;
        fill.style.width = '100%';
        videoState.isExporting = false;
    };

    rec.start();
    const frameMs = 1000 / fps;
    for (let i = 0; i < videoState.frames.length; i++) {
        recCtx.putImageData(videoState.frames[i].data, 0, 0);
        if (track.requestFrame) track.requestFrame();
        const pct = ((i + 1) / videoState.frames.length) * 100;
        fill.style.width = pct + '%';
        text.textContent = `Encoding frame ${i + 1} / ${videoState.frames.length}`;
        await new Promise(r => setTimeout(r, frameMs));
    }
    setTimeout(() => rec.stop(), 200);
}

document.getElementById('btn-video-fbf-process').addEventListener('click', processAllFrames);
document.getElementById('btn-video-fbf-export-zip').addEventListener('click', exportFramesAsZip);
document.getElementById('btn-video-fbf-export-video').addEventListener('click', exportFramesAsVideo);
document.getElementById('video-fbf-enable').addEventListener('change', (e) => {
    videoState.fbf.enabled = e.target.checked;
    document.getElementById('btn-video-fbf-process').disabled = !e.target.checked;
    if (!e.target.checked) {
        document.getElementById('btn-video-fbf-export-zip').disabled = true;
        document.getElementById('btn-video-fbf-export-video').disabled = true;
    }
});

['video-fps'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateFbfMemoryEstimate);
});

const _origUpdateVideoUI = updateVideoUI;
function _newUpdateVideoUI() {
    try { _origUpdateVideoUI.apply(this, arguments); } catch (err) { console.error(err); }
    try { updateFbfMemoryEstimate(); } catch (err) { console.error(err); }
}
try { updateVideoUI = _newUpdateVideoUI; } catch (err) { console.error('updateVideoUI override failed:', err); }
try { updateFbfMemoryEstimate(); } catch (err) { console.error(err); }

// ============================================================================
// WEB AUDIO ENGINE
// ============================================================================
let audioEngine = {
    ctx: null,
    videoSource: null,
    musicSource: null,
    musicBuffer: null,
    musicGain: null,
    videoGain: null,
    fadeGain: null,
    bass: null,
    mid: null,
    treble: null,
    master: null,
    speakers: null,
    exportDest: null,
    musicStarted: false,
    musicStartTime: 0
};

const audioSettings = {
    mute: false,
    volume: 100,
    fadeIn: 0,
    fadeOut: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    musicVolume: 70,
    musicLoop: false
};

function initAudioContext() {
    if (audioEngine.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioEngine.ctx = new Ctx();

    audioEngine.videoGain = audioEngine.ctx.createGain();
    audioEngine.fadeGain = audioEngine.ctx.createGain();
    audioEngine.fadeGain.gain.value = 1;
    audioEngine.bass = audioEngine.ctx.createBiquadFilter();
    audioEngine.bass.type = 'lowshelf';
    audioEngine.bass.frequency.value = 200;
    audioEngine.mid = audioEngine.ctx.createBiquadFilter();
    audioEngine.mid.type = 'peaking';
    audioEngine.mid.frequency.value = 1000;
    audioEngine.mid.Q.value = 1;
    audioEngine.treble = audioEngine.ctx.createBiquadFilter();
    audioEngine.treble.type = 'highshelf';
    audioEngine.treble.frequency.value = 3500;
    audioEngine.musicGain = audioEngine.ctx.createGain();
    audioEngine.musicGain.gain.value = audioSettings.musicVolume / 100;
    audioEngine.master = audioEngine.ctx.createGain();
    audioEngine.master.gain.value = 1;
    audioEngine.speakers = audioEngine.ctx.destination;
    audioEngine.exportDest = audioEngine.ctx.createMediaStreamDestination();

    audioEngine.videoGain.connect(audioEngine.fadeGain);
    audioEngine.fadeGain.connect(audioEngine.bass);
    audioEngine.bass.connect(audioEngine.mid);
    audioEngine.mid.connect(audioEngine.treble);
    audioEngine.treble.connect(audioEngine.master);
    audioEngine.master.connect(audioEngine.speakers);
    audioEngine.master.connect(audioEngine.exportDest);

    audioEngine.musicGain.connect(audioEngine.master);
}

function connectVideoToAudio() {
    if (!videoState.el) return;
    if (audioEngine.videoSource) {
        try { audioEngine.videoSource.disconnect(); } catch (e) {}
    }
    if (!audioEngine.ctx) initAudioContext();
    if (!audioEngine.ctx) return;
    try {
        audioEngine.videoSource = audioEngine.ctx.createMediaElementSource(videoState.el);
        audioEngine.videoSource.connect(audioEngine.videoGain);
        applyAudioSettings();
    } catch (e) {
        console.warn('Audio connection failed:', e);
    }
}

function applyAudioSettings() {
    if (!audioEngine.ctx) return;
    const v = audioSettings.mute ? 0 : audioSettings.volume / 100;
    audioEngine.videoGain.gain.value = v;
    audioEngine.musicGain.gain.value = audioSettings.musicVolume / 100;
    audioEngine.bass.gain.value = audioSettings.bass;
    audioEngine.mid.gain.value = audioSettings.mid;
    audioEngine.treble.gain.value = audioSettings.treble;
    updateAudioFades();
}

function updateAudioFades() {
    if (!audioEngine.ctx || !videoState.el) return;
    const v = videoState.el;
    if (v.paused) {
        if (audioSettings.fadeIn > 0 || audioSettings.fadeOut > 0) {
            const t = v.currentTime;
            const fadeInT = Math.min(audioSettings.fadeIn, Math.max(0.001, t));
            const inGain = audioSettings.fadeIn > 0 ? Math.min(1, t / audioSettings.fadeIn) : 1;
            const trimLen = videoState.outPoint - videoState.inPoint;
            const fromEnd = (videoState.outPoint - t);
            const outGain = audioSettings.fadeOut > 0 ? Math.min(1, fromEnd / audioSettings.fadeOut) : 1;
            audioEngine.fadeGain.gain.value = Math.max(0, Math.min(1, inGain, outGain));
        } else {
            audioEngine.fadeGain.gain.value = 1;
        }
        return;
    }
}

async function loadMusicFile(file) {
    if (!audioEngine.ctx) initAudioContext();
    if (!audioEngine.ctx) return;
    const buf = await file.arrayBuffer();
    audioEngine.musicBuffer = await audioEngine.ctx.decodeAudioData(buf);
    document.getElementById('video-music-name').textContent = `${file.name} (${audioEngine.musicBuffer.duration.toFixed(1)}s)`;
    document.getElementById('btn-video-clear-music').disabled = false;
    audioEngine.musicStarted = false;
}

function startMusicPlayback() {
    if (!audioEngine.ctx || !audioEngine.musicBuffer) return;
    stopMusicPlayback();
    const src = audioEngine.ctx.createBufferSource();
    src.buffer = audioEngine.musicBuffer;
    src.loop = audioSettings.musicLoop;
    src.connect(audioEngine.musicGain);
    audioEngine.musicStartTime = audioEngine.ctx.currentTime;
    src.start();
    audioEngine.musicSource = src;
    audioEngine.musicStarted = true;
    src.onended = () => {
        if (audioEngine.musicSource === src) audioEngine.musicSource = null;
    };
}

function stopMusicPlayback() {
    if (audioEngine.musicSource) {
        try { audioEngine.musicSource.stop(); } catch (e) {}
        audioEngine.musicSource = null;
    }
    audioEngine.musicStarted = false;
}

function clearMusic() {
    stopMusicPlayback();
    audioEngine.musicBuffer = null;
    document.getElementById('video-music-name').textContent = 'No music loaded';
    document.getElementById('btn-video-clear-music').disabled = true;
}

function getProcessedAudioStream() {
    if (!audioEngine.ctx) return null;
    return audioEngine.exportDest.stream;
}

async function extractOriginalAudio() {
    if (!videoState.el) return;
    if (typeof MediaRecorder === 'undefined') {
        alert('MediaRecorder is not supported in this browser.');
        return;
    }
    const v = videoState.el;
    v.pause();
    v.currentTime = 0;
    await new Promise(r => v.addEventListener('seeked', r, { once: true }));
    const captureStream = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
    if (!captureStream) { alert('Audio capture is not supported in this browser.'); return; }
    const audioTracks = captureStream.getAudioTracks();
    if (audioTracks.length === 0) { alert('This video has no audio track.'); return; }
    const audioStream = new MediaStream(audioTracks);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    if (!mime) { alert('No supported audio mime type.'); return; }
    const rec = new MediaRecorder(audioStream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const base = videoState.fileName.replace(/\.[^.]+$/, '') || 'video';
        a.download = `${base}-audio.webm`;
        a.click();
        URL.revokeObjectURL(url);
    };
    rec.start();
    v.muted = true;
    v.play();
    const startT = performance.now();
    const trimLen = (videoState.outPoint - videoState.inPoint) * 1000;
    const checker = setInterval(() => {
        const elapsed = performance.now() - startT;
        if (elapsed >= trimLen || v.ended || v.currentTime >= videoState.outPoint) {
            clearInterval(checker);
            setTimeout(() => { rec.stop(); v.muted = false; }, 200);
        }
    }, 100);
}

function bindAudio(id, event, handler) {
    try {
        const el = document.getElementById(id);
        if (!el) { console.warn('Audio element not found:', id); return; }
        el.addEventListener(event, handler);
    } catch (e) { console.error('bindAudio failed for', id, e); }
}

bindAudio('video-audio-mute', 'change', (e) => {
    audioSettings.mute = e.target.checked;
    applyAudioSettings();
});
bindAudio('video-audio-volume', 'input', (e) => {
    audioSettings.volume = parseInt(e.target.value);
    const v = document.getElementById('val-video-audio-volume');
    if (v) v.textContent = e.target.value;
    applyAudioSettings();
});
bindAudio('video-fade-in', 'input', (e) => {
    audioSettings.fadeIn = parseFloat(e.target.value);
    const v = document.getElementById('val-video-fade-in');
    if (v) v.textContent = parseFloat(e.target.value).toFixed(1);
    updateAudioFades();
});
bindAudio('video-fade-out', 'input', (e) => {
    audioSettings.fadeOut = parseFloat(e.target.value);
    const v = document.getElementById('val-video-fade-out');
    if (v) v.textContent = parseFloat(e.target.value).toFixed(1);
    updateAudioFades();
});
bindAudio('video-eq-bass', 'input', (e) => {
    audioSettings.bass = parseInt(e.target.value);
    const v = document.getElementById('val-video-eq-bass');
    if (v) v.textContent = e.target.value;
    applyAudioSettings();
});
bindAudio('video-eq-mid', 'input', (e) => {
    audioSettings.mid = parseInt(e.target.value);
    const v = document.getElementById('val-video-eq-mid');
    if (v) v.textContent = e.target.value;
    applyAudioSettings();
});
bindAudio('video-eq-treble', 'input', (e) => {
    audioSettings.treble = parseInt(e.target.value);
    const v = document.getElementById('val-video-eq-treble');
    if (v) v.textContent = e.target.value;
    applyAudioSettings();
});
bindAudio('video-music-volume', 'input', (e) => {
    audioSettings.musicVolume = parseInt(e.target.value);
    const v = document.getElementById('val-video-music-volume');
    if (v) v.textContent = e.target.value;
    applyAudioSettings();
});
bindAudio('video-music-loop', 'change', (e) => {
    audioSettings.musicLoop = e.target.checked;
    if (audioEngine.musicSource) {
        audioEngine.musicSource.loop = e.target.checked;
    }
});
bindAudio('btn-video-load-music', 'click', () => {
    const inp = document.getElementById('video-music-input');
    if (inp) inp.click();
});
bindAudio('video-music-input', 'change', (e) => {
    if (e.target.files[0]) loadMusicFile(e.target.files[0]);
    e.target.value = '';
});
bindAudio('btn-video-clear-music', 'click', clearMusic);
bindAudio('btn-video-extract-audio', 'click', extractOriginalAudio);
