# Wie eine Tischbohrmaschine arbeitet

Eine isometrische Zeichnung zum Ansehen, kein Werkzeug: eine **Tischbohrmaschine**
mit abgenommener Riemenhaube, die vor der Maschine auf der Werkbank liegt. Auf dem
Kopf würde sie genau das verdecken, worum es geht — die beiden gegenläufig
gekegelten Stufenscheiben. 138 Teile.

## Was die Anzeige rechnet

Der Motor dreht immer dieselben **1400 min⁻¹** (vierpolig, 50 Hz). Alles, was die
Maschine an Drehzahlen kann, macht erst der Riemen daraus:

    n = 1400 · d(Motor) / d(Spindel)

Die vier Stufenpaare sind so gewählt, dass die Summe beider Durchmesser immer
139 mm ergibt — deshalb passt **ein einziger Keilriemen** auf alle vier Stufen:

| Stufe | Motor | Spindel | Summe | Drehzahl | v bei Ø 10 mm |
|---|---|---|---|---|---|
| 1 (oben)  | 44 mm | 95 mm | 139 mm | 648 min⁻¹  | 20 m/min |
| 2         | 61 mm | 78 mm | 139 mm | 1095 min⁻¹ | 34 m/min |
| 3         | 78 mm | 61 mm | 139 mm | 1790 min⁻¹ | 56 m/min |
| 4 (unten) | 95 mm | 44 mm | 139 mm | 3023 min⁻¹ | 95 m/min |

Der Zeiger über der Zeichnung legt den Riemen auf eine andere Stufe; die
Pfeiltasten tun dasselbe. Der Riemen springt sichtbar auf das gewählte
Stufenpaar, und die Anzeige nennt Drehzahl **und** Schnittgeschwindigkeit
v = π · d · n am Umfang des eingespannten 10-mm-Bohrers. Die Marke auf der
Spindelscheibe dreht sich im Verhältnis der vier echten Drehzahlen, zehnfach
verlangsamt — bei 3023 min⁻¹ wäre eine Marke in echter Geschwindigkeit nur
ein Streifen.

Im Leerlauf bohrt die Maschine: die Pinole fährt 32 mm herunter, durch die
25 mm dicke Stahlplatte im Schraubstock, und die Rückholfeder zieht sie wieder
hoch. Genau 32 mm sind es, weil die untere Mutter auf der Tiefenstange so weit
über der Konsole steht. Beim Zerlegen hält das an und läuft danach weiter.

## Die Legende

Unter der Zeichnung stehen dreizehn Einträge. Wer einen anfährt, sieht nur noch
dessen Teile; der Rest tritt zurück, und darunter steht in einem Satz, was die
Baugruppe tut. Die gewählte Baugruppe steht in Orange. Ein Klick fährt sie
allein heraus und hält sie dort — zum Betrachten in Ruhe, wenn der Durchlauf zu
schnell war.

Hell und Dunkel folgen der Übersichtsseite; Thema und Kontrast lassen sich auch
mitten im Lauf umstellen, ohne dass die Teile zurückspringen. Alle
Beschriftungen halten in beiden Modi mindestens 4,5:1 — nachgemessen, nicht
geschätzt.

## Zerlegen und zusammenbauen

Links über der Zeichnung steht **„Zerlegen und zusammenbauen"**. Die Maschine
fährt in zwölf Baugruppen auseinander — entlang ihrer eigenen Achsen, nicht
strahlenförmig —, hält kurz still und setzt sich dann von innen nach außen
wieder zusammen: Fußplatte, Säule, Bohrtisch, Bohrkopf, Pinole, Vorschub,
Spindelscheibe, Bohrfutter, Motor, Motorscheibe, Keilriemen und zuletzt die
Haube. Jede einfahrende Baugruppe wird unter der Zeichnung benannt und erklärt.
Ein zweiter Druck oder Escape bricht ab und setzt zusammen.

Die beiden Stufenscheiben fahren in **entgegengesetzte Richtungen** heraus — die
des Motors nach unten von ihrer Welle, die der Spindel nach oben von der Spindel,
so wie sie wirklich abgehen — und kommen nebeneinander vor der Maschine zur Ruhe.
Dort liegen ihre gespiegelten Stufen nebeneinander, und man sieht, warum sich das
Übersetzungsverhältnis von Stufe zu Stufe umkehrt.

Im auseinandergefahrenen Zustand tragen die Baugruppen ihre Legendennummer mit
Führungslinie. Der Bohrer ist mit 10 mm Durchmesser zu dünn, um allein zu stehen
(etwa 7 px), und sitzt konstruktiv im Futter; er fährt deshalb mit ihm, behält
aber seine eigene Nummer 12. Die Reihenfolge steht in `STAGGER`, die Fluchtwege
in `MOVE`, die Federn in `SPRING` — dieselben Zahlen liest der Prüfer, damit
Seite und Prüfung nicht auseinanderlaufen können.

## Neu erzeugen

Die Seite ist erzeugt, nicht von Hand geschrieben:

    node Anatomie-Bohrmaschine/tests/tools/build-bohrmaschine.mjs             # schreibt index.html
    node Anatomie-Bohrmaschine/tests/tools/build-bohrmaschine.mjs --audit     # prüft die Geometrie
    node Anatomie-Bohrmaschine/tests/tools/build-bohrmaschine.mjs --apart     # Geometrie auseinandergefahren
    node Anatomie-Bohrmaschine/tests/tools/build-bohrmaschine.mjs --names     # was in welcher Baugruppe steckt
    node Anatomie-Bohrmaschine/tests/tools/build-bohrmaschine.mjs --drehzahl  # die vier Stufen nachrechnen
    node Anatomie-Bohrmaschine/tests/tools/build-bohrmaschine.mjs --wege      # die Fluchtwege nachmessen

`--audit` prüft die Ruhelage und ist das Tor; `--apart` prüft zusätzlich den
auseinandergefahrenen Zustand. Dass keine Linie im Nichts endet, prüft

    node .claude/skills/anatomy/scripts/lines.mjs Anatomie-Bohrmaschine/index.html

und das Verhalten im Browser (in beiden Modi, auf Telefonbreite, mit Kontrast­rechnung)

    python3 -m http.server 8311 --bind 127.0.0.1 &
    node .claude/skills/explosionsfigur/pruefe-figur.mjs http://127.0.0.1:8311/Anatomie-Bohrmaschine/

Gezeichnet wird mit dem Agent Skill `anatomy` unter `.claude/skills/anatomy/`.
Das Gerüst — Explosion, Nummern, Legende, Hell/Dunkel, Kontrastregler — teilt
sich diese Figur mit dem XY-Drucker in `../Anatomie/`; es steht in
`.claude/skills/explosionsfigur/figur-kit.mjs`. Eine Fehlerbehebung dort gilt
für beide Figuren.

### Eine Regel entscheidet die halbe Geometrie

**Nie einen Ring um einen gezeichneten Zylinder, nie einen Zylinder durch eine
gezeichnete Platte.** Beide stehen voreinander auf der einen und dahinter auf der
anderen Seite; kein Malschlüssel kann das ordnen, und der Prüfer meldet es als
Zyklus. Deshalb ist die Säule an jeder Schelle geschnitten, die Spindel nur dort
gezeichnet, wo sie wirklich zu sehen ist, die Tischschelle ein Klemmblock mit
flachen Anschlussflächen statt einer runden Schelle, und die Riemenkammer besteht
aus vier einzelnen Wänden statt aus einem Ring. Die Pinole ist eine einzige
Stange aus ihrer Führung (`G.rodOut`), an der Führungsfläche beschnitten, damit
ihre sichtbare Länge mit dem Vorschub wächst statt aus Kopien zu bestehen.

## Was die Figur nicht zeigt

Die Maße sind die einer mittleren Maschine mit 13-mm-Futter und als **Annahmen**
gesetzt, nicht von einem bestimmten Gerät abgenommen: Fußplatte 356 × 288 mm,
Säule 62 mm, Ausladung 107 mm, Pinolenhub 56 mm, Bohrtisch 208 × 190 mm. Die vier
Stufendurchmesser sind frei gewählt, aber in sich stimmig (Summe überall 139 mm);
reale Maschinen liegen mit 620/1100/1700/2600 min⁻¹ in derselben Größenordnung.

Die Riemenhaube liegt abgenommen **vor** der Maschine statt aufgeklappt auf ihr:
aufgeklappt stünde sie je nach Winkel im Motor oder würde die Zeichnung um einen
Dritteil höher machen, und zugeklappt verdeckt sie genau den Mechanismus.

Die Spindel ist nur dort gezeichnet, wo sie an der echten Maschine zu sehen ist —
zwischen Pinolenbund und Bohrfutter. Innerhalb der Pinole, des Kopfes und der
Stufenscheibe läuft sie verdeckt; die Figur schneidet sie nicht auf.

Beim Zerlegen prüft der Prüfer die **Ruhelage** und den **auseinandergefahrenen
Zustand**, nicht die Sekunden dazwischen. Eine Schelle, die seitlich von der
Säule abfährt, geht auf diesem Weg durch sie hindurch — in Wirklichkeit löst man
die Klemmung und zieht sie über das Ende ab. Dasselbe gilt für die Stufenscheiben
auf ihren Wellen. Das ist eine bekannte Grenze des Verfahrens und steht so auch
im Skill.
