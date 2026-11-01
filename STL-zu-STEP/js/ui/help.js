// Help dialog: what the tool does, what the tiers mean and what to do when
// the result is not what the user hoped for.

import { h } from '../../../shared/js/controls.js';

export function showHelp(dialog) {
  if (dialog.dataset.filled !== '1') {
    dialog.append(h('div', { class: 'dialog-inner' },
      h('div', { class: 'dialog-head' }, h('h2', {}, 'Hilfe')),
      h('div', { class: 'dialog-body', html: `
        <p>Ein STL ist ein <b>Dreiecksnetz</b>: tausende Facetten ohne Bohrungen, Radien oder Maße. CAD-Programme können das
        kaum bearbeiten. Dieses Werkzeug baut daraus einen <b>STEP-Volumenkörper</b> und erkennt dabei Ebenen und Zylinder –
        damit eine Bohrung wieder eine Bohrung ist.</p>

        <h3>So geht es</h3>
        <ol>
          <li>STL-, OBJ- oder 3MF-Datei ablegen oder auswählen.</li>
          <li>Den Bericht lesen: Reparaturen, erreichte Stufe, erkannte Merkmale.</li>
          <li>Auf <b>Exportieren</b> klicken und die <code>.step</code>-Datei herunterladen.</li>
        </ol>
        <p>Mit <b>Zurück</b> (oben links, Taste <kbd>Esc</kbd>) brichst du die Umwandlung ab und kommst zum Startbildschirm
        zurück; die Datei und das Ergebnis werden dabei verworfen.</p>

        <h3>3MF-Dateien</h3>
        <p>Eine 3MF-Datei ist die Druckdatei der Slicer (Bambu Studio, PrusaSlicer, Cura, Fusion 360). Das Werkzeug liest
        alle Bauteile der Bauliste, rechnet <b>Einheit</b> und <b>Transformationen</b> (verschoben, gedreht, skaliert,
        gespiegelt, verschachtelte Komponenten) ein und macht aus jedem Körper einen Volumenkörper. Der Bericht listet
        jedes Objekt mit Dreiecken, Größe und Volumen. <b>Nicht übernommen</b> werden Stützstrukturen, Hilfskörper,
        Modifizierer, Negativteile und als „nicht druckbar“ markierte Teile – jedes mit Grund im Bericht. Farben und
        Materialien werden nicht gelesen.</p>

        <h3>Die drei Stufen</h3>
        <ul>
          <li><b>Stufe 3</b> – Ebenen und echte Zylinder. Der Normalfall und das Ziel: Bohrungen und Rundungen sind
            Zylinderflächen, die Datei ist klein, CAD rechnet schnell.</li>
          <li><b>Stufe 2</b> – ebene Flächen verschmolzen, gekrümmte Stellen bleiben Facetten. Rückfall, wenn kein Zylinder
            sicher erkannt wurde (Kugel, Torus, Freiform).</li>
          <li><b>Stufe 1</b> – jedes Dreieck eine eigene Fläche. Immer möglich, aber groß und in CAD langsam.</li>
          <li><b>offene Schale</b> – das Netz ließ sich nicht schließen (zum Beispiel ein Loch mit mehr als 64 Kanten).
            Das Ergebnis ist kein Körper; der Bericht sagt, woran es lag.</li>
        </ul>
        <p>Das Werkzeug nimmt immer die höchste Stufe, die die eigene Prüfung besteht. Jeder Rückfall steht mit Grund im
        Bericht – stillschweigend passiert nichts.</p>

        <h3>Wenn etwas fehlt</h3>
        <ul>
          <li><b>Loch als Vieleck statt Zylinder:</b> Ab 12 Facetten je Vollkreis ist die Erkennung sicher, bei 8 bis 11
            fragt das Werkzeug nach („Als Zylinder übernehmen“). Unter 8 Facetten ist ein Sechseck wahrscheinlich wirklich
            ein Sechseck.</li>
          <li><b>Radius minimal zu klein:</b> Bei unterteilten Netzen liegen die Punkte auf den Sehnen, nicht auf dem
            Kreis. Der Bericht nennt die Unsicherheit; „Radien runden“ rastet auf 0,05 mm ein.</li>
          <li><b>Kugel, Kegel, Torus:</b> werden in dieser Fassung nicht erkannt und bleiben Facetten (Stufe 2).</li>
          <li><b>Zoll-Dateien:</b> Einheit auf „Zoll“ stellen. Eine Warnung erscheint, wenn das Teil verdächtig groß oder
            klein ist.</li>
          <li><b>Scan mit Rauschen:</b> „Grobe Toleranz“ einschalten.</li>
        </ul>

        <h3>Datenschutz</h3>
        <p>Die Umwandlung läuft vollständig im Browser. Die Datei verlässt den Rechner nicht, es gibt keinen Server und
        keine Anmeldung.</p>
      ` }),
      h('div', { class: 'dialog-foot' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => dialog.close() }, 'Alles klar'))));
    dialog.dataset.filled = '1';
  }
  dialog.showModal();
}
