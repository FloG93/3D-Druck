import sys; sys.argv = sys.argv[:1]
import numpy as np, probe1 as p, probe2 as q, heal
from OCP.TopAbs import TopAbs_SHELL
rng = np.random.default_rng(7)

def evaluate(V, F, ref):
    """Naiv: nur Sewing. Gibt kurze Diagnose zurück."""
    try:
        import io
        sol, t = p.to_solid(V, F)
        v = p.volume(sol); valid = p.BRepCheck_Analyzer(sol).IsValid()
        return f'gültig={valid}, Vol.-Abw. {100*(v-ref)/ref:+.2f}%'
    except Exception as e:
        return f'FEHLER {type(e).__name__}'

def mutations(tris):
    n = len(tris); out = {}
    out['sauber'] = tris.copy()
    t = tris.copy(); t += rng.normal(0, 2e-5, t.shape); out['A Punkte je Dreieck verrutscht (2e-5)'] = t
    t = np.delete(tris, rng.choice(n, 3, replace=False), axis=0); out['B 3 Dreiecke fehlen (Loch)'] = t
    t = tris.copy(); idx = rng.choice(n, n // 20, replace=False); t[idx] = t[idx][:, ::-1]; out['C 5% Dreiecke falsch herum'] = t
    out['D 10 Dreiecke doppelt'] = np.vstack([tris, tris[rng.choice(n, 10, replace=False)]])
    deg = np.array([[[1, 1, 1], [2, 2, 2], [3, 3, 3]]] * 5, float) + 0; out['E 5 Nulldreiecke'] = np.vstack([tris, deg])
    t = tris.copy(); i = int(np.argmax(np.linalg.norm(np.cross(t[:, 1]-t[:, 0], t[:, 2]-t[:, 0]), axis=1)))
    a, b, c = t[i]; m = (a + b) / 2
    t = np.delete(t, i, axis=0); t = np.vstack([t, [[a, m, c], [m, b, c]]]); out['F T-Kreuzung (Kante geteilt, Nachbar nicht)'] = t
    out['G alle Normalen invertiert'] = tris[:, ::-1].copy()
    sh = tris.copy() + [5, 3, 1]; out['H zweiter Körper überlappt (Selbstdurchdringung)'] = np.vstack([tris, sh])
    a, b, c = tris[0]; out['I Kante mit 3 Dreiecken (nichtmanifold)'] = np.vstack([tris, [[a, b, a + [0, 0, 3]]]])
    return out

if __name__ == '__main__':
    part = q.part_with_fillet(); ref = p.volume(part)
    base = p.tessellate(part, 0.05).astype(np.float32).astype(float)
    print(f'Referenz: {len(base)} Dreiecke, Volumen {ref:.2f}\n')
    for name, tr in mutations(base).items():
        V0, F0 = p.weld(tr, 1e-4)
        naive = evaluate(V0, F0, ref)
        V, F, log = heal.heal(tr)
        healed = evaluate(V, F, ref) if log['offene_kanten'] == 0 else f"nicht geschlossen ({log['offene_kanten']} offene Kanten)"
        print(f'{name}\n   naiv  : {naive}\n   geheilt: {healed}   {log}')
