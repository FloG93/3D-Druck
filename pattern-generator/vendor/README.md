# Fremdbibliotheken

Unverändert aus npm übernommen – bis auf die Importpfade zu `robust-predicates`, die auf relative Pfade umgestellt sind, damit die Dateien ohne Build-Schritt im Browser und in Node laufen.

| Datei | Paket | Version | Lizenz |
| --- | --- | --- | --- |
| `delaunator.js` | [delaunator](https://github.com/mapbox/delaunator) | 5.1.0 | ISC (`delaunator.LICENSE.txt`) |
| `constrainautor.js` | [@kninnug/constrainautor](https://github.com/kninnug/Constrainautor) | 4.1.0 | ISC (`constrainautor.LICENSE.txt`) |
| `robust-predicates/` | [robust-predicates](https://github.com/mourner/robust-predicates) (nur `orient2d`, `incircle`) | 3.0.3 | Unlicense (`robust-predicates/LICENSE.txt`) |
| `earcut.js` | [earcut](https://github.com/mapbox/earcut) (Rückfallebene) | 3.2.3 | ISC (`earcut.LICENSE.txt`) |

Verwendet für die Triangulierung der Lochplatte (STL-Export und 3D-Vorschau). Die 3D-Vorschau lädt zusätzlich [three.js](https://threejs.org) (MIT) bei Bedarf vom CDN jsDelivr.
