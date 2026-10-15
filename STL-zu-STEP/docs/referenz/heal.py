"""Heilungs-Prototyp (numpy/scipy): portierbar nach JS. Jeder Schritt zählt, was er gefunden hat."""
import numpy as np
from collections import defaultdict
from scipy.spatial import cKDTree

def weld(tris, tol):
    flat = tris.reshape(-1, 3); tree = cKDTree(flat)
    pairs = tree.query_pairs(tol, output_type='ndarray')
    par = np.arange(len(flat))
    def find(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    for a, b in pairs:
        ra, rb = find(a), find(b)
        if ra != rb: par[max(ra, rb)] = min(ra, rb)
    root = np.array([find(i) for i in range(len(flat))])
    uniq, inv = np.unique(root, return_inverse=True)
    V = flat[uniq]; F = inv.reshape(-1, 3)
    return V, F

def drop_bad(V, F, area_eps):
    rep = (F[:, 0] == F[:, 1]) | (F[:, 1] == F[:, 2]) | (F[:, 0] == F[:, 2])
    P = V[F]; A = np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1) / 2
    thin = A < area_eps
    key = np.sort(F, axis=1); _, first = np.unique(key, axis=0, return_index=True)
    dup = np.ones(len(F), bool); dup[first] = False
    keep = ~(rep | thin | dup)
    return F[keep], dict(entartet=int((rep | thin).sum()), doppelt=int(dup.sum()))

def edges(F):
    d = defaultdict(list)
    for t, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)): d[(u, v)].append(t)
    return d

def orient(F):
    """Konsistente Umlaufrichtung per Breitensuche über Kanten; gibt Anzahl gedrehter Dreiecke."""
    F = F.copy(); d = defaultdict(list)
    for t, (a, b, c) in enumerate(F):
        for u, v in ((a, b), (b, c), (c, a)): d[(min(u, v), max(u, v))].append(t)
    seen = np.zeros(len(F), bool); flips = 0
    for s in range(len(F)):
        if seen[s]: continue
        seen[s] = True; st = [s]
        while st:
            t = st.pop(); a, b, c = F[t]
            for u, v in ((a, b), (b, c), (c, a)):
                ts = d[(min(u, v), max(u, v))]
                if len(ts) != 2: continue
                o = ts[0] if ts[1] == t else ts[1]
                if seen[o]: continue
                x, y, z = F[o]
                same = any((p, q) == (u, v) for p, q in ((x, y), (y, z), (z, x)))  # gleiche Richtung = Widerspruch
                if same: F[o] = (x, z, y); flips += 1
                seen[o] = True; st.append(o)
    return F, flips

def signed_volume(V, F):
    P = V[F]; return np.einsum('ij,ij->', P[:, 0], np.cross(P[:, 1], P[:, 2])) / 6

def split_tjunctions(V, F, tol):
    """Vertex, der auf der Kante eines Dreiecks liegt, ohne Eckpunkt zu sein -> Dreieck dort teilen."""
    tree = cKDTree(V); n = 0; out = []
    for a, b, c in F:
        tri = [a, b, c]; changed = True
        cur = [tri]
        while changed:
            changed = False; nxt = []
            for t in cur:
                done = False
                for i in range(3):
                    u, v = t[i], t[(i + 1) % 3]; w = t[(i + 2) % 3]
                    e = V[v] - V[u]; L = np.linalg.norm(e)
                    if L < 1e-12: continue
                    mid = (V[u] + V[v]) / 2
                    for k in tree.query_ball_point(mid, L / 2 + tol):
                        if k in (u, v): continue
                        s = (V[k] - V[u]) @ e / L ** 2
                        if 1e-6 < s < 1 - 1e-6 and np.linalg.norm(V[u] + s * e - V[k]) < tol:
                            nxt += [[u, k, w], [k, v, w]]; n += 1; done = True; break
                    if done: break
                if done: changed = True
                else: nxt.append(t)
            cur = nxt
        out += cur
    return np.array(out), n

def boundary_loops(F):
    d = edges(F); nxt = defaultdict(list)
    for (u, v) in d:
        if (v, u) not in d: nxt[u].append(v)
    loops = []; used = set()
    for s in list(nxt):
        for first in nxt[s]:
            if (s, first) in used: continue
            loop = [s]; cur = first; used.add((s, first))
            while cur != s and len(loop) < 10000:
                loop.append(cur)
                cands = [w for w in nxt.get(cur, []) if (cur, w) not in used]
                if not cands: break
                used.add((cur, cands[0])); cur = cands[0]
            if cur == s: loops.append(loop)
    return loops

def fill_holes(V, F, max_edges=64):
    """Loch füllen: Ohrenschnitt in der besten Ebene der Randschleife; Schleifen größer als max_edges bleiben offen (melden!)."""
    V = [list(v) for v in V]; F = [list(f) for f in F]; filled = 0; skipped = 0
    for loop in boundary_loops(np.array(F)):
        if len(loop) > max_edges: skipped += 1; continue
        # Schleife läuft entgegen der Umlaufrichtung des Nachbarn: Dreiecke in umgekehrter Reihenfolge einfügen
        P = np.array([V[i] for i in loop]); c = P.mean(0)
        n = np.zeros(3)
        for i in range(len(P)): n += np.cross(P[i] - c, P[(i + 1) % len(P)] - c)
        l = np.linalg.norm(n)
        if l < 1e-12: skipped += 1; continue
        n /= l; ids = list(loop)
        ax = np.cross(n, [1, 0, 0]);
        if np.linalg.norm(ax) < .1: ax = np.cross(n, [0, 1, 0])
        ax /= np.linalg.norm(ax); ay = np.cross(n, ax)
        xy = lambda i: np.array([(np.array(V[i]) - c) @ ax, (np.array(V[i]) - c) @ ay])
        guard = 0
        while len(ids) > 3 and guard < 5000:
            guard += 1; m = len(ids); best = None
            for k in range(m):
                a, b, cc = ids[k - 1], ids[k], ids[(k + 1) % m]
                pa, pb, pc = xy(a), xy(b), xy(cc)
                cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
                if cr <= 1e-12: continue
                inside = False
                for o in ids:
                    if o in (a, b, cc): continue
                    q = xy(o); d1 = (pb[0]-pa[0])*(q[1]-pa[1])-(pb[1]-pa[1])*(q[0]-pa[0]); d2 = (pc[0]-pb[0])*(q[1]-pb[1])-(pc[1]-pb[1])*(q[0]-pb[0]); d3 = (pa[0]-pc[0])*(q[1]-pc[1])-(pa[1]-pc[1])*(q[0]-pc[0])
                    if d1 >= 0 and d2 >= 0 and d3 >= 0: inside = True; break
                if not inside: best = k; break
            if best is None: break
            a, b, cc = ids[best - 1], ids[best], ids[(best + 1) % len(ids)]
            F.append([a, b, cc]); ids.pop(best)
        if len(ids) == 3: F.append([ids[0], ids[1], ids[2]]); filled += 1
        else: skipped += 1
    return np.array(V), np.array(F), dict(gefuellt=filled, offen=skipped)

def heal(tris):
    log = {}
    diag = np.linalg.norm(tris.reshape(-1, 3).max(0) - tris.reshape(-1, 3).min(0)); tol = diag * 1e-5
    V, F = weld(tris, tol); log['punkte'] = len(V)
    F, info = drop_bad(V, F, (diag * 1e-6) ** 2); log.update(info)
    F, nt = split_tjunctions(V, F, tol * 5); log['t_kreuzungen'] = nt
    F, fl = orient(F); log['gedreht'] = fl
    d = edges(F); log['nichtmanifold'] = sum(1 for k, t in d.items() if len(t) > 1)
    V, F, hf = fill_holes(V, F); log.update(hf)
    F, fl2 = orient(F)
    if signed_volume(V, F) < 0: F = F[:, ::-1]; log['global_gedreht'] = True
    d = edges(F); log['offene_kanten'] = sum(1 for (u, v) in d if (v, u) not in d)
    return V, F, log
