// Prints what the 3MF reader makes of a file as JSON: the triangles, the
// volume, the bounding box and the analysis. Used by crosscheck_3mf.py.
//
// Usage: node STL-zu-STEP/tests/tools/threemf-info.mjs <file.3mf>
//
// The file given is read as data and never executed.

import fs from 'node:fs';
import { parseMesh } from '../../js/core/parse.js';

const file = process.argv[2];
if (!file) {
  console.error('Keine Datei angegeben.');
  process.exit(2);
}
const bytes = fs.readFileSync(file);
const { tris, info, warnings } = parseMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), file);
let volume = 0;
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < tris.length; i += 9) {
  const [a, b, c] = [tris.subarray(i, i + 3), tris.subarray(i + 3, i + 6), tris.subarray(i + 6, i + 9)];
  volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
}
console.log(JSON.stringify({ triangles: tris.length / 9, volume, lo, hi, info, warnings }));
