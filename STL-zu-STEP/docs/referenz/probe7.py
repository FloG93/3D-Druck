import sys; sys.argv = sys.argv[:1]
import numpy as np, io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    import probe4 as p4, check2 as c2, probe6 as p6
import probe1 as p
from OCP.BRepPrimAPI import BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeTorus
shapes = (('Teil (6 echte Zylinder)', c2.part), ('Kugel r=8', BRepPrimAPI_MakeSphere(8.0).Shape()), ('Kegel', BRepPrimAPI_MakeCone(6.0, 2.0, 10.0).Shape()), ('Torus 8/2', BRepPrimAPI_MakeTorus(8.0, 2.0).Shape()))
for name, shape in shapes:
    for defl in (0.05, 0.5):
        tr = p.tessellate(shape, defl).astype(np.float32).astype(float); rej = []
        f = p4.detect(tr, name, quiet=True, verify=p6.verdict, rejected=rej)
        reasons = {}
        for r_ in rej:
            for w in r_: reasons[w.split(' (')[0]] = reasons.get(w.split(' (')[0], 0) + 1
        print(f'{name:26s} Auflösung {defl}: {len(tr):5d} Dreiecke -> angenommen {len(f)}, verworfen {len(rej)} {reasons}')
