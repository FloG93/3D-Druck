// Application state: the document, undo history, selection, background image
// and the latest generation result. Views subscribe to events:
//   'doc'        document values changed (refresh controls)
//   'structure'  modifier list changed (rebuild modifier cards)
//   'result'     new generation result (redraw)
//   'analysis'   web thickness check finished
//   'selection'  selected modifier changed
//   'image'      background image changed

import { defaultDoc, normalizeDoc, createModifier, newId } from '../core/document.js';
import { generate } from '../core/generator.js';
import { analyzeWebs } from '../core/analysis.js';
import { clamp } from '../core/math.js';

const STORAGE_DOC = 'muster-generator.doc.v1';
const STORAGE_IMAGE = 'muster-generator.image.v1';

export function safeStorage() {
  try {
    const s = window.localStorage;
    const k = '__mg_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  reset(snapshot) {
    this.stack = [snapshot];
    this.index = 0;
  }

  push(snapshot) {
    if (snapshot === this.stack[this.index]) return false;
    this.stack.length = this.index + 1;
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  undo() {
    return this.index > 0 ? this.stack[--this.index] : null;
  }

  redo() {
    return this.index < this.stack.length - 1 ? this.stack[++this.index] : null;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }
}

function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
  cur[keys[keys.length - 1]] = value;
}

export class App {
  constructor() {
    this.doc = defaultDoc();
    this.history = new History();
    this.history.reset(JSON.stringify(this.doc));
    this.handlers = new Map();
    this.selectedId = null;
    this.image = null;
    this.result = null;
    this.analysis = null;
    this.storage = safeStorage();
    this._pending = { doc: false, structure: false };
    this._frame = 0;
    this._analysisTimer = 0;
    this._saveTimer = 0;
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event).delete(fn);
  }

  emit(event, data) {
    const set = this.handlers.get(event);
    if (set) for (const fn of set) fn(data);
  }

  get(path) {
    return getPath(this.doc, path);
  }

  set(path, value) {
    if (getPath(this.doc, path) === value) return;
    setPath(this.doc, path, value);
    this.changed();
  }

  modifier(id) {
    return this.doc.modifiers.find((m) => m.id === id) || null;
  }

  get selected() {
    return this.selectedId ? this.modifier(this.selectedId) : null;
  }

  setModifier(id, key, value) {
    const m = this.modifier(id);
    if (!m || m[key] === value) return;
    m[key] = value;
    this.changed();
  }

  /** Schedules regeneration and UI refresh for the next animation frame. */
  changed(structural = false) {
    this._pending.doc = true;
    if (structural) this._pending.structure = true;
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => this.flush());
  }

  flush() {
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    const { structure } = this._pending;
    this._pending = { doc: false, structure: false };
    if (structure) this.emit('structure');
    this.regenerate();
    this.emit('doc');
  }

  /** Records the current document in the undo history and autosaves. */
  commit() {
    const snap = JSON.stringify(this.doc);
    if (this.history.push(snap)) {
      this.emit('history');
      this.scheduleSave();
    }
  }

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (!this.storage) return;
      try {
        this.storage.setItem(STORAGE_DOC, JSON.stringify(this.doc));
      } catch {
        /* storage full or blocked */
      }
    }, 300);
  }

  restoreSaved() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_DOC);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  load(doc, { keepHistory = false } = {}) {
    this.doc = normalizeDoc(doc);
    if (this.selectedId && !this.modifier(this.selectedId)) this.selectedId = null;
    const snap = JSON.stringify(this.doc);
    if (keepHistory) this.history.push(snap);
    else this.history.reset(snap);
    this.emit('history');
    this.emit('selection');
    this.changed(true);
    this.scheduleSave();
  }

  applySnapshot(snap) {
    if (!snap) return;
    this.doc = normalizeDoc(JSON.parse(snap));
    if (this.selectedId && !this.modifier(this.selectedId)) {
      this.selectedId = null;
      this.emit('selection');
    }
    this.emit('history');
    this.changed(true);
    this.scheduleSave();
  }

  undo() {
    this.applySnapshot(this.history.undo());
  }

  redo() {
    this.applySnapshot(this.history.redo());
  }

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('selection');
    this.emit('result');
  }

  addModifier(type, props = {}) {
    const m = { ...createModifier(type, this.doc.canvas), ...props };
    this.doc.modifiers.push(m);
    this.selectedId = m.id;
    this.changed(true);
    this.commit();
    this.emit('selection');
    return m;
  }

  removeModifier(id) {
    const idx = this.doc.modifiers.findIndex((m) => m.id === id);
    if (idx < 0) return;
    this.doc.modifiers.splice(idx, 1);
    if (this.selectedId === id) {
      this.selectedId = null;
      this.emit('selection');
    }
    this.changed(true);
    this.commit();
  }

  duplicateModifier(id) {
    const idx = this.doc.modifiers.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const copy = { ...structuredClone(this.doc.modifiers[idx]), id: newId() };
    const shift = Math.min(this.doc.canvas.width, this.doc.canvas.height) * 0.1;
    for (const k of ['x', 'x1', 'x2', 'cx']) if (typeof copy[k] === 'number' && copy.type !== 'linear') copy[k] += shift;
    this.doc.modifiers.splice(idx + 1, 0, copy);
    this.selectedId = copy.id;
    this.changed(true);
    this.commit();
    this.emit('selection');
  }

  moveModifier(id, delta) {
    const list = this.doc.modifiers;
    const idx = list.findIndex((m) => m.id === id);
    const to = clamp(idx + delta, 0, list.length - 1);
    if (idx < 0 || to === idx) return;
    const [m] = list.splice(idx, 1);
    list.splice(to, 0, m);
    this.changed(true);
    this.commit();
  }

  // --- generation --------------------------------------------------------

  regenerate() {
    const t0 = performance.now();
    this.result = generate(this.doc, { sampleImage: this.image ? this.image.sample : null });
    this.result.time = performance.now() - t0;
    this.analysis = null;
    this.emit('result');
    this.scheduleAnalysis();
  }

  scheduleAnalysis(delay = 120) {
    clearTimeout(this._analysisTimer);
    this._analysisTimer = setTimeout(() => {
      if (!this.result) return;
      const holes = this.result.holes;
      if (holes.length > 40000) return;
      this.analysis = analyzeWebs(holes, this.doc.check.minWeb);
      this.emit('analysis');
    }, delay);
  }

  // --- background image --------------------------------------------------

  setImage(image, { persist = true } = {}) {
    this.image = image;
    if (persist && this.storage) {
      try {
        if (image && image.dataUrl && image.dataUrl.length < 1_500_000) this.storage.setItem(STORAGE_IMAGE, image.dataUrl);
        else this.storage.removeItem(STORAGE_IMAGE);
      } catch {
        /* ignore */
      }
    }
    this.emit('image');
    this.changed();
  }

  savedImageUrl() {
    try {
      return this.storage ? this.storage.getItem(STORAGE_IMAGE) : null;
    } catch {
      return null;
    }
  }
}
