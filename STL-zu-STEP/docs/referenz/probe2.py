"""Machbarkeit Stufe 3: Zylinder in einem Dreiecksnetz erkennen (reines numpy, portierbar nach JS)."""
import sys, numpy as np
sys.argv = sys.argv[:1]
import probe1 as p
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.GProp import GProp_GProps

def part_with_fillet():
    box = p.BRepPrimAPI_MakeBox(40, 20, 10).Shape()
    f = BRepFilletAPI_MakeFillet(box)
    # nur die vier senkrechten Kanten (parallel zu Z) verrunden
    from OCP.TopExp import TopExp
    ex = TopExp_Explorer(box, TopAbs_EDGE)
    while ex.More():
        e = TopoDS.Edge(ex.Current())
        v1 = BRep_Tool.Pnt_s(TopExp.FirstVertex_s(e)); v2 = BRep_Tool.Pnt_s(TopExp.LastVertex_s(e))
        if abs(v1.X() - v2.X()) < 1e-9 and abs(v1.Y() - v2.Y()) < 1e-9:
            f.Add(2.0, e)
        ex.Next()
    box = f.Shape()
    for x in (10, 30):
        cyl = p.BRepPrimAPI_MakeCylinder(p.gp_Ax2(p.gp_Pnt(x, 10, -1), p.gp_Dir(0, 0, 1)), 3.0, 12).Shape()
        box = p.BRepAlgoAPI_Cut(box, cyl).Shape()
    return box

def analyse(tris, label, ang_tol=2.0, noise=0):
    V, F = p.weld(tris, 1e-4)
    if noise: V = V + np.random.default_rng(1).normal(0, noise, V.shape)
    P = V[F]
    N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); A = np.linalg.norm(N, axis=1); N /= A[:, None]
    # Nachbarschaft über gemeinsame Kanten
    emap = {}
    for t, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)): emap.setdefault((min(u, v), max(u, v)), []).append(t)
    adj = [[] for _ in F]
    for ts in emap.values():
        if len(ts) == 2: adj[ts[0]].append(ts[1]); adj[ts[1]].append(ts[0])
    # 1) ebene Gebiete: Region Growing mit Normalenabweichung zum Seed
    cosT = np.cos(np.radians(ang_tol)); lab = -np.ones(len(F), int); planes = []
    for s in np.argsort(-A):
        if lab[s] >= 0: continue
        reg = [s]; lab[s] = len(planes); st = [s]
        while st:
            t = st.pop()
            for u in adj[t]:
                if lab[u] < 0 and N[u] @ N[s] > cosT and abs((P[u].mean(0) - P[s].mean(0)) @ N[s]) < 0.02:
                    lab[u] = len(planes); reg.append(u); st.append(u)
        planes.append(reg)
    # 2) Gebiete über flache Knicke (< 50 Grad) zu Ketten verbinden: Zylinderkandidaten
    par = list(range(len(planes)))
    def find(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    for t in range(len(F)):
        for u in adj[t]:
            if lab[t] != lab[u] and N[t] @ N[u] > np.cos(np.radians(50)): par[find(lab[t])] = find(lab[u])
    groups = {}
    for i, r in enumerate(planes): groups.setdefault(find(i), []).append(i)
    big = [g for g in groups.values() if len(g) == 1]
    chains = [[t for i in g for t in planes[i]] for g in groups.values() if len(g) > 1]
    rest = [t for c in chains for t in c]
    out = []
    for comp in chains:
        if len(comp) < 6: out.append(('klein', len(comp))); continue
        Nc = N[comp]
        w, vec = np.linalg.eigh((Nc * A[comp][:, None]).T @ Nc)
        axis = vec[:, 0]  # Normalen stehen senkrecht zur Achse -> kleinster Eigenwert
        pts = np.unique(F[comp].flatten()); X = V[pts]
        u1 = np.cross(axis, [1, 0, 0]); u1 = u1 / np.linalg.norm(u1) if np.linalg.norm(u1) > 1e-6 else np.cross(axis, [0, 1, 0]); u2 = np.cross(axis, u1)
        xy = np.c_[X @ u1, X @ u2]
        M = np.c_[2 * xy, np.ones(len(xy))]; sol = np.linalg.lstsq(M, (xy ** 2).sum(1), rcond=None)[0]
        c = sol[:2]; r = np.sqrt(sol[2] + c @ c)
        res = np.abs(np.hypot(*(xy - c).T) - r)
        ext = np.ptp(X @ axis)
        arc = np.degrees(np.ptp(np.unwrap(np.arctan2(*(xy - c).T[::-1]))))
        out.append(('Zylinder' if res.max() < 0.02 * r + 1e-3 else 'unklar', len(comp), round(r, 4), round(res.max(), 5),
                    np.round(axis, 3).tolist(), round(ext, 3), round(arc, 1)))
    print(f'\n== {label}: {len(F)} Dreiecke; {len(big)} Ebenen; {len(chains)} Ketten')
    for o in out: print('  ', o)

if __name__ == '__main__':
    part = part_with_fillet()
    for defl, noise in ((0.05, 0), (0.2, 0), (0.05, 0.002)):
        tris = p.tessellate(part, defl)
        # STL-Rundung auf float32 wie in echten Dateien
        tris = tris.astype(np.float32).astype(float)
        analyse(tris, f'Auflösung {defl}, Rauschen {noise}', ang_tol=2.0 if not noise else 4.0, noise=noise)
