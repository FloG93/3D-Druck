import sys; sys.argv = sys.argv[:1]
import numpy as np, probe1 as p, probe2 as q, probe3 as r3, heal, defects as d
from collections import defaultdict
part = q.part_with_fillet(); ref = p.volume(part)
base = p.tessellate(part, 0.05).astype(np.float32).astype(float)
M = d.mutations(base)
def components(F):
    par = list(range(len(F))); em = defaultdict(list)
    for t, f in enumerate(F):
        for u, v in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])): em[(min(u, v), max(u, v))].append(t)
    def fi(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    for ts in em.values():
        for a in ts[1:]: par[fi(a)] = fi(ts[0])
    return len({fi(i) for i in range(len(F))})
for k in ('H zweiter Körper überlappt (Selbstdurchdringung)', 'I Kante mit 3 Dreiecken (nichtmanifold)'):
    V, F, log = heal.heal(M[k])
    print(k, '-> Komponenten:', components(F), ' Netzvolumen (vorzeichenbehaftet):', round(heal.signed_volume(V, F), 1), ' Referenz:', round(ref, 1))
# Unterteilung (Kantenmitten) - Mittelpunkte liegen auf den Sehnen, also innerhalb des Zylinders
def subdivide(tris):
    V, F = p.weld(tris, 1e-4); mid = {}; Vl = list(V); out = []
    def m(a, b):
        k = (min(a, b), max(a, b))
        if k not in mid: mid[k] = len(Vl); Vl.append((V[a] + V[b]) / 2)
        return mid[k]
    for a, b, c in F:
        ab, bc, ca = m(a, b), m(b, c), m(c, a); out += [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
    Vl = np.array(Vl); return Vl[np.array(out)]
print('\n-- Unterteilte Netze (Kantenmitten liegen auf den Sehnen, nicht auf der Fläche) --')
sub = subdivide(base)
r3.detect(sub, f'unterteilt, Toleranz 1% r', tol_rel=0.01, tol_abs=1e-3)
r3.detect(sub, f'unterteilt, Toleranz 3% r', tol_rel=0.03, tol_abs=1e-3)
# niedrige Auflösung: n-Eck-Löcher
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.gp import gp_Vec
def polyhole(n, rad=3.0):
    box = p.BRepPrimAPI_MakeBox(40, 20, 10).Shape()
    pts = [p.gp_Pnt(20 + rad * np.cos(2 * np.pi * i / n), 10 + rad * np.sin(2 * np.pi * i / n), -1) for i in range(n)]
    mk = BRepBuilderAPI_MakePolygon()
    for pt in pts: mk.Add(pt)
    mk.Close(); f = BRepBuilderAPI_MakeFace(mk.Wire()).Face()
    prism = BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, 12)).Shape()
    return p.BRepAlgoAPI_Cut(box, prism).Shape()
print('\n-- n-Eck-Löcher: ab wann hält die Erkennung ein Vieleck für einen Zylinder? --')
for n in (6, 8, 12, 16, 32):
    tr = p.tessellate(polyhole(n), 0.05).astype(np.float32).astype(float)
    print(f'n={n}:', end=' '); r3.detect(tr, f'{n}-Eck')
