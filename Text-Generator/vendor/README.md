# Fremdbibliotheken

| Datei | Paket | Version | Lizenz |
| --- | --- | --- | --- |
| `opentype.mjs` | [opentype.js](https://github.com/opentypejs/opentype.js) (`dist/opentype.min.mjs`) | 2.0.0 | MIT (`opentype.LICENSE.txt`) |
| `clipper.mjs` | [clipper-lib](https://github.com/junmer/clipper-lib) – Clipper von Angus Johnson, JavaScript-Übersetzung von Timo | 6.4.2 | Boost Software License 1.0, enthält JSBN (Tom Wu) – `clipper.LICENSE.txt` |

`opentype.js` liest die Schriftdateien (Umrisse, Abstände, Kerning), `clipper.mjs` vereinigt, verschneidet und versetzt die Umrisse (Platte, Kontur, Rand, Prüfung auf dünne Stellen).

`clipper.mjs` ist bis auf den Modul-Rahmen unverändert: Die umschließende Funktion und die globale Zuweisung (`module.exports` / `window.ClipperLib`) sind durch `export default ClipperLib` ersetzt, damit die Datei ohne Build-Schritt als ES-Modul im Browser und in Node läuft.

Die Triangulierung (Delaunator, Constrainautor) liegt gemeinsam mit dem Muster-Generator in [`../../shared/vendor/`](../../shared/vendor/README.md). Die 3D-Vorschau lädt [three.js](https://threejs.org) (MIT) bei Bedarf vom CDN jsDelivr, weitere Google-Schriften kommen über [Fontsource](https://fontsource.org) (ebenfalls jsDelivr).
