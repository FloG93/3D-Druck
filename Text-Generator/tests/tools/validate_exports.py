"""Validates 3MF/STL files written by tests/tools/generate-exports.mjs.

3MF: read with lib3mf (the 3MF Consortium's reference library) in strict
mode, every part must be a manifold, correctly oriented mesh with the
expected volume; Metadata/model_settings.config must assign the right AMS
filament to each part (read by Bambu Studio / OrcaSlicer); the pieces of a
split stencil are objects of their own. STL: size and
triangle count consistent. DXF: read and audited with ezdxf, every outline
a closed polyline, the area of every layer recomputed from the vertices.
QR codes: the top view (dark lettering on a light plate) is rendered with
5, 8 and 16 pixels per module (a phone camera from far to near) and read
with zxing-cpp. STEP: read with OpenCascade (as Fusion 360 and FreeCAD do):
one component per part with its name, every solid valid (BRepCheck) and
coloured, the volume and the centre of mass of each part as in the model
(cups included: the wall on cylinders and cones).

Usage: python Text-Generator/tests/tools/validate_exports.py <folder>
       (pip install lib3mf ezdxf zxing-cpp pillow cadquery-ocp)
"""
import json, os, struct, sys, zipfile
import xml.etree.ElementTree as ET
import lib3mf

OUT = sys.argv[1] if len(sys.argv) > 1 else 'build/text-exports'
summary = json.load(open(os.path.join(OUT, 'summary.json'), encoding='utf-8'))
wrapper = lib3mf.get_wrapper()
fails = []


def mesh_volume(mesh):
    v = mesh.GetVertices()
    vol = 0.0
    for t in mesh.GetTriangleIndices():
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = (tuple(v[i].Coordinates) for i in t.Indices)
        vol += (x1 * (y2 * z3 - y3 * z2) - x2 * (y1 * z3 - y3 * z1) + x3 * (y1 * z2 - y2 * z1)) / 6
    return vol


for name, exp in summary.items():
    path = os.path.join(OUT, f'{name}.3mf')
    model = wrapper.CreateModel()
    reader = model.QueryReader('3mf')
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(path)
    warnings = [reader.GetWarning(i) for i in range(reader.GetWarningCount())]
    meshes = {}
    it = model.GetMeshObjects()
    while it.MoveNext():
        m = it.GetCurrentMeshObject()
        meshes[m.GetResourceID()] = m
    config = ET.fromstring(zipfile.ZipFile(path).read('Metadata/model_settings.config'))
    parts = {int(p.get('id')): {m.get('key'): m.get('value') for m in p.findall('metadata')}
             for o in config.findall('object') for p in o.findall('part')}
    items = model.GetBuildItems()
    n_items = 0
    while items.MoveNext():
        n_items += 1
    line = [f'{n_items} Objekte'] if n_items > 1 else []
    ok = (not warnings and len(meshes) == len(exp['parts']) and n_items == exp['objects']
          and len(config.findall('object')) == exp['objects'])
    for i, e in enumerate(exp['parts']):
        m = meshes.get(i + 1)
        cfg = parts.get(i + 1, {})
        vol = mesh_volume(m) if m else 0
        good = (m is not None and m.IsManifoldAndOriented() and m.GetName() == e['name']
                and abs(vol - e['volume']) <= max(1e-3 * e['volume'], 0.05)
                and cfg.get('name') == e['name'] and int(cfg.get('extruder', 0)) == e['slot'])
        ok = ok and good
        line.append(f"{e['name']} F{e['slot']} {vol:.1f} mm³ {'OK' if good else 'FAIL'}")
    data = open(os.path.join(OUT, f'{name}.stl'), 'rb').read()
    n = struct.unpack('<I', data[80:84])[0]
    ok = ok and len(data) == 84 + 50 * n
    print(f"3MF {exp['title'][:22]:22} " + ' | '.join(line) + (f' | WARNUNGEN {warnings}' if warnings else '') + ('  OK' if ok else '  FAIL'))
    if not ok:
        fails.append(name)

# DXF: closed polylines only; outer rings counter-clockwise, holes clockwise,
# so the signed areas per layer add up to the area of the part.
from ezdxf import recover

for name, exp in summary.items():
    doc, auditor = recover.readfile(os.path.join(OUT, f'{name}.dxf'))
    areas, count, bad = {}, 0, []
    for e in doc.modelspace():
        if e.dxftype() != 'POLYLINE' or not e.is_closed:
            bad.append(e.dxftype())
            continue
        pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
        a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1])) / 2
        areas[e.dxf.layer] = areas.get(e.dxf.layer, 0) + a
        count += 1
    units = doc.header.get('$INSUNITS')
    ok = (not auditor.has_errors and not bad and units == 4 and set(areas) == set(exp['dxf'])
          and all(abs(areas[k] - v) <= max(1e-4 * v, 1e-3) for k, v in exp['dxf'].items()))
    detail = ', '.join(f'{k} {areas.get(k, 0):.1f}/{v:.1f} mm²' for k, v in exp['dxf'].items())
    print(f"DXF {exp['title'][:22]:22} {count} Linienzüge | {detail}{' | ' + str(bad) if bad else ''}  {'OK' if ok else 'FAIL'}")
    if not ok:
        fails.append(f'{name}.dxf')

# QR codes must be readable: dark shapes (outer rings black, holes white).
from PIL import Image, ImageDraw
import zxingcpp

for name, q in json.load(open(os.path.join(OUT, 'qr.json'), encoding='utf-8')).items():
    rings = q['dark']
    xs = [r[i] for r in rings for i in range(0, len(r), 2)]
    ys = [r[i] for r in rings for i in range(1, len(r), 2)]
    quiet = 6.0
    x0, y1 = min(xs) - quiet, max(ys) + quiet
    decoded = {}
    for px in (5, 8, 16):
        scale = px / q['module']
        size = (int((max(xs) - min(xs) + 2 * quiet) * scale), int((max(ys) - min(ys) + 2 * quiet) * scale))
        img = Image.new('L', size, 255)
        draw = ImageDraw.Draw(img)
        # Outer rings run counter-clockwise (positive area), holes clockwise.
        def area(r):
            return sum(r[i] * r[(i + 3) % len(r)] - r[(i + 2) % len(r)] * r[i + 1] for i in range(0, len(r), 2)) / 2
        for r in sorted(rings, key=lambda r: -abs(area(r))):
            pts = [((r[i] - x0) * scale, (y1 - r[i + 1]) * scale) for i in range(0, len(r), 2)]
            draw.polygon(pts, fill=0 if area(r) > 0 else 255)
        found = [b.text for b in zxingcpp.read_barcodes(img) if b.format == zxingcpp.BarcodeFormat.QRCode]
        decoded[px] = found[0] if found else None
    ok = all(v == q['content'] for v in decoded.values())
    print(f"QR  {name[:34]:34} {'OK' if ok else 'FAIL'}  {q['content'][:40]!r} {'' if ok else decoded}")
    if not ok:
        fails.append(name)

# STEP: an assembly of named, coloured components with valid solids.
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType
from OCP.TDF import TDF_Label
try:
    from OCP.collections import Sequence_TDF_Label
except ImportError:  # older OCP builds
    from OCP.TDF import TDF_LabelSequence as Sequence_TDF_Label
from OCP.TDataStd import TDataStd_Name
from OCP.TCollection import TCollection_ExtendedString
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE
from OCP.Quantity import Quantity_Color


def label_name(label):
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else ''


for name, exp in summary.items():
    if not exp.get('step'):
        continue
    doc = TDocStd_Document(TCollection_ExtendedString('step'))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetColorMode(True)
    ok = reader.ReadFile(os.path.join(OUT, f'{name}.step')) == IFSelect_RetDone and reader.Transfer(doc)
    shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    colors = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    free = Sequence_TDF_Label()
    shapes.GetFreeShapes(free)
    comps = Sequence_TDF_Label()
    if free.Length() == 1:
        shapes.GetComponents_s(free.Value(1), comps)
    ok = ok and comps.Length() == len(exp['parts'])
    line = []
    for i, e in enumerate(exp['parts']):
        if i >= comps.Length():
            break
        ref = TDF_Label()
        shapes.GetReferredShape_s(comps.Value(i + 1), ref)
        solids = invalid = faces = coloured = 0
        vol = 0.0
        moment = [0.0, 0.0, 0.0]
        col = Quantity_Color()
        ex = TopExp_Explorer(shapes.GetShape_s(ref), TopAbs_SOLID)
        while ex.More():
            s = ex.Current()
            solids += 1
            invalid += 0 if BRepCheck_Analyzer(s).IsValid() else 1
            p = GProp_GProps()
            BRepGProp.VolumeProperties_s(s, p)
            vol += p.Mass()
            g = p.CentreOfMass()
            moment = [moment[0] + g.X() * p.Mass(), moment[1] + g.Y() * p.Mass(), moment[2] + g.Z() * p.Mass()]
            fe = TopExp_Explorer(s, TopAbs_FACE)
            while fe.More():
                faces += 1
                fe.Next()
            coloured += 1 if colors.GetColor(s, XCAFDoc_ColorType.XCAFDoc_ColorSurf, col) else 0
            ex.Next()
        # Exact curves within 0.01 mm and true circles: close to the mesh.
        expected = e.get('stepVolume', e['volume'])
        shift = max(abs(m / vol - c) for m, c in zip(moment, e['centroid'])) if e.get('centroid') and vol else 0.0
        good = (label_name(ref) == e['name'] and solids > 0 and invalid == 0 and coloured == solids
                and abs(vol - expected) <= max(5e-3 * expected, e['stepTol'], 0.5) and shift < 0.05)
        ok = ok and good
        line.append(f"{e['name']} {solids}×{faces}F {vol:.1f} mm³{f' Δ{shift:.3f}' if shift >= 0.005 else ''} {'OK' if good else 'FAIL'}")
    print(f"STEP {exp['title'][:21]:21} " + ' | '.join(line) + ('  OK' if ok else '  FAIL'))
    if not ok:
        fails.append(f'{name}.step')

print('Alle Exporte gültig.' if not fails else f'FEHLER: {fails}')
sys.exit(1 if fails else 0)
