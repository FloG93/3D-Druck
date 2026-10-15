# Testsammlung

Erzeugt von `../tools/make_fixtures.py` (deterministisch, OpenCascade). `expected.json` nennt je Datei die Wahrheit: exaktes `volumen` des Teils, `netzvolumen` der Datei, Zahl der Körper, Ebenen und Zylinder. Beschreibung der Defekte: siehe `beschreibung` je Eintrag und `../../docs/MACHBARKEIT.md` Abschnitt 3.

Neue echte Problemdateien (Realitätstest, PLAN Schritt 11) hier ablegen und in `expected.json` ergänzen – ohne Eintrag bei `volumen`, wenn die Wahrheit unbekannt ist; der Test prüft dann nur Gültigkeit und Volumen gegen das Netz.
