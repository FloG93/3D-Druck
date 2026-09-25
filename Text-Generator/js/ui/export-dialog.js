// Export dialog: format choice, options and download.

import { h } from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { downloadBlob, safeName } from '../../../shared/js/util.js';
import { modelMeshes, flipMeshes, spreadPieces, toBinarySTL } from '../export/mesh.js';
import { export3MF } from '../export/threemf.js';
import { exportSVG } from '../export/svg.js';
import { exportDXF, dxfLayers } from '../export/dxf.js';
import { exportSTEP, stepSupported } from '../export/step.js';
import { seriesModels, seriesMeshes, seriesSheet, seriesLabel } from '../export/series.js';
import { seriesNames } from '../core/series.js';
import { drawThumbnail } from './presets.js';
import { firstLine } from '../core/document.js';

const de = (v, digits = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: digits });

const FORMATS = [
  { id: '3mf', name: '3MF', desc: 'Für Bambu Studio & OrcaSlicer: Teile mit Filament-Zuordnung (AMS)', tag: 'Empfohlen' },
  { id: 'stl', name: 'STL', desc: 'Ein Körper für jeden Slicer (einfarbig)' },
  { id: 'svg', name: 'SVG', desc: 'Glatte Kurven 1:1 – Fusion 360, Laser, Plotter, Doku' },
  { id: 'step', name: 'STEP', desc: 'Körper je Teil, exakte Kurven – Fusion 360 & CAD' },
  { id: 'dxf', name: 'DXF', desc: 'Umrisse in mm – Laser, Schneideplotter' },
  { id: 'png', name: 'PNG', desc: 'Bild der Draufsicht' },
];

function partsList(model) {
  return model.parts.map((p) => `<b>${p.name}</b> → Filament ${p.slot}`).join(', ');
}

const PIECES = (m) => `Die Schablone besteht aus <b>${m.pieces.length} Teilen</b> (${m.split.nx} × ${m.split.ny}, nummeriert von links oben), die wie ein Puzzle ineinandergreifen.`;

const STAMP = 'Stempelplatte und Griff sind eigene Objekte: die Platte mit der Schrift nach oben drucken, den Griff kopfüber (flache Seite auf dem Druckbett) – beides ohne Stützen. Den Zapfen in die Tasche auf der Rückseite stecken, bei Bedarf mit etwas Sekundenkleber sichern.';

const CUP = 'Der Becher steht auf seinem Boden – so drucken, ohne Stützen.';

// Formats that take a series (every name a piece of its own).
const SERIES_FORMATS = ['3mf', 'stl', 'svg', 'dxf'];

function seriesInfo(format, n, bed) {
  if (format === '3mf') return `<b>Serie:</b> ${n} Namen, jeder ein eigenes Objekt, in Reihen auf dem Druckbett (${bed} mm) angeordnet. In Bambu Studio verteilt <i>Anordnen</i> (Taste A) sie bei Bedarf auf mehrere Platten.<br>`;
  if (format === 'stl') return `<b>Serie:</b> ${n} Namen nebeneinander in einer Datei – im Slicer <i>In Objekte teilen</i>. Mit <b>3MF</b> sind es gleich getrennte Objekte mit Namen.<br>`;
  if (format === 'svg' || format === 'dxf') return `<b>Serie:</b> ${n} Namen nebeneinander auf einem Bogen (${bed} mm breit).<br>`;
  return '<b>Serie:</b> STEP und PNG enthalten nur den Entwurf – für alle Namen 3MF, STL, SVG oder DXF nehmen.<br>';
}

const INFO = {
  '3mf': (m, series) => (m.cup ? `${CUP} <b>In Bambu Studio:</b> Datei → <i>Importieren</i> (Strg+I). Es entsteht ein Objekt aus ${m.parts.length} Teilen: ${partsList(m)} – im AMS die Farben zuweisen. Der Boden reicht zur Hälfte in die Wand, beide verschmelzen beim Slicen.` : m.stamp?.handle ? `${STAMP} <b>In Bambu Studio:</b> Datei → <i>Importieren</i> (Strg+I), beide Teile liegen schon nebeneinander.` : m.pieces.length
    ? `${PIECES(m)} <b>In Bambu Studio:</b> Datei → <i>Importieren</i> (Strg+I) – jedes Teil ist ein eigenes Objekt. Mit <i>Anordnen</i> (Taste A) auf die Druckplatte verteilen; passen nicht alle darauf, eine weitere Platte hinzufügen und erneut anordnen.`
    : `<b>In Bambu Studio:</b> Datei → <i>Importieren</i> → <i>3MF/STL/STEP … importieren</i> (Strg+I). Es entsteht ${series ? 'je Name ' : ''}ein Objekt aus ${m.parts.length} Teil${m.parts.length === 1 ? '' : 'en'}: ${partsList(m)}. Im AMS die passenden Farben den Filamenten zuweisen, slicen, drucken.
    <br>Ein Teil lässt sich auch in der Objektliste per Rechtsklick → <i>Filament ändern</i> umstellen. OrcaSlicer liest die Datei genauso.`),
  stl: (m) => (m.stamp?.handle ? `${STAMP} In der STL liegen beide nebeneinander – im Slicer <i>In Objekte teilen</i>.` : m.pieces.length
    ? `${PIECES(m)} Alle Teile liegen auseinandergezogen in einer Datei – im Slicer <i>In Objekte teilen</i> und anordnen. Mit <b>3MF</b> sind es gleich getrennte Objekte.`
    : 'Alle Teile in einer Datei – der Slicer vereint sie zu einem Körper. Für mehrfarbigen Druck lieber <b>3MF</b> nehmen.'),
  svg: (m) => (m.cup
    ? `Die abgewickelte Wand des Bechers im Maßstab 1:1${m.cup.conical ? ' – beim konischen Becher ein Kreisring-Ausschnitt, der genau um die Wand passt' : ' (Umfang × Höhe)'}, zum Beispiel als Vorlage für Folie oder Papier. <b>Für Fusion 360:</b> <b>Nur Schrift</b> auf eine Ebene legen, die den Zylinder berührt, und mit <i>Erstellen → Prägen</i> um die Mantelfläche legen – den ganzen Becher gibt es als <b>STEP</b>.`
    : `Draufsicht 1:1 mit glatten Kurven. <b>Farbig</b> für Doku, <b>Umrisse</b> für Laser, Plotter oder Fusion 360${m.relief === 'cut' ? ' (bei der Schablone alle Schnittlinien mit Stegen)' : ''}, <b>Nur Schrift</b> für eine Skizze auf deinem eigenen Teil.
    <br><b>In Fusion 360:</b> <i>Einfügen → SVG einfügen</i>, Fläche wählen – die Größe stimmt ohne Skalieren –, dann <i>Extrusion</i> (Verbinden oder Ausschneiden) oder auf runden Flächen <i>Erstellen → Prägen</i>.`),
  step: (m) => `Für Fusion 360 und andere CAD-Programme: Jedes Teil (${m.parts.map((p) => `<b>${p.name}</b>`).join(', ')}) ist ein eigenes Bauteil mit Körpern in seiner Farbe, die Umrisse sind exakte Kurven – zum Weiterkonstruieren.${m.cup ? ` Beim Becher liegen Wand und Schrift auf echten ${m.cup.conical ? 'Kegel' : 'Zylinder'}flächen; der Boden reicht bis an die Innenseite der Wand – mit <i>Ändern → Kombinieren</i> werden beide ein Körper.` : ''}
    <br><b>In Fusion 360:</b> <i>Datei → Öffnen → Von meinem Computer öffnen</i> – oder die Datei in den Datenbereich hochladen und per Rechtsklick <i>In aktuelles Design einfügen</i>.${m.stamp?.handle ? ' Der Griff liegt wie im 3MF kopfüber neben dem Stempel.' : ''}`,
  dxf: (m) => (m.relief === 'cut'
    ? `Alle Schnittlinien der Schablone – Außenkante und Buchstaben mit Stegen – als geschlossene Linienzüge auf der Ebene <b>SCHNITT</b>, 1:1 in mm${m.pieces.length ? ', am Stück (Laser und Plotter schneiden auch große Formate)' : ''}. Für Laser (z. B. LightBurn), Schneideplotter mit Schablonenfolie (z. B. Silhouette Studio, auch in der kostenlosen Version) oder Fusion 360 (<i>Einfügen → DXF einfügen</i>).`
    : `Umrisse als geschlossene Linienzüge, 1:1 in mm, je Teil eine Ebene (${dxfLayers(m).map(([n]) => `<b>${n}</b>`).join(', ') || '–'}). Für Laser, Plotter oder CAD (<i>Einfügen → DXF einfügen</i>, Einheit mm) – in Fusion 360 sind SVG oder STEP mit glatten Kurven leichter.`),
  png: () => 'Bild der Draufsicht mit transparentem Hintergrund.',
};

export class ExportDialog {
  constructor(dialog, app) {
    this.dialog = dialog;
    this.app = app;
    this.format = '3mf';
    this.svgStyle = 'color';
    this.build();
  }

  build() {
    const d = this.dialog;
    d.innerHTML = '';
    this.formatBtns = FORMATS.map((f) => {
      const b = h('button', { type: 'button', class: 'format', 'data-format': f.id },
        h('b', {}, f.name), h('span', {}, f.desc), f.tag ? h('span', { class: 'tag' }, f.tag) : null);
      b.addEventListener('click', () => {
        this.format = f.id;
        this.refresh();
      });
      return b;
    });
    this.nameInput = h('input', { type: 'text', spellcheck: 'false' });
    this.nameInput.addEventListener('change', () => {
      this.app.doc.export.filename = safeName(this.nameInput.value, 'text');
      this.app.commit();
    });
    this.svgSeg = h('div', { class: 'segmented', role: 'group' },
      ...[['color', 'Farbig'], ['outline', 'Umrisse'], ['text', 'Nur Schrift']].map(([v, t]) => {
        const b = h('button', { type: 'button', class: 'seg-btn', 'data-value': v }, t);
        b.addEventListener('click', () => {
          this.svgStyle = v;
          this.refresh();
        });
        return b;
      }));
    this.svgRow = h('div', { class: 'ctl wide' }, h('span', { class: 'ctl-label' }, 'SVG-Stil'), this.svgSeg);
    this.flipSeg = h('div', { class: 'segmented', role: 'group' },
      ...[[false, 'Schrift oben'], [true, 'Schrift unten']].map(([v, t]) => {
        const b = h('button', { type: 'button', class: 'seg-btn', 'data-value': String(v) }, t);
        b.addEventListener('click', () => {
          this.app.doc.export.flip = v;
          this.app.commit();
          this.refresh();
        });
        return b;
      }));
    this.flipNote = h('p', { class: 'ctl-note' });
    this.flipRow = h('div', { class: 'ctl wide' }, h('span', { class: 'ctl-label' }, 'Druckausrichtung'), this.flipSeg, this.flipNote);
    this.info = h('div', { class: 'info-box' });
    this.summary = h('span', { class: 'summary' });
    this.download = h('button', { type: 'button', class: 'btn primary', html: `${icon('download')}<span>Herunterladen</span>` });
    this.download.addEventListener('click', () => this.run());
    const close = h('button', { type: 'button', class: 'icon-btn', title: 'Schließen', html: icon('close') });
    close.addEventListener('click', () => d.close());
    d.append(h('div', { class: 'dialog-inner' },
      h('div', { class: 'dialog-head' }, h('h2', {}, 'Exportieren'), close),
      h('div', { class: 'dialog-body' },
        h('div', { class: 'formats' }, this.formatBtns),
        h('div', { class: 'export-options' },
          h('div', { class: 'ctl ctl-textfield wide' }, h('label', { class: 'ctl-label' }, 'Dateiname'), h('div', { class: 'ctl-field' }, this.nameInput)),
          this.svgRow,
          this.flipRow),
        this.info),
      h('div', { class: 'dialog-foot' }, this.summary, this.download)));
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
  }

  /** File name: the one typed in here, else the first text (e.g. „Anna.3mf“). */
  defaultName() {
    const { doc } = this.app;
    if (doc.export.filename && doc.export.filename !== 'text') return doc.export.filename;
    return safeName(firstLine(doc).slice(0, 40), 'text');
  }

  open() {
    this.app.build();
    this.nameInput.value = this.defaultName();
    this.refresh();
    this.dialog.showModal();
  }

  /** One model per name of the series (cached for the current design). */
  series() {
    const { doc } = this.app;
    if (!seriesNames(doc).length) return null;
    const key = JSON.stringify(doc);
    if (this.cached?.key !== key) {
      this.cached = { key, items: seriesModels(doc, (ref) => this.app.fonts.peek(ref), { symbolsLoading: this.app.symbolsLoading > 0 }) };
    }
    return this.cached.items;
  }

  refresh() {
    const m = this.app.model;
    for (const b of this.formatBtns) b.classList.toggle('active', b.dataset.format === this.format);
    for (const b of this.svgSeg.children) b.classList.toggle('active', b.dataset.value === this.svgStyle);
    this.svgRow.hidden = this.format !== 'svg';
    // A cup stands on its floor; there is nothing to turn over.
    this.flipRow.hidden = (this.format !== '3mf' && this.format !== 'stl') || Boolean(m?.cup);
    if (!m) return;
    const flip = this.flipped(m);
    for (const b of this.flipSeg.children) {
      b.classList.toggle('active', b.dataset.value === String(flip));
      b.disabled = !m.flippable;
    }
    this.flipNote.textContent = !m.flippable
      ? 'Nur bei flacher Oberseite – Schrift „Bündig“ oder ohne Platte. Erhabene oder vertiefte Schrift wird mit der Schrift nach oben gedruckt.'
      : flip
        ? 'Die Schriftseite liegt auf dem Druckbett und bekommt dessen Oberfläche – glatt oder strukturiert (z. B. Textured PEI). Die Farbwechsel liegen in den ersten Schichten.'
        : 'Die Schrift zeigt nach oben – wie in der Vorschau.';
    const names = seriesNames(this.app.doc);
    const items = SERIES_FORMATS.includes(this.format) ? this.series() : null;
    // Warnings of the series: what a name brings along (too long, missing
    // characters …), not what the design has anyway.
    const own = new Set(m.warnings);
    const extra = (items || []).flatMap(({ name, model }) => model.warnings.filter((w) => !own.has(w)).map((w) => `${seriesLabel(name)}: ${w}`));
    const warnings = [...m.warnings, ...extra.slice(0, 6), ...(extra.length > 6 ? [`… und ${extra.length - 6} weitere Hinweise`] : [])];
    this.info.innerHTML = (names.length ? seriesInfo(this.format, names.length, this.app.doc.check.bed) : '') + INFO[this.format](m, names.length > 0)
      + (warnings.length ? `<br><span class="warn">${warnings.join('<br>')}</span>` : '');
    const s = m.stats;
    this.summary.textContent = items
      ? `${items.length} Teile · ≈ ${de(items.reduce((g, i) => g + i.model.stats.grams, 0))} g PLA`
      : `${de(s.width)} × ${de(s.height)} × ${de(s.top)} mm${m.pieces.length ? ` · ${m.pieces.length} Teile` : ''} · ≈ ${de(s.grams)} g PLA`;
    this.download.disabled = !m.parts.length || (this.format === 'step' && !stepSupported(m));
  }

  /** Print upside down (lettering on the bed)? Only for a flat top. */
  flipped(m) {
    return Boolean(m.flippable && this.app.doc.export.flip);
  }

  /** Meshes for 3MF/STL in print orientation, pieces pulled apart. */
  meshes(m) {
    let meshes = modelMeshes(m);
    if (m.pieces.length) meshes = spreadPieces(meshes);
    return this.flipped(m) ? flipMeshes(meshes, m.stats.top) : meshes;
  }

  async run() {
    const m = this.app.build();
    const base = safeName(this.nameInput.value || this.defaultName(), 'text');
    const { doc } = this.app;
    // A series: all names side by side on the bed, or on one sheet.
    const items = SERIES_FORMATS.includes(this.format) ? this.series() : null;
    const meshes = () => (items ? seriesMeshes(items, { bed: doc.check.bed, gap: doc.series.gap, prepare: (x) => this.meshes(x) }) : this.meshes(m));
    const flat = () => (items ? seriesSheet(items, { width: doc.check.bed, gap: doc.series.gap }) || m : m);
    try {
      if (this.format === '3mf') {
        const bytes = await export3MF(meshes(), { title: firstLine(doc) || 'Text' });
        downloadBlob(new Blob([bytes], { type: 'model/3mf' }), `${base}.3mf`);
      } else if (this.format === 'stl') {
        downloadBlob(new Blob([toBinarySTL(meshes())], { type: 'model/stl' }), `${base}.stl`);
      } else if (this.format === 'svg') {
        downloadBlob(new Blob([exportSVG(flat(), { style: this.svgStyle })], { type: 'image/svg+xml' }), `${base}.svg`);
      } else if (this.format === 'dxf') {
        downloadBlob(new Blob([exportDXF(flat())], { type: 'application/dxf' }), `${base}.dxf`);
      } else if (this.format === 'step') {
        downloadBlob(new Blob([exportSTEP(m, { title: firstLine(this.app.doc) || 'Text' })], { type: 'application/step' }), `${base}.step`);
      } else if (this.format === 'png') {
        // 20 px per mm, at most 4000 px on the long side.
        const s = m.stats;
        const k = Math.min(20, 4000 / Math.max(s.width, s.height, 1));
        const canvas = document.createElement('canvas');
        drawThumbnail(canvas, m, { width: Math.round(s.width * k) + 40, height: Math.round(s.height * k) + 40, pixelRatio: 1, pad: 20 });
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        downloadBlob(blob, `${base}.png`);
      }
      this.app.emit('toast', 'Export erstellt.');
    } catch (err) {
      console.error(err);
      this.app.emit('toast', `Export fehlgeschlagen: ${err.message}`);
    }
  }
}
