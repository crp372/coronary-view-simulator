"""Guide-catheter paths (JL4 to the left main, JR4 to the RCA) shaped along this CT's own aorta.

    .venv/bin/python tools/export_catheter.py 814 [--raw data/raw] [--web data/web]

Reads the TotalSegmentator aorta mask and data/web/<id>/{meta,vessels}.json; writes
data/web/<id>/catheter.json. Femoral approach: the catheter comes up the descending aorta, over the
arch, down the ascending aorta and into the ostium.

  - Descending and ascending aorta: centroids of the mask's two pieces in each axial slice.
  - Below and above the scan (the aorta is cut off at 13.8 cm): straight extrapolation of the
    descending aorta toward the groin, and a smooth arch joining the two tops a few cm above the scan.
  - In the ascending aorta the shaft rests off-centre, away from the target ostium, as a guide
    does against the far wall; the last few cm curve into the ostium (cubic Bézier, ending coaxial
    with the vessel) and the tip sits a few mm inside it.

The shapes are an approximation for teaching, not a model of catheter mechanics.
"""
import argparse, json, os, sys
import numpy as np
import nibabel as nib
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
from export_scan import to_sim_grid

P = dict(outer_radius_cm=0.1, inner_radius_cm=0.089,   # 6F guide: 2.0 mm outside, 1.78 mm lumen
         arch_rise_cm=4.5, femoral_cm=25.0, shaft_offset=0.5, engage_above_cm=2.2, tip_in_cm=0.35,
         curve_pull_cm=(1.8, 1.1), simplify_cm=0.02, max_points=64)


def bezier(p0, p1, p2, p3, n=40):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def rdp(pts, eps):
    """Ramer–Douglas–Peucker: drop points within eps of the line through their neighbours."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    t = np.clip(((pts - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    d = np.linalg.norm(pts - (a + t[:, None] * ab), axis=1)
    i = int(np.argmax(d))
    if d[i] <= eps:
        return np.array([a, b])
    return np.concatenate([rdp(pts[:i + 1], eps)[:-1], rdp(pts[i:], eps)])


def aorta_centrelines(mask, sp, org, centre):
    """Per axial slice (sim z, head → feet): centroids of the ascending (anterior) and descending
    (posterior) pieces, in centred sim cm, with radii."""
    asc, desc = [], []
    for k in range(mask.shape[2]):
        lab, n = ndi.label(mask[:, :, k])
        pieces = []
        for i in range(1, n + 1):
            ij = np.argwhere(lab == i)
            if len(ij) < 30:
                continue
            xy = org[:2] + sp[:2] * ij.mean(0)
            pieces.append((xy, np.sqrt(len(ij) * sp[0] * sp[1] / np.pi)))
        z = org[2] + sp[2] * k
        if len(pieces) >= 2:
            pieces.sort(key=lambda p: p[0][1])           # y: posterior first
            desc.append([*pieces[0][0], z, pieces[0][1]])
            asc.append([*pieces[-1][0], z, pieces[-1][1]])
        elif len(pieces) == 1 and asc and np.linalg.norm(pieces[0][0] - np.array(asc[-1][:2])) < 15:
            asc.append([*pieces[0][0], z, pieces[0][1]])  # the root, once the descending piece has gone
        elif len(pieces) == 1:
            desc.append([*pieces[0][0], z, pieces[0][1]])
    f = lambda a: (np.array(a)[:, :3] - centre) / 10, lambda a: np.array(a)[:, 3] / 10
    return f[0](asc), f[1](asc), f[0](desc), f[1](desc)


def path_to(ostium, into, asc, asc_r, desc):
    """One catheter, femoral to ostium, as points in centred sim cm (groin end first)."""
    up = np.array([0, 0, -1.0])
    # descending aorta, smoothed, extended toward the groin along its own axis
    d = ndi.uniform_filter1d(desc, 9, axis=0, mode='nearest')
    axis = d[-1] - d[max(0, len(d) - 40)]
    axis /= np.linalg.norm(axis)
    groin = d[-1] + axis * P['femoral_cm']
    # ascending aorta down to the level a few cm above the ostium (z grows toward the feet)
    a = ndi.uniform_filter1d(asc, 9, axis=0, mode='nearest')
    ra = ndi.uniform_filter1d(asc_r, 9, mode='nearest')
    stop = ostium[2] - P['engage_above_cm']
    keep = a[:, 2] <= stop
    a, ra = (a[keep], ra[keep]) if keep.sum() >= 2 else (a[:2], ra[:2])
    # shaft off-centre, away from the ostium (horizontally)
    away = a[-1] - ostium
    away[2] = 0
    away /= np.linalg.norm(away) + 1e-9
    shaft = a + away * (P['shaft_offset'] * ra)[:, None]
    # arch over the top, joining the descending and ascending tops
    top_d, top_a = d[0], shaft[0]
    rise = P['arch_rise_cm']
    arch = bezier(top_d, top_d + up * rise, top_a + up * rise, top_a, 50)
    # engagement curve into the ostium, ending coaxial with the vessel, then the tip inside it
    p0, t0 = shaft[-1], _unit(shaft[-1] - shaft[-2])
    t3 = _unit(into)
    curve = bezier(p0, p0 + t0 * P['curve_pull_cm'][0], ostium - t3 * P['curve_pull_cm'][1], ostium, 40)
    tip = ostium + t3 * P['tip_in_cm']
    pts = np.concatenate([[groin], d[::-1], arch[1:], shaft[1:], curve[1:], [tip]])
    pts = rdp(pts, P['simplify_cm'])
    while len(pts) > P['max_points']:
        P['simplify_cm'] *= 1.5
        pts = rdp(pts, P['simplify_cm'])
    return pts


def _unit(v):
    return v / (np.linalg.norm(v) + 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan')
    ap.add_argument('--raw', default='data/raw')
    ap.add_argument('--web', default='data/web')
    args = ap.parse_args()
    web = os.path.join(args.web, args.scan)
    meta = json.load(open(os.path.join(web, 'meta.json')))
    centre = np.array(meta['centre_subtracted_cm']) * 10
    vessels = {v['lab']: v for v in json.load(open(os.path.join(web, meta['vessels'])))}
    mask, sp, org = to_sim_grid(nib.load(f'{args.raw}/totalseg/{args.scan}/heartchambers/aorta.nii.gz'))
    asc, asc_r, desc, _ = aorta_centrelines(mask > 0, sp, org, centre)
    out = dict(source='shaped along the TotalSegmentator aorta of this CT; arch and femoral course '
                      'extrapolated beyond the scan; an approximation for teaching',
               outer_radius_cm=P['outer_radius_cm'], inner_radius_cm=P['inner_radius_cm'], params=dict(P))
    for side, name, lab in (('L', 'JL4', 'LM'), ('R', 'JR4', 'RCA')):
        v = np.array(vessels[lab]['pts'])
        k = min(len(v) - 1, 4)
        pts = path_to(v[0], v[k] - v[0], asc, asc_r, desc)
        out[side] = dict(name=name, ostium=lab, pts=[[round(float(c), 3) for c in p] for p in pts])
        length = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
        print(f'{name}: {len(pts)} points, {length:.0f} cm, tip {pts[-1].round(2)}')
    with open(os.path.join(web, 'catheter.json'), 'w') as f:
        json.dump(out, f, indent=1)


if __name__ == '__main__':
    main()
