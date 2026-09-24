// Help dialog (German quick guide).

import { icon } from './icons.js';

const REPO_URL = 'https://github.com/FloG93/3D-Druck';

const HTML = `
<div class="dialog-inner">
  <div class="dialog-head">
    <h2>Kurzanleitung</h2>
    <button type="button" class="icon-btn" data-close title="Schließen">${icon('close')}</button>
  </div>
  <div class="dialog-body">
    <h3>In acht Schritten zum Muster</h3>
    <ul>
      <li><b>Arbeitsfläche</b>: Breite und Höhe der Fläche eingeben, auf der die Löcher sitzen sollen – z. B. die Deckelfläche aus Fusion 360.</li>
      <li><b>Begrenzung</b>: Form der Fläche (Rechteck mit Eckenradius, Ellipse/Kreis, Polygon) und <b>Randabstand</b> zu den Löchern.</li>
      <li><b>Zylinder</b>: Unter <i>Körper (3D) → Form</i> „Zylinder“ wählen und den <b>Durchmesser</b> eingeben. Die Arbeitsfläche ist dann die Abwicklung (Breite = Umfang); das Muster läuft ohne Naht rundherum, optional mit <b>Boden</b> für Becher und Stifthalter.</li>
      <li><b>Körper (3D)</b>: Die Formen als <b>Durchbrüche</b>, <b>erhaben</b> (Rippen, Noppen, Kühlrippen) oder <b>vertieft</b> (Nuten, Mulden) – mit Plattendicke, Höhe/Tiefe und <b>Flankenwinkel</b> (45° druckt ohne Stützen, schmale Formen laufen spitz zu). Die 3D-Vorschau zeigt das Ergebnis.</li>
      <li><b>Lochform</b>: Langloch/Rechteck (Eckenrundung 100 % = Langloch), Kreis/Ellipse oder Polygon (6 Ecken = Wabe).</li>
      <li><b>Anordnung</b>: Raster, versetzt/hexagonal, Ringe, Spirale oder zufällig. „Reihen-Drehung“ mit 90° abwechselnd ergibt ein Fischgrät-Muster.</li>
      <li><b>Modifikatoren</b>: Attraktoren drehen, skalieren, verschieben oder entfernen Löcher abhängig vom Abstand. Mehrere Modifikatoren wirken nacheinander (oben zuerst).</li>
      <li><b>Prüfung</b>: Die Statusleiste zeigt Lochanzahl, offene Fläche und den schmalsten Steg. Zu dünne Stege werden orange, Überlappungen rot markiert.</li>
    </ul>

    <h3>Maus &amp; Touch</h3>
    <ul>
      <li>Ziehen auf freier Fläche, mittlere Maustaste oder <kbd>Leertaste</kbd>+Ziehen: Ansicht verschieben · Mausrad / zwei Finger: Zoom</li>
      <li>Attraktor-Punkte ziehen · <kbd>Umschalt</kbd> beim Ziehen rastet auf 5 mm ein, nahe der Mittelachsen rastet es automatisch ein</li>
      <li>Ring ziehen oder <b>Mausrad über dem Attraktor</b>: Radius ändern</li>
      <li><b>Rechtsklick</b> auf einen Linien-Attraktor: Gerade ⇄ Kurve</li>
      <li><b>Doppelklick</b> auf die Fläche: neuer Punkt-Attraktor</li>
      <li>Zahlenfelder: Beschriftung seitlich ziehen ändert den Wert (<kbd>Umschalt</kbd> ×10, <kbd>Alt</kbd> fein)</li>
    </ul>

    <h3>Tastatur</h3>
    <p><kbd>Strg</kbd>+<kbd>Z</kbd> rückgängig · <kbd>Strg</kbd>+<kbd>Y</kbd> wiederholen · <kbd>Entf</kbd> Modifikator löschen · <kbd>F</kbd> Ansicht einpassen · <kbd>Esc</kbd> Auswahl aufheben · <kbd>Strg</kbd>+<kbd>S</kbd> Export</p>

    <h3>Weiter in Fusion 360</h3>
    <ul>
      <li><b>DXF</b> (empfohlen für Skizzen): <i>Einfügen → DXF einfügen</i>, Fläche oder Ebene wählen, Einheit mm. Danach <i>Extrusion</i> → alle Loch-Profile wählen → <i>Ausschneiden</i>.</li>
      <li><b>STEP – Werkzeugkörper</b>: Datei hochladen und in das Design einfügen, Körper über die Platte legen, dann <i>Ändern → Kombinieren → Ausschneiden</i> (erhabene Formen: <i>Verbinden</i>).</li>
      <li><b>Fusion-Skript</b>: Das Skript <i>MusterImport</i> liest die Fusion-JSON-Datei, zeichnet die Skizze auf einer gewählten Fläche (zentriert) und schneidet die Löcher auf Wunsch direkt aus – oder vertieft die Formen bzw. setzt sie erhaben auf, mit Flankenwinkel.</li>
      <li><b>STL</b> und <b>STEP – Platte</b> enthalten die fertige Platte mit Löchern oder Relief (STEP mit senkrechten Wänden). Beim Zylinder liefert das STL das fertige Rohr.</li>
      <li><b>Zylinder in Fusion 360</b>: Abwicklung als DXF oder per Skript (Vorgang <i>Nur Skizze</i>) auf eine Ebene tangential zur Mantelfläche legen, dann <i>Erstellen → Prägen</i> mit den Profilen und der Zylinderfläche.</li>
    </ul>

    <h3>Speichern</h3>
    <p>Das aktuelle Muster wird automatisch im Browser gespeichert. Eigene Vorlagen, Projektdateien (JSON) und der Teilen-Link <span class="inline-icon">${icon('link')}</span> sichern oder übertragen ein Muster.</p>
    <p>Quelltext, Fusion-Skript und Anleitung: <a href="${REPO_URL}" target="_blank" rel="noopener">${REPO_URL.replace('https://', '')}</a></p>
  </div>
</div>`;

export function showHelp(dialog) {
  if (!dialog.dataset.ready) {
    dialog.innerHTML = HTML;
    dialog.dataset.ready = '1';
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    });
  }
  dialog.showModal();
}
