// Built-in presets (partial documents, completed by normalizeDoc).

import { parseSVG } from './svgimport.js';

const font = (id, family, weight = 400) => ({ id, family, weight, style: 'normal' });
const PACIFICO = font('pacifico', 'Pacifico');
const MONTSERRAT = font('montserrat', 'Montserrat', 800);
const ROBOTO = font('roboto', 'Roboto', 700);
const BEBAS = font('bebas-neue', 'Bebas Neue');
const LOBSTER = font('lobster', 'Lobster');
const BLACK_OPS = font('black-ops-one', 'Black Ops One');

// Sample graphic for the logo sign: mountains with snow caps and a sun.
const MOUNTAINS = parseSVG(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 64">
  <circle cx="74" cy="15" r="9"/>
  <path d="M0 64 L32 18 L46 38 L60 24 L100 64 Z"/>
  <path fill="#fff" d="M32 18 L39.5 28.8 L35 26.5 L31.5 30 L27.5 26.5 L24.5 28.6 Z"/>
  <path fill="#fff" d="M60 24 L66 30 L62 29 L59 31 L56 28 Z"/>
</svg>`, { name: 'Berge' });

export const BUILTIN_PRESETS = [
  {
    name: 'Schlüsselanhänger',
    texts: [{ text: 'Anna', font: PACIFICO, size: 10 }],
    base: { shape: 'contour', padding: 2.6 },
    mount: { type: 'eyelet', position: 'left', diameter: 4.5, ring: 2 },
    body: { relief: 'raised', thickness: 2.4, height: 1.2 },
    colors: { base: '#f2f2ef', text: '#e63946', border: '#e63946' },
  },
  {
    name: 'Anhänger Block',
    texts: [{ text: 'MAX', font: MONTSERRAT, size: 9, letterSpacing: 0.4 }],
    base: { shape: 'contour', padding: 2.4 },
    mount: { type: 'eyelet', position: 'left', diameter: 4.5, ring: 2 },
    body: { relief: 'raised', thickness: 2.4, height: 1.2 },
    colors: { base: '#1d1d1f', text: '#ffd166', border: '#ffd166' },
  },
  {
    name: 'Namensschild',
    texts: [
      { text: 'Lena Schmidt', font: MONTSERRAT, size: 7 },
      { text: 'Werkstatt', font: MONTSERRAT, size: 4, bold: 0.1, y: -9 },
    ],
    base: { shape: 'rect', padding: 4, radius: 3 },
    mount: { type: 'slot', position: 'top', diameter: 3, length: 14, ring: 2 },
    body: { relief: 'flush', thickness: 2.4, height: 0.6, border: true, borderWidth: 1.2, borderHeight: 0.6 },
    colors: { base: '#f2f2ef', text: '#1f6feb', border: '#1f6feb' },
  },
  {
    name: 'Türschild',
    texts: [{ text: 'Familie\nMüller', font: LOBSTER, size: 16, lineSpacing: 1.05 }],
    base: { shape: 'rect', sizeMode: 'fixed', width: 150, height: 70, radius: 8 },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 3, height: 1.6, border: true, borderWidth: 2.5, borderHeight: 1.6 },
    colors: { base: '#2b2d42', text: '#edf2f4', border: '#edf2f4' },
  },
  {
    name: 'Kofferanhänger',
    texts: [{ text: 'LUKAS', font: BEBAS, size: 12, letterSpacing: 0.6 }],
    base: { shape: 'capsule', padding: 4 },
    mount: { type: 'hole', position: 'left', diameter: 5, ring: 2.5 },
    body: { relief: 'raised', thickness: 2.4, height: 1, border: true, borderWidth: 1.2, borderHeight: 1 },
    colors: { base: '#06d6a0', text: '#073b4c', border: '#073b4c' },
  },
  {
    name: 'Bündig 2-farbig',
    texts: [{ text: 'Werkzeug', font: ROBOTO, size: 8 }],
    base: { shape: 'rect', padding: 3, radius: 2 },
    mount: { type: 'hole', position: 'right', diameter: 4, ring: 2 },
    body: { relief: 'flush', thickness: 2, height: 0.6 },
    colors: { base: '#1d1d1f', text: '#f2f2ef', border: '#f2f2ef' },
  },
  {
    name: 'Oval vertieft',
    texts: [{ text: 'Garten', font: PACIFICO, size: 11 }],
    base: { shape: 'oval', padding: 2 },
    mount: { type: 'hole', position: 'top', diameter: 4, ring: 2.5 },
    body: { relief: 'engraved', thickness: 3, height: 1 },
    colors: { base: '#8ab17d', text: '#264653', border: '#264653' },
  },
  {
    name: 'Sticker-Look',
    texts: [{ text: 'Mia', font: PACIFICO, size: 13 }],
    base: { shape: 'contour', padding: 2.4 },
    mount: { type: 'eyelet', position: 'left', diameter: 4.5, ring: 2 },
    body: { relief: 'raised', thickness: 2.4, height: 1, outline: true, outlineWidth: 1.6, outlineHeight: 0.6 },
    colors: { base: '#7209b7', text: '#f72585', border: '#f72585', outline: '#ffffff' },
    slots: { base: 1, text: 2, border: 2, outline: 3 },
  },
  {
    name: 'Hundemarke',
    texts: [
      { text: 'BELLO', font: BEBAS, size: 8, letterSpacing: 0.4, y: 2.5 },
      { text: '🐾', font: BEBAS, size: 7, y: -7, slot: 3, color: '#e63946' },
      { text: '0171\n2345678', font: MONTSERRAT, size: 4.5, lineSpacing: 1.3, side: 'back' },
    ],
    base: { shape: 'circle', padding: 3 },
    mount: { type: 'eyelet', position: 'top', diameter: 4, ring: 2 },
    body: { relief: 'flush', thickness: 2.4, height: 0.6 },
    colors: { base: '#ffd166', text: '#073b4c', border: '#073b4c' },
  },
  {
    name: 'Kühlschrank-Magnet',
    texts: [{ text: 'Hallo!', font: PACIFICO, size: 12 }],
    base: { shape: 'capsule', padding: 3 },
    mount: { type: 'none' },
    magnets: { enabled: true, count: 2, diameter: 6.2, depth: 2.2 },
    body: { relief: 'raised', thickness: 3.2, height: 1.2 },
    colors: { base: '#ff6b6b', text: '#ffffff', border: '#ffffff' },
  },
  {
    name: 'Werkstattschild',
    texts: [{ text: 'WERKSTATT', font: BLACK_OPS, size: 12, letterSpacing: 0.6 }],
    base: { shape: 'rect', padding: 5, radius: 4 },
    mount: { type: 'screws', diameter: 4, ring: 3, countersink: true, head: 8 },
    body: { relief: 'raised', thickness: 4, height: 1.2, border: true, borderWidth: 2, borderHeight: 1.2 },
    colors: { base: '#1d1d1f', text: '#ffd166', border: '#ffd166' },
  },
  {
    name: 'WLAN-Schild',
    texts: [
      { text: 'WLAN', font: MONTSERRAT, size: 9, y: 24 },
      { kind: 'qr', qrMode: 'wifi', wifiSsid: 'Mein WLAN', wifiPassword: 'bitte-ändern', size: 36, y: -2 },
    ],
    base: { shape: 'rect', padding: 4, radius: 4 },
    mount: { type: 'none' },
    magnets: { enabled: true, count: 2 },
    body: { relief: 'flush', thickness: 3.4, height: 0.6 },
    colors: { base: '#f7f7f5', text: '#1d1d1f', border: '#1d1d1f' },
  },
  {
    name: 'Logo-Schild',
    texts: [
      { kind: 'graphic', graphic: MOUNTAINS, size: 18, y: 8 },
      { text: 'Berghütte', font: LOBSTER, size: 10, bold: 0.25, y: -10 },
    ],
    base: { shape: 'oval', padding: 1.5 },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 3, height: 1.2, border: true, borderWidth: 1.6, borderHeight: 1.2 },
    colors: { base: '#2d6a4f', text: '#f1faee', border: '#f1faee' },
  },
  {
    name: 'Glücksmünze',
    texts: [
      { text: 'GLÜCKS', font: MONTSERRAT, size: 4.5, letterSpacing: 0.8, layout: 'arcTop', radius: 15 },
      { text: 'MÜNZE', font: MONTSERRAT, size: 4.5, letterSpacing: 0.8, layout: 'arcBottom', radius: 15 },
      { text: '🍀', font: MONTSERRAT, size: 11 },
    ],
    base: { shape: 'circle', padding: 2.6 },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 2.4, height: 0.8, border: true, borderWidth: 1.4, borderHeight: 0.8 },
    colors: { base: '#e9c46a', text: '#6f4518', border: '#6f4518' },
  },
  {
    name: 'Kinderzimmer',
    texts: [
      { text: 'LEONIE', font: MONTSERRAT, size: 11, letterSpacing: 0.4, layout: 'bend', bend: 70, y: 6 },
      { text: '🌈', font: MONTSERRAT, size: 13, y: -12, slot: 3, color: '#ff9f1c' },
    ],
    base: { shape: 'oval', padding: 3 },
    mount: { type: 'hole', position: 'top', diameter: 4, ring: 2.5 },
    body: { relief: 'raised', thickness: 2.4, height: 1.2 },
    colors: { base: '#ffd6e0', text: '#c9184a', border: '#c9184a' },
  },
  {
    name: 'Tinten-Stempel',
    texts: [{ text: 'Mit Liebe\ngemacht', font: PACIFICO, size: 8, bold: 0.25, lineSpacing: 1.05 }],
    base: { shape: 'rect', padding: 3, radius: 3 },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 3, height: 1.5 },
    stamp: { enabled: true, kind: 'ink', draft: 0 },
    check: { minStroke: 0.8 },
    colors: { base: '#b08968', text: '#1d1d1f', border: '#1d1d1f' },
  },
  {
    name: 'Keksstempel',
    texts: [
      { text: 'DANKE', font: MONTSERRAT, size: 8 },
      { text: '♥', font: MONTSERRAT, size: 9, y: -11 },
    ],
    base: { shape: 'circle', padding: 3 },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 4, height: 2.5 },
    stamp: { enabled: true, kind: 'cookie', draft: 10 },
    check: { minStroke: 1.5 },
    colors: { base: '#f4a261', text: '#9c3d1a', border: '#9c3d1a' },
  },
  {
    name: 'Seifenstempel',
    texts: [
      { text: 'HANDMADE', font: MONTSERRAT, size: 7, letterSpacing: 0.3 },
      { text: '🌱', font: MONTSERRAT, size: 10, y: 10 },
    ],
    base: { shape: 'rect', padding: 3, radius: 3 },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 4, height: 2 },
    stamp: { enabled: true, kind: 'clay', draft: 15 },
    check: { minStroke: 1.2 },
    colors: { base: '#a3b18a', text: '#344e41', border: '#344e41' },
  },
  {
    name: 'Sprühschablone',
    texts: [{ text: 'KEINE\nWERBUNG', font: MONTSERRAT, size: 14, lineSpacing: 1.3, letterSpacing: 0.15 }],
    base: { shape: 'rect', padding: 12, radius: 3 },
    mount: { type: 'none' },
    body: { relief: 'cut', thickness: 1.2 },
    stencil: { bridge: 1.6, bridges: 2, direction: 'vertical' },
    colors: { base: '#ffb703', text: '#1d1d1f', border: '#1d1d1f' },
  },
  {
    name: 'Airbrush-Schablone',
    texts: [{ text: 'RACING 42', font: ROBOTO, size: 9, letterSpacing: 0.1 }],
    base: { shape: 'rect', padding: 8, radius: 2 },
    mount: { type: 'none' },
    body: { relief: 'cut', thickness: 0.8 },
    stencil: { bridge: 1, bridges: 1, direction: 'auto' },
    colors: { base: '#8ecae6', text: '#023047', border: '#023047' },
  },
  {
    name: 'Große Schablone',
    texts: [{ text: 'GARAGE', font: MONTSERRAT, size: 70, letterSpacing: 0.05 }],
    base: { shape: 'rect', padding: 14, radius: 4 },
    mount: { type: 'none' },
    body: { relief: 'cut', thickness: 1.2 },
    stencil: { bridge: 2, bridges: 2, direction: 'vertical', split: true, clearance: 0.2, tab: 10 },
    colors: { base: '#e9c46a', text: '#1d1d1f', border: '#1d1d1f' },
  },
  {
    name: 'Nur Buchstaben',
    texts: [{ text: 'Emma', font: PACIFICO, size: 16, bold: 0.4 }],
    base: { shape: 'none' },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 3 },
    colors: { base: '#f2f2ef', text: '#ff006e', border: '#ff006e' },
  },
];
