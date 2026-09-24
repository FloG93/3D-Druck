# Text-Generator

Schlüsselanhänger, Namens-, Tür- und Kofferschilder mit Text für den 3D-Druck – direkt im Browser. Jede Google-Schrift und Symbole wie ♥ ⭐ 🐾, Platte als Kontur um die Schrift oder als Rechteck, Kapsel, Oval oder Kreis, mit Öse, Loch, Schlitz, Schraublöchern mit Senkung oder Magnet-Taschen, Rand und Kontur – Schrift **erhaben**, **vertieft** oder **bündig eingelegt**. Die 3MF-Datei bringt Platte, Schrift, Kontur und Rand als eigene Teile mit fester Filament-Nummer mit – in **Bambu Studio** (AMS) nur noch Farben wählen und drucken.

![Text-Generator – Schlüsselanhänger im Sticker-Look: Schrift, weiße Kontur und Platte in drei Farben](docs/screenshot.png)

**Online:** <https://flog93.github.io/3D-Druck/Text-Generator/> – Teil der [3D-Druck-Werkzeuge](../README.md).

## Funktionen

- **Text:** mehrzeilig, beliebig viele Textblöcke mit eigener Schrift, Größe (Höhe der Großbuchstaben in mm), Zeichen- und Zeilenabstand, Ausrichtung, Position und Drehung. Texte lassen sich in der Vorschau mit der Maus verschieben.
- **Symbole:** 66 flächige, gut druckbare Symbole eingebaut (Herz, Stern, Pfote, Hund, Katze, Pferd, Kleeblatt, Sonne, Schneeflocke, Fußball, Note, Krone, Haus, Anker, Auto, Traktor, WLAN …) über den Knopf *♥ Symbol* – ab 10 mm Höhe ohne zu dünne Linien. Eingefügte Emoji wie 🐕 oder ❤ nutzen dieselben Symbole; alle anderen Emoji kommen als Strichzeichnung aus Noto Emoji (lädt bei Bedarf). Symbole werden so hoch wie die Großbuchstaben gesetzt.
- **Schriften:** sechs eingebaut (Montserrat, Pacifico, Lobster, Roboto, Bebas Neue, Black Ops One – funktionieren offline), dazu **alle Google Fonts** mit Suche, Kategorien, Live-Vorschau und Auswahl der Strichstärke. **Fettung** macht dünne Schriften druckbar (Striche dicker oder dünner in mm).
- **Grundform:** Kontur (folgt der Schrift, getrennte Wörter werden automatisch verbunden), Rechteck mit Eckenradius, Kapsel, Oval, Kreis – automatisch um die Schrift oder mit festen Maßen – oder ganz ohne Platte (nur Buchstaben).
- **Befestigung:** Öse außen, Loch in der Platte oder **Schlitz** für Band, Lanyard oder Clip – links, rechts oder oben; **zwei Schraublöcher** mit 90°-**Senkung** für Senkkopfschrauben (Kopf-Ø einstellbar). Bei der Kontur werden Laschen angesetzt, die Übergänge verrundet.
- **Magnet-Taschen** auf der Rückseite zum Einkleben (Anzahl, Ø, Tiefe; Standard 6,2 × 2,2 mm für 6 × 2-mm-Magnete). Sie werden entlang der Platte verteilt und nie so tief, dass sie die Schrift erreichen.
- **Körper (3D):** Plattendicke, Schrift erhaben (Höhe) oder vertieft (Tiefe, mit Mindestboden), **bündig** als zweifarbiges Inlay mit glatter Oberfläche, Rand und **Kontur um die Schrift** (Sticker-Look in einer dritten Farbe) – erhaben oder bündig.
- **Farben & Filamente:** Farbe und AMS-Filament je Teil (Platte, Schrift, Kontur, Rand) – und mit *Eigene Farbe* für jeden Text einzeln.
- **Prüfung für den Druck:** Striche dünner als die Mindest-Strichstärke (Standard 0,8 mm) werden orange markiert; Hinweise bei fehlenden Zeichen, zerfallender Platte, Schrift über dem Rand und wenn das Teil nicht aufs Druckbett passt (A1 mini, A1/P1/X1, H2D).
- **12 Vorlagen:** Schlüsselanhänger, Anhänger Block, Namensschild (mit Clip-Schlitz), Türschild, Kofferanhänger, Bündig 2-farbig, Oval vertieft, Sticker-Look, Hundemarke, Kühlschrank-Magnet, Werkstattschild (Schrauben mit Senkung), Nur Buchstaben – dazu eigene Vorlagen, Projektdateien (JSON), Teilen-Link, Rückgängig/Wiederholen, automatisches Speichern, hell/dunkel.

![Vorlagen in der 3D-Vorschau: Hundemarke mit Pfoten in eigener Farbe, Werkstattschild mit Senkschrauben, Kühlschrank-Magnet, Türschild, Namensschild mit Clip-Schlitz, Kofferanhänger](docs/vorlagen-3d.png)

## Mehrfarbig drucken mit Bambu Studio (AMS)

Der **3MF-Export** enthält ein Objekt aus mehreren Teilen – *Platte*, *Schrift*, *Kontur*, *Rand* und *Text 2, 3 …* für Texte mit eigener Farbe – und legt in `Metadata/model_settings.config` fest, welches Filament jedes Teil bekommt (einstellbar unter **Farben & Filamente** und beim Text). Bambu Studio und OrcaSlicer lesen diese Zuordnung auch aus Dateien anderer Programme:

1. In Bambu Studio *Datei → Importieren → 3MF/STL/STEP … importieren* (Strg+I).
2. Das Objekt erscheint mittig auf der Platte, die Teile sind Filament 1, 2, … zugeordnet.
3. Den Filamenten die passenden AMS-Farben zuweisen, slicen, drucken.

Tipp: Dicken als Vielfache der Schichthöhe wählen (z. B. 2,4 mm Platte bei 0,2 mm Schichten) – dann wechselt die Farbe genau zwischen zwei Schichten. **Bündig** ergibt eine glatte Oberfläche mit farbiger Schrift.

**Druckausrichtung:** Bei flacher Oberseite (Schrift bündig oder ganz ohne Platte) bietet der Export *Schrift unten* an – das Teil wird umgedreht, die Schriftseite liegt auf dem Druckbett und bekommt dessen Oberfläche (glatt oder die Struktur einer Textured-PEI-Platte). Erhabene und vertiefte Schrift wird immer mit der Schrift nach oben gedruckt.

## Exporte

| Format | Wofür |
| --- | --- |
| **3MF** | Bambu Studio, OrcaSlicer: Teile mit Filament-Zuordnung (mehrfarbig), Schrift oben oder unten |
| **STL** | jeder Slicer, einfarbig (alle Teile in einer Datei), Schrift oben oder unten |
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
  fonts/                    eingebaute Schriften und Symbole (SIL OFL 1.1)
  tests/tools/              Export-Prüfung, Bau der Symbol-Schrift (build_symbols.py)
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
