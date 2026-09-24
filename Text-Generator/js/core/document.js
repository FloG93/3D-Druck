// The document is plain JSON: autosaved, shared in links and stored as presets.

import { DEFAULT_FONT } from './fonts.js';

export const DOC_VERSION = 1;

export const BASE_SHAPES = ['contour', 'rect', 'capsule', 'oval', 'circle', 'none'];
export const RELIEF_MODES = ['raised', 'engraved', 'flush', 'cut'];
export const MOUNT_TYPES = ['none', 'eyelet', 'hole'];
export const MOUNT_POSITIONS = ['left', 'right', 'top'];
export const ALIGNS = ['left', 'center', 'right'];
export const LAYOUTS = ['line', 'arcTop', 'arcBottom'];

export const TEXT_DEFAULTS = {
  text: 'Anna',
  font: { ...DEFAULT_FONT },
  size: 10, // cap height in mm
  letterSpacing: 0, // mm between letters
  lineSpacing: 1.15, // baseline distance as a multiple of the font size
  align: 'center',
  bold: 0, // stroke width change in mm (negative: thinner)
  x: 0,
  y: 0,
  rotation: 0,
  layout: 'line',
  radius: 30,
};

export const DEFAULTS = {
  base: {
    shape: 'contour', // outline around the lettering
    padding: 3, // mm around the text
    radius: 3, // corner radius (rectangle)
    sizeMode: 'auto', // or 'fixed'
    width: 90,
    height: 30,
  },
  mount: {
    type: 'eyelet', // ring outside the plate for a key ring
    position: 'left',
    diameter: 4.5,
    ring: 2,
  },
  body: {
    relief: 'raised',
    thickness: 2.4, // plate
    height: 1.2, // raised text height or engraving depth
    border: false,
    borderWidth: 1.2,
    borderHeight: 1.2,
  },
  colors: { base: '#f2f2ef', text: '#1f6feb', border: '#1f6feb' },
  // AMS filament slot per part (Bambu Studio "Filament 1, 2, …").
  slots: { base: 1, text: 2, border: 2 },
  mirror: false,
  check: { minStroke: 0.8 },
  export: { filename: 'text' },
};

let idCounter = 0;
export function newId() {
  idCounter += 1;
  return `t${Date.now().toString(36)}${idCounter}`;
}

export function createText(overrides = {}) {
  return { id: newId(), ...structuredClone(TEXT_DEFAULTS), ...overrides };
}

export function defaultDoc() {
  return {
    version: DOC_VERSION,
    name: 'Schlüsselanhänger',
    texts: [createText()],
    ...structuredClone(DEFAULTS),
  };
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function mergeSection(defaults, value) {
  const out = structuredClone(defaults);
  if (!isObject(value)) return out;
  for (const key of Object.keys(defaults)) {
    const v = value[key];
    if (v === undefined || v === null) continue;
    const d = defaults[key];
    if (typeof d === 'number') {
      const num = Number(v);
      if (Number.isFinite(num)) out[key] = num;
    } else if (typeof d === 'boolean') {
      out[key] = Boolean(v);
    } else if (typeof d === 'string') {
      out[key] = String(v);
    } else if (isObject(d)) {
      out[key] = mergeSection(d, v);
    }
  }
  return out;
}

const oneOf = (list, v, fallback) => (list.includes(v) ? v : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function normalizeFont(f) {
  if (!isObject(f) || typeof f.id !== 'string' || !f.id) return { ...DEFAULT_FONT };
  return {
    id: f.id,
    family: typeof f.family === 'string' && f.family ? f.family : f.id,
    weight: Number.isFinite(Number(f.weight)) ? Number(f.weight) : 400,
    style: f.style === 'italic' ? 'italic' : 'normal',
  };
}

export function normalizeText(t) {
  const out = mergeSection(TEXT_DEFAULTS, t);
  out.id = isObject(t) && typeof t.id === 'string' ? t.id : newId();
  out.text = isObject(t) && typeof t.text === 'string' ? t.text : TEXT_DEFAULTS.text;
  out.font = normalizeFont(isObject(t) ? t.font : null);
  out.size = clamp(out.size, 0.5, 500);
  out.lineSpacing = clamp(out.lineSpacing, 0.5, 4);
  out.align = oneOf(ALIGNS, out.align, 'center');
  out.layout = oneOf(LAYOUTS, out.layout, 'line');
  out.radius = clamp(out.radius, 1, 2000);
  return out;
}

export function normalizeDoc(input) {
  const doc = isObject(input) ? input : {};
  const out = {
    version: DOC_VERSION,
    name: typeof doc.name === 'string' ? doc.name : 'Text',
    texts: Array.isArray(doc.texts) && doc.texts.length ? doc.texts.map(normalizeText) : [createText()],
  };
  for (const key of Object.keys(DEFAULTS)) out[key] = isObject(DEFAULTS[key]) ? mergeSection(DEFAULTS[key], doc[key]) : DEFAULTS[key];
  out.mirror = Boolean(doc.mirror);
  out.base.shape = oneOf(BASE_SHAPES, out.base.shape, 'contour');
  out.base.sizeMode = out.base.sizeMode === 'fixed' ? 'fixed' : 'auto';
  out.base.padding = clamp(out.base.padding, 0, 200);
  out.base.width = clamp(out.base.width, 1, 2000);
  out.base.height = clamp(out.base.height, 1, 2000);
  out.base.radius = Math.max(0, out.base.radius);
  out.mount.type = oneOf(MOUNT_TYPES, out.mount.type, 'none');
  out.mount.position = oneOf(MOUNT_POSITIONS, out.mount.position, 'left');
  out.mount.diameter = clamp(out.mount.diameter, 0.5, 200);
  out.mount.ring = clamp(out.mount.ring, 0.4, 100);
  out.body.relief = oneOf(RELIEF_MODES, out.body.relief, 'raised');
  out.body.thickness = clamp(out.body.thickness, 0.2, 200);
  out.body.height = clamp(out.body.height, 0.1, 200);
  out.body.borderWidth = clamp(out.body.borderWidth, 0.2, 50);
  out.body.borderHeight = clamp(out.body.borderHeight, 0.1, 50);
  for (const k of Object.keys(out.slots)) out.slots[k] = Math.round(clamp(out.slots[k], 1, 16));
  for (const k of Object.keys(out.colors)) {
    if (!/^#[0-9a-f]{6}$/i.test(out.colors[k])) out.colors[k] = DEFAULTS.colors[k];
  }
  out.check.minStroke = clamp(out.check.minStroke, 0, 10);
  return out;
}
