# CLAUDE.md — Coronary View Simulator

Project briefing for Claude Code. Read README.md for the full feature list and roadmap.

## What this is
A browser-based teaching tool for coronary angiography projections, built by Chiran (4th-year medical student, Humanitas, Italy) as a med-ed portfolio project. Users move a virtual C-arm and table, see a simulated fluoro image, and overlay cardiac anatomy.

## Current state
- `index.html` plus plain ES modules under `src/` (no build step, no bundler). Three.js stays a classic global script (`THREE`), loaded before the modules.
  - `src/drr/`: the DRR engine, shared by `index.html` and `drr.html`: `engine.js` (`drrSupport`, `createDRR`), `shaders.js`, `tune.js` (`TUNE`, `MU_W`, `DRR_N`…), `data.js` (`loadScan(dir)`: required CT, coronary and vessels; optional fine branches, catheter, chest, chambers, each null if missing), `heart.js` (`HEART_U`, `HEART_CORE`, `heartDisp`, `heartFrame(chambers)`…), `cine.js` (`drrCine(run, now, motion)`; sets `run.done` when the run ends).
  - The engine takes everything per call: `drrView(state)` (in `src/geometry.js`) carries the angles, table offset, side and `cath`; `createDRR(gl, cv, scan, {fine, reduce})`. Don't import page state into `src/drr/`.
  - `src/geometry.js` (`SOD`, `SID`, `dirs`, `drrView`) and `src/presets.js` are shared too.
  - `src/app/`: `index.html`'s modules. `main.js` (entry: `startDRR`, `updateGeometry`, `step`, `window.sim`), `state.js` (`state`, `chOn`, and `app` for everything modules change for each other: `mode`, `why`, `drr`, `attr`, `ctLegend`, `hover`, `hoverCh`, `tween`, `cine`, `roomView`), `model.js`, `tubes.js`, `fluoro.js`, `ct.js` (`addCT(scan)`, `VES`, `CH`, `SEG`, `SCCT`), `labels.js`, `room.js`, `ui.js` (`syncUI`, `setMode`, `refreshOverlayUI`), `pointer.js`. Styles in `src/app/app.css`.
  - A mutable value shared between modules goes in `app` (an imported `let` can't be assigned from another module).
  - `src/drr-page.js` is `drr.html`'s page script.
  - `src/hearts.js`: `loadHearts()` reads `data/web/hearts.json` (falls back to a built-in list with 814) and picks the heart from `?heart=<id>`, `?model` or the default; `heartHref(id)` builds the address to switch. The heart menu (`#heartSel`: `#heartBtn` plus a `#heartList` list box, styled by the page rather than a native `<select>`, with list-box keyboard handling in `fillHearts`) reloads the page; there's no live swap of volumes. `app.heart` holds the entry (`name`, `short`, `source`, `dominance`, `dir`); UI text about the scan comes from it, and `app.scanCm` from the CT's meta. Don't hard-code "814" in UI text.
- Three.js r128 from cdnjs, OrbitControls from jsDelivr (`three@0.128.0/examples/js/controls/OrbitControls.js`).
- Fonts: Archivo Narrow (display), Inter (body), JetBrains Mono (readouts) from Google Fonts. Inter is wider than Barlow (the earlier body font), so the side column's small notes are sized to fit 1280×800; check the layout tests after making text bigger.
- Run locally with a server: `python3 tools/serve.py` (port 8000; `npm run serve` uses 8766), then `/`. It is `http.server` plus `Cache-Control: no-cache`; plain `python3 -m http.server` lets the browser reuse stale modules after an edit (new HTML, old script), which looks like a broken button. Modules don't load from `file://`; an inline script says so on the page. `?model` forces the model-heart fallback.
- **Screenshot checks:** `npm run check` (Playwright, `tests/views.spec.js`, references in `tests/baselines/`); `npm run check:update` after an intended visual change, then look at the new images before committing them. It passes `--update-snapshots=all`: plain `--update-snapshots` only rewrites images that differ beyond the tolerance, so a small colour change would leave stale references that still pass. They serve the folder on port 8767, use reduced motion (no tweens, brightness snaps, noise frame 0) and SwiftShader. Re-running a DRR pass in SwiftShader isn't bit-exact (a few levels on ~5% of pixels), hence the small tolerance. Run them after any change that shows on screen.
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
  - Passes: CT line integral (reruns only on geometry change), iodine line integral for the injected side (reruns on cine fill), and display (log window with auto brightness and a black level, unsharp mask, noise, square flat-panel shutter). `TUNE.iod` / `floor` / `sharp` were tuned against CC-BY Commons cine angiograms. Image constants are in `TUNE` (`src/drr/tune.js`).
  - `window.sim` exposes `state`, `chOn`, `mode`, `drr` (its `stats`, `win`), `tune`, `set()`, `ready` (promise for DRR start-up) and `frame(at)`, which renders one frame without rAF (rAF stops when the page is hidden). For checks: `pause()` stops the rAF loop drawing, `runCine(at)` starts a run at clock `at` (null cancels), `advanceCine(at)` steps it without drawing.
- **`drr.html`** shows the shared engine on its own, with an iodine slider (`TUNE.iod`) and 2D centrelines (`window.drr` hook: `state`, `tune`, `set()`, `frame(at)`, `ready`, `runCine`, `pause`). It uses the same `TUNE` as `index.html`.

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
Single dark "cath lab console" theme by choice, in a steel style: graphite panels (toolbar, views column, rail panels, dialogs) with classic bevelled edges on a dark page; buttons are raised keys that sink when pressed (selected ones are filled muted steel blue); the monitor, room view and heart menu button sit sunken. The highlight is a muted steel blue in two shades: `--accent` (`#a3aff5` lavender blue, for text on dark panels: slider values, preset angles, the title, the room LCA and beam) and `--accent-fill` (`#3f5f8f` steel blue, with `--on-accent` near-white text, for selected keys, slider fills, segment badges, the heart list's active row). On the fluoro screen, the readouts and left coronary labels use `--scr` silver-white instead (`.ro`, `.lbl`); right coronary labels stay `--cool` cyan. In the room, keep the left coronary's lavender clearly apart from the cyan. Colour tokens on `:root` (`--bg`, `--panel`, `--accent`, `--accent-fill`, `--scr`, `--cool`; `--silver`, `--edge`, `--raised`, `--sunken`, `--steel`, `--key` for the bevels). The steel overrides are one block in `app.css`, before the media queries. Layout (`src/app/app.css`): one screen, no page scrolling. `.app` is a 100dvh grid: `bar` on top, then `side` (presets, current view, short source line `#srcShort`), `stage` (a size container; the monitor is `min(100cqw,100cqh)` square) and `rail` (room view, then `details.grp` groups: C-arm, Table, Injection, Display). The room panel flexes to the height the open groups leave. Media queries come last in the file: 920–1199 px slims the side column (names only); under 920 px wide or 560 px tall it's one scrolling column, presets as chips; under 860/780 px tall the rail tightens. Keep the layout checks in `tests/views.spec.js` passing (no page, rail or side overflow at 1920×1080 down to 1024×768). Longer notes (`#srcNote`, `#ovNote`, how views are named) live in the `#about` dialog; any `[data-about]` button opens it (`data-about="ovl"` jumps to the overlays). `#helpBtn` (a "?" icon, labelled "How to use") opens the `#help` dialog, step-by-step instructions; keep it in step when controls change. Only C-arm and Injection start open (Table and Display collapsed); after that, group open state is in localStorage (`cvs.groups`). Full screen: `#fsBtn` or F, whole document.

## Roadmap (from discussion, not yet built)
1. **Realistic fluoro via DRR** (digitally reconstructed radiograph): ray-march a CT volume in WebGL2 at any C-arm angle; add heart motion, noise, edge enhancement.
2. **Precise anatomy overlay** from segmentations of the same CTCA scan (chambers + real coronary tree), drawn as contours, with near/far walls and hover highlighting in both views.
   - **Chosen dataset:** ImageCAS volumes (Kaggle, CC BY-NC 4.0) with ImageCAS-X labels (Zenodo, CC BY 4.0). ImageCAS-X provides 14 named coronary segments that map onto `VESSELS`, plus centrelines, meshes, and per-scan dominance, quality and disease descriptors. Chambers will come from TotalSegmentator `heartchambers_highres` (non-commercial). The project is therefore non-commercial unless licences change. See README "Data" and `tools/README.md`.
   - **Web export** (`data/web/<id>/`, from `tools/export_scan.py`): de-contrasted CT plus a coronary volume (occupancy, segment, distance from ostium) plus `vessels.json`, all in the patient coordinates above (cm, tree centred at the isocentre), x-fastest. Source frames differ: NIfTI files are RAS → sim `(−x, y, −z)`; ImageCAS-X `.vtk` centrelines and meshes are LPS → sim `(x, −y, −z)`. Always convert through the export, never ad hoc.
   - **Small branches:**
   - **Guide catheter:** `catheter.json` from `tools/export_catheter.py`.
   - **Chest beyond the scan:** `chest.u8.gz` from `tools/export_chest.py`.
   - **Cardiac motion and streaming:**
     - **Displacement:** `HEART_CORE` holds `hdisp(q)`, the displacement of a reference point: shortening, squeeze, twist, swing `uHtr`, uneven field and buckling `uHb`. `heartDisp()` is its exact CPU twin; keep the two in step.
     - **Where it's applied:** `hw()` in `DRR_RAY` is the backward warp (fixed-point inverse), applied in `tc()`. `hfw()` moves the overlay. `heartForward()` moves the catheter points, labels and picking.
     - **Timing:** `heartPhase(ht)` sets the per-frame phases from `lvCurve()`. The heart only moves during a cine run (`state.motion`). Heart time `ht` starts at 0 (end-diastole) with the run, and `drrCine` ends the run on the next beat boundary. Every component is zero at f = 0, so start and end don't jump. Both DRR passes re-render on every pulse during a run.
     - **Check it with a filmstrip, not single screenshots:** call `sim.frame(at)` at successive 1/15 s times and draw the DRR canvas into an overlay canvas. A single capture can't show the time course.
     - The shared uniforms live in `HEART_U`; `heartFrame()` sets them from the CT chambers.
     - `drrCine()` returns `{fill, washF, wash, t, hm}`. It integrates the fill and washout fronts with diastolic-weighted flow, on 15 pulses/s time. `conc()` in the iodine pass gives the diluted, mottled front and the proximal-first washout.
     - Both passes re-render on every pulse during a run, because the cache keys include `hm` and the front positions.
     - `window.sim` exposes `heart`, `heartForward` and `cine` for checks.
     - With it loaded (`uChest = 1`), pass A steps finely through the CT box and in 0.15 cm steps through the chest elsewhere (`chestSeg`). It blends CT → chest over the CT's outer `TUNE.chestFade` cm.
     - Without it, the older path applies: CT edge voxels extended outward, fading to flat tissue in the body ellipse.
     - `catChord()` in `DRR_RAY` sums the ray's length inside the tube's straight pieces (`uCat[64]`, `uCatN`). Pass A adds the radiopaque tube (`TUNE.cath`); pass B adds its contrast-filled lumen.
     - The CT pass cache key includes `inj` and `cath`, because the catheter changes with the side.
     - **Grown from the CT:** coronary G channel = parent segment + 16 (`CT_BRANCH`), so always take `seg & 15` for the segment or side. They're this patient's anatomy.
     - **Illustrative fine branches:** `tools/synth_branches.py`, written to `synthetic.u8.gz` (1–127 left, 129–255 right). They are *not* this patient's: keep them labelled on the page, switchable (`state.fine`, `drr.setFine`), and out of hover, SCCT and the overlay.
3. **Better room view:** hand-built geometry and the "Close on heart" camera are done.
   - **Camera:** `setRoomView('room' | 'heart')` tweens the orbit target and camera position in `roomCamStep`. Heart view targets `tableG.position` and follows table moves. Orbit limits apply after the tween.
   - **Stand:** the stand's `holder` sits at (0, 0, −88), because the arc always passes through that point, and `rotation.z = −lao`.
   - Licensed glTF models remain optional.
4. Quiz mode: random projection, name the angle or a highlighted vessel.

**Current plan (owner's phases, in order):**
1. Heart motion + contrast streaming.
2. ~~Code health: modules, one shared DRR engine, automatic screenshot checks.~~ Done.
3. ~~Layout: no scrolling, full screen, collapsible controls, a "choose heart" dropdown.~~ Done.
4. ~~A written protocol for preparing new hearts from ImageCAS.~~ Done: `tools/PROTOCOL.md`. Keep it in step with the scripts: when a tool's arguments, outputs or checkpoints change, update the protocol too.

See README "Roadmap" (done phases, open items) and "Known limitations". Older notes follow.
Suggested order: ~~pick a CTCA dataset~~ → ~~DRR in `index.html`~~ (done, model renderer kept as fallback) → ~~CT coronary overlay with hover~~ → ~~CT chambers (TotalSegmentator)~~ → ~~room polish~~ (done) → quiz mode (roadmap item 4). The open items (validation, teaching per view, learn/quiz mode, more anatomy, hardening) are in README "Roadmap"; don't start them unless asked. Older order for reference: per-preset table framing → realism (catheter, motion, chest background) → quiz mode. Data-prep scripts (Python) go in `tools/`; new hearts follow `tools/PROTOCOL.md`, with per-heart settings (block, dominance, chest landmarks) in `tools/hearts/<id>.json`. Raw data goes in the git-ignored `data/raw/`, and only small web-ready derived files are committed.

## Notes
- The DRR and its coronary overlay are one real, right-dominant heart. The chambers and the fallback image are a simplified right-dominant model, and the chambers are only shown in model mode. Say so in the UI (the "How the views are named" notes and `#srcNote` do).
- The original was published as a claude.ai artifact; that copy relied on the artifact host adding the html/head/body skeleton. `index.html` here is a complete document that loads `src/` as modules, so it can't be published as a single-file artifact without bundling.
