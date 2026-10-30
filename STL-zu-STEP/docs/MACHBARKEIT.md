# STL-zu-STEP – Machbarkeitsstudie

Gemessene Ergebnisse, auf denen [`SPEC.md`](SPEC.md) und [`PLAN.md`](PLAN.md) beruhen. Alles ist mit den Prototypen in [`referenz/`](referenz/README.md) reproduzierbar (Python, numpy, OpenCascade über `cadquery-ocp`). Prüfmaßstab war immer OpenCascade, weil Fusion 360 und FreeCAD denselben Kern benutzen.

**Kurzfassung:** Netz → exakter Volumenkörper mit echten Ebenen und Zylindern ist machbar, auch aus unterteilten und groben Netzen. Es ist aber kein Selbstläufer: Ohne Gegenprüfungen entstehen Scheinzylinder, ohne Heilung scheitern kaputte Netze, und bei verzerrten Radien braucht der Bau eine Zwangsbedingungs-Stufe (Tangenten). Deshalb arbeitet die App in **Stufen mit automatischem Rückfall**.

Das Testteil (`tests/fixtures/platte.stl`) ist eine Platte 40×20×10 mit vier Rundungen (r = 2) und zwei Bohrungen (r = 3). Es ist synthetisch. **Echte Dateien (Freiformflächen, Schrift, Scan-Rauschen) sind nicht getestet** – siehe Abschnitt „Offen".

## 1. Netz → Volumenkörper (facettiert)

Punkte verschweißen, Dreiecke vernähen, Solid bilden, STEP schreiben, wieder lesen. **Testteil hier ohne Rundungen:** Platte 40×20×10 mit nur zwei Bohrungen (der erste Lauf, noch vor dem Teil mit Rundungen).

| Auflösung | Dreiecke | Volumen-Abweichung | STEP facettiert | nach Ebenen-Verschmelzung |
|---|---|---|---|---|
| gröber | 356 | +0,028 % | 786 kB, 356 Flächen | 337 kB, 90 Flächen |
| feiner | 460 | +0,017 % | 1031 kB, 460 Flächen | 439 kB, 116 Flächen |

Gültig nach `BRepCheck`, 0,1 s. **Folgerung:** Stufe 1 (facettiert) und Stufe 2 (ebene Flächen verschmolzen, ca. 75 % weniger Flächen) sind unkritisch.

## 2. Zylinder erkennen

Reines numpy, nach JS portierbar. Radius immer aus den **Punkten** angepasst (bei sauberen Netzen liegen sie exakt auf der Fläche), nie aus den Facetten (die liegen innen).

| Netz | Ergebnis |
|---|---|
| sauber (532 Dreiecke) | alle 6 Zylinder, r = 2,0000 und 3,0000, Achse exakt |
| Rauschen 0,002 mm auf jedem Punkt | alle 6, Radiusfehler ≤ 0,009 (typisch 0,001) |
| 1×, 2×, 4× unterteilt (Mittelpunkte auf Sehnen) | alle 6; Radius sinkt auf 2,9958 / 2,9948 / 2,9945 (−0,14 … −0,18 %), weil die Sehnenhöhe in den Daten steckt |

*Nachtrag 15.10.2026 (JS, `tests/cylinders.test.mjs`):* Dieselben Zahlen wie die Referenz. `platte` 6 Zylinder (r = 2,0000 / 3,0000), `platte-unterteilt1` 6 nach dem Verschmelzen von 2 Paaren (ohne Verschmelzen 8, wie die Referenz), `platte-unterteilt2` 6 (r = 1,9983 / 2,9948). Segmente je Vollkreis: 44 für die Rundungen, 42 für die Bohrungen; Vieleck-Löcher 8 / 12 / 16 / 32, Sechseck ohne Kandidat. Dauer: 19 ms (`platte`), 86 ms (`platte-unterteilt2`, 8512 Dreiecke), 196 ms (`kugel`).

### Was beim Erkennen schiefging – und jetzt Regel ist

1. **Startkeim nach Dreieckszahl scheitert.** „Ein Dreieck plus 4 Nachbarringe" hängt von der Vernetzung ab: bei unterteilten Netzen fand der Prototyp 0 Zylinder. **Regel:** auf **Flächenstücken** (zusammenhängende ebene Dreiecksgruppen) arbeiten, der Keim wächst, bis die Normalen eine Winkelspanne haben (Verhältnis der Eigenwerte ≥ 0,05, etwa ≥ 25°). Drei Facetten à 8,6° reichen nicht für eine stabile Achse.
2. **Tangentiale Übergänge verschlucken Wände.** Eine Rundung schließt knickfrei an die Wand an; „flache Knicke zu Ketten verbinden" fasst die ganze Wandschleife als einen Zylinder auf. **Regel:** Zylindermodell prüfen – ein Dreieck gehört nur dazu, wenn **alle drei Punkte** auf dem Zylinder liegen und die Normale radial steht.
3. **Rechtecke sehen aus wie Kreise.** Vier Ecken eines Rechtecks sind kozirkular. **Regel:** Keim nur über glatt verbundene Stücke (Knick < 50°); Normale ⟂ Achse (|N·Achse| < 0,1); Normale ≈ radial (|cos| > 0,9).
4. **Fehlalarme.** Ohne Gegenhypothesen: Kugel r = 8 → **48 Scheinzylinder**, Kegel → 5. Mit Gegenprüfung (Länge entlang der Achse ≥ 0,3 r; Radius konstant: Steigung × Länge ≤ 1 % r; Kugelprobe **mit Punkten und Normalen**) → Kugel 0, Kegel 0, Teil 6 von 6. **Fallstrick:** Eine Kugelprobe nur mit Punkten verwirft echte Zylinder – die Punkte zweier Ringe eines Zylinders liegen rechnerisch auf einer Kugel (Radius √(r² + (h/2)²)). Die Normalen müssen radial vom Kugelmittelpunkt wegzeigen (|cos| > 0,97), sonst keine Kugel.
5. **Torus: gelöst (15.10.2026).** Kurze Rohrstücke sehen lokal wie Zylinder aus; der Python-Prototyp lässt 3 Scheinzylinder durch (Ziel 0). Das Gegenmittel ist gebaut: Die Region darf nicht „in der Fläche enden" – jede Randkante muss in einer scharfen Kante (> 50°), einer Kappe senkrecht zur Achse oder einem tangentialen Übergang auf eine Ebene im Abstand r enden. Gemessen in JS: **Torus 0 angenommen** (102 Kandidaten verworfen, alle mit Grund „Rand endet in der Fläche"), Kugel 0, Kegel 0, und die 6 echten Zylinder der Platte bleiben – auch bei den unterteilten Netzen. Der Anteil erlaubter „in der Fläche" endender Randkanten ist 2 % (Option `boundaryInSurfaceShare`), damit einzelne Dreiecke an einer Ecke keinen echten Zylinder verwerfen.
6. **Vieleck oder Zylinder?** Sechseck-Loch: nicht erkannt (60° Knick). **Achteck-Loch: als Zylinder erkannt (45°)**, 12-Eck und mehr ebenso. Aus den Daten allein nicht entscheidbar → Vertrauen nach Segmentzahl pro Umfang (siehe SPEC) und Bestätigung durch den Nutzer.
7. **Verzerrter Radius bei Unterteilung.** Die Hüllen-Anpassung (nur äußere Punkte) hat nur die einfache Unterteilung gerettet; tiefer bleibt der Fehler bei etwa −0,18 %. Das ist physikalisch die Sehnenhöhe und nicht zu erzwingen. **Regel:** Unsicherheit ausweisen, Radien optional auf runde Werte einrasten lassen (nur mit Zustimmung).

## 3. Kaputte Netze (Heilung)

Aus `platte.stl` je ein Defekt erzeugt (`tests/fixtures/defekt-*.stl`); Prototyp-Heilung: Punkte mit Toleranz verschweißen, doppelte und Null-Dreiecke entfernen, T-Kreuzungen teilen, Umlaufrichtung per Breitensuche vereinheitlichen, Löcher per Ohrenschnitt füllen, Gesamtrichtung per Volumenvorzeichen.

| Defekt | Netzvolumen vorher | nach Heilung |
|---|---|---|
| Punkte je Dreieck um 2e-5 verrutscht | +0,02 % | gleich, Punktzahl 264 wie sauber |
| 3 Dreiecke fehlen | +0,25 % | 3 Löcher gefüllt, +0,02 % |
| 5 % Dreiecke falsch herum | −3,21 % | 26 gedreht, +0,02 % |
| 10 Dreiecke doppelt | +0,27 % | 10 entfernt |
| 5 Null-Dreiecke | +0,02 % | 5 entfernt |
| T-Kreuzung | +0,02 % | 1 geteilt |
| alle Dreiecke verkehrt herum | −200 % | global gedreht |
| **zwei Körper (überlappend)** | **+100 %** (14 804 statt 7 400) | **Prototyp verliert den zweiten Körper still** (Nähen nimmt nur die erste Schale). Pflicht: Komponenten trennen, je ein Solid, Summe der Volumina gegen das Netz prüfen. |
| **Kante mit drei Dreiecken** | +0,02 % | **Prototyp macht es schlimmer** (ungültig, +2,2 %). Pflicht: eigener Schritt „überzähliges Dreieck entfernen". |

*Nachtrag 15.10.2026 (JS-Heilung, `tests/heal.test.mjs`):* Alle Zeilen der Tabelle sind portiert und erreichen nach der Heilung das Volumen der sauberen Platte (±0,01 %); die beiden offenen Punkte sind gelöst (zwei Körper bleiben zwei Körper, die Kante mit drei Dreiecken verliert genau ein Dreieck). Zusätzlich gemessen: `kugel.stl` enthält an den Polen **zwei in sich zusammengefallene Dreiecke** (nach dem Verschweißen doppelte Punkte). Sie haben keine Fläche, die Heilung entfernt sie und meldet sie als „entartet"; das Netz bleibt geschlossen und das Volumen gleich.

**Lehre:** OpenCascade-Nähen verdeckt viele Fehler (es toleriert, richtet aus, verwirft Schalen). Die JS-App hat dieses Netz nicht – jede Reparatur muss selbst gebaut und **mit Zahlen im Bericht** ausgewiesen werden. Der Volumenvergleich Netz ↔ Ergebnis ist die wirksamste Einzelprüfung (fängt Mehrkörper, falsche Richtung, verlorene Teile).

## 4. Exakter Bau (Rekonstruktion)

Aus erkannten Ebenen und Zylindern wird ein B-rep mit Kreisbögen gebaut (siehe SPEC „Topologie"): Regionen → Grenzkanten → Eckpunkte (≥ 3 Regionen) → Ketten → je Kette Linie/Bogen/Polygon aus dem **Schnitt der Nachbarflächen** → Flächen → Nähen/Prüfen.

| Netz | Ergebnis |
|---|---|
| `platte.stl` (sauber) | 14 Flächen (6 Ebenen, 4 Rundungen, 4 Lochhälften), 0 freie Kanten, gültig, Volumen **7400,1771 = Original 7400,1770** (Netz selbst +0,02 %), STEP 58 kB (zum Vergleich: dasselbe Teil facettiert ≈ 1 MB bei rund 500 Dreiecken; nicht gemessen, aus Abschnitt 1 hochgerechnet) |

*Nachtrag 15.10.2026 (JS):* `platte.stl` ergibt dieselben 14 Flächen und Volumen 7400,1770 bei **16 kB** STEP (facettiert 372 kB, verschmolzen 97 kB; alle drei von OpenCascade als gültiger, geschlossener Solid gelesen). Die Vieleck-Löcher ab 12 Ecken werden ein Zylinder r = 3 und damit 8 Flächen; das Volumen ist dann das der runden Bohrung (`volumen_als_zylinder` in `expected.json`, 7717,2567 statt 7730 beim Zwölfeck), weil ein erkannter Zylinder das Vieleck ersetzt.
| gröber vernetzt (Auflösung 0,5) | identisch exakt |
| 1× / 2× unterteilt | **Bohrungen schließen**, Rundungen nicht: 24 / 26 freie Kanten, ungültig → **Rückfall greift** (Selbstprüfung erkennt es) |

Gelernt beim Bauen:

- **Eckpunkte teilen:** Alle Kanten müssen sich dasselbe Eckpunkt-Objekt teilen (eine ID). Koordinatenvergleich mit Toleranz (Rundungsfehler 1e-6) lässt Drähte nicht schließen.
- **Kanten aus dem Schnitt der Flächen**, nicht aus den Netzpunkten ablesen: bei unterteilten Netzen liegen Kettenpunkte auf Sehnen; ein Vieleckrand an der Ebene passt nicht zum exakten Bogen am Zylinder (552 freie Kanten).
- **Eckpunkte auf den Schnitt der angepassten Nachbarflächen rücken** (abwechselnde Projektion), damit alles dasselbe Modell benutzt.
- **Volle Zylinder (Löcher) in zwei Hälften teilen** (wie schon `MusterGenerator/js/export/step.js` bei Kreisen), das vermeidet die Naht.
- **Übersegmentierung:** bei verzerrtem Radius zerfällt ein Loch in zwei Zylinderstücke → Zylinder mit gleicher Achse, Mittellinie (≤ 1 % r) und Radius (≤ 1 % r), die aneinanderstoßen, verschmelzen und neu anpassen.
- **Stufe 3b (Zwangsbedingungen): gelöst (15.10.2026).** Bei den Rundungen unterteilter Netze tangierten die angepassten Wandebenen den angepassten Zylinder nicht exakt (Abstand ≠ r um ~4e-4), die Kante schloss nicht. Gebaut und gemessen in JS:

  | Netz | Eckpunktfehler ohne Zwänge | mit Zwängen | Stufe | Flächen | Volumen (exakt 7400,1770) |
  |---|---|---|---|---|---|
  | `platte.stl` | 1,1e-6 | **0** (16 von 16 Ecken geschlossen gelöst) | 3 | 14 | 7400,1770 |
  | `platte-unterteilt1.stl` | 2,0e-3 | 2,9e-15 | **3** | 14 | 7401,7710 (+0,021 %) |
  | `platte-unterteilt2.stl` | 2,8e-3 | 2,4e-15 | **3** | 14 | 7402,2089 (+0,027 %) |

  Zwei Abweichungen von der ursprünglichen Idee, beide gemessen:
  1. **Die Achse wandert, nicht die Wand.** Eine Wand trägt viele Punkte und ist die besser bestimmte Fläche; die Achse ist aus einem schmalen Band angepasst. Verschiebt man stattdessen die Wand, lässt sich nur die *erste* von zwei Rundungen an derselben Wand exakt tangieren – acht der sechzehn Ecken der Platte blieben um 1e-7 daneben. Mit zwei unabhängigen Wandnormalen ist die Achslage ein 2×2-Gleichungssystem und damit exakt.
  2. **Ecken geschlossen lösen statt projizieren.** Alternierende Projektion konvergiert an einem tangentialen Paar schlecht (1e-8 nach 200 Runden). Drei Ebenen sind ein 3×3-System, und {Zylinder, Kappe, tangentiale Wand} ist die Kappenhöhe auf der Berührlinie der Wand – beides exakt (`constraints.js::solveCorner`); iteriert wird nur, was in kein Muster passt.

## 5. Alternativen (verglichen)

| Variante | Urteil |
|---|---|
| **A. Eigene Erkennung in JS** (Flächenstücke, Zylinder anpassen und gegenprüfen) | **gewählt.** Klein, offline, im Repo-Stil, jeder Schritt einzeln absicherbar. Folgt dem Muster „Primitive erkennen (RANSAC), danach Topologie aus den Schnitten ableiten". |
| B. OpenCascade als WebAssembly | Hilft bei Nähen und Booleschen Operationen, erkennt keine Zylinder, 20–60 MB, eigenes Build-Tooling. Nur als spätere Option. |
| C. Netz neu aufbauen (Winding Number, Voxel wie ManifoldPlus) | Geht auch bei hoffnungslos kaputten Netzen, rundet aber scharfe Kanten ab. **Nur Notanker** (Phase 2), nicht Normalweg. |
| D. KI-Verfahren (z. B. Point2CAD) | Forschungsstand, schwer, nicht deterministisch. Verworfen. |

Quellen: [Schnabel et al., Efficient RANSAC](https://diglib.eg.org/handle/10.2312/CGF.v26i2pp214-226) · [Bénière et al., Recovering primitives in 3D CAD meshes](https://www.lirmm.fr/~subsol/WWW/SPIE.0112.Beniere.1.pdf) · [ManifoldPlus](https://arxiv.org/abs/2005.11621) · [Zhou/Jacobson, Mesh Arrangements for Solid Geometry](https://www.cs.columbia.edu/cg/mesh-arrangements/mesh-arrangements-for-solid-geometry-scf-2016-poster-zhou-et-al.pdf) · [Mesh-to-BRep (Überblick)](https://novedge.com/blogs/design-news/mesh-to-brep-from-scans-to-intentful-editable-b-reps).

## 6. Offen / nicht gemessen
- **Kegel, Kugel, schräge Schnitte (Ellipsen), Rundungen mit nicht senkrechter Kappe:** nicht gebaut, nur als Gegenhypothesen berücksichtigt.
- **Leistung:** Prototypen sind Python; JS-Budget in SPEC ist eine Zielvorgabe, nicht gemessen.
- **Öffnen in Fusion 360 / FreeCAD:** nur mit OpenCascade geprüft. Fusion mit Zehntausenden facettierten Flächen wird langsam (Erfahrungswert, nicht gemessen) → App warnt vorher.

## 7. Realitätstest (15.10.2026)

Sieben öffentlich verfügbare Modelle, heruntergeladen und mit `tests/tools/measure.mjs` gemessen. Sie sind **nicht** im Repo (Lizenzen, Größe); reproduzierbar über die genannten Quellen. Die Testsammlung ist synthetisch – dieser Abschnitt ist der Gegencheck mit Dateien, die niemand für dieses Werkzeug gebaut hat.

| Datei | Was es ist | Dreiecke | Ergebnis | Flächen | Volumen | Dauer |
|---|---|---|---|---|---|---|
| `fandisk.obj` | CAD-Klassiker: Ebenen, Rundungen, scharfe Kanten | 12 946 | Stufe 2 | 11 801 | = Netz | 2,0 s |
| `rocker-arm.obj` | Maschinenteil, stark neu vernetzt | 20 088 | Stufe 2 | 20 038 | = Netz | 2,5 s |
| `teapot.obj` | Utah-Teekanne | 6 468 | **4 Körper**, je Stufe 2 | 4 740 | = Netz | 0,6 s |
| `beetle.obj` | kaputtes Netz (44 nichtmanifolde Dreiecke, 22 Löcher) | 2 177 | offene Schale, mit Begründung | – | – | 0,2 s |
| `stanford-bunny.obj` | Scan mit bekanntem Loch im Boden | 69 586 | offene Schale + Einheitenwarnung (0,25 mm groß) | – | – | 7,3 s |
| `3DBenchy.stl` | das meistgedruckte Modell der Welt | 225 154 | Stufe 2 | 211 278 | = Netz | 47 s |
| `xyzrgb_dragon.obj` | organisch, sehr groß | 249 880 | Stufe 2 | 248 268 | = Netz | 65 s |

Quellen: [common-3d-test-models](https://github.com/alecjacobson/common-3d-test-models) (fandisk, rocker-arm, teapot, beetle, bunny, dragon), [3DBenchy](https://github.com/CreativeTools/3DBenchy).

**Kein einziges Ergebnis war falsch, aber fünf Fehler kamen ans Licht** – jeder davon ist jetzt eine Fixture und ein Test:

1. **Komponenten über Kanten, nicht über Punkte** (`teapot.obj`). Der Körper der Teekanne besteht aus zwei Schalen, die sich in genau einem Punkt berühren. Über Punkte verbunden ergaben sie *einen* Körper mit ungerader Euler-Zahl, also keinen gültigen Solid – das ganze Teil fiel auf „offene Schale". Über Kanten sind es zwei Solids. Jetzt 4 Körper, alle gültig. Fixture: `defekt-punktberuehrung.stl`.
2. **Bogenrichtung bei Ketten aus zwei Punkten** (`fandisk.obj`). Die Richtung eines Bogens wurde am Mittelpunkt der Kette abgelesen; bei zwei Punkten *ist* der Mittelpunkt der Endpunkt, und die Antwort war immer „im Uhrzeigersinn". Aus 0,05 rad wurde 2π − 0,05: ein Dreieck bekam die Fläche eines Vollkreises, das Körpervolumen kam mit **−3649 statt +20,2** heraus. Die Prüfung fing es ab, aber eine falsche Bogenrichtung kann in einem anderen Teil unter der Ein-Prozent-Grenze bleiben. Test: `tests/arc.test.mjs`.
3. **Zwangsbedingungen nur zwischen Flächen, die sich berühren – und nie von den eigenen Daten weg** (`fandisk.obj`). Die Rechtwinkligkeit rastete **1006 von 11 000** Regionen auf eine Achse ein, die sie nie berühren; die Tangentialität schob eine Zylinderachse so weit, dass ihr Restfehler von 0,00002 auf **0,0328 mm** stieg. Jetzt werden nur Nachbarregionen betrachtet, und jede Zwangsbedingung wird zurückgenommen, wenn die Fläche danach schlechter zu ihren eigenen Punkten passt (`verworfen` im Bericht).
4. **Euler-Zahl mit Innenschleifen** (`3DBenchy.stl`). Eine Fläche mit Löchern ist keine Scheibe; sie zählt `1 − Innenschleifen`. Ohne diese Korrektur kam für Benchy (ein Körper vom Geschlecht 5) χ = 3 statt −8 heraus, und ein völlig korrektes Ergebnis wurde zweimal verworfen. Benchy erreicht jetzt Stufe 2 statt Stufe 1; der Bericht nennt die Zahl der Durchbrüche im Klartext.
5. **Facetten-Ebenen folgen ihren Eckpunkten** (`fandisk.obj`). Die Ebene einer Facette ist *durch* ihr Dreieck definiert. Rückt eine Zwangsbedingung einen Eckpunkt auf einen Zylinder, muss die Facettenebene neu durch die verschobenen Punkte gelegt werden, sonst liegt sie 2e-3 mm daneben.

**Toleranz-Stufen.** Dabei fiel auf, dass „grobe Toleranz" das Ergebnis *verschlechterte* (fandisk: 12 145 statt 11 801 Flächen), weil die größeren Stücke dann an der strengen Ebenheitsgrenze scheiterten und wieder in Facetten zerfielen. Beide Schwellen skalieren jetzt gemeinsam (SPEC 6.4): fandisk kommt mit `grob` auf **7007 Flächen** (−41 %) bei 7,3e-4 mm größtem Abstand zum Netz.

### Leistung (gemessen, Node 22)

Zwei Messreihen, jeweils **alter und neuer Stand nacheinander auf derselben Maschine** (Zeit für „Umwandeln", STEP schreiben nicht eingerechnet). Die erste Reihe sind Kugelnetze – der härteste einfache Fall, weil jedes Dreieck eine eigene Facette bleibt (Stufe 2, 35–190 MB STEP); die zweite die unterteilte Platte (Stufe 3, 15 kB STEP).

| Netz | Dreiecke | vorher | nachher |
|---|---|---|---|
| Kugel | 39 600 | 7,4 s | **2,5 s** |
| Kugel | 101 760 | 19,9 s | **5,3 s** |
| Kugel | 199 808 | 31,9 s | **9,5 s** |
| Platte, unterteilt | 8 512 | 0,71 s | **0,30 s** |
| Platte, unterteilt | 34 048 | 2,2 s | **0,63 s** |
| Platte, unterteilt | 136 192 | 8,6 s | **1,8 s** |
| rocker-arm (real) | 20 088 | 3,3 s | **2,2 s** |
| 3DBenchy (real) | 225 154 | 71 s | **35 s** |

Die Ergebnisse sind dabei Byte für Byte dieselben: Flächen, Stufen, Volumen und Berichte von 28 Dateien (alle Fixtures plus die drei realen) stimmen vor und nach der Änderung überein, die STEP-Dateien sind gleich groß.

**Was es war.** Das Profil (`node --cpu-prof`) zeigte keinen einzelnen Algorithmus, sondern Speicherverwaltung: Kanten hießen `"u,v"` (ein String je Kante und Suche, dazu ein Array je Kante in zwei Maps), und die Müllabfuhr nahm bis zu 24 % der Zeit. Drei Änderungen, jede ohne Änderung der Logik:
1. **Kanten-Tabelle aus Typed Arrays** (`edgeTable` in `meshops.js`, offene Adressierung): ersetzt `edgeMap`, die Kantenschlüssel als Zeichenketten und die Paar-Arrays je Dreieckskante in Heilung, Nachbarschaft, Komponenten und `buildTopology`. Allein das brachte auf dem 136k-Netz 8,6 → 3,3 s.
2. **`buildTopology` ohne Maps je Punkt:** Dreiecke je Punkt als CSR, Regionen nur für Eckpunkte (die Zwangsbedingungen kennen keine anderen), Randkanten als flache Zahlenlisten.
3. **Keimwachstum der Zylindererkennung inkrementell:** Die Kovarianz der Normalen wird beim Wachsen fortgeschrieben statt bei jedem Schritt neu aus allen Dreiecken summiert (gleiche Summationsreihenfolge, gleiche Zahlen). Benchy: 14,4 → 7,3 s in diesem Schritt.

Das Budget in SPEC 8 („100 000 Dreiecke < 5 s") wird für Stufe-3-Teile (Platte: 1,8 s bei 136 000) **eingehalten**, für ein Netz, das in Stufe 2 mit 100 000 einzelnen Facetten endet (Kugel), knapp **verfehlt** (5,3 s) – dort wird die Zeit zu einem großen Teil für Bau und Prüfung von 100 000 Flächen gebraucht. Bei Benchy (Stufe 3 gebaut, an einer Prüfung gescheitert, dann Stufe 2) rechnet die Pipeline alles zweimal; das ist der Preis des Rückfalls und steht im Bericht. Die Oberfläche bleibt bedienbar (Worker, Fortschritt, Abbrechen) und warnt ab 500 000 Dreiecken.

### Was der Realitätstest offen lässt

- **`fandisk.obj` erreicht Stufe 3 nicht:** ein einziger Eckpunkt lässt sich nicht auf alle seine Flächen legen (1,95e-3 mm). Der Rückfall auf Stufe 2 ist korrekt; ein Rückfall *je Region* (nur den betroffenen Zylinder verwerfen) wäre besser.
- **`rocker-arm.obj`: 817 Kandidaten verworfen, 0 angenommen** – überwiegend mit „Rand endet in der Fläche". Bei stark neu vernetzten Teilen ist die Randprüfung vermutlich zu streng; ohne Fixture, die das zeigt, wird die Schwelle nicht angefasst.
- **`3DBenchy.stl`: 123 der 142 „Zylinder" sind Splitter** (r = 0,01 … 0,5 mm aus drei bis fünf Dreiecken). Die echten Merkmale findet die Erkennung sauber (Kaminbohrung r = 5,000, zwei Fenster r = 2,000). Die Splitter kosten Stufe 3, die die Prüfung zu Recht verweigert. Rauschen allein erzeugt sie nicht (`kugel-rauschen.stl` ergibt 0 Zylinder) – sie entstehen an entarteten Dreiecken.
- **Dateigrößen:** Stufe 1 und 2 schreiben für große Netze riesige Dateien (Benchy 205 MB). Das ist die ehrliche Folge von „jede Facette eine Fläche"; die Oberfläche warnt davor.
- **Die Dateien des Auftraggebers** fehlen weiterhin: diese sieben sind öffentlich verfügbare Modelle, keine echten Druckteile mit Bohrungen aus Thingiverse/Printables.

## 8. 3MF-Dateien (30.10.2026)

3MF ist das Druckformat der Slicer: ein ZIP-Archiv mit `3D/3dmodel.model` (XML), Objekten aus Netzen oder Komponenten, einer Bauliste mit Transform je Teil, einer Einheit und – je nach Programm – Zusatzdateien. Gemessen wurde an **zehn selbst gebauten Dateien** (`tests/fixtures/3mf/`, Erzeuger `tests/tools/make_3mf_fixtures.mjs`), nicht an echten Slicer-Dateien.

**Was gebaut ist und womit es geprüft wurde**

| Baustein | Prüfung |
|---|---|
| `inflate.js` (eigener, synchroner Entpacker) | 25 Kombinationen aus Daten (leer, Text, Zufall, gemischt) und Verfahren (gespeichert, feste und dynamische Codes, RLE) stimmen mit `node:zlib` überein; 59 MB in 0,5 s |
| `zip.js` | Eintrag, Prüfsumme (CRC-32 gegen den Standardwert), abgeschnittenes Archiv, falsche Prüfsumme |
| `xml.js` (kleiner Scanner statt DOMParser, der im Worker fehlt) | Attribute mit beiden Anführungszeichen, Entitäten, Kommentare, CDATA, Text |
| `threemf.js` | Einheit, verschachtelte Komponenten, Instanzen, Spiegelung, Typen, Produktionserweiterung, Fehlerfälle |
| gegen **`lib3mf`** (`tests/tools/crosscheck_3mf.py`) | Dreiecke, Volumen und Lage von 7 Dateien stimmen überein, darunter verschachtelte Komponenten mit Skalierung (2125 mm³, 55 × 10 × 10 mm) und Zoll (16 387 064 mm³) |
| **55 3MF-Dateien des Text-Generators** (`Text-Generator/tests/tools/generate-exports.mjs`, ein unabhängiger Erzeuger mit mehreren Objekten und Farben) | alle gelesen, **Dreiecke, Volumen und Lage stimmen bei allen 55 mit `lib3mf` überein** (z. B. 62 600 Dreiecke, 4190,517 mm³) |
| alle zehn Dateien durch die ganze Pipeline und OpenCascade | 47 STEP-Dateien gültig |

**Entscheidungen, die die Spezifikation offenlässt**

- **Spiegelung:** Ein Transform mit negativer Determinante dreht die Umlaufrichtung. `lib3mf` wendet die Matrix unverändert an und liefert dabei −1000 mm³ für einen Würfel, der Leser +1000 mm³ und meldet „gespiegelt“ im Bericht.
- **Nicht übernommen** werden Objekte vom Typ `support`, `solidsupport`, `surface` und `other` sowie Teile mit `printable="0"`; jedes steht mit Grund im Bericht. Ein 3MF ohne Bauliste übernimmt alle Objekte vom Typ `model` und warnt.
- **Einheit:** wird aus der Datei auf Millimeter umgerechnet. Ist in der Oberfläche zusätzlich eine Einheit eingestellt, gilt sie obendrauf, und der Bericht sagt es.
- **Kreisförmige Komponenten** (A enthält B enthält A): nur dieser Zweig wird übersprungen, mit Meldung. Vorher lief die Rekursion bis zur Tiefengrenze und lieferte 16 Würfel statt einen (im Test gefunden).
- **Körper:** Instanzen und getrennte Teile werden getrennte Volumenkörper (die Trennung geschieht wie bisher über Kanten nach dem Verschweißen). Der Name eines 3MF-Objekts erscheint im Bericht, **nicht** als Name des Körpers in der STEP-Datei: nach Heilung und Trennung ist die Zuordnung Dreieck → Objekt verloren.
- **Grobe Schätzung vor dem Start:** ein 3MF braucht gemessen 11 bis 13 Byte je Dreieck; darauf beruht die Warnung vor sehr großen Dateien.

**Nur nach Beschreibung gebaut, nicht an echten Dateien geprüft:** Das Layout von **Bambu Studio** (Teile in `3D/Objects/*.model`, Teiltypen `normal_part`, `negative_part`, `modifier_part`, Namen und Platten in `Metadata/model_settings.config`) und von **PrusaSlicer** (Modifizierer als Dreiecksbereiche im selben Netz laut `Metadata/Slic3r_PE_model.config`). Die Testdateien dazu folgen der Beschreibung und sind gültige 3MF-Dateien (`lib3mf` liest sie), beweisen aber nicht, dass echte Dateien genauso aufgebaut sind. Ein **Negativteil wird nicht vom Körper abgezogen**, sondern ausgelassen – der Bericht sagt das ausdrücklich.

**Nicht gelesen:** Farben und Materialien (nur gezählt), Gitterstäbe (Beam-Lattice), Schichtdaten (Slice), verschlüsselte oder ZIP64-Archive. Das Vorhandensein steht im Bericht.

**Einordnung zu den Mehrfarb-Druckdateien:** Beim Umwandeln der 55 Dateien des Text-Generators enden viele Körper als „offen“ (z. B. `preset3`: 111 von 112). Das liegt an der Geometrie, nicht am Leser: Die Farbteile berühren sich und überlappen (Schrift auf Grundplatte), und die STL-Fassung desselben Modells endet ebenfalls zu großen Teilen offen (88 von 113). Der Bericht nennt das je Körper; eine Auswertung, ob sich solche Druckdateien besser behandeln lassen (z. B. Teile je Farbe vereinigen), ist nicht gemacht.

**Leistung:** 136 192 Dreiecke als 3MF (1,5 MB) werden in 0,5 s gelesen.

**Offen:** echte 3MF-Dateien aus Bambu Studio, PrusaSlicer und Cura (die Dateien des Auftraggebers); Farben aus der Datei in die Vorschau; Negativteile abziehen; Namen der Objekte als Namen der Körper in der STEP-Datei.

