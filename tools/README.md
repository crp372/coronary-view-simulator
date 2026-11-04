# tools/

Data-prep scripts (Python) that turn raw CT and labels into small web-ready files for `index.html`.

| Script | Does |
|---|---|
| `pick_scan.py` | Ranks ImageCAS-X scans: quality 4, right-dominant, no disease. Ordered by key-segment coverage, then field of view. Standard library only. |
| `preview_scan.py` | Renders PNGs of a scan with its labels into `data/raw/preview/`: slab MIPs, AP and lateral MIPs, a rough DRR, and the coronary tree. |
| `export_scan.py` | Writes the web-ready files for a scan to `data/web/<id>/` (format below). |
| `export_chambers.py` | Turns TotalSegmentator heart-chamber masks into meshes in `data/web/<id>/chambers.*` (see "Heart chambers" below). |
| `check_export.py` | Renders AP and lateral DRRs from the exported files only: de-contrasted, left injection, right injection, and `vessels.json`. |

## Web export format (`data/web/<id>/`)

- **Coordinates:** simulator patient coordinates in cm (x = patient's left, y = anterior, z = feet). The coronary tree's bounding-box centre sits at the isocentre.
- **Volumes:** x varies fastest, then y, then z, so they upload directly as WebGL2 3D textures. Gzip-compressed; decompress in the browser with `DecompressionStream('gzip')`.
- **Each `origin_cm`** in `meta.json` is the centre of voxel (0,0,0).

| File | Contents |
|---|---|
| `ct.u8.gz` | De-contrasted CT, 0.91 × 0.91 × 1 mm. uint8, HU = v × 10 − 1024. Everything that isn't bone and is above 50 HU (blood pool, enhanced myocardium, coronaries, lung vessels) is set to 50 HU, so the scan looks unenhanced. The renderer adds iodine back only where the injection goes. |
| `coronary.rgb8.gz` | Same spacing, cropped to the tree. R = lumen occupancy 0–255 (partial-volume fraction, so thin distal vessels keep their projected density). G = ImageCAS-X segment label 0–14. B = distance from the ostium in mm, for the cine fill. |
| `vessels.json` | One entry per vessel path, in the `VESSELS` shape: `id`, `sys` (L/R), `seg`, `lab`, `parent`, `pts` (cm), `r` (radius in cm, from the mask's distance transform; minimum about one voxel), `sdist` (cm from the ostium). |
| `meta.json` | Grid dims, spacing and origins, encodings, the offset that was subtracted to centre the tree, and attribution. |

**How the bone mask is built:**
1. Find enhanced blood first. Smooth the CT slightly and take regions between 250 and 600 HU that are wide enough to hold a ball about 3 mm across. Some marrow (sternum, vertebral bodies) is also in that range, but it is wrapped in trabeculae and cortex. So a region counts as marrow, not blood, if at least 5% of a thin shell around it is above 300 HU. In scan 814, the aorta's shell has 0% above 300 HU and every marrow piece has at least 13%.
2. Cut the blood, plus a 3-voxel partial-volume rim, out of the voxels above 150 HU. Without this step the descending aorta, which lies on the spine, joins the vertebrae's connected piece and keeps its contrast.
3. Group what is left into connected pieces. A piece counts as bone if at least 3% of it lies within 3 voxels of cortex (above 700 HU).
4. Fill holes such as marrow slice by slice.

Blood is never part of the mask, so it gets clamped. Metal also counts as bone, so the ECG leads stay visible.

Run the scripts from a worktree with `--raw <main checkout>/data/raw`.

Set up the Python environment once. Use Python 3.12: scikit-image has no wheels for 3.15 yet.

```bash
$(brew --prefix python@3.12)/bin/python3.12 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
```

## Heart chambers (TotalSegmentator)

TotalSegmentator lives in its own environment, `.venv-totalseg` (Python 3.12, about 2 GB with PyTorch). Its `heartchambers_highres` model needs a free non-commercial licence: https://backend.totalsegmentator.com/license-academic/. Each person requests their own and sets it once:

```bash
$(brew --prefix python@3.12)/bin/python3.12 -m venv .venv-totalseg && .venv-totalseg/bin/pip install TotalSegmentator
```

```bash
read -s "?Licence number: " L && .venv-totalseg/bin/totalseg_set_license -l "$L"; unset L
```

Then segment the scan, which takes about 2 minutes on Apple silicon (`-d mps`), and export the meshes:

```bash
.venv-totalseg/bin/TotalSegmentator -i data/raw/imagecas/extracted/801-1000/814.img.nii.gz -o data/raw/totalseg/814/heartchambers -ta heartchambers_highres -d mps
```

```bash
.venv/bin/python tools/export_chambers.py 814
```

`export_chambers.py` writes `chambers.bin.gz` and `chambers.json` to `data/web/<id>/`:
- **Meshing:** each structure is block-averaged to about 1.4 mm, smoothed, and meshed with marching cubes at the 50% level.
- **`chambers.bin.gz`:** for each structure, int16 vertices in 0.01 cm, in the same centred simulator frame as `meta.json`, followed by uint16 triangle indices.
- **`chambers.json`:** the byte offsets, colours, names, volumes (mL), centroids and attribution.

On scan 814 the volumes are LV 135, RV 157, LA 84, RA 93 and myocardium 149 mL. The aorta and PA are cut off at the edges of the scan.

**Licence:** the TotalSegmentator licence forbids redistributing the *software*. Check whether its full agreement also covers publishing outputs, such as these meshes, before making the repository or app public.

## Chosen scan: 814

- Excellent image quality, right-dominant, no disease.
- Has all key segments: LM, LAD 15 cm, LCx, D1, D2, OM1, IM, RCA 12 cm, R-PDA, R-PLA.
- Widest field of view of the candidates: 23 × 23 × 14 cm.
- Backups in the same block: 822, 975, 844, 938.

## Raw data layout

Everything under `data/raw/` is git-ignored.

```
data/raw/
├── imagecas-x/     ImageCAS-X_dataset.zip, unpacked: labels, centrelines, meshes, Descriptors.xlsx
└── imagecas/       one 200-case block of ImageCAS volumes, unpacked
```

## 1. ImageCAS-X labels (Zenodo, CC BY 4.0)

- Record: https://zenodo.org/records/21887809
- File: `ImageCAS-X_dataset.zip`, 1.44 GB. No account needed. Skip `pretrained_weights.zip`.

```bash
mkdir -p data/raw/imagecas-x
curl -L -o data/raw/imagecas-x/ImageCAS-X_dataset.zip "https://zenodo.org/api/records/21887809/files/ImageCAS-X_dataset.zip/content"
```

`Descriptors.xlsx` lists dominance, image quality (0–4, 4 = excellent) and disease for each scan. `pick_scan.py` reads it, along with the centrelines and segmentation headers.

Centreline `.vtk` files are VTK 5.1 polydata. Some are binary and some ASCII. Each point carries a `segment_label` (1–14).

## 2. ImageCAS volumes (Kaggle, CC BY-NC 4.0)

- Dataset: https://www.kaggle.com/datasets/xiaoweixumedicalai/imagecas (needs a Kaggle account).
- The data comes as 200-case blocks. Each block is a split zip of about 18 GB:
  - `<block>.z01` … `<block>.z04`, 4.29 GB each
  - `<block>.change2zip`, the final part, under 1 GB
- Blocks are `1-200`, `201-400`, `401-600`, `601-800` and `801-1000`. Download only the block that contains the chosen scan. **For scan 814 that's `801-1000`:** five files, 17.8 GB in total.

Download through the Kaggle web page, or with the Kaggle CLI once you have set up your own API token:

```bash
for p in z01 z02 z03 z04 change2zip; do kaggle datasets download xiaoweixumedicalai/imagecas -f "801-1000.$p" -p data/raw/imagecas; done
```

Kaggle may wrap each file in its own zip, so unzip those first. Then rename the final part and extract with 7-Zip, which handles split archives (macOS `unzip` doesn't):

```bash
cd data/raw/imagecas && mv 801-1000.change2zip 801-1000.zip && 7zz x 801-1000.zip
```

(`brew install sevenzip` provides `7zz`.)

## Attribution

Cite both datasets wherever CT-derived content appears:

- Zeng A, Xu X, et al. *ImageCAS: A large-scale dataset and benchmark for coronary artery segmentation based on computed tomography angiography images.* Comput Med Imaging Graph, 2023.
- Bransby K, et al. *ImageCAS-X: a dataset and benchmark for coronary artery segmentation and centerline extraction in coronary CT angiography.* arXiv:2608.30404, 2026.
