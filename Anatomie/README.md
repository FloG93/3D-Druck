# Wie ein XY-Drucker arbeitet

Eine isometrische Schnittzeichnung zum Ansehen, kein Werkzeug: ein geschlossener
**CoreXY**-Drucker mit abgenommener Fronttür, rechter Seitenwand und Glasdeckel,
daneben ein **Mehrfarbsystem** mit vier Spulen. 237 Teile.

Der Antrieb ist nicht gemalt, sondern gerechnet. Beide Schrittmotoren stehen fest
am Rahmen; zwei Zahnriemen laufen über je vier Rollen, die sie sichtbar
umschlingen. Bewegt man den Werkzeugkopf mit dem Zeiger, rechnet die Seite die
CoreXY-Gleichung

    A = X + Y        B = X − Y

und zeigt beide Riemenwege in Millimetern an; die Motorscheiben drehen sich um
genau diesen Betrag. Drehen beide Motoren gleich, fährt der Kopf in X; drehen sie
gegenläufig, in Y. Im Leerlauf fährt die Düse die hell gezeichnete Bahn der
laufenden Schicht ab – dieselbe Linie, die auf dem Werkstück liegt.

Unter der Zeichnung stehen elf Einträge. Wer einen anfährt, sieht nur noch dessen
Teile; der Rest tritt zurück, und darunter steht in einem Satz, was die Baugruppe
tut. Die gewählte Baugruppe steht dabei in Orange, der Rest tritt zurück.
Hell und Dunkel folgen der Übersichtsseite.

Links über der Zeichnung steht **„Zerlegen und zusammenbauen"**. Die Maschine
fährt in zehn Baugruppen auseinander – entlang ihrer eigenen Achsen, nicht
strahlenförmig –, hält kurz still und setzt sich dann von innen nach außen
wieder zusammen: erst der Rahmen, dann Elektronik, Filter, Z-Achse, Heizbett,
Antrieb, X-Träger, Werkzeugkopf, AMS und zuletzt der Filamentweg. Jede
einfahrende Baugruppe wird unter der Zeichnung benannt und erklärt. Ein zweiter
Druck oder Escape bricht ab und setzt zusammen. Ein Klick auf einen
Legendeneintrag fährt dessen Baugruppe allein heraus und hält sie orange –
zum Betrachten in Ruhe, wenn der Durchlauf zu schnell war.

Im auseinandergefahrenen Zustand tragen die Baugruppen ihre Legendennummer mit
Führungslinie. Die Düse ist mit 24 × 22 Einheiten zu klein, um allein zu stehen,
und sitzt konstruktiv im Werkzeugkopf; sie fährt deshalb mit ihm, behält aber
ihre eigene Nummer 07. Die Reihenfolge steht in `STAGGER`, die Fluchtwege in
`MOVE`, die Federn in `SPRING` – dieselben Zahlen liest der Prüfer, damit Seite
und Prüfung nicht auseinanderlaufen können.

Über der Zeichnung steht ein Kontrastregler. Er spreizt die vier Flächentöne und
die Linien von der ruhigen Voreinstellung des Kits (0 %, Flächen 1,08:1 im
Dunkeln) bis zu einer bewusst harten Endstufe (100 %, 5,59:1 im Dunkeln, 2,81:1
im Hellen). 45 % ist der Start. Die Stufe gilt für beide Modi und steht in
`3d-druck.kontrast` im Browser, also hält jedes Gerät – Schreibtisch, Laptop,
Beamer im hellen Raum – seine eigene Einstellung. Denselben Regler tragen die
Übersicht und die drei Werkzeuge (`shared/js/kontrast.js`); er wirkt dort auf
Text- und Linienfarben, der Wert gilt für alle fünf Seiten.

## Neu erzeugen

Die Seite ist erzeugt, nicht von Hand geschrieben:

    node Anatomie/tests/tools/build-figur.mjs            # schreibt Anatomie/index.html
    node Anatomie/tests/tools/build-figur.mjs --audit    # prüft die Geometrie
    node Anatomie/tests/tools/build-figur.mjs --names    # was in welcher Baugruppe steckt
    node Anatomie/tests/tools/build-figur.mjs --apart    # Geometrie im auseinandergefahrenen Zustand

`--audit` prüft die Ruhelage und ist das Tor; `--apart` prüft zusätzlich die
Geometrie im auseinandergefahrenen Zustand – Teile, die ineinanderstehen, und
Leitungsenden, die ins Leere greifen. Beide zusammen laufen in gut einer Minute.
Die Ruhelage löst `--audit` wie zuvor. Die Zeichenreihenfolge **während** der
Bewegung löst nicht der Prüfer, sondern die Seite selbst: ein fester Schlüssel
je Teil kann eine Maschine, deren Baugruppen quer durcheinanderfahren, nicht
ordnen – der Löser meldete 3563 Paare als „unorderable" und verdarb dabei die
Ruhelage. Die Seite sortiert deshalb in jedem Bild nach der echten Tiefe
(`KEYS` + `LIFT` × Anteil).

Das Skript zeichnet mit dem Agent Skill `anatomy` unter `.claude/skills/anatomy/`.
Die Prüfung misst an der echten Geometrie, ob sich Teile durchdringen, ob jede
Leitung auf einer Halterung endet, ob etwas in der Luft hängt und ob überall das
nähere Teil vorn liegt – sie muss `audit passed` melden. Dass keine Linie im
Nichts endet, prüft zusätzlich

    node .claude/skills/anatomy/scripts/lines.mjs Anatomie/index.html

## Was die Figur nicht zeigt

Die Druckplatte steht still; die Z-Achse ist als Aufbau gezeichnet, nicht
bewegt. Jede angezeigte Zahl ist live gerechnet, es wird also nichts behauptet,
was nicht stimmt. Die Riemenführung ist ein korrekter CoreXY, kein nachgebauter
P1S – Rollenlagen weichen im Detail ab. Das Mehrfarbsystem steht **neben** dem
Drucker statt darauf: auf dem Deckel würde es genau den Antrieb verdecken, um den
es geht.
