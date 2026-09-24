// Presets: built-in and own ones (browser storage) with thumbnails, plus
// project files (JSON).

import { h } from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { downloadBlob, safeName } from '../../../shared/js/util.js';
import { normalizeDoc } from '../core/document.js';
import { buildModel } from '../core/model.js';
import { BUILTIN_PRESETS } from '../core/presets.js';

const STORAGE_PRESETS = 'text-generator.presets.v1';

function regionPath(ctx, region, S) {
  for (const s of region) {
    for (const r of [s.outer, ...s.holes]) {
      const [x0, y0] = S(r[0], r[1]);
      ctx.moveTo(x0, y0);
      for (let i = 2; i < r.length; i += 2) {
        const [x, y] = S(r[i], r[i + 1]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }
}

/**
 * Draws a model into a canvas (fit, centred). Width/height in CSS pixels,
 * default: the canvas' size on screen.
 */
export function drawThumbnail(canvas, model, { width, height, pixelRatio, pad = 4 } = {}) {
  const dpr = pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
  const W = width || canvas.clientWidth || 64;
  const H = height || canvas.clientHeight || W;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const b = model.bounds;
  if (!Number.isFinite(b.minX)) return;
  const k = Math.min((W - 2 * pad) / (b.maxX - b.minX), (H - 2 * pad) / (b.maxY - b.minY));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const S = (x, y) => [W / 2 + (x - cx) * k, H / 2 - (y - cy) * k];
  const { colors } = model.doc;
  const fill = (region, style) => {
    if (!region.length) return;
    ctx.beginPath();
    regionPath(ctx, region, S);
    ctx.fillStyle = style;
    ctx.fill('evenodd');
  };
  fill(model.plate, colors.base);
  fill(model.border, colors.border);
  if (model.relief === 'engraved') fill(model.text, 'rgba(0,0,0,0.3)');
  else if (model.relief !== 'cut') fill(model.text, colors.text);
}

export class PresetsView {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.user = this.loadUser();
    this.render();
  }

  loadUser() {
    try {
      const raw = this.app.storage && this.app.storage.getItem(STORAGE_PRESETS);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  saveUser() {
    try {
      if (this.app.storage) this.app.storage.setItem(STORAGE_PRESETS, JSON.stringify(this.user));
    } catch {
      this.app.emit('toast', 'Vorlage konnte nicht gespeichert werden (Browser-Speicher voll?).');
    }
  }

  render() {
    const { container } = this;
    container.innerHTML = '';
    const gridEl = h('div', { class: 'preset-grid' });
    const items = [
      ...BUILTIN_PRESETS.map((p) => ({ doc: p, own: false })),
      ...this.user.map((p, i) => ({ doc: p, own: true, index: i })),
    ];
    this.thumbs = [];
    for (const item of items) {
      const canvas = h('canvas', { class: 'preset-thumb', width: '64', height: '64' });
      const btn = h('button', { type: 'button', class: 'preset', title: `Vorlage „${item.doc.name}“ laden` },
        canvas, h('span', { class: 'preset-name' }, item.doc.name));
      btn.addEventListener('click', () => {
        this.app.load(structuredClone(item.doc), { keepHistory: true });
        this.app.emit('toast', `Vorlage „${item.doc.name}“ geladen.`);
      });
      const wrap = h('div', { class: 'preset-wrap' }, btn);
      if (item.own) {
        const del = h('button', { type: 'button', class: 'preset-del', title: 'Vorlage löschen', html: icon('close') });
        del.addEventListener('click', () => {
          this.user.splice(item.index, 1);
          this.saveUser();
          this.render();
        });
        wrap.append(del);
      }
      gridEl.append(wrap);
      this.thumbs.push({ canvas, doc: item.doc });
    }
    const save = h('button', { type: 'button', class: 'btn small', html: `${icon('save')}<span>Als Vorlage</span>`, title: 'Aktuelles Design als eigene Vorlage speichern' });
    save.addEventListener('click', () => this.saveCurrent());
    const exportBtn = h('button', { type: 'button', class: 'btn small', html: `${icon('download')}<span>Projekt</span>`, title: 'Projekt als Datei speichern (.text.json)' });
    exportBtn.addEventListener('click', () => this.exportProject());
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', () => this.importProject(input));
    const openBtn = h('button', { type: 'button', class: 'btn small', html: `${icon('open')}<span>Öffnen</span>`, title: 'Projektdatei öffnen' });
    openBtn.addEventListener('click', () => input.click());
    container.append(gridEl, h('div', { class: 'ctl-buttons' }, save, exportBtn, openBtn, input));
    this.drawAll();
  }

  async drawAll() {
    for (const t of this.thumbs) {
      const doc = normalizeDoc(t.doc);
      try {
        await Promise.all(doc.texts.map((x) => this.app.fonts.load(x.font)));
      } catch {
        /* offline Google font: thumbnail without that text */
      }
      drawThumbnail(t.canvas, buildModel(doc, (ref) => this.app.fonts.peek(ref)));
    }
  }

  saveCurrent() {
    const name = window.prompt('Name der Vorlage:', this.app.doc.texts[0]?.text.split('\n')[0] || 'Meine Vorlage');
    if (!name) return;
    const doc = structuredClone(this.app.doc);
    doc.name = name.slice(0, 40);
    this.user.push(doc);
    this.saveUser();
    this.render();
    this.app.emit('toast', `Vorlage „${doc.name}“ gespeichert.`);
  }

  exportProject() {
    const doc = this.app.doc;
    const blob = new Blob([JSON.stringify({ format: 'text-generator/project', ...doc }, null, 1)], { type: 'application/json' });
    downloadBlob(blob, `${safeName(doc.export.filename, 'text')}.text.json`);
  }

  async importProject(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format && data.format !== 'text-generator/project') throw new Error('keine Text-Generator-Datei');
      this.app.load(data, { keepHistory: true });
      this.app.emit('toast', `„${file.name}“ geöffnet.`);
    } catch (err) {
      this.app.emit('toast', `Datei konnte nicht gelesen werden: ${err.message}`);
    }
  }
}
