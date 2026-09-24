# shared – gemeinsamer Code der Werkzeuge

Was hier liegt, benutzen mehrere Werkzeuge; es wird unverändert unter `/3D-Druck/shared/` veröffentlicht.

| Datei | Inhalt |
| --- | --- |
| `css/ui.css` | Farben (hell/dunkel), Layout mit Kopfleiste, Seitenleisten und Arbeitsfläche, Bedienelemente, Dialoge |
| `js/controls.js` | Bedienelemente (Zahlenfelder mit Schieber, Umschalter, Auswahl, Abschnitte …), an ein Dokument gebunden |
| `js/icons.js` | Symbole (SVG) |
| `js/history.js` | Rückgängig/Wiederholen |
| `js/util.js` | Browser-Speicher, Dateinamen, Download |

Werkzeuge binden die Dateien mit relativen Pfaden ein (`../shared/css/ui.css`, `../../shared/js/controls.js` …). So funktioniert es lokal (Webserver im Hauptordner) genauso wie auf GitHub Pages. Was nur ein Werkzeug braucht, bleibt in dessen Ordner.
