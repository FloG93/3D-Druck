// Application state: the document, undo history, fonts and the latest model.
// Views subscribe to events:
//   'doc'        document values changed (refresh controls)
//   'structure'  text blocks added/removed (rebuild the text cards)
//   'model'      new model (redraw, 3D, status)
//   'fonts'      a font started/finished loading
//   'selection'  selected text block changed

import { defaultDoc, normalizeDoc, createBlock } from '../core/document.js';
import { buildModel } from '../core/model.js';
import { seriesNames, seriesTarget } from '../core/series.js';
import { FontLibrary, fontKey, isSymbolLike, DEFAULT_FONT } from '../core/fonts.js';
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

  /** Height of a block's content in mm (for placing the next one below it). */
  static blockHeight(b) {
    if (b.kind === 'qr') return b.size + 2 * (b.quiet || 0) * (b.size / 25);
    if (b.kind === 'graphic') return b.size;
    // Lines about lineSpacing × size / 0.7 apart (cap height ≈ 0.7 em).
    const lines = b.text.split('\n').length;
    return (lines - 1) * b.lineSpacing * (b.size / 0.7) + b.size;
  }

  /** Adds a text, QR code or graphic below the last block of the front. */
  addBlock(kind = 'text', overrides = {}) {
    const front = this.doc.texts.filter((b) => b.side !== 'back');
    const last = front[front.length - 1];
    const lastText = [...this.doc.texts].reverse().find((b) => b.kind === 'text');
    const extra = {};
    let size;
    if (kind === 'text') {
      size = last && last.kind === 'text' ? Math.max(3, Math.round(last.size * 0.6)) : 8;
      extra.text = 'Text';
      if (lastText) extra.font = { ...lastText.font };
    } else {
      size = kind === 'qr' ? 30 : 20;
    }
    const block = createBlock(kind, { ...extra, size, ...overrides });
    if (last) {
      const gap = Math.max(2, (last.kind === 'text' ? last.size : 10) * 0.3);
      block.y = Math.round((last.y - App.blockHeight(last) / 2 - gap - App.blockHeight(block) / 2) * 2) / 2;
      block.x = kind === 'text' ? 0 : last.x;
    }
    this.doc.texts.push(block);
    this.selectedId = block.id;
    this.emit('structure');
    this.changed();
    this.commit();
    return block;
  }

  addText(overrides = {}) {
    return this.addBlock('text', overrides);
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
    for (const t of this.doc.texts) {
      if (t.kind === 'text') this.ensureFont(t.font);
      // Symbols in a QR code are laid out with the default font.
      else if (t.kind === 'qr' && t.qrLogo === 'symbol') this.ensureFont(DEFAULT_FONT);
    }
    this.loadSymbolsFor(this.doc);
    // Symbols in the names of a series (a heart after the name …).
    const names = seriesNames(this.doc);
    const target = this.doc.texts[seriesTarget(this.doc)];
    if (names.length && target) this.loadSymbolsFor({ texts: [{ kind: 'text', font: target.font, text: names.join(' ') }] });
    this.model = buildModel(this.doc, (ref) => this.fonts.peek(ref), { symbolsLoading: this.symbolsLoading > 0 });
    this.emit('model', this.model);
    return this.model;
  }

  /** Loads emoji outlines for symbols that no loaded font has (once per character). */
  loadSymbolsFor(doc) {
    if (this.symbolsLoading) return;
    const wanted = new Set();
    for (const t of doc.texts) {
      if (t.kind !== 'text') continue;
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

  /** Folds a follow-up change into the last step, so one undo takes back both. */
  amend() {
    const snap = JSON.stringify(this.doc);
    this.history.replace(snap);
    this.emit('history');
    this.save(snap);
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
