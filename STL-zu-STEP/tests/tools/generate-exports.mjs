// Converts every fixture with the pipeline and writes the STEP files plus
// summary.json for tests/tools/validate_step.py (OpenCascade reads every
// file, as Fusion 360 and FreeCAD do).
//
// Per fixture the automatic result (<name>.step) and, where it differs, the
// forced tiers (<name>-stufe1.step …). The expectations come from
// fixtures/expected.json; for tier 1 and 2 the volume of the MESH is the
// truth, not the exact volume of the part (PLAN step 6).
//
// Usage: node STL-zu-STEP/tests/tools/generate-exports.mjs <folder>

import fs from 'node:fs';
import path from 'node:path';
import { convert } from '../../js/core/pipeline.js';
import { writeStep } from '../../js/export/step.js';
import { mergeBreps } from '../../js/core/brep.js';
import { loadFixture, expected } from '../helpers.mjs';

const OUT = process.argv[2] || 'build/stl-exports';
fs.mkdirSync(OUT, { recursive: true });

const summary = {};
const all = expected();

/** The tiers that are written in addition to the automatic result. */
const FORCED = {
  'platte.stl': [1, 2, 3],
  'wuerfel.stl': [1, 2, 3],
  'loch-zwoelfeck.stl': [1, 2, 3],
  'defekt-zweikoerper.stl': [2],
  'kegel.stl': [2],
};

function write(name, result, exp, { tier, forced } = {}) {
  const breps = result.components.map((c) => c.brep);
  const open = result.components.some((c) => c.open);
  // One file, one solid per component (SPEC 5.8).
  const merged = breps.length === 1 ? breps[0] : mergeBreps(breps);
  const text = writeStep(merged, {
    name: path.basename(name, path.extname(name)),
    fileName: name,
    open,
    description: `STL-zu-STEP ${result.components.map((c) => c.tier).join('+')}`,
  });
  const file = forced ? `${name}-stufe${tier}.step` : `${name}.step`;
  fs.writeFileSync(path.join(OUT, file), text);

  const tiers = result.components.map((c) => c.tier);
  const exact = tiers.every((t) => t === 3);
  const bodies = result.components.length;
  // What the volume has to be depends on what was recognised:
  //   tier 3  → the exact volume of the part, or, where a polygon hole was
  //             recognised as a cylinder, volumen_als_zylinder (the hole is
  //             then round, which expected.json states as ground truth)
  //   tier 1/2 → the volume of the mesh, which is what those tiers reproduce
  const roundHole = exact && exp.volumen_als_zylinder !== undefined
    && result.components.some((c) => c.features.cylinders.length > 0);
  const volume = exact
    ? (roundHole ? exp.volumen_als_zylinder : exp.volumen) * bodies
    : result.components.reduce((s, c) => s + c.meshVolume, 0);
  const entry = {
    koerper: exp.koerper ?? 1,
    volumen: Number(volume.toFixed(4)),
    volumen_toleranz_prozent: exact ? 0.05 : 0.2,
    stufe: tiers.join('+'),
  };
  if (exp.toleranz_radius_prozent !== undefined) entry.toleranz_radius_prozent = exp.toleranz_radius_prozent;
  if (exact && exp.ebenen) entry.ebenen = exp.ebenen * bodies;
  if (exact && Array.isArray(exp.zylinder) && exp.zylinder.length) {
    entry.zylinder = bodies === 1 ? exp.zylinder : [...Array(bodies)].flatMap(() => exp.zylinder);
  }
  if (open) entry.erwarte_offen = true;
  summary[file] = entry;
  return { file, tiers, faces: result.components.reduce((s, c) => s + c.counts.faces, 0), bytes: text.length };
}

for (const name of Object.keys(all)) {
  const exp = all[name];
  const buffer = loadFixture(name);
  const auto = convert(buffer, name, {});
  const info = write(name, auto, exp, {});
  const forced = FORCED[name] || [];
  const extra = [];
  for (const tier of forced) {
    const result = convert(buffer, name, { tier });
    if (result.components.every((c) => c.tier === tier)) extra.push(write(name, result, exp, { tier, forced: true }).file);
  }
  console.log(`${name.padEnd(32)} Stufe ${info.tiers.join('+').padEnd(5)} ${String(info.faces).padStart(5)} Flächen  ${String(Math.round(info.bytes / 1024)).padStart(5)} kB${extra.length ? `  + ${extra.join(', ')}` : ''}`);
}

// The open shell as well: forced through the whole fallback chain, so the
// validator sees that an open result is readable and is NOT a solid (PLAN
// step 9).
const openResult = convert(loadFixture('platte.stl'), 'platte.stl', { forceFail: { tier3: true, tier2: true, tier1: true } });
const openInfo = write('platte.stl', openResult, all['platte.stl'], { tier: 'offen', forced: true });
console.log(`${'platte.stl (erzwungen offen)'.padEnd(32)} Stufe offen ${String(openInfo.faces).padStart(5)} Flächen  ${String(Math.round(openInfo.bytes / 1024)).padStart(5)} kB`);

fs.writeFileSync(path.join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
console.log(`\n${Object.keys(summary).length} STEP-Dateien nach ${OUT}`);
