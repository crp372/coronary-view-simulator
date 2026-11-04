# CLAUDE.md — Coronary View Simulator

Project briefing for Claude Code. Read README.md for the full feature list and roadmap.

## What this is
A browser-based teaching tool for coronary angiography projections, built by Chiran (4th-year medical student, Humanitas, Italy) as a med-ed portfolio project. Users move a virtual C-arm and table, see a simulated fluoro image, and overlay cardiac anatomy.

## Current state (v1)
- Single self-contained file: `index.html` (HTML + CSS + JS, no build step).
- Three.js r128 from cdnjs, OrbitControls from jsDelivr (`three@0.128.0/examples/js/controls/OrbitControls.js`).
- Fonts: Barlow Condensed (display), Barlow (body), IBM Plex Mono (readouts) from Google Fonts.
- Run locally: open `index.html` in a browser, or `npx serve .` / `python3 -m http.server`.

## Key conventions (don't break these)
- **Patient coordinates:** x = patient's left, y = anterior (up, patient supine), z = feet. Right-handed. Isocentre at origin. Units are cm.
- **Projection direction:** `dirs(lao, cra)` gives detector direction `d = (sin a·cos b, cos a·cos b, −sin b)`; positive lao = LAO, positive cra = cranial. Image "up" `t` = head direction orthogonalised to `d`.
- **Fluoro camera** sits at the X-ray tube (−d × SOD) looking at isocentre, and its projection matrix is mirrored in x so the image reads as seen from the detector (AP: patient's left on screen right). Re-apply the flip after every `updateProjectionMatrix()`; all fluoro/overlay materials are DoubleSide.
- **Geometry constants:** SOD (source–isocentre) 70 cm, SID (source–image) 110 cm.
- **Heart frame:** long axis `u` (base → apex, left/anterior/inferior), septal normal `ns` (toward LV), `w` (toward anterior IV groove). Helpers: `P(a,b,c)` local → patient coords; `L(a, θ, rs)` epicardial point at distance `a` along the axis and angle θ (0 ant IV groove, 90 obtuse margin, 180 post IV groove, 270 acute margin). Orientation is tuned so RAO 30 sees the AV groove edge-on, LAO 45 looks down the septum, LAO caudal looks up the long axis.
- **Fluoro shading:** custom `densMat` ShaderMaterial with ReverseSubtract blending — each surface subtracts density ∝ radius × facing, so overlaps darken like contrast. Per-vertex attributes `rad` (radius) and `sdist` (distance from ostium, used for cine fill). Non-tube geometry needs `addConst()` to add these attributes.
- **Vessels** are defined in the `VESSELS` array (id, system L/R, parent, radii, label, points). Children compute their start distance from the nearest point on the parent.
- **Presets** live in the `PRESETS` array (name, lao, cra, injection side, "best for" text).

## Design
Single dark "cath lab console" theme by choice. Colour tokens on `:root` (`--bg`, `--panel`, `--accent` amber for monitor readouts, `--cool` cyan for the RCA). Layout: fluoro monitor dominant on the left, room view and controls in the right rail; stacks to one column under 920px.

## Roadmap (from discussion, not yet built)
1. **Realistic fluoro via DRR** (digitally reconstructed radiograph): ray-march a CT volume in WebGL2 at any C-arm angle; add heart motion, noise, edge enhancement.
2. **Precise anatomy overlay** from segmentations of the same CTCA scan (chambers + real coronary tree), drawn as contours, with near/far walls and hover highlighting in both views.
   - **Chosen dataset:** ImageCAS volumes (Kaggle, CC BY-NC 4.0) with ImageCAS-X labels (Zenodo, CC BY 4.0). ImageCAS-X provides 14 named coronary segments that map onto `VESSELS`, plus centrelines, meshes, and per-scan dominance, quality and disease descriptors. Chambers will come from TotalSegmentator `heartchambers_highres` (non-commercial). The project is therefore non-commercial unless licences change. See README "Data" and `tools/README.md`.
3. **Better room view:** improved geometry/lighting or licensed glTF models.
4. Quiz mode: random projection, name the angle or a highlighted vessel.

Suggested order: ~~pick a CTCA dataset~~ → DRR + CT-derived overlay → room polish. Data-prep scripts (Python) go in `tools/`. Raw data goes in the git-ignored `data/raw/`, and only small web-ready derived files are committed. Once the project grows, consider splitting `index.html` into modules (e.g. Vite).

## Notes
- Anatomy is simplified and right-dominant; say so in the UI.
- The original was published as a claude.ai artifact; that copy relied on the artifact host adding the html/head/body skeleton. `index.html` here is a complete standalone document.
