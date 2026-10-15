# Referenz – Prototypen der Machbarkeitsstudie

Lauffähige Python-Vorlage (numpy, scipy, OpenCascade). **Nicht ausgeliefert** (liegt unter `docs/`, wird von Pages nicht veröffentlicht). Die JS-Module in `../../js/` werden Funktion für Funktion hiergegen portiert (siehe [`PLAN.md`](../PLAN.md)); die Zahlen der Referenz sind der Maßstab, nicht der Code-Stil (die Referenz ist Prototypenqualität: Skripte reden miteinander über ihre Dateinamen und sind nicht aufgeräumt).

```bash
python3 -m venv /tmp/v && /tmp/v/bin/pip install cadquery-ocp numpy scipy
cd STL-zu-STEP/docs/referenz
/tmp/v/bin/python recon.py        # Rekonstruktion: 14 Flächen, Volumen = Original (7400,1771)
```

| Datei | Inhalt | Port nach | Ergebnis (siehe MACHBARKEIT) |
|---|---|---|---|
| `probe1.py` | Hilfen: Testteil, Tessellierung, STL lesen/schreiben, Weld, Nähen → Solid, STEP-Prüfung; `python probe1.py` = Stufen 1 und 2 | `core/weld.js`, `core/meshops.js` | Abschnitt 1 |
| `probe2.py` | Testteil mit Rundungen (`part_with_fillet`); erster (verworfener) Ketten-Ansatz zur Zylindererkennung | – | Abschnitt 2, Punkt 2 |
| `probe3.py` | Zylindererkennung mit Dreiecks-Keimen (Seed und Wachsen) – **hängt von der Vernetzung ab** | – | Abschnitt 2, Punkt 1 |
| `probe4.py` | Erkennung über Flächenstücke: `prep`, `patches`, `fit`, `detect` | `core/patches.js`, `core/cylinders.js` | Abschnitt 2 |
| `probe6.py` | Gegenprüfung `verdict` (Länge, Radius-Konstanz, Kugelprobe mit Punkten **und** Normalen) | `core/cylinders.js` (verify) | Abschnitt 2, Punkt 4 |
| `probe7.py` | Fehlalarm-Test: Teil, Kugel, Kegel, Torus | `tests/cylinders.test.mjs` | Abschnitt 2 |
| `heal.py` | Heilung: weld, drop_bad, split_tjunctions, orient, fill_holes, heal | `core/heal.js` | Abschnitt 3 |
| `defects.py` | Defektsammlung gegen die Heilung (naiv vs. geheilt) | `tests/heal.test.mjs` | Abschnitt 3 |
| `check2.py` | Mehrkörper-/Nichtmanifold-Prüfung, `subdivide`, `polyhole` | `tests/tools/make_fixtures.py` (dort schon übernommen) | Abschnitt 2/3 |
| `recon.py` | Rekonstruktion: `build_regions`, `boundary`, `chains`, `classify`, `edge_for`, `snap_corners`, `merge_cylinders`, `plane_face`, `cylinder_faces`, `reconstruct` | `core/topology.js`, `core/brep.js`, `core/constraints.js`, `export/step.js` | Abschnitt 4 |
| `recon_hard.py` | Rekonstruktion an unterteilten und groben Netzen (zeigt die offene Aufgabe Zwangsbedingungen) | `tests/brep.test.mjs` | Abschnitt 4 |

Unterschiede zwischen Referenz und Ziel:

- Die Referenz baut mit OpenCascade-Objekten und verlässt sich auf `BRepBuilderAPI_Sewing` als Prüfer; das JS-Modul schreibt STEP-Entities mit gemeinsamen `VERTEX_POINT`s und prüft die Topologie selbst (`verify.js`).
- Die Zylinderflächen baut die Referenz aus Parameterbereichen (Winkel, Höhe); in JS sind es `ADVANCED_FACE`s mit Kantenschleifen aus Bögen und Mantellinien.
- Der Nichtmanifold-Schritt der Heilung fehlt in der Referenz (siehe PLAN 3c).
