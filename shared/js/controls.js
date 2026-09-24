// Tiny declarative control library shared by all tools. Every control is
// bound to a getter/setter pair and registers an update function with its
// Panel, so the whole UI can be refreshed from the document after undo,
// presets or canvas drags.

import { icon } from './icons.js';

let uid = 0;
const nextId = (p = 'c') => `${p}${++uid}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Prefix for persisted UI state (e.g. which sections are open), per tool.
let storagePrefix = 'ui';
export function setStoragePrefix(prefix) {
  storagePrefix = prefix;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const bindPath = (app, path) => ({
  get: () => app.get(path),
  set: (v) => app.set(path, v),
});

export const bindModifier = (app, id, key) => ({
  get: () => app.modifier(id)?.[key],
  set: (v) => app.setModifier(id, key, v),
});

export function formatNumber(v, digits = 2) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return String(r === 0 ? 0 : r);
}

/** Collects controls so they can be refreshed together. */
export class Panel {
  constructor(app) {
    this.app = app;
    this.items = [];
  }

  register(el, update, visible) {
    this.items.push({ el, update, visible });
    return el;
  }

  refresh() {
    for (const it of this.items) {
      if (it.visible) {
        const show = !!it.visible();
        if (it.el.hidden === show) it.el.hidden = !show;
        if (!show) continue;
      }
      if (it.update) it.update();
    }
  }

  /** Removes items whose elements are no longer in the document. */
  prune() {
    this.items = this.items.filter((it) => it.el.isConnected);
  }
}

/**
 * Number input with optional slider and label scrubbing.
 * opts: { label, bind, unit, min, max, step, digits, slider: [lo, hi], title, visible, percent }
 */
export function numberField(panel, opts) {
  const { app } = panel;
  const id = nextId('n');
  const step = opts.step ?? 1;
  const digits = opts.digits ?? 2;
  const min = opts.min ?? -Infinity;
  const max = opts.max ?? Infinity;
  const k = opts.percent ? 100 : 1; // display factor
  const input = h('input', {
    id,
    type: 'number',
    inputmode: 'decimal',
    step: String(step),
    min: Number.isFinite(min) ? String(min * k) : null,
    max: Number.isFinite(max) ? String(max * k) : null,
  });
  const label = h('label', { class: 'ctl-label scrub', for: id, title: opts.title || null }, opts.label);
  const field = h('div', { class: 'ctl-field' }, input, opts.unit ? h('span', { class: 'unit' }, opts.unit) : null);
  let slider = null;
  if (opts.slider) {
    const [lo, hi] = opts.slider;
    slider = h('input', {
      type: 'range',
      class: 'ctl-slider',
      min: String(lo * k),
      max: String(hi * k),
      step: String(opts.sliderStep ?? step),
      'aria-label': opts.label,
    });
  }
  const el = h('div', { class: `ctl ctl-number${opts.wide ? ' wide' : ''}` }, label, field, slider);

  const apply = (displayValue, commit) => {
    let v = displayValue / k;
    if (!Number.isFinite(v)) return;
    v = clamp(Math.round(v * 1e9) / 1e9, min, max);
    opts.bind.set(v);
    if (opts.onInput) opts.onInput(v);
    if (commit) app.commit();
  };
  input.addEventListener('input', () => {
    if (input.value === '' || input.value === '-') return;
    apply(parseFloat(input.value.replace(',', '.')), false);
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) apply(v, true);
    update(true);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  if (slider) {
    slider.addEventListener('input', () => apply(parseFloat(slider.value), false));
    slider.addEventListener('change', () => app.commit());
  }

  // Drag the label horizontally to change the value (Shift = x10, Alt = /10).
  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startV = (opts.bind.get() ?? 0) * k;
    let moved = false;
    label.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const factor = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const raw = startV + Math.round(dx / 4) * step * factor;
      apply(Math.round(raw * 1e6) / 1e6, false);
    };
    const onUp = () => {
      label.removeEventListener('pointermove', onMove);
      label.removeEventListener('pointerup', onUp);
      label.removeEventListener('pointercancel', onUp);
      if (moved) app.commit();
      else input.focus();
    };
    label.addEventListener('pointermove', onMove);
    label.addEventListener('pointerup', onUp);
    label.addEventListener('pointercancel', onUp);
  });

  const update = (force = false) => {
    const v = opts.bind.get();
    const shown = formatNumber((v ?? 0) * k, digits);
    if (force || document.activeElement !== input) {
      if (input.value !== shown) input.value = shown;
    }
    if (slider && document.activeElement !== slider) slider.value = String((v ?? 0) * k);
  };
  return panel.register(el, update, opts.visible);
}

/** Select box. opts: { label, bind, options: [[value, text]], visible } */
export function selectField(panel, opts) {
  const id = nextId('s');
  const select = h('select', { id }, opts.options.map(([v, t]) => h('option', { value: v }, t)));
  const el = h('div', { class: `ctl ctl-select${opts.wide === false ? '' : ' wide'}` },
    opts.label ? h('label', { class: 'ctl-label', for: id }, opts.label) : null,
    h('div', { class: 'ctl-field' }, select));
  select.addEventListener('change', () => {
    const raw = select.value;
    const v = typeof opts.bind.get() === 'number' ? Number(raw) : raw;
    opts.bind.set(v);
    panel.app.commit();
    if (opts.onChange) opts.onChange(v);
  });
  return panel.register(el, () => {
    const v = String(opts.bind.get());
    if (select.value !== v) select.value = v;
  }, opts.visible);
}

/** Segmented buttons. opts: { label, bind, options: [[value, text, iconName?, title?]] } */
export function segmented(panel, opts) {
  const buttons = opts.options.map(([v, text, ic, title]) => {
    const b = h('button', {
      type: 'button',
      class: 'seg-btn',
      title: title || (ic ? text : null),
      'data-value': String(v),
      html: `${ic ? icon(ic) : ''}${ic && opts.iconOnly ? '' : `<span>${text}</span>`}`,
    });
    b.addEventListener('click', () => {
      opts.bind.set(v);
      panel.app.commit();
      if (opts.onChange) opts.onChange(v);
    });
    return b;
  });
  const group = h('div', { class: `segmented${opts.iconOnly ? ' icon-only' : ''}`, role: 'group' }, buttons);
  const el = h('div', { class: 'ctl ctl-seg wide' }, opts.label ? h('span', { class: 'ctl-label' }, opts.label) : null, group);
  return panel.register(el, () => {
    const v = String(opts.bind.get());
    for (const b of buttons) b.classList.toggle('active', b.dataset.value === v);
  }, opts.visible);
}

/** On/off switch. opts: { label, bind, title, visible } */
export function toggle(panel, opts) {
  const id = nextId('t');
  const input = h('input', { id, type: 'checkbox', role: 'switch' });
  const el = h('label', { class: 'ctl ctl-toggle wide', for: id, title: opts.title || null },
    input, h('span', { class: 'switch', 'aria-hidden': 'true' }), h('span', { class: 'ctl-text' }, opts.label));
  input.addEventListener('change', () => {
    opts.bind.set(input.checked);
    panel.app.commit();
    if (opts.onChange) opts.onChange(input.checked);
  });
  return panel.register(el, () => {
    const v = !!opts.bind.get();
    if (input.checked !== v) input.checked = v;
  }, opts.visible);
}

/** Single-line text input. opts: { label, bind, placeholder, maxlength, visible } */
export function textField(panel, opts) {
  const id = nextId('txt');
  const input = h('input', {
    id,
    type: 'text',
    spellcheck: 'false',
    placeholder: opts.placeholder || null,
    maxlength: opts.maxlength ? String(opts.maxlength) : null,
  });
  const el = h('div', { class: 'ctl ctl-textfield wide' }, h('label', { class: 'ctl-label', for: id }, opts.label),
    h('div', { class: 'ctl-field' }, input));
  input.addEventListener('input', () => opts.bind.set(input.value));
  input.addEventListener('change', () => panel.app.commit());
  return panel.register(el, () => {
    const v = String(opts.bind.get() ?? '');
    if (document.activeElement !== input && input.value !== v) input.value = v;
  }, opts.visible);
}

/** Colour picker with hex label. */
export function colorField(panel, opts) {
  const id = nextId('col');
  const input = h('input', { id, type: 'color' });
  const hex = h('span', { class: 'hex' });
  const el = h('div', { class: 'ctl ctl-color' }, h('label', { class: 'ctl-label', for: id }, opts.label),
    h('div', { class: 'ctl-field color-field' }, input, hex));
  input.addEventListener('input', () => opts.bind.set(input.value));
  input.addEventListener('change', () => panel.app.commit());
  return panel.register(el, () => {
    const v = opts.bind.get() || '#000000';
    if (input.value !== v) input.value = v;
    hex.textContent = v.toUpperCase();
  }, opts.visible);
}

/** Row of buttons. items: [{ label, icon, onClick, title, primary }] */
export function buttonRow(panel, items, visible) {
  const el = h('div', { class: 'ctl ctl-buttons wide' }, items.map((it) => {
    const b = h('button', {
      type: 'button',
      class: `btn small${it.primary ? ' primary' : ''}`,
      title: it.title || null,
      html: `${it.icon ? icon(it.icon) : ''}${it.label ? `<span>${it.label}</span>` : ''}`,
    });
    b.addEventListener('click', it.onClick);
    return b;
  }));
  return panel.register(el, null, visible);
}

/** Static or dynamic note text. */
export function note(panel, text, visible, cls = '') {
  const el = h('p', { class: `ctl-note wide ${cls}` });
  const update = () => {
    const t = typeof text === 'function' ? text() : text;
    if (el.innerHTML !== t) el.innerHTML = t;
  };
  return panel.register(el, update, visible);
}

/** Two-column grid wrapper. */
export function grid(...children) {
  return h('div', { class: 'ctl-grid' }, children);
}

/** Collapsible section with persisted open state. */
export function section(title, { id, icon: ic, actions = [], open = true } = {}) {
  const key = id ? `${storagePrefix}.section.${id}` : null;
  let isOpen = open;
  try {
    if (key && localStorage.getItem(key) !== null) isOpen = localStorage.getItem(key) === '1';
  } catch {
    /* ignore */
  }
  const body = h('div', { class: 'section-body' });
  const chevron = h('span', { class: 'chevron', html: icon('chevron') });
  const head = h('button', { type: 'button', class: 'section-head', 'aria-expanded': String(isOpen) },
    ic ? h('span', { class: 'section-icon', html: icon(ic) }) : null,
    h('span', { class: 'section-title' }, title), chevron);
  const actionBox = h('div', { class: 'section-actions' }, actions);
  const el = h('section', { class: `section${isOpen ? ' open' : ''}`, id: id ? `sec-${id}` : null },
    h('div', { class: 'section-header' }, head, actionBox), body);
  head.addEventListener('click', () => {
    isOpen = !el.classList.contains('open');
    el.classList.toggle('open', isOpen);
    head.setAttribute('aria-expanded', String(isOpen));
    try {
      if (key) localStorage.setItem(key, isOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
  return { el, body };
}
