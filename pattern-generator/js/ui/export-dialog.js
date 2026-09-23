// Export dialog: format choice, options and download.

import { h, Panel, numberField, segmented, toggle } from './controls.js';
import { icon } from './icons.js';
import { downloadBlob, safeName } from './presets.js';
import { exportSVG } from '../export/svg.js';
import { exportDXF } from '../export/dxf.js';
import { exportSTEP } from '../export/step.js';
import { exportFusionJSON } from '../export/fusion.js';
import { buildPlateMesh, toBinarySTL } from '../export/mesh.js';
import { exportPNG } from '../export/png.js';
import { translateOutline, originOffset } from '../export/common.js';
import { featureNames, reliefParams, MAX_TAPER } from '../core/relief.js';

const REPO = 'https://github.com/FloG93/3D-Druck';
const SCRIPT_ZIP = 'fusion/MusterImport.zip';

const FORMATS = [
  { id: 'dxf', name: 'DXF', desc: '2D-Skizze für Fusion 360, Laser, CNC', tag: 'Empfohlen für Fusion' },
  { id: 'step', name: 'STEP', desc: '3D-Körper für Fusion 360, SolidWorks, Onshape …' },
  { id: 'fusion', name: 'Fusion-Skript', desc: 'JSON für das Skript „MusterImport“: Skizze + Schnitt automatisch' },
  { id: 'svg', name: 'SVG', desc: 'Vektorgrafik für Illustrator, Inkscape, Affinity, Laser' },
  { id: 'stl', name: 'STL', desc: 'Fertige Platte zum direkten 3D-Druck – mit Löchern oder Relief' },
  { id: 'png', name: 'PNG', desc: 'Rasterbild zur Dokumentation' },
];

const INFO = {
  dxf: `<b>In Fusion 360:</b><ol>
    <li><i>Einfügen → DXF einfügen</i>, Fläche oder Ebene wählen, Datei wählen, Einheit <b>Millimeter</b>.</li>
    <li>Mit Ursprung „Mitte“ liegt die Mustermitte auf dem Skizzenursprung – ggf. mit <i>Verschieben/Kopieren</i> auf die Flächenmitte setzen.</li>
    <li><i>Extrusion</i> → Loch-Profile per Fensterauswahl wählen → Vorgang <b>Ausschneiden</b>.
      Für Relief: <b>Verbinden</b> mit Abstand (erhaben) bzw. <b>Ausschneiden</b> mit Tiefe (vertieft), schräge Flanken über den <i>Verjüngungswinkel</i> (negativ).</li></ol>
    Die Formen liegen auf dem Layer <b>LOECHER</b>, die Begrenzung auf <b>BEGRENZUNG</b>. Enthält nur Linien, Bögen und Kreise (DXF R12).`,
  step: `<b>Werkzeugkörper:</b> je Form ein Volumenkörper. In Fusion 360 die Datei hochladen, mit <i>In aktuelles Design einfügen</i> platzieren und dann
    <i>Ändern → Kombinieren</i>: Zielkörper = Platte, Werkzeugkörper = alle Form-Körper, Vorgang <b>Ausschneiden</b> (Durchbrüche, vertieft) bzw. <b>Verbinden</b> (erhaben).<br>
    <b>Platte:</b> die fertige Platte als ein Volumenkörper – mit Löchern oder Relief, wie unter „Körper (3D)“ eingestellt.`,
  fusion: `<b>Einmalig installieren:</b> <a href="${SCRIPT_ZIP}" download>MusterImport.zip herunterladen</a> und entpacken
    (Quelle: <a href="${REPO}/tree/HEAD/fusion360/MusterImport" target="_blank" rel="noopener">GitHub</a>). In Fusion 360:
    <i>Dienstprogramme → Add-Ins → Skripte und Add-Ins</i> → „+“ → Ordner <b>MusterImport</b> wählen.<ol>
    <li>Skript ausführen und diese JSON-Datei wählen.</li>
    <li>Ebene Fläche (z. B. Deckel) oder Konstruktionsebene anklicken, Drehung/Versatz und Vorgang wählen.</li>
    <li>Das Skript zeichnet alle Formen als verbundene Skizze – zentriert auf der Fläche – und schneidet sie auf Wunsch direkt aus,
      vertieft sie oder setzt sie erhaben auf (voreingestellt wie unter „Körper (3D)“, inklusive Flankenwinkel).</li></ol>`,
  svg: 'Für Illustrator, Inkscape, Affinity, CorelDRAW oder Laser-Software. 1 SVG-Einheit = 1 mm. In Fusion 360: <i>Einfügen → SVG einfügen</i> (Maßstab 1,0). Für Konstruktionen ist DXF meist die bessere Wahl.',
  stl: 'Die Platte als Dreiecksnetz zum direkten Slicen – mit Löchern oder als Relief (erhaben/vertieft, auch mit schrägen Flanken), wie unter „Körper (3D)“ eingestellt. Für Konstruktionen in Fusion 360 besser DXF, STEP oder das Fusion-Skript verwenden.',
  png: 'Rasterbild der Platte (weiß/grau) mit dunklen Löchern, z. B. für Dokumentation oder als Vorlage.',
};

export class ExportDialog {
  constructor(dialog, app) {
    this.dialog = dialog;
    this.app = app;
    this.format = 'dxf';
    this.built = false;
  }

  build() {
    const { app } = this;
    const X = (key) => ({
      get: () => app.doc.export[key],
      set: (v) => {
        app.doc.export[key] = v;
        app.scheduleSave();
        this.refresh();
        // The 3D preview and the side panel show the plate thickness.
        if (key === 'thickness') app.changed();
      },
    });
    const R = (key) => ({
      get: () => app.doc.relief[key],
      set: (v) => {
        app.doc.relief[key] = v;
        app.changed();
        app.scheduleSave();
        this.refresh();
      },
    });
    // zPlacement null: follows the relief mode (see zPlacement()).
    this.opts = { pxPerMm: 8, background: 'white', zPlacement: null };
    const L = (key) => ({
      get: () => this.opts[key],
      set: (v) => {
        this.opts[key] = v;
        this.refresh();
      },
    });
    // Export options are not part of the undo history.
    this.panel = new Panel({ commit() {} });
    const P = this.panel;

    this.formatButtons = FORMATS.map((f) => {
      const b = h('button', { type: 'button', class: 'format', 'data-format': f.id },
        h('b', {}, f.name), h('span', {}, f.desc), f.tag ? h('span', { class: 'tag' }, f.tag) : null);
      b.addEventListener('click', () => {
        this.format = f.id;
        this.refresh();
      });
      return b;
    });
    const is = (...ids) => () => ids.includes(this.format);
    const solid = () => ['stl', 'step'].includes(this.format);
    const mode = () => app.doc.relief.mode;
    const tools = () => this.format === 'step' && app.doc.export.stepMode !== 'plate';

    const filename = h('input', { type: 'text', 'aria-label': 'Dateiname', spellcheck: 'false' });
    filename.addEventListener('input', () => {
      app.doc.export.filename = filename.value;
      app.scheduleSave();
    });
    this.ext = h('span', { class: 'unit' });
    this.filenameInput = filename;

    const options = h('div', { class: 'export-options' },
      h('div', { class: 'ctl wide' }, h('label', { class: 'ctl-label' }, 'Dateiname'),
        h('div', { class: 'ctl-field' }, filename, this.ext)),
      segmented(P, { label: 'Ursprung (0,0)', bind: X('origin'), options: [['center', 'Mustermitte'], ['corner', 'Ecke unten links']], visible: is('dxf', 'step', 'stl') }),
      segmented(P, { label: 'SVG-Stil', bind: X('svgStyle'), options: [['fill', 'Gefüllt'], ['stroke', 'Nur Kontur (Laser)'], ['plate', 'Platte mit Löchern']], visible: is('svg') }),
      segmented(P, { label: 'STEP-Inhalt', bind: X('stepMode'), options: [['tools', 'Werkzeugkörper'], ['plate', 'Platte']], visible: is('step') }),
      segmented(P, {
        label: 'Körper',
        bind: R('mode'),
        options: [['cut', 'Durchbrüche'], ['emboss', 'Erhaben'], ['deboss', 'Vertieft']],
        visible: solid,
      }),
      numberField(P, {
        label: 'Plattendicke',
        unit: 'mm',
        bind: X('thickness'),
        min: 0.1,
        max: 1000,
        step: 0.1,
        visible: () => solid() && !(tools() && mode() !== 'cut'),
        title: 'Bei Werkzeugkörpern für Durchbrüche: deren Höhe',
      }),
      numberField(P, { label: 'Höhe (erhaben)', unit: 'mm', bind: R('height'), min: 0.05, max: 1000, step: 0.1, visible: () => solid() && mode() === 'emboss' }),
      numberField(P, { label: 'Tiefe (vertieft)', unit: 'mm', bind: R('height'), min: 0.05, max: 1000, step: 0.1, visible: () => solid() && mode() === 'deboss' }),
      numberField(P, { label: 'Flankenwinkel', unit: '°', bind: R('taper'), min: 0, max: MAX_TAPER, step: 1, digits: 1, visible: () => this.format === 'stl' && mode() !== 'cut' }),
      segmented(P, {
        label: 'Z-Lage der Werkzeugkörper',
        bind: { get: () => this.zPlacement(), set: (v) => L('zPlacement').set(v) },
        options: [['center', 'Mittig um Z=0'], ['bottom', 'Ab Z=0 nach oben'], ['top', 'Bis Z=0 von unten']],
        visible: tools,
      }),
      toggle(P, { label: 'Begrenzung (Außenkontur) mit exportieren', bind: X('includeBoundary'), visible: () => ['dxf', 'fusion'].includes(this.format) || (this.format === 'svg' && app.doc.export.svgStyle !== 'plate') }),
      numberField(P, { label: 'Auflösung', unit: 'px/mm', bind: L('pxPerMm'), min: 1, max: 40, step: 1, digits: 0, visible: is('png') }),
      segmented(P, { label: 'Hintergrund', bind: L('background'), options: [['white', 'Weiß'], ['transparent', 'Transparent']], visible: is('png') }),
    );

    this.info = h('div', { class: 'info-box' });
    this.warning = h('div', { class: 'info-box warn', hidden: true });
    this.summary = h('span', { class: 'summary' });
    this.downloadBtn = h('button', { type: 'button', class: 'btn primary', html: `${icon('download')}<span>Herunterladen</span>` });
    this.downloadBtn.addEventListener('click', () => this.download());
    const close = h('button', { type: 'button', class: 'icon-btn', title: 'Schließen', html: icon('close') });
    close.addEventListener('click', () => this.dialog.close());
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Abbrechen');
    cancel.addEventListener('click', () => this.dialog.close());

    this.dialog.append(h('div', { class: 'dialog-inner' },
      h('div', { class: 'dialog-head' }, h('h2', {}, 'Exportieren'), close),
      h('div', { class: 'dialog-body' }, h('div', { class: 'formats' }, this.formatButtons), options, this.warning, this.info),
      h('div', { class: 'dialog-foot' }, this.summary, cancel, this.downloadBtn)));
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    this.built = true;
  }

  /** Z placement of STEP tool bodies: chosen, or following the relief mode. */
  zPlacement() {
    return this.opts.zPlacement || { cut: 'center', emboss: 'bottom', deboss: 'top' }[this.app.doc.relief.mode] || 'center';
  }

  extension() {
    return { dxf: '.dxf', step: '.step', fusion: '.fusion.json', svg: '.svg', stl: '.stl', png: '.png' }[this.format];
  }

  refresh() {
    const { app } = this;
    for (const b of this.formatButtons) b.classList.toggle('active', b.dataset.format === this.format);
    this.panel.refresh();
    if (document.activeElement !== this.filenameInput) this.filenameInput.value = app.doc.export.filename || 'muster';
    this.ext.textContent = this.extension();
    this.info.innerHTML = INFO[this.format];
    const r = app.result;
    const a = app.analysis;
    const W = app.doc.canvas.width;
    const H = app.doc.canvas.height;
    const relief = reliefParams(app.doc.relief, app.doc.export.thickness);
    const names = featureNames(relief.mode);
    const pct = r ? (r.stats.ratio * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '';
    this.summary.textContent = r
      ? `${r.holes.length.toLocaleString('de-DE')} ${names[1]} · ${W} × ${H} mm · ${relief.mode === 'cut' ? 'offene Fläche' : 'Flächenanteil'} ${pct} %`
      : '';
    const warn = [];
    const tools = this.format === 'step' && app.doc.export.stepMode !== 'plate';
    if (r && !r.holes.length) warn.push('Das Muster enthält keine Formen.');
    if (a && a.overlap && ['stl', 'step'].includes(this.format)) {
      let consequence = 'Die Platte kann dadurch fehlerhaft werden – bitte Abstände prüfen.';
      if (tools) consequence = 'Überlappende Werkzeugkörper sind beim Kombinieren unkritisch.';
      else if (this.format === 'stl' && relief.mode === 'emboss') consequence = 'Sie werden als einzelne Körper gespeichert, die der Slicer vereinigt.';
      warn.push(`${a.overlap} ${names[1]} überlappen sich. ${consequence}`);
    }
    if (this.format === 'step' && relief.mode !== 'cut' && relief.taper > 0) {
      warn.push(`Schräge Flanken (${relief.taper.toLocaleString('de-DE')}°) enthält nur der STL-Export – STEP-Körper haben senkrechte Wände. In Fusion 360 beim Extrudieren den <i>Verjüngungswinkel</i> −${relief.taper.toLocaleString('de-DE')}° eintragen oder das Fusion-Skript nutzen.`);
    }
    if (['stl', 'step'].includes(this.format) && !tools && app.doc.relief.mode === 'deboss' && app.doc.relief.height >= app.doc.export.thickness) {
      warn.push('Die Tiefe ist größer als die Plattendicke – es bleibt ein dünner Boden stehen. Für Löcher „Durchbrüche“ wählen.');
    }
    if (r && tools && r.holes.length > 3000) {
      warn.push(`${r.holes.length} Einzelkörper sind für Fusion 360 recht viel – für große Muster ist DXF oder das Fusion-Skript schneller.`);
    }
    this.warning.hidden = !warn.length;
    this.warning.innerHTML = warn.map((w) => `${icon('warn')} ${w}`).join('<br>');
    this.downloadBtn.disabled = !r || !r.holes.length;
  }

  open(format) {
    if (!this.built) this.build();
    if (format) this.format = format;
    this.refresh();
    this.dialog.showModal();
  }

  async download() {
    const { app } = this;
    const r = app.result;
    const doc = app.doc;
    if (!r || !r.holes.length) return;
    const ex = doc.export;
    const base = safeName(ex.filename);
    const filename = `${base}${this.extension()}`;
    this.downloadBtn.disabled = true;
    const label = this.downloadBtn.querySelector('span');
    label.textContent = 'Erzeuge …';
    await new Promise((res) => setTimeout(res, 30));
    try {
      let blob;
      if (this.format === 'dxf') {
        blob = new Blob([exportDXF(r, doc, { origin: ex.origin, includeBoundary: ex.includeBoundary })], { type: 'application/dxf' });
      } else if (this.format === 'svg') {
        blob = new Blob([exportSVG(r, doc, { style: ex.svgStyle, includeBoundary: ex.includeBoundary })], { type: 'image/svg+xml' });
      } else if (this.format === 'step') {
        const relief = reliefParams(doc.relief, ex.thickness);
        const text = exportSTEP(r, doc, {
          mode: ex.stepMode,
          // Tool bodies for relief are as high as the relief.
          thickness: ex.stepMode === 'plate' || relief.mode === 'cut' ? ex.thickness : relief.height,
          origin: ex.origin,
          zPlacement: this.zPlacement(),
          relief: doc.relief,
          name: base,
        });
        blob = new Blob([text], { type: 'application/step' });
      } else if (this.format === 'fusion') {
        blob = new Blob([exportFusionJSON(r, doc, { includeBoundary: ex.includeBoundary })], { type: 'application/json' });
      } else if (this.format === 'stl') {
        const [dx, dy] = originOffset(doc, ex.origin);
        const mesh = buildPlateMesh(
          translateOutline(r.boundary.outline, dx, dy),
          r.holes.map((hole) => translateOutline(hole.outline, dx, dy)),
          ex.thickness,
          0.015,
          { relief: doc.relief },
        );
        blob = new Blob([toBinarySTL(mesh.positions, `Muster-Generator ${base}`)], { type: 'model/stl' });
      } else if (this.format === 'png') {
        blob = await exportPNG(r, doc, { pxPerMm: this.opts.pxPerMm, background: this.opts.background });
      }
      downloadBlob(blob, filename);
      const size = blob.size > 1e6 ? `${(blob.size / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(blob.size / 1e3))} kB`;
      app.emit('toast', `${filename} (${size}) exportiert.`);
      this.dialog.close();
    } catch (err) {
      console.error(err);
      app.emit('toast', `Export fehlgeschlagen: ${err.message}`);
    } finally {
      this.downloadBtn.disabled = false;
      label.textContent = 'Herunterladen';
    }
  }
}
