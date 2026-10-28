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
tut. Hell und Dunkel folgen der Übersichtsseite.

## Neu erzeugen

Die Seite ist erzeugt, nicht von Hand geschrieben:

    node Anatomie/tests/tools/build-figur.mjs            # schreibt Anatomie/index.html
    node Anatomie/tests/tools/build-figur.mjs --audit    # prüft die Geometrie

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
