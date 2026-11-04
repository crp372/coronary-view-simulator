# Coronary View Simulator

An interactive browser tool for learning coronary angiography projections. You move a virtual C-arm and patient table, watch a simulated fluoroscopy image update, and overlay cardiac anatomy to understand what each view shows.

**Live page:** published as a private Claude artifact ("Coronary View Simulator"). Source: `coronary-view-simulator.html` (single self-contained file, Three.js r128).

---

## What it does (version 1)

### Fluoro monitor
- Simulated fluoroscopy image rendered from the X-ray tube's position, displayed as seen from the detector (head up; patient's left on screen right in AP).
- Contrast-filled vessels darken in proportion to their thickness, so overlapping vessels look darker, as in a real angiogram.
- Faint background structures: cardiac silhouette, spine, ribs, diaphragm domes, and the guide catheter (JL4 for left, JR4 for right) running up the aorta into the ostium.
- Animated quantum-noise grain and vignette.
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
- 3D view of the C-arm, tube, detector, X-ray beam cone, table and a translucent patient with the heart and coronary tree visible inside.
- Left coronary in amber, right coronary in cyan.
- Drag to orbit, scroll to zoom.

### Injection and display
- Switch between left and right coronary injection.
- **Cine injection**: contrast fills from the ostium, holds, then washes out.
- Toggles: anatomy overlay (LV, RV, LA, RA, aorta, pulmonary artery), vessel labels, spine and ribs.

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
- Improved hand-built geometry and lighting (rounded C-arm, proper detector and tube housings, table pedestal, recognisable patient), or
- Real glTF models of a C-arm and human body, bundled with the artifact.
- Main issue: sourcing models with a suitable licence, especially if the tool is ever monetised.

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
1. Choose a CTCA dataset and check its licence.
2. Build the DRR fluoro renderer and the CT-derived overlay.
3. Polish the room view last.

### Practical constraints
- The build workspace can't download from most websites; datasets will likely need to be downloaded and attached manually (GitHub-hosted data is reachable).
- Converting raw CT and segmentations into web-ready files is substantial work, likely several sessions.
- Data licence and attribution matter for any commercial use.

### Other ideas
- Quiz mode: show a random projection and ask the learner to name the angle or a highlighted vessel.

### Open question
Does "real fluoroscopy" mean genuine angiogram footage, or synthetic images that look real at any angle?
