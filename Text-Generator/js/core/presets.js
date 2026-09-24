// Built-in presets (partial documents, completed by normalizeDoc).

const font = (id, family, weight = 400) => ({ id, family, weight, style: 'normal' });
const PACIFICO = font('pacifico', 'Pacifico');
const MONTSERRAT = font('montserrat', 'Montserrat', 800);
const ROBOTO = font('roboto', 'Roboto', 700);
const BEBAS = font('bebas-neue', 'Bebas Neue');
const LOBSTER = font('lobster', 'Lobster');

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
      { text: 'Werkstatt', font: ROBOTO, size: 4, y: -9 },
    ],
    base: { shape: 'rect', padding: 4, radius: 3 },
    mount: { type: 'none' },
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
    name: 'Nur Buchstaben',
    texts: [{ text: 'Emma', font: PACIFICO, size: 16, bold: 0.4 }],
    base: { shape: 'none' },
    mount: { type: 'none' },
    body: { relief: 'raised', thickness: 3 },
    colors: { base: '#f2f2ef', text: '#ff006e', border: '#ff006e' },
  },
];
