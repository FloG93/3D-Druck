// Help dialog (German quick guide).

import { icon } from '../../../shared/js/icons.js';

const SOURCE_URL = 'https://github.com/FloG93/3D-Druck/tree/HEAD/Text-Generator';

const HTML = `
<div class="dialog-inner">
  <div class="dialog-head">
    <h2>Kurzanleitung</h2>
    <button type="button" class="icon-btn" data-close title="Schließen">${icon('close')}</button>
  </div>
  <div class="dialog-body">
    <h3>So geht's</h3>
    <ol>
      <li><b>Vorlage</b> wählen oder direkt den <b>Text</b> eintippen. Mehrere Zeilen mit Enter, <b>♥ Symbol</b> fügt Herz, Stern, Pfote &amp; Co. ein. Unter dem Text kommen weitere Blöcke dazu: <b>+ Text</b>, <b>+ QR-Code</b> (Link oder WLAN) und <b>+ Grafik</b> (eigene SVG-Datei, z. B. ein Logo).</li>
      <li><b>Schrift</b>: sechs Schriften sind eingebaut, unter <i>Mehr …</i> gibt es alle Google Fonts mit Vorschau.</li>
      <li><b>Grundform</b> (Kontur, Rechteck, Kapsel, Oval, Kreis, <b>Becher</b> oder ohne Platte) und <b>Befestigung</b>: Öse, Loch, Schlitz für Band oder Clip, zwei Schraublöcher mit Senkung oder ein <b>Stecker</b> für Pflanzen und Torten. Dazu auf Wunsch <b>Magnet-Taschen</b> hinten.</li>
      <li><b>Körper (3D)</b>: Schrift erhaben, vertieft oder <b>bündig</b> (zweifarbig mit glatter Oberfläche), Rand und <b>Kontur um die Schrift</b> als dritte Farbe – als <b>Schablone</b> ausgeschnitten oder als <b>Stempel</b> gespiegelt.</li>
      <li><b>Exportieren</b> als 3MF: Platte, Schrift, Kontur und Rand sind eigene Teile mit fester Filament-Nummer – in Bambu Studio nur noch die AMS-Farben wählen. Bei flacher Oberseite wahlweise mit der Schrift nach unten. Für Fusion 360 gibt es <b>SVG</b> mit glatten Kurven und <b>STEP</b> mit einem Körper je Teil, für Laser und Schneideplotter <b>SVG</b> und <b>DXF</b>.</li>
    </ol>

    <h3>Schablonen</h3>
    <ul>
      <li><b>Körper → Schrift: Schablone</b> schneidet die Schrift aus der Platte – zum Sprühen, Lackieren oder Airbrushen. Die Dicke springt auf 1,2 mm (PLA/PETG: 0,8–1,5 mm).</li>
      <li>Das Innere von O, A, B, 8 … würde herausfallen: <b>Stege</b> halten es automatisch – einer oder zwei je Insel, senkrecht, waagerecht oder der kürzeste Weg. In der Vorschau sind sie etwas dunkler.</li>
      <li>Zu schmale Stege und Stellen zwischen Buchstaben werden orange markiert. Genug <b>Randabstand</b> lassen (10 mm und mehr), damit kein Sprühnebel danebengeht.</li>
      <li>Größer als das Druckbett? Die Schablone wird in <b>Teile mit Puzzle-Verbindern</b> (Schwalbenschwanz) zerlegt. Die Nähte laufen möglichst zwischen den Buchstaben, die Verbinder sitzen im vollen Material, 0,2 mm <b>Spiel</b> lassen die Teile ineinandergleiten. Die Nummern in der Vorschau zeigen die Reihenfolge; im 3MF ist jedes Teil ein eigenes Objekt. Das Druckbett wählst du unter <i>Prüfung</i>.</li>
      <li>Für einen Laser oder Schneideplotter mit Schablonenfolie: <b>DXF</b> oder <b>SVG (Umrisse)</b> – alle Schnittlinien am Stück.</li>
    </ul>

    <h3>Serie aus einer Namensliste</h3>
    <ul>
      <li>Links unter <b>Serie aus Namensliste</b> einschalten und die Namen eintragen, einen pro Zeile – mit <b>|</b> wird umbrochen („Familie | Müller“).</li>
      <li>Jeder Name ersetzt beim Export den ersten Text, alles andere bleibt. Im <b>3MF</b> ist jeder Name ein eigenes Objekt, in Reihen auf dem Druckbett angeordnet; <b>SVG</b> und <b>DXF</b> legen alle auf einen Bogen.</li>
      <li>Der Export-Dialog zeigt, wie viele Teile es werden, und warnt je Name, z. B. wenn ein langer Name nicht auf eine feste Platte passt.</li>
    </ul>

    <h3>Bogen und Kreis</h3>
    <ul>
      <li>Bei jedem Text unter <b>Form</b>: <b>Bogen</b> biegt den Text an seiner Stelle – die <b>Biegung</b> in Grad, positiv nach oben gewölbt, negativ nach unten.</li>
      <li><b>Kreis oben</b> und <b>Kreis unten</b> setzen den Text auf einen Kreis um seine Position (gestrichelt in der Vorschau). Für Münzen und Siegel: ein Text oben, einer unten, beide mit derselben Position und demselben <b>Radius</b> – der untere bleibt von links nach rechts lesbar. Vorlage: <i>Glücksmünze</i>.</li>
    </ul>

    <h3>Stempel</h3>
    <ul>
      <li><b>Körper → Stempel</b> spiegelt die Schrift, damit der Abdruck richtig herum steht. <b>Tinte</b>: 1,5 mm erhaben. <b>Keks &amp; Fondant</b>: 2,5 mm mit schrägen Flanken. <b>Ton, Seife, Leder</b>: tiefe Prägung mit schrägen Flanken.</li>
      <li><b>Schräge Flanken</b> machen die Buchstaben zur Platte hin breiter – stabiler, und sie lösen sich leichter aus Teig, Ton oder Seife.</li>
      <li>Der <b>Griff</b> ist ein eigenes Teil und wird kopfüber ohne Stützen gedruckt. Sein eckiger Zapfen steckt in der Tasche auf der Rückseite und kann sich nicht drehen; 0,15 mm <b>Spiel</b> machen ihn stramm, ein Tropfen Kleber sichert ihn.</li>
      <li>Für Lebensmittel PETG oder PLA mit Lebensmittelfreigabe nehmen, vor dem Stempeln mit Mehl bestäuben, nicht in die Spülmaschine.</li>
    </ul>

    <h3>Becher und Stifthalter</h3>
    <ul>
      <li><b>Grundform → Becher</b>: Durchmesser, Höhe und Boden eingeben. Die Vorschau zeigt die Wand <b>abgewickelt</b>: die Mitte ist vorne, links und rechts treffen sich hinten an der Naht (dort bleiben 1,5 mm frei). Schiebst du einen Text nach links oder rechts, wandert er um den Becher herum.</li>
      <li><b>Wand → Konisch</b>: Ø unten und Ø oben, z. B. für einen Übertopf. Die Vorschau bleibt ein Rechteck (Umfang auf halber Höhe); zum weiten Ende hin wird die Schrift auf dem Becher etwas breiter. SVG und DXF enthalten den genauen Zuschnitt als Kreisring-Ausschnitt.</li>
      <li>In der 3D-Ansicht steht der fertige Becher. Schrift erhaben, vertieft oder <b>bündig</b> in zweiter Farbe; der <b>Rand</b> wird zu Ringen oben und unten.</li>
      <li>Als <b>Schablone</b> wird ein <b>Windlicht</b> daraus: die Schrift ist aus der Wand geschnitten. Nur ein LED-Teelicht hineinstellen – PLA wird schon bei etwa 60 °C weich.</li>
      <li>Gedruckt wird stehend, ohne Stützen. Wand 2–2,4 mm für Stifthalter, 1,6 mm fürs Windlicht.</li>
    </ul>

    <h3>Fusion 360</h3>
    <ul>
      <li><b>Schrift auf ein eigenes Teil:</b> Export <b>SVG → Nur Schrift</b>, in Fusion <i>Einfügen → SVG einfügen</i> auf die Fläche – die Größe stimmt ohne Skalieren –, dann <i>Extrusion</i> mit <i>Verbinden</i> (erhaben) oder <i>Ausschneiden</i> (vertieft).</li>
      <li><b>Schrift auf Rundungen:</b> das SVG auf eine <i>tangentiale Ebene</i> an der runden Fläche legen und mit <i>Erstellen → Prägen</i> um die Fläche legen. Beim Becher enthält das SVG die abgewickelte Wand.</li>
      <li><b>Das ganze Teil weiterbauen:</b> Export <b>STEP</b>, in Fusion <i>Datei → Öffnen</i> oder hochladen und <i>In aktuelles Design einfügen</i>. Jedes Teil ist ein eigenes Bauteil mit Körpern in seiner Farbe, die Umrisse sind exakte Kurven (höchstens 0,01 mm vom Druckmodell entfernt).</li>
    </ul>

    <h3>Tipps für den Druck</h3>
    <ul>
      <li>Striche unter etwa <b>0,8 mm</b> (0,4-mm-Düse) werden orange markiert: Schrift größer, kräftigere Schrift oder <i>Fettung</i> erhöhen.</li>
      <li>Dicken als Vielfache der Schichthöhe (z. B. 0,2 mm) – dann wechselt die Farbe genau zwischen zwei Schichten.</li>
      <li>Mit <b>+</b> bei „Text“ kommen weitere Texte dazu (z. B. Name groß, Untertitel klein). Jeder Text lässt sich in der Vorschau mit der Maus verschieben (Shift: ohne Raster) und bekommt mit <i>Eigene Farbe</i> ein eigenes Filament.</li>
      <li>Magnete einkleben statt Druckpause: Tasche = Magnet + 0,2 mm (z. B. 6,2 × 2,2 mm für 6 × 2 mm). Über der Tasche bleiben mindestens 0,6 mm Material.</li>
      <li><b>Schrift unten</b> (Export): Die Schriftseite liegt auf dem Druckbett – glatt oder mit der Struktur der Druckplatte.</li>
      <li><b>Rückseite:</b> Bei jedem Block „Seite: Hinten“ wählen, z. B. für die Telefonnummer auf der Hundemarke. Sie wird gespiegelt in den Boden eingelegt – farbig in den ersten Schichten oder vertieft. Unten in der Vorschau zwischen <i>Vorne</i> und <i>Hinten</i> umschalten.</li>
      <li><b>QR-Codes</b> mit Modulen ab 1 mm lesen sich sicher – dunkel auf hell, bündig oder erhaben in zweiter Farbe. Runde Punkte und ein Logo in der Mitte sind möglich; mit Logo den Code etwas größer machen. Das Programm warnt bei zu kleinen Modulen und zu wenig Kontrast.</li>
      <li><b>Grafiken (SVG):</b> Dunkle Flächen und Linien werden gedruckt, weiße darauf sparen aus. Texte in der SVG vorher in Pfade umwandeln.</li>
      <li>Die Kontur verbindet getrennte Wörter automatisch mit Stegen. Mehr Randabstand macht daraus eine geschlossene Form.</li>
    </ul>

    <h3>Bedienung</h3>
    <p>Mausrad zoomt · Ziehen verschiebt die Ansicht · Doppelklick passt ein · <kbd>Strg</kbd>+<kbd>Z</kbd> rückgängig · <kbd>Strg</kbd>+<kbd>Y</kbd> wiederholen · <kbd>F</kbd> einpassen · <kbd>Strg</kbd>+<kbd>S</kbd> exportieren</p>

    <h3>Speichern</h3>
    <p>Das Design wird automatisch im Browser gespeichert. Eigene Vorlagen, Projektdateien und der Teilen-Link <span class="inline-icon">${icon('link')}</span> sichern oder übertragen es.</p>
    <p>Quelltext und Anleitung: <a href="${SOURCE_URL}" target="_blank" rel="noopener">github.com/FloG93/3D-Druck</a> (Ordner <i>Text-Generator</i>). Weitere Werkzeuge: <a href="../">Übersicht 3D-Druck-Werkzeuge</a>.</p>
  </div>
</div>`;

export function showHelp(dialog) {
  if (!dialog.dataset.built) {
    dialog.innerHTML = HTML;
    dialog.dataset.built = '1';
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
  dialog.showModal();
}
