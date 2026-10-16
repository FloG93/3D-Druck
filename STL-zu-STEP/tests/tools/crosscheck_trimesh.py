#!/usr/bin/env python3
"""Cross-check of the mesh diagnosis and repair against trimesh and pymeshfix.

The repair of STL-zu-STEP runs in JavaScript (js/core/diagnose.js, repair.js).
This tool is an independent opinion: for every fixture it diagnoses the raw
mesh with trimesh, compares the counts with ours, and repairs the mesh with
trimesh + pymeshfix to compare the volume. trimesh and pymeshfix are NOT
dependencies of the tool (CLAUDE.md: Python only here, installed outside):

    pip install trimesh pymeshfix numpy
    python3 STL-zu-STEP/tests/tools/crosscheck_trimesh.py [fixture ...]

Exit code 1 if a count that both sides define the same way differs.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

try:
    import pymeshfix
    import trimesh
except ImportError as error:  # pragma: no cover
    print(f"trimesh/pymeshfix fehlen ({error}): pip install trimesh pymeshfix numpy")
    sys.exit(0)

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "STL-zu-STEP" / "tests" / "fixtures"
CLI = ROOT / "STL-zu-STEP" / "tests" / "tools" / "repair-report.mjs"


def ours(path: Path) -> dict:
    """The JSON report of repair-report.mjs for one file."""
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "report.json"
        subprocess.run(["node", str(CLI), str(path), "--json", str(target)], check=True, capture_output=True)
        return json.loads(target.read_text())


def theirs(path: Path) -> dict:
    """What trimesh counts on the raw mesh (vertices merged, nothing removed)."""
    mesh = trimesh.load(path, process=False)
    mesh.merge_vertices()
    edges = np.sort(mesh.edges, axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return {
        "triangles": len(mesh.faces),
        "boundaryEdges": int((counts == 1).sum()),
        "nonManifoldEdges": int((counts > 2).sum()),
        # Face adjacency over edges (like ours); split() would also try fill_holes, which needs networkx.
        "shells": len(trimesh.graph.connected_components(mesh.face_adjacency, nodes=np.arange(len(mesh.faces)))),
        "volume": float(mesh.volume),
        "windingConsistent": bool(mesh.is_winding_consistent),
        "mesh": mesh,
    }


def pymeshfix_volume(mesh) -> tuple[float, bool]:
    fixer = pymeshfix.MeshFix(np.asarray(mesh.vertices, dtype=float), np.asarray(mesh.faces, dtype=np.int32))
    fixer.repair()
    fixed = trimesh.Trimesh(np.asarray(fixer.points), np.asarray(fixer.faces), process=False)
    return float(abs(fixed.volume)), bool(fixed.is_watertight)


def main() -> int:
    names = sys.argv[1:] or sorted(p.name for p in FIXTURES.iterdir() if p.suffix in {".stl", ".obj"})
    problems = []
    print(f"{'Datei':32} {'Rand':>9} {'n-m.Kanten':>11} {'Schalen':>8} {'Volumen vorher':>18}  Volumen nachher (wir | pymeshfix)")
    for name in names:
        path = FIXTURES / name
        mine = ours(path)
        other = theirs(path)
        before = mine["before"]
        row = (
            f"{name:32} {before['boundaryEdges']:>4}/{other['boundaryEdges']:<4} "
            f"{before['nonManifoldEdges']:>5}/{other['nonManifoldEdges']:<5} "
            f"{before['shells']:>3}/{other['shells']:<4}"
        )
        # The counts both sides define the same way. Degenerate and doubled
        # triangles are left in by trimesh here, so only the shells of meshes
        # without them are compared (a sliver can connect or split a shell).
        if name != "defekt-verrutscht.stl" and before["boundaryEdges"] != other["boundaryEdges"]:
            problems.append(f"{name}: Randkanten {before['boundaryEdges']} ≠ trimesh {other['boundaryEdges']}")
        if before["nonManifoldEdges"] != other["nonManifoldEdges"]:
            problems.append(f"{name}: nicht-manifold Kanten {before['nonManifoldEdges']} ≠ trimesh {other['nonManifoldEdges']}")
        # Two definitions differ, so those cases are not compared: trimesh merges
        # vertices only when they are equal (the fixture "verrutscht" is made for
        # the welding tolerance of ours), and it leaves a non-manifold edge out of
        # its face adjacency (a third triangle there becomes a shell of its own).
        welded_alike = name != "defekt-verrutscht.stl"
        if welded_alike and before["nonManifoldEdges"] == 0 and before["degenerate"] == 0 and before["shells"] != other["shells"]:
            problems.append(f"{name}: Schalen {before['shells']} ≠ trimesh {other['shells']}")
        if welded_alike and before["watertight"] and abs(before["volume"] - other["volume"]) > 1e-6 * max(1.0, abs(other["volume"])):
            problems.append(f"{name}: Volumen {before['volume']} ≠ trimesh {other['volume']}")
        if before["windingConflicts"] == 0 and before["boundaryEdges"] == 0 and before["nonManifoldEdges"] == 0 and not other["windingConsistent"] and not before["inverted"]:
            problems.append(f"{name}: trimesh findet Orientierungsfehler, wir nicht")

        after = mine["after"]
        try:
            volume, closed = pymeshfix_volume(other["mesh"])
            fix = f"{abs(after['volume']):12.3f} | {volume:12.3f}{'' if closed else ' (offen)'}"
            # Where nothing was cut away or added by guesswork, both repairs must agree on the volume –
            # for a single shell: pymeshfix keeps only the largest shell by default (remove_smallest_components)
            # and so loses a second body silently, which ours must not (docs/MACHBARKEIT.md section 3).
            if before["shells"] > 1:
                fix += "  (pymeshfix behält nur die größte Schale)"
            elif after["watertight"] and closed and mine["validation"]["maxDeviation"] < 1e-9 and abs(abs(after["volume"]) - volume) > 5e-3 * volume:
                problems.append(f"{name}: Volumen nach der Reparatur {after['volume']:.3f} ≠ pymeshfix {volume:.3f}")
        except Exception as error:  # pymeshfix raises on empty results
            fix = f"{abs(after['volume']):12.3f} | pymeshfix: {error}"
        print(f"{row} {before['volume']:>18.3f}  {fix}")
    print()
    if problems:
        print(f"{len(problems)} Abweichung(en):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("Diagnose und Reparatur stimmen mit trimesh/pymeshfix überein (Spalten: wir/trimesh).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
