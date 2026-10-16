"""Stufe 3b: Zylinder per Seed-und-Wachsen (Region Growing mit Modellprüfung) - kommt mit tangentialen Übergängen klar."""
import sys; sys.argv = sys.argv[:1]
import numpy as np, probe1 as p, probe2 as q

def fit_cyl(V, F, N, A, tris):
    Nc = N[tris]; w, vec = np.linalg.eigh((Nc * A[tris][:, None]).T @ Nc)
    if w[1] / max(w[2], 1e-12) < 0.02: return None            # Normalen fast parallel -> Ebene, kein Zylinder
    axis = vec[:, 0]
    X = V[np.unique(F[tris].flatten())]
    u1 = np.cross(axis, [1, 0, 0]); u1 = u1 / np.linalg.norm(u1) if np.linalg.norm(u1) > .1 else np.cross(axis, [0, 1, 0]); u1 /= np.linalg.norm(u1); u2 = np.cross(axis, u1)
    xy = np.c_[X @ u1, X @ u2]; M = np.c_[2 * xy, np.ones(len(xy))]
    s = np.linalg.lstsq(M, (xy ** 2).sum(1), rcond=None)[0]; c = s[:2]; r2 = s[2] + c @ c
    if r2 <= 0: return None
    return axis, u1, u2, c, np.sqrt(r2)

def detect(tris, label, noise=0, tol_rel=0.01, tol_abs=1e-3):
    V, F = p.weld(tris, 1e-4)
    if noise: V = V + np.random.default_rng(1).normal(0, noise, V.shape)
    P = V[F]; N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); A = np.linalg.norm(N, axis=1); N /= A[:, None]
    emap = {}
    for t, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)): emap.setdefault((min(u, v), max(u, v)), []).append(t)
    adj = [[] for _ in F]
    for ts in emap.values():
        if len(ts) == 2: adj[ts[0]].append(ts[1]); adj[ts[1]].append(ts[0])
    def ring(t, k):
        s = {t}; fr = [t]
        for _ in range(k): fr = [u for x in fr for u in adj[x] if u not in s and N[x] @ N[u] > np.cos(np.radians(50))]; s |= set(fr)
        return list(s)
    def member(m, t):
        axis, u1, u2, c, r = m; ok = True
        xy = np.c_[V[F[t]] @ u1, V[F[t]] @ u2] - c
        d = np.hypot(*xy.T)
        if np.abs(d - r).max() > tol_rel * r + tol_abs: return False
        nr = np.array([xy[:, 0].mean(), xy[:, 1].mean()]); nr /= np.linalg.norm(nr) + 1e-12
        n2 = np.array([N[t] @ u1, N[t] @ u2])
        return abs(N[t] @ axis) < 0.1 and abs(n2 @ nr) > 0.9
    taken = np.zeros(len(F), bool); found = []
    order = np.argsort(A)  # kleine, schmale Facetten zuerst
    for s in order:
        if taken[s]: continue
        seed = [t for t in ring(s, 4) if not taken[t]]
        m = fit_cyl(V, F, N, A, seed)
        smooth = all(N[a] @ N[b] > np.cos(np.radians(50)) for a in seed for b in adj[a] if b in seed)
        if m is None or not smooth or not all(member(m, t) for t in seed): continue
        reg = set(seed); fr = list(seed)
        while fr:
            nf = []
            for t in fr:
                for u in adj[t]:
                    if u not in reg and not taken[u] and N[t] @ N[u] > np.cos(np.radians(50)) and member(m, u): reg.add(u); nf.append(u)
            fr = nf
        reg = list(reg); m2 = fit_cyl(V, F, N, A, reg) or m
        if len(reg) >= 8:
            taken[reg] = True
            axis, u1, u2, c, r = m2
            xy = np.c_[V[np.unique(F[reg])] @ u1, V[np.unique(F[reg])] @ u2] - c
            ang = np.degrees(np.ptp(np.unwrap(np.sort(np.arctan2(xy[:, 1], xy[:, 0])))))
            found.append((len(reg), round(r, 4), np.round(axis, 3).tolist(), round(ang, 1)))
    print(f'\n== {label}: {len(F)} Dreiecke, {len(found)} Zylinder, {int(taken.sum())} Dreiecke abgedeckt ({100*taken.mean():.0f}%)')
    for f in found: print('  ', f)

if __name__ == '__main__':
    part = q.part_with_fillet()
    for defl, noise in ((0.05, 0), (0.2, 0), (0.05, 0.002)):
        detect(p.tessellate(part, defl).astype(np.float32).astype(float), f'Auflösung {defl}, Rauschen {noise}', noise,
               tol_rel=0.01 if not noise else 0.03, tol_abs=1e-3 if not noise else 0.01)
