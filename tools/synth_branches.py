"""Illustrative fine coronary branches, below what the CT resolves (about 1 mm).

Real angiograms show many branches of 0.2–1 mm (septal perforators, small diagonal and marginal
twigs, RV and acute marginal branches) that no CT segmentation contains. These are grown
procedurally from the real tree so the image has a realistic density of small vessels. They are
NOT this patient's anatomy: the app labels them as illustrative, can switch them off, and never
names them on hover.

  - Epicardial twigs leave each vessel at intervals, alternating sides, at 45–80° to it. They run
    along the heart's surface at the parent's own gap from it (the surface is the TotalSegmentator
    chambers + myocardium + great vessels), wander slightly, start at 0.5–1.1 mm across and taper to
    about 0.25 mm.
  - Septal perforators leave the proximal two thirds of the LAD and dive into the septum.
  - Each vessel's end fans out into a few terminal twigs, so trees don't stop abruptly.
  - Long twigs get one or two second-order twigs.

All in simulator mm (x = patient's left, y = anterior, z = feet). Deterministic for a given seed.
"""
import numpy as np
from scipy import ndimage as ndi

P = dict(seed=814, spacing_mm=6.5, length_mm=(8, 30), r0_mm=(0.25, 0.55), r0_frac=0.55, r_tip_mm=0.12, taper=1.4,
         step_mm=0.5, angle_deg=(45, 80), wiggle=0.14, gap_mm=(0.6, 4.0), leave_mm=10.0,
         septal_spacing_mm=8.0, septal_length_mm=(12, 26), septal_r0_mm=(0.25, 0.5), septal_extent=0.66,
         tip_twigs=3, second_order_p=0.55, min_parent_r_mm=0.3, smooth=0.35)


class Surface:
    """Signed distance to the heart (mm, positive outside) and its outward normal, interpolated."""

    def __init__(self, heart, org, sp, factor=2):
        h = heart[::factor, ::factor, ::factor]
        self.sp, self.org = sp * factor, org
        d = ndi.distance_transform_edt(~h, sampling=self.sp) - ndi.distance_transform_edt(h, sampling=self.sp)
        self.d = ndi.gaussian_filter(d.astype(np.float32), 1.0)
        self.g = [ndi.gaussian_filter(np.gradient(self.d, self.sp[i], axis=i), 1.0) for i in range(3)]

    def __call__(self, p):
        ijk = ((p - self.org) / self.sp)[:, None]
        d = ndi.map_coordinates(self.d, ijk, order=1, mode='nearest')[0]
        n = np.array([ndi.map_coordinates(g, ijk, order=1, mode='nearest')[0] for g in self.g])
        return d, n / (np.linalg.norm(n) + 1e-9)


def _unit(v):
    return v / (np.linalg.norm(v) + 1e-9)


def _march(p, direction, length, r0, surf, rng, follow=True, gap=None):
    """One twig from p. follow: stay at the starting gap from the heart's surface (epicardial);
    otherwise run straight with slight wander (septal). Returns points (N, 3), radii (N,), arc (N,)."""
    st = P['step_mm']
    d0, n = surf(p)
    if gap is not None:
        d0 = gap
    d0 = float(np.clip(d0, *P['gap_mm'])) if follow else d0
    pts, k_max = [p.copy()], max(2, int(length / st))
    dvec = _unit(direction - (direction @ n) * n) if follow else _unit(direction)
    for _ in range(k_max):
        q = pts[-1] + st * dvec
        d, n = surf(q)
        if follow:
            q = q - (d - d0) * n
            if d > d0 + P['leave_mm']:
                break
            dvec = _unit(dvec - (dvec @ n) * n + P['wiggle'] * rng.normal(size=3))
            dvec = _unit(dvec - (dvec @ n) * n)
        else:
            dvec = _unit(dvec + 0.4 * P['wiggle'] * rng.normal(size=3))
        pts.append(q)
    pts = np.array(pts)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    t = arc / max(arc[-1], 1e-6)
    radii = r0 + (P['r_tip_mm'] - r0) * t ** P['taper']   # stays near r0 for longer, then tapers
    return pts, radii, arc


def grow(paths, surf):
    """paths: list of dicts {pts (N,3) mm, r (N,) mm, sdist (N,) mm, sys 'L'|'R', lab}.
    Returns twigs: list of dicts {pts, r, sdist, sys, kind}."""
    rng = np.random.default_rng(P['seed'])
    twigs = []

    def add(pts, r, s0, sys_, kind, arc):
        twigs.append(dict(pts=pts, r=r, sdist=s0 + arc, sys=sys_, kind=kind))
        return twigs[-1]

    for v in paths:
        pts, r, sd = v['pts'], v['r'], v['sdist']
        if len(pts) < 3:
            continue
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        arc = np.concatenate([[0], np.cumsum(seg)])
        tang = np.gradient(pts, axis=0)
        tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
        # epicardial twigs at intervals along the vessel, alternating sides
        side, a = 1, rng.uniform(1.5, P['spacing_mm'])
        while a < arc[-1] - 2:
            i = int(np.searchsorted(arc, a))
            if r[i] >= P['min_parent_r_mm']:
                p0, t = pts[i], tang[i]
                _, n = surf(p0)
                b = _unit(np.cross(n, t)) * side
                ang = np.radians(rng.uniform(*P['angle_deg']))
                direction = np.cos(ang) * t + np.sin(ang) * b
                r0 = min(P['r0_frac'] * r[i], rng.uniform(*P['r0_mm']))
                tp, tr, ta = _march(p0, direction, rng.uniform(*P['length_mm']), r0, surf, rng)
                tw = add(tp, tr, sd[i], v['sys'], 'epicardial', ta)
                # second-order twig off a long one
                if ta[-1] > 16 and rng.random() < P['second_order_p']:
                    j = int(len(tp) * rng.uniform(0.3, 0.6))
                    tt = _unit(tp[min(j + 1, len(tp) - 1)] - tp[j])
                    _, n2 = surf(tp[j])
                    b2 = _unit(np.cross(n2, tt)) * rng.choice([-1, 1])
                    tp2, tr2, ta2 = _march(tp[j], 0.5 * tt + b2, rng.uniform(6, 14), 0.8 * tr[j], surf, rng)
                    add(tp2, tr2, tw['sdist'][j], v['sys'], 'epicardial', ta2)
            side = -side
            a += P['spacing_mm'] * rng.uniform(0.6, 1.4)
        # septal perforators from the LAD: into the septum, inward and slightly distal
        if v['lab'] == 'LAD':
            a = rng.uniform(4, P['septal_spacing_mm'])
            while a < P['septal_extent'] * arc[-1]:
                i = int(np.searchsorted(arc, a))
                _, n = surf(pts[i])
                direction = _unit(-n + 0.35 * tang[i] + 0.2 * rng.normal(size=3))
                r0 = min(P['r0_frac'] * r[i], rng.uniform(*P['septal_r0_mm']))
                tp, tr, ta = _march(pts[i], direction, rng.uniform(*P['septal_length_mm']), r0, surf, rng, follow=False)
                add(tp, tr, sd[i], v['sys'], 'septal', ta)
                a += P['septal_spacing_mm'] * rng.uniform(0.7, 1.3)
        # terminal fan, so the vessel doesn't end abruptly
        p0, t = pts[-1], tang[-1]
        _, n = surf(p0)
        for k in range(P['tip_twigs']):
            b = _unit(np.cross(n, t)) * rng.uniform(-1, 1)
            tp, tr, ta = _march(p0, t + 0.6 * b, rng.uniform(8, 18), max(0.12, min(r[-1], 0.3)), surf, rng)
            add(tp, tr, sd[-1], v['sys'], 'terminal', ta)
    return twigs


def rasterise(twigs, org, sp, shape, smooth=None):
    """Splat each twig's lumen volume (π r² per unit length) trilinearly onto the grid, so sub-voxel
    vessels keep their projected density, with a light anti-aliasing blur; returns per-side occupancy (0–1) and arc-length distance
    from the ostium (mm) at the nearest sample."""
    vol = {s: np.zeros(shape, np.float32) for s in 'LR'}
    dist = np.zeros(shape, np.float32)
    best = np.full(shape, np.inf, np.float32)
    ds, vv = 0.15, float(np.prod(sp))
    for tw in twigs:
        p, r, s = tw['pts'], tw['r'], tw['sdist']
        arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
        if arc[-1] <= 0:
            continue
        a = np.arange(0, arc[-1], ds)
        q = np.stack([np.interp(a, arc, p[:, i]) for i in range(3)], 1)
        rr, sa = np.interp(a, arc, r), np.interp(a, arc, s)
        w = np.pi * rr ** 2 * ds / vv
        f = (q - org) / sp
        i0 = np.floor(f).astype(int)
        fr = f - i0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    idx = i0 + [dx, dy, dz]
                    wt = w * np.abs(1 - dx - fr[:, 0]) * np.abs(1 - dy - fr[:, 1]) * np.abs(1 - dz - fr[:, 2])
                    ok = np.all((idx >= 0) & (idx < shape), axis=1)
                    ii = tuple(idx[ok].T)
                    np.add.at(vol[tw['sys']], ii, wt[ok])
                    # keep the distance of the sample nearest each voxel's centre
                    d2 = np.sum((fr[ok] - [dx, dy, dz]) ** 2, axis=1)
                    upd = d2 < best[ii]
                    sel = tuple(np.array(ii)[:, upd])
                    best[sel] = d2[upd]
                    dist[sel] = sa[ok][upd]
    smooth = P['smooth'] if smooth is None else smooth   # lighter than the tree's: these are thinner than a voxel
    occ = {k: np.clip(ndi.gaussian_filter(v, smooth), 0, 1) for k, v in vol.items()}
    return occ, dist
