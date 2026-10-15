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

### Was beim Erkennen schiefging – und jetzt Regel ist

1. **Startkeim nach Dreieckszahl scheitert.** „Ein Dreieck plus 4 Nachbarringe" hängt von der Vernetzung ab: bei unterteilten Netzen fand der Prototyp 0 Zylinder. **Regel:** auf **Flächenstücken** (zusammenhängende ebene Dreiecksgruppen) arbeiten, der Keim wächst, bis die Normalen eine Winkelspanne haben (Verhältnis der Eigenwerte ≥ 0,05, etwa ≥ 25°). Drei Facetten à 8,6° reichen nicht für eine stabile Achse.
2. **Tangentiale Übergänge verschlucken Wände.** Eine Rundung schließt knickfrei an die Wand an; „flache Knicke zu Ketten verbinden" fasst die ganze Wandschleife als einen Zylinder auf. **Regel:** Zylindermodell prüfen – ein Dreieck gehört nur dazu, wenn **alle drei Punkte** auf dem Zylinder liegen und die Normale radial steht.
3. **Rechtecke sehen aus wie Kreise.** Vier Ecken eines Rechtecks sind kozirkular. **Regel:** Keim nur über glatt verbundene Stücke (Knick < 50°); Normale ⟂ Achse (|N·Achse| < 0,1); Normale ≈ radial (|cos| > 0,9).
4. **Fehlalarme.** Ohne Gegenhypothesen: Kugel r = 8 → **48 Scheinzylinder**, Kegel → 5. Mit Gegenprüfung (Länge entlang der Achse ≥ 0,3 r; Radius konstant: Steigung × Länge ≤ 1 % r; Kugelprobe **mit Punkten und Normalen**) → Kugel 0, Kegel 0, Teil 6 von 6. **Fallstrick:** Eine Kugelprobe nur mit Punkten verwirft echte Zylinder – die Punkte zweier Ringe eines Zylinders liegen rechnerisch auf einer Kugel (Radius √(r² + (h/2)²)). Die Normalen müssen radial vom Kugelmittelpunkt wegzeigen (|cos| > 0,97), sonst keine Kugel.
5. **Torus nicht gelöst.** Kurze Rohrstücke sehen lokal wie Zylinder aus. Der Prototyp lässt 3 Scheinzylinder durch (Ziel 0). Gegenmittel (noch nicht gebaut): Region darf nicht „in der Fläche enden" – an einem Zylinderrand muss eine scharfe Kante, eine Kappenebene oder ein tangentialer Übergang auf Ebene/koaxialen Zylinder stehen.
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

**Lehre:** OpenCascade-Nähen verdeckt viele Fehler (es toleriert, richtet aus, verwirft Schalen). Die JS-App hat dieses Netz nicht – jede Reparatur muss selbst gebaut und **mit Zahlen im Bericht** ausgewiesen werden. Der Volumenvergleich Netz ↔ Ergebnis ist die wirksamste Einzelprüfung (fängt Mehrkörper, falsche Richtung, verlorene Teile).

## 4. Exakter Bau (Rekonstruktion)

Aus erkannten Ebenen und Zylindern wird ein B-rep mit Kreisbögen gebaut (siehe SPEC „Topologie"): Regionen → Grenzkanten → Eckpunkte (≥ 3 Regionen) → Ketten → je Kette Linie/Bogen/Polygon aus dem **Schnitt der Nachbarflächen** → Flächen → Nähen/Prüfen.

| Netz | Ergebnis |
|---|---|
| `platte.stl` (sauber) | 14 Flächen (6 Ebenen, 4 Rundungen, 4 Lochhälften), 0 freie Kanten, gültig, Volumen **7400,1771 = Original 7400,1770** (Netz selbst +0,02 %), STEP 58 kB (zum Vergleich: dasselbe Teil facettiert ≈ 1 MB bei rund 500 Dreiecken; nicht gemessen, aus Abschnitt 1 hochgerechnet) |
| gröber vernetzt (Auflösung 0,5) | identisch exakt |
| 1× / 2× unterteilt | **Bohrungen schließen**, Rundungen nicht: 24 / 26 freie Kanten, ungültig → **Rückfall greift** (Selbstprüfung erkennt es) |

Gelernt beim Bauen:

- **Eckpunkte teilen:** Alle Kanten müssen sich dasselbe Eckpunkt-Objekt teilen (eine ID). Koordinatenvergleich mit Toleranz (Rundungsfehler 1e-6) lässt Drähte nicht schließen.
- **Kanten aus dem Schnitt der Flächen**, nicht aus den Netzpunkten ablesen: bei unterteilten Netzen liegen Kettenpunkte auf Sehnen; ein Vieleckrand an der Ebene passt nicht zum exakten Bogen am Zylinder (552 freie Kanten).
- **Eckpunkte auf den Schnitt der angepassten Nachbarflächen rücken** (abwechselnde Projektion), damit alles dasselbe Modell benutzt.
- **Volle Zylinder (Löcher) in zwei Hälften teilen** (wie schon `MusterGenerator/js/export/step.js` bei Kreisen), das vermeidet die Naht.
- **Übersegmentierung:** bei verzerrtem Radius zerfällt ein Loch in zwei Zylinderstücke → Zylinder mit gleicher Achse, Mittellinie (≤ 1 % r) und Radius (≤ 1 % r), die aneinanderstoßen, verschmelzen und neu anpassen.
- **Noch offen (Stufe 3b, Zwangsbedingungen):** Bei den Rundungen unterteilter Netze tangieren die angepassten Wandebenen den angepassten Zylinder nicht exakt (Abstand ≠ r um ~4e-4), die Kante schließt nicht. Lösung nach Stand der Technik: **Tangenten-, Koaxial- und Rechtwinkligkeits-Zwang** vor dem Bau (Wandebene exakt im Abstand r vom Zylinderachse, Achsen exakt parallel, Kappenebenen exakt senkrecht). Das ist ein eigener Plan-Schritt mit eigenem Test; bis dahin gilt der Rückfall.

## 5. Alternativen (verglichen)

| Variante | Urteil |
|---|---|
| **A. Eigene Erkennung in JS** (Flächenstücke, Zylinder anpassen und gegenprüfen) | **gewählt.** Klein, offline, im Repo-Stil, jeder Schritt einzeln absicherbar. Folgt dem Muster „Primitive erkennen (RANSAC), danach Topologie aus den Schnitten ableiten". |
| B. OpenCascade als WebAssembly | Hilft bei Nähen und Booleschen Operationen, erkennt keine Zylinder, 20–60 MB, eigenes Build-Tooling. Nur als spätere Option. |
| C. Netz neu aufbauen (Winding Number, Voxel wie ManifoldPlus) | Geht auch bei hoffnungslos kaputten Netzen, rundet aber scharfe Kanten ab. **Nur Notanker** (Phase 2), nicht Normalweg. |
| D. KI-Verfahren (z. B. Point2CAD) | Forschungsstand, schwer, nicht deterministisch. Verworfen. |

Quellen: [Schnabel et al., Efficient RANSAC](https://diglib.eg.org/handle/10.2312/CGF.v26i2pp214-226) · [Bénière et al., Recovering primitives in 3D CAD meshes](https://www.lirmm.fr/~subsol/WWW/SPIE.0112.Beniere.1.pdf) · [ManifoldPlus](https://arxiv.org/abs/2005.11621) · [Zhou/Jacobson, Mesh Arrangements for Solid Geometry](https://www.cs.columbia.edu/cg/mesh-arrangements/mesh-arrangements-for-solid-geometry-scf-2016-poster-zhou-et-al.pdf) · [Mesh-to-BRep (Überblick)](https://novedge.com/blogs/design-news/mesh-to-brep-from-scans-to-intentful-editable-b-reps).

## 6. Offen / nicht gemessen

- **Echte Dateien.** Alle Messungen an einem synthetischen Teil und seinen Abwandlungen. Freiformflächen, Schrift, Scan-Rauschen, Millionen Dreiecke, Einheiten (Zoll?) sind ungetestet. → Plan-Schritt „Realitätstest" mit Dateien des Auftraggebers; Fehlschläge werden Teil der Testsammlung.
- **Torus-Scheinzylinder** (3 von 104 Kandidaten durchgelassen).
- **Stufe 3b** (Zwangsbedingungen) – oben.
- **Kegel, Kugel, schräge Schnitte (Ellipsen), Rundungen mit nicht senkrechter Kappe:** nicht gebaut, nur als Gegenhypothesen berücksichtigt.
- **Leistung:** Prototypen sind Python; JS-Budget in SPEC ist eine Zielvorgabe, nicht gemessen.
- **Öffnen in Fusion 360 / FreeCAD:** nur mit OpenCascade geprüft. Fusion mit Zehntausenden facettierten Flächen wird langsam (Erfahrungswert, nicht gemessen) → App warnt vorher.
