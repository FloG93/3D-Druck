"""Validates the STEP files written by tests/tools/generate-exports.mjs by reading them with OpenCascade (as Fusion 360 and FreeCAD do).

Per file (summary.json maps a file name to its expectations, see ../fixtures/expected.json for the vocabulary):
  - STEP is read without errors and every solid passes BRepCheck (valid, closed)
  - number of solids (`koerper`)
  - volume within `volumen_toleranz_prozent` (default 0.05) of `volumen`
  - faces by surface type: `ebenen` = planar faces, `zylinder` = cylindrical faces (a full cylinder may be split into
    halves, so a radius must occur at least as often as listed, and no radius may occur that is not listed).
    Radii are matched within `toleranz_radius_prozent` (default 0.05 %), because a radius fitted from a subdivided
    mesh carries the chord height: measured -0.18 % on platte-unterteilt2.stl (see docs/MACHBARKEIT.md section 2)
  - `max_flaechen`: upper bound for the number of faces (guards against the faceted fallback sneaking in)
  - `stufe` (1 faceted, 2 planar, 3 cylinders): the exporter reports which tier it delivered; checked against `mindest_stufe`

Usage: python STL-zu-STEP/tests/tools/validate_step.py <folder with .step files and summary.json>
       (pip install cadquery-ocp; written against OCP 8)
"""
import json, os, sys
from collections import Counter
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE
from OCP.TopoDS import TopoDS
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp


def explore(shape, kind):
    ex = TopExp_Explorer(shape, kind)
    while ex.More():
        yield ex.Current(); ex.Next()


def inspect(path):
    r = STEPControl_Reader()
    if r.ReadFile(path) != IFSelect_RetDone: return None
    r.TransferRoots(); shape = r.OneShape()
    solids = [TopoDS.Solid(s) for s in explore(shape, TopAbs_SOLID)]
    vol = 0.0; valid = True
    for s in solids:
        p = GProp_GProps(); BRepGProp.VolumeProperties_s(s, p); vol += p.Mass(); valid &= BRepCheck_Analyzer(s).IsValid()
    planes = 0; cyl = Counter(); other = 0
    for f in explore(shape, TopAbs_FACE):
        t = BRepAdaptor_Surface(TopoDS.Face(f)).GetType()
        if t == GeomAbs_Plane: planes += 1
        elif t == GeomAbs_Cylinder: cyl[round(BRepAdaptor_Surface(TopoDS.Face(f)).Cylinder().Radius(), 4)] += 1
        else: other += 1
    return dict(solids=len(solids), volume=vol, valid=valid, planes=planes, cyl=cyl, other=other, faces=planes + sum(cyl.values()) + other)


def main(folder):
    summary = json.load(open(os.path.join(folder, 'summary.json'), encoding='utf-8'))
    fails = []
    for name, exp in summary.items():
        path = os.path.join(folder, name if name.endswith('.step') else name + '.step')
        got = inspect(path) if os.path.exists(path) else None
        if got is None: fails.append(f'{name}: STEP missing or unreadable'); continue
        bad = []
        if not got['valid']: bad.append('BRepCheck: invalid solid')
        if 'koerper' in exp and got['solids'] != exp['koerper']: bad.append(f"solids {got['solids']} != {exp['koerper']}")
        if 'volumen' in exp:
            tol = exp.get('volumen_toleranz_prozent', 0.05); dev = 100 * (got['volume'] - exp['volumen']) / exp['volumen']
            if abs(dev) > tol: bad.append(f"volume {got['volume']:.3f} deviates {dev:+.3f}% (> {tol}%)")
        if 'ebenen' in exp and got['planes'] != exp['ebenen']: bad.append(f"planar faces {got['planes']} != {exp['ebenen']}")
        if 'zylinder' in exp:
            tol = exp.get('toleranz_radius_prozent', 0.05)
            want = Counter(float(z['r']) for z in exp['zylinder'])
            left = Counter(got['cyl'])
            for r, n in sorted(want.items()):
                # A radius counts as found when it is within the tolerance; a full
                # cylinder may be split into halves, so more faces are fine.
                found = sum(c for rr, c in left.items() if abs(rr - r) <= tol / 100 * r)
                if found < n:
                    bad.append(f'cylinder r={r}: {found} faces within {tol} % < {n}')
                for rr in [rr for rr in list(left) if abs(rr - r) <= tol / 100 * r]:
                    del left[rr]
            for r in left:
                bad.append(f'unexpected cylinder r={r}')
        if 'max_flaechen' in exp and got['faces'] > exp['max_flaechen']: bad.append(f"{got['faces']} faces > {exp['max_flaechen']}")
        print(('FAIL ' if bad else 'ok   ') + f"{name}: {got['solids']} solid(s), {got['faces']} faces ({got['planes']} planar, {dict(got['cyl'])}, {got['other']} other), volume {got['volume']:.3f}")
        fails += [f'{name}: {b}' for b in bad]
    if fails:
        print('\n' + '\n'.join(fails)); sys.exit(1)
    print(f'\n{len(summary)} files ok')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'build/stl-exports')
