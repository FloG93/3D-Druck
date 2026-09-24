# Gemeinsame Fremdbibliotheken

Unverändert aus npm übernommen – bis auf die Importpfade zu `robust-predicates`, die auf relative Pfade umgestellt sind, damit die Dateien ohne Build-Schritt im Browser und in Node laufen.

| Datei | Paket | Version | Lizenz | Benutzt von |
| --- | --- | --- | --- | --- |
| `delaunator.js` | [delaunator](https://github.com/mapbox/delaunator) | 5.1.0 | ISC (`delaunator.LICENSE.txt`) | Muster-Generator, Text-Generator |
| `constrainautor.js` | [@kninnug/constrainautor](https://github.com/kninnug/Constrainautor) | 4.1.0 | ISC (`constrainautor.LICENSE.txt`) | Muster-Generator, Text-Generator |
| `robust-predicates/` | [robust-predicates](https://github.com/mourner/robust-predicates) (nur `orient2d`, `incircle`) | 3.0.3 | Unlicense (`robust-predicates/LICENSE.txt`) | (von den beiden oberen) |
| `earcut.js` | [earcut](https://github.com/mapbox/earcut) | 3.2.3 | ISC (`earcut.LICENSE.txt`) | Muster-Generator (Rückfallebene) |

Sie zerlegen Flächen mit Löchern in Dreiecke – für STL/3MF-Export und 3D-Vorschau.
