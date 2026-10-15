import sys; sys.argv = sys.argv[:1]
import numpy as np, io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import recon as rc
import probe1 as p, check2 as c2
ref = p.volume(c2.part)
base = p.tessellate(c2.part, 0.05).astype(np.float32).astype(float)
cases = (('1x unterteilt', c2.subdivide(base)), ('2x unterteilt', c2.subdivide(c2.subdivide(base))),
         ('grob (Auflösung 0.5)', p.tessellate(c2.part, 0.5).astype(np.float32).astype(float)))
for name, tr in cases:
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            sol, stat, free = rc.reconstruct(tr)
        v = p.volume(sol); ok = p.BRepCheck_Analyzer(sol).IsValid()
        print(f'{name:22s} {stat}, freie Kanten {free}, gültig={ok}, Vol.-Abw. {100*(v-ref)/ref:+.4f}%')
    except Exception as e:
        print(f'{name:22s} FEHLER {type(e).__name__}: {str(e)[:80]}')
