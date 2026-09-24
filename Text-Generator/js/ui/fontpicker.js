// Font dialog: search all Google fonts (Fontsource catalogue), preview them
// in the browser and pick a weight.

import { h } from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { BUILTIN_FONTS, CATEGORY_NAMES, FONTSOURCE_CDN } from '../core/fonts.js';

const WEIGHT_NAMES = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};
const MAX_ROWS = 150;

export class FontDialog {
  constructor(dialog, app) {
    this.dialog = dialog;
    this.app = app;
    this.catalog = null;
    this.category = '';
    this.choice = null;
    this.previews = new Map();
    this.build();
  }

  build() {
    const d = this.dialog;
    d.innerHTML = '';
    this.search = h('input', { type: 'search', placeholder: 'Schrift suchen, z. B. „Oswald“ oder „Script“', 'aria-label': 'Schrift suchen' });
    this.search.addEventListener('input', () => this.renderList());
    this.chips = h('div', { class: 'font-chips', role: 'group', 'aria-label': 'Kategorie' });
    for (const [key, label] of [['', 'Alle'], ...Object.entries(CATEGORY_NAMES)]) {
      const b = h('button', { type: 'button', class: 'chip', 'data-cat': key }, label);
      b.addEventListener('click', () => {
        this.category = key;
        this.renderList();
      });
      this.chips.append(b);
    }
    this.list = h('div', { class: 'font-list', role: 'listbox', 'aria-label': 'Schriften' });
    this.detail = h('div', { class: 'font-detail' });
    this.apply = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Übernehmen');
    this.apply.addEventListener('click', () => this.applyChoice());
    const close = h('button', { type: 'button', class: 'icon-btn', title: 'Schließen', html: icon('close') });
    close.addEventListener('click', () => d.close());
    d.append(h('div', { class: 'dialog-inner' },
      h('div', { class: 'dialog-head' }, h('h2', {}, 'Schrift wählen'), close),
      h('div', { class: 'dialog-body font-body' }, this.search, this.chips, this.list, this.detail),
      h('div', { class: 'dialog-foot' },
        h('span', { class: 'summary' }, 'Alle Google Fonts (über Fontsource/jsDelivr) · freie Lizenzen'),
        this.apply)));
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
    this.observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) this.loadPreview(e.target);
      }, { root: this.list, rootMargin: '200px' })
      : null;
  }

  async open(textId) {
    this.textId = textId;
    this.choice = null;
    this.apply.disabled = true;
    this.detail.innerHTML = '';
    this.search.value = '';
    this.dialog.showModal();
    this.search.focus();
    this.renderList();
    if (!this.catalog) {
      try {
        this.catalog = await this.app.fonts.catalog();
      } catch (err) {
        this.catalogError = err.message;
      }
      this.renderList();
    }
  }

  sample() {
    const t = this.app.text(this.textId);
    const s = (t && t.text.split('\n')[0].trim()) || '';
    return s.slice(0, 28) || 'Anna';
  }

  entries() {
    const q = this.search.value.trim().toLowerCase();
    const cat = this.category;
    const builtin = BUILTIN_FONTS.map((f) => ({ id: f.id, family: f.family, category: f.category, weights: [f.weight], styles: ['normal'], builtin: true }));
    const all = [...builtin, ...(this.catalog || []).filter((f) => !BUILTIN_FONTS.some((b) => b.id === f.id))];
    return all.filter((f) => (!cat || f.category === cat) && (!q || f.family.toLowerCase().includes(q) || (CATEGORY_NAMES[f.category] || '').toLowerCase().includes(q)));
  }

  renderList() {
    for (const b of this.chips.children) b.classList.toggle('active', b.dataset.cat === this.category);
    const list = this.entries();
    this.list.innerHTML = '';
    if (this.observer) this.observer.disconnect();
    const sample = this.sample();
    for (const f of list.slice(0, MAX_ROWS)) {
      const preview = h('span', { class: 'font-sample' }, sample);
      const row = h('button', { type: 'button', class: 'font-item', role: 'option', 'data-id': f.id },
        h('span', { class: 'font-name' }, f.family, f.builtin ? h('span', { class: 'tag' }, 'eingebaut') : null,
          h('span', { class: 'font-cat' }, CATEGORY_NAMES[f.category] || f.category || '')),
        preview);
      row._font = f;
      row.addEventListener('click', () => this.pick(f, row));
      this.list.append(row);
      if (this.observer) this.observer.observe(row);
      else this.loadPreview(row);
    }
    if (!this.catalog && !this.catalogError) this.list.append(h('p', { class: 'ctl-note' }, 'Liste der Google Fonts wird geladen …'));
    if (this.catalogError) this.list.append(h('p', { class: 'ctl-note warn' }, `Die Liste der Google Fonts konnte nicht geladen werden (${this.catalogError}). Die eingebauten Schriften gehen trotzdem.`));
    if (list.length > MAX_ROWS) this.list.append(h('p', { class: 'ctl-note' }, `… und ${list.length - MAX_ROWS} weitere – Suche verfeinern.`));
    if (!list.length && this.catalog) this.list.append(h('p', { class: 'ctl-note' }, 'Keine Schrift gefunden.'));
  }

  /** Shows the row's sample text in its own font (loaded as a web font). */
  loadPreview(row) {
    const f = row._font;
    if (!f || row._loaded || typeof FontFace !== 'function') return;
    row._loaded = true;
    const weight = f.weights.includes(400) ? 400 : f.weights[0];
    const family = `tg-${f.id}-${weight}`;
    const apply = () => {
      const s = row.querySelector('.font-sample');
      if (s) {
        s.style.fontFamily = `"${family}", system-ui`;
        s.style.fontWeight = String(weight);
      }
    };
    if (this.previews.has(family)) {
      this.previews.get(family).then(apply, () => {});
      return;
    }
    const url = f.builtin
      ? new URL(`../../fonts/${BUILTIN_FONTS.find((b) => b.id === f.id).file}`, import.meta.url).href
      : `${FONTSOURCE_CDN}/${f.id}@latest/latin-${weight}-normal.woff2`;
    const face = new FontFace(family, `url(${url})`, { weight: String(weight) });
    const p = face.load().then((loaded) => document.fonts.add(loaded));
    this.previews.set(family, p);
    p.then(apply, () => {});
  }

  pick(f, row) {
    for (const r of this.list.querySelectorAll('.font-item.active')) r.classList.remove('active');
    row.classList.add('active');
    const weights = [...f.weights].sort((a, b) => a - b);
    const current = this.app.text(this.textId)?.font;
    let weight = current && current.id === f.id && weights.includes(current.weight) ? current.weight : null;
    if (weight === null) weight = weights.includes(700) ? 700 : weights.includes(400) ? 400 : weights[0];
    this.choice = { id: f.id, family: f.family, weight, style: 'normal' };
    this.apply.disabled = false;
    this.detail.innerHTML = '';
    if (weights.length > 1) {
      const seg = h('div', { class: 'segmented weights', role: 'group', 'aria-label': 'Strichstärke' });
      for (const w of weights) {
        const b = h('button', { type: 'button', class: `seg-btn${w === weight ? ' active' : ''}`, title: WEIGHT_NAMES[w] || String(w) }, String(w));
        b.addEventListener('click', () => {
          this.choice.weight = w;
          for (const x of seg.children) x.classList.toggle('active', x === b);
        });
        seg.append(b);
      }
      this.detail.append(h('span', { class: 'ctl-label' }, `Strichstärke von „${f.family}“ (100 dünn … 900 sehr fett) – für kleine Schrift eher 700 oder mehr`), seg);
    } else {
      this.detail.append(h('p', { class: 'ctl-note' }, `„${f.family}“ gibt es in einer Strichstärke.`));
    }
  }

  async applyChoice() {
    if (!this.choice) return;
    this.apply.disabled = true;
    this.apply.textContent = 'Lädt …';
    const ok = await this.app.useFont(this.textId, this.choice);
    this.apply.textContent = 'Übernehmen';
    this.apply.disabled = false;
    if (ok) this.dialog.close();
  }
}
