# MusterImport – Fusion-360-Skript

Das Skript holt ein Lochmuster aus dem [Muster-Generator](../README.md) direkt in Fusion 360: Es zeichnet alle Löcher als saubere, verbundene Skizze (Linien, Bögen, Kreise, Ellipsen) **zentriert auf der gewählten Fläche** und schneidet sie auf Wunsch gleich aus – alles in einem Schritt, der sich mit <kbd>Strg</kbd>+<kbd>Z</kbd> komplett zurücknehmen lässt.

## Installation (einmalig)

1. `MusterImport.zip` herunterladen – im Muster-Generator unter **Exportieren → Fusion-Skript** verlinkt – oder den Ordner [`MusterImport`](MusterImport) aus diesem Repository kopieren.
2. Entpacken. Es entsteht ein Ordner `MusterImport` mit `MusterImport.py` und `MusterImport.manifest`.
3. In Fusion 360 <kbd>Umschalt</kbd>+<kbd>S</kbd> drücken (bzw. **Dienstprogramme → Zusatzmodule → Skripte und Zusatzmodule**).
4. Auf **+** klicken („Skript oder Zusatzmodul vom Gerät“ bzw. bei älteren Versionen das grüne **+** neben „Meine Skripte“) und den Ordner `MusterImport` auswählen.

## Verwendung

1. Im Muster-Generator **Exportieren → Fusion-Skript** wählen und die Datei `*.fusion.json` speichern.
2. In Fusion 360 das Design öffnen, <kbd>Umschalt</kbd>+<kbd>S</kbd> → **MusterImport** → **Ausführen**.
3. Die JSON-Datei auswählen. Es öffnet sich der Dialog **Muster importieren**:

| Eingabe | Bedeutung |
| --- | --- |
| **Fläche/Ebene** | Ebene Fläche (z. B. Oberseite eines Deckels) oder Konstruktionsebene |
| **Position** | *Mitte der Fläche*: Mustermitte = Mitte des umgebenden Rechtecks der Fläche. *Skizzenursprung*: Mustermitte = Ursprung der Skizze |
| **Drehung**, **Versatz X/Y** | Muster drehen bzw. verschieben |
| **Vorgang** | *Löcher ausschneiden* (Extrusion „Ausschneiden“ in den Körper der Fläche), *Werkzeugkörper erzeugen* (neue Körper, z. B. für Kombinieren), *Nur Skizze* |
| **Tiefe** / **Durch alles** | Schnitttiefe; „Durch alles“ schneidet durch den ganzen Körper |
| **Richtung umkehren** | Falls der Schnitt in die falsche Richtung zeigt (v. a. bei Konstruktionsebenen) |
| **Begrenzung als Hilfslinie** | Zeichnet die Außenkontur aus dem Generator als Konstruktionslinie mit |

4. **OK** – die Skizze „Muster … (N Löcher)“ und die Extrusion „Muster Ausschnitt“ erscheinen in der Zeitleiste.

## Tipps

- Gib im Muster-Generator als **Arbeitsfläche** die Maße der Fusion-Fläche ein (z. B. 150 × 100 mm). Das Skript meldet die gemessene Flächengröße und schlägt eine Drehung um 90° vor, wenn Breite und Höhe vertauscht wirken.
- Für Deckel mit Rand: Im Generator **Begrenzung** (Rechteck mit Eckenradius) und **Randabstand** so wählen, dass die Löcher nicht in den Rand laufen.
- Große Muster mit mehreren tausend Löchern brauchen einige Sekunden; der Fortschritt wird angezeigt und kann abgebrochen werden.
- Das Muster ist nach dem Import eine normale Skizze – für ein neues Muster einfach erneut importieren und die alte Skizze/Extrusion löschen.

## Technisches

- Die JSON-Datei (`format: "muster-generator/fusion"`) enthält alle Löcher in Millimetern relativ zur Mustermitte. Pfade beginnen mit einem Bogen und enden mit einer Linie, damit jede Kontur über gemeinsame Skizzenpunkte geschlossen werden kann.
- Die Fusion-API rechnet intern in Zentimetern; das Skript rechnet um.
- Ausgeschnitten werden nur Profile mit genau einer Kontur in Lochgröße, also nie die Fläche drumherum.
- Die Logik des Skripts wird automatisch mit einer nachgebauten Fusion-API getestet (`tests/test_fusion_script.py`). Die echte API ist dort nicht verfügbar – falls in deiner Fusion-Version etwas hakt, bitte ein Issue mit der Fehlermeldung anlegen.
- Das Skript merkt sich den zuletzt verwendeten Ordner und die Optionen in `settings.json` neben dem Skript.
