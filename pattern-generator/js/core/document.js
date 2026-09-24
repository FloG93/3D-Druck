// The document is plain JSON: it is autosaved, put into share links,
// stored as presets and loaded back from project files.

import { RELIEF_MODES } from './relief.js';

export const DOC_VERSION = 1;

export const DEFAULTS = {
  canvas: { width: 200, height: 200 },
  boundary: { type: 'rect', cornerRadius: 16, sides: 6, rotation: 0, margin: 8, fit: 'inside' },
  shape: {
    type: 'rect',
    width: 9,
    height: 2.6,
    round: 1,
    sides: 6,
    rotation: 0,
    minSize: 0.3,
    color: '#68a6f8',
  },
  pattern: {
    type: 'hex',
    spacingX: 12,
    spacingY: 8,
    rowShift: 0.5,
    rotation: 0,
    rotateHoles: true,
    offsetX: 0,
    offsetY: 0,
    spin: 0,
    spinMode: 'alternate',
    spinBy: 'row',
    ringSpacing: 8,
    itemSpacing: 8,
    ringCount: 0,
    centerHole: true,
    stagger: false,
    align: 'none',
    spiralSpacing: 8,
    minDistance: 8,
    seed: 1,
    // QR code and bitmap ("Bild / Logo"): cell size, gap between rows, bars
    qrText: 'https://flog93.github.io/3D-Druck/',
    qrEcc: 'M',
    module: 1.5,
    gap: 0.1,
    merge: true,
    threshold: 0.5,
    invert: false,
  },
  // cut: holes through the plate · emboss: raised ribs/bumps · deboss: grooves/pockets
  relief: { mode: 'cut', height: 1, taper: 0 },
  // plate, or a cylinder whose circumference is the canvas width (bottom: closed end in mm, 0 = open)
  form: { type: 'plate', bottom: 0 },
  check: { minWeb: 0.8, show: true },
  background: { opacity: 0.45, fit: 'cover', visible: true },
  export: {
    filename: 'muster',
    origin: 'center',
    includeBoundary: true,
    thickness: 2,
    stepMode: 'tools',
    svgStyle: 'fill',
  },
};

export const MODIFIER_DEFAULTS = {
  point: {
    x: 0, y: 0, radius: 70, falloff: 'smooth', invert: false,
    angle: 90, rotateMode: 'add', scale: 1, scaleAxis: 'both', push: 0, remove: false,
  },
  line: {
    x1: -60, y1: 0, x2: 60, y2: 0, cx: 0, cy: 40, curve: false, radius: 40, falloff: 'smooth', invert: false,
    angle: 0, rotateMode: 'tangent', scale: 1, scaleAxis: 'both', push: 0, remove: false,
  },
  linear: {
    x1: -80, y1: 0, x2: 80, y2: 0, falloff: 'linear',
    angleFrom: 0, angleTo: 0, scaleFrom: 0.4, scaleTo: 1, scaleAxis: 'both',
  },
  noise: {
    mode: 'smooth', size: 30, seed: 1, amount: 1, angle: 25, scale: 0, scaleAxis: 'both', jitter: 0, dropout: 0,
  },
  image: { invert: false, scaleMin: 0, scaleMax: 1, gamma: 1, angle: 0, scaleAxis: 'both' },
  edge: { width: 15, falloff: 'smooth', scale: 0.3, angle: 0, scaleAxis: 'both' },
};

export const MODIFIER_NAMES = {
  point: 'Punkt-Attraktor',
  line: 'Linien-Attraktor',
  linear: 'Linearer Verlauf',
  noise: 'Rauschen',
  image: 'Bildvorlage',
  edge: 'Randverlauf',
};

let idCounter = 0;
export function newId() {
  idCounter += 1;
  return `m${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Creates a modifier of the given type, placed sensibly for the canvas. */
export function createModifier(type, canvas = DEFAULTS.canvas) {
  const m = { id: newId(), type, enabled: true, ...structuredClone(MODIFIER_DEFAULTS[type]) };
  const W = canvas.width;
  const H = canvas.height;
  const s = Math.min(W, H);
  if (type === 'point') m.radius = Math.round(s * 0.35);
  if (type === 'line') {
    Object.assign(m, { x1: -W * 0.3, y1: 0, x2: W * 0.3, y2: 0, cx: 0, cy: H * 0.25, radius: Math.round(s * 0.2) });
  }
  if (type === 'linear') Object.assign(m, { x1: -W * 0.4, y1: 0, x2: W * 0.4, y2: 0 });
  if (type === 'edge') m.width = Math.round(s * 0.08);
  return m;
}

export function defaultDoc() {
  const doc = structuredClone({
    version: DOC_VERSION,
    name: 'Wirbel-Langlöcher',
    ...DEFAULTS,
  });
  doc.modifiers = [{ ...createModifier('point', doc.canvas), radius: 72 }];
  return doc;
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function mergeSection(defaults, value) {
  const out = structuredClone(defaults);
  if (!isObject(value)) return out;
  for (const key of Object.keys(defaults)) {
    const v = value[key];
    if (v === undefined || v === null) continue;
    if (typeof defaults[key] === 'number') {
      const num = Number(v);
      if (Number.isFinite(num)) out[key] = num;
    } else if (typeof defaults[key] === 'boolean') {
      out[key] = Boolean(v);
    } else if (typeof defaults[key] === 'string') {
      out[key] = String(v);
    }
  }
  return out;
}

/** Validates and completes a (possibly partial or older) document. */
export function normalizeDoc(input) {
  const src = isObject(input) ? input : {};
  const doc = { version: DOC_VERSION, name: typeof src.name === 'string' ? src.name : '' };
  for (const key of Object.keys(DEFAULTS)) doc[key] = mergeSection(DEFAULTS[key], src[key]);
  const seen = new Set();
  doc.modifiers = [];
  for (const m of Array.isArray(src.modifiers) ? src.modifiers : []) {
    if (!isObject(m) || !MODIFIER_DEFAULTS[m.type]) continue;
    const mod = { id: typeof m.id === 'string' && m.id ? m.id : newId(), type: m.type, enabled: m.enabled !== false };
    Object.assign(mod, mergeSection(MODIFIER_DEFAULTS[m.type], m));
    if (typeof m.name === 'string') mod.name = m.name;
    if (seen.has(mod.id)) mod.id = newId();
    seen.add(mod.id);
    doc.modifiers.push(mod);
  }
  if (!RELIEF_MODES.includes(doc.relief.mode)) doc.relief.mode = 'cut';
  if (doc.form.type !== 'cylinder') doc.form.type = 'plate';
  doc.form.bottom = Math.max(doc.form.bottom, 0);
  doc.canvas.width = Math.min(Math.max(doc.canvas.width, 1), 5000);
  doc.canvas.height = Math.min(Math.max(doc.canvas.height, 1), 5000);
  return doc;
}
