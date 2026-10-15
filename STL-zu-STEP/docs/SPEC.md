# STL-zu-STEP – Spezifikation

Arbeitstitel „Mesh2Solid". Dritte Web-App im Repo `3D-Druck`, neben Muster-Generator und Text-Generator. Grundlage: [`MACHBARKEIT.md`](MACHBARKEIT.md) (Messwerte), Umsetzung: [`PLAN.md`](PLAN.md).

## 1. Zweck

Maker laden Modelle von Thingiverse/Printables als STL (Dreiecksnetz) herunter und wollen sie in Fusion 360 / FreeCAD **bearbeiten** – Bohrungen verschieben, Radien ändern. Ein Netz erlaubt das nicht. Die App wandelt ein Netz im Browser in einen **STEP-Volumenkörper** um und erkennt dabei Ebenen und Zylinder, damit Bohrungen und Rundungen wieder echte Rundungen sind.

**Erfolgskriterium:** Eine heruntergeladene Halterung mit Bohrungen und Rundungen lässt sich in Fusion 360 öffnen, und eine Bohrung lässt sich per „Bohrung bearbeiten" verschieben, ohne dass der Körper aufbricht.

**Nicht-Ziele (Phase 1):** Kegel, Kugel, Torus; schräge Kappen (Ellipsen); Freiformflächen (bleiben facettiert); Slicer-Übergabe; Mehrfarbe; 3MF/PLY-Eingabe; Netz-Reparatur bis zur Perfektion (Notanker via Winding Number ist Phase 2).

## 2. Entscheidungen

| Entscheidung | Begründung |
|---|---|
| Alles in reinem JavaScript im Browser, ohne Backend, ohne OpenCascade-WASM | Repo-Regel „kein Build-Schritt"; offline; Daten verlassen den Rechner nicht; WASM wäre 20–60 MB. OpenCascade nur als **Prüfer in CI**. |
| Ordner `STL-zu-STEP/` | Folgt `MusterGenerator/`, `Text-Generator/`; Pages veröffentlicht jeden Ordner mit `index.html` automatisch. `index.html` wird **erst im UI-Schritt** angelegt, sonst geht eine leere Seite online. |
| STEP-Schreiber aus `shared/js/step.js` (`StepWriter`, `real`, `str`) | Schon vorhanden und von OpenCascade geprüft. Konventionen (AP214, Kanten genau zweimal, volle Kreise in Hälften) aus `MusterGenerator/js/export/step.js` übernehmen. |
| Stufen mit automatischem Rückfall | Messung: Bau schlägt bei verzerrten Netzen fehl; Selbstprüfung erkennt es; niedrigere Stufe liefert trotzdem ein gültiges Ergebnis. |
| Erkennung über Flächenstücke (Patches), nicht Einzeldreiecke | Messung: Dreiecks-Keime hängen von der Vernetzung ab (0 Treffer bei unterteilten Netzen). |
| Kein stilles Reparieren | Jede Reparatur und jede Erkennung steht mit Zahl im Bericht. Messung: OpenCascade-Nähen verdeckt Fehler (verlorene Körper). |
| Mensch bestätigt Unsicheres | 8-Eck vs. Zylinder ist aus Daten nicht entscheidbar. |

## 3. Ablauf und Stufen

```
Datei → parse → weld → heal → components ─┬─ je Komponente:
                                          │   patches → cylinders(detect, verify, merge)
                                          │   → constraints → topology → brep
                                          │   → verify ── ok → Stufe 3
                                          │            └─ nein → ohne Zylinder: Stufe 2 → verify
                                          │                                  └─ nein → Stufe 1 → verify
                                          │                                              └─ nein → offene Schale + Warnung
                                          └─ step.js schreibt alle Komponenten in EINE Datei (je ein Solid)
```

| Stufe | Inhalt | Wann |
|---|---|---|
| **3** | Ebenen (verschmolzen) + Zylinder (Kreisbögen als Kanten) | Normalfall, wenn `verify` besteht |
| **2** | Nur verschmolzene Ebenen (Polygonflächen, ggf. mit Löchern); Zylinder bleiben Facetten | Rückfall, oder wenn der Nutzer Zylinder abschaltet |
| **1** | Jedes Dreieck eine Ebene; geschlossen, gültig, aber schwer | Rückfall von 2; Garantie, solange das Netz nach Heilung geschlossen ist |
| **offen** | Offene Schale (`OPEN_SHELL`) | nur wenn Heilung nicht schließt (z. B. Loch mit > 64 Kanten); **immer mit deutlicher Warnung**, nie stumm |

**Rückfall je Region:** Besteht ein einzelner Zylinderkandidat die Gegenprüfung nicht, bleiben seine Flächenstücke Ebenen (Stufe 2 für diese Region). Nur wenn die Gesamtprüfung fehlschlägt, fällt das ganze Teil eine Stufe.

Der Bericht nennt je Komponente die erreichte Stufe und den Grund jedes Rückfalls.

## 4. Module (`STL-zu-STEP/js/`)

Reines ES-Modul, keine Abhängigkeiten außer `shared/` und den dort liegenden Bibliotheken (`delaunator`, `earcut` – nur falls Triangulierung nötig; STEP braucht keine). Typisierte Arrays statt Objekte pro Dreieck. Kommentare auf Englisch, Dokumentation auf Deutsch (wie im Repo).

```
core/
  parse.js        parseMesh(buffer, fileName) → { tris: Float64Array(9·n), warnings: string[], unit: 'mm' }
  weld.js         weldMesh(tris, tol?) → { V: Float64Array(3·m), F: Uint32Array(3·n) }
  meshops.js      edgeMap(F), signedVolume(V,F), components(F), bbox, adjacency
  heal.js         healMesh({V,F}, opts?) → { V, F, report }
  patches.js      growPatches({V,F}, opts?) → { labels: Int32Array(n), patches: Int32Array[], planes }
  cylinders.js    detectCylinders(mesh, patches, opts?) → { cylinders: Cylinder[], rejected: Rejection[] }
  constraints.js  applyConstraints(regions, models, opts?) → models'   (Eckpunkte snappen, Tangenten, Koaxialität, Rechtwinkligkeit)
  topology.js     buildTopology(mesh, regions, models) → Topology      (Ecken, Ketten, Schleifen)
  brep.js         buildBrep(topology, models) → Brep                   (Vertices, Edges, Faces, unabhängig von STEP)
  verify.js       verifyBrep(brep, mesh, opts?) → { ok, checks[] }
  pipeline.js     convert(buffer, fileName, opts, onProgress) → Result
export/
  step.js         writeStep(result) → string                           (nutzt shared/js/step.js)
worker.js         Modul-Worker: { type:'convert' } → Fortschritt, Ergebnis
ui/               app.js, report.js, preview.js, export-dialog.js
```

### Datenverträge

```js
// weld.js / heal.js
Mesh      = { V: Float64Array, F: Uint32Array }            // F: 3 Indizes je Dreieck, nach außen im Gegenuhrzeigersinn
HealReport = { weldTol, points, degenerate, duplicate, tJunctionsSplit, nonManifoldRemoved,
               flipped, holesFilled, holesOpen: [{ edges, center }], components, orientedGlobally: bool }

// cylinders.js
Cylinder  = { patchIds: number[], axis: [x,y,z], center: [x,y,z], radius, zRange: [z0,z1],
              arc: degrees, segments: number,               // Facetten je Vollkreis (aus mittlerem Facettenwinkel)
              confidence: 'sicher' | 'unsicher',            // ≥ 12 / 8–11 Segmente; < 8 wird nie angenommen
              residual: number,                              // größter Punktabstand zur Fläche
              uncertainty: number }                          // geschätzte Sehnenhöhe r·(1 − cos(π/segments))
Rejection = { patchIds: number[], reasons: ('zu kurz'|'Radius nicht konstant'|'Kugel passt besser'|'Segmente < 8')[] }

// pipeline.js
Result    = { components: [{ tier: 1|2|3|'offen', brep, healReport, features, fallbackReasons: string[],
                             meshVolume, brepVolume, maxDeviation }],
              warnings: string[] }
```

## 5. Algorithmen mit Parametern

Alle Zahlen stammen aus den Messungen in `MACHBARKEIT.md`; als Konstanten in einem Block am Dateianfang, mit Verweis auf die Messung. **Referenzimplementierung:** [`referenz/`](referenz/README.md) – Funktion für Funktion portieren, Ergebnisse gegen die Referenz prüfen.

### 5.1 parse.js
- STL binär vs. ASCII: **nicht** am Wort `solid` entscheiden (manche Binärdateien beginnen so). Binär, wenn `84 + 50·n == Dateilänge` mit `n` aus Bytes 80–83; sonst ASCII.
- OBJ: `v`, `f` (auch `a/b/c`, `a//c`, negative Indizes), Vielecke per Fächer in Dreiecke. Vierecke ergeben 2 Dreiecke.
- Warnungen: Bounding-Box-Diagonale < 1 oder > 5000 (Einheit prüfen: Zoll? Meter?), NaN/Inf-Werte (Dreieck verwerfen, zählen), leere Datei.
- float32 → Float64.
- *Nachtrag 15.10.2026:* Die drei Würfel-Dateien liefern **nicht** dieselben Dreiecke: die Vierecke im OBJ werden entlang der anderen Diagonale geteilt als bei der Tessellierung der STL-Dateien. Gleich sind Punktmenge (8 Ecken), Dreieckszahl und Volumen – das prüft `tests/parse.test.mjs`.

### 5.2 weld.js
Räumliches Hash-Gitter, Zellgröße = `tol`; `tol = 1e-5 · bboxDiagonale` (Standard). Messung: Punkte, die je Dreieck um 2e-5 verrutscht sind, werden damit wieder eins (264 Punkte wie bei der sauberen Datei). Union-Find über Nachbarzellen; Repräsentant = erster Punkt.

### 5.3 heal.js (Reihenfolge ist Pflicht)
1. Entartete Dreiecke (zwei gleiche Indizes oder Fläche < `(1e-6·diag)²`) und **doppelte** Dreiecke (gleiche sortierte Indizes) entfernen – zählen.
2. **T-Kreuzungen:** Punkt liegt im Inneren einer Dreieckskante (Abstand < 5·tol, Parameter in (1e-6, 1−1e-6)) → Dreieck dort teilen. Nur Punkte in der Nähe prüfen (Hash-Gitter).
3. **Nichtmanifold:** Kante mit > 2 Dreiecken → Dreiecke behalten, die zur größten zusammenhängenden manifolden Komponente gehören und die Kante schließen; überzählige (kleinste Fläche, bzw. die, die keine Schale schließen) entfernen – zählen. *(Neu, im Prototyp nicht gelöst; Test: `defekt-nichtmanifold.stl`.)*
4. **Umlaufrichtung** je Komponente per Breitensuche über Kanten vereinheitlichen – zählen. Gleichgerichtete Nachbarkante = Widerspruch → Dreieck umdrehen.
5. **Löcher füllen:** Randschleifen finden; Schleifen mit ≤ 64 Kanten per Ohrenschnitt in der Ausgleichsebene füllen; größere bleiben offen → `holesOpen`, Stufe `offen`.
6. **Gesamtrichtung** je Komponente: Vorzeichen des Volumens (`Σ p0·(p1×p2)/6`); negativ → alle Dreiecke drehen.
7. **Komponenten** trennen (Union-Find über Kanten). **Jede Komponente wird ein eigenes Solid**; Innenschalen (Hohlräume, negativ orientiert zur äußeren) bleiben als Hohlraum erhalten (zweite Schale des Solids), nicht als eigener Körper – Phase 2, Phase 1: als Warnung melden.
8. Bericht füllen. **Volumenprüfung:** Summe der Komponentenvolumen = Summe der Netzvolumen (Messung: zwei Körper ⇒ doppeltes Volumen; wer nur eine Schale nimmt, verliert die andere).

### 5.4 patches.js
Region Growing über Dreiecksnachbarschaft, Seeds nach Fläche absteigend. Dreieck `u` gehört zum Stück von Seed `s`, wenn `N[u]·N[s] > cos(2°)` und alle drei Punkte weniger als `1e-3·diag` von der Seed-Ebene entfernt sind. Für verrauschte Netze: `5°` und `2e-2·diag` – Schwellen als Optionen, im Bericht ausgewiesen.

*Nachtrag 15.10.2026:* Die **automatische** Rauschschätzung (Streuung der Punkte um die Stückebene > `1e-4·diag`) ist gestrichen. Gemessen: Die Streuung eines zu Recht gekrümmten Stücks ist genauso groß, die Schätzung schlug also bei jedem gekrümmten Netz an und lockerte die Schwellen – `kegel.stl` ergab damit **49 statt 116** Stücke, weil die Bänder des Kegels verschmolzen. Ein krümmungsunabhängiger Ersatz (Anteil der Dreiecke mit konvexer *und* konkaver Nachbarkante) trennt zu knapp (sauber bis 0,48, verrauscht ab 0,67) und wäre ohne eigene Messung geraten. Die grobe Toleranz ist deshalb eine Einstellung der Oberfläche; welche Schwellen gegolten haben, steht im Bericht. Automatische Erkennung: Phase 2.

Gemessene Stückzahlen (JS, geheiltes Netz; identisch zur Referenz `probe4.py`): `platte` 134, `platte-unterteilt1/2` 134, `kegel` 116, `torus` 1702, `loch-sechseck` 12, `-achteck` 14, `-zwoelfeck` 18, `-sechzehneck` 22, `-zweiunddreissigeck` 38, `wuerfel` 6. `kugel` 1371 statt 1374: numpy gibt den beiden zusammengefallenen Poldreiecken eine NaN-Normale (je ein eigenes Stück), die Heilung entfernt sie.

### 5.5 cylinders.js

**Detect** (Referenz: `referenz/probe4.py::detect`):
1. Glatte Stückgraphen: Stücke sind benachbart, wenn der Knick zwischen angrenzenden Dreiecken < 50° ist.
2. Seeds: Stücke nach Fläche aufsteigend. Keim = Seed + glatte Nachbarn (kleinste zuerst), bis `≥ 3` Stücke **und** `λ₂/λ₃ ≥ 0.05` (Eigenwerte der flächengewichteten Normalen-Kovarianz); Obergrenze 40 Stücke. Ohne Winkelspanne kein Keim.
3. Achse = Eigenvektor des kleinsten Eigenwerts; Kreisanpassung (kleinste Quadrate) der **Punkte** in der Ebene ⟂ Achse.
4. **Mitglied** ist ein Dreieck, wenn alle Punkte `| d − r | ≤ 0.01·r + 1e-3` haben, `|N·Achse| < 0.1` und die Normale radial steht (`|cos| > 0.9`); beim Wachsen zusätzlich Knick zum Vorgänger < 50°.
5. Wachsen über Stückgraphen; am Ende Neuanpassung. Mindestens 3 Stücke.

**Verify** (Gegenhypothesen, Referenz: `referenz/probe6.py::verdict`) – Kandidat fällt durch bei:
- Länge entlang der Achse `< 0.3·r` → „zu kurz" (Kugel-/Torusbänder);
- Radius nicht konstant: `|Steigung des Abstands entlang der Achse| · Länge > 0.01·r` → Kegel;
- Kugel passt besser: Kugelanpassung mit **Punkten und Normalen**: `Punktrest < 0.01·r` und `min |cos(N, radial)| > 0.97` und Rest kleiner als Zylinderrest. **Nie nur mit Punkten** (Zylinder mit zwei Ringen liegen rechnerisch auf einer Kugel);
- Segmente je Vollkreis `< 8` → „Segmente < 8" (Sechseck bleibt Prisma).

**Vertrauen:** Segmente = `360° / mittlerer Facettenwinkel`. `≥ 12` → `sicher` (Standard an), `8–11` → `unsicher` (Standard **aus**, im UI einschaltbar; Achteck-Loch aus Messung).

**Merge:** Zylinder mit `|Achse·Achse'| > 1−1e-4`, Mittellinienabstand `≤ 0.01·r`, Radiusunterschied `≤ 0.01·r`, die aneinanderstoßen → zusammenführen, neu anpassen (Messung: Loch zerfiel bei verzerrtem Radius in zwei Stücke).

**Randprüfung (gegen Scheinzylinder am Torus):** Rand der Region prüfen – muss in scharfe Kante (> 50°), Ebene senkrecht zur Achse oder tangentialen Übergang auf eine Ebene im Abstand r enden; endet mehr als 2 % der Randkanten „in der Fläche", ablehnen. *Nachtrag 15.10.2026:* gebaut und gemessen, Torus jetzt 0 statt 3 Scheinzylinder (MACHBARKEIT 2, Punkt 5).

### 5.6 constraints.js
In dieser Reihenfolge, jede einzeln abschaltbar und im Bericht gezählt:
1. **Parallel/Koaxial:** Achsen mit Winkel < 0.5° parallel setzen; Mittellinien < 0.01·r zusammenlegen.
2. **Rechtwinklig:** Ebenen mit Normale < 0.5° neben der Achsrichtung exakt ⟂/∥ zur Achse setzen.
3. **Tangential:** Wandebene mit Normale ⟂ Achse und Abstand zur Achse `|d − r| < 0.01·r` → **Achse** so verschieben, dass `d = r` exakt (bei zwei unabhängigen Wandnormalen ein 2×2-System, sonst Verschiebung längs der Normale). *Nachtrag 15.10.2026:* Ursprünglich sollte die **Ebene** wandern; gemessen blieben damit 8 der 16 Ecken der Platte um 1e-7 daneben, weil eine Wand zwei Rundungen trägt und nur die erste exakt tangiert werden kann. Die Wand ist außerdem die besser bestimmte Fläche (viele Punkte).
4. **Eckpunkte** auf den Schnitt der Nachbarmodelle rücken. Wo ein Muster passt, **geschlossen gelöst** (`solveCorner`): drei Ebenen = 3×3-System, {Zylinder, Kappe ⟂ Achse, tangentiale Wand} = Kappenhöhe auf der Berührlinie. Sonst abwechselnde Projektion, 200 Schritte (Referenz `referenz/recon.py::snap_corners`). *Gemessen:* geschlossen 0 bzw. 1e-15 Restfehler, alternierende Projektion 1e-8 nach 200 Runden.
5. **Optional, nur mit Zustimmung:** Radius auf runden Wert einrasten (Schritt `0.05 mm` bzw. 1/64 Zoll), wenn Abweichung `≤ uncertainty`.

*Messung:* Ohne 1–3 schließen die Rundungen unterteilter Netze nicht (Abstand ~4e-4 zwischen Wandebene und Zylinder). Mit ihnen ist Stufe 3 Ziel für `platte-unterteilt1/2.stl`.

### 5.7 topology.js (Referenz: `referenz/recon.py`)
1. **Regionen:** Jedes Dreieck gehört zu genau einer Region: Zylinder (aus `cylinders`) oder Ebenenstück (aus `patches`; nicht angenommene Zylinderkandidaten bleiben Ebenenstücke).
2. **Grenzhalbkanten:** Halbkante `(u,v)` eines Dreiecks, deren Zwilling `(v,u)` in einer anderen Region liegt. Je Punkt die Menge der angrenzenden Regionen.
3. **Eckpunkte:** Punkte mit ≥ 3 angrenzenden Regionen.
4. **Ketten:** Halbkanten einer Region von Ecke zu Ecke verfolgen (Region links). Geschlossene Schleifen ohne Ecke (Loch) bilden eine Kette mit gleichem Anfang und Ende. Zwilling der Kette gehört zur Nachbarregion in Gegenrichtung.
5. **Kettengeometrie aus den Nachbarflächen, nicht aus den Netzpunkten** (Messung: sonst passt der Ebenenrand nicht zum exakten Bogen):
   - Ebene ⟂ Zylinderachse + Zylinder → **Kreis** (geschlossen) bzw. **Bogen** (offen) mit dem Zylinderradius in der Ebenenhöhe; Bogenrichtung über einen mittleren Kettenpunkt, radial auf den Kreis projiziert.
   - Ebene ∥ Zylinderachse + Zylinder → **Gerade** (Mantellinie).
   - Ebene + Ebene, Punkte kollinear (< 1e-6) → **Gerade**; sonst Polygonzug aus Geraden.
   - alles andere → Polygonzug.
6. **Schleifen** je Region aus Ketten zusammensetzen (Ende der einen = Anfang der nächsten); bei Ebenen äußere Schleife = größte Fläche, übrige = Löcher.
7. **Volle Zylinder** (Rohr: zwei geschlossene Kreisketten): in **zwei Hälften** teilen – Kreise in zwei Bögen (beginnend am Winkel des ersten Netzpunkts und dem gegenüberliegenden), zwei Mantellinien als gemeinsame Kanten. Zylinder mit offener Lücke (Rundung): ein Viereck aus zwei Bögen und zwei Mantellinien im Parameterraum (Winkel, Höhe). Andere Randformen: Region bleibt Ebenenstück (Rückfall je Region).

### 5.8 brep.js / step.js
- **Ein Eckpunkt = eine ID.** Alle Kanten referenzieren dieselben `VERTEX_POINT`s. Kein Zusammenfügen über Toleranz (Messung: Rundungsfehler 1e-6 bricht Drähte).
- Jede Kante genau zweimal, gegenläufig (`ORIENTED_EDGE`). Wie im bestehenden Exporter: Außenschleife gegen den Uhrzeigersinn von außen, Löcher im Uhrzeigersinn.
- Entities: `PLANE`, `CYLINDRICAL_SURFACE`, `LINE`, `CIRCLE`, `VERTEX_POINT`, `EDGE_CURVE`, `ORIENTED_EDGE`, `EDGE_LOOP`, `FACE_OUTER_BOUND`, `FACE_BOUND`, `ADVANCED_FACE`, `CLOSED_SHELL`, `MANIFOLD_SOLID_BREP` – aus `StepWriter` und `MusterGenerator/js/export/step.js`.
- Mehrere Komponenten: ein `PRODUCT` je Komponente („Körper 1", …) in einer Datei.
- Ausgabe in **mm**. Skalierungsfaktor aus dem UI (Zoll → 25.4).

### 5.9 verify.js
Schwellen als Optionen, Standard:
| Prüfung | Standard | Grund |
|---|---|---|
| Jede Kante genau zweimal, gegenläufig (eigene Prüfung am Brep) | exakt | schließt Fehler beim Bau vor dem Schreiben aus |
| Euler: V − E + F = 2 − 2·Henkel je Schale | exakt | Plausibilität der Topologie |
| Volumen Brep ↔ Netz (Brep-Volumen analytisch mit Bogenstücken berechnen) | `≤ 1 %` | Sehnenfehler ≤ 0,3 % gemessen; 1 % fängt verlorene Körper und Fehlbau |
| Größter Abstand: Netzpunkte ↔ Brep-Fläche ihrer Region | `≤ max(1e-3·diag, 3·uncertainty)` | Erkennungsfehler |
| Anzahl Flächen vs. Stufe | Stufe 3 darf nicht mehr Flächen haben als Stufe 2 | Schutz vor versehentlichem Rückfall |

*Nachtrag 15.10.2026:* Die letzte Zeile ist **keine** Prüfung in `verify.js`, sondern ein Test über die ganze Testsammlung (`tests/exact.test.mjs`). Grund: Die Stufen werden von oben nach unten probiert – wenn Stufe 3 geprüft wird, ist Stufe 2 noch nicht gebaut, und wenn Stufe 2 geprüft wird, ist Stufe 3 schon durchgefallen. Der Test baut für jede Datei alle drei Stufen und verlangt `Flächen(3) ≤ Flächen(2) ≤ Flächen(1)`.

Unabhängig von `verify.js` prüft **CI** das geschriebene STEP mit OpenCascade (`tests/tools/validate_step.py`).

## 6. Oberfläche

Eine Seite mit Kopfleiste und Arbeitsfläche aus `shared/css/ui.css`, deutsche Texte, Hell/Dunkel wie die anderen Werkzeuge, Speicher-Schlüssel mit Präfix `stl-zu-step.`.

1. **Ablegen** (Drag & Drop, Dateiauswahl): STL, OBJ. Fortschritt je Schritt (Worker).
2. **Ergebnis**: 3D-Vorschau (three.js wie `MusterGenerator/js/ui/view3d.js`), Netz grau, erkannte Zylinder farbig, Eingabe/Ergebnis umschaltbar.
3. **Bericht** (immer sichtbar): Reparaturen mit Zahlen („3 Löcher gefüllt, 10 doppelte Dreiecke entfernt"), erreichte **Stufe** je Körper in Klartext, Rückfallgründe, Liste der erkannten Merkmale mit Radius, Achse, **Vertrauen** und Unsicherheit; unsichere einzeln einschaltbar; Radien-Einrasten (aus).
4. **Optionen**: Einheit (mm / Zoll / eigener Faktor), Toleranz (streng / Standard / grob), „Zylinder erkennen" an/aus, unsichere Merkmale übernehmen, Radien runden. Die Toleranz steuert **beide** Schwellen gemeinsam – Wachsen der Stücke *und* Annahme als eine Ebene; getrennt eingestellt verschlechtert die grobe Toleranz das Ergebnis (MACHBARKEIT 7).
5. **Export**: `.step`-Download, Dateiname aus Eingabe; Warnbanner bei Stufe 1 (große Datei, langsam in CAD) oder `offen`.
6. Warnung ab 500 000 Dreiecken („kann Minuten dauern") und Abbruch-Knopf (Worker beenden).

Feldbedienung: Ziele ≥ 44 px; Zustände nie nur über Farbe; Kontrast ≥ 4,5 : 1 (wie die anderen Werkzeuge).

## 7. Tests

| Ebene | Wo | Womit |
|---|---|---|
| Einheiten | `STL-zu-STEP/tests/*.test.mjs` | `node --test`, Fixtures aus `tests/fixtures/`, Soll aus `expected.json` |
| Export-Prüfung | `tests/tools/generate-exports.mjs` → `build/stl-exports/` + `summary.json`; `validate_step.py` | OpenCascade liest jedes STEP |
| CI | `.github/workflows/tests.yml`: Jobs `stl-unit`, `stl-exports` | wie `muster-*`, `text-*` |

**Abnahmetabelle** (jede Zeile ein Test):

| Datei | Soll |
|---|---|
| `wuerfel.stl`, `wuerfel-ascii.stl`, `wuerfel-quads.obj` | gleiche 12 Dreiecke, Volumen 1000, Stufe 3: 6 Ebenen, 0 Zylinder |
| `platte.stl` | Stufe 3: 6 Ebenen; Zylinder: 4× r = 2 (Rundungen), 2× r = 3 (Bohrungen) (STEP: Löcher als Hälften); Volumen ±0,01 % von 7400,177 |
| `platte-unterteilt1/2.stl` | Zylinder gefunden; r innerhalb `toleranz_radius_prozent`; **Stufe 3** (nach `constraints`), sonst Rückfall auf Stufe 2 mit gültigem STEP und Grund im Bericht |
| `defekt-*.stl` (außer zweikoerper) | nach Heilung geschlossen; Bericht nennt den Defekt mit richtiger Zahl; Ergebnis wie `platte.stl` |
| `defekt-zweikoerper.stl` | 2 Solids, Gesamtvolumen = Summe der Netzvolumen (14 803,7) |
| `defekt-nichtmanifold.stl` | 1 Dreieck entfernt, sonst wie `platte.stl` |
| `kugel.stl`, `kegel.stl` | 0 Zylinder (Stufe 2) |
| `torus.stl` | Ziel 0 Zylinder; bis dahin ≤ 3 und Test markiert als bekannte Schwäche |
| `loch-sechseck.stl` | 0 Zylinder |
| `loch-achteck.stl` | 1 Zylinder, `unsicher`, standardmäßig aus (Ergebnis ohne Zylinder) |
| `loch-zwoelfeck.stl` und größer | 1 Zylinder r = 3, `sicher` |
| Eingefügte Fehler | Test erzwingt Fehlschlag in `verify` (Option `forceFail`) und prüft den Rückfall 3 → 2 → 1 → `offen` samt Bericht |

## 8. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Echte Dateien verhalten sich anders als die Testsammlung | Plan-Schritt „Realitätstest": Nutzer liefert 5–10 echte STL; jeder Fehlschlag wird Fixture und Test. |
| Tangenten-Zwänge (5.6) lösen Rundungen nicht | Rückfall Stufe 2 ist immer gültig; Mess-Test `platte-unterteilt*`. Fallback-Alternative: Rundungen mit nicht exakt passender Wand als eigene Flächen an Polygonzug anlegen und Spalt per Sewing-Toleranz 1e-3 schließen (nur wenn Volumen/Abstandsprüfung bestanden). |
| Leistung > 500 k Dreiecke | Typed Arrays, Worker, Hash-Gitter, keine rekursiven Algorithmen, keine Objekte pro Dreieck. *Nachtrag 15.10.2026:* gemessen sind **10,7 s für 100 000 Dreiecke** (8,2 s umwandeln, 2,5 s STEP schreiben) – das Budget von 5 s war eine Zielvorgabe ohne Messung und wird verfehlt. Siehe MACHBARKEIT 7. |
| Fusion öffnet Stufe 1 mit sehr vielen Flächen langsam | Warnbanner mit Flächenzahl; Empfehlung, Stufe 2/3 zu erlauben. |
| Einheiten falsch (Zoll) | Warnung bei Bounding-Box-Diagonale < 1 oder > 5000; Einheitenfeld sichtbar. |
| Scheinzylinder (Torus) | Randprüfung (5.5), Vertrauen, Nutzer schaltet pro Merkmal ab. |
