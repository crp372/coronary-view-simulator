"""A coarse synthetic chest around the cropped CT, so the DRR shows lungs, ribs, spine and the
diaphragm beyond the scan's 23 × 23 × 13.8 cm.

    .venv/bin/python tools/export_chest.py 814 [--web data/web]

Writes data/web/<id>/chest.u8.gz (uint8, HU = v*10 - 1024, x-fastest, 3 mm voxels) and chest.json
(grid in the centred simulator frame, cm, plus the parameters). The app samples it outside the CT and
blends into it over the CT's outer 1.5 cm, so everything inside the scan is still the patient's own.

Landmarks are fitted by hand to scan 814's de-contrasted CT (data/web/814/ct.u8.gz): midline x ≈ −5,
vertebral bodies at y ≈ −9, anterior skin y ≈ 9–12, a wide chest (lung at the CT's left face), right
diaphragm dome about 3 cm higher than the left. Near the CT, its own lung-or-tissue pattern is carried
across each face and faded out over about 4 cm. The rest is a generic adult chest: illustrative, not this patient's anatomy.
"""
import argparse, gzip, json, os
import numpy as np
from scipy import ndimage as ndi

P = dict(
    voxel_cm=0.3, x=(-27.0, 17.0), y=(-19.0, 15.0), z=(-27.0, 26.0),
    # body outline wide enough that the CT's left lung (still present at its x = 12.9 face) and anterior
    # skin (y up to 11.6) fall inside it
    midline_x=-5.0, body_y=-2.6, body_a=20.5, body_b=14.0, wall_cm=2.2, fat_cm=1.5,
    spine_y=-9.0, vb_r=2.0, vb_pitch=2.9, disc_cm=0.7, t1_z=-16.0,
    rib_r=0.55, rib_drop=(3.0, 8.0), ribs=12,
    sternum=dict(z=(-15.0, 4.0), y_off=1.6, w=3.0, t=1.2),
    dome_r=(3.0, -7.0), dome_l=(6.0, 7.0), dome_k=0.035,
    # lung and soft-tissue values matched to scan 814's CT (lung mean −861 HU, soft tissue about −14 with fat)
    hu=dict(soft=10, fat=-90, lung=-880, bone=420, rib=700, cartilage=140, disc=80, liver=55, clavicle=700),
    markings=dict(hu=55, sigma_vox=1.2, seed=814),   # lung texture: smoothed noise, like vascular markings
)


def grid():
    s = P['voxel_cm']
    ax = [np.arange(a, b + 1e-6, s) for a, b in (P['x'], P['y'], P['z'])]
    return ax, np.meshgrid(*ax, indexing='ij')


def body_ab(z):
    """Body semi-axes by level: narrower at the thoracic inlet, a little narrower over the abdomen."""
    a = P['body_a'] - 2.5 * np.clip((-z - 12) / 10, 0, 1) - 1.0 * np.clip((z - 10) / 10, 0, 1)
    b = P['body_b'] - 1.5 * np.clip((-z - 12) / 10, 0, 1) - 0.8 * np.clip((z - 10) / 10, 0, 1)
    return a, b


def tube(vol, pts, r, hu, X, Y, Z):
    """Paint a tube of radius r (cm) along a polyline into vol (max with what's there)."""
    s = P['voxel_cm']
    for a, b in zip(pts[:-1], pts[1:]):
        lo = np.minimum(a, b) - r - s
        hi = np.maximum(a, b) + r + s
        ix = [slice(max(0, int((lo[i] - g[0]) / s)), int((hi[i] - g[0]) / s) + 2) for i, g in enumerate((P['x'], P['y'], P['z']))]
        x, y, z = X[tuple(ix)], Y[tuple(ix)], Z[tuple(ix)]
        ab = b - a
        t = np.clip(((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / max(ab @ ab, 1e-9), 0, 1)
        d2 = (x - a[0] - t * ab[0]) ** 2 + (y - a[1] - t * ab[1]) ** 2 + (z - a[2] - t * ab[2]) ** 2
        sub = vol[tuple(ix)]
        sub[d2 <= r * r] = np.maximum(sub[d2 <= r * r], hu)


def build(ct_lung=None):
    (xs, ys, zs), (X, Y, Z) = grid()
    h = P['hu']
    x0, yc = P['midline_x'], P['body_y']
    a, b = body_ab(Z)
    e = ((X - x0) / a) ** 2 + ((Y - yc) / b) ** 2
    body = e <= 1
    # thoracic cavity: the body less its wall; mediastinum and spine are carved out of the lungs
    ai, bi = a - P['wall_cm'], b - P['wall_cm']
    cavity = ((X - x0) / ai) ** 2 + ((Y - yc) / bi) ** 2 <= 1
    med_w = np.where(Z < -5, 3.2, 6.0)
    med_h = np.where(Z < -5, 6.0, 8.0)
    mediast = ((X - (x0 + np.where(Z < -5, 0.5, 2.5))) / med_w) ** 2 + ((Y - (yc + 1.5)) / med_h) ** 2 <= 1
    spine_zone = (np.abs(X - x0) < 3.0) & (Y < P['spine_y'] + 2.5)
    # diaphragm domes (right higher); below them, liver and abdomen
    kd = P['dome_k']
    dome = np.where(X < x0,
                    P['dome_r'][0] + kd * ((X - (x0 + P['dome_r'][1])) ** 2 + (Y - yc) ** 2),
                    P['dome_l'][0] + kd * ((X - (x0 + P['dome_l'][1])) ** 2 + (Y - yc) ** 2))
    apex = -20.0 + 0.04 * (X - x0) ** 2
    lungs = cavity & ~mediast & ~spine_zone & (Z < dome) & (Z > apex)

    vol = np.full(X.shape, -1000, np.float32)
    vol[body] = h['soft']
    vol[body & (e > ((1 - P['fat_cm'] / a) ** 2))] = h['fat']   # subcutaneous fat
    vol[body & (Z >= dome)] = h['liver']
    # near the CT, continue its own lung-or-tissue pattern across each face, fading into the generic
    # lungs over a few cm, so the scan's edges don't show
    lungness = lungs.astype(np.float32)
    if ct_lung is not None:
        f, wt = ct_lung(X, Y, Z)
        thor = cavity & ~spine_zone & (Z < dome) & (Z > apex - 4)
        lungness = np.where(thor, wt * f + (1 - wt) * lungness, lungness)
    lungness = ndi.gaussian_filter(lungness, 1.0)
    vol = np.where(body & (Z < dome), lungness * h['lung'] + (1 - lungness) * vol, vol)
    mk = P['markings']
    noise = ndi.gaussian_filter(np.random.default_rng(mk['seed']).standard_normal(X.shape).astype(np.float32), mk['sigma_vox'])
    vol += lungness * mk['hu'] * noise / noise.std()
    # spine: vertebral bodies with discs, posterior elements behind
    zrel = (Z - P['t1_z']) % P['vb_pitch']
    vb = ((X - x0) ** 2 + (Y - P['spine_y']) ** 2 <= P['vb_r'] ** 2)
    vol[vb] = np.where(zrel[vb] < P['disc_cm'], h['disc'], h['bone'])
    post = (np.abs(X - x0) < 1.6) & (Y < P['spine_y'] - 2.2) & (Y > P['spine_y'] - 5.5) & (zrel > P['disc_cm'] + 0.3)
    vol[post & body] = h['bone']
    # ribs: from the costovertebral joint round the inner chest wall, descending toward the front
    for k in range(P['ribs']):
        zk = P['t1_z'] + P['vb_pitch'] * (k + 0.4)
        drop = np.interp(k, [0, 5, 11], [P['rib_drop'][0], P['rib_drop'][1], 4.0])
        reach = np.interp(k, [0, 6, 9, 11], [2.55, 2.75, 2.3, 1.6])     # angle round from the back; floating ribs end laterally
        for side in (-1, 1):
            phi = np.linspace(0.18, reach, 40)
            a_k, b_k = body_ab(np.array(zk))
            ar, br = a_k - P['wall_cm'] + 0.6, b_k - P['wall_cm'] + 0.6
            pts = np.stack([x0 + side * ar * np.sin(phi), yc - br * np.cos(phi), zk + drop * (phi / np.pi) ** 1.3], 1)
            tube(vol, pts, P['rib_r'], h['rib'], X, Y, Z)
            if reach > 2.4 and k < 10:   # costal cartilage on to the sternum
                p_end = pts[-1]
                st = np.array([x0 + side * 1.6, yc + b_k - P['sternum']['y_off'], min(zk + drop + 1.0, P['sternum']['z'][1])])
                tube(vol, np.array([p_end, st]), P['rib_r'] * 0.8, h['cartilage'], X, Y, Z)
    # sternum
    s = P['sternum']
    a_s, b_s = body_ab(Z)
    st = (np.abs(X - x0) < s['w'] / 2) & (np.abs(Y - (yc + b_s - s['y_off'])) < s['t'] / 2) & (Z > s['z'][0]) & (Z < s['z'][1])
    vol[st] = np.maximum(vol[st], h['bone'])
    # clavicles
    for side in (-1, 1):
        tube(vol, np.array([[x0 + side * 2.0, yc + 10.0, -15.5], [x0 + side * 9.0, yc + 9.0, -17.0], [x0 + side * 15.0, yc + 5.0, -18.5]]),
             0.7, h['clavicle'], X, Y, Z)
    vol = ndi.gaussian_filter(vol, 0.6)   # soften to a plausible partial-volume look at 3 mm
    return (xs, ys, zs), vol


def ct_lung_field(web):
    """From the exported (de-contrasted) CT: a smoothed lung fraction, and a sampler that gives it at the
    nearest point of the CT box plus a weight that fades from 1 at the box to 0 about 4 cm away."""
    m = json.load(open(os.path.join(web, 'meta.json')))['ct']
    nx, ny, nz = m['dims']
    hu = np.frombuffer(gzip.open(os.path.join(web, m['file'])).read(), np.uint8).reshape(nz, ny, nx).transpose(2, 1, 0).astype(np.int16) * 10 - 1024
    air = hu < -500
    lab, _ = ndi.label(air)
    outside = np.isin(lab, np.unique(lab[:, -1, :])[1:])   # air touching the anterior face: outside the body
    frac = ndi.gaussian_filter((air & ~outside).astype(np.float32), 4)
    o, s, n = np.array(m['origin_cm']), np.array(m['spacing_cm']), np.array(m['dims'])
    lo, hi = o, o + s * (n - 1)

    def sample(X, Y, Z):
        q = np.stack([X, Y, Z], -1)
        c = np.clip(q, lo, hi)
        d = np.linalg.norm(q - c, axis=-1)
        idx = [(c[..., i] - o[i]) / s[i] for i in range(3)]
        return ndi.map_coordinates(frac, idx, order=1, mode='nearest'), np.exp(-d / 4.0)
    return sample


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan')
    ap.add_argument('--web', default='data/web')
    args = ap.parse_args()
    out = os.path.join(args.web, args.scan)
    (xs, ys, zs), vol = build(ct_lung_field(out))
    u8 = np.clip(np.round((vol + 1024) / 10), 0, 255).astype(np.uint8)
    with gzip.open(os.path.join(out, 'chest.u8.gz'), 'wb', compresslevel=9) as f:
        f.write(np.ascontiguousarray(u8.transpose(2, 1, 0)).tobytes())
    info = dict(file='chest.u8.gz', dims=list(u8.shape), spacing_cm=[P['voxel_cm']] * 3,
                origin_cm=[round(float(v[0]), 4) for v in (xs, ys, zs)], encoding='uint8, HU = v*10 - 1024',
                note='synthetic chest beyond the CT (lungs, ribs, spine, diaphragm, sternum, clavicles), fitted to '
                     'this scan\'s landmarks; illustrative', params=P)
    with open(os.path.join(out, 'chest.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print('chest', u8.shape, f'{os.path.getsize(os.path.join(out, "chest.u8.gz")) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
