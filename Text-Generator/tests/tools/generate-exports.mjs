// Writes 3MF and STL files of all presets (and a few variants) into a folder
// for validation with tests/tools/validate_exports.py (lib3mf).
// Usage: node Text-Generator/tests/tools/generate-exports.mjs <folder>
import fs from 'node:fs';
import { normalizeDoc, defaultDoc } from '../../js/core/document.js';
import { buildModel } from '../../js/core/model.js';
import { BUILTIN_PRESETS } from '../../js/core/presets.js';
import { modelMeshes, flipMeshes, toBinarySTL } from '../../js/export/mesh.js';
import { export3MF } from '../../js/export/threemf.js';
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
cases.flipped_letters = { ...defaultDoc(), base: { shape: 'none' }, texts: [{ text: 'Emma', font: roboto, size: 14 }], export: { flip: true } };
const summary = {};
for (const [name, input] of Object.entries(cases)) {
  const model = buildModel(normalizeDoc(input), (ref) => lib.peek(ref));
  if (model.missing.size || model.pending) throw new Error(`${name}: fehlende Zeichen ${[...model.missing].join(' ')}`);
  let meshes = modelMeshes(model);
  if (input.export?.flip) {
    if (!model.flippable) throw new Error(`${name}: lässt sich nicht umdrehen`);
    meshes = flipMeshes(meshes, model.stats.top);
  }
  const title = name.startsWith('preset') ? input.name : name;
  fs.writeFileSync(`${OUT}/${name}.3mf`, await export3MF(meshes, { title }));
  fs.writeFileSync(`${OUT}/${name}.stl`, toBinarySTL(meshes));
  summary[name] = { title, parts: model.parts.map((p) => ({ name: p.name, slot: p.slot, volume: p.volume })) };
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(`${Object.keys(summary).length} Fälle nach ${OUT} geschrieben`);
