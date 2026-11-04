"""Export TotalSegmentator heart-chamber masks as web-ready surface meshes.

    .venv/bin/python tools/export_chambers.py 814 [--block 801-1000] [--raw data/raw] [--web data/web]

Reads data/raw/totalseg/<id>/heartchambers/*.nii.gz (from TotalSegmentator -ta heartchambers_highres)
and data/web/<id>/meta.json (for the centring offset), and writes data/web/<id>/:
  chambers.bin.gz  per structure: int16 xyz vertices (units 0.01 cm, simulator coords, tree-centred),
                   then uint16 triangle indices (local to the structure). Offsets in chambers.json.
  chambers.json    structures (id, name, colour, offsets, counts, centroid), encoding, attribution.

Masks are block-averaged to ~1.4 mm, smoothed and meshed with marching cubes at the 50% level, so
surfaces are smooth enough to draw as rims in the overlay. The run needs the CT only for its grid.
"""
import argparse, gzip, json, os
import numpy as np
import nibabel as nib
from scipy import ndimage as ndi
from skimage.measure import marching_cubes

from export_scan import to_sim_grid, block_mean

STRUCTURES = [  # file stem, id, name, colour (matches the model heart's CHAMBERS in index.html)
    ('heart_ventricle_left', 'LV', 'Left ventricle', '#e0645a'),
    ('heart_ventricle_right', 'RV', 'Right ventricle', '#5b8fd9'),
    ('heart_atrium_left', 'LA', 'Left atrium', '#e39a4b'),
    ('heart_atrium_right', 'RA', 'Right atrium', '#6fc2b8'),
    ('aorta', 'Ao', 'Aorta', '#c97fb6'),
    ('pulmonary_artery', 'PA', 'Pulmonary artery', '#9a8be0'),
    ('heart_myocardium', 'Myo', 'Myocardium', '#c9c2a0'),
]
FACTOR = 3        # 0.45 × 0.45 × 0.5 mm → 1.36 × 1.36 × 1.5 mm
SMOOTH = 0.8      # Gaussian sigma in downsampled voxels
Q = 100           # vertex quantisation: 0.01 cm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan')
    ap.add_argument('--block', default='801-1000')
    ap.add_argument('--raw', default='data/raw')
    ap.add_argument('--web', default='data/web')
    args = ap.parse_args()
    seg_dir = f'{args.raw}/totalseg/{args.scan}/heartchambers'
    out = os.path.join(args.web, args.scan)
    meta = json.load(open(os.path.join(out, 'meta.json')))
    centre_mm = np.array(meta['centre_subtracted_cm']) * 10
    ct_img = nib.load(f'{args.raw}/imagecas/extracted/{args.block}/{args.scan}.img.nii.gz')

    blob, structures, offset = bytearray(), [], 0
    for stem, sid, name, colour in STRUCTURES:
        img = nib.load(f'{seg_dir}/{stem}.nii.gz')
        assert np.allclose(img.affine, ct_img.affine, atol=1e-3), f'{stem}: not on the CT grid'
        mask, sp, org = to_sim_grid(img)
        occ = ndi.gaussian_filter(block_mean(mask > 0, FACTOR), SMOOTH)
        occ = np.pad(occ, 1)  # close surfaces cut by the scan edge
        verts, faces, _, _ = marching_cubes(occ, 0.5)
        sp_ds = sp * FACTOR
        org_ds = org + sp * (FACTOR - 1) / 2 - sp_ds   # -sp_ds for the padding
        sim_cm = (org_ds + verts * sp_ds - centre_mm) / 10
        assert len(verts) < 65536, f'{stem}: {len(verts)} vertices, too many for uint16 indices'
        v16 = np.round(sim_cm * Q).astype('<i2')
        f16 = faces.astype('<u2')  # winding as marching_cubes gives it; the app draws both sides
        vo = offset
        blob += v16.tobytes(); offset += v16.nbytes
        fo = offset
        blob += f16.tobytes(); offset += f16.nbytes
        if offset % 4:
            pad = 4 - offset % 4; blob += b'\0' * pad; offset += pad
        ml = float((mask > 0).sum() * np.prod(sp)) / 1000
        structures.append(dict(id=sid, name=name, colour=colour, volume_ml=round(ml, 1),
                               centroid_cm=[round(float(c), 2) for c in sim_cm.mean(0)],
                               vertices=dict(offset=vo, count=len(verts)), indices=dict(offset=fo, count=f16.size)))
        print(f'{sid:4s} {ml:6.1f} mL  {len(verts):6d} vertices  {len(faces):6d} triangles')

    with gzip.open(os.path.join(out, 'chambers.bin.gz'), 'wb', compresslevel=9) as f:
        f.write(bytes(blob))
    info = dict(
        file='chambers.bin.gz', structures=structures,
        encoding='per structure: vertices int16 little-endian xyz in 0.01 cm (simulator coords, tree-centred '
                 'like meta.json), then indices uint16 little-endian triangles; offsets in bytes',
        source='TotalSegmentator heartchambers_highres on the ImageCAS CT (non-commercial licence)',
        attribution='Wasserthal J, et al. TotalSegmentator. Radiol Artif Intell 2023; heartchambers_highres '
                    'model under the TotalSegmentator non-commercial licence')
    with open(os.path.join(out, 'chambers.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print(f'chambers.bin.gz {os.path.getsize(os.path.join(out, "chambers.bin.gz")) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
