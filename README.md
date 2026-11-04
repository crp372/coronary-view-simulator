# Coronary View Simulator

An interactive browser tool for learning coronary angiography projections. You move a virtual C-arm and patient table, watch a simulated fluoroscopy image update, and overlay cardiac anatomy to understand what each view shows.

**Live page:** published as a private Claude artifact ("Coronary View Simulator"). Source: `index.html` plus plain ES modules under `src/` (no build step; Three.js r128 from a CDN). See [Code layout](#code-layout).

**Run it from a local server** so the fluoro image can be computed from a real CT scan (see [below](#drr-fluoro-from-ct-scan-814)):

```bash
python3 -m http.server
```

Then open http://localhost:8000/. The page has to be served: browsers won't load ES modules from `file://`, and the page says so if you open it that way. If the CT can't load, it falls back to the original model-heart image and says why under the monitor (add `?model` to the address to force that). `drr.html` shows the DRR engine on its own, with an extra iodine-strength slider and centreline toggle.

### Code layout
- `src/drr/`: the DRR engine, shared by both pages. `engine.js` (WebGL2 passes), `shaders.js`, `tune.js` (image constants, `TUNE`), `data.js` (`loadScan()` for a `data/web/<id>/` export), `heart.js` (cardiac motion, GLSL and its CPU twin), `cine.js` (the cine run).
- `src/geometry.js` (projection conventions, `dirs()`, `drrView()`) and `src/presets.js`, shared by both pages.
- `src/app/`: `index.html`'s modules. `main.js` is the entry point (start-up, frame loop, `window.sim`); `state.js` holds the shared state; then `model.js` (model heart), `fluoro.js` (Three.js image and overlay), `ct.js` (the CT's tree and chambers), `labels.js`, `room.js`, `ui.js` (controls, presets, `setMode()`), `pointer.js` (pan and hover). Styles are in `app.css`.
- `src/drr-page.js`: `drr.html`'s page script. `src/hearts.js` reads the heart list (`data/web/hearts.json`) for both pages.

### Screenshot checks
After changing anything that shows on screen, run the automatic checks (Node.js needed; one-off setup: `npm install`, then `npx playwright install chromium`):

```bash
npm run check
```

They open both pages in headless Chromium, show every preset, the overlays, a cine run with heart motion, the room view, the model-heart fallback and `drr.html`; check that the layout fits one screen at common sizes, and that the groups, full screen, About dialog and heart list work; and compare each against the reference images in `tests/baselines/`. After an intended change, look at the differences in the report (`npx playwright show-report`), then refresh the references with `npm run check:update` and commit them. The checks render with WebGL in software (SwiftShader), so they're the same on any machine. Re-running a DRR pass there can shift a few pixel values slightly, so the comparison allows small differences.

---

## What it does (version 1)

### Layout
- **One screen, no page scrolling** on laptops and desktops: standard views on the left, the fluoro monitor as large as the window allows in the middle, and a right rail with the room view and the controls.
- **Collapsible control groups** (C-arm, Table, Injection, Display). The room view takes whatever height the open groups leave. Which groups are open is remembered in this browser.
- **Full screen** for the whole app (button in the top bar, or press F; Esc leaves). Hidden where the browser can't do it, e.g. iPhone Safari, and some embedded previews block it.
- **About this image** (top bar) holds the longer notes: where the image comes from, how to read the overlays, and how the views are named. The short source line under the presets stays on the page, including the note that the finest branches are illustrative.
- Narrower windows (920–1199 px) keep the three columns with a slimmer presets column; phones, and windows under 560 px tall, scroll in one column.

### Choosing a heart
- The **Heart** dropdown lists the hearts in `data/web/hearts.json`, plus the simplified model heart. Choosing one reloads the page with `?heart=<id>` (or `?model`). `drr.html` reads `?heart=` too.
- To add a heart: export it with the tools (`data/web/<id>/`), then add an entry to `hearts.json`: `id`, `name` (dropdown), `short` (monitor readout), `source` (the scan, named in the notes), `dominance`, `dir`. Phase 4 will write the full preparation protocol.

### Fluoro monitor
- Simulated fluoroscopy image rendered from the X-ray tube's position, displayed as seen from the detector (head up; patient's left on screen right in AP).
- **Default: DRR from a real CT.** X-rays are traced through ImageCAS scan 814 at the current angle, with iodine only in the injected tree (see [DRR fluoro](#drr-fluoro-from-ct-scan-814)). Vessel labels come from the scan's own centrelines. The data attribution is shown under the monitor.
- **Fallback: model heart** (no WebGL2 or float render targets, the data can't load, or `?model` in the address). Contrast-filled vessels darken in proportion to their thickness; faint cardiac silhouette, spine, ribs, diaphragm domes and the guide catheter (JL4 for left, JR4 for right).
- Animated quantum-noise grain. With the CT image, a square flat-panel field with rounded corners and dark shutters, drawn by the DRR's display pass. With the model image, a round vignette, drawn as CSS layers.
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
- **Cine injection**: contrast fills from the ostium, holds, then washes out. In the CT image, a run takes about 5.4 s, all timed to a 72/min heartbeat and drawn at 15 pulses/s:
  - **Filling (about 0.6 s):** the front is dense and fast, as on real runs, and advances in surges, because coronary flow is mostly diastolic. Its leading edge is diluted over about 10 mm and mottled behind it.
  - **Holding (about 2 s).**
  - **Washout (about 1 s):** unopacified blood clears the tree from the ostium outward, also in pulses and with an uneven edge.
  - **Then the static view fades back in.**
  - **Heart motion:** the heart beats only during a cine run, like recording on a real system, and holds still otherwise. A "Heart motion" button turns it off.
    - **No jumps:** each run starts at end-diastole (the CT's own shape). The run ends only once the last beat is back there, so the image doesn't jump at either end. Every motion component is zero at end-diastole.
    - **What moves:** the motion is applied to what the X-rays sample, to the overlay, to the labels and hover picking, and to the catheter tip. Its components:
      - long-axis shortening: the AV plane descends 1.7 cm toward the apex, tapering off up into the atria and aortic root
      - radial squeeze (10%) and twist (base and apex turn opposite ways)
      - a pendulum-like swing of the whole heart
      - a smooth uneven field, so parts of the tree move differently
      - buckling: vessels tethered to the shortening surface turn wavy in systole and straighten in diastole, like an accordion
    - **Timing:** each component has its own time course from the LV volume curve: isovolumic contraction, brisk ejection, isovolumic relaxation, rapid filling, diastasis, atrial kick. The twist unwinds early in diastole. Because the components are out of step, points trace loops rather than lines.
    - **Fitted and checked:** the heart's frame comes from the CT's own chamber meshes. The amplitudes and timing were compared frame by frame with a real RAO caudal cine (CC BY, Wikimedia Commons). The first version had a long frozen diastole and uniform squeezing, which looked like a zoom, and was reworked.
    - It's still a modelled motion, not this heart's measured motion.
- Toggles: coronary overlay, chamber overlay, vessel labels, segment numbers, and spine and ribs (model image only; hidden in DRR mode, where the CT has its own bones). In model mode only the chamber overlay applies.
- **Overlays, DRR mode:** everything comes from the same CT, so it lines up with the image. Each overlay turns on separately.
  - **Coronary overlay:** the tree from ImageCAS-X, including the tree that isn't injected. Thin ribbons coloured by segment, with labels for both trees.
  - **Chamber overlay:** chambers and great vessels (LV, RV, LA, RA, aorta, PA, and optionally the myocardium) from TotalSegmentator.
    - Drawn as thin outlines with almost no fill. A wall shows where the beam grazes it edge-on, which is where it would form a border on a real image.
    - The legend has one chip per structure to show or hide it, in the image and the room view. The myocardium starts off.
    - The aorta and PA are cut off where the scan ends.
  - **Segment numbers:** SCCT 18-segment badges on the injected tree, or both trees with the coronary overlay.
    - Proximal LAD runs to the D1 origin, then mid and distal are halves of the rest.
    - Proximal LCx runs to the OM1 origin, then mid/distal.
    - The RCA is split into thirds up to the crux, because the acute marginal isn't labelled in this CT.
  - Brighter means nearer the detector, so you can tell front from back where structures overlap.
- **Chamber overlay, model mode:** the model's LV, RV, LA, RA, aorta and pulmonary artery.
- **Hover (or tap on touch screens):** in the fluoro image, highlights a vessel or chamber, names it (e.g. "LAD · Left anterior descending", plus its SCCT segment, e.g. "segment 7: Mid LAD") and highlights it in the room view too.
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
In the About dialog: how views are named (by detector position), how to read the image orientation, and why RAO, LAO, cranial and caudal views open different segments.

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

### Current plan (agreed with the project owner, in this order)
1. ~~**Phase 1, realism in motion:**~~ done: heart motion during cine (a cardiac warp, with the coronaries moving as the heart contracts); contrast streaming (contrast layers and streams rather than filling evenly).
2. ~~**Phase 2, code health:**~~ done: `index.html` split into ES modules (no build step); one DRR engine in `src/drr/`, shared with `drr.html`; automatic screenshot checks (`npm run check`).
3. ~~**Phase 3, layout:**~~ done: one screen with no page scrolling (presets, monitor, rail); full screen (F); collapsible control groups; a "choose heart" dropdown from `data/web/hearts.json`. See [Layout](#layout).
4. **Phase 4, protocol:** write up everything done for the first heart as a repeatable protocol, so new hearts from the Kaggle dataset can go through the same steps.

### Refinement backlog (from the first full demo; parked, not started)
Proposed order: start from the owner's own demo notes, then 1 + 2, and split the code (4) before larger work.
1. **Image realism**
   - ~~Calibrate against real reference angiograms; thinner distal vessels~~: done (first pass: iodine, black level, sharpening, flat-panel field, 0.45 mm coronary volume). Small side branches (conus, SA node, RV and acute marginal branches) are missing because ImageCAS-X doesn't label them.
   - ~~Small branches~~: done. Branches grown from the CT, plus illustrative fine branches below CT resolution (switchable, labelled on the page).
   - ~~Contrast density too uniform~~: done (pulsatile, diluted and mottled front; proximal-first washout).
   - ~~Synthetic chest background beyond the cropped scan~~: done (`tools/export_chest.py`).
   - ~~Guide catheter~~: done (JL4/JR4 along this CT's aorta; could later be anchored with TotalSegmentator `aortic_sinuses`). ~~Cardiac motion for cine~~: done.
2. ~~**Overlay clarity**~~: done (separate toggles, per-chamber chips, thinner contours, SCCT segment numbers).
3. **Teaching per view**
   - "What to look for" for each preset: segments seen well, foreshortened or overlapped.
   - A table offset per preset, so nothing is cut off (e.g. the proximal RCA in LAO 40 at 20 cm).
   - Quiz mode once the image and overlay are settled.
4. ~~**Code health**~~: done (Phase 2): ES modules, one shared DRR engine, screenshot checks.
5. **Data**
   - More hearts (left-dominant, co-dominant).
   - The ramus (IM) is recorded as a child of the LCx; it should come off the LM.
   - The aorta and PA are cut off at the edges of the scan.
   - Check TotalSegmentator's terms before sharing publicly.

---

## DRR fluoro from CT scan 814

`index.html` renders a digitally reconstructed radiograph (DRR) of ImageCAS scan 814 at any C-arm angle, in its own WebGL2 canvas under the Three.js canvas. In DRR mode the Three.js canvas is cleared to transparent and only draws the anatomy overlay. `drr.html` runs the same engine (`src/drr/`) on its own.

- **Three passes.**
  1. Cone-beam ray march through the de-contrasted CT, at half-voxel steps: μ = 0.2/cm × (1 + HU/1000).
  2. Ray march through the coronary volume, adding iodine for the injected side only, weighted by lumen occupancy. Its cine fill is driven by distance from the ostium.
  3. Display: I = e^(−∫μ) on a log window with automatic brightness from the central image, then edge enhancement, quantum noise (σ ∝ 1/√I) at 15 pulses/s, and a square flat-panel field.
  - **Tuned by eye** against CC-BY cine angiograms on Wikimedia Commons (an RAO caudal LAD and LAO RCA runs from published case reports): iodine 15 000 HU equivalent at full lumen, black level 0.08 so dense vessels read dark grey rather than black, and sharpening 0.95.
  - **Coronary volume at full CT resolution** (0.45 mm), lightly blurred for anti-aliasing, so distal vessels stay thin. The lumen volume is unchanged (3.15 mL).
  - **Chest beyond the scan.** The CT covers only 23 × 23 × 13.8 cm. Everything outside it comes from a coarse synthetic chest: `tools/export_chest.py`, 3 mm voxels, about 0.5 MB.
    - **What it holds:** body wall with subcutaneous fat, lungs with faint markings, diaphragm domes (right higher) with the liver below, vertebrae with discs, 12 pairs of ribs with costal cartilage, the sternum and the clavicles.
    - **Fitted to scan 814:** midline, spine, skin and chest width; lung and tissue values match the CT's own (lung about −880 HU).
    - **Seamless edges:** near each face of the CT, the CT's own lung-or-tissue pattern is carried across and fades into the generic chest over about 4 cm. The DRR blends from CT to chest over the CT's outer 1.5 cm, so the scan's edges don't show.
    - The DRR steps finely through the CT and coarsely through the chest. A frame still takes about 5 ms for the CT pass.
    - It's illustrative; everything inside the scan is still the patient's own CT.
  - **Guide catheter** (JL4 for left injections, JR4 for right), femoral approach. `tools/export_catheter.py` shapes it along this CT's own aorta, using the centroids of the TotalSegmentator mask in each slice:
    - up the descending aorta, over an arch above the scan (extrapolated), then down the ascending aorta, resting off-centre away from the ostium
    - a curve into the ostium, ending coaxial with the vessel, with the tip a few mm inside
    - The DRR draws it analytically: the exact length of each ray inside a 6F tube (2.0 mm outside, 1.78 mm lumen), so it also works above the scan. The braided wall is slightly denser, so the edges read darker.
    - Its lumen fills with contrast during the injection.
    - A "Guide catheter" button hides it, the readout names it, and the room view shows it. It's an approximation for teaching, not catheter mechanics.
  - **Small branches.** The labelled tree only holds the named segments, so two more layers are added:
    - **From the CT** (this patient's): `tools/export_scan.py` follows tube-like enhanced voxels (Frangi vesselness) out from the labelled tree. It stays out of the blood pool, using the TotalSegmentator masks, and out of bone, and rejects anything thicker than a small artery. In scan 814 that adds 0.31 mL: an RV/acute marginal and a conus-like branch off the RCA, plus twigs off the LAD, diagonals and PDA.
    - **Illustrative fine branches** (not this patient's): branches below about 1 mm can't be seen on a CT, so `tools/synth_branches.py` grows them from the real tree. Epicardial twigs follow the heart's surface, septal perforators leave the LAD, and terminal fans finish the vessel ends. They start 0.5–1.1 mm across and taper. In scan 814: 183 twigs, 3 m in total, 0.64 mL of lumen.
      - The page labels them as illustrative, the "Fine branches" button switches them off, and they're never named on hover or numbered.
      - Both layers fill on cine and follow the injection side.
- **Controls in `index.html`:** all the existing ones. The table sliders and drag-to-pan move the anatomy (the offset is subtracted from tube and detector), and cine fills by distance from the ostium in mm. Iodine is fixed at +15 000 HU at full lumen (`TUNE.iod`). `drr.html` adds an iodine-strength slider and a centreline toggle.
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
