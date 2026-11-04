"""Render check images from an export in data/web/<id>/ (reads only the exported files).

    .venv/bin/python tools/check_export.py 814 [--web data/web] [--out data/raw/preview]

<id>_export_check.png: rows AP and left lateral; columns de-contrasted DRR, left injection,
right injection, vessels.json centrelines. Parallel-beam projection along the volume axes,
dark = more attenuation, as on a fluoro monitor. Iodine strength here is a rough guess; the
real renderer will tune it.
"""
import argparse, gzip, json, os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

MU_WATER = 0.02      # 1/mm
IODINE_HU = 12000    # extra HU-equivalent at full lumen occupancy (undiluted contrast, fluoro kV)


def load(web, meta, key, channels=1):
    m = meta[key]
    raw = gzip.open(os.path.join(web, m['file'])).read()
    nx, ny, nz = m['dims']
    a = np.frombuffer(raw, np.uint8).reshape(nz, ny, nx, *([channels] if channels > 1 else []))
    return np.moveaxis(a, (0, 1, 2), (2, 1, 0))  # → [x, y, z]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan')
    ap.add_argument('--web', default='data/web')
    ap.add_argument('--out', default='data/raw/preview')
    args = ap.parse_args()
    web = os.path.join(args.web, args.scan)
    meta = json.load(open(os.path.join(web, 'meta.json')))
    vessels = json.load(open(os.path.join(web, 'vessels.json')))
    hu = load(web, meta, 'ct').astype(np.float32) * 10 - 1024
    cor = load(web, meta, 'coronary', 3)
    sp = np.array(meta['ct']['spacing_cm']) * 10
    o_ct, o_cor = np.array(meta['ct']['origin_cm']), np.array(meta['coronary']['origin_cm'])
    right_vox = np.isin(cor[..., 1] & 15, meta['coronary']['right_segments'])   # grown branches: parent + 16
    # per-side occupancy, brought onto the CT grid when the coronary volume is finer (block mean)
    f = np.round(np.array(meta['ct']['spacing_cm']) / np.array(meta['coronary']['spacing_cm'])).astype(int)
    occ = {s: np.where((cor[..., 1] > 0) & (right_vox if s == 'R' else ~right_vox), cor[..., 0] / 255, 0) for s in 'LR'}
    if (f > 1).any():
        n = np.array(cor.shape[:3]) // f * f
        occ = {s: a[:n[0], :n[1], :n[2]].reshape(n[0] // f[0], f[0], n[1] // f[1], f[1], n[2] // f[2], f[2]).mean(axis=(1, 3, 5))
               for s, a in occ.items()}
        o_cor = o_cor + np.array(meta['coronary']['spacing_cm']) * (f - 1) / 2
    off = np.round((o_cor - o_ct) * 10 / sp).astype(int)

    def with_iodine(side):
        h = hu.copy()
        a = occ[side]
        sl = tuple(slice(o, o + n) for o, n in zip(off, a.shape))
        h[sl] += a * IODINE_HU
        return h

    vols = {'De-contrasted CT': hu, 'Left injection': with_iodine('L'), 'Right injection': with_iodine('R')}
    lo, hi = o_ct, o_ct + np.array(meta['ct']['dims']) * sp / 10
    fig, axs = plt.subplots(2, 4, figsize=(19, 9.5), facecolor='black')
    # AP: project along y, seen from front → screen x = patient's left on the right; screen up = head
    # Left lateral: project along x, seen from patient's left → anterior on screen left
    views = [('AP', 1, lambda a: a.T, (lo[0], hi[0], hi[2], lo[2]), (0, 2)),
             ('Left lateral', 0, lambda a: a.T[:, ::-1], (hi[1], lo[1], hi[2], lo[2]), (1, 2))]
    for row, (name, axis, orient, ext, (cx, cy)) in enumerate(views):
        for col, (title, h) in enumerate(vols.items()):
            path = (np.clip(1 + h / 1000, 0, None) * MU_WATER).sum(axis=axis) * sp[axis]
            img = orient(np.exp(-path * 0.5))
            axs[row, col].imshow(img, cmap='gray', extent=ext, vmin=np.percentile(img, 1), vmax=np.percentile(img, 99.5))
            axs[row, col].set_title(f'{name}: {title}', color='w')
        a = axs[row, 3]
        a.set_facecolor('black')
        for v in vessels:
            p = np.array(v['pts'])
            a.plot(p[:, cx], p[:, cy], color='#ffb000' if v['sys'] == 'L' else '#3ee0ff', lw=1.5)
            a.text(*p[len(p) // 2, [cx, cy]], v['id'], color='w', fontsize=8)
        a.set_xlim(ext[0], ext[1]); a.set_ylim(ext[2], ext[3]); a.set_aspect('equal')
        a.set_title(f'{name}: vessels.json (cm)', color='w')
        a.plot(0, 0, '+', color='#ff5a5a', ms=12)
        for ax_ in axs[row, :3]:
            ax_.plot(0, 0, '+', color='#ff5a5a', ms=12)
    for a in axs.flat:
        a.tick_params(colors='#888'); [s.set_color('#444') for s in a.spines.values()]
    fig.suptitle(f'Export check, scan {args.scan} (red + = isocentre)', color='w', fontsize=14)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    os.makedirs(args.out, exist_ok=True)
    p = os.path.join(args.out, f'{args.scan}_export_check.png')
    fig.savefig(p, dpi=100, facecolor='black')
    print(p)


if __name__ == '__main__':
    main()
