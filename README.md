<img width="1840" height="854" alt="Snímek obrazovky 2026-06-06 190349" src="https://github.com/user-attachments/assets/0ca62dfe-055d-4add-b389-3feb02bd881b" />
<img width="1858" height="817" alt="Snímek obrazovky 2026-06-06 190416" src="https://github.com/user-attachments/assets/33ebbe7b-e229-41dc-8244-de48fb778785" />
<img width="1828" height="877" alt="Snímek obrazovky 2026-06-06 190406" src="https://github.com/user-attachments/assets/b40379c6-da7d-43c7-97a5-089156ee3c36" />
# Local Lens

A browser-based photo editor with AI tools, professional color correction, lens correction, layers, drawing, and batch processing. Runs entirely client-side — your photos never leave your machine.

---

## Features

### Toolbar
1. **Adjust** — global tonal & color corrections
2. **Filters** — creative look presets
3. **Curves** — tone curve editor (RGB + per-channel)
4. **Crop** — aspect ratio presets, rotate, flip
5. **AI** — background removal, upscale, enhance, denoise
6. **Local** — paint a mask so edits only affect the painted area
7. **Color** — tint, color balance, HSL per color
8. **Lens** — distortion, perspective, CA, vignette
9. **Layers** — full layer stack with blend modes
10. **Batch** — apply the current edit preset to many files
11. **Draw** — paint, erase, draw shapes, fill, pick color
12. **Video** — load a video, scrub, trim, apply color edits, export

### Adjustments
- Brightness, contrast, saturation, exposure
- Highlights, shadows, temperature, vibrance
- Sharpness (unsharp mask), vignette
- Live preview while dragging

### Filters
- Grayscale, sepia, vintage, dramatic
- Cool, warm, fade, high contrast
- Invert, posterize, emboss
- Adjustable intensity slider per filter

### Curves
- Master RGB curve + individual R, G, B curves
- Drag to add/move points
- "Reset" per channel
- Curve state is part of the history snapshot

### Crop & Transform
- Aspect ratio presets: free, 1:1, 4:3, 16:9, 3:2, 9:16
- Rotate 90° left/right
- Fine rotation slider (-180° to +180°)
- Flip horizontal / flip vertical

### AI Tools
- **Remove Background** — `@imgly/background-removal@1.4.5` via esm.sh
- **Upscale 2x** — high-quality bicubic interpolation + light sharpening
- **AI Enhance** — CLAHE contrast + sharpening + denoising + color grading
- **AI Denoise** — bilateral filter (edge-preserving)
- All AI tools respect the **Local Edit** mask if one is active

### Local Edit (Mask Painting)
- Paint a mask directly on the image
- Adjustable brush size, hardness, mode (paint/erase)
- Mask transforms correctly with rotate/flip/crop
- All adjustments and AI tools apply only inside the painted region

### Color Correction
- **Tint** — green ↔ magenta axis
- **Color Balance** — independent lift/gamma/gain for shadows, midtones, and highlights (C / R, M / G, Y / B)
- **HSL** — 8 color ranges (red, orange, yellow, green, aqua, blue, purple, magenta) × hue, saturation, luminance

### Lens & Perspective
- **Distortion** — k1 + k2 barrel/pincushion correction
- **Chromatic Aberration** — per-channel radial offset (R and B)
- **Vignette** — amount, midpoint, roundness
- **Perspective** — horizontal and vertical keystone sliders
- **Transform** — rotation, scale
- **Presets** — wideangle, fisheye, portrait, building

### Layers
- Full non-destructive layer stack
- Add, duplicate, delete, rename, reorder, hide/show
- Per-layer opacity (0–100%)
- 16 blend modes (normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity)
- **Merge Down** and **Flatten Image**
- All history snapshots include the full layer state

### Draw
- 7 tools: **brush**, **eraser**, **line**, **rectangle**, **ellipse**, **paint bucket**, **eyedropper**
- Native color picker + hex input + 16-color quick palette
- Brush size (1–200px), opacity (1–100%), hardness (0–100% soft edges)
- Shape style toggle: filled or outline with adjustable stroke width
- Drawing lives on a separate overlay canvas (not destructive until you commit)
- **Commit to Layer** bakes the sketch into the image
- **New Drawing Layer** creates a dedicated transparent layer for the sketch

### Video Editor
- Load any browser-playable video (MP4, WebM, MOV, …) via the **Open Video** button or drag-and-drop
- **Timeline** with draggable **In** and **Out** handles, live playhead, click-to-seek
- **Playback controls**: play/pause, skip ±5s, stop, volume, playback speed (0.25×–3×)
- All current color/filter/curves/lens adjustments are applied to every video frame in real time
- Per-category toggles: enable/disable color, filter, curves, lens during playback & export
- **Export** the trimmed & color-graded result via `MediaRecorder`:
  - **WebM** (VP9 + Opus) — universal
  - **MP4** — works in Safari and recent Chromium
  - Adjustable FPS (10–60) and bitrate (1–20 Mbps)
  - Original audio is captured and re-muxed into the output
- **Extract Frame as Image** — save the current frame as a PNG

### Frame-by-Frame (Advanced)
A 100% **optional** mode for short videos. The standard real-time export is recommended for everything else.

**Workflow**
1. Open the Video tool and load your video
2. Trim it, tweak your color/filter/curves/lens
3. In the **Frame-by-Frame** section, tick the enable checkbox
4. Click **Process All Frames** — each frame is rendered individually with adjustments baked in
5. Then either:
   - **Export Frames as ZIP (PNG)** — a folder of timestamped PNGs
   - **Export Frames as Video** — a WebM assembled from the pre-rendered frames

**Why use it?**
Lets you apply slow or expensive per-frame operations (e.g. AI upscale, AI denoise, complex filters) to every single frame before re-encoding. The standard export can't do that because it has to keep up with real-time playback.

**Limitations — please read before using**
- **Best for clips under ~6 seconds.** RAM usage scales with `width × height × 4 bytes × frame count`.
- **Memory budget (rough):**
  - 1080p @ 30 fps ≈ **8 MB/frame × 180 frames = ~1.5 GB RAM for 6 s**
  - 720p @ 30 fps ≈ **3.5 MB/frame = ~640 MB for 6 s**
  - 480p @ 30 fps ≈ **0.9 MB/frame = ~165 MB for 6 s**
- **No audio** in the output. Without a real-time audio clock there's nothing to sync against, and re-muxing audio back into a non-realtime render is out of scope for a pure-browser tool. Use the standard real-time export if you need sound.
- **Much slower than real-time.** Each frame is seeked, processed, and stored sequentially.
- Browsers may throw `RangeError: Out of memory` if you exceed available RAM.

**Memory estimate is live** in the panel — it recalculates as you change the trim or FPS, so you can see the cost before committing.

### Audio (Web Audio Engine)
All audio routing goes through a Web Audio graph so the **real-time export uses the processed audio**, not the raw video audio.

- **Mute** — silences the original audio track
- **Volume** — 0–200% gain on the original audio
- **Fade In / Fade Out** — linear fades applied at the trimmed start/end
- **3-Band EQ** — bass (low-shelf @ 200 Hz), mid (peaking @ 1 kHz), treble (high-shelf @ 3.5 kHz), each ±20 dB
- **Background Music** — load any audio file, mix it on top of the original
  - Independent volume slider
  - Optional loop-to-fill-video mode
  - Auto-starts/stops with the video
- **Extract Original Audio** — saves the unprocessed video audio to a `.webm` file

**Note:** Frame-by-frame mode still doesn't include audio. To export processed audio, use the standard real-time export.

### Custom Model
- Load any image-to-image ONNX model from your disk
- 5 blend modes: overlay, replace, mask, multiply, screen
- Adjustable intensity slider
- Useful for Stable-Diffusion-style checkpoints exported to ONNX

### Stable Diffusion
- Enter a Hugging Face model ID that exposes the diffusers format
- **txt2img** mode: prompt-only generation
- **img2img** mode: prompt + your image as starting point
- Controls: prompt, negative prompt, strength, steps, guidance, seed
- Requires a WebGPU-capable browser (Chrome 113+, Edge 113+)

### Batch Processing
- Select a whole folder (`webkitdirectory`) or pick individual files
- **Capture Preset** from the current edit state (adjustments, filter, curves, color, lens)
- Output as **PNG**, **JPEG**, or **WebP** with quality slider
- Live progress bar with per-file status
- **Download ZIP** (via JSZip) or download each file individually
- All work happens locally — no upload

### Other
- Full undo/redo history (Ctrl+Z / Ctrl+Y)
- Keyboard shortcuts: Ctrl+O = open, Ctrl+S = save, Esc = cancel
- Drag-and-drop image loading
- Export current view as PNG

---

## Tech Stack

- Vanilla JavaScript (no framework, no build step)
- HTML5 Canvas for all pixel work
- ESM imports from `https://esm.sh` (only at runtime, no install)
  - `@imgly/background-removal@1.4.5`
  - `onnxruntime-web@1.17.1`
  - `jszip@3.10.1`

---

## Setup

Just open `index.html` in a modern browser, or deploy the folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages, etc.).

```bash
# Local development (optional — needed if you want to test drag-and-drop or service workers)
python -m http.server 8000
# then open http://localhost:8000
```


---

## File Structure

```
photo-editor/
├── index.html      # UI layout, panels, toolbar
├── styles.css      # Dark theme + responsive layout
├── app.js          # All editor logic, image processing, AI, layers, batch
└── README.md       # You are here
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open image |
| `Ctrl+S` | Export current image as PNG |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Esc` | Cancel current tool / crop |

---

## Browser Requirements

- Modern Chromium, Firefox, or Safari with **ES module** + **Canvas 2D** support
- **Stable Diffusion** requires WebGPU (Chrome 113+ / Edge 113+)
- **All other features** work on any modern browser

---

## Privacy

Every pixel is processed on your device. There is **no server**, no upload, and no telemetry. The only network requests are to `esm.sh` (for the background-removal, ONNX runtime, and JSZip libraries on first load) and optionally to Hugging Face (only if you click *Run* inside the Stable Diffusion tool).

---

## License

Free to use, modify, and ship. Please contact me if shipping modified version, even if i dont respond you can ship. Thank you.
