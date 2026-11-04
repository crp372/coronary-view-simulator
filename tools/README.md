# tools/

Data-prep scripts (Python) that turn raw CT and labels into small web-ready files for `index.html`.

| Script | Does |
|---|---|
| `pick_scan.py` | Ranks ImageCAS-X scans: quality 4, right-dominant, no disease. Ordered by key-segment coverage, then field of view. Standard library only. |

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
