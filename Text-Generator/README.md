# Text-Generator

Schlüsselanhänger, Namens-, Tür- und Kofferschilder mit Text für den 3D-Druck – direkt im Browser. Jede Google-Schrift, Platte als Kontur um die Schrift oder als Rechteck, Kapsel, Oval oder Kreis, mit Öse oder Loch, erhabenem Rand und Schrift **erhaben**, **vertieft** oder **bündig eingelegt**. Die 3MF-Datei bringt Platte, Schrift und Rand als eigene Teile mit fester Filament-Nummer mit – in **Bambu Studio** (AMS) nur noch Farben wählen und drucken.

![Text-Generator – Schlüsselanhänger in 2D und 3D](docs/screenshot.png)

**Online:** <https://flog93.github.io/3D-Druck/Text-Generator/> – Teil der [3D-Druck-Werkzeuge](../README.md).

## Funktionen

- **Text:** mehrzeilig, beliebig viele Textblöcke mit eigener Schrift, Größe (Höhe der Großbuchstaben in mm), Zeichen- und Zeilenabstand, Ausrichtung, Position und Drehung. Texte lassen sich in der Vorschau mit der Maus verschieben.
- **Schriften:** sechs eingebaut (Montserrat, Pacifico, Lobster, Roboto, Bebas Neue, Black Ops One – funktionieren offline), dazu **alle Google Fonts** mit Suche, Kategorien, Live-Vorschau und Auswahl der Strichstärke. **Fettung** macht dünne Schriften druckbar (Striche dicker oder dünner in mm).
- **Grundform:** Kontur (folgt der Schrift, getrennte Wörter werden automatisch verbunden), Rechteck mit Eckenradius, Kapsel, Oval, Kreis – automatisch um die Schrift oder mit festen Maßen – oder ganz ohne Platte (nur Buchstaben).
- **Befestigung:** Öse außen oder Loch in der Platte, links, rechts oder oben, mit Loch-Ø und Ringbreite; der Übergang zur Platte wird verrundet.
- **Körper (3D):** Plattendicke, Schrift erhaben (Höhe) oder vertieft (Tiefe, mit Mindestboden), **bündig** als zweifarbiges Inlay mit glatter Oberfläche, erhabener Rand.
- **Farben & Filamente:** Farbe und AMS-Filament je Teil (Platte, Schrift, Rand).
- **Prüfung für den Druck:** Striche dünner als die Mindest-Strichstärke (Standard 0,8 mm) werden orange markiert; Hinweise bei fehlenden Zeichen, zerfallender Platte oder Schrift über dem Rand.
- **8 Vorlagen:** Schlüsselanhänger, Anhänger Block, Namensschild, Türschild, Kofferanhänger, Bündig 2-farbig, Oval vertieft, Nur Buchstaben – dazu eigene Vorlagen, Projektdateien (JSON), Teilen-Link, Rückgängig/Wiederholen, automatisches Speichern, hell/dunkel.

![Vorlagen in der 3D-Vorschau: Türschild, Kofferanhänger, bündig zweifarbig, oval vertieft](docs/vorlagen-3d.png)

## Mehrfarbig drucken mit Bambu Studio (AMS)

Der **3MF-Export** enthält ein Objekt aus mehreren Teilen – *Platte*, *Schrift*, *Rand* – und legt in `Metadata/model_settings.config` fest, welches Filament jedes Teil bekommt (einstellbar unter **Farben & Filamente**). Bambu Studio und OrcaSlicer lesen diese Zuordnung auch aus Dateien anderer Programme:

1. In Bambu Studio *Datei → Importieren → 3MF/STL/STEP … importieren* (Strg+I).
2. Das Objekt erscheint mittig auf der Platte, die Teile sind Filament 1, 2, … zugeordnet.
3. Den Filamenten die passenden AMS-Farben zuweisen, slicen, drucken.

Tipp: Dicken als Vielfache der Schichthöhe wählen (z. B. 2,4 mm Platte bei 0,2 mm Schichten) – dann wechselt die Farbe genau zwischen zwei Schichten. **Bündig** ergibt eine glatte Oberfläche mit farbiger Schrift.

## Exporte

| Format | Wofür |
| --- | --- |
| **3MF** | Bambu Studio, OrcaSlicer: Teile mit Filament-Zuordnung (mehrfarbig) |
| **STL** | jeder Slicer, einfarbig (alle Teile in einer Datei) |
| **SVG** | Draufsicht 1:1 in mm – farbig oder als Umrisse (Laser, Plotter, Fusion 360) |
| **PNG** | Bild der Draufsicht |

Jede Datei wird automatisch geprüft: Alle Teile sind geschlossene Körper (jede Kante genau zweimal, richtig orientiert), das Volumen stimmt mit der Rechnung überein, und die 3MF liest die Referenzbibliothek [lib3mf](https://github.com/3MFConsortium/lib3mf) des 3MF-Konsortiums im strikten Modus ohne Warnung.

## In Arbeit

Als Nächstes kommen **Schablonen** mit automatischen Stegen, **Text auf Bögen, Kreisen und Zylindern** (Münzen, Becher, Stifthalter), **Stempel** (gespiegelt) und der Weg nach **Fusion 360** (saubere Skizze als DXF und eigenes Skript *TextImport*).

## Lokal starten

Im Hauptordner des Repositorys `python3 -m http.server 8080` (oder `npm start`), dann <http://localhost:8080/Text-Generator/> öffnen.

## Entwicklung

```
Text-Generator/
  index.html, css/, favicon.svg   Web-App (→ flog93.github.io/3D-Druck/Text-Generator/)
  js/core/                  Schriften (opentype.js), Textsatz, Geometrie (Clipper), Modell, Vorlagen
  js/export/                Netze (geschlossene Körper), Triangulierung, 3MF, ZIP, STL, SVG
  js/ui/                    Oberfläche, 2D-Ansicht, 3D-Vorschau, Schriftauswahl, Dialoge
                            (Design und Bedienelemente aus ../shared/)
  fonts/                    eingebaute Schriften (SIL OFL 1.1)
  vendor/                   opentype.js, Clipper
  tests/                    Tests (Node) und Export-Prüfung (Python + lib3mf)
  docs/                     Bilder für diese Anleitung
```

Im Hauptordner des Repositorys:

```bash
npm run test:text       # JavaScript-Tests
npm run validate:text   # 3MF/STL mit lib3mf prüfen (pip install lib3mf)
```

Fremdbibliotheken und Lizenzen: [`vendor/README.md`](vendor/README.md), Schriften: [`fonts/README.md`](fonts/README.md).
