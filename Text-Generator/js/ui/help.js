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
      <li><b>Vorlage</b> wählen oder direkt den <b>Text</b> eintippen. Mehrere Zeilen mit Enter, <b>♥ Symbol</b> fügt Herz, Stern, Pfote &amp; Co. ein.</li>
      <li><b>Schrift</b>: sechs Schriften sind eingebaut, unter <i>Mehr …</i> gibt es alle Google Fonts mit Vorschau.</li>
      <li><b>Grundform</b> (Kontur, Rechteck, Kapsel, Oval, Kreis oder ohne Platte) und <b>Befestigung</b>: Öse, Loch, Schlitz für Band oder Clip, zwei Schraublöcher mit Senkung. Dazu auf Wunsch <b>Magnet-Taschen</b> hinten.</li>
      <li><b>Körper (3D)</b>: Schrift erhaben, vertieft oder <b>bündig</b> (zweifarbig mit glatter Oberfläche), Rand und <b>Kontur um die Schrift</b> als dritte Farbe.</li>
      <li><b>Exportieren</b> als 3MF: Platte, Schrift, Kontur und Rand sind eigene Teile mit fester Filament-Nummer – in Bambu Studio nur noch die AMS-Farben wählen. Bei flacher Oberseite wahlweise mit der Schrift nach unten.</li>
    </ol>

    <h3>Tipps für den Druck</h3>
    <ul>
      <li>Striche unter etwa <b>0,8 mm</b> (0,4-mm-Düse) werden orange markiert: Schrift größer, kräftigere Schrift oder <i>Fettung</i> erhöhen.</li>
      <li>Dicken als Vielfache der Schichthöhe (z. B. 0,2 mm) – dann wechselt die Farbe genau zwischen zwei Schichten.</li>
      <li>Mit <b>+</b> bei „Text“ kommen weitere Texte dazu (z. B. Name groß, Untertitel klein). Jeder Text lässt sich in der Vorschau mit der Maus verschieben (Shift: ohne Raster) und bekommt mit <i>Eigene Farbe</i> ein eigenes Filament.</li>
      <li>Magnete einkleben statt Druckpause: Tasche = Magnet + 0,2 mm (z. B. 6,2 × 2,2 mm für 6 × 2 mm). Über der Tasche bleiben mindestens 0,6 mm Material.</li>
      <li><b>Schrift unten</b> (Export): Die Schriftseite liegt auf dem Druckbett – glatt oder mit der Struktur der Druckplatte.</li>
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
