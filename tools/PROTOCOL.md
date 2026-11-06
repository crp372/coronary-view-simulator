# Preparing a new heart

How to take one ImageCAS scan from download to a heart you can choose in the simulator. It's written from the first heart (scan 814, right-dominant) and was then followed step by step on a second (scan 905, left-dominant). Numbers from both are given at each checkpoint, so you can tell whether a new scan looks normal.

Run every command from the repository root. Once the data is downloaded, the computing takes about 3 minutes on an Apple M-series Mac. Allow about 30 minutes in all, most of it for looking at the check images and fitting the chest.

| Step | Command (scan `<id>`) | Takes | Writes |
|---|---|---|---|
| 1. Choose a scan | `python3 tools/pick_scan.py --dominance R\|L\|Co` | seconds | nothing |
| 2. Get its block | Kaggle download, `7zz x` | an hour or more (18 GB) | `data/raw/imagecas/extracted/<block>/` |
| 3. Preview it | `tools/preview_scan.py <id>` | 2 s | `data/raw/preview/<id>_*.png` |
| 4. Segment the chambers | `TotalSegmentator … -ta heartchambers_highres` | 45 s | `data/raw/totalseg/<id>/heartchambers/` |
| 5. Export the CT and tree | `tools/export_scan.py <id>` | 75 s | `data/web/<id>/` ct, coronary, synthetic, vessels, meta |
| 6. Export the chambers | `tools/export_chambers.py <id>` | 10 s | `chambers.bin.gz`, `chambers.json` |
| 7. Shape the catheters | `tools/export_catheter.py <id>` | 5 s | `catheter.json` |
| 8. Fit the chest | `tools/export_chest.py <id> --measure`, then without | 15 s | `tools/hearts/<id>.json`, `chest.u8.gz`, `chest.json` |
| 9. Check the export | `tools/check_export.py <id>` | 10 s | `data/raw/preview/<id>_export_check.png` |
| 10. Add it to the app | an entry in `data/web/hearts.json` | | |
| 11. Look at it in the app | `?heart=<id>`, the checklist below | 10 min | |
| 12. Commit | | | |

Steps 4 and 5 must run in that order: the export uses the chamber masks to keep branches grown from the CT out of the blood pool, and to grow the illustrative fine branches over the heart's surface. Without the masks it still runs, but leaves both out.

## Before you start (once per computer)

Set up the two Python environments and the TotalSegmentator licence as described in [tools/README.md](README.md):
- `.venv` (Python 3.12, `tools/requirements.txt`), for the tools.
- `.venv-totalseg`, with a personal, free, non-commercial licence set by `totalseg_set_license`.

You also need ImageCAS-X unpacked in `data/raw/imagecas-x/` (1.4 GB, once for all scans), and for downloads, a Kaggle account and `7zz` (`brew install sevenzip`).

Everything under `data/raw/` is git-ignored. Only the web export (`data/web/<id>/`, about 7 MB) and the small settings files are committed.

## 1. Choose a scan

```bash
python3 tools/pick_scan.py --dominance L -n 15
```

`--dominance` is `R` (right, the default), `L` (left) or `Co` (co-dominant). The script keeps scans with excellent image quality (4) and no disease, then ranks them by how many key segments have a centreline, and then by field of view. Each line gives the scan, its block, its field of view, and the length of each labelled segment in cm.

Choose one that has:
- **All key segments** (8/8), or know which one is missing.
- **A left main (`LM`)**, even a short one. The JL4 catheter is aimed at it, so a scan with separate LAD and LCx ostia needs a change to `export_catheter.py`.
- **A field of view of at least about 18 cm**, so the whole heart and the great vessels' roots fit.
- **Preferably a block you already have**: each block is 18 GB.

Candidates found so far (quality 4, no disease):

| Dominance | Done | Next best |
|---|---|---|
| Right (227 scans) | 814 | 822, 975, 844, 938, all in block 801-1000 |
| Left (12) | 905 (dry run) | 717 (601-800), 312 (201-400), 937 (801-1000) |
| Co-dominant (8) | 925 | 153 (1-200), 757 (601-800) |

**A heart with disease.** `pick_scan.py` keeps only scans without disease, and ImageCAS-X says only *whether* a scan has disease, not where or how much. Most diseased scans have no clear narrowing in their labels. To find one with a focal stenosis, screen the labels (no CT needed), then confirm on the CT:

```bash
.venv/bin/python tools/screen_stenosis.py --block 1-1000 --min 50
```

Prefer a narrowing of 50% or more in a main vessel with a reference diameter of at least 2.5 mm, and not marked "tapering". The healthy hearts show nothing at 40% or more. Then download the block and check the lesion on the CT: a straightened view along the vessel and cross-sections through it should show plaque narrowing the lumen, and no slab seam at the lesion's level (a seam can mimic a stenosis). Done: 575 (mid LAD, about 55%). Next best: 267 (mid LAD, about 50%, block 201-400).

## 2. Get the scan's block

The block is the 200-case group the scan belongs to: scan 905 is in `801-1000`. The tools work it out from the scan number, so `--block` is only needed for an unusual layout. If the block isn't in `data/raw/imagecas/extracted/` yet, download and unpack it as described in [tools/README.md](README.md) ("ImageCAS volumes"), changing `801-1000` to the block you need.

Check that these files exist:

```bash
ls data/raw/imagecas/extracted/<block>/<id>.img.nii.gz data/raw/imagecas-x/ImageCAS-X_dataset/centerlines/<id>.coronary_*_centerline.vtk
```

## 3. Preview it

```bash
.venv/bin/python tools/preview_scan.py <id>
```

Open `data/raw/preview/<id>_projections.png` and `<id>_slices.png`. Look for:
- **The coronary tree (right-hand panels):** the segments you expect for the dominance. In a left-dominant heart, the PDA and PLA (`L-PDA`, `L-PLA`) come off the LCx and the RCA is short. Look for no obvious gaps.
- **The labels sit on the vessels** in the slab images.
- **The field of view** covers the whole heart, and the image is sharp, without motion steps.

Stop here and choose another scan if any of these fail.

## 4. Segment the chambers (TotalSegmentator)

```bash
.venv-totalseg/bin/TotalSegmentator -i data/raw/imagecas/extracted/<block>/<id>.img.nii.gz -o data/raw/totalseg/<id>/heartchambers -ta heartchambers_highres -d mps
```

It takes about 45 s with `-d mps` (use `-d cpu` elsewhere; that's slower). It writes seven masks: both ventricles and atria, the myocardium, the aorta and the pulmonary artery.

## 5. Export the CT and the coronary tree

```bash
.venv/bin/python tools/export_scan.py <id>
```

What it does is described in [tools/README.md](README.md): de-contrasting, the bone mask, the coronary volume, branches grown from the CT, illustrative fine branches, and the centreline tree. Check what it prints:

| | 814 | 905 | 925 | 575 | Worry if |
|---|---|---|---|---|---|
| grown from the CT | 0.31 mL | 0.46 mL | 0.05 mL | 0.35 mL | over about 1 mL (growth has leaked into a chamber or vein), or "skipping" (the masks from step 4 are missing) |
| synthetic twigs | 183, 304 cm, 0.64 mL | 165, 272 cm, 0.54 mL | 160, 250 cm, 0.48 mL | 192, 319 cm, 0.61 mL | none ("skipping" again) |
| vessels | 10 | 10 | 10 | 12 | far fewer than the labelled segments |
| max ostium dist | 194 mm | 160 mm | 156 mm | 205 mm | over 255 mm: the cine fill is stored in whole mm up to 255 |
| ct.u8.gz | 4.7 MB | 5.2 MB | 4.3 MB | 4.6 MB | much larger: a bigger field of view; the app copes, but it loads more slowly |

## 6. Export the chambers

```bash
.venv/bin/python tools/export_chambers.py <id>
```

It prints each structure's volume. Check that they're plausible for an adult heart at end-diastole:

| mL | LV | RV | LA | RA | Myocardium | Aorta | PA |
|---|---|---|---|---|---|---|---|
| 814 | 135 | 157 | 84 | 93 | 149 | 136 | 32 |
| 905 | 100 | 115 | 62 | 72 | 104 | 101 | 34 |
| 925 | 88 | 111 | 69 | 68 | 88 | 102 | 60 |
| 575 | 117 | 127 | 81 | 83 | 111 | 206 | 58 |

The aorta and PA are always cut off at the edge of the scan, so theirs vary most. A chamber at a fraction of the others, or missing, means TotalSegmentator failed. Look at its mask before going on. The app also takes the heart's frame for the cardiac motion from the LV, RV and LA here, so all three must be present.

## 7. Shape the guide catheters

```bash
.venv/bin/python tools/export_catheter.py <id>
```

It prints the JL4 and JR4 paths, each about 57 cm long, with about 50 points (64 at most). It fails with `KeyError: 'LM'` or `'RCA'` when the tree has no vessel with that label (see step 1). The shape is checked in the app (step 11).

## 8. Fit the synthetic chest

The CT covers only about 20 × 20 × 14 cm. Outside it, the image shows a synthetic chest whose landmarks are fitted to each scan. A poor fit shows as a step at the scan's edges: the spine jumping sideways, or skin or lung ending abruptly.

1. Measure:

   ```bash
   .venv/bin/python tools/export_chest.py <id> --measure
   ```

   It prints the CT's box, then a suggestion for each landmark, with the default and how to judge it.
2. Write `tools/hearts/<id>.json`, starting from a copy of `tools/hearts/814.json`. Change `scan`, `block`, `dominance`, `markings.seed` (use the scan number), and the `chest` landmarks:

   | Landmark | Set it to |
   |---|---|
   | `midline_x` | the spine's x, as measured |
   | `spine_y` | the vertebral bodies' centre, as measured (their front − 2 cm) |
   | `body_y`, `body_b` | the body outline's centre and front–back half-depth: `body_y + body_b` about 0.5 cm in front of the highest skin measured. Keep `body_b` at 14 and move `body_y`, unless the patient is very slim or broad. |
   | `body_a` | side-to-side half-width: keep 20.5, unless there's lung at a side face and that face is near `midline_x ± body_a` |
   | `dome_r`, `dome_l` | (z of the top of each diaphragm dome, x offset from the midline). The right dome is usually 2–3 cm higher (smaller z). Each top sits a few cm above the lowest lung measured on that side. |

   For 925, both lungs end inside the scan (lowest lung at z 3.1 right, 3.4 left), so the domes were raised to `dome_r` [0.0, −7.0] and `dome_l` [1.5, 7.0], about 3 and 2 cm above, as in 814.

   For 905, `--measure` gave a spine at x −4.2, vertebral fronts at y −4.3 and skin up to 9.3. So: `midline_x` −4.2, `spine_y` −6.3, `body_y` −4.2 (with `body_b` 14), and the default domes, because both lungs still reach the bottom of the scan.
3. Export:

   ```bash
   .venv/bin/python tools/export_chest.py <id>
   ```

   It says `landmarks from tools/hearts/<id>.json`. If it says "using the default chest", the file is missing or misnamed.

**Scan 814's own fit** was done by eye, before `--measure` existed. `--measure` puts its spine about 2 cm further forward (centre at −7.1, against −9.0 in the fit). If a step in the spine shows above or below the scan in 814's lateral views, try `spine_y: -7.1` in `tools/hearts/814.json`.

## 9. Check the export

```bash
.venv/bin/python tools/check_export.py <id>
```

`data/raw/preview/<id>_export_check.png` shows AP and lateral DRRs made from the exported files alone:
- **De-contrasted:** no bright heart or aorta, only bone and soft tissue. A bright aorta along the spine means the bone mask kept it (see "How the bone mask is built" in tools/README.md).
- **Left and right injection:** each tree is dark, and the other tree is absent. In a left-dominant heart the right injection is small; that's expected.
- **vessels.json:** the labelled centrelines lie on the injected vessels, and the red cross (the isocentre) is near the middle of the tree.

## 10. Add it to the app

Add an entry to `data/web/hearts.json`:

```json
{"id": "905", "name": "CT 905 · left-dominant", "short": "CT 905", "source": "ImageCAS scan 905", "dominance": "left", "dir": "data/web/905/"}
```

- `name` appears in the Heart dropdown.
- `short` goes in the monitor's corner readout.
- `source` names the scan in the notes on the page.
- `dominance` is `right`, `left` or `co`.
- `finding` (optional) names any disease, and the notes on the page add it to the heart's description: "a narrowing of the mid LAD (about 55% by its lumen labels), from mostly non-calcified plaque".

Leave `default` alone unless the new heart should open first.

## 11. Look at it in the app

Serve the folder (`python3 tools/serve.py`) and open `http://localhost:8000/?heart=<id>`, or choose the heart from the dropdown. Go through:

- [ ] **It loads the CT**, not the model heart. The note under the presets names the scan, and the monitor's bottom-right readout says `DRR · CT <id>`. If it says "Simplified model heart", the reason is in "About this image".
- [ ] **Every left and right preset**, with the vessel labels on. Each label sits on its vessel, and the view shows roughly what its "best for" says. This heart's best angles can differ from the textbook by several degrees.
- [ ] **Framing:** the injected tree fits in the 20 cm field. The heart is centred on the whole tree, so a small non-dominant RCA can sit near an edge, as 905's does in LAO. Pan the table to check it's all there; per-view table offsets are in the backlog.
- [ ] **Coronary overlay, chambers, segment numbers:** the ribbons and outlines line up with the image, and hovering names the right vessel and segment.
  - In a left-dominant heart, segments 15 (L-PDA) and 18 (L-PLB) come from the LCx, and there's no 4 or 16.
  - Segments 1–3 are thirds of the RCA "up to the crux", so in a non-dominant RCA (which doesn't reach the crux), their split is only nominal.
- [ ] **Catheter:** in each preset, the JL4 or JR4 tip sits in its ostium, and its course down the ascending aorta looks plausible.
- [ ] **Chest:** in AP, the lateral and the caudal views, there's no step in the spine, ribs, skin or lungs at the scan's edges.
- [ ] **Cine run:** contrast fills, holds and washes out, and the heart beats during the run and stops at its end without a jump.
- [ ] **Room view:** the heart sits on the table at the isocentre, and the chambers and tree are in the right places.
- [ ] **Fine branches off:** the image still looks right with only the CT's own vessels.

Then run the screenshot checks (`npm run check`). They use the default heart, so they should still pass unchanged. The heart-list check reads `hearts.json`, so it expects the new entry.

## 12. Commit

Commit:
- `data/web/<id>/`: about 7 MB, from steps 5–8.
- `tools/hearts/<id>.json`.
- `data/web/hearts.json`.
- Any script change you needed, with the reason.

Never commit `data/raw/`. Record the heart in the table below.

Then publish it: `npm run deploy` (`npx wrangler login` first if it says the login has expired), and open https://coronary.chiranpandey.com/?heart=<id> to check the CT image loads there too.

## Licences

Every heart is subject to:
- **ImageCAS (the CT):** CC BY-NC 4.0, non-commercial.
- **ImageCAS-X (the labels):** CC BY 4.0.
- **TotalSegmentator `heartchambers_highres`:** a free non-commercial licence. Its author gave written permission (2026-11-05) to publish meshes and data derived from it for this project, including further hearts prepared the same way: see [docs/publishing/totalsegmentator-permission.md](../docs/publishing/totalsegmentator-permission.md).

The page shows the attribution from each heart's `meta.json` and `chambers.json`, and the About dialog's "Credits and licences" section covers all hearts; update it if a heart comes from a new source.

## Hearts prepared

| Scan | Dominance | Block | Done | Notes |
|---|---|---|---|---|
| 814 | Right | 801-1000 | 2026-11 | The first heart. Chest fitted by eye; spine possibly 2 cm too far back (step 8). |
| 905 | Left | 801-1000 | 2026-11 (dry run of this protocol) | 8/8 key segments, 20.5 cm field. The RCA is small and near the image's edge in LAO. |
| 925 | Co-dominant | 801-1000 | 2026-11 | 8/8 key segments, 18.9 cm field. PDA and a short PLB from the RCA, a PLB from the LCx. Little grown from the CT (0.05 mL). In LAO 40° at 20 cm, the proximal RCA's C reaches the image's left edge. |
| 575 | Right, mid-LAD stenosis | 401-600 | 2026-11 | The heart with disease, found with `screen_stenosis.py`: the LAD narrows from about 3.5 to 1.3 mm at 40–47 mm from the ostium, from eccentric, mostly non-calcified plaque (checked on the CT, no seam). Shows best in LAO cranial. The aorta is the largest so far (206 mL). The skin reaches the scan's front face. |
