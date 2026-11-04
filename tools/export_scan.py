"""Export an ImageCAS scan + ImageCAS-X labels as web-ready files for the simulator.

    .venv/bin/python tools/export_scan.py 814 [--block 801-1000] [--raw data/raw] [--out data/web]

Writes data/web/<id>/:
  ct.u8.gz          De-contrasted CT, uint8, HU = v*10 - 1024. Blood pool, myocardium and
                    coronaries are clamped to unenhanced soft tissue, so iodine can be added
                    back only where the simulated injection goes. Bone is kept.
  coronary.rgb8.gz  Coronary volume at full CT resolution (0.45 mm), cropped to the tree. Per voxel:
                    R = lumen occupancy (0–255, partial-volume fraction, keeps thin vessels),
                    G = segment label (0–14, ImageCAS-X; + 16 for small branches grown from the CT),
                    B = distance from ostium (mm, cine fill).
  synthetic.u8.gz   Illustrative fine branches on the coronary grid (tools/synth_branches.py), if the
                    TotalSegmentator masks are there; not this patient's anatomy.
  vessels.json      Centreline tree in the VESSELS shape: points, radii, distance from ostium (cm).
  meta.json         Grid sizes, spacing and origins (simulator coords, cm), encodings, attribution.

All volumes are x-fastest (x = patient's left, y = anterior, z = feet), ready for a WebGL2
3D texture. The coronary tree's bounding-box centre is placed at the isocentre.
"""
import argparse, gzip, heapq, json, os, re, struct
import numpy as np
import nibabel as nib
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

import synth_branches as synth

SEGMENTS = {1: 'LM', 2: 'LAD', 3: 'LCx', 4: 'D1', 5: 'D2', 6: 'OM1', 7: 'OM2', 8: 'IM',
            9: 'RCA', 10: 'R-PDA', 11: 'R-PLA', 12: 'L-PDA', 13: 'L-PLA', 14: 'Other'}
BONE_HU, CORTEX_HU, CORTEX_FRAC = 150, 700, 0.03
BLOOD_HU, BLOOD_R = (250, 600), 3   # enhanced blood band (smoothed HU); min radius, full-res voxels
SHELL_HU, SHELL_FRAC = 300, 0.05    # band pieces with a denser shell than this are marrow
SOFT_HU = 50         # unenhanced blood / myocardium
FACTOR = 2           # CT downsample: 0.45 × 0.45 × 0.5 mm → 0.91 × 0.91 × 1.0 mm
COR_FACTOR = 1       # coronary volume at full resolution (0.45 mm), so distal vessels stay thin
COR_SMOOTH = 0.6     # Gaussian sigma (voxels) on the lumen occupancy: anti-aliasing
MIN_PATH_MM = 3      # drop centreline stubs shorter than this
# Small branches the labels miss, grown from the CT (needs the TotalSegmentator chamber masks, to keep
# out of the blood pool): Frangi vesselness above `vness`, brighter than `hu`, nothing thicker than
# `rmax_mm`, joined to the labelled tree within `bridge` voxels, pieces of at least `min_vox` voxels
GROW = dict(vness=0.002, hu=110, rmax_mm=1.4, bridge=2, min_vox=40, margin_mm=15, sigmas=(0.8, 1.2, 1.8))
CT_BRANCH = 16       # label offset for grown voxels: parent segment + 16, so the app can tell them apart
POOL_MASKS = ['heart_ventricle_left', 'heart_ventricle_right', 'heart_atrium_left', 'heart_atrium_right',
              'aorta', 'pulmonary_artery']
RAS_TO_SIM = np.diag([-1.0, 1.0, -1.0])  # NIfTI RAS mm → simulator axes (left, anterior, feet)
LPS_TO_SIM = np.diag([1.0, -1.0, -1.0])  # VTK (ITK/DICOM LPS) mm → simulator axes


# ---------- volumes ----------

def to_sim_grid(img):
    """Reorder an axis-aligned NIfTI so array axes run along simulator x, y, z (all increasing).
    Returns (array indexed [x, y, z], spacing_mm, sim-mm position of voxel (0,0,0))."""
    a = np.asanyarray(img.dataobj)
    m = RAS_TO_SIM @ img.affine[:3, :3]
    perm = [int(np.argmax(np.abs(m[r]))) for r in range(3)]   # array axis feeding each sim axis
    a = np.transpose(a, perm)
    m = m[:, perm]
    origin = RAS_TO_SIM @ img.affine[:3, 3]
    for ax in range(3):
        if m[ax, ax] < 0:
            a = np.flip(a, ax)
            origin[ax] += m[ax, ax] * (a.shape[ax] - 1)
    return np.ascontiguousarray(a), np.abs(np.diag(m)), origin


def block_mean(a, f):
    s = [d // f * f for d in a.shape]
    a = a[:s[0], :s[1], :s[2]].astype(np.float32)
    return a.reshape(s[0] // f, f, s[1] // f, f, s[2] // f, f).mean(axis=(1, 3, 5))


def ball(r):
    g = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (g ** 2).sum(0) <= r * r


def enhanced_blood(ct):
    """Contrast-filled blood pool: regions of the smoothed CT in the BLOOD_HU band wide enough to
    hold a BLOOD_R ball. Marrow in the same band is wrapped in trabeculae and cortex, so pieces whose
    surrounding shell is at least SHELL_FRAC above SHELL_HU are left out."""
    sm = ndi.gaussian_filter(ct.astype(np.float32), 1)
    band = ndi.binary_opening((sm > BLOOD_HU[0]) & (sm < BLOOD_HU[1]), ball(BLOOD_R))
    lab, n = ndi.label(band)
    shell = ndi.grey_dilation(lab, size=(7, 7, 7))            # 2–3 voxels outside each piece
    shell[ndi.binary_dilation(band)] = 0
    dense = ndi.mean(ct > SHELL_HU, shell, np.arange(1, n + 1))
    return np.isin(lab, np.flatnonzero(dense < SHELL_FRAC) + 1)


def bone_mask(ct):
    """Components above BONE_HU that contain cortical bone. Blood pool and enhanced vessels are
    homogeneous and lack a >CORTEX_HU shell, but a vessel lying on bone (descending aorta on the
    spine) joins its component, so enhanced blood and its partial-volume rim are cut out first.
    Holes (marrow, canal) are filled slice by slice."""
    blood = enhanced_blood(ct)
    rim = ndi.binary_dilation(blood, iterations=3) & (ct < CORTEX_HU)
    cand = (ct > BONE_HU) & ~rim
    cortex = ndi.binary_dilation(ct > CORTEX_HU, iterations=3)
    cc, n = ndi.label(cand)
    frac = ndi.mean(cortex, cc, np.arange(1, n + 1))
    bone = np.isin(cc, np.flatnonzero(frac >= CORTEX_FRAC) + 1)
    for k in range(bone.shape[2]):
        bone[:, :, k] = ndi.binary_fill_holes(bone[:, :, k])
    return ndi.binary_dilation(bone, iterations=1) & ~blood


def grow_ct_branches(ct, lab, pool, bone, sp):
    """Branches the labels miss: tube-like enhanced voxels outside the blood pool and bone, connected to
    the labelled tree. Anything thicker than a small artery, plus a margin round it, is cut out first, so
    the growth can't leak into the atrial appendage or a venous confluence. Returns labels on the full
    grid: each grown voxel gets its nearest tree segment's label + CT_BRANCH, 0 elsewhere."""
    from skimage.filters import frangi
    tree = lab > 0
    nz = np.argwhere(tree)
    m = np.round(GROW['margin_mm'] / sp).astype(int)
    lo, hi = np.maximum(nz.min(0) - m, 0), np.minimum(nz.max(0) + m + 1, tree.shape)
    cr = tuple(slice(a, b) for a, b in zip(lo, hi))
    c, tr = ct[cr].astype(np.float32), tree[cr]
    v = frangi(np.clip(c, -200, 800), sigmas=GROW['sigmas'], black_ridges=False, alpha=0.5, beta=0.5)
    bright = (c > GROW['hu']) & ~ndi.binary_dilation(pool[cr], iterations=2) & ~bone[cr] & ~tr
    thick = ndi.distance_transform_edt(bright, sampling=sp) > GROW['rmax_mm']
    bright &= ~ndi.binary_dilation(thick, iterations=4)
    cand = (v > GROW['vness']) & bright
    pieces, _ = ndi.label(cand)
    touching = np.unique(pieces[ndi.binary_dilation(tr, iterations=GROW['bridge']) & cand])
    grown = np.isin(pieces, touching[touching > 0])
    pieces, n = ndi.label(grown)
    sizes = ndi.sum_labels(grown, pieces, range(1, n + 1))
    grown = np.isin(pieces, np.flatnonzero(sizes >= GROW['min_vox']) + 1)
    _, near = ndi.distance_transform_edt(~tr, return_indices=True)
    out = np.zeros(lab.shape, np.uint8)
    out[cr] = np.where(grown, lab[cr][tuple(near)] + CT_BRANCH, 0)
    return out


def decontrast(ct, bone):
    """Clamp everything that isn't bone to unenhanced soft tissue."""
    out = ct.copy()
    out[~bone & (ct > SOFT_HU)] = SOFT_HU
    return out


# ---------- centrelines ----------

def read_centreline(path):
    """VTK 5.1 polydata (ASCII or binary) → points (LPS mm), lines, per-point label and start flag."""
    b = open(path, 'rb').read()
    ascii_ = b'\nASCII\n' in b[:200]

    def array(header, count, fmt, start=0):
        m = re.compile(header).search(b, start)
        o = m.end()
        if ascii_:
            return np.array(b[o:].split(None, count)[:count], dtype=float if fmt == 'f' else np.int64)
        return np.frombuffer(b[o:o + struct.calcsize(fmt) * count], dtype='>' + fmt).astype(
            float if fmt == 'f' else np.int64)

    n = int(re.search(rb'POINTS (\d+) float\n', b).group(1))
    pts = array(rb'POINTS \d+ float\n', 3 * n, 'f').reshape(n, 3)
    m = re.search(rb'LINES (\d+) (\d+)\nOFFSETS vtktypeint(\d+)\n', b)
    n_off, n_con, w = int(m.group(1)), int(m.group(2)), m.group(3)
    off = array(rb'OFFSETS vtktypeint\d+\n', n_off, 'q' if w == b'64' else 'i')
    con = array(rb'CONNECTIVITY vtktypeint\d+\n', n_con, 'q' if w == b'64' else 'i')
    lines = [con[a:z] for a, z in zip(off, off[1:])]
    label = array(rb'SCALARS segment_label int[^\n]*\nLOOKUP_TABLE[^\n]*\n', n, 'i')
    start = array(rb'start_points 1 \d+ int\n', n, 'i')
    return pts, lines, label, start


def tree_paths(pts, lines, label, root):
    """Shortest-path tree from the ostium, split into vessel paths. A path follows the child
    with the same segment label and the longest run downstream; other children start new paths."""
    adj = {}
    for ln in lines:
        for u, v in zip(ln[:-1], ln[1:]):
            d = float(np.linalg.norm(pts[u] - pts[v]))
            adj.setdefault(u, []).append((v, d))
            adj.setdefault(v, []).append((u, d))
    dist, parent, heap = {root: 0.0}, {root: None}, [(0.0, root)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, w in adj.get(u, []):
            if d + w < dist.get(v, np.inf):
                dist[v], parent[v] = d + w, u
                heapq.heappush(heap, (d + w, v))
    children = {}
    for v, p in parent.items():
        if p is not None:
            children.setdefault(p, []).append(v)
    reach = {}  # furthest distance downstream of each node
    for v in sorted(dist, key=dist.get, reverse=True):
        reach[v] = max([dist[v]] + [reach[c] for c in children.get(v, [])])

    paths, queue = [], [(root, None, None)]   # (first node, attach node, parent path index)
    while queue:
        node, attach, ppath = queue.pop(0)
        seg = int(label[node])
        path = ([attach] if attach is not None else []) + [node]
        while True:
            kids = children.get(node, [])
            same = [c for c in kids if int(label[c]) == seg]
            nxt = max(same, key=reach.get) if same else None
            for c in kids:
                if c != nxt:
                    queue.append((c, node, len(paths)))
            if nxt is None:
                break
            path.append(nxt)
            node = nxt
        keep = ppath is None or dist[path[-1]] - dist[path[0]] >= MIN_PATH_MM
        paths.append(dict(seg=seg, nodes=path, parent=ppath, keep=keep))  # dropped stubs keep their link
    return paths, dist


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan')
    ap.add_argument('--block', default='801-1000')
    ap.add_argument('--raw', default='data/raw')
    ap.add_argument('--out', default='data/web')
    args = ap.parse_args()
    raw = args.raw
    xdir = f'{raw}/imagecas-x/ImageCAS-X_dataset'
    out = os.path.join(args.out, args.scan)
    os.makedirs(out, exist_ok=True)

    ct_img = nib.load(f'{raw}/imagecas/extracted/{args.block}/{args.scan}.img.nii.gz')
    lab_img = nib.load(f'{xdir}/segmentations/{args.scan}.coronary.nii.gz')
    assert np.allclose(ct_img.affine, lab_img.affine, atol=1e-3), 'CT and labels on different grids'
    ct, sp, org = to_sim_grid(ct_img)
    lab, _, _ = to_sim_grid(lab_img)
    ct = ct.astype(np.int16)
    lab = lab.astype(np.uint8)

    # Centre: coronary tree bounding box → isocentre
    ijk = np.argwhere(lab > 0)
    centre = org + sp * (ijk.min(0) + ijk.max(0)) / 2

    # CT: de-contrast, downsample, quantise
    bone = bone_mask(ct)
    ct_dc = decontrast(ct, bone)
    ct_ds = block_mean(ct_dc, FACTOR)
    sp_ds = sp * FACTOR
    org_ds = org + sp * (FACTOR - 1) / 2            # centre of the first downsampled voxel
    ct_u8 = np.clip(np.round((ct_ds + 1024) / 10), 0, 255).astype(np.uint8)

    tree_lab = lab   # the labelled tree alone, for centreline radii
    # Small branches grown from the CT, added to the labels (codes + CT_BRANCH)
    seg_dir = f'{raw}/totalseg/{args.scan}/heartchambers'
    grown_ml = 0.0
    if all(os.path.exists(f'{seg_dir}/{m}.nii.gz') for m in POOL_MASKS):
        pool = np.zeros(lab.shape, bool)
        for m in POOL_MASKS:
            pool |= to_sim_grid(nib.load(f'{seg_dir}/{m}.nii.gz'))[0] > 0
        grown = grow_ct_branches(ct, lab, pool, bone, sp)
        lab = np.where(grown > 0, grown, lab).astype(np.uint8)
        grown_ml = float((grown > 0).sum() * np.prod(sp)) / 1000
        print(f'grown from the CT: {grown_ml:.2f} mL')
    else:
        print(f'no TotalSegmentator chamber masks in {seg_dir}: skipping CT branch growth')

    # Centrelines → sim mm, distance from ostium, vessel paths
    edt = ndi.distance_transform_edt(tree_lab > 0, sampling=sp)
    trees, kd_pts, kd_dist, kd_sys = [], [], [], []
    for side, sys_ in (('left', 'L'), ('right', 'R')):
        p_lps, lines, label, start = read_centreline(f'{xdir}/centerlines/{args.scan}.coronary_{side}_centerline.vtk')
        p_sim = p_lps @ LPS_TO_SIM.T
        roots = np.flatnonzero(start)
        root = int(roots[0]) if len(roots) else int(np.argmin(p_sim[:, 2]))
        paths, dist = tree_paths(p_sim, lines, label, root)
        vox = np.clip(np.round((p_sim - org) / sp).astype(int), 0, np.array(lab.shape) - 1)
        radius = edt[vox[:, 0], vox[:, 1], vox[:, 2]]
        trees.append((sys_, p_sim, label, paths, dist, radius))
        reached = np.array(sorted(dist))
        kd_pts.append(p_sim[reached]); kd_dist.append([dist[i] for i in reached]); kd_sys += [sys_] * len(reached)

    # vessels.json
    vessels, used = [], {}
    for sys_, p_sim, label, paths, dist, radius in trees:
        index = {}
        for k, pth in enumerate(paths):
            if not pth['keep']:
                continue
            name = SEGMENTS.get(pth['seg'], 'Unlabelled')
            used[name] = used.get(name, 0) + 1
            vid = name if used[name] == 1 else f'{name}-{used[name]}'
            par = pth['parent']
            while par is not None and not paths[par]['keep']:  # children of dropped stubs move up
                par = paths[par]['parent']
            index[k] = len(vessels)
            n = pth['nodes']
            vessels.append(dict(
                id=vid, sys=sys_, seg=pth['seg'], lab=name,
                parent=vessels[index[par]]['id'] if par in index else None,
                pts=[[round(float(c), 3) for c in (p_sim[i] - centre) / 10] for i in n],
                r=[round(float(radius[i]) / 10, 3) for i in n],
                sdist=[round(dist[i] / 10, 2) for i in n]))

    # Illustrative fine branches below CT resolution, grown from the tree along the heart's surface
    # (tools/synth_branches.py). Not this patient's anatomy: stored separately so the app can label
    # them and switch them off.
    twigs, syn_info = [], None
    if all(os.path.exists(f'{seg_dir}/{m}.nii.gz') for m in POOL_MASKS + ['heart_myocardium']):
        heart = pool | (to_sim_grid(nib.load(f'{seg_dir}/heart_myocardium.nii.gz'))[0] > 0)
        surf = synth.Surface(heart, org, sp)
        twigs = synth.grow([dict(pts=np.array(v['pts']) * 10 + centre, r=np.array(v['r']) * 10,
                                 sdist=np.array(v['sdist']) * 10, sys=v['sys'], lab=v['lab']) for v in vessels], surf)

    # Coronary: occupancy + majority label per block, cropped to the tree, then a slight blur that
    # anti-aliases the lumen edge without changing its total (so projected density is kept)
    occ = block_mean(lab > 0, COR_FACTOR)
    if COR_FACTOR == 1:
        seg_ds = lab
    else:
        codes = [k for k in np.unique(lab) if k]
        counts = np.stack([block_mean(lab == k, COR_FACTOR) for k in codes])
        seg_ds = np.where(occ > 0, np.array(codes, np.uint8)[counts.argmax(0)], 0).astype(np.uint8)
    sp_cor = sp * COR_FACTOR
    org_cor = org + sp * (COR_FACTOR - 1) / 2
    nz = np.argwhere(occ > 0)
    if twigs:   # the crop also has to hold the synthetic twigs
        tw_ijk = np.round((np.concatenate([t['pts'] for t in twigs]) - org_cor) / sp_cor).astype(int)
        nz = np.concatenate([nz, np.clip(tw_ijk, 0, np.array(occ.shape) - 1)])
    lo = np.maximum(nz.min(0) - 6, 0)
    hi = np.minimum(nz.max(0) + 7, occ.shape)
    crop = tuple(slice(a, b) for a, b in zip(lo, hi))
    occ_c = ndi.gaussian_filter(occ[crop], COR_SMOOTH)
    occ_c[occ_c < 0.5 / 255] = 0
    # the blurred rim needs a label too: take the nearest labelled voxel's
    _, near_lab = ndi.distance_transform_edt(seg_ds[crop] == 0, return_indices=True)
    seg_c = np.where(occ_c > 0, seg_ds[crop][tuple(near_lab)], 0).astype(np.uint8)
    org_c = org_cor + sp_cor * lo

    kd = cKDTree(np.concatenate(kd_pts))
    kd_dist = np.concatenate(kd_dist)
    occ_idx = np.argwhere(occ_c > 0)
    away, near = kd.query(org_c + sp_cor * occ_idx)
    # grown branches have no centreline: their distance runs on from the nearest centreline point
    away = np.where(seg_c[tuple(occ_idx.T)] > CT_BRANCH, away, 0)
    ostium = np.zeros(occ_c.shape, np.uint8)
    ostium[tuple(occ_idx.T)] = np.clip(np.round(kd_dist[near] + away), 0, 255)
    syn = None
    if twigs:
        occ_s, dist_s = synth.rasterise(twigs, org_c, sp_cor, occ_c.shape)
        # one byte per voxel: 1–127 left-tree occupancy, 129–255 right-tree occupancy (128 + 127 × occ)
        qL, qR = np.round(occ_s['L'] * 127), np.round(occ_s['R'] * 127)
        syn = np.where(qR > qL, np.where(qR > 0, 128 + qR, 0), qL).astype(np.uint8)
        fill = (ostium == 0) & (syn > 0)
        ostium[fill] = np.clip(np.round(dist_s[fill]), 0, 255)
        length = sum(float(np.linalg.norm(np.diff(t['pts'], axis=0), axis=1).sum()) for t in twigs) / 10
        lumen = float((occ_s['L'] + occ_s['R']).sum() * np.prod(sp_cor)) / 1000
        syn_info = dict(file='synthetic.u8.gz', dims=list(syn.shape), note='illustrative fine branches, not this patient\'s anatomy',
                        encoding='uint8 on the coronary grid: 1-127 left-tree occupancy (v/127), 129-255 right-tree (v-128)/127',
                        twigs=len(twigs), kinds={k: sum(t['kind'] == k for t in twigs) for k in ('epicardial', 'septal', 'terminal')},
                        length_cm=round(length, 1), lumen_ml=round(lumen, 3), params=synth.P)
        print(f'synthetic: {len(twigs)} twigs, {length:.0f} cm, {lumen:.2f} mL')
    cor = np.stack([np.round(occ_c * 255).astype(np.uint8), seg_c, ostium], axis=-1)

    def save_gz(name, arr):
        with gzip.open(os.path.join(out, name), 'wb', compresslevel=9) as f:
            f.write(np.ascontiguousarray(arr.transpose(2, 1, 0, *range(3, arr.ndim))).tobytes())  # x fastest

    save_gz('ct.u8.gz', ct_u8)
    save_gz('coronary.rgb8.gz', cor)
    if syn is not None:
        save_gz('synthetic.u8.gz', syn)
    elif os.path.exists(os.path.join(out, 'synthetic.u8.gz')):
        os.remove(os.path.join(out, 'synthetic.u8.gz'))
    with open(os.path.join(out, 'vessels.json'), 'w') as f:
        json.dump(vessels, f, separators=(',', ':'))
    cm = lambda v: [round(float(x) / 10, 4) for x in v]
    meta = dict(
        scan=int(args.scan), source='ImageCAS volume + ImageCAS-X labels',
        attribution=['Zeng A, Xu X, et al. ImageCAS. Comput Med Imaging Graph 2023 (CC BY-NC 4.0)',
                     'Bransby KM, et al. ImageCAS-X. arXiv:2608.30404, 2026 (CC BY 4.0)'],
        frame='simulator patient coords, cm: x = patient left, y = anterior, z = feet; '
              'arrays x-fastest; origin = centre of voxel (0,0,0)',
        centre_subtracted_cm=cm(centre),
        ct=dict(file='ct.u8.gz', dims=list(ct_u8.shape), spacing_cm=cm(sp_ds), origin_cm=cm(org_ds - centre),
                encoding='uint8, HU = v*10 - 1024', decontrast=f'non-bone voxels above {SOFT_HU} HU set to {SOFT_HU}'),
        coronary=dict(file='coronary.rgb8.gz', dims=list(cor.shape[:3]), spacing_cm=cm(sp_cor),
                      origin_cm=cm(org_c - centre),
                      channels=['occupancy 0-255', f'segment label 0-14, or parent segment + {CT_BRANCH} for branches grown from the CT',
                                'distance from ostium, mm'],
                      segments=SEGMENTS, right_segments=[9, 10, 11], ct_branch_offset=CT_BRANCH,
                      ct_branch_ml=round(grown_ml, 2), ct_branch_params=GROW, synthetic=syn_info),
        vessels='vessels.json')
    with open(os.path.join(out, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    for name in sorted(os.listdir(out)):
        print(f'{name:18s} {os.path.getsize(os.path.join(out, name)) / 1e6:6.2f} MB')
    print('ct dims', ct_u8.shape, 'coronary dims', cor.shape[:3], 'vessels', len(vessels),
          'max ostium dist mm', int(kd_dist.max()))


if __name__ == '__main__':
    main()
