"""Machbarkeit Stufe 1+2: Netz -> geschlossener Volumenkörper (facettiert) -> ebene Flächen verschmolzen."""
import time, os, struct, numpy as np
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_SOLID, TopAbs_SHELL, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt, gp_Ax2, gp_Dir
from OCP.BRepBuilderAPI import (BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace, BRepBuilderAPI_Sewing,
                                BRepBuilderAPI_MakeSolid)
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs, STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.IFSelect import IFSelect_RetDone

OUT = os.path.dirname(os.path.abspath(__file__))

def make_part():
    box = BRepPrimAPI_MakeBox(40, 20, 10).Shape()
    for x in (10, 30):
        cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, 10, -1), gp_Dir(0, 0, 1)), 3.0, 12).Shape()
        box = BRepAlgoAPI_Cut(box, cyl).Shape()
    return box

def volume(s):
    p = GProp_GProps(); BRepGProp.VolumeProperties_s(s, p); return p.Mass()

def tessellate(shape, defl):
    BRepMesh_IncrementalMesh(shape, defl, False, 0.3, True)
    tris = []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face(ex.Current()); loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(f, loc)
        rev = f.Orientation() == TopAbs_REVERSED
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            if rev: b, c = c, b
            pts = [tri.Node(k).Transformed(loc.Transformation()) for k in (a, b, c)]
            tris.append([[p.X(), p.Y(), p.Z()] for p in pts])
        ex.Next()
    return np.array(tris)

def write_stl(path, tris):
    with open(path, 'wb') as f:
        f.write(b'\0' * 80); f.write(struct.pack('<I', len(tris)))
        for t in tris:
            n = np.cross(t[1] - t[0], t[2] - t[0]); l = np.linalg.norm(n); n = n / l if l else n
            f.write(struct.pack('<12fH', *n, *t.flatten(), 0))

def read_stl(path):
    d = open(path, 'rb').read(); n = struct.unpack('<I', d[80:84])[0]
    a = np.frombuffer(d, dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]), count=n, offset=84)
    return a['v'].astype(float)

def weld(tris, tol=1e-4):
    keys = np.round(tris.reshape(-1, 3) / tol).astype(np.int64)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    verts = np.zeros((len(uniq), 3)); verts[inv] = tris.reshape(-1, 3)
    return verts, inv.reshape(-1, 3)

def edge_stats(F):
    from collections import Counter
    c = Counter()
    for a, b, d in F:
        for u, v in ((a, b), (b, d), (d, a)): c[(u, v)] += 1
    open_e = sum(1 for (u, v) in c if (v, u) not in c)
    nonman = sum(1 for k, n in c.items() if n > 1)
    return open_e, nonman

def to_solid(V, F):
    t = time.time()
    sew = BRepBuilderAPI_Sewing(1e-4)
    for a, b, c in F:
        pts = [gp_Pnt(*V[i]) for i in (a, b, c)]
        mk = BRepBuilderAPI_MakePolygon(pts[0], pts[1], pts[2], True)
        mk_f = BRepBuilderAPI_MakeFace(mk.Wire(), True)
        if mk_f.IsDone(): sew.Add(mk_f.Face())
    sew.Perform()
    sh = sew.SewedShape()
    ex = TopExp_Explorer(sh, TopAbs_SHELL)
    shell = TopoDS.Shell(ex.Current())
    ms = BRepBuilderAPI_MakeSolid(shell); sol = ms.Solid()
    # Orientierung prüfen: negatives Volumen -> Schale umdrehen
    if volume(sol) < 0:
        sol.Reverse()
    return sol, time.time() - t

def step_out(shape, path):
    w = STEPControl_Writer(); w.Transfer(shape, STEPControl_AsIs); w.Write(path)
    return os.path.getsize(path)

def count(shape, kind):
    n = 0; ex = TopExp_Explorer(shape, kind)
    while ex.More(): n += 1; ex.Next()
    return n

def check(path):
    r = STEPControl_Reader(); ok = r.ReadFile(path) == IFSelect_RetDone; r.TransferRoots(); s = r.OneShape()
    return ok, BRepCheck_Analyzer(s).IsValid(), count(s, TopAbs_SOLID), count(s, TopAbs_FACE), volume(s)

if __name__ == '__main__':
    part = make_part()
    ref = volume(part)
    print('Original: Flächen', count(part, TopAbs_FACE), 'Volumen', round(ref, 3))
    for defl in (0.05, 0.01):
        tris = tessellate(make_part(), defl)
        stl = f'{OUT}/part_{defl}.stl'; write_stl(stl, tris)
        tris = read_stl(stl)
        V, F = weld(tris)
        print(f'\n--- Auflösung {defl}: {len(F)} Dreiecke, {len(V)} Punkte, offene/nichtmanifold Kanten:', edge_stats(F))
        sol, t = to_solid(V, F)
        print(f'Sewing -> Solid: {t:.2f}s, Volumen {volume(sol):.3f} (Abw. {100*(volume(sol)-ref)/ref:+.3f}%)')
        p1 = f'{OUT}/facet_{defl}.step'; sz = step_out(sol, p1)
        print('  STEP facettiert:', sz // 1024, 'kB', check(p1))
        t = time.time()
        u = ShapeUpgrade_UnifySameDomain(sol, True, True, True); u.SetLinearTolerance(1e-3); u.SetAngularTolerance(1e-4); u.Build()
        s2 = u.Shape()
        p2 = f'{OUT}/unified_{defl}.step'; sz = step_out(s2, p2)
        print(f'  UnifySameDomain {time.time()-t:.2f}s -> Flächen {count(s2, TopAbs_FACE)}, {sz//1024} kB', check(p2))
