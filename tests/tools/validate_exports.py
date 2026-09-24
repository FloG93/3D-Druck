"""Validates exports written by tests/tools/generate-exports.mjs.

DXF: read and audited with ezdxf, hole area recomputed from the entities.
STEP: read with OpenCascade, every solid checked (BRepCheck) and its volume
compared with the exact value – tool bodies, the plate with holes and the
plate with raised / recessed relief. STL: closed 2-manifold and plausible
volume, also for relief (the recessed one with sloped flanks).

Usage: python tests/tools/validate_exports.py <folder>   (pip install ezdxf cadquery-ocp)
"""
import json, math, struct, sys, os
from collections import Counter
import ezdxf
from ezdxf import recover
OUT = sys.argv[1] if len(sys.argv) > 1 else 'build/exports'
FAILURES = []

def report(ok, line):
    print(line + ('  OK' if ok else '  FAIL'))
    if not ok:
        FAILURES.append(line)
summary = json.load(open(f'{OUT}/summary.json'))

def dxf_check(name, exp):
    doc, auditor = recover.readfile(f'{OUT}/{name}.dxf')
    msp = doc.modelspace()
    area = {'LOECHER': 0.0, 'BEGRENZUNG': 0.0}
    counts = Counter()
    for e in msp:
        layer = e.dxf.layer
        counts[(layer, e.dxftype())] += 1
        if e.dxftype() == 'LINE':
            s, t = e.dxf.start, e.dxf.end
            area[layer] += (s.x * t.y - t.x * s.y) / 2
        elif e.dxftype() == 'ARC':
            c, r = e.dxf.center, e.dxf.radius
            a0 = math.radians(e.dxf.start_angle); a1 = math.radians(e.dxf.end_angle)
            sweep = (a1 - a0) % (2 * math.pi)
            if sweep < 1e-12: sweep = 2*math.pi
            a1 = a0 + sweep
            area[layer] += (r*r*sweep + r*(c.x*(math.sin(a1)-math.sin(a0)) - c.y*(math.cos(a1)-math.cos(a0)))) / 2
        elif e.dxftype() == 'CIRCLE':
            area[layer] += math.pi * e.dxf.radius ** 2
    errs = len(auditor.errors); fixes = len(auditor.fixes)
    ok_h = abs(area['LOECHER'] - exp['holeArea']) / exp['holeArea'] < 2e-3
    ok_b = abs(area['BEGRENZUNG'] - exp['plateArea']) / exp['plateArea'] < 1e-4
    report(ok_h and ok_b and errs == 0, f"DXF  {name:9s} audit errors={errs} holeArea={area['LOECHER']:.3f} (exp {exp['holeArea']:.3f}) boundary={area['BEGRENZUNG']:.3f} (exp {exp['plateArea']:.3f})")

from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE, TopAbs_SHELL
from OCP.TopoDS import TopoDS
from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds

def step_check(name, exp, mode):
    r = STEPControl_Reader()
    st = r.ReadFile(f'{OUT}/{name}_{mode}.step')
    assert st == IFSelect_RetDone, f'read failed {st}'
    r.TransferRoots()
    shape = r.OneShape()
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    solids = 0; invalid = 0; vol = 0.0; faces = 0
    while ex.More():
        s = TopoDS.Solid(ex.Current()) if hasattr(TopoDS, "Solid") else TopoDS.Solid_s(ex.Current())
        solids += 1
        if not BRepCheck_Analyzer(s).IsValid(): invalid += 1
        p = GProp_GProps(); BRepGProp.VolumeProperties_s(s, p); vol += p.Mass()
        fe = TopExp_Explorer(s, TopAbs_FACE)
        while fe.More(): faces += 1; fe.Next()
        ex.Next()
    t = 3.0
    expv = {
        'tools': exp['holeArea'] * t,
        'plate': (exp['plateArea'] - exp['holeArea']) * t,
        'emboss': exp['plateArea'] * t + exp['holeArea'],
        'deboss': exp['plateArea'] * t - exp['holeArea'],
    }[mode]
    ok = abs(vol - expv) / expv < 1e-4 and invalid == 0
    whole_valid = BRepCheck_Analyzer(shape).IsValid()
    report(ok and whole_valid, f"STEP {name:9s} {mode:6s} solids={solids} invalid={invalid} faces={faces} volume={vol:.3f} (exp {expv:.3f})")

def stl_edges(path):
    """Triangle count, unmatched/non-manifold edges and volume of a binary STL."""
    data = open(path, 'rb').read()
    n = struct.unpack('<I', data[80:84])[0]
    assert len(data) == 84 + 50 * n
    edges = Counter(); vol = 0.0
    for i in range(n):
        v = struct.unpack('<12f', data[84 + 50 * i:84 + 50 * i + 48])
        a, b, c = v[3:6], v[6:9], v[9:12]
        vol += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6
        for p, q in ((a, b), (b, c), (c, a)):
            edges[(p, q)] += 1
    bad = sum(1 for (p, q), k in edges.items() if edges.get((q, p), 0) != k or k != 1)
    return n, bad, vol

def stl_check(name, exp, relief=''):
    data = open(f'{OUT}/{name}{relief}.stl', 'rb').read()
    n = struct.unpack('<I', data[80:84])[0]
    assert len(data) == 84 + 50 * n
    edges = Counter(); vol = 0.0
    for i in range(n):
        off = 84 + 50 * i
        v = struct.unpack('<12f', data[off:off+48])
        a, b, c = v[3:6], v[6:9], v[9:12]
        vol += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6
        for p, q in ((a, b), (b, c), (c, a)):
            edges[(p, q)] += 1
    bad = 0
    for (p, q), k in edges.items():
        if edges.get((q, p), 0) != k or k != 1: bad += 1
    bound = exp['perimeter'] * 0.015 * 3  # inscribed polygons lose at most tol x perimeter
    if relief == '_emboss':
        expv = exp['plateArea'] * 3 + exp['holeArea']
        ok = abs(vol - expv) <= bound
    elif relief == '_deboss':
        # Sloped flanks: less material removed than with straight walls.
        expv = exp['plateArea'] * 3 - exp['holeArea']
        ok = expv - bound <= vol <= exp['plateArea'] * 3
    else:
        expv = (exp['plateArea'] - exp['holeArea']) * 3
        ok = abs(vol - expv) <= bound
    report(bad == 0 and ok, f"STL  {name + relief:16s} triangles={n} open/non-manifold edges={bad} volume={vol:.2f} (exp {expv:.2f} ± {bound:.2f})")

import xml.etree.ElementTree as ET
for name, exp in summary.items():
    dxf_check(name, exp)
    for mode in ('tools', 'plate', 'emboss', 'deboss'):
        step_check(name, exp, mode)
    for relief in ('', '_emboss', '_deboss'):
        stl_check(name, exp, relief)
    for f in (f'{name}.svg', f'{name}_plate.svg'):
        ET.parse(f'{OUT}/{f}')
print('SVG files parsed')
tube = json.load(open(f'{OUT}/tube.json'))
n, bad, vol = stl_edges(f'{OUT}/tube.stl')
report(bad == 0 and abs(vol - tube['volume']) < 2e-3 * tube['volume'],
       f"STL  tube (Zylinder) triangles={n} open/non-manifold edges={bad} volume={vol:.2f} (exp {tube['volume']:.2f})")
if FAILURES:
    print(f'{len(FAILURES)} check(s) failed')
    sys.exit(1)
print('All exports valid.')
