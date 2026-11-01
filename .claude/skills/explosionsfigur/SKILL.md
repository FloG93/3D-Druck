---
name: explosionsfigur
description: Baut eine Maschine oder ein Bauteil (Drehmaschine, Bohrmaschine, Fräse, Getriebe, Spannfutter, Ventil …) als interaktive isometrische Explosionsdarstellung im festen Stil der 3D-Drucker-Figur in Anatomie/. Knopf zerlegt die Maschine und setzt sie Baugruppe für Baugruppe wieder zusammen, mit Legende, Nummern, Erklärzeile, Hell/Dunkel und Kontrastregler. Benutzen bei "Explosionszeichnung", "Explosionsdarstellung", "wie die 3D-Drucker-Animation", "isometrische Darstellung von <Maschine>", "Anatomie-Figur" oder jeder neuen Figur unter Anatomie*/. Enthält die schon getroffenen Entscheidungen, damit sie nicht neu erfragt werden.
---

# Explosionsfigur

Ein Rezept, kein Werkzeug. Es hält fest, was beim XY-Drucker (`Anatomie/`) entschieden und
gelernt wurde, damit jede weitere Figur im selben Stil und ohne denselben Fragenkatalog entsteht.
Gezeichnet wird mit dem Agent Skill **`anatomy`** (`.claude/skills/anatomy/`); dieses Dokument
sagt, **was** damit gebaut wird und **in welcher Reihenfolge**. Die Vorlage ist
`Anatomie/tests/tools/build-figur.mjs`.

## Auftrag in vier Zeilen

Alles andere steht unten schon fest. Wer diese Karte füllt, muss sonst nichts erklären:

```
Objekt:      <z. B. Tischbohrmaschine>, grobe Maße oder ein Modell als Vorbild
Umfang:      <ganze Maschine | nur Baugruppe X | einzelnes Bauteil>
Baugruppen:  <Liste, oder "du schlägst vor">  – das Ziel sind 8 bis 12
Anzeige:     <welche echte Größe soll die Anzeige rechnen, oder "keine">
```

**Rückfragen nur dort, wo die Karte etwas offen lässt:** Objekt unklar, Baugruppenschnitt
unklar, Ordnername. Nichts aus der Tabelle unten erneut erfragen. Abweichungen sagt die
Nutzerin oder der Nutzer von sich aus.

## Schon entschieden (nicht erneut fragen)

| Thema | Festlegung |
|---|---|
| Knopf | **„Zerlegen und zusammenbauen"**: auseinander, kurz halten, wieder zusammensetzen. Erneut startbar. Zweiter Druck oder Escape bricht ab und setzt zusammen. |
| Richtung | Entlang der Maschinenachsen, wie eine Demontage. Nicht strahlenförmig, nicht als Stapel. |
| Reihenfolge | Zerlegen außen zuerst. Zusammenbau **von innen nach außen**: das Kit dreht die Staffelung beim Schließen von selbst um (`[...order].reverse()`). |
| Feinheit | Die Baugruppen der Legende, nicht feiner. Ein Teil, das auf dem Bildschirm unter etwa 30 px bleibt, fährt mit seiner Nachbarin mit (Nummer bleibt, siehe Fallstrick 2). |
| Abstand | Großzügig, die Ansicht zoomt heraus. Das Seitenverhältnis bleibt dabei **festgenagelt** (Fallstrick 4). |
| Begleittext | Beim Zusammenbau steht in der Zeile unter der Zeichnung je Schritt Nummer, Name und Erklärsatz. Die Texte kommen aus der Legende, nichts wird doppelt geschrieben. |
| Legende | Ein Klick fährt **nur diese Baugruppe** heraus und hält sie orange. Darüberfahren zeigt nur, merkt sich nichts. |
| Beschriftung | Nummern mit Führungslinie an jeder Baugruppe, nur im auseinandergefahrenen Zustand. In **Bildschirmpixeln** dimensioniert, unter 430 px Zeichnungsbreite ausgeblendet. |
| Bewegte Funktion | Läuft die Maschine im Ruhezustand (Kopf fährt Bahn ab), **hält sie beim Zerlegen an** und läuft danach weiter. |
| Tempo | Rund 14 s gesamt: 300 ms Abstand beim Zerlegen, 950 ms beim Zusammenbau. Eine halbe Sekunde je Schritt ließ den Erklärsatz unlesbar. |
| Hervorhebung | **Hausorange** (`--accent` aus `shared/css/ui.css`). Gewählte Teile orange, Rest auf 16 % abgeblendet. Abblenden allein war auf dem Beamer nicht zu sehen. |
| Start | **Hell.** Hell/Dunkel-Taste in der Leiste über der Zeichnung. Schlüssel `3d-druck.theme`. |
| Kontrast | Regler 0–100 %, Start **45 %**, Endstufe bewusst hart. Schlüssel `3d-druck.kontrast`, Einheit 0–100, gilt für alle Seiten. Wird **vor** dem ersten Zeichnen gesetzt. |
| Lesbarkeit | Jeder Text mindestens **4,5:1**, in beiden Modi, **gemessen**. Beamer im hellen Schulraum ist der Maßstab. |
| Größen | 16:9, 16:10, 1024×768, Telefon. Kein Seitwärtsscrollen. |
| Maße | Echte Millimeter, 1 Welteinheit = 1 mm. Kamera Azimut 38°, Höhe 34°, Leinwand 900×800. |
| Schnitt | Türen, Deckel und eine Seitenwand abgenommen, damit der Mechanismus **das Thema** ist. Nebengeräte (AMS) neben die Maschine, nicht darauf. |
| Zeichnung | Keine Schrift in der Zeichnung außer den Nummern. Beschriftet wird in Legende und Zeile darunter. |
| Sprache | Oberfläche, README, Doku **Deutsch**. Code-Kommentare **Englisch** (Repo-Regel; Teilenamen und Oberflächentexte bleiben Deutsch). Commit-Betreff englisch im Imperativ. |

## Vorgehen

Die Reihenfolge ist verbindlich. Jeder Schritt hat sein Tor; erst weiter, wenn es grün ist.

1. **`anatomy` lesen** (`SKILL.md`, `references/kit.md`). Dort stehen Kamera, Körper, Lathe für
   Drehteile, Rohre, Recorder, Audit. Hier wird nichts davon neu erklärt.
2. **Maße sammeln.** Reale Größen in mm, bevor irgendetwas gezeichnet wird. Fehlt ein Maß, ist
   es eine Annahme und steht als solche in der README („Was die Figur nicht zeigt").
3. **Baugruppen festlegen: nach Montage, nicht nach Zeichengruppe.** Eine Baugruppe ist, was man
   als Ganzes ausbauen würde. Beim Drucker lag in der Zeichengruppe „corexy" auch beide Motoren
   und alle Umlenkrollen; wer nach Zeichengruppe schneidet, schickt eine Riemenschlaufe allein auf
   die Reise. Zuordnung über Teilenamen (`PIECE_BY_NAME`), nicht über die Gruppe.
4. **Geometrie bauen**, Abschnitt für Abschnitt wie in der Vorlage. Tor: `--audit` meldet
   `audit passed`, `lines.mjs` meldet `line ends: 0`.
5. **Explosion einhängen** (`MOVE`, `STAGGER`, `PIECE_OF`). Erst Achsen und Tiefen **messen**
   (Snippet unten), dann Wege wählen. Tor: `--apart` meldet `sauber`.
6. **Seite** aus der Vorlage: Legende, Erklärtexte, Anzeige, Knopf. Tor: `pruefe-figur.mjs`.
7. **Veröffentlichen**: Ordner, README, Kachel auf der Übersicht, Commit.

### Achsen und Tiefen messen, nie raten

`+x` und `+y` bringen ein Teil zum Betrachter hin, `-z` nimmt es wieder weg: ein Weg aus reinem
`-z` fährt **nach hinten**, die Baugruppe verschwindet hinter dem Rahmen. Beim Drucker saß so die
Elektronik hinter dem Sockel. Erst messen, dann `MOVE` setzen:

```js
// P is the figure's projection. Screen offset and depth for a candidate path.
const o = k.iso([0, 0, 0], P), q = k.iso(move, P);
console.log("screen dx,dy", q[0] - o[0], q[1] - o[1], "depth", k.depthOf(move, P) - k.depthOf([0, 0, 0], P));
```

Zwei Regeln dazu: Ein Sockel, der über die ganze Grundfläche reicht, macht „nach unten" nie frei
(die Z-Achse fiel durch den Sockel, auf dem sie sitzt): seitlich daran vorbei. Und jede
Baugruppe braucht **Vortrieb zum Betrachter**, sonst klebt sie an ihrer Nachbarin.

## Der Prüfkanon

| Tor | Befehl | Erwartet |
|---|---|---|
| Geometrie in Ruhe | `node <Ordner>/tests/tools/build-<name>.mjs --audit` | `audit passed` |
| Geometrie zerlegt | `… --apart` | `auseinandergefahren: sauber` |
| Linienenden | `CHROME_PATH=/opt/pw-browsers/chromium node .claude/skills/anatomy/scripts/lines.mjs <Ordner>/index.html` | `line ends: 0 of N` |
| Verhalten im Browser | `node .claude/skills/explosionsfigur/pruefe-figur.mjs http://127.0.0.1:8311/<Ordner>/` | `all checks passed` |
| Rest des Repos | `npm test` | alles grün |

`pruefe-figur.mjs` läuft in beiden Modi und prüft: Start zusammengebaut, eine Nummer je
Legendeneintrag, Legendenklick wählt und hält, Zerlegen und Rückbau, **Legende springt nicht**,
Themenwechsel und Kontrastwechsel mitten im Flug, Kontrast aller Texte, Abbruch mitten im Lauf,
keine Konsolenfehler, Telefonbreite. Es braucht Playwright außerhalb des Repos und einen
laufenden `python3 -m http.server 8311 --bind 127.0.0.1`. Es wurde gegen zwei absichtlich
wieder eingebaute Fehler geprüft und schlägt dort an.

**Messen statt ansehen.** Bilder zeigen, *dass* etwas nicht stimmt (die Baugruppe 04 als nackte
Riemenschlaufe, die Führungslinie ins Leere). Bewiesen und gefunden wurden die schweren Fehler aber
von Messungen: die kaputte Ruhelage vom Audit, der Klickfehler und der Sprung der Legende von
einem Browsertest, der blasse Text von einer Kontrastrechnung. Ein Bild, das „fast richtig"
aussieht, ist der Normalfall.

## Fallstricke aus dem Drucker

Jeder dieser Punkte ist einmal veröffentlicht worden.

1. **Zeichengruppe ≠ Baugruppe.** Siehe Vorgehen 3. Zuordnung über Teilenamen.
2. **Ein winziges Teil als eigene Baugruppe.** Die Düse misst zerlegt 24×22 Einheiten, etwa 12 px;
   ihre Führungslinie zeigte ins Leere. Sie fährt im Werkzeugkopf mit (`PIECE_OF`) und behält ihre
   **eigene Nummer** (`labelOf`, `NUM_PIECE`). Folge: zehn Baugruppen, elf Legendeneinträge.
3. **Die Maschine setzte sich nicht zusammen.** Die Bildschleife hält an, sobald die Federn
   stehen; `schedule(false)` startete sie nicht neu. Nach jedem `schedule()` ein `run()`.
4. **Die Seite sprang.** Beim Herauszoomen änderte sich das Seitenverhältnis, die Zeichnung wurde
   höher, die Legende rutschte, und ein Klick landete eine Zeile zu hoch. Das Seitenverhältnis
   von `VIEW_APART` ist auf `W/H` gesperrt.
5. **Darüberfahren darf nichts merken.** `pointerenter` rief `pick()`, das den Schlüssel
   speicherte; der Klick sah ihn als schon gewählt und hob ihn auf. Zeigen (`show`) und Merken
   (`picked`) sind getrennt.
6. **Eine Klasse, die nie gestaltet wurde.** Die Hervorhebung setzte `.dim`; keine CSS-Regel
   kannte sie. Sie hat nie etwas getan. Geprüft wird nie „Klasse gesetzt", sondern was der Browser
   danach **zeichnet**.
7. **Kein fester Tiefenschlüssel für die Explosion.** `A.recorder(P, { order, spring })` verlangt
   einen Schlüssel je Teil für alle ~1400 Zustände. Bei einem dichten Kasten gibt es den nicht
   (3563 Paare „unorderable") und der Löser **verdirbt dabei die Ruhelage**. Der Recorder bleibt
   ohne `order`/`spring`; die Seite sortiert in jedem Bild nach echter Tiefe (`KEYS` + `LIFT` ×
   Anteil). Erkennbar am Audit mit Fehlern bei `share 0`. Prüfung: Zeichenreihenfolge in Ruhe
   gegen die Fassung davor vergleichen, nicht Pixel (Knopf und Nummern verändern die Pixel).
8. **Enden, die absichtlich frei werden.** Schleppkabel und PTFE-Schlauch lösen sich beim Zerlegen
   an einem Ende: `free: [start, end]` an der Route, sonst meldet der Audit sie als lose.
9. **Eigenbau-Dimensionierung in Zeichnungseinheiten.** Nummern waren beim Herauszoomen 7 px, auf
   dem Telefon 6 px. Größe aus der gemessenen Bildschirmbreite (`measure()`), nicht aus dem
   `viewBox`.
10. **Zu blasser Text.** `color-mix(… 72 %)` ergab 4,37:1 dunkel und 3,56:1 hell, ausgerechnet an der
    Erklärzeile. Es sind jetzt 88 %. Ein Orange für beide Modi reicht nicht: dunkel `#f2912f`,
    hell `#9a4c05`.
11. **Falsch gemessen.** `getComputedStyle` liefert auch `color(srgb 0.64 0.64 0.64 / 0.7)`, also
    Fließkommawerte; als Bytes gelesen ergab das 1,13:1. Und `getBBox()` ignoriert die eigene
    Transformation. Ein Bild während des Zusammenbaus zeigt fehlende Teile; **Zustand abfragen**,
    nicht auf eine Zeit warten.
12. **Mit `toString()` eingebettete Funktionen** nehmen ihre freien Variablen nicht mit
    (`SUN`/`MOON`, `themeGlyph`). Der Klick lief in einen `ReferenceError`, den kein Bild zeigt.
    Auch die Reihenfolge zählt: `themeGlyph` muss **vor** `live` stehen.
13. **Thema und Kontrast vor dem ersten Zeichnen** setzen (Startskript im `<body>`), sonst blitzt
    die 650-kB-Zeichnung einmal in der falschen Stufe. Beim Themenwechsel die Töne neu rechnen:
    sie stehen als Inline-Werte am Körper und überleben den Wechsel sonst falsch.
14. **`Number(null)` ist 0.** Ein leerer Speicher setzte den Regler auf 0 statt 45.
15. **Mehrere lange Läufe gleichzeitig** hungern sich aus (zwei Kerne). Immer nur einen Build oder
    Audit, und Prozesse **über die PID** beenden: `pkill -f <muster>` traf die eigene Shell.

## Fallstricke aus der Bohrmaschine

Diese vier kosteten zusammen vier Audit-Durchläufe und 160 gemeldete Probleme.

16. **Nie einen Ring um einen gezeichneten Zylinder, nie einen Zylinder durch eine gezeichnete
    Platte.** Beide stehen voreinander auf der einen und dahinter auf der anderen Seite; kein
    Malschlüssel ordnet das, und der Audit meldet jedes solche Paar als `cycle`. Das ist mit
    Abstand die häufigste Ursache: 160 der ersten 160 Meldungen waren davon. Die Gegenmittel sind
    immer dieselben — die Säule an **jeder** Schelle schneiden und das verdeckte Stück gar nicht
    zeichnen; die Spindel nur dort zeichnen, wo sie wirklich zu sehen ist; eine runde Schelle durch
    einen **Klemmblock mit flachen Anschlussflächen** ersetzen, damit Arm, Lasche und Kurbel auf
    eine Ebene treffen statt auf einen Mantel; eine umlaufende Kammerwand in **vier einzelne
    Wände** teilen; und eine Stange, deren sichtbare Länge sich ändert, als **eine** Stange aus
    ihrer Führung bauen (`G.rodOut` mit `holdStill`), nie als mehrere Kopien.
17. **Die Verbindungskante einer gebohrten Platte ist Oberfläche.** Ein Grundriss mit Loch wird als
    ein Ring gereicht (Außenkontur, dann das Loch rückwärts). Die Kante, die beide verbindet, tastet
    der Audit als echte Fläche ab — und wenn sie quer durch das Loch läuft, meldet er den Guss als
    3,4 mm **in** der Säule, die seine Bohrung hält, und findet gleichzeitig den Klemmblock nicht,
    der an seiner eigenen Lasche sitzt. Den Außenring so drehen, dass er am lochnächsten Punkt
    beginnt, das Loch an derselben Richtung beginnen lassen und beide Enden doppeln
    (`[...o, o[0], ...loch, loch[0]]`): dann ist der Schlitz entartet und läuft radial.
18. **Eine Bohrung mit Spiel trägt nichts.** Eine Bohrung 0,6 mm weiter als die Säule ist eine
    Bohrung, in der die Säule hängt: der Audit fand keinen Kontakt und meldete die halbe Maschine —
    69 Teile — als nicht abgestützt. Jede Bohrung auf das Maß dessen schneiden, was sie hält.
    Dasselbe gilt für den Riemen: er muss die Scheibe wirklich berühren (0,15 ist die Schwelle),
    sonst hängt er in der Luft.
19. **Ein Teil neben der Maschine braucht einen eigenen Boden.** Die abgenommene Haube liegt auf
    der Werkbank, und die Werkbank ist nicht gezeichnet. Ohne `ground: true` (oder einen Namen, der
    mit `stand.` beginnt) hängt sie samt allem, was auf ihr sitzt, in der Luft.
20. **Eine Kammerwand so hoch wie ihr Inhalt verdeckt ihn.** Die erste Riemenkammer war 112 mm hoch
    und die Stufenscheiben 92 — zu sehen war nichts, worum es geht. Bei jedem Gehäuse, das den
    Mechanismus umgibt, nach dem ersten Bild prüfen, ob er überhaupt zu sehen ist: niedriger Rand,
    und was darüber muss (hier die Motorplatte), auf einen eigenen Bock stellen.

## Veröffentlichen

- **Ordner:** `Anatomie-<Objekt>/` auf oberster Ebene (z. B. `Anatomie-Drehmaschine/`). `pages.yml`
  veröffentlicht jeden Ordner mit `index.html` und lässt `tests/` und `README.md` weg, es muss
  nichts am Workflow geändert werden.
- **Inhalt:** `index.html` (erzeugt), `favicon.svg`, `README.md` (Deutsch, mit „Neu erzeugen"
  und „Was die Figur nicht zeigt"), `tests/tools/build-<objekt>.mjs`.
- **`index.html` erst committen, wenn die Seite vorzeigbar ist** (Repo-Regel, die Seite geht sofort live).
- **Kachel** auf der Übersicht (`index.html` im Wurzelordner): die Anatomie-Kachel kopieren,
  Vorschau-SVG neu zeichnen, Buttons „Ansehen" und „Hintergrund".
- Der Build schreibt die Seite direkt. Nach der Änderung `--audit`, `--apart`, `lines.mjs`,
  `pruefe-figur.mjs`, `npm test`, dann Commit.

## Für andere Maschinen

Die Bohrmaschine ist gebaut, der Rest ist Ansatz: beim ersten Umsetzen prüfen und diesen
Abschnitt korrigieren, so wie es für die Bohrmaschine geschehen ist.

- **Grundsatz aus dem Kit:** jede Zahl, die die Figur zeigt, kommt aus demselben Modell, das die
  Teile bewegt. Beim Drucker ist das `A = X + Y`, `B = X − Y`. Eine Anzeige ohne Modell ist
  Dekoration.
- **Drehmaschine:** Bett, Spindelstock mit Futter, Reitstock, Support (Längs- und Quer­schlitten),
  Werkzeughalter, Leitspindel. Explosion entlang der Spindelachse. Drehteile mit `lathe.mjs`.
  Anzeige: Drehzahl `n` und Schnittgeschwindigkeit `v = π · d · n`.
- **Bohrmaschine: gebaut**, siehe `Anatomie-Bohrmaschine/`. Zwölf Baugruppen, dreizehn Nummern
  (der Bohrer fährt im Futter mit und behält seine Nummer). Anzeige: Drehzahl je Riemenstufe aus
  zwei gegenläufig gekegelten Stufenscheiben, deren Paare immer dieselbe Summe ergeben, dazu die
  Schnittgeschwindigkeit am Bohrer. Die beiden Scheiben fahren in entgegengesetzte Richtungen
  heraus und kommen nebeneinander zur Ruhe — dort liest man das Verhältnis ab.
- **Fräsmaschine:** Konsole, Kreuztisch, Spindelkopf, Säule. Anzeige: Vorschub aus Drehzahl,
  Zähnezahl und Zahnvorschub.
- **Einzelbauteil** (Getriebe, Spannfutter, Schraubstock): 5 bis 8 Baugruppen. Explosion entlang
  der **Montagerichtung** (Schraub- oder Steckrichtung), Reihenfolge ist die Montagefolge. Fehlt
  eine bewegte Funktion, trägt die Anzeige den aktuellen Montageschritt.

## Offen und bekannte Grenzen

- **Zwei Figuren, ein Gerüst.** Das Allgemeine steht seit der Bohrmaschine in
  `figur-kit.mjs` neben dieser Datei: Kontrastleiter, Hell/Dunkel, Leiste über der Zeichnung,
  Explosionsfedern, Nummern mit Führungslinie, Legende, Tiefensortierung je Bild, Boot-Skript und
  die Berichte `--names`, `--pieces`, `--apart`. Beide Figuren hängen daran, eine Behebung gilt
  für beide. Beim Umbau blieb die Zeichnung des Druckers byte-gleich und seine
  Zeichenreihenfolge in Ruhe unverändert — das ist die Gegenprobe, die ein solcher Umbau
  schuldet, zusammen mit `--audit` und `pruefe-figur.mjs`.
  Die Figur liefert Geometrie, `MOVE`/`STAGGER`/`SPRING`, Legende und ihren eigenen Mechanismus
  über vier Haken (`figStep`, `figDraw`, `figHold`, `figPause`) und ruft `run()` und `held()`;
  alles andere kommt aus `F.pageOf({...})`. Der Drucker ist die kürzere Vorlage dafür.
- **Durchdringung im Flug nicht geprüft.** `--audit` und `--apart` decken Ruhelage und zerlegten
  Zustand ab, nicht die ~4 s dazwischen. Mehr kann der Audit nicht, ohne die Ruhelage zu verderben
  (Fallstrick 7).
- **Sammlung offen:** mehrere Figuren als eigene Kacheln füllen die Übersicht. Ob sie unter einer
  Kachel „Anatomie" mit Unterseiten wohnen sollen, ist nicht entschieden und würde `pages.yml` und
  den bestehenden Link `/Anatomie/` berühren.
- **Echte Touch-Geräte und echte Beamer** sind nicht geprüft.
