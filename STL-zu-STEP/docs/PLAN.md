# STL-zu-STEP – Umsetzungsplan

Für Claude Code. Vorher lesen: [`SPEC.md`](SPEC.md) (was), [`MACHBARKEIT.md`](MACHBARKEIT.md) (Messwerte, Fallstricke), [`referenz/README.md`](referenz/README.md) (lauffähige Python-Vorlage). Regeln des Repos: Wurzel-[`CLAUDE.md`](../../CLAUDE.md).

## Stand (15.10.2026)

**Schritte 0 bis 10 sind gebaut**, jeder mit Tests und einem eigenen Commit; `npm test` und `npm run validate:stl` sind grün (37 STEP-Dateien von OpenCascade gelesen). Gelöst sind dabei auch die beiden offenen Punkte der Machbarkeitsstudie: **Torus 0 statt 3 Scheinzylinder** (Randprüfung) und **Stufe 3 für die unterteilten Netze** (Zwangsbedingungen, Ecken geschlossen gelöst). Abweichungen vom ursprünglichen Plan stehen mit Messwert in `SPEC.md` und `MACHBARKEIT.md`.

**Reparaturschritt (16.10.2026, nach Schritt 11):** `convert()` läuft jetzt diagnose → heilen → diagnose → validate (`diagnose.js`, `repair.js`, `spatial.js`; SPEC 5.3 Nachtrag). Die Heilung selbst ist unverändert; neu sind der Befund vorher/nachher, die Prüfung der Reparatur gegen die Eingabe mit Toleranz, die Warnung bei großen Löchern, der optionale Filter für kleine Schalen und der JSON-Bericht. Gegenprobe mit trimesh/pymeshfix: `tests/tools/crosscheck_trimesh.py`. Kommandozeile: `tests/tools/repair-report.mjs`.

**Schritt 11 (Realitätstest) ist zur Hälfte erledigt:** sieben öffentlich verfügbare Modelle sind gemessen (`MACHBARKEIT.md` Abschnitt 7); sie haben fünf Fehler zutage gefördert, die behoben und als Fixtures und Tests abgesichert sind. Was fehlt, sind **echte Druckteile mit Bohrungen vom Auftraggeber** und das Öffnen der Ergebnisse in Fusion 360 oder FreeCAD – beides kann nur er liefern.

## Arbeitsweise

- **Test zuerst** (rot → grün), pro Schritt ein Commit, Betreff englisch im Imperativ.
- Pro Schritt gilt: `npm test` grün, bevor der nächste beginnt. Schritte nicht überspringen – spätere bauen auf den Zahlen früherer auf.
- **Referenz ist Maßstab.** Ein Modul gilt als portiert, wenn es auf den Fixtures dieselben Zahlen liefert wie `docs/referenz/` (Tabelle in jedem Schritt). Weicht JS ab, ist zuerst die Ursache zu klären, nicht die Referenz anzupassen.
- Kein `index.html` vor Schritt 10 (sonst veröffentlicht Pages eine leere Seite).
- Kein Build, keine npm-Pakete im Repo. Hilfsprogramme (Python/OpenCascade) nur in `tests/tools/`.
- Unterwegs gefundene Abweichungen von `SPEC.md` mit Begründung in `SPEC.md` nachtragen (ein Satz, Datum), nicht still ändern.
- Wo eine Zahl der Spezifikation sich im Test als falsch erweist: im Test messen, in `SPEC.md`/`MACHBARKEIT.md` korrigieren, Commit „Fix spec value …".

Vorbereitet liegen bereits: `tests/fixtures/` (23 Dateien + `expected.json`, erzeugt von `tests/tools/make_fixtures.py`), `tests/tools/validate_step.py` (OpenCascade-Prüfer), `docs/referenz/` (Prototypen).

---

## Schritt 0 – Testgerüst und CI

**Dateien:** `package.json`, `.github/workflows/tests.yml`, `STL-zu-STEP/tests/helpers.mjs`.

1. `tests/helpers.mjs`: `loadFixture(name)` (liest aus `tests/fixtures/`, gibt `ArrayBuffer`), `expected()` (liest `expected.json`), `meshStats(V, F)` (Kanten je 2× gegenläufig, Volumen, Komponenten) – wird in den späteren Schritten benutzt.
2. `package.json`: `"test:stl": "node --test \"STL-zu-STEP/tests/*.test.mjs\""`, in `"test"` anhängen; `"validate:stl": "node STL-zu-STEP/tests/tools/generate-exports.mjs build/stl-exports && python3 STL-zu-STEP/tests/tools/validate_step.py build/stl-exports"`.
3. `tests.yml`: Jobs `stl-unit` (Node 22, `node --test`) und `stl-exports` (Python 3.12, `pip install cadquery-ocp`, `generate-exports.mjs`, `validate_step.py`) nach dem Muster der Muster-/Text-Jobs. Der Export-Job schlägt bis Schritt 6 nicht an: `generate-exports.mjs` kommt in Schritt 6, bis dahin Job mit `if: hashFiles('STL-zu-STEP/tests/tools/generate-exports.mjs') != ''`.

**Abnahme:** `npm test` läuft (mit einem Platzhalter-Test, der die Fixtures lädt), CI-Datei syntaktisch gültig.

## Schritt 1 – `core/parse.js`

**Tests zuerst** (`tests/parse.test.mjs`): `wuerfel.stl`, `wuerfel-ascii.stl`, `wuerfel-quads.obj` → je 12 Dreiecke, Volumen 1000; binäre Datei, die mit `solid` beginnt, wird als binär erkannt (Längenformel); Datei mit NaN → Dreieck verworfen + Warnung; Bounding-Box-Diagonale < 1 → Einheitenwarnung; abgeschnittene Datei → klarer Fehler, kein Absturz.
**Implementierung:** SPEC 5.1. Rückgabe `{ tris: Float64Array, warnings, unit }`.
**Abnahme:** alle drei Würfel-Formate liefern dieselbe Punktmenge, Dreieckszahl und dasselbe Volumen (zu den Dreiecken selbst siehe Nachtrag in SPEC 5.1).

## Schritt 2 – `core/weld.js`, `core/meshops.js`

**Tests:** `platte.stl` → 264 Punkte, 532 Dreiecke, jede Kante genau zweimal gegenläufig, Volumen 7401,86 (±0,01). `defekt-verrutscht.stl` → ebenfalls 264 Punkte. `meshops`: `edgeMap`, `signedVolume`, `components` (`defekt-zweikoerper.stl` → 2), Union-Find ohne Rekursion.
**Referenz:** `probe1.py::weld`, `heal.py::weld/edges`.
**Abnahme:** Zahlen oben; 100 000 Dreiecke (synthetisch, im Test erzeugt) < 1 s.

## Schritt 3 – `core/heal.js` (größter Schritt, in Unterschritten committen)

Je Defekt-Fixture ein Test, **Reihenfolge der Unterschritte = Reihenfolge in SPEC 5.3**:

| Unterschritt | Fixture | Soll nach Heilung |
|---|---|---|
| 3a Entartete + doppelte | `defekt-nulldreiecke`, `defekt-doppelt` | 5 bzw. 10 entfernt, Volumen = `platte` |
| 3b T-Kreuzungen | `defekt-tkreuzung` | 1 geteilt, geschlossen |
| 3c **Nichtmanifold** | `defekt-nichtmanifold` | 1 entfernt, Rest identisch (Prototyp scheitert hier – neu bauen) |
| 3d Umlaufrichtung | `defekt-gedreht` | 26 gedreht |
| 3e Löcher | `defekt-loch` | 3 gefüllt; Loch mit > 64 Kanten bleibt offen (`holesOpen`, eigener Test mit großem Loch) |
| 3f Gesamtrichtung | `defekt-invertiert` | `orientedGlobally`, Volumen positiv |
| 3g Komponenten | `defekt-zweikoerper` | 2 Komponenten, Gesamtvolumen 14 803,7 (nicht 7 400!) |

Für jedes: `HealReport` nennt die Zahl; **nach der gesamten Heilung** hat `platte`-Abwandlung dasselbe Volumen wie `platte.stl` (±0,01 %).
**Referenz:** `docs/referenz/heal.py`, `defects.py` (reproduziert die Tabelle in MACHBARKEIT 3).
**Abnahme:** `defects.py` und der JS-Test geben für alle Fixtures dieselben Zahlen.

## Schritt 4 – `core/patches.js`

**Tests:** `platte.stl` → 134 Stücke bei sauberem Netz (Referenz `probe4.py::patches`, Werte aus der Referenz übernehmen: 134); die sechs Zylinderflächen zerfallen in viele schmale Stücke, jedes Stück ist eben (alle Punkte ≤ 1e-3·diag von der Ebene). `platte-unterteilt1/2.stl` → ebenfalls 134 Stücke (Vernetzungsunabhängigkeit!).
**Abnahme:** Zahlen oben, identisch zur Referenz.

## Schritt 5 – `core/cylinders.js` (Detect + Verify + Merge)

Unterschritte jeweils mit Test:

| Unterschritt | Test (Fixtures) | Soll |
|---|---|---|
| 5a Detect | `platte`, `platte-unterteilt1/2` | 6 Zylinder; r = 2,0000 / 3,0000 (sauber), innerhalb `toleranz_radius_prozent` (unterteilt); Achse (0,0,1) |
| 5b Verify | `kugel`, `kegel` | 0 angenommen; Ablehnungsgründe wie `probe7.py` |
| 5c Verify | `platte` | 6 von 6 bleiben (Regressionsschutz gegen die Punkte-Kugelprobe!) |
| 5d Vertrauen | `loch-sechseck`/`achteck`/`zwoelfeck`/… | 6-Eck: 0; 8-Eck: `unsicher`; ≥ 12: `sicher` |
| 5e Merge | `platte-unterteilt1` | Löcher als je ein Zylinder (nicht zwei Stücke) |
| 5f Torus | `torus` | Ziel 0. Erst Randprüfung bauen (SPEC 5.5, Bekannte Schwäche); gelingt es nicht in vertretbarer Zeit: Test als `todo` markieren, ≤ 3 zulassen, in `MACHBARKEIT.md` vermerken |

**Referenz:** `probe4.py::detect`, `probe6.py::verdict`, `probe7.py`, `recon.py::merge_cylinders`.

## Schritt 6 – Stufe 1: `export/step.js` (facettiert) und `generate-exports.mjs`

Früh, damit es immer ein gültiges Ergebnis gibt.

**Tests:** Aus `platte.stl` Stufe 1 schreiben; eigene Prüfung (SPEC 5.9, Kanten 2×, Euler); Text beginnt mit `ISO-10303-21;`. **Hauptprüfung ist OpenCascade:** `tests/tools/generate-exports.mjs` wandelt **jedes** Fixture mit der Pipeline (Stufe erzwingbar per Option) in `build/stl-exports/<name>.step` und schreibt `summary.json` aus `expected.json` (nur Felder `koerper`, `volumen`, `volumen_toleranz_prozent`, `max_flaechen`); `validate_step.py` muss grün sein.
**Implementierung:** `StepWriter` aus `shared/js/step.js`; jedes Dreieck `ADVANCED_FACE` auf `PLANE`; Konventionen aus `MusterGenerator/js/export/step.js`; Eckpunkte teilen (eine ID).
**Abnahme:** `npm run validate:stl` grün für alle Fixtures in Stufe 1 (außer Fixtures mit offenen Löchern > 64 Kanten: keine). **Wichtig:** Volumen-Toleranz für Stufe 1 = Netzvolumen (nicht `volumen` aus `expected.json`, das ist das exakte Teil).

## Schritt 7 – Stufe 2: verschmolzene Ebenen

**Tests:** `platte.stl` Stufe 2 → in OpenCascade gültig; Flächenzahl ≈ Zahl der Stücke (134 ± 0 laut Referenz); Volumen = Netzvolumen. Flächen mit Löchern (Deckel mit zwei Bohrungen als Facettenring: ein `FACE_OUTER_BOUND` + je ein `FACE_BOUND`).
**Implementierung:** Randschleifen je Stück aus der Topologie (Schritt 8 Teil 1 vorziehen: `topology.js` bis Ketten, **ohne** Kreise – alles Gerade/Polygonzug). Gerade Ketten zwischen zwei Ecken zu einer Kante zusammenfassen (kollinear < 1e-6).
**Abnahme:** `npm run validate:stl` grün; Stufe-2-Dateien deutlich kleiner als Stufe 1 (Messung: ca. 75 % weniger Flächen).

## Schritt 8 – Stufe 3: Zylinder, Zwangsbedingungen, exakter Bau

Aufteilen in Commits:
- **8a `constraints.js` 4 (Eckpunkte snappen)** + Test: Eckpunkt von `platte.stl` landet ≤ 1e-9 auf allen Nachbarmodellen.
- **8b `topology.js` voll** (Kreise, Bögen, Mantellinien, Rohr in Hälften; SPEC 5.7). Test: `platte.stl` → 14 Flächen (6 Ebenen, 4 Rundungen, 4 Lochhälften), 0 freie Kanten im eigenen Test.
- **8c `brep.js`** + `step.js` für `PLANE`, `CYLINDRICAL_SURFACE`, `CIRCLE`, `LINE`. Test: OpenCascade-Prüfer: gültig, Volumen 7400,177 ±0,01 % (Referenz: 7400,1771, **exakt wie Original**), STEP < 100 kB.
- **8d `constraints.js` 1–3 (Parallel, Rechtwinklig, Tangential)**. Test: `platte-unterteilt1/2.stl` erreichen Stufe 3 (sonst: Rückfall Stufe 2, Test dokumentiert warum; siehe MACHBARKEIT 4 „Noch offen"). Referenz bis hier: Bohrungen schließen, Rundungen nicht – genau das ist die Aufgabe von 8d.
- **8e** `loch-zwoelfeck.stl` → ein Zylinder r = 3, STEP gültig (Rohr in Hälften).

**Referenz:** `recon.py` (alles), `recon_hard.py`.
**Abnahme:** Abnahmetabelle SPEC 7 für Stufe 3 erfüllt.

## Schritt 9 – `verify.js` und Rückfallkette

**Tests:** Option `forceFail: { tier3: true }` erzwingt Rückfall auf Stufe 2; `{ tier3, tier2 }` → Stufe 1; `{ tier3, tier2, tier1 }` → `offen` mit Warnung. Jeder Rückfall steht im `Result` (`fallbackReasons`) und das erzeugte STEP ist in OpenCascade gültig (außer `offen`, dort: offene Schale lesbar, `validate_step.py` mit `erwarte_offen`). Rückfall je Region: abgelehnter Zylinderkandidat → Ebenenstücke, Gesamtstufe bleibt 3.
**Prüfungen:** SPEC 5.9, Schwellen als Optionen.
**Abnahme:** `defekt-zweikoerper.stl`: 2 Solids, Gesamtvolumen stimmt – **nicht** auf eine Schale reduziert (Regressionstest für den Prototyp-Fehler).

## Schritt 10 – Oberfläche

Erst jetzt `STL-zu-STEP/index.html`, `css/app.css`, `favicon.svg`, `js/main.js`, `js/worker.js`, `js/ui/*`.
- Aufbau/Stil wie `Text-Generator/index.html` (Kopfleiste, `shared/css/ui.css`, Hell/Dunkel über `3d-druck.theme`); three.js per Importmap wie dort.
- `worker.js` führt `pipeline.convert` aus (Modul-Worker), meldet Fortschritt je Schritt; Abbruch-Knopf beendet den Worker.
- SPEC 6 vollständig (Ablegen, Vorschau, Bericht, Optionen, Export, Warnungen).
- Karte auf der Übersichtsseite `index.html`, Eintrag in der Wurzel-`README.md` (Tabelle + Aufbau), `STL-zu-STEP/README.md` (Anleitung, deutsch, mit Screenshot unter `docs/screenshot.png`).
- In den Cloud-Sitzungen ist Chromium vorinstalliert (`/opt/pw-browsers`, Playwright dort konfiguriert; sonst außerhalb des Repos installieren): Selbsttest, der `platte.stl` hineinlegt, den Export auslöst und die STEP-Datei im Test prüft (Größe, Beginn `ISO-10303-21;`). Kein neues npm-Paket im Repo: Skript unter `tests/tools/`.
- Barrierefreiheit: SPEC 6 letzter Absatz.
**Abnahme:** Lokal `npm start`, Datei per Drag & Drop, Export, Datei in OpenCascade gültig; auf Pages unter `/3D-Druck/STL-zu-STEP/`.

## Schritt 11 – Realitätstest (Pflicht vor „fertig")

*Stand 15.10.2026: Teil 1 erledigt mit sieben öffentlichen Modellen (`tests/tools/measure.mjs`, Ergebnisse in MACHBARKEIT 7). Teil 2 – die Dateien des Auftraggebers und das Öffnen in CAD – steht aus.*

Die Testsammlung ist synthetisch. **Der Auftraggeber liefert 5–10 echte STL-Dateien** (Thingiverse/Printables: Halterung mit Bohrungen, Gehäuse, ein Scan, ein organisches Teil, eine sehr große Datei). Für jede Datei:
1. Konvertieren, Bericht lesen: Stufe, Zahl der Reparaturen, erkannte Merkmale.
2. In Fusion 360 oder FreeCAD öffnen (Auftraggeber): geöffnet? Bohrung verschiebbar?
3. Jeden Fehlschlag als Fixture mit Test (rot) aufnehmen, dann beheben – **nie** Schwellen lockern, nur um eine Datei durchzubringen, ohne Test dafür.
4. Messwerte (Dauer, Dreiecke, Stufe) in `MACHBARKEIT.md` Abschnitt 7 nachtragen.

## Phase 2 (nicht jetzt)

Kegel, Kugel, Torus-Erkennung; schräge Kappen (Ellipsen); Winding-Number-/Voxel-Notanker für hoffnungslos kaputte Netze; Hohlräume (Innenschalen) als Solid-Schalen; Radien-Einrasten auf Normmaße; Slicer-Übergabe (Bambu Studio); 3MF-Eingabe.

---

## Definition of Done (Phase 1)

- [x] Alle Zeilen der Abnahmetabelle (SPEC 7) grün, `npm test` und `npm run validate:stl` grün, CI-Dateien ergänzt (Jobs `stl-unit`, `stl-exports`).
- [x] Bericht nennt jede Reparatur und jeden Rückfall mit Zahl; jeder Fehlschlag einer Stufe landet als Grund im Ergebnis (`tests/fallback.test.mjs`).
- [~] **Realitätstest (Schritt 11):** sieben öffentliche Modelle gemessen, fünf gefundene Fehler behoben und abgesichert (MACHBARKEIT 7). Offen: echte Druckteile des Auftraggebers und der Test in Fusion 360 / FreeCAD.
- [x] README, Übersichtskarte, Wurzel-README aktualisiert; `index.html` vorhanden, damit Pages den Ordner veröffentlicht.
- [x] `SPEC.md`/`MACHBARKEIT.md` spiegeln, was tatsächlich gebaut wurde (Abweichungen mit Messwert nachgetragen).
