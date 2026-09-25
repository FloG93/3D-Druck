"""Validates 3MF/STL files written by tests/tools/generate-exports.mjs.

3MF: read with lib3mf (the 3MF Consortium's reference library) in strict
mode, every part must be a manifold, correctly oriented mesh with the
expected volume; Metadata/model_settings.config must assign the right AMS
filament to each part (read by Bambu Studio / OrcaSlicer). STL: size and
triangle count consistent. QR codes: the top view (dark lettering on a
light plate) is rendered with 5, 8 and 16 pixels per module (a phone
camera from far to near) and read with zxing-cpp.

Usage: python Text-Generator/tests/tools/validate_exports.py <folder>
       (pip install lib3mf zxing-cpp pillow)
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
    parts = {int(p.get('id')): {m.get('key'): m.get('value') for m in p.findall('metadata')} for p in config.find('object').findall('part')}
    line = []
    ok = not warnings and len(meshes) == len(exp['parts'])
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

print('Alle Exporte gültig.' if not fails else f'FEHLER: {fails}')
sys.exit(1 if fails else 0)
