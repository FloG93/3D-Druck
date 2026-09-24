// Writes 3MF and STL files of all presets (and a few variants) into a folder
// for validation with tests/tools/validate_exports.py (lib3mf).
// Usage: node Text-Generator/tests/tools/generate-exports.mjs <folder>
import fs from 'node:fs';
import { normalizeDoc, defaultDoc } from '../../js/core/document.js';
import { buildModel } from '../../js/core/model.js';
import { BUILTIN_PRESETS } from '../../js/core/presets.js';
import { modelMeshes, toBinarySTL } from '../../js/export/mesh.js';
import { export3MF } from '../../js/export/threemf.js';
import { loadFonts } from '../helpers.mjs';

const OUT = process.argv[2] || 'build/text-exports';
fs.mkdirSync(OUT, { recursive: true });
const lib = await loadFonts();
const cases = Object.fromEntries(BUILTIN_PRESETS.map((p, i) => [`preset${i + 1}`, p]));
cases.engraved_border = { ...defaultDoc(), base: { shape: 'capsule' }, body: { relief: 'engraved', border: true } };
cases.flush_two_lines = { ...defaultDoc(), texts: [{ text: 'Zwei\nZeilen', size: 8 }], base: { shape: 'rect' }, body: { relief: 'flush', thickness: 2, height: 0.6 } };
const summary = {};
for (const [name, input] of Object.entries(cases)) {
  const model = buildModel(normalizeDoc(input), (ref) => lib.peek(ref));
  const meshes = modelMeshes(model);
  fs.writeFileSync(`${OUT}/${name}.3mf`, await export3MF(meshes, { title: input.name || name }));
  fs.writeFileSync(`${OUT}/${name}.stl`, toBinarySTL(meshes));
  summary[name] = { title: input.name || name, parts: model.parts.map((p) => ({ name: p.name, slot: p.slot, volume: p.volume })) };
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(`${Object.keys(summary).length} Fälle nach ${OUT} geschrieben`);
