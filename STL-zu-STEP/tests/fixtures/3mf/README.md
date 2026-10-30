# 3MF-Fixtures

Erzeugt von `tests/tools/make_3mf_fixtures.mjs` aus den STL-Fixtures; `tests/threemf.test.mjs` sagt, was jede Datei ergeben muss, und prüft, dass diese Dateien dem Skript entsprechen.

| Datei | Fall |
| --- | --- |
| wuerfel.3mf | Würfel 10 mm, ein Objekt, Millimeter |
| platte.3mf | platte.stl als 3MF: muss dieselbe Stufe 3 mit 14 Flächen geben |
| zoll.3mf | Würfel von 10 Einheiten, unit="inch": 254 mm Kantenlänge, 16 387 064 mm³ |
| zwei-instanzen.3mf | ein Objekt, zweimal in der Bauliste (verschoben): zwei Körper, Volumen doppelt |
| komponenten.3mf | Baugruppe aus zwei Komponenten (eine davon skaliert) mit verschachteltem Objekt und Transform in der Bauliste |
| gespiegelt.3mf | Würfel mit Spiegel-Transform (x → −x): die Umlaufrichtung muss mitgedreht werden, Volumen positiv |
| stuetzen-und-nicht-druckbar.3mf | Bauteil plus Stützstruktur (type="support") und ein als nicht druckbar markierter Würfel: nur das Bauteil kommt heraus |
| defekt-loch.3mf | defekt-loch.stl als 3MF: die Reparatur schließt die drei Löcher auch hier |
| bambu-stil.3mf | Layout wie Bambu Studio: Teile in 3D/Objects/, Normalteil + Negativteil + Modifizierer, Namen und Platte in model_settings.config |
| prusa-stil.3mf | Layout wie PrusaSlicer: ein Objekt mit zwei Volumen in einem Netz, das zweite ein Modifizierer (Slic3r_PE_model.config) |

Die Dateien `bambu-stil` und `prusa-stil` folgen dem dokumentierten Aufbau der beiden Slicer, wurden aber **nicht** an echten Dateien geprüft (docs/MACHBARKEIT.md Abschnitt 8).
