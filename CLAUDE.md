# CLAUDE.md — Coronary View Simulator

Project briefing for Claude Code. Read README.md for the full feature list and roadmap.

## What this is
A browser-based teaching tool for coronary angiography projections, built by Chiran (4th-year medical student, Humanitas, Italy) as a med-ed portfolio project. Users move a virtual C-arm and table, see a simulated fluoro image, and overlay cardiac anatomy.

## Current state
- Single self-contained file: `index.html` (HTML + CSS + JS, no build step).
- Three.js r128 from cdnjs, OrbitControls from jsDelivr (`three@0.128.0/examples/js/controls/OrbitControls.js`).
- Fonts: Barlow Condensed (display), Barlow (body), IBM Plex Mono (readouts) from Google Fonts.
- Run locally with a server: `python3 -m http.server`, then `/`. From `file://` it still works, but with the model-heart fluoro.
- **Fluoro is a DRR** (WebGL2, no libraries) that ray-marches `data/web/814/` at any C-arm angle, on its own `#drr` canvas under the Three.js `#fluoro` canvas.
  - `mode` is `'loading'` (model shown meanwhile), `'drr'` or `'model'` (fallback: no WebGL2 / `EXT_color_buffer_float` / `DecompressionStream`, not http(s), or fetch/shader failure; the reason shows in `#srcNote`). `setMode()` applies it.
  - In DRR mode, `fr` clears to transparent and draws only the overlay `oScene`; the CSS noise and vignette are hidden (the DRR draws its own); the bones toggle is hidden; vessel labels come from `vessels.json` (`LABELS` kind `'d'`, vs `'v'` for the model); the room shows `roomCTTree` instead of `roomModelTree`.
  - **Overlay groups:** `ovl` holds two groups.
    - `modelOvl`: the model's chambers, aorta and PA. Shown only in model mode, because they don't match the CT. The room's model chambers and aorta (`roomModelAnat`) follow the same rule.
    - `ctOvl`, in DRR mode:
      - The CT's coronary tree from `vessels.json`: thin ribbons along the centrelines, coloured by segment (`SEG` holds colour and full name), shaded by `ctOvlMat`. Brighter means nearer the detector (`ovDir` = d).
      - The CT's chambers and great vessels from `chambers.json` / `chambers.bin.gz` (TotalSegmentator), shaded by `chamberOvlMat`: a rim term that's bright where the wall is edge-on to the beam, plus a faint fill. `renderOrder = -1`, so they draw under the ribbons. Labels are `LABELS` kind `'cc'`. The room shows them in `roomCTCh`.
      - The chambers are optional. If their files are missing, only the tree is drawn and the model chambers stay in the room view.
  - **Hover:**
    - `VES` holds one entry per CT vessel (room tube, overlay ribbon, material). `CH` holds one per chamber.
    - Vessels win: `pickVessel` finds the nearest projected centreline within a pixel tolerance (12 px in the image, 4 px in the room, where the heart is small). Otherwise `pickChambers` raycasts the chamber meshes, ordered from the detector in the image and from the eye in the room. The myocardium is named only on its own.
    - `setHover({v, pt} | {c} | null)` highlights the target in both views and fills `#monTip` / `#roomTip`. For vessels, `pt` (the nearest centreline point) gives the SCCT segment via `scctAt`. For chambers, the image tooltip lists the whole stack, detector side first.
  - **Overlay state:**
    - `state.ovV` is the CT coronary overlay and `state.ovC` the chamber overlay (in model mode, the model's chambers). `state.segN` shows the SCCT segment numbers.
    - `chOn[id]` switches single chambers. The legend chips built in `refreshOverlayUI` toggle it, and it applies to the image overlay, the room view and picking. Myo starts off.
    - `buildScct()` maps the 18 SCCT segments onto `VES` by `sdist`: LAD split at the D1 origin, then halves of the rest; LCx at the OM1 origin; RCA in thirds to the crux. The badges are `LABELS` kind `'sn'`.
    - Picks are queued and run once per frame in `step()` (`runPick`), because raycasting about 170k triangles per pointer event would be too slow.
    - In the image, only what's visible can be picked: the injected tree, or both trees and the chambers with the overlay on. Touch uses a tap.
  - `densMat` leaves alpha untouched (`blendEquationAlpha`), because the fluoro renderer has `alpha:true`.
  - Passes: CT line integral (reruns only on geometry change), iodine line integral for the injected side (reruns on cine fill), and display (log window with auto brightness and a black level, unsharp mask, noise, square flat-panel shutter). `TUNE.iod` / `floor` / `sharp` were tuned against CC-BY Commons cine angiograms; `drr.html` keeps the older values. Image constants are in `TUNE`.
  - `window.sim` exposes `state`, `mode`, `drr` (its `stats`, `win`), `tune`, `set()`, `ready` (promise for DRR start-up) and `frame()`, which renders one frame without rAF (rAF stops when the page is hidden).
- **`drr.html`** is the standalone DRR prototype (`window.drr` hook). Its shaders, `TUNE` and data helpers are duplicated in `index.html`; change both together.

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
   - **Web export** (`data/web/<id>/`, from `tools/export_scan.py`): de-contrasted CT plus a coronary volume (occupancy, segment, distance from ostium) plus `vessels.json`, all in the patient coordinates above (cm, tree centred at the isocentre), x-fastest. Source frames differ: NIfTI files are RAS → sim `(−x, y, −z)`; ImageCAS-X `.vtk` centrelines and meshes are LPS → sim `(x, −y, −z)`. Always convert through the export, never ad hoc.
   - **Small branches:**
     - **Grown from the CT:** coronary G channel = parent segment + 16 (`CT_BRANCH`), so always take `seg & 15` for the segment or side. They're this patient's anatomy.
     - **Illustrative fine branches:** `tools/synth_branches.py`, written to `synthetic.u8.gz` (1–127 left, 129–255 right). They are *not* this patient's: keep them labelled on the page, switchable (`state.fine`, `drr.setFine`), and out of hover, SCCT and the overlay.
3. **Better room view:** hand-built geometry and the "Close on heart" camera are done.
   - **Camera:** `setRoomView('room' | 'heart')` tweens the orbit target and camera position in `roomCamStep`. Heart view targets `tableG.position` and follows table moves. Orbit limits apply after the tween.
   - **Stand:** the stand's `holder` sits at (0, 0, −88), because the arc always passes through that point, and `rotation.z = −lao`.
   - Licensed glTF models remain optional.
4. Quiz mode: random projection, name the angle or a highlighted vessel.

Suggested order: ~~pick a CTCA dataset~~ → ~~DRR in `index.html`~~ (done, model renderer kept as fallback) → ~~CT coronary overlay with hover~~ → ~~CT chambers (TotalSegmentator)~~ → ~~room polish~~ (done) → quiz mode (roadmap item 4). A refinement backlog from the first demo (realism, overlay clarity, per-view teaching and framing, code split, more scans) is parked in README "Refinement backlog"; don't start it unless asked. Older order for reference: per-preset table framing → realism (catheter, motion, chest background) → quiz mode. Data-prep scripts (Python) go in `tools/`. Raw data goes in the git-ignored `data/raw/`, and only small web-ready derived files are committed. Once the project grows, consider splitting `index.html` into modules (e.g. Vite).

## Notes
- The DRR and its coronary overlay are one real, right-dominant heart. The chambers and the fallback image are a simplified right-dominant model, and the chambers are only shown in model mode. Say so in the UI (the "How the views are named" notes and `#srcNote` do).
- The original was published as a claude.ai artifact; that copy relied on the artifact host adding the html/head/body skeleton. `index.html` here is a complete standalone document.
