// Diagnoses and repairs a mesh and prints the before/after report: what was
// wrong, what was done, how far the repair moved the surface. Optionally
// writes the report as JSON and the repaired part as a STEP file.
//
// Usage: node STL-zu-STEP/tests/tools/repair-report.mjs <file.stl|obj> [options]
//
//   --min-shell-size <n>     remove loose shells with fewer than n triangles (default: keep all)
//   --min-shell-volume <p>   … or below p percent of the largest shell's volume
//   --max-deviation <p>      furthest the surface may move, percent of the diagonal (default 1)
//   --max-volume-change <p>  allowed volume change in percent (default 1)
//   --on-exceed <mode>       warn (default) | discard (redo without filling holes) | abort
//   --no-fill-holes          do not close holes
//   --self-intersections     also look for triangles cutting through each other (slow)
//   --json [file]            write the report as JSON (default: <file>.repair.json next to the input)
//   --step [file]            convert the repaired mesh and write the STEP file
//
// Exit code 1 when the repair is aborted, 2 for a bad call. The file given is
// read as data and never executed.

import fs from 'node:fs';
import path from 'node:path';
import { parseMesh } from '../../js/core/parse.js';
import { weldMesh } from '../../js/core/weld.js';
import { repairMesh, formatRepairReport } from '../../js/core/repair.js';
import { convert } from '../../js/core/pipeline.js';
import { writeStep } from '../../js/export/step.js';
import { mergeBreps } from '../../js/core/brep.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const file = args.find((a, i) => !a.startsWith('--') && !['--min-shell-size', '--min-shell-volume', '--max-deviation', '--max-volume-change', '--on-exceed', '--json', '--step'].includes(args[i - 1]));
if (!file) {
  console.error('Keine Datei angegeben. Aufruf: node repair-report.mjs <datei.stl> [--min-shell-size n] [--max-deviation %] [--on-exceed warn|discard|abort] [--json [datei]] [--step [datei]]');
  process.exit(2);
}
const number = (name, fallback) => {
  const v = value(name);
  if (v === null) return fallback;
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0) {
    console.error(`--${name}: "${v}" ist keine Zahl ≥ 0.`);
    process.exit(2);
  }
  return x;
};
const onExceed = value('on-exceed') ?? 'warn';
if (!['warn', 'discard', 'abort'].includes(onExceed)) {
  console.error('--on-exceed: warn, discard oder abort.');
  process.exit(2);
}

const repair = {
  minShellTriangles: number('min-shell-size', 0),
  minShellVolume: number('min-shell-volume', 0) / 100,
  maxDeviation: number('max-deviation', 1) / 100,
  maxVolumeChange: number('max-volume-change', 1),
  onExceed,
  intersections: flag('self-intersections'),
};
const opts = { repair, fillHoles: !flag('no-fill-holes') };

const bytes = fs.readFileSync(file);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const parsed = parseMesh(buffer, path.basename(file));
const welded = weldMesh(parsed.tris);

let outcome;
try {
  outcome = repairMesh({ V: welded.V, F: welded.F }, { weldTol: welded.tol, ...opts });
} catch (e) {
  console.error(`Abgebrochen: ${e.message}`);
  process.exit(1);
}
console.log(formatRepairReport(outcome.repair, outcome.report, path.basename(file)));

const stem = file.replace(/\.[^.]+$/, '');
if (flag('json')) {
  const target = value('json') ?? `${stem}.repair.json`;
  const data = { datei: path.basename(file), heilung: outcome.report, ...outcome.repair };
  fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`\nBericht: ${target}`);
}
if (flag('step')) {
  const target = value('step') ?? `${stem}.step`;
  const result = convert(buffer, path.basename(file), opts);
  const breps = result.components.map((c) => c.brep);
  const text = writeStep(breps.length === 1 ? breps[0] : mergeBreps(breps), { name: path.basename(file), open: result.components.some((c) => c.open) });
  fs.writeFileSync(target, text);
  console.log(`STEP: ${target} (${Math.round(text.length / 1024)} kB, Stufe ${result.components.map((c) => c.tier).join('+')})`);
}
