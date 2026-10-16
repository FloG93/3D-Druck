import sys; sys.argv = sys.argv[:1]
import numpy as np, io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import probe4 as p4, check2 as c2
import probe1 as p
from OCP.BRepPrimAPI import BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeTorus

def verdict(V, F, N, A, trs):
    """Gegenprüfungen für einen Zylinderkandidaten. Gibt (ok, Gründe) zurück."""
    m = p4.fit(V, F, N, A, trs)
    if m is None: return False, ['keine Achse']
    axis, u1, u2, c, r = m
    X = V[np.unique(F[trs].ravel())]; z = X @ axis; ext = np.ptp(z)
    d = np.hypot(X @ u1 - c[0], X @ u2 - c[1])
    why = []
    if ext < 0.3 * r: why.append(f'zu kurz ({ext:.2f} < 0.3 r)')            # Kugel-/Torus-Bänder
    A_ = np.c_[np.ones(len(z)), z - z.mean()]; slope = np.linalg.lstsq(A_, d, rcond=None)[0][1]
    if abs(slope) * ext > 0.01 * r: why.append(f'Radius nicht konstant (Kegel? {abs(slope)*ext/r*100:.1f}% r)')
    # Kugelgegenprobe: algebraische Kugelanpassung auf denselben Punkten
    S = np.linalg.lstsq(np.c_[2 * X, np.ones(len(X))], (X ** 2).sum(1), rcond=None)[0]; cs = S[:3]; rs2 = S[3] + cs @ cs
    if rs2 > 0:
        # Kugel nur, wenn Punkte UND Normalen passen: bei Zylindern mit zwei Ringen liegen die Punkte zufällig auf einer Kugel,
        # die Normalen zeigen aber nicht radial von deren Mittelpunkt weg.
        res_s = np.abs(np.linalg.norm(X - cs, axis=1) - np.sqrt(rs2)).max()
        cen = V[F[trs]].mean(1) - cs; cen /= np.linalg.norm(cen, axis=1)[:, None] + 1e-12
        ncos = np.abs(np.einsum('ij,ij->i', N[trs], cen)).min()
        if res_s < 0.01 * r and ncos > 0.97 and res_s < np.abs(d - r).max() * 0.5 + 1e-9 + 0.002 * r: why.append('Kugel passt besser')
    return not why, why

def run(name, tr):
    # Wie p4.detect, aber mit Gegenprüfung vor der Annahme: Monkeypatch über Kopie der Kandidaten
    V, F, N, A, adj = p4.prep(tr)
    found = p4.detect(tr, name, quiet=True)
    return found

for name, shape in (('Kugel r=8', BRepPrimAPI_MakeSphere(8.0).Shape()), ('Kegel', BRepPrimAPI_MakeCone(6.0, 2.0, 10.0).Shape()),
                    ('Torus 8/2', BRepPrimAPI_MakeTorus(8.0, 2.0).Shape()), ('Teil mit Bohrungen+Rundungen', c2.part)):
    tr = p.tessellate(shape, 0.05).astype(np.float32).astype(float)
    V, F, N, A, adj = p4.prep(tr)
    # Alle Kandidaten aus p4 mit Dreiecksmengen erneut erzeugen: hier vereinfacht über Mehrfachaufruf mit Rückgabe der Dreiecke
    import types
    cands = []
    orig_fit = p4.fit
    def spy(V_, F_, N_, A_, tris, _o=orig_fit):
        res = _o(V_, F_, N_, A_, tris); cands.append(list(tris)); return res
    p4.fit = spy; found = p4.detect(tr, name, quiet=True); p4.fit = orig_fit
    ok = 0; bad = 0; reasons = {}
    for f in found:
        pass
    # Letzter fit je Fund = verfeinerte Anpassung; Kandidatenlisten prüfen: nehme alle, die als Fund endeten (Größe passt)
    sizes = {f[1] for f in found}; checked = [t for t in cands if len(t) in sizes]
    seen = set()
    for t in checked:
        key = tuple(sorted(t))
        if key in seen: continue
        seen.add(key); good, why = verdict(V, F, N, A, t)
        if good: ok += 1
        else:
            bad += 1
            for w in why: reasons[w.split(' (')[0]] = reasons.get(w.split(' (')[0], 0) + 1
    print(f'{name}: {len(found)} Kandidaten -> nach Gegenprüfung angenommen {ok}, verworfen {bad} {reasons}')
