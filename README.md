# Coronary View Simulator

An interactive browser tool for learning coronary angiography projections. You move a virtual C-arm and patient table, watch a simulated fluoroscopy image update, and overlay cardiac anatomy to understand what each view shows.

**Live page:** published as a private Claude artifact ("Coronary View Simulator"). Source: `index.html` (single self-contained file, Three.js r128).

**Run it from a local server** so the fluoro image can be computed from a real CT scan (see [below](#drr-fluoro-from-ct-scan-814)):

```bash
python3 -m http.server
```

Then open http://localhost:8000/. Opened from `file://` (or anywhere the CT can't load), the page falls back to the original model-heart image and says why under the monitor. `drr.html` is the standalone DRR prototype, with an extra iodine-strength slider and centreline toggle.

---

## What it does (version 1)

### Fluoro monitor
- Simulated fluoroscopy image rendered from the X-ray tube's position, displayed as seen from the detector (head up; patient's left on screen right in AP).
- **Default: DRR from a real CT.** X-rays are traced through ImageCAS scan 814 at the current angle, with iodine only in the injected tree (see [DRR fluoro](#drr-fluoro-from-ct-scan-814)). Vessel labels come from the scan's own centrelines. The data attribution is shown under the monitor.
- **Fallback: model heart** (no WebGL2 or float render targets, `file://`, or the data can't load). Contrast-filled vessels darken in proportion to their thickness; faint cardiac silhouette, spine, ribs, diaphragm domes and the guide catheter (JL4 for left, JR4 for right).
- Animated quantum-noise grain and vignette (drawn by the DRR's display pass, or as CSS layers over the model image).
- Monitor-style readouts in the corners: angulation (e.g. `RAO 30° CAU 25°`), field of view, source-to-image distance, injection side, and table position.
- **Drag the image to pan the table**; the anatomy follows the pointer.

### C-arm controls
- Rotation from RAO 90° to LAO 90°.
- Cranial/caudal angulation up to 45°.
- Field of view: 25, 20 or 15 cm.
- Projection geometry uses realistic distances (source–isocentre 70 cm, source–image 110 cm), so magnification changes with table height.

### Table controls
- Lateral (toward patient's right/left), longitudinal (headward/footward) and height.
- "Centre table" reset.

### Room view
- 3D view of the room, with the X-ray beam cone between tube and detector:
  - **C-arm:** a floor-standing unit at the head end. A column and horizontal arm carry a holder that turns with LAO/RAO; the arc slides through it for cranial/caudal.
  - **Imaging chain:** a flat-panel detector housing with its active area, and the X-ray tube with its collimator under the table.
  - **Table and patient:** a table on a pedestal at the foot end, with a translucent patient (shaped torso, head, neck, arms, legs). The heart and coronary tree are visible inside.
  - **Anatomy in DRR mode:** the tree and the translucent chambers, aorta and PA are the CT's own (from `vessels.json` and the TotalSegmentator meshes).
- **Camera:** "Whole room" or "Close on heart".
  - The close view moves in to the heart from the current viewing direction, fades the skin, and follows the heart when the table moves.
  - Drag to orbit, scroll to zoom.
- Left coronary in amber, right coronary in cyan. In DRR mode, hovering over a vessel or chamber highlights it in white, names it, and highlights it in the fluoro image too. Chambers are easiest to hover in the close view.

### Injection and display
- Switch between left and right coronary injection.
- **Cine injection**: contrast fills from the ostium, holds, then washes out.
- Toggles: anatomy overlay, vessel labels, and spine and ribs (model image only; hidden in DRR mode, where the CT has its own bones).
- **Anatomy overlay, DRR mode:** everything comes from the same CT, so it lines up with the image.
  - **Coronary tree** from ImageCAS-X, including the tree that isn't injected. Thin ribbons coloured by segment, with labels for both trees.
  - **Chambers and great vessels** (LV, RV, LA, RA, myocardium, aorta, PA) from TotalSegmentator, drawn as outlines. A wall is brightest where the beam grazes it edge-on, which is where it would form a border on a real image. The aorta and PA are cut off where the scan ends.
  - Brighter means nearer the detector, so you can tell front from back where structures overlap.
- **Anatomy overlay, model mode:** the model's LV, RV, LA, RA, aorta and pulmonary artery.
- **Hover (or tap on touch screens):** in the fluoro image, highlights a vessel or chamber, names it (e.g. "LAD · Left anterior descending") and highlights it in the room view too.
  - Over a chamber, the label lists the whole stack in the beam, detector side first (e.g. "RV › LV").
  - Hovering in the room view works the same way in reverse.

### Standard views (one-click presets)
Each preset animates the C-arm to the angle and shows what the view is best for.

| View | Angles | Best for |
|---|---|---|
| RAO caudal | RAO 30° CAU 25° | LM, proximal LAD and LCx, OM branches |
| AP caudal | AP 0° CAU 30° | LM body and bifurcation, proximal LCx |
| LAO caudal (spider) | LAO 45° CAU 30° | LM bifurcation, LAD and LCx ostia |
| RAO cranial | RAO 30° CRA 30° | Mid and distal LAD, diagonal origins |
| AP cranial | AP 0° CRA 35° | Mid LAD, diagonals separated from LAD |
| LAO cranial | LAO 40° CRA 30° | LAD with diagonals and septals separated |
| Left lateral | LAO 90° | Mid LAD and LCx, LIMA graft course |
| LAO (RCA) | LAO 40° | RCA "C" shape: ostium, proximal and mid RCA |
| RAO (RCA) | RAO 30° | RCA "L" shape: mid RCA and PDA length |
| LAO cranial (RCA) | LAO 30° CRA 25° | Crux: distal RCA into PDA and PLV |

### Built-in explainer
A collapsible section covering how views are named (by detector position), how to read the image orientation, and why RAO, LAO, cranial and caudal views open different segments.

---

## Anatomical model (version 1)

- **Coordinate system:** x = patient's left, y = anterior, z = feet; isocentre at the origin.
- **Heart orientation:** the long axis (base → apex) points left, anterior and inferior. It is set so the textbook rules hold:
  - RAO 30° sees the AV groove edge-on (RCA as an "L").
  - LAO ~45° looks down the interventricular septum (RCA as a "C").
  - LAO caudal looks up the long axis from the apex onto the LM bifurcation.
- **Coronary tree (right-dominant):** LM, LAD (wrapping the apex), D1, D2, two septals, LCx, OM1, OM2, RCA, conus branch, SA nodal branch, acute marginal, PDA, PLV. Vessels taper realistically (LM ~4.4 mm down to ~0.5 mm distal branches).
- **Chambers and great vessels:** ellipsoids for LV, RV, LA and RA; tubes for the aorta (root, arch, descending) and pulmonary artery.
- **Limitations:** hand-placed simplified anatomy, not derived from patient data. Real hearts vary in orientation, so optimal angles differ between patients.

### Checks done
Rendered RAO caudal, LAO (RCA) and the spider view headlessly and compared them with typical angiograms; all three read correctly. Rib and spine density were then reduced so they don't dominate the image.

---

## Planned refinements (discussed, not yet built)

### 1. Better room view
- ~~Improved hand-built geometry (rounded C-arm, proper detector and tube housings, table pedestal, recognisable patient) and a close-on-heart camera~~: done.
- Still possible: real glTF models of a C-arm and human body. Sourcing models with a suitable licence is the main issue, especially if the tool is ever monetised.

### 2. More anatomically precise overlay
- Replace ellipsoids with real meshes, from either:
  - open anatomical atlases (e.g. BodyParts3D, Z-Anatomy), or
  - segmentations of a real cardiac CT (CTCA) dataset (e.g. ASOCA, ImageCAS), which gives chambers and the real coronary tree from one patient.
- Render outlines and contours rather than colour fills, separate near and far walls, and highlight a structure in both views on hover.

### 3. Realistic fluoroscopy
Two possible meanings:
- **Real angiogram footage** (e.g. ARCADE, CADICA datasets, or de-identified hospital runs). Authentic, but only at the angles acquired, so continuous C-arm movement is lost and the 3D overlay won't match.
- **Synthetic fluoro from a real CT (DRR, digitally reconstructed radiograph).** The browser traces X-rays through a CT volume at any angle, giving genuine rib, lung, spine and soft-tissue texture, with real coronaries from a contrast CT. Add heart motion, noise, edge enhancement and frame-rate effects. This is how commercial cath simulators work.

### Recommended approach
One CTCA scan solves points 2 and 3 together: the DRR gives realistic fluoro at any angle, and its segmentation gives an overlay that matches the image exactly.

Suggested order:
1. ~~Choose a CTCA dataset and check its licence.~~ Done: see [Data](#data) below.
2. Build the DRR fluoro renderer and the CT-derived overlay.
3. Polish the room view last.

Decision: "realistic fluoro" means synthetic DRR images from CT, so the C-arm stays continuous and the overlay matches.

### Practical constraints
- Converting raw CT and segmentations into web-ready files is substantial work, likely several sessions.
- Data licence and attribution matter for any commercial use.

### Other ideas
- Quiz mode: show a random projection and ask the learner to name the angle or a highlighted vessel.

---

## DRR fluoro from CT scan 814

`index.html` renders a digitally reconstructed radiograph (DRR) of ImageCAS scan 814 at any C-arm angle, in its own WebGL2 canvas under the Three.js canvas. In DRR mode the Three.js canvas is cleared to transparent and only draws the anatomy overlay. `drr.html` is the standalone prototype with the same engine (shaders and `TUNE` are duplicated; keep them in step).

- **Three passes.**
  1. Cone-beam ray march through the de-contrasted CT, at half-voxel steps: μ = 0.2/cm × (1 + HU/1000).
  2. Ray march through the coronary volume, adding iodine for the injected side only, weighted by lumen occupancy. Its cine fill is driven by distance from the ostium.
  3. Display: I = e^(−∫μ) on a log window with automatic brightness from the central image, then edge enhancement, quantum noise (σ ∝ 1/√I) at 15 pulses/s, and a vignette.
- **Controls in `index.html`:** all the existing ones. The table sliders and drag-to-pan move the anatomy (the offset is subtracted from tube and detector), and cine fills by distance from the ostium in mm. Iodine is fixed at +25 000 HU at full lumen. `drr.html` adds an iodine-strength slider and a centreline toggle.
- **Labels:** from `vessels.json` centrelines, at 45% along each vessel. If that point is off-screen, the nearest on-screen point along the centreline is used instead.
- **Speed (Apple M5, Chrome):** about 6 ms for the 512² DRR pass, about 1 ms for the iodine pass, and about 3 ms per display frame at 1520². The CT pass only reruns when the geometry changes.
- **Checked views:** AP, RAO 30 CAU 25, LAO 45 CAU 30 (spider), LAO 40 right (RCA "C") and RAO 30 right (RCA "L"). In AP the RCA is on screen left and the LAD runs to the apex at lower right. In `index.html`, all ten presets, cine, table pan, FOV and the overlay were checked, plus the fallback when the data is missing.
- **Limits:**
  - The CT covers only 23 × 23 × 14 cm. Past its faces the edge voxels are extended and fade over 3 cm into flat soft tissue inside an elliptical body outline, so there's no full rib cage, and no lung edge outside the scan.
  - The right hemidiaphragm is inside the scan and shows in caudal views.
  - No guide catheter, heart motion or breathing yet.
  - The export's bone mask kept the contrast-filled descending aorta (~350 HU), so it shows faintly along the spine.

---

## Data

Chosen source: **ImageCAS** CTCA volumes with **ImageCAS-X** labels. One scan drives both the DRR and the overlay.

| Source | Provides | Licence | Where |
|---|---|---|---|
| ImageCAS (Zeng, Xu et al., 2023) | ~1000 CTCA volumes (Siemens dual-source), NIfTI | CC BY-NC 4.0 | [Kaggle](https://www.kaggle.com/datasets/xiaoweixumedicalai/imagecas) |
| ImageCAS-X (Bransby et al., 2026) | For 800 of those scans: lumen labels split into 14 named segments (LM, LAD, LCx, D1, D2, OM1, OM2, IM, RCA, R-PDA, R-PLA, L-PDA, L-PLA, other), centrelines, meshes, and per-scan dominance, image quality and disease descriptors | CC BY 4.0 | [Zenodo 21887809](https://zenodo.org/records/21887809) |
| TotalSegmentator `heartchambers_highres` (Wasserthal et al., 2023) | Chambers, myocardium, aorta and PA, generated locally on scan 814 | Free non-commercial licence (requested by the project owner); commercial use needs a paid licence | [GitHub](https://github.com/wasserth/TotalSegmentator) |

- **Scan:** ImageCAS #814. It has excellent image quality, a right-dominant tree, no disease and all key segments labelled. Chosen with `tools/pick_scan.py`.
- **Web export:** `tools/export_scan.py` writes `data/web/814/`, about 5 MB: a de-contrasted CT, a coronary volume and a centreline tree. A CTA has contrast throughout the blood pool, but a cath injection only fills one artery, so iodine is removed from the CT and added back in the renderer. See [tools/README.md](tools/README.md#web-export-format-datawebid).
- **Non-commercial only.** The ImageCAS volumes and the TotalSegmentator chamber model are both non-commercial. Any commercial use needs the authors' permission.
- **Raw data never goes in git.** It lives in `data/raw/`. Only small derived, web-ready files are committed. See [tools/README.md](tools/README.md) for the download steps.
- **Chambers:** `tools/export_chambers.py` turns the TotalSegmentator masks into smooth meshes, `data/web/814/chambers.bin.gz` (0.9 MB) plus `chambers.json`.
- **Attribution:** ImageCAS, ImageCAS-X and TotalSegmentator are credited in the app's source note, from `meta.json` and `chambers.json`.
