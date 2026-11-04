"""Rank ImageCAS-X scans as candidates for the simulator.

Filters to excellent image quality (4), right dominance and no disease, then
ranks by how many key segments have a centreline and by field of view.
Standard library only.

    python3 tools/pick_scan.py [data/raw/imagecas-x/ImageCAS-X_dataset] [-n 25]
"""
import argparse, csv, gzip, io, math, os, re, struct, sys, zipfile
import xml.etree.ElementTree as ET

SEGMENTS = {1: 'LM', 2: 'LAD', 3: 'LCx', 4: 'D1', 5: 'D2', 6: 'OM1', 7: 'OM2', 8: 'IM',
            9: 'RCA', 10: 'R-PDA', 11: 'R-PLA', 12: 'L-PDA', 13: 'L-PLA', 14: 'Other'}
KEY = [1, 2, 3, 4, 6, 9, 10, 11]  # LM LAD LCx D1 OM1 RCA R-PDA R-PLA


def read_xlsx(path):
    """First sheet of an .xlsx as a list of dicts (header row = keys)."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(ns + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(ns + 't')))
    rows = []
    for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).iter(ns + 'row'):
        cells = {}
        for c in row.iter(ns + 'c'):
            col = re.match(r'[A-Z]+', c.get('r')).group()
            v = c.find(ns + 'v')
            val = '' if v is None else v.text
            if c.get('t') == 's':
                val = shared[int(val)]
            cells[col] = val
        rows.append([cells[k] for k in sorted(cells, key=lambda k: (len(k), k))])
    header, *body = rows
    return [dict(zip(header, r)) for r in body if r]


def nifti_extent_cm(path):
    """Physical size (cm) of a NIfTI-1 volume, from its header only."""
    h = gzip.open(path).read(348)
    e = '<' if struct.unpack('<i', h[:4])[0] == 348 else '>'
    dim = struct.unpack(e + '8h', h[40:56])[1:4]
    pix = struct.unpack(e + '8f', h[76:108])[1:4]
    return [d * p / 10 for d, p in zip(dim, pix)]


def centreline_lengths_mm(path):
    """Length per segment label of a VTK 5.1 polydata centreline (ASCII or binary)."""
    b = open(path, 'rb').read()
    ascii_ = b'\nASCII\n' in b[:200]

    def array(header, count, fmt):
        o = re.search(header, b).end()
        if ascii_:
            return [(float if fmt == 'f' else int)(t) for t in b[o:].split(None, count)[:count]]
        return struct.unpack('>%d%s' % (count, fmt), b[o:o + struct.calcsize(fmt) * count])

    n = int(re.search(rb'POINTS (\d+) float\n', b).group(1))
    pts = array(rb'POINTS \d+ float\n', 3 * n, 'f')
    m = re.search(rb'LINES (\d+) (\d+)\nOFFSETS vtktypeint(\d+)\n', b)
    n_off, n_con = int(m.group(1)), int(m.group(2))
    off = array(rb'OFFSETS vtktypeint\d+\n', n_off, 'q' if m.group(3) == b'64' else 'i')
    m = re.search(rb'CONNECTIVITY vtktypeint(\d+)\n', b)
    con = array(rb'CONNECTIVITY vtktypeint\d+\n', n_con, 'q' if m.group(1) == b'64' else 'i')
    lab = array(rb'SCALARS segment_label int[^\n]*\nLOOKUP_TABLE[^\n]*\n', n, 'i')
    lengths = {}
    for a, z in zip(off, off[1:]):
        for j in range(a + 1, z):
            u, v = con[j - 1], con[j]
            lengths[lab[v]] = lengths.get(lab[v], 0) + math.dist(pts[3*u:3*u+3], pts[3*v:3*v+3])
    return lengths


def block(i):
    lo = (i - 1) // 200 * 200 + 1
    return f'{lo}-{lo + 199}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default='data/raw/imagecas-x/ImageCAS-X_dataset')
    ap.add_argument('-n', type=int, default=25)
    args = ap.parse_args()
    out = []
    for r in read_xlsx(os.path.join(args.root, 'Descriptors.xlsx')):
        if (r['Image Quality'], r['Dominance'], r['Disease']) != ('4', 'R', 'no'):
            continue
        i = r['Scan ID']
        seg = os.path.join(args.root, 'segmentations', f'{i}.coronary.nii.gz')
        if not os.path.exists(seg):
            continue
        lengths = {}
        for side in ('left', 'right'):
            p = os.path.join(args.root, 'centerlines', f'{i}.coronary_{side}_centerline.vtk')
            for k, v in centreline_lengths_mm(p).items():
                lengths[k] = lengths.get(k, 0) + v
        have = sum(lengths.get(k, 0) > 5 for k in KEY)
        out.append((int(i), nifti_extent_cm(seg), have, lengths))
    out.sort(key=lambda t: (-t[2], -t[1][0] * t[1][2]))
    print(f'{len(out)} candidates (quality 4, right-dominant, no disease)')
    for i, ext, have, L in out[:args.n]:
        segs = ' '.join(f'{SEGMENTS.get(k, k)}:{v / 10:.1f}' for k, v in sorted(L.items()))
        print(f'{i:4d} {block(i):9s} FOV {ext[0]:.1f}x{ext[1]:.1f}x{ext[2]:.1f} cm  key {have}/{len(KEY)}  {segs}')


if __name__ == '__main__':
    sys.exit(main())
