// Writes 3MF, STL and DXF files of all presets (and a few variants) into a
// folder for validation with tests/tools/validate_exports.py (lib3mf,
// ezdxf), plus the top view of every QR code (qr.json) to be read back with
// zxing.
// Usage: node Text-Generator/tests/tools/generate-exports.mjs <folder>
import fs from 'node:fs';
import { normalizeDoc, defaultDoc } from '../../js/core/document.js';
import { buildModel } from '../../js/core/model.js';
import { qrContent } from '../../js/core/blocks.js';
import { parseSVG } from '../../js/core/svgimport.js';
import { BUILTIN_PRESETS } from '../../js/core/presets.js';
import { modelMeshes, flipMeshes, spreadPieces, toBinarySTL } from '../../js/export/mesh.js';
import { export3MF } from '../../js/export/threemf.js';
import { exportDXF, dxfLayers } from '../../js/export/dxf.js';
import { regionArea } from '../../js/core/geometry.js';
import { loadFonts } from '../helpers.mjs';

const OUT = process.argv[2] || 'build/text-exports';
fs.mkdirSync(OUT, { recursive: true });
const lib = await loadFonts();
const cases = Object.fromEntries(BUILTIN_PRESETS.map((p, i) => [`preset${i + 1}`, p]));
cases.engraved_border = { ...defaultDoc(), base: { shape: 'capsule' }, body: { relief: 'engraved', border: true } };
cases.flush_two_lines = { ...defaultDoc(), texts: [{ text: 'Zwei\nZeilen', size: 8 }], base: { shape: 'rect' }, body: { relief: 'flush', thickness: 2, height: 0.6 } };
const roboto = { id: 'roboto', family: 'Roboto', weight: 700, style: 'normal' };
cases.screws_flush_border = { ...defaultDoc(), texts: [{ text: 'Werkstatt', font: roboto, size: 12 }], base: { shape: 'rect' }, mount: { type: 'screws', diameter: 4, head: 8 }, body: { relief: 'flush', thickness: 4, height: 0.6, border: true } };
cases.screws_contour = { ...defaultDoc(), mount: { type: 'screws', diameter: 3.5, head: 7 }, body: { thickness: 3.2 } };
cases.slot_capsule = { ...defaultDoc(), base: { shape: 'capsule' }, mount: { type: 'slot', position: 'left', diameter: 3, length: 14 } };
cases.magnets_outline = { ...defaultDoc(), base: { shape: 'rect' }, magnets: { enabled: true, count: 2 }, body: { thickness: 3.2, outline: true } };
cases.outline_flush = { ...defaultDoc(), base: { shape: 'oval' }, body: { relief: 'flush', thickness: 2.4, height: 0.6, outline: true, border: true } };
cases.colors_symbols = {
  ...defaultDoc(),
  texts: [
    { text: 'Bello', font: roboto, size: 9, y: 3 },
    { text: '🐾 ♥ ⭐', font: roboto, size: 5, y: -8, slot: 4, color: '#ffd166' },
  ],
  base: { shape: 'circle' },
  mount: { type: 'eyelet', position: 'top' },
};
cases.flipped_flush = { ...cases.outline_flush, export: { flip: true } };
const montserrat = { id: 'montserrat', family: 'Montserrat', weight: 800, style: 'normal' };
cases.qr_contour_raised = {
  ...defaultDoc(),
  texts: [{ kind: 'qr', qrText: 'https://flog93.github.io/3D-Druck/Text-Generator/', size: 30, qrLevel: 'Q' }],
  base: { shape: 'contour', padding: 2 },
  mount: { type: 'hole', position: 'top' },
  colors: { base: '#ffffff', text: '#000000' },
};
cases.qr_back_engraved_magnets = {
  ...defaultDoc(),
  texts: [
    { text: 'Küche', font: montserrat, size: 10 },
    { kind: 'qr', qrText: 'Grüße vom Kühlschrank – 3D-Druck', size: 26, side: 'back', x: 4 },
  ],
  base: { shape: 'rect', sizeMode: 'fixed', width: 90, height: 44, radius: 4 },
  mount: { type: 'none' },
  magnets: { enabled: true, count: 2 },
  back: { relief: 'inlay', depth: 0.6 },
  body: { thickness: 3.4 },
};
cases.qr_dots_logo_symbol = {
  ...defaultDoc(),
  texts: [{ kind: 'qr', qrText: 'https://flog93.github.io/3D-Druck/', size: 32, qrStyle: 'dots', qrLogo: 'symbol', qrLogoSymbol: '♥' }],
  base: { shape: 'rect', padding: 3 },
  mount: { type: 'none' },
  body: { relief: 'flush', thickness: 2.4, height: 0.6 },
  colors: { base: '#ffffff', text: '#000000' },
};
cases.qr_logo_graphic = {
  ...defaultDoc(),
  texts: [{
    kind: 'qr',
    qrMode: 'wifi',
    wifiSsid: 'Café Sonnenschein',
    wifiPassword: 'Kaffee&Kuchen!',
    size: 34,
    qrLogo: 'graphic',
    qrLogoSize: 0.3,
    qrLogoGraphic: parseSVG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 21h18v-2H3zM20 8h-2V5h2zm0-5H4v10a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-3h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg>', { name: 'tasse' }),
  }],
  base: { shape: 'rect', padding: 3 },
  mount: { type: 'none' },
  body: { relief: 'raised', thickness: 2.4, height: 1 },
  colors: { base: '#ffffff', text: '#000000' },
};
cases.back_engraved = {
  ...defaultDoc(),
  texts: [{ text: 'Vorne', font: roboto, size: 10 }, { text: 'Hinten 123', font: roboto, size: 6, side: 'back' }],
  base: { shape: 'capsule' },
  back: { relief: 'engraved', depth: 0.8 },
  body: { relief: 'flush', thickness: 2.4, height: 0.6 },
};
cases.graphic_strokes = {
  ...defaultDoc(),
  texts: [{
    kind: 'graphic',
    size: 24,
    graphic: parseSVG(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>
      <circle cx="12" cy="11" r="2" fill="#000"/></svg>`, { name: 'herz' }),
  }],
  base: { shape: 'circle', padding: 3 },
  mount: { type: 'eyelet', position: 'top' },
};
cases.flipped_letters = { ...defaultDoc(), base: { shape: 'none' }, texts: [{ text: 'Emma', font: roboto, size: 14 }], export: { flip: true } };
cases.stencil_bridges = {
  ...defaultDoc(),
  texts: [{ text: 'ABOBAD 08 &', font: montserrat, size: 20 }],
  base: { shape: 'rect', padding: 10 },
  mount: { type: 'none' },
  body: { relief: 'cut', thickness: 1.2 },
  stencil: { bridge: 1.4, bridges: 2, direction: 'vertical' },
};
cases.stencil_mirrored_holes = {
  ...defaultDoc(),
  texts: [{ text: 'Paket 8', font: roboto, size: 16 }],
  base: { shape: 'rect', padding: 12 },
  mount: { type: 'screws', diameter: 4, head: 8, countersink: false },
  body: { relief: 'cut', thickness: 1.2 },
  stencil: { bridges: 1, direction: 'auto' },
  mirror: true,
};
// Too big for the bed: 4 × 2 pieces with puzzle connectors, one object each.
cases.stencil_split_grid = {
  ...defaultDoc(),
  texts: [{ text: 'PRIVAT\nPARKPLATZ', font: roboto, size: 60 }],
  base: { shape: 'rect', padding: 12, radius: 3 },
  mount: { type: 'none' },
  body: { relief: 'cut', thickness: 1.2 },
  check: { bed: 180 },
  export: { flip: true },
};
// A cup with engraved lettering and a text all around, cut off at the seam.
cases.cup_engraved = {
  ...defaultDoc(),
  texts: [{ text: 'Werkzeug · Stifte · Pinsel · Kleber', font: roboto, size: 12 }],
  base: { shape: 'cup' },
  mount: { type: 'none' },
  cup: { diameter: 60, height: 80, bottom: 2 },
  body: { relief: 'engraved', thickness: 2.4, height: 1 },
};
const summary = {};
const qr = {};
// Rings in mm; mirrored ones are also reversed, so outer rings stay
// counter-clockwise and holes clockwise.
const ringsOf = (region, mirror) => region.flatMap((s) => [s.outer, ...s.holes]).map((r) => {
  const pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push([Math.round((mirror ? -r[i] : r[i]) * 1e4) / 1e4, Math.round(r[i + 1] * 1e4) / 1e4]);
  if (mirror) pts.reverse();
  return pts.flat();
});
for (const [name, input] of Object.entries(cases)) {
  const doc = normalizeDoc(input);
  const model = buildModel(doc, (ref) => lib.peek(ref));
  // QR codes as seen on their side (the back from behind), dark on white.
  for (const block of doc.texts.filter((b) => b.kind === 'qr')) {
    const back = block.side === 'back';
    const dark = back ? model.backText : model.text;
    const lay = model.layouts.find((l) => l.block === block);
    qr[`${name}_${block.id}`] = { content: qrContent(block), module: lay.qr.module, dark: ringsOf(dark, back) };
  }
  if (model.missing.size || model.pending) throw new Error(`${name}: fehlende Zeichen ${[...model.missing].join(' ')}`);
  let meshes = modelMeshes(model);
  if (model.pieces.length) meshes = spreadPieces(meshes);
  if (input.export?.flip) {
    if (!model.flippable) throw new Error(`${name}: lässt sich nicht umdrehen`);
    meshes = flipMeshes(meshes, model.stats.top);
  }
  const title = name.startsWith('preset') ? input.name : name;
  fs.writeFileSync(`${OUT}/${name}.3mf`, await export3MF(meshes, { title }));
  fs.writeFileSync(`${OUT}/${name}.stl`, toBinarySTL(meshes));
  // Top view as DXF: the area of every layer (outer rings minus holes).
  fs.writeFileSync(`${OUT}/${name}.dxf`, exportDXF(model));
  const dxf = Object.fromEntries(dxfLayers(model).map(([layer, , region]) => [layer, regionArea(region)]));
  // One 3MF object, or one per stencil piece plus a stamp's handle.
  const objects = new Set(model.parts.map((p) => p.object ?? p.piece ?? 0)).size;
  summary[name] = { title, objects, parts: model.parts.map((p) => ({ name: p.name, slot: p.slot, volume: p.volume })), dxf };
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
fs.writeFileSync(`${OUT}/qr.json`, JSON.stringify(qr));
console.log(`${Object.keys(summary).length} Fälle nach ${OUT} geschrieben`);
