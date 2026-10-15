"""Rekonstruktion: erkannte Ebenen + Zylinder -> exakter B-rep (Ebenen mit Kreisbögen, echte Zylinderflächen).
Referenzimplementierung in Python/OCP; die Schritte 1-4 (Regionen, Kanten, Ketten, Geometrie je Kette) sind reine Topologie
und werden später in JS nachgebaut, Schritt 5 schreibt dort STEP-Entities statt OCP-Objekte."""
import sys, io, contextlib; sys.argv = sys.argv[:1]
import numpy as np
from collections import defaultdict
with contextlib.redirect_stdout(io.StringIO()):
    import probe4 as p4, check2 as c2, probe6 as p6
import probe1 as p
from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2, gp_Ax3, gp_Pln, gp_Cylinder, gp_Circ
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace, BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_MakeVertex
from OCP.GC import GC_MakeArcOfCircle
from OCP.ShapeFix import ShapeFix_Face, ShapeFix_Solid
from OCP.TopoDS import TopoDS
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SHELL, TopAbs_FACE

TOL = 1e-4

def pnt(x): return gp_Pnt(*[float(v) for v in x])

def build_regions(d):
    V, F, N, A = d['V'], d['F'], d['N'], d['A']
    reg = -np.ones(len(F), int); models = {}
    cyl_patches = set()
    for ci, (pids, m) in enumerate(d['cyls']):
        for k in pids:
            cyl_patches.add(k)
            for t in d['plist'][k]: reg[t] = 100000 + ci
        models[100000 + ci] = ('cyl', m)
    for k, tr in enumerate(d['plist']):
        if k in cyl_patches: continue
        for t in tr: reg[t] = k
        n = (N[tr] * A[tr][:, None]).sum(0); n /= np.linalg.norm(n)
        o = np.unique(F[tr].ravel()); models[k] = ('pln', (V[o].mean(0), n))
    return reg, models

def boundary(F, reg):
    he = {}                                   # (u,v) -> Dreieck
    for t, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)): he[(u, v)] = t
    bhe = defaultdict(list)                   # Region -> [(u,v)] mit Nachbar in anderer Region
    inc = defaultdict(set)
    for (u, v), t in he.items():
        inc[u].add(reg[t]); inc[v].add(reg[t])
        o = he.get((v, u))
        if o is not None and reg[o] != reg[t]: bhe[reg[t]].append((u, v))
    return bhe, inc

def chains(bhe, inc):
    """Ketten zwischen Eckpunkten (>=3 Regionen). Geschlossene Schleifen ohne Ecke werden als eine Kette geführt."""
    out = {}                                   # Region -> Liste von Ketten (Punktfolgen in Umlaufrichtung)
    for R, hes in bhe.items():
        nxt = defaultdict(list)
        for u, v in hes: nxt[u].append(v)
        used = set(); res = []
        starts = [(u, v) for u, v in hes if len(inc[u]) >= 3]
        for u, v in starts + [h for h in hes]:
            if (u, v) in used: continue
            P = [u, v]; used.add((u, v))
            while len(inc[P[-1]]) < 3 and P[-1] != P[0]:
                cand = [w for w in nxt[P[-1]] if (P[-1], w) not in used]
                if not cand: break
                used.add((P[-1], cand[0])); P.append(cand[0])
            res.append(P)
        out[R] = res
    return out

def classify(V, P, models, R, regs_adj):
    """Kante aus dem SCHNITT der Nachbarflächen, nicht aus den Netzpunkten (die liegen bei unterteilten Netzen auf Sehnen)."""
    others = [r for r in regs_adj if r != R]
    mods = [models[r] for r in regs_adj]
    cyl = next((m[1] for m in mods if m[0] == 'cyl'), None)
    pln = next((models[r][1] for r in regs_adj if models[r][0] == 'pln'), None)
    if cyl is not None and pln is not None and len(others) == 1:
        axis = cyl[0]; n = pln[1]
        if abs(abs(n @ axis) - 1) < 1e-6:
            zp = float(pln[0] @ axis)
            return ('circle' if P[0] == P[-1] else 'arc'), (cyl, zp)
        if abs(n @ axis) < 1e-6: return 'ruling', (cyl, None)       # Mantellinie (Rundung/Wand tangential)
    if len(P) == 2: return 'line', None
    X = V[P]; D = X[-1] - X[0]; L = np.linalg.norm(D)
    if L > 1e-9 and P[0] != P[-1]:
        if np.linalg.norm(np.cross(X - X[0], D / L), axis=1).max() < 1e-6: return 'line', None
    return 'poly', None

def on_circle(x, cyl, zp):
    axis, u1, u2, c, r = cyl
    a = np.arctan2(x @ u2 - c[1], x @ u1 - c[0])
    return (c[0] + r * np.cos(a)) * u1 + (c[1] + r * np.cos(a - np.pi / 2)) * u2 + zp * axis

VX = {}
def getv(V, i):
    """Ein Eckpunkt = ein Objekt: alle Kanten teilen sich denselben TopoDS_Vertex (kein Zusammenfügen über Toleranz)."""
    if i not in VX: VX[i] = BRepBuilderAPI_MakeVertex(pnt(V[i])).Vertex()
    return VX[i]

def edge_for(V, P, kind, info):
    X = V[P]
    if kind == 'line': return [BRepBuilderAPI_MakeEdge(getv(V, P[0]), getv(V, P[-1])).Edge()]
    if kind == 'poly': return [BRepBuilderAPI_MakeEdge(getv(V, P[i]), getv(V, P[i + 1])).Edge() for i in range(len(P) - 1)]
    cyl, zp = info; axis, u1, u2, c, r = cyl
    if kind == 'ruling': return [BRepBuilderAPI_MakeEdge(getv(V, P[0]), getv(V, P[-1])).Edge()]
    def circ(x):
        a = np.arctan2(x @ u2 - c[1], x @ u1 - c[0]); return (c[0] + r * np.cos(a)) * u1 + (c[1] + r * np.sin(a)) * u2 + zp * axis
    ctr = c[0] * u1 + c[1] * u2 + zp * axis
    if kind == 'circle':
        return [BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(pnt(ctr), gp_Dir(*axis)), float(r))).Edge()]
    mid = X[len(X) // 2]
    arc = GC_MakeArcOfCircle(pnt(X[0]), pnt(circ(mid)), pnt(X[-1])).Value()
    return [BRepBuilderAPI_MakeEdge(arc, getv(V, P[0]), getv(V, P[-1])).Edge()]

def plane_face(V, R, ch, models, reg_adj):
    pt, n = models[R][1]
    chains_ = list(ch[R]); loops = []
    ends = defaultdict(list)
    for i, P in enumerate(chains_): ends[P[0]].append(i)
    left = set(range(len(chains_)))
    while left:
        i = min(left); loop = [i]; left.discard(i)
        while chains_[loop[-1]][-1] != chains_[loop[0]][0]:
            cand = [j for j in ends[chains_[loop[-1]][-1]] if j in left]
            if not cand: break
            loop.append(cand[0]); left.discard(cand[0])
        loops.append(loop)
    wires = []
    for loop in loops:
        mk = BRepBuilderAPI_MakeWire()
        for i in loop:
            P = chains_[i]; adj = reg_adj[(R, i)]
            kind, cyl = classify(V, P, models, R, adj)
            for e in edge_for(V, P, kind, cyl): mk.Add(e)
        wires.append(mk.Wire())
    # äußere Schleife = größte Fläche
    def area(loop):
        pts = np.concatenate([V[chains_[i][:-1]] for i in loop]); c = pts.mean(0)
        return abs(sum(np.cross(pts[k] - c, pts[(k + 1) % len(pts)] - c) @ n for k in range(len(pts)))) / 2
    order = sorted(range(len(loops)), key=lambda k: -area(loops[k]))
    pl = gp_Pln(pnt(pt), gp_Dir(*n))
    mf = BRepBuilderAPI_MakeFace(pl, wires[order[0]], True)
    for k in order[1:]: mf.Add(wires[k])
    sf = ShapeFix_Face(mf.Face()); sf.Perform()
    return sf.Face()

def cylinder_faces(V, R, models, d, adjs):
    axis, u1, u2, c, r = models[R][1]
    tr = [t for k in d['cyls'][R - 100000][0] for t in d['plist'][k]]
    X = V[np.unique(d['F'][tr].ravel())]
    ang = np.arctan2(X @ u2 - c[1], X @ u1 - c[0]); z = X @ axis
    srt = np.sort(np.mod(ang, 2 * np.pi)); gaps = np.diff(np.r_[srt, srt[0] + 2 * np.pi])
    k = int(np.argmax(gaps)); full = gaps[k] < 0.5          # Rundum-Rohr: größte Lücke klein
    z0, z1 = float(z.min()), float(z.max())
    caps = sorted({float(models[r][1][0] @ axis) for rr in adjs for r in rr if r != R and models[r][0] == 'pln' and abs(abs(models[r][1][1] @ axis) - 1) < 1e-6})
    if len(caps) >= 2: z0, z1 = caps[0], caps[-1]
    origin = c[0] * u1 + c[1] * u2
    ax3 = gp_Ax3(pnt(origin), gp_Dir(*axis), gp_Dir(*u1))
    if not np.isclose(np.cross(u1, u2) @ axis, 1): ax3 = gp_Ax3(pnt(origin), gp_Dir(*axis), gp_Dir(*u1)); ax3.YReverse()
    surf = gp_Cylinder(ax3, float(r))
    if full:
        a0 = srt[0]; spans = [(a0, a0 + np.pi), (a0 + np.pi, a0 + 2 * np.pi)]
    else:
        a0 = srt[(k + 1) % len(srt)]; a1 = srt[k]; a1 = a1 + 2 * np.pi if a1 < a0 else a1; spans = [(a0, a1)]
    return [BRepBuilderAPI_MakeFace(surf, float(s0), float(s1), z0, z1).Face() for s0, s1 in spans]

def snap_corners(V, inc, models, iters=200):
    """Eckpunkte auf den Schnitt ihrer angepassten Nachbarflächen rücken (abwechselnde Projektion).
    Danach benutzen alle Kanten dasselbe Modell, und Kanten schließen ohne Toleranztricks."""
    V2 = V.copy()
    for v, regs in inc.items():
        if len(regs) < 3: continue
        x = V[v].copy()
        for _ in range(iters):
            for r in regs:
                kind, m = models[r]
                if kind == 'pln': pt, n = m; x = x - ((x - pt) @ n) * n
                else:
                    axis, u1, u2, c, rad = m; z = x @ axis; q = np.array([x @ u1 - c[0], x @ u2 - c[1]]); q = q / (np.linalg.norm(q) + 1e-12) * rad
                    x = (c[0] + q[0]) * u1 + (c[1] + q[1]) * u2 + z * axis
        V2[v] = x
    return V2

def merge_cylinders(d):
    """Zylinder mit gleicher Achse, Mittellinie und Radius sind eine Fläche (Übersegmentierung bei verzerrtem Radius)."""
    cyls = [(list(pids), m) for pids, m in d['cyls']]
    changed = True
    while changed:
        changed = False
        for i in range(len(cyls)):
            for j in range(i + 1, len(cyls)):
                (pi, mi), (pj, mj) = cyls[i], cyls[j]
                ai, ui1, ui2, ci, ri = mi; aj, uj1, uj2, cj, rj = mj
                if abs(abs(ai @ aj) - 1) > 1e-4: continue
                ci3 = ci[0] * ui1 + ci[1] * ui2; cj3 = cj[0] * uj1 + cj[1] * uj2; dd = cj3 - ci3; dd = dd - (dd @ ai) * ai
                if np.linalg.norm(dd) > 0.01 * ri or abs(ri - rj) > 0.01 * ri: continue
                # nur verschmelzen, wenn die beiden Stücke aneinanderstoßen
                tri_i = {t for k in pi for t in d['plist'][k]}
                if not any(u in tri_i for k in pj for t in d['plist'][k] for u in d['adj'][t]): continue
                pids = sorted(set(pi) | set(pj)); tr = [t for k in pids for t in d['plist'][k]]
                m = p4.fit(d['V'], d['F'], d['N'], d['A'], tr) or mi
                cyls[i] = (pids, m); cyls.pop(j); changed = True; break
            if changed: break
    d['cyls'] = cyls

def reconstruct(tris, noise=0):
    VX.clear(); d = {}
    p4.detect(tris, 'x', quiet=True, verify=p6.verdict, out=d)
    merge_cylinders(d)
    V, F = d['V'], d['F']
    reg, models = build_regions(d)
    bhe, inc = boundary(F, reg)
    ch = chains(bhe, inc)
    V = snap_corners(V, inc, models)
    # welche Regionen grenzen an eine Kette? (Gegenseite über Zwillingskante)
    he = {}
    for t, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)): he[(u, v)] = t
    reg_adj = {}
    for R, lst in ch.items():
        for i, P in enumerate(lst):
            regs = {R} | {reg[he[(P[k + 1], P[k])]] for k in range(len(P) - 1) if (P[k + 1], P[k]) in he}
            reg_adj[(R, i)] = regs - {R} | {R}
    faces = []; stat = defaultdict(int)
    for R in ch:
        if models[R][0] == 'pln': faces.append(plane_face(V, R, ch, models, reg_adj)); stat['Ebenen'] += 1
        else:
            fs = cylinder_faces(V, R, models, d, [reg_adj[(R, i)] for i in range(len(ch[R]))]); faces += fs; stat['Zylinderflächen'] += len(fs)
    sew = BRepBuilderAPI_Sewing(TOL)
    for f in faces: sew.Add(f)
    sew.Perform(); sh = sew.SewedShape()
    ex = TopExp_Explorer(sh, TopAbs_SHELL); shell = TopoDS.Shell(ex.Current())
    sol = BRepBuilderAPI_MakeSolid(shell).Solid()
    fx = ShapeFix_Solid(sol); fx.Perform(); sol = fx.Solid()
    return sol, dict(stat), len(sew.FreeEdges() if hasattr(sew, 'FreeEdges') else []) if False else sew.NbFreeEdges()

if __name__ == '__main__':
    ref = p.volume(c2.part)
    for defl in (0.05,):
        tr = p.tessellate(c2.part, defl).astype(np.float32).astype(float)
        sol, stat, free = reconstruct(tr)
        v = p.volume(sol)
        n_faces = 0; ex = TopExp_Explorer(sol, TopAbs_FACE)
        while ex.More(): n_faces += 1; ex.Next()
        print(f'Rekonstruktion: {stat}, freie Kanten nach Nähen: {free}')
        print(f'Flächen im Ergebnis: {n_faces} (Original: {8 + 4 + 4 * 0} + Rundungen/Bohrungen), gültig: {p.BRepCheck_Analyzer(sol).IsValid()}')
        print(f'Volumen: {v:.4f}  Original (exakt): {ref:.4f}  Abweichung {100*(v-ref)/ref:+.5f}%   (Netz selbst: +0.02%)')
        path = 'recon.step'; sz = p.step_out(sol, path); print('STEP:', sz // 1024, 'kB', p.check(path))
