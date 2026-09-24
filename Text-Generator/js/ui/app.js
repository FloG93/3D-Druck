// Application state: the document, undo history, fonts and the latest model.
// Views subscribe to events:
//   'doc'        document values changed (refresh controls)
//   'structure'  text blocks added/removed (rebuild the text cards)
//   'model'      new model (redraw, 3D, status)
//   'fonts'      a font started/finished loading
//   'selection'  selected text block changed

import { defaultDoc, normalizeDoc, createText } from '../core/document.js';
import { buildModel } from '../core/model.js';
import { FontLibrary, fontKey, isSymbolLike } from '../core/fonts.js';
import { History } from '../../../shared/js/history.js';
import { safeStorage } from '../../../shared/js/util.js';

const STORAGE_DOC = 'text-generator.doc.v1';

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
    this.listeners = new Map();
    this.fonts = new FontLibrary({ builtinBase: 'fonts/' });
    this.doc = defaultDoc();
    this.history = new History();
    this.history.reset(JSON.stringify(this.doc));
    this.storage = safeStorage();
    this.model = null;
    this.selectedId = this.doc.texts[0].id;
    this.loading = new Set();
    this.fontErrors = new Map();
    this._frame = 0;
    // Symbols: the built-in selection first, other emoji on demand.
    this.symbolsLoading = 1;
    this.symbolTried = new Set();
    this.fonts.loadSymbols().catch(() => {}).then(() => {
      this.symbolsLoading--;
      this.scheduleBuild();
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  emit(event, ...args) {
    for (const fn of this.listeners.get(event) || []) fn(...args);
  }

  // --- document access ------------------------------------------------------------

  get(path) {
    return getPath(this.doc, path);
  }

  set(path, value) {
    setPath(this.doc, path, value);
    this.changed();
  }

  text(id) {
    return this.doc.texts.find((t) => t.id === id) || null;
  }

  get selected() {
    return this.text(this.selectedId) || this.doc.texts[0];
  }

  setText(id, key, value) {
    const t = this.text(id);
    if (!t) return;
    t[key] = value;
    this.changed();
  }

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('selection');
  }

  addText(overrides = {}) {
    const last = this.doc.texts[this.doc.texts.length - 1];
    const size = last ? Math.max(3, Math.round(last.size * 0.6)) : 8;
    let y = 0;
    if (last) {
      // Below the last text (its lines about lineSpacing × size / 0.7 apart),
      // with a gap of 30 % of its size.
      const lines = last.text.split('\n').length;
      const half = ((lines - 1) * last.lineSpacing * (last.size / 0.7) + last.size) / 2;
      y = Math.round((last.y - half - Math.max(2, last.size * 0.3) - size / 2) * 2) / 2;
    }
    const t = createText({
      text: 'Text',
      font: last ? { ...last.font } : undefined,
      size,
      y,
      ...overrides,
    });
    this.doc.texts.push(t);
    this.selectedId = t.id;
    this.emit('structure');
    this.changed();
    this.commit();
  }

  removeText(id) {
    if (this.doc.texts.length <= 1) return;
    this.doc.texts = this.doc.texts.filter((t) => t.id !== id);
    if (this.selectedId === id) this.selectedId = this.doc.texts[0].id;
    this.emit('structure');
    this.changed();
    this.commit();
  }

  /** Something changed: refresh controls and rebuild the model (once per frame). */
  changed() {
    this.emit('doc');
    this.scheduleBuild();
  }

  scheduleBuild() {
    if (this._frame) return;
    const run = () => {
      this._frame = 0;
      this.build();
    };
    this._frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 0);
  }

  /** Builds the model now; missing fonts are loaded and trigger a rebuild. */
  build() {
    for (const t of this.doc.texts) this.ensureFont(t.font);
    this.loadSymbolsFor(this.doc);
    this.model = buildModel(this.doc, (ref) => this.fonts.peek(ref), { symbolsLoading: this.symbolsLoading > 0 });
    this.emit('model', this.model);
    return this.model;
  }

  /** Loads emoji outlines for symbols that no loaded font has (once per character). */
  loadSymbolsFor(doc) {
    if (this.symbolsLoading) return;
    const wanted = new Set();
    for (const t of doc.texts) {
      const face = this.fonts.peek(t.font);
      if (!face) continue;
      for (const ch of t.text) {
        if (isSymbolLike(ch) && !this.symbolTried.has(ch) && !face.fontFor(ch)) wanted.add(ch);
      }
    }
    if (!wanted.size) return;
    for (const ch of wanted) this.symbolTried.add(ch);
    this.symbolsLoading++;
    this.fonts.loadEmojiFor([...wanted]).catch(() => false).then(() => {
      this.symbolsLoading--;
      this.scheduleBuild();
    });
  }

  ensureFont(ref) {
    const key = fontKey(ref);
    if (this.fonts.peek(ref) || this.loading.has(key) || this.fontErrors.has(key)) return;
    this.loading.add(key);
    this.emit('fonts');
    this.fonts.load(ref).then(() => {
      this.loading.delete(key);
      this.emit('fonts');
      this.scheduleBuild();
    }, (err) => {
      this.loading.delete(key);
      this.fontErrors.set(key, err.message);
      this.emit('fonts');
      this.emit('toast', err.message);
      this.scheduleBuild();
    });
  }

  /** Loads a font before switching to it (so the text never disappears). */
  async useFont(id, ref) {
    const key = fontKey(ref);
    this.fontErrors.delete(key);
    try {
      this.loading.add(key);
      this.emit('fonts');
      await this.fonts.load(ref);
    } catch (err) {
      this.emit('toast', err.message);
      return false;
    } finally {
      this.loading.delete(key);
      this.emit('fonts');
    }
    this.setText(id, 'font', { id: ref.id, family: ref.family, weight: ref.weight || 400, style: ref.style || 'normal' });
    this.commit();
    return true;
  }

  // --- history & persistence ----------------------------------------------------------

  commit() {
    const snap = JSON.stringify(this.doc);
    if (this.history.push(snap)) {
      this.emit('history');
      this.save(snap);
    }
  }

  save(snap = JSON.stringify(this.doc)) {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_DOC, snap);
    } catch {
      /* quota: ignore */
    }
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

  applySnapshot(snap) {
    if (!snap) return;
    this.doc = normalizeDoc(JSON.parse(snap));
    if (!this.text(this.selectedId)) this.selectedId = this.doc.texts[0].id;
    this.emit('structure');
    this.changed();
    this.emit('history');
    this.save(snap);
  }

  load(input, { keepHistory = false } = {}) {
    this.doc = normalizeDoc(input);
    this.selectedId = this.doc.texts[0].id;
    const snap = JSON.stringify(this.doc);
    if (keepHistory) this.history.push(snap);
    else this.history.reset(snap);
    this.save(snap);
    this.emit('structure');
    this.changed();
    this.emit('history');
    this.emit('fit');
  }

  undo() {
    this.applySnapshot(this.history.undo());
  }

  redo() {
    this.applySnapshot(this.history.redo());
  }
}
