"""Screen ImageCAS-X scans for focal lumen narrowing (candidate stenoses), to choose a diseased heart.

ImageCAS-X only says whether a scan has disease ("yes"/"no"), not where or how much. This measures it from
the labels: the lumen radius along every labelled centreline (distance transform of the segmentation,
taken as the largest value within one voxel of the centreline point), compared at each point with the
vessel's own reference just upstream and downstream. A drop well below both is a candidate stenosis.

It's a screen, not a measurement: the labels are about 0.36 mm voxels, so a 3 mm vessel is only a few
voxels across. Always look at a candidate (preview_scan.py) before choosing it. Gaps in the labels
(radius near 0) are reported separately: they're usually segmentation breaks, not occlusions.

    .venv/bin/python tools/screen_stenosis.py 856 986 ...       # given scans
    .venv/bin/python tools/screen_stenosis.py --block 801-1000  # every diseased scan in a block, quality >= 3
"""
import argparse, os, sys
import numpy as np
import nibabel as nib
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
from export_scan import to_sim_grid, read_centreline, tree_paths, LPS_TO_SIM, SEGMENTS   # noqa: E402
from pick_scan import read_xlsx                                                          # noqa: E402

MAIN = {1, 2, 3, 9, 4, 6, 7, 10}   # LM LAD LCx RCA D1 OM1 OM2 R-PDA: vessels worth teaching on
STEP = 0.5          # mm, resampling along the path
SMOOTH = 1.5        # mm, median window against voxel noise
REF = (4.0, 12.0)   # mm, reference windows from the point: [s-12, s-4] upstream and [s+4, s+12] downstream
SKIP_END = 8.0      # mm, ignore the last part of each path (natural taper, label ends)
MIN_REF_R = 0.9     # mm, only vessels with a reference diameter of at least 1.8 mm


def profile(nodes, pts, rad):
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts[nodes], axis=0), axis=1))])
    g = np.arange(0, s[-1], STEP)
    r = np.interp(g, s, rad[nodes])
    w = max(1, int(round(SMOOTH / STEP)))
    return g, ndi.median_filter(r, size=w, mode='nearest')


def screen(scan, xdir):
    img = nib.load(f'{xdir}/segmentations/{scan}.coronary.nii.gz')
    lab, sp, org = to_sim_grid(img)
    edt = ndi.maximum_filter(ndi.distance_transform_edt(lab > 0, sampling=sp), size=3)
    found, gaps = [], []
    for side in ('left', 'right'):
        p_lps, lines, label, start = read_centreline(f'{xdir}/centerlines/{scan}.coronary_{side}_centerline.vtk')
        p = p_lps @ LPS_TO_SIM.T
        roots = np.flatnonzero(start)
        root = int(roots[0]) if len(roots) else int(np.argmin(p[:, 2]))
        paths, dist = tree_paths(p, lines, label, root)
        vox = np.clip(np.round((p - org) / sp).astype(int), 0, np.array(lab.shape) - 1)
        rad = edt[vox[:, 0], vox[:, 1], vox[:, 2]]
        for pth in paths:
            if not pth['keep'] or pth['seg'] not in MAIN:
                continue
            nodes = pth['nodes']
            g, r = profile(nodes, p, rad)
            if len(g) < 20:
                continue
            s0 = dist[nodes[0]]
            best = None
            for i, s in enumerate(g):
                if s < REF[0] + 1 or s > g[-1] - SKIP_END:
                    continue
                up = r[(g >= s - REF[1]) & (g <= s - REF[0])]
                dn = r[(g >= s + REF[0]) & (g <= s + REF[1])]
                if len(up) < 4 or len(dn) < 4:
                    continue
                ru, rd = np.median(up), np.median(dn)
                # Reference: the vessel just upstream, as in a visual stenosis estimate. Where the vessel
                # downstream is much narrower (it has tapered or given off a large branch), use the mean of
                # the two instead, so a step down in calibre isn't read as a stenosis.
                focal = rd >= 0.75 * ru
                ref = ru if focal else (ru + rd) / 2
                if ref < MIN_REF_R:
                    continue
                if r[i] < 0.25:
                    gaps.append((SEGMENTS[pth['seg']], round(s0 + s)))
                    continue
                pct = 1 - r[i] / ref
                if best is None or pct > best[0]:
                    best = (pct, s, ref, r[i], focal)
            if best:
                pct, s, ref, rmin, focal = best
                found.append(dict(vessel=SEGMENTS[pth['seg']], pct=round(100 * pct), at_mm=round(s0 + s),
                                  ref_mm=round(2 * ref, 1), min_mm=round(2 * rmin, 1), focal=bool(focal)))
    found.sort(key=lambda f: -f['pct'])
    return found, sorted(set(gaps))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scans', nargs='*')
    ap.add_argument('--block', help='screen every diseased scan of quality >= 3 in this block, e.g. 801-1000')
    ap.add_argument('--xdir', default='data/raw/imagecas-x/ImageCAS-X_dataset')
    ap.add_argument('--min', type=int, default=40, help='list narrowings of at least this %% (default 40)')
    args = ap.parse_args()
    desc = {r['Scan ID']: r for r in read_xlsx(f'{args.xdir}/Descriptors.xlsx') if r['Scan ID']}
    scans = list(args.scans)
    if args.block:
        lo, hi = map(int, args.block.split('-'))
        scans += [i for i, r in desc.items() if lo <= int(i) <= hi and r['Disease'] == 'yes'
                  and r['Image Quality'] in ('3', '4')]
    for scan in sorted(set(scans), key=int):
        d = desc.get(scan, {})
        found, gaps = screen(scan, args.xdir)
        hits = [f for f in found if f['pct'] >= args.min]
        head = f"{scan:>4} Q{d.get('Image Quality', '?')} {d.get('Dominance', '?'):2} disease:{d.get('Disease', '?'):3}"
        txt = '  '.join(f"{f['vessel']} {f['pct']}%{'' if f['focal'] else ' (tapering)'} @{f['at_mm']}mm "
                        f"({f['min_mm']}/{f['ref_mm']} mm)" for f in hits) or '-'
        gtxt = ('  gaps: ' + ', '.join(f'{v}@{s}' for v, s in gaps[:4])) if gaps else ''
        print(f'{head}  {txt}{gtxt}', flush=True)


if __name__ == '__main__':
    main()
