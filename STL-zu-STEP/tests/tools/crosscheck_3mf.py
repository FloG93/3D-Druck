#!/usr/bin/env python3
"""Cross-check of the 3MF reader against lib3mf, the reference implementation of the 3MF consortium.

For each 3MF fixture lib3mf flattens the build list (components, transforms) on its own, and the triangle count,
the volume and the bounding box are compared with what js/core/threemf.js reads. Where the reader leaves things out on
purpose (supports, parts not printable, slicer-specific parts, see docs/MACHBARKEIT.md section 8) the difference is
expected and the case is not compared. Not dependencies of the tool (install outside the repo):

    pip install lib3mf numpy
    python3 STL-zu-STEP/tests/tools/crosscheck_3mf.py [file.3mf ...]

Exit code 1 if a compared number differs.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

try:
    import lib3mf
except ImportError as error:  # pragma: no cover
    print(f"lib3mf fehlt ({error}): pip install lib3mf numpy")
    sys.exit(0)

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "STL-zu-STEP" / "tests" / "fixtures" / "3mf"
INFO = ROOT / "STL-zu-STEP" / "tests" / "tools" / "threemf-info.mjs"
# Millimetres per lib3mf unit (eModelUnit: MicroMeter, MilliMeter, CentiMeter, Inch, Foot, Meter).
UNIT_MM = {0: 0.001, 1: 1.0, 2: 10.0, 3: 25.4, 4: 304.8, 5: 1000.0}
# The reader leaves parts out here on purpose, lib3mf does not know why.
NOT_COMPARED = {
    "stuetzen-und-nicht-druckbar.3mf": "Stützstruktur und nicht druckbares Teil werden ausgelassen",
    "bambu-stil.3mf": "Negativteil und Modifizierer werden ausgelassen",
    "prusa-stil.3mf": "Modifizierer im selben Netz wird ausgelassen",
}


def matrix(t) -> tuple[np.ndarray, np.ndarray]:
    """lib3mf transform: Fields[4][3], row vectors, the last row is the translation."""
    m = np.array([[t.Fields[r][c] for c in range(3)] for r in range(4)], dtype=float)
    return m[:3], m[3]


def flatten(model, resource, rotation, shift, out):
    """Appends the transformed triangles of an object resource (mesh or components) to `out`."""
    if resource.IsMeshObject():
        mesh = model.GetMeshObjectByID(resource.GetResourceID())
        vertices = np.array([[p.Coordinates[k] for k in range(3)] for p in mesh.GetVertices()], dtype=float)
        faces = np.array([[t.Indices[k] for k in range(3)] for t in mesh.GetTriangleIndices()], dtype=int)
        out.append(vertices[faces] @ rotation + shift)  # shape (n, 3, 3)
    elif resource.IsComponentsObject():
        components = model.GetComponentsObjectByID(resource.GetResourceID())
        for i in range(components.GetComponentCount()):
            component = components.GetComponent(i)
            r, t = matrix(component.GetTransform()) if component.HasTransform() else (np.eye(3), np.zeros(3))
            # first the component, then what is above it: p · Rc · R + (tc · R + t)
            flatten(model, component.GetObjectResource(), r @ rotation, t @ rotation + shift, out)


def reference(path: Path) -> dict:
    wrapper = lib3mf.get_wrapper()
    model = wrapper.CreateModel()
    model.QueryReader("3mf").ReadFromFile(str(path))
    factor = UNIT_MM[model.GetUnit()]
    parts = []
    items = model.GetBuildItems()
    while items.MoveNext():
        item = items.GetCurrent()
        r, t = matrix(item.GetObjectTransform()) if item.HasObjectTransform() else (np.eye(3), np.zeros(3))
        flatten(model, item.GetObjectResource(), r, t, parts)
    triangles = np.concatenate(parts) * factor
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    return {
        "triangles": len(triangles),
        "volume": float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6),
        "lo": triangles.reshape(-1, 3).min(axis=0).tolist(),
        "hi": triangles.reshape(-1, 3).max(axis=0).tolist(),
    }


def ours(path: Path) -> dict:
    run = subprocess.run(["node", str(INFO), str(path)], check=True, capture_output=True, text=True)
    return json.loads(run.stdout)


def main() -> int:
    files = [Path(a) for a in sys.argv[1:]] or sorted(FIXTURES.glob("*.3mf"))
    problems = []
    print(f"{'Datei':36} {'Dreiecke':>13} {'Volumen (mm³)':>30}  Größe x/y/z")
    for path in files:
        mine = ours(path)
        if path.name in NOT_COMPARED:
            print(f"{path.name:36} {mine['triangles']:>13} {mine['volume']:>30.3f}  nicht verglichen: {NOT_COMPARED[path.name]}")
            continue
        other = reference(path)
        size_mine = np.array(mine["hi"]) - np.array(mine["lo"])
        size_other = np.array(other["hi"]) - np.array(other["lo"])
        mirrored = path.name == "gespiegelt.3mf"
        print(f"{path.name:36} {mine['triangles']:>5}/{other['triangles']:<7} {mine['volume']:>14.3f}/{other['volume']:<15.3f} {np.round(size_mine, 3).tolist()}")
        if mine["triangles"] != other["triangles"]:
            problems.append(f"{path.name}: Dreiecke {mine['triangles']} ≠ lib3mf {other['triangles']}")
        # A mirrored object has a negative volume in lib3mf (it applies the matrix as it is); the reader turns the winding.
        reference_volume = abs(other["volume"]) if mirrored else other["volume"]
        if abs(mine["volume"] - reference_volume) > 1e-6 * max(1.0, abs(reference_volume)):
            problems.append(f"{path.name}: Volumen {mine['volume']} ≠ lib3mf {reference_volume}")
        if not np.allclose(np.array(mine["lo"]), np.array(other["lo"]), atol=1e-6) or not np.allclose(size_mine, size_other, atol=1e-6):
            problems.append(f"{path.name}: Lage/Größe {mine['lo']} {size_mine.tolist()} ≠ lib3mf {other['lo']} {size_other.tolist()}")
    print()
    if problems:
        print(f"{len(problems)} Abweichung(en):")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("Der 3MF-Leser stimmt mit lib3mf überein (Spalten: wir/lib3mf).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
