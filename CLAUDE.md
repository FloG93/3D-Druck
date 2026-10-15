# CLAUDE.md

Web-Werkzeuge für den 3D-Druck: `MusterGenerator/`, `Text-Generator/`, `STL-zu-STEP/`. Übersicht und Aufbau: `README.md`. Gemeinsamer Code: `shared/`.

## Regeln, die überall gelten

- Reines HTML/CSS/JavaScript (ES-Module), **kein Build-Schritt, keine npm-Pakete im Repo**. Hilfsprogramme (Python, OpenCascade, Playwright) nur in `<Werkzeug>/tests/tools/` und außerhalb des Repos installiert.
- Code-Kommentare auf **Englisch**, Dokumentation, README und Oberfläche auf **Deutsch**. Commit-Betreff englisch im Imperativ.
- Nur relative Pfade (läuft lokal mit `python3 -m http.server` und auf GitHub Pages). Design und Bedienelemente aus `shared/`.
- Jeder Ordner mit einer `index.html` wird von `pages.yml` veröffentlicht: **`index.html` erst anlegen, wenn die Seite vorzeigbar ist.**
- Browser-Speicher: Schlüssel mit dem Werkzeugnamen beginnen (`stl-zu-step.…`), Hell/Dunkel steht in `3d-druck.theme`.
- Tests: `npm test` (Node ≥ 22, `node --test`); Exporte werden zusätzlich mit OpenCascade geprüft (`pip install cadquery-ocp`). Vor jedem Commit laufen lassen.
- STEP-Dateien schreibt `shared/js/step.js` (`StepWriter`); Konventionen: jede Kante genau zweimal gegenläufig, volle Kreise in Hälften, ein Eckpunkt = ein `VERTEX_POINT`.

## STL-zu-STEP

**Vor jeder Arbeit lesen:** `STL-zu-STEP/docs/PLAN.md` (nächster Schritt), `SPEC.md`, `MACHBARKEIT.md`. Die Reihenfolge der Schritte im Plan ist verbindlich. Schritte 0–10 sind gebaut; offen ist Schritt 11 (Realitätstest mit echten Dateien).

- Python-Prototypen in `STL-zu-STEP/docs/referenz/` sind der Maßstab für Zahlen; Abweichungen zuerst erklären, dann erst ändern.
- Testsammlung `STL-zu-STEP/tests/fixtures/` (`expected.json` = Wahrheit). Neue Fehlerfälle werden Fixtures, **bevor** sie behoben werden.
- Nichts darf stillschweigend verloren gehen oder repariert werden: jede Reparatur, jedes Verwerfen eines Merkmals und jeder Rückfall der Stufe steht mit Zahl im Bericht. Ein Ergebnis, dessen Volumen nicht zum Netz passt, ist schlimmer als kein Ergebnis.
- Erkennung nur mit Gegenhypothesen (Länge, Radius-Konstanz, Kugelprobe mit Punkten **und** Normalen). Schwellen nicht lockern, um eine Datei durchzubringen, ohne Test dafür.
- Unsicheres (8-Eck vs. Zylinder) bestätigt der Nutzer; Standard ist aus.
