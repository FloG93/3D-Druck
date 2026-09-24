// Export dialog: format choice, options and download.

import { h } from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { downloadBlob, safeName } from '../../../shared/js/util.js';
import { modelMeshes, flipMeshes, toBinarySTL } from '../export/mesh.js';
import { export3MF } from '../export/threemf.js';
import { exportSVG } from '../export/svg.js';
import { drawThumbnail } from './presets.js';

const de = (v, digits = 1) => v.toLocaleString('de-DE', { maximumFractionDigits: digits });

const FORMATS = [
  { id: '3mf', name: '3MF', desc: 'Für Bambu Studio & OrcaSlicer: Teile mit Filament-Zuordnung (AMS)', tag: 'Empfohlen' },
  { id: 'stl', name: 'STL', desc: 'Ein Körper für jeden Slicer (einfarbig)' },
  { id: 'svg', name: 'SVG', desc: 'Draufsicht in mm – Doku, Laser, Plotter' },
  { id: 'png', name: 'PNG', desc: 'Bild der Draufsicht' },
];

function partsList(model) {
  return model.parts.map((p) => `<b>${p.name}</b> → Filament ${p.slot}`).join(', ');
}

const INFO = {
  '3mf': (m) => `<b>In Bambu Studio:</b> Datei → <i>Importieren</i> → <i>3MF/STL/STEP … importieren</i> (Strg+I). Es entsteht ein Objekt aus ${m.parts.length} Teil${m.parts.length === 1 ? '' : 'en'}: ${partsList(m)}. Im AMS die passenden Farben den Filamenten zuweisen, slicen, drucken.
    <br>Ein Teil lässt sich auch in der Objektliste per Rechtsklick → <i>Filament ändern</i> umstellen. OrcaSlicer liest die Datei genauso.`,
  stl: () => 'Alle Teile in einer Datei – der Slicer vereint sie zu einem Körper. Für mehrfarbigen Druck lieber <b>3MF</b> nehmen.',
  svg: () => 'Draufsicht im Maßstab 1:1 (1 SVG-Einheit = 1 mm). <b>Farbig</b> für Doku, <b>Umrisse</b> für Laser, Plotter oder Fusion 360 (<i>Einfügen → SVG einfügen</i>).',
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
      ...[['color', 'Farbig'], ['outline', 'Umrisse']].map(([v, t]) => {
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
    return safeName((doc.texts[0]?.text || '').replace(/\s+/g, ' ').trim().slice(0, 40), 'text');
  }

  open() {
    this.app.build();
    this.nameInput.value = this.defaultName();
    this.refresh();
    this.dialog.showModal();
  }

  refresh() {
    const m = this.app.model;
    for (const b of this.formatBtns) b.classList.toggle('active', b.dataset.format === this.format);
    for (const b of this.svgSeg.children) b.classList.toggle('active', b.dataset.value === this.svgStyle);
    this.svgRow.hidden = this.format !== 'svg';
    this.flipRow.hidden = this.format !== '3mf' && this.format !== 'stl';
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
    this.info.innerHTML = INFO[this.format](m) + (m.warnings.length ? `<br><span class="warn">${m.warnings.join('<br>')}</span>` : '');
    const s = m.stats;
    this.summary.textContent = `${de(s.width)} × ${de(s.height)} × ${de(s.top)} mm · ≈ ${de(s.grams)} g PLA`;
    this.download.disabled = !m.parts.length;
  }

  /** Print upside down (lettering on the bed)? Only for a flat top. */
  flipped(m) {
    return Boolean(m.flippable && this.app.doc.export.flip);
  }

  /** Meshes for 3MF/STL in print orientation. */
  meshes(m) {
    const meshes = modelMeshes(m);
    return this.flipped(m) ? flipMeshes(meshes, m.stats.top) : meshes;
  }

  async run() {
    const m = this.app.build();
    const base = safeName(this.nameInput.value || this.defaultName(), 'text');
    try {
      if (this.format === '3mf') {
        const bytes = await export3MF(this.meshes(m), { title: this.app.doc.texts[0]?.text.split('\n')[0] || 'Text' });
        downloadBlob(new Blob([bytes], { type: 'model/3mf' }), `${base}.3mf`);
      } else if (this.format === 'stl') {
        downloadBlob(new Blob([toBinarySTL(this.meshes(m))], { type: 'model/stl' }), `${base}.stl`);
      } else if (this.format === 'svg') {
        downloadBlob(new Blob([exportSVG(m, { style: this.svgStyle })], { type: 'image/svg+xml' }), `${base}.svg`);
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
