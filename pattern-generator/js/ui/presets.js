// Built-in presets, user presets (localStorage) and project files.

import { h } from './controls.js';
import { icon } from './icons.js';
import { normalizeDoc, newId } from '../core/document.js';
import { BUILTIN_PRESETS } from '../core/preset-library.js';
import { generate } from '../core/generator.js';
import { addOutlineToPath } from './renderer.js';
import { createImage } from './image.js';

const STORAGE_PRESETS = 'muster-generator.presets.v1';

function readUserPresets(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_PRESETS);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p) => p && p.name && p.doc) : [];
  } catch {
    return [];
  }
}

function writeUserPresets(storage, list) {
  try {
    if (storage) storage.setItem(STORAGE_PRESETS, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Renders a small preview of a document into a canvas element. */
export function renderThumbnail(canvas, docInput, colors) {
  const doc = normalizeDoc(docInput);
  const res = generate(doc);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = canvas.clientWidth || 64;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  const s = (size * 0.9) / Math.max(doc.canvas.width, doc.canvas.height);
  ctx.setTransform(dpr * s, 0, 0, -dpr * s, (dpr * size) / 2, (dpr * size) / 2);
  const plate = new Path2D();
  addOutlineToPath(plate, res.boundary.outline);
  ctx.fillStyle = colors.plate;
  ctx.fill(plate);
  const holes = new Path2D();
  for (const hole of res.holes) addOutlineToPath(holes, hole.outline);
  ctx.fillStyle = doc.shape.color;
  const mode = doc.relief.mode;
  // Raised shapes cast a shadow, recessed ones get an inner shadow.
  if (mode === 'emboss') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = dpr;
    ctx.shadowOffsetX = dpr;
    ctx.shadowOffsetY = dpr;
    ctx.fill(holes);
    ctx.restore();
  } else {
    ctx.fill(holes);
  }
  if (mode === 'deboss') {
    ctx.save();
    ctx.clip(holes);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 1.5 * dpr;
    ctx.shadowOffsetX = dpr;
    ctx.shadowOffsetY = dpr;
    const frame = new Path2D();
    frame.rect(-doc.canvas.width, -doc.canvas.height, doc.canvas.width * 2, doc.canvas.height * 2);
    frame.addPath(holes);
    ctx.fill(frame, 'evenodd');
    ctx.restore();
  }
}

/** Scales positions/radii of modifiers when a preset is fitted to another canvas. */
function fitPresetToCanvas(doc, canvas) {
  const sx = canvas.width / doc.canvas.width;
  const sy = canvas.height / doc.canvas.height;
  const sr = Math.min(sx, sy);
  for (const m of doc.modifiers) {
    for (const k of ['x', 'x1', 'x2', 'cx']) if (typeof m[k] === 'number') m[k] *= sx;
    for (const k of ['y', 'y1', 'y2', 'cy']) if (typeof m[k] === 'number') m[k] *= sy;
    if (typeof m.radius === 'number') m.radius *= sr;
    if (m.type === 'edge') m.width *= sr;
  }
  doc.canvas = { ...canvas };
  return doc;
}

export class PresetsView {
  constructor(app, container, getColors) {
    this.app = app;
    this.getColors = getColors;
    this.el = container;
    this.keepSize = false;
    const builtin = h('div', { class: 'preset-grid' });
    const user = h('div', { class: 'preset-grid user' });
    this.userGrid = user;
    const keep = h('label', { class: 'ctl ctl-toggle wide', title: 'Vorlagen an die aktuelle Breite/Höhe anpassen' },
      h('input', { type: 'checkbox', role: 'switch' }), h('span', { class: 'switch' }), h('span', { class: 'ctl-text' }, 'Aktuelle Größe beibehalten'));
    keep.querySelector('input').addEventListener('change', (e) => {
      this.keepSize = e.target.checked;
    });
    const nameInput = h('input', { type: 'text', placeholder: 'Name der Vorlage', maxlength: '40', 'aria-label': 'Name der Vorlage' });
    const saveBtn = h('button', { type: 'button', class: 'btn small', html: `${icon('save')}<span>Speichern</span>` });
    saveBtn.addEventListener('click', () => this.saveUserPreset(nameInput));
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveUserPreset(nameInput);
    });

    const openInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    openInput.addEventListener('change', () => this.openProject(openInput));
    const openBtn = h('button', { type: 'button', class: 'btn small', html: `${icon('open')}<span>Projekt öffnen</span>` });
    openBtn.addEventListener('click', () => openInput.click());
    const dlBtn = h('button', { type: 'button', class: 'btn small', html: `${icon('download')}<span>Projekt speichern</span>` });
    dlBtn.addEventListener('click', () => this.saveProject());

    container.append(
      builtin,
      keep,
      h('h4', { class: 'subhead' }, 'Meine Vorlagen'),
      user,
      h('div', { class: 'ctl-inline' }, nameInput, saveBtn),
      h('div', { class: 'ctl ctl-buttons wide' }, openBtn, dlBtn, openInput),
    );

    this.builtinItems = BUILTIN_PRESETS.map((p) => {
      const item = this.makeItem(p.name, () => p.doc());
      builtin.append(item.el);
      return item;
    });
    this.renderUser();
    this.drawAll();
  }

  makeItem(name, getDoc, onDelete) {
    const canvas = h('canvas', { class: 'preset-thumb', width: '64', height: '64' });
    const btn = h('button', { type: 'button', class: 'preset', title: `Vorlage „${name}“ laden` }, canvas, h('span', { class: 'preset-name' }, name));
    btn.addEventListener('click', () => this.apply(getDoc(), name));
    const el = onDelete ? h('div', { class: 'preset-wrap' }, btn) : btn;
    if (onDelete) {
      const del = h('button', { type: 'button', class: 'preset-del', title: 'Vorlage löschen', html: icon('close') });
      del.addEventListener('click', onDelete);
      el.append(del);
    }
    return { el, canvas, getDoc };
  }

  apply(docInput, name) {
    let doc = normalizeDoc(structuredClone(docInput));
    if (this.keepSize) doc = fitPresetToCanvas(doc, this.app.doc.canvas);
    doc.name = name;
    // Keep the user's export settings.
    doc.export = structuredClone(this.app.doc.export);
    this.app.load(doc, { keepHistory: true });
    this.app.emit('fit');
    this.app.emit('toast', `Vorlage „${name}“ geladen – Rückgängig mit Strg+Z.`);
  }

  drawAll() {
    const items = [...this.builtinItems, ...(this.userItems || [])];
    let i = 0;
    const step = () => {
      if (i >= items.length) return;
      const it = items[i++];
      try {
        renderThumbnail(it.canvas, it.getDoc(), this.getColors());
      } catch {
        /* ignore broken presets */
      }
      setTimeout(step, 0);
    };
    setTimeout(step, 30);
  }

  renderUser() {
    const list = readUserPresets(this.app.storage);
    this.userGrid.innerHTML = '';
    this.userItems = list.map((p) => {
      const item = this.makeItem(p.name, () => p.doc, () => {
        writeUserPresets(this.app.storage, readUserPresets(this.app.storage).filter((q) => q.id !== p.id));
        this.renderUser();
        this.drawAll();
      });
      this.userGrid.append(item.el);
      return item;
    });
    if (!list.length) this.userGrid.append(h('p', { class: 'ctl-note' }, 'Noch keine eigenen Vorlagen gespeichert.'));
  }

  saveUserPreset(input) {
    const name = input.value.trim() || `Vorlage ${new Date().toLocaleDateString('de-DE')}`;
    const list = readUserPresets(this.app.storage);
    list.push({ id: newId(), name, doc: structuredClone(this.app.doc), created: Date.now() });
    if (!writeUserPresets(this.app.storage, list)) {
      this.app.emit('toast', 'Speichern nicht möglich (Browser-Speicher blockiert).');
      return;
    }
    input.value = '';
    this.renderUser();
    this.drawAll();
    this.app.emit('toast', `Vorlage „${name}“ gespeichert.`);
  }

  saveProject() {
    const data = { ...structuredClone(this.app.doc), generator: 'Muster-Generator' };
    if (this.app.image) data.image = { name: this.app.image.name, dataUrl: this.app.image.dataUrl };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeName(this.app.doc.export.filename)}.muster.json`);
  }

  async openProject(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      this.app.load(data, { keepHistory: true });
      if (data.image && data.image.dataUrl) {
        const img = await createImage(data.image.dataUrl, () => this.app.doc, data.image.name);
        this.app.setImage(img);
      }
      this.app.emit('fit');
      this.app.emit('toast', `Projekt „${file.name}“ geladen.`);
    } catch (err) {
      this.app.emit('toast', `Datei konnte nicht gelesen werden: ${err.message}`);
    }
  }
}

export function safeName(name) {
  return (name || 'muster').replace(/[^\w\-äöüÄÖÜß]+/g, '_').replace(/^_+|_+$/g, '') || 'muster';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
