"""Preview an ImageCAS scan with its ImageCAS-X coronary labels.

Writes two PNGs:
  <id>_slices.png       axial / coronal / sagittal 10 mm slab MIPs, labels overlaid
  <id>_projections.png  AP and left-lateral views: CT MIP, quick parallel-beam DRR,
                        coronary tree coloured by segment

    .venv/bin/python tools/preview_scan.py 814 [--block 801-1000] [--raw data/raw] [--out data/raw/preview]

Display conventions: axial seen from the feet, coronal/AP seen from the front
(patient's right on screen left), sagittal/lateral seen from the patient's left
(anterior on screen left). Same as the simulator's AP and left-lateral views.
"""
import argparse, os
import numpy as np
import nibabel as nib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Patch

SEGMENTS = {1: 'LM', 2: 'LAD', 3: 'LCx', 4: 'D1', 5: 'D2', 6: 'OM1', 7: 'OM2', 8: 'IM',
            9: 'RCA', 10: 'R-PDA', 11: 'R-PLA', 12: 'L-PDA', 13: 'L-PLA', 14: 'Other'}
# Left system warm, right system cool (matches the simulator's amber LCA / cyan RCA)
COLOURS = {1: '#ffd54a', 2: '#ffb000', 3: '#ff7a1a', 4: '#ffe08a', 5: '#e8c56a', 6: '#ff5a5a',
           7: '#d94a8c', 8: '#c58cff', 9: '#3ee0ff', 10: '#2f9bff', 11: '#5effc0',
           12: '#ff9ad0', 13: '#b07cff', 14: '#bbbbbb'}
WINDOW = (-200, 600)  # CTA window, HU
SLAB_MM = 10


def load_ras(path):
    """Load a NIfTI reoriented to RAS: index 0 → patient's right, 1 → anterior, 2 → superior."""
    img = nib.as_closest_canonical(nib.load(path))
    return np.asanyarray(img.dataobj), img.header.get_zooms()[:3]


def view(a):
    """Orient a RAS array reduced along one axis for display. The remaining axes are
    (cols, rows) in RAS order, both flipped: axial → rows anterior→posterior, cols R→L;
    coronal → rows sup→inf, cols R→L; sagittal → rows sup→inf, cols anterior→posterior."""
    return a.T[::-1, ::-1]


def extent(shape, zooms, axis):
    ax = [a for a in range(3) if a != axis]
    return [0, shape[ax[0]] * zooms[ax[0]], 0, shape[ax[1]] * zooms[ax[1]]]


def label_rgba(lab2d):
    rgba = np.zeros(lab2d.shape + (4,))
    for k, c in COLOURS.items():
        m = lab2d == k
        if m.any():
            rgba[m] = matplotlib.colors.to_rgba(c)
    return rgba


def top_label(lab):
    """Collapse a label slab to 2D, keeping the highest non-zero label along the slab axis."""
    return lab.max(axis=-1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan')
    ap.add_argument('--block', default='801-1000')
    ap.add_argument('--raw', default='data/raw')
    ap.add_argument('--out', default='data/raw/preview')
    args = ap.parse_args()
    ct, z = load_ras(f'{args.raw}/imagecas/extracted/{args.block}/{args.scan}.img.nii.gz')
    lab, _ = load_ras(f'{args.raw}/imagecas-x/ImageCAS-X_dataset/segmentations/{args.scan}.coronary.nii.gz')
    lab = lab.astype(np.uint8)
    os.makedirs(args.out, exist_ok=True)
    present = [k for k in SEGMENTS if (lab == k).any()]
    legend = [Patch(color=COLOURS[k], label=SEGMENTS[k]) for k in present]
    centre = np.round(np.argwhere(lab > 0).mean(axis=0)).astype(int)

    # Slab MIPs through the centre of the coronary tree
    fig, axs = plt.subplots(1, 3, figsize=(16, 6.2), facecolor='black')
    titles = {2: 'Axial (from feet)', 1: 'Coronal (from front)', 0: 'Sagittal (from patient\'s left)'}
    for a, axis in zip(axs, (2, 1, 0)):
        half = int(round(SLAB_MM / 2 / z[axis]))
        sl = [slice(None)] * 3
        sl[axis] = slice(max(centre[axis] - half, 0), centre[axis] + half + 1)
        ct_slab = np.moveaxis(ct[tuple(sl)], axis, -1).max(axis=-1)
        lab_slab = top_label(np.moveaxis(lab[tuple(sl)], axis, -1))
        ext = extent(ct.shape, z, axis)
        a.imshow(view(ct_slab), cmap='gray', vmin=WINDOW[0], vmax=WINDOW[1], extent=ext)
        a.imshow(label_rgba(view(lab_slab)), extent=ext, alpha=0.85)
        a.set_title(f'{titles[axis]} — {SLAB_MM} mm slab MIP', color='w')
        a.axis('off')
    fig.legend(handles=legend, loc='lower center', ncol=len(legend), frameon=False, labelcolor='w')
    fig.suptitle(f'ImageCAS {args.scan} with ImageCAS-X labels (W {WINDOW[1]-WINDOW[0]} / L {sum(WINDOW)//2} HU)',
                 color='w', fontsize=14)
    fig.tight_layout(rect=(0, 0.06, 1, 0.95))
    p1 = os.path.join(args.out, f'{args.scan}_slices.png')
    fig.savefig(p1, dpi=110, facecolor='black')
    plt.close(fig)

    # Whole-volume projections: AP (along y) and left lateral (along x)
    mu = np.clip(ct.astype(np.float32) + 1000, 0, None) / 1000 * 0.02  # ~μ in 1/mm, water ≈ 0.02
    fig, axs = plt.subplots(2, 3, figsize=(15, 9.5), facecolor='black')
    for row, (axis, name) in enumerate(((1, 'AP'), (0, 'Left lateral'))):
        ext = extent(ct.shape, z, axis)
        mip = np.moveaxis(ct, axis, -1).max(axis=-1)
        path = np.moveaxis(mu, axis, -1).sum(axis=-1) * z[axis]
        drr = 1 - np.exp(-path * 0.35)  # bright = more attenuation, shown inverted like fluoro
        tree = top_label(np.moveaxis(lab, axis, -1))
        axs[row, 0].imshow(view(mip), cmap='gray', vmin=WINDOW[0], vmax=1200, extent=ext)
        axs[row, 0].set_title(f'{name}: CT MIP', color='w')
        axs[row, 1].imshow(view(drr), cmap='gray_r', extent=ext)
        axs[row, 1].set_title(f'{name}: quick DRR (parallel beam)', color='w')
        axs[row, 2].imshow(np.zeros(view(tree).shape), cmap=ListedColormap(['black']), extent=ext)
        axs[row, 2].imshow(label_rgba(view(tree)), extent=ext)
        axs[row, 2].set_title(f'{name}: coronary tree', color='w')
        for a in axs[row]:
            a.axis('off')
    fig.legend(handles=legend, loc='lower center', ncol=len(legend), frameon=False, labelcolor='w')
    fig.suptitle(f'ImageCAS {args.scan}: projections of the whole {ct.shape[0]*z[0]/10:.1f} × '
                 f'{ct.shape[1]*z[1]/10:.1f} × {ct.shape[2]*z[2]/10:.1f} cm volume', color='w', fontsize=14)
    fig.tight_layout(rect=(0, 0.05, 1, 0.95))
    p2 = os.path.join(args.out, f'{args.scan}_projections.png')
    fig.savefig(p2, dpi=110, facecolor='black')
    plt.close(fig)
    print(p1, p2, sep='\n')


if __name__ == '__main__':
    main()
