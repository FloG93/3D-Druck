"""Writes the test corpus of STL-zu-STEP into tests/fixtures/ (binary STL, plus ASCII STL and OBJ cubes) and expected.json.

All parts are made with OpenCascade, so the exact volume and the exact surfaces are known and every test can compare
against ground truth. Deterministic (fixed random seed): re-running changes nothing. The files are committed, so the
JavaScript tests need neither Python nor OpenCascade.

Usage: python STL-zu-STEP/tests/tools/make_fixtures.py        (pip install cadquery-ocp numpy; written against OCP 8)
"""
import json, os, struct, sys
import numpy as np
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeTorus, BRepPrimAPI_MakePrism
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.TopExp import TopExp_Explorer, TopExp
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt, gp_Ax2, gp_Dir, gp_Vec
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
expected = {}


def volume(s):
    p = GProp_GProps(); BRepGProp.VolumeProperties_s(s, p); return p.Mass()


def tessellate(shape, defl=0.05):
    """Triangles with outward orientation, float32-rounded like a real STL."""
    BRepMesh_IncrementalMesh(shape, defl, False, 0.3, True)
    tris = []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face(ex.Current()); loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(f, loc); rev = f.Orientation() == TopAbs_REVERSED
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            if rev: b, c = c, b
            pts = [tri.Node(k).Transformed(loc.Transformation()) for k in (a, b, c)]
            tris.append([[q.X(), q.Y(), q.Z()] for q in pts])
        ex.Next()
    return np.array(tris).astype(np.float32).astype(float)


def write_stl(name, tris):
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(b'STL-zu-STEP Testsammlung'.ljust(80, b'\0')); f.write(struct.pack('<I', len(tris)))
        for t in tris:
            n = np.cross(t[1] - t[0], t[2] - t[0]); l = np.linalg.norm(n); n = n / l if l else n
            f.write(struct.pack('<12fH', *n, *t.flatten(), 0))


def mesh_volume(tris):
    return float(np.einsum('ij,ij->', tris[:, 0], np.cross(tris[:, 1], tris[:, 2])) / 6)


def plate():
    box = BRepPrimAPI_MakeBox(40, 20, 10).Shape()
    f = BRepFilletAPI_MakeFillet(box)
    ex = TopExp_Explorer(box, TopAbs_EDGE)
    while ex.More():
        e = TopoDS.Edge(ex.Current()); a = BRep_Tool.Pnt_s(TopExp.FirstVertex_s(e)); b = BRep_Tool.Pnt_s(TopExp.LastVertex_s(e))
        if abs(a.X() - b.X()) < 1e-9 and abs(a.Y() - b.Y()) < 1e-9: f.Add(2.0, e)   # the four vertical edges
        ex.Next()
    s = f.Shape()
    for x in (10, 30):
        s = BRepAlgoAPI_Cut(s, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, 10, -1), gp_Dir(0, 0, 1)), 3.0, 12).Shape()).Shape()
    return s


def plate_with_polygon_hole(n, rad=3.0):
    box = BRepPrimAPI_MakeBox(40, 20, 10).Shape(); mk = BRepBuilderAPI_MakePolygon()
    for i in range(n): mk.Add(gp_Pnt(20 + rad * np.cos(2 * np.pi * i / n), 10 + rad * np.sin(2 * np.pi * i / n), -1))
    mk.Close(); prism = BRepPrimAPI_MakePrism(BRepBuilderAPI_MakeFace(mk.Wire()).Face(), gp_Vec(0, 0, 12)).Shape()
    return BRepAlgoAPI_Cut(box, prism).Shape()


def subdivide(tris):
    """Edge midpoints on every triangle: new points sit on the chords, i.e. INSIDE curved surfaces."""
    keys = np.round(tris.reshape(-1, 3) / 1e-4).astype(np.int64)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    V = np.zeros((len(uniq), 3)); V[inv] = tris.reshape(-1, 3); F = inv.reshape(-1, 3)
    mid = {}; Vl = list(V); out = []
    def m(a, b):
        k = (min(a, b), max(a, b))
        if k not in mid: mid[k] = len(Vl); Vl.append((V[a] + V[b]) / 2)
        return mid[k]
    for a, b, c in F:
        ab, bc, ca = m(a, b), m(b, c), m(c, a); out += [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
    return np.array(Vl)[np.array(out)].astype(np.float32).astype(float)


def add(name, tris, **info):
    write_stl(name, tris)
    expected[name] = dict(dreiecke=len(tris), netzvolumen=round(mesh_volume(tris), 4), **info)


PLATE_FEATURES = dict(ebenen=6, zylinder=[dict(r=2.0, achse=[0, 0, 1]) for _ in range(4)] + [dict(r=3.0, achse=[0, 0, 1]) for _ in range(2)])

part = plate(); ref = volume(part)
base = tessellate(part)
add('platte.stl', base, beschreibung='Platte 40x20x10, vier Rundungen r=2, zwei Bohrungen r=3 (sauber)', volumen=round(ref, 4), koerper=1, **PLATE_FEATURES)
sub1 = subdivide(base)
add('platte-unterteilt1.stl', sub1, beschreibung='wie platte.stl, jede Kante einmal halbiert (Mittelpunkte auf Sehnen)', volumen=round(ref, 4), koerper=1, toleranz_radius_prozent=0.2, **PLATE_FEATURES)
add('platte-unterteilt2.stl', subdivide(sub1), beschreibung='zweimal halbiert', volumen=round(ref, 4), koerper=1, toleranz_radius_prozent=0.3, **PLATE_FEATURES)

n = len(base); heal = dict(volumen=round(ref, 4), koerper=1, **PLATE_FEATURES)
t = base + rng.normal(0, 2e-5, base.shape)
add('defekt-verrutscht.stl', t, beschreibung='jeder Dreieckspunkt einzeln um ~2e-5 verrutscht (ungeschweisste Punkte)', **heal)
add('defekt-loch.stl', np.delete(base, rng.choice(n, 3, replace=False), axis=0), beschreibung='3 Dreiecke fehlen', **heal)
t = base.copy(); idx = rng.choice(n, n // 20, replace=False); t[idx] = t[idx][:, ::-1]
add('defekt-gedreht.stl', t, beschreibung='5% der Dreiecke mit falscher Umlaufrichtung', **heal)
add('defekt-doppelt.stl', np.vstack([base, base[rng.choice(n, 10, replace=False)]]), beschreibung='10 Dreiecke doppelt', **heal)
deg = np.array([[[1, 1, 1], [2, 2, 2], [3, 3, 3]]] * 5, float)
add('defekt-nulldreiecke.stl', np.vstack([base, deg]), beschreibung='5 Dreiecke ohne Flaeche (Punkte auf einer Geraden)', **heal)
t = base.copy(); i = int(np.argmax(np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1))); a, b, c = t[i]; m_ = (a + b) / 2
add('defekt-tkreuzung.stl', np.vstack([np.delete(t, i, axis=0), [[a, m_, c], [m_, b, c]]]), beschreibung='Kante eines Dreiecks geteilt, Nachbar nicht (T-Kreuzung)', **heal)
add('defekt-invertiert.stl', base[:, ::-1].copy(), beschreibung='alle Dreiecke verkehrt herum (Netzvolumen negativ)', **heal)
add('defekt-zweikoerper.stl', np.vstack([base, base + [5, 3, 1]]), beschreibung='zwei sich durchdringende Koerper in einer Datei', volumen=round(ref, 4), koerper=2, erwartung='zwei Solids; Gesamtvolumen = Summe der Netzvolumina, nicht Vereinigung')
a, b, c = base[0]
add('defekt-nichtmanifold.stl', np.vstack([base, [[a, b, a + [0, 0, 3]]]]), beschreibung='eine Kante gehoert zu drei Dreiecken', **heal, erwartung='das ueberzaehlige Dreieck entfernen, Rest unveraendert')

add('kugel.stl', tessellate(BRepPrimAPI_MakeSphere(8.0).Shape()), beschreibung='Kugel r=8', volumen=round(volume(BRepPrimAPI_MakeSphere(8.0).Shape()), 4), koerper=1, zylinder=[])
cone = BRepPrimAPI_MakeCone(6.0, 2.0, 10.0).Shape()
add('kegel.stl', tessellate(cone), beschreibung='Kegelstumpf r1=6 r2=2 h=10', volumen=round(volume(cone), 4), koerper=1, zylinder=[])
torus = BRepPrimAPI_MakeTorus(8.0, 2.0).Shape()
add('torus.stl', tessellate(torus), beschreibung='Torus R=8 r=2', volumen=round(volume(torus), 4), koerper=1, zylinder=[], bekannte_schwaeche='Prototyp erkennt 3 Scheinzylinder; Ziel 0')

# A recognised cylinder changes the volume: the bore is then round, not a polygon prism.
AS_CYLINDER = round(8000 - np.pi * 3.0 ** 2 * 10, 4)
AS_CYLINDER_NOTE = ('Vieleck oder Zylinder ist aus den Daten nicht entscheidbar: wird das Loch als Zylinder r=3 '
                    'erkannt, hat der Koerper das Volumen volumen_als_zylinder (Platte 40x20x10 minus pi*9*10), '
                    'sonst volumen (Vieleck-Prisma).')
for k, label in ((6, 'sechseck'), (8, 'achteck'), (12, 'zwoelfeck'), (16, 'sechzehneck'), (32, 'zweiunddreissigeck')):
    s = plate_with_polygon_hole(k)
    info = dict(zylinder=[]) if k == 6 else (dict(zylinder=[dict(r=3.0, achse=[0, 0, 1])], vertrauen='unsicher') if k == 8 else dict(zylinder=[dict(r=3.0, achse=[0, 0, 1])], vertrauen='sicher'))
    if k > 6: info.update(volumen_als_zylinder=AS_CYLINDER, erwartung=AS_CYLINDER_NOTE)
    add(f'loch-{label}.stl', tessellate(s), beschreibung=f'Platte mit {k}-eckigem Loch (Vieleck oder grober Zylinder?)', volumen=round(volume(s), 4), koerper=1, **info)

# A sphere with scan noise: nothing on it is a cylinder, but a handful of noisy facets fit one easily. Found on
# 3DBenchy.stl, where 123 of 142 "cylinders" had a radius of 0.01 to 0.5 mm and consisted of three or four triangles
# (see docs/MACHBARKEIT.md section 7).
def with_noise(tris, sigma):
    """Noise per POINT, not per triangle corner: a scan is noisy, not torn apart."""
    keys = np.round(tris.reshape(-1, 3) / 1e-4).astype(np.int64)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    V = np.zeros((len(uniq), 3))
    V[inv] = tris.reshape(-1, 3)
    V = V + rng.normal(0, sigma, V.shape)
    return V[inv].reshape(-1, 3, 3).astype(np.float32).astype(float)


noisy_sphere = with_noise(tessellate(BRepPrimAPI_MakeSphere(8.0).Shape()), 0.01)
add('kugel-rauschen.stl', noisy_sphere,
    beschreibung='Kugel r=8 mit Rauschen 0,01 mm auf jedem Punkt (wie ein Scan)',
    volumen=round(volume(BRepPrimAPI_MakeSphere(8.0).Shape()), 4), koerper=1, zylinder=[],
    volumen_toleranz_prozent=1.0,
    erwartung='kein Zylinder: eine Handvoll verrauschter Facetten passt zwar auf einen Zylinder, belegt aber keinen')

# A bore through a sphere: the rings of the bore end on a CURVED surface, so every ring vertex borders three regions
# and each ring edge becomes a chain of only two points. The direction of such a short arc cannot be read from a
# middle point (there is none), which is where the volume went wrong (see docs/MACHBARKEIT.md section 7).
sphere_with_bore = BRepAlgoAPI_Cut(
    BRepPrimAPI_MakeSphere(15.0).Shape(),
    BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -20), gp_Dir(0, 0, 1)), 3.0, 40).Shape()).Shape()
add('kugel-bohrung.stl', tessellate(sphere_with_bore),
    beschreibung='Kugel r=15 mit durchgehender Bohrung r=3 (Bohrungsringe enden auf gekruemmter Flaeche)',
    volumen=round(volume(sphere_with_bore), 4), koerper=1,
    zylinder=[dict(r=3.0, achse=[0, 0, 1])], vertrauen='sicher',
    erwartung='Bohrung wird ein Zylinder; die Kappenringe liegen auf der gekruemmten Kugelflaeche')

# Two cubes that touch in a single point: the shells share one vertex, so a union-find over POINTS sees one body with
# Euler characteristic 3 and no valid solid comes out. Found in the Utah teapot (see docs/MACHBARKEIT.md section 7).
cube_a = tessellate(BRepPrimAPI_MakeBox(10, 10, 10).Shape(), 1)
cube_b = cube_a + [10, 10, 10]
add('defekt-punktberuehrung.stl', np.vstack([cube_a, cube_b]),
    beschreibung='zwei Wuerfel, die sich in genau einem Punkt beruehren (Schalen ueber einen Punkt verbunden)',
    volumen=1000.0, koerper=2, zylinder=[],
    erwartung='zwei Solids; die Komponenten muessen ueber KANTEN getrennt werden, nicht ueber Punkte')

# Cube 10 mm: binary (above style), ASCII and OBJ with quads – the parsers must read all of them.
cube = tessellate(BRepPrimAPI_MakeBox(10, 10, 10).Shape(), 1)
add('wuerfel.stl', cube, beschreibung='Wuerfel 10 mm', volumen=1000.0, koerper=1, ebenen=6, zylinder=[])
with open(os.path.join(OUT, 'wuerfel-ascii.stl'), 'w') as f:
    f.write('solid wuerfel\n')
    for t in cube:
        n = np.cross(t[1] - t[0], t[2] - t[0]); n = n / np.linalg.norm(n)
        f.write(f'  facet normal {n[0]:.6e} {n[1]:.6e} {n[2]:.6e}\n    outer loop\n' + ''.join(f'      vertex {v[0]:.6e} {v[1]:.6e} {v[2]:.6e}\n' for v in t) + '    endloop\n  endfacet\n')
    f.write('endsolid wuerfel\n')
expected['wuerfel-ascii.stl'] = dict(dreiecke=len(cube), beschreibung='derselbe Wuerfel als ASCII-STL', volumen=1000.0, koerper=1, ebenen=6, zylinder=[])
V = [(x, y, z) for z in (0, 10) for y in (0, 10) for x in (0, 10)]
quads = [(1, 3, 4, 2), (5, 6, 8, 7), (1, 2, 6, 5), (3, 7, 8, 4), (1, 5, 7, 3), (2, 4, 8, 6)]   # outward, counter-clockwise seen from outside
with open(os.path.join(OUT, 'wuerfel-quads.obj'), 'w') as f:
    f.write('# Wuerfel 10 mm, Vierecke\n' + ''.join(f'v {x} {y} {z}\n' for x, y, z in V) + ''.join('f ' + ' '.join(map(str, q)) + '\n' for q in quads))
expected['wuerfel-quads.obj'] = dict(dreiecke=12, beschreibung='Wuerfel als OBJ mit sechs Vierecken (muessen zu 12 Dreiecken werden)', volumen=1000.0, koerper=1, ebenen=6, zylinder=[])

json.dump(expected, open(os.path.join(OUT, 'expected.json'), 'w'), indent=1, ensure_ascii=False)
print(f'{len(expected)} Dateien nach {os.path.normpath(OUT)}')
