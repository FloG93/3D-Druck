"""Zylindererkennung auf Flächenstücken (Patches) statt Einzeldreiecken: unabhängig von der Vernetzung."""
import sys; sys.argv = sys.argv[:1]
import numpy as np, probe1 as p, probe2 as q, io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import check2 as c2
from collections import defaultdict

def prep(tris, noise=0):
    V, F = p.weld(tris, 1e-4)
    if noise: V = V + np.random.default_rng(1).normal(0, noise, V.shape)
    P = V[F]; N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); A = np.linalg.norm(N, axis=1); N = N / A[:, None]
    em = defaultdict(list)
    for t, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)): em[(min(u, v), max(u, v))].append(t)
    adj = [[] for _ in F]
    for ts in em.values():
        if len(ts) == 2: adj[ts[0]].append(ts[1]); adj[ts[1]].append(ts[0])
    return V, F, N, A, adj

def patches(V, F, N, A, adj, ang, off):
    """Zusammenhängende, ebene Stücke: Normale ≈ Seed-Normale und Abstand zur Seed-Ebene klein."""
    c = np.cos(np.radians(ang)); lab = -np.ones(len(F), int); out = []
    for s in np.argsort(-A):
        if lab[s] >= 0: continue
        lab[s] = len(out); reg = [s]; st = [s]; o = V[F[s][0]]
        while st:
            t = st.pop()
            for u in adj[t]:
                if lab[u] < 0 and N[u] @ N[s] > c and np.abs((V[F[u]] - o) @ N[s]).max() < off:
                    lab[u] = len(out); reg.append(u); st.append(u)
        out.append(reg)
    return out, lab

def fit(V, F, N, A, tris):
    Nc = N[tris]; w, vec = np.linalg.eigh((Nc * A[tris][:, None]).T @ Nc)
    if w[1] / max(w[2], 1e-12) < 0.02: return None
    axis = vec[:, 0]; X = V[np.unique(F[tris].ravel())]
    u1 = np.cross(axis, [1, 0, 0]); u1 = u1 if np.linalg.norm(u1) > .1 else np.cross(axis, [0, 1, 0]); u1 /= np.linalg.norm(u1); u2 = np.cross(axis, u1)
    xy = np.c_[X @ u1, X @ u2]; s = np.linalg.lstsq(np.c_[2 * xy, np.ones(len(xy))], (xy ** 2).sum(1), rcond=None)[0]
    c = s[:2]; r2 = s[2] + c @ c
    return None if r2 <= 0 else (axis, u1, u2, c, np.sqrt(r2))

def detect(tris, label, noise=0, tol_rel=0.01, tol_abs=1e-3, min_patches=3, quiet=False, verify=None, rejected=None, out=None):
    V, F, N, A, adj = prep(tris, noise)
    diag = np.linalg.norm(V.max(0) - V.min(0))
    plist, lab = patches(V, F, N, A, adj, 2.0 if not noise else 5.0, 1e-3 * diag if not noise else 0.02)
    padj = defaultdict(set)
    for t in range(len(F)):
        for u in adj[t]:
            if lab[t] != lab[u] and N[t] @ N[u] > np.cos(np.radians(50)): padj[lab[t]].add(lab[u])
    def member(m, t):
        axis, u1, u2, c, r = m; xy = np.c_[V[F[t]] @ u1, V[F[t]] @ u2] - c
        if np.abs(np.hypot(*xy.T) - r).max() > tol_rel * r + tol_abs: return False
        nr = xy.mean(0); nr /= np.linalg.norm(nr) + 1e-12
        return abs(N[t] @ axis) < 0.1 and abs(np.array([N[t] @ u1, N[t] @ u2]) @ nr) > 0.9
    taken = set(); found = []; cyls = []
    for s in sorted(range(len(plist)), key=lambda i: A[plist[i]].sum()):
        if s in taken or s not in padj: continue
        cand = [s]; fr = [s]; m = None
        while len(cand) < 40:                       # Keim wächst, bis die Normalen genug Winkelspanne haben
            tr = [t for k in cand for t in plist[k]]
            Nc = N[tr]; w = np.linalg.eigvalsh((Nc * A[tr][:, None]).T @ Nc)
            if len(cand) >= min_patches and w[1] / max(w[2], 1e-12) >= 0.05: m = fit(V, F, N, A, tr); break
            nb = [j for k in fr for j in padj[k] if j not in cand and j not in taken]
            if not nb: break
            j = min(nb, key=lambda i: A[plist[i]].sum()); cand.append(j); fr = [j]
        if m is None or not all(member(m, t) for t in tr): continue
        reg = set(cand); fr = list(cand)
        while fr:
            nf = []
            for k in fr:
                for j in padj[k]:
                    if j not in reg and j not in taken and all(member(m, t) for t in plist[j]): reg.add(j); nf.append(j)
            fr = nf
        trs = [t for k in reg for t in plist[k]]; m2 = fit(V, F, N, A, trs) or m
        if len(reg) >= min_patches:
            if verify:
                ok_, why_ = verify(V, F, N, A, trs)
                if not ok_:
                    taken |= reg
                    if rejected is not None: rejected.append(why_)
                    continue
            taken |= reg; axis, u1, u2, c, r = m2; cyls.append((sorted(reg), m2))
            X = V[np.unique(F[trs].ravel())]; xy = np.c_[X @ u1, X @ u2] - c
            found.append((len(reg), len(trs), round(float(r), 4), np.round(axis, 3).tolist(), round(float(np.ptp(X @ axis)), 2)))
    if out is not None: out.update(V=V, F=F, N=N, A=A, adj=adj, plist=plist, lab=lab, cyls=cyls)
    if not quiet:
        print(f'== {label}: {len(F)} Dreiecke, {len(plist)} Stücke, {len(found)} Zylinder')
        for f in found: print('  ', f)
    return found

if __name__ == '__main__':
    base = c2.base
    detect(base, 'Basis')
    detect(base, 'Basis, Rauschen 0.002', noise=0.002, tol_rel=0.03, tol_abs=0.01)
    detect(c2.subdivide(base), 'unterteilt')
    detect(c2.subdivide(c2.subdivide(base)), '2x unterteilt')
    for n in (6, 8, 12, 16):
        detect(p.tessellate(c2.polyhole(n), 0.05).astype(np.float32).astype(float), f'{n}-Eck-Loch')
