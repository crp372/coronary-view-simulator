"""Export an ImageCAS scan + ImageCAS-X labels as web-ready files for the simulator.

    .venv/bin/python tools/export_scan.py 814 [--block 801-1000] [--out data/web]

Writes data/web/<id>/:
  ct.u8.gz          De-contrasted CT, uint8, HU = v*10 - 1024. Blood pool, myocardium and
                    coronaries are clamped to unenhanced soft tissue, so iodine can be added
                    back only where the simulated injection goes. Bone is kept.
  coronary.rgb8.gz  Coronary volume on the same grid, cropped to the tree. Per voxel:
                    R = lumen occupancy (0–255, partial-volume fraction, keeps thin vessels),
                    G = segment label (0–14, ImageCAS-X), B = distance from ostium (mm, cine fill).
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

SEGMENTS = {1: 'LM', 2: 'LAD', 3: 'LCx', 4: 'D1', 5: 'D2', 6: 'OM1', 7: 'OM2', 8: 'IM',
            9: 'RCA', 10: 'R-PDA', 11: 'R-PLA', 12: 'L-PDA', 13: 'L-PLA', 14: 'Other'}
BONE_HU, CORTEX_HU, CORTEX_FRAC = 150, 700, 0.03
SOFT_HU = 50         # unenhanced blood / myocardium
FACTOR = 2           # downsample: 0.45 × 0.45 × 0.5 mm → 0.91 × 0.91 × 1.0 mm
MIN_PATH_MM = 3      # drop centreline stubs shorter than this
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


def bone_mask(ct):
    """Components above BONE_HU that contain cortical bone. Blood pool and enhanced vessels are
    homogeneous and lack a >CORTEX_HU shell. Holes (marrow, canal) are filled slice by slice."""
    cand = ct > BONE_HU
    cortex = ndi.binary_dilation(ct > CORTEX_HU, iterations=3)
    cc, n = ndi.label(cand)
    frac = ndi.mean(cortex, cc, np.arange(1, n + 1))
    bone = np.isin(cc, np.flatnonzero(frac >= CORTEX_FRAC) + 1)
    for k in range(bone.shape[2]):
        bone[:, :, k] = ndi.binary_fill_holes(bone[:, :, k])
    return ndi.binary_dilation(bone, iterations=1)


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
    ap.add_argument('--out', default='data/web')
    args = ap.parse_args()
    raw = 'data/raw'
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

    # Coronary: occupancy + majority label per block, cropped to the tree
    occ = block_mean(lab > 0, FACTOR)
    counts = np.stack([block_mean(lab == k, FACTOR) for k in range(1, 15)])
    seg_ds = np.where(occ > 0, counts.argmax(0) + 1, 0).astype(np.uint8)
    nz = np.argwhere(occ > 0)
    lo = np.maximum(nz.min(0) - 3, 0)
    hi = np.minimum(nz.max(0) + 4, occ.shape)
    crop = tuple(slice(a, b) for a, b in zip(lo, hi))
    occ_c, seg_c = occ[crop], seg_ds[crop]
    org_c = org_ds + sp_ds * lo

    # Centrelines → sim mm, distance from ostium, vessel paths
    edt = ndi.distance_transform_edt(lab > 0, sampling=sp)
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

    kd = cKDTree(np.concatenate(kd_pts))
    kd_dist = np.concatenate(kd_dist)
    occ_idx = np.argwhere(occ_c > 0)
    _, near = kd.query(org_c + sp_ds * occ_idx)
    ostium = np.zeros(occ_c.shape, np.uint8)
    ostium[tuple(occ_idx.T)] = np.clip(np.round(kd_dist[near]), 0, 255)
    cor = np.stack([np.round(occ_c * 255).astype(np.uint8), seg_c, ostium], axis=-1)

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

    def save_gz(name, arr):
        with gzip.open(os.path.join(out, name), 'wb', compresslevel=9) as f:
            f.write(np.ascontiguousarray(arr.transpose(2, 1, 0, *range(3, arr.ndim))).tobytes())  # x fastest

    save_gz('ct.u8.gz', ct_u8)
    save_gz('coronary.rgb8.gz', cor)
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
        coronary=dict(file='coronary.rgb8.gz', dims=list(cor.shape[:3]), spacing_cm=cm(sp_ds),
                      origin_cm=cm(org_c - centre), channels=['occupancy 0-255', 'segment label 0-14', 'distance from ostium, mm'],
                      segments=SEGMENTS, right_segments=[9, 10, 11]),
        vessels='vessels.json')
    with open(os.path.join(out, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    for name in sorted(os.listdir(out)):
        print(f'{name:18s} {os.path.getsize(os.path.join(out, name)) / 1e6:6.2f} MB')
    print('ct dims', ct_u8.shape, 'coronary dims', cor.shape[:3], 'vessels', len(vessels),
          'max ostium dist mm', int(kd_dist.max()))


if __name__ == '__main__':
    main()
