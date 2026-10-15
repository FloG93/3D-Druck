// Runs real files through the pipeline and prints what came out: time per
// step, repairs, recognised features, tier, volume and STEP size. This is the
// tool for step 11 of docs/PLAN.md (the reality test) – the test corpus is
// synthetic, so every real file is measured here before it becomes a fixture.
//
// Usage: node STL-zu-STEP/tests/tools/measure.mjs <files…> [--json out.json] [--step <folder>]
//
// Files given on the command line are read as data and never executed.

import fs from 'node:fs';
import path from 'node:path';
import { convert } from '../../js/core/pipeline.js';
import { writeStep } from '../../js/export/step.js';
import { mergeBreps } from '../../js/core/brep.js';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const jsonOut = option('json');
const stepDir = option('step');
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || args[i - 1] !== '--json') && (i === 0 || args[i - 1] !== '--step'));
if (files.length === 0) {
  console.error('Keine Datei angegeben.');
  process.exit(2);
}
if (stepDir) fs.mkdirSync(stepDir, { recursive: true });

const de = (v, digits = 2) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '–');
const out = [];

for (const file of files) {
  const name = path.basename(file);
  const bytes = fs.readFileSync(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const timings = [];
  let last = performance.now();
  const start = last;
  const record = {};
  try {
    const result = convert(buffer, name, {}, (p) => {
      const now = performance.now();
      timings.push([p.key, Math.round(now - last)]);
      last = now;
    });
    const total = performance.now() - start;
    const breps = result.components.map((c) => c.brep);
    const text = writeStep(breps.length === 1 ? breps[0] : mergeBreps(breps), { name, open: result.components.some((c) => c.open) });
    if (stepDir) fs.writeFileSync(path.join(stepDir, `${name}.step`), text);

    const heal = result.healReport;
    const repairs = Object.entries({
      entartet: heal.degenerate,
      doppelt: heal.duplicate,
      tKreuzungen: heal.tJunctionsSplit,
      nichtmanifold: heal.nonManifoldRemoved,
      gedreht: heal.flipped,
      geloecherGefuellt: heal.holesFilled,
      loecherOffen: heal.holesOpen.length,
    }).filter(([, v]) => v > 0);
    const cylinders = result.components.flatMap((c) => c.features.cylinders);
    Object.assign(record, {
      datei: name,
      dreiecke: result.triangles,
      punkte: heal.points,
      koerper: result.components.length,
      stufen: result.components.map((c) => c.tier),
      flaechen: result.components.reduce((s, c) => s + c.counts.faces, 0),
      zylinder: cylinders.length,
      radien: cylinders.map((c) => Number(c.radius.toFixed(3))).sort((a, b) => a - b).slice(0, 12),
      verworfen: result.components.reduce((s, c) => s + c.features.rejected.length, 0),
      reparaturen: Object.fromEntries(repairs),
      netzvolumen: Number(result.meshVolume.toFixed(3)),
      brepvolumen: Number(result.components.reduce((s, c) => s + c.brepVolume, 0).toFixed(3)),
      abweichungProzent: Number((result.components.reduce((s, c) => s + c.deviationPercent, 0) / result.components.length).toFixed(4)),
      stepKB: Math.round(text.length / 1024),
      msGesamt: Math.round(total),
      msJeSchritt: Object.fromEntries(timings),
      warnungen: result.warnings,
      rueckfall: result.components.flatMap((c) => c.fallbackReasons),
    });
  } catch (err) {
    record.datei = name;
    record.fehler = err.message;
    record.msGesamt = Math.round(performance.now() - start);
  }
  out.push(record);

  // One block per file, so a failure is readable without the JSON.
  console.log(`\n=== ${record.datei}`);
  if (record.fehler) {
    console.log(`    FEHLER: ${record.fehler}  (${record.msGesamt} ms)`);
    continue;
  }
  console.log(`    ${de(record.dreiecke, 0)} Dreiecke, ${de(record.punkte, 0)} Punkte, ${record.koerper} Körper`);
  console.log(`    Stufe ${record.stufen.join('+')}, ${de(record.flaechen, 0)} Flächen, ${record.zylinder} Zylinder${record.radien.length ? ` (r = ${record.radien.join(', ')})` : ''}, ${record.verworfen} Kandidaten verworfen`);
  console.log(`    Volumen ${de(record.brepvolumen)} gegen Netz ${de(record.netzvolumen)} (${record.abweichungProzent >= 0 ? '+' : ''}${record.abweichungProzent} %)`);
  if (Object.keys(record.reparaturen).length) console.log(`    Reparaturen: ${JSON.stringify(record.reparaturen)}`);
  if (record.warnungen.length) console.log(`    Warnungen: ${record.warnungen.join(' | ')}`);
  if (record.rueckfall.length) console.log(`    Rückfall: ${record.rueckfall.map((r) => r.slice(0, 120)).join(' | ')}`);
  console.log(`    ${record.stepKB} kB STEP, ${de(record.msGesamt, 0)} ms (${Object.entries(record.msJeSchritt).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\nMesswerte: ${jsonOut}`);
}
