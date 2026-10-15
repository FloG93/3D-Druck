// Step 1 of docs/PLAN.md: the three cube files must give the same triangles,
// and a broken file must give a clear message instead of a crash.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMesh } from '../js/core/parse.js';
import { loadFixture, expected, signedVolume } from './helpers.mjs';

/** Sorted list of the points of a triangle soup (order must not matter). */
const points = (tris) => {
  const out = new Set();
  for (let i = 0; i < tris.length; i += 3) out.add([tris[i], tris[i + 1], tris[i + 2]].map((v) => v.toFixed(4)).join(' '));
  return [...out].sort();
};

const volumeOf = (tris) => {
  const V = Float64Array.from(tris);
  const F = Uint32Array.from({ length: tris.length / 3 }, (_, i) => i);
  return signedVolume(V, F);
};

test('cube: binary STL, ASCII STL and OBJ with quads give the same 12 triangles', () => {
  const names = ['wuerfel.stl', 'wuerfel-ascii.stl', 'wuerfel-quads.obj'];
  const parsed = names.map((n) => parseMesh(loadFixture(n), n));
  for (const [i, r] of parsed.entries()) {
    assert.equal(r.tris.length / 9, expected(names[i]).dreiecke, `${names[i]}: triangle count`);
    assert.ok(Math.abs(volumeOf(r.tris) - 1000) < 1e-6, `${names[i]}: volume 1000, got ${volumeOf(r.tris)}`);
    assert.equal(r.unit, 'mm');
    assert.deepEqual(r.warnings, [], `${names[i]}: no warnings`);
  }
  // Same solid from the same eight corners. The triangles themselves cannot
  // match one by one: the OBJ quads are split along the other diagonal than
  // the tessellation of the STL files (noted in SPEC.md 5.1).
  assert.deepEqual(points(parsed[1].tris), points(parsed[0].tris), 'ASCII == binary');
  assert.deepEqual(points(parsed[2].tris), points(parsed[0].tris), 'OBJ == binary');
  assert.equal(points(parsed[0].tris).length, 8, 'a cube has eight corners');
});

test('every fixture parses with the triangle count from expected.json', () => {
  for (const [name, exp] of Object.entries(expected())) {
    const r = parseMesh(loadFixture(name), name);
    assert.equal(r.tris.length / 9, exp.dreiecke, `${name}`);
    if (exp.netzvolumen !== undefined) {
      const dev = Math.abs(volumeOf(r.tris) - exp.netzvolumen);
      assert.ok(dev < 0.01, `${name}: mesh volume ${volumeOf(r.tris)} != ${exp.netzvolumen}`);
    }
  }
});

test('binary STL that starts with the word solid is recognised by its length', () => {
  const n = 2;
  const buf = new ArrayBuffer(84 + 50 * n);
  new Uint8Array(buf).set([...'solid trap'].map((c) => c.charCodeAt(0)));
  new DataView(buf).setUint32(80, n, true);
  const f = new Float32Array(buf, 84 + 12, 9); // first triangle, vertices after the normal
  f.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const r = parseMesh(buf, 'trap.stl');
  assert.equal(r.tris.length / 9, 2);
  assert.deepEqual([...r.tris.slice(0, 9)], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('ASCII STL without the length of a binary file stays ASCII', () => {
  const text = `solid x
 facet normal 0 0 1
  outer loop
   vertex 0 0 0
   vertex 1 0 0
   vertex 0 1 0
  endloop
 endfacet
endsolid x
`;
  const r = parseMesh(new TextEncoder().encode(text).buffer, 'x.stl');
  assert.equal(r.tris.length / 9, 1);
});

test('NaN and Inf: triangle is dropped and counted in the report', () => {
  const text = 'solid x\n'
    + 'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n'
    + 'facet normal 0 0 1\nouter loop\nvertex nan 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n'
    + 'endsolid x\n';
  const r = parseMesh(new TextEncoder().encode(text).buffer, 'x.stl');
  assert.equal(r.tris.length / 9, 1);
  assert.ok(r.warnings.some((w) => /1 Dreieck/.test(w) && /ungültig/i.test(w)), r.warnings.join('; '));
});

test('unit warning when the bounding box is tiny or huge', () => {
  const tri = (s) => `solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex ${s} 0 0\nvertex 0 ${s} 0\nendloop\nendfacet\nendsolid x\n`;
  const small = parseMesh(new TextEncoder().encode(tri(0.2)).buffer, 'x.stl');
  assert.ok(small.warnings.some((w) => /Einheit/.test(w)), small.warnings.join('; '));
  const big = parseMesh(new TextEncoder().encode(tri(9000)).buffer, 'x.stl');
  assert.ok(big.warnings.some((w) => /Einheit/.test(w)), big.warnings.join('; '));
});

test('truncated and empty files give a clear message, not a crash', () => {
  const n = 10;
  const buf = new ArrayBuffer(84 + 50 * 3); // header promises 10 triangles, only 3 follow
  new DataView(buf).setUint32(80, n, true);
  assert.throws(() => parseMesh(buf, 'kurz.stl'), /abgeschnitten|unvollständig/i);
  assert.throws(() => parseMesh(new ArrayBuffer(0), 'leer.stl'), /leer/i);
  assert.throws(() => parseMesh(new TextEncoder().encode('solid x\nendsolid x\n').buffer, 'leer2.stl'), /kein Dreieck/i);
  assert.throws(() => parseMesh(new TextEncoder().encode('hallo').buffer, 'x.txt'), /STL|OBJ/);
});

test('OBJ: negative indices, a/b/c and a//c, polygons as a fan', () => {
  const obj = `v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
f 1/1 2/2 3/3 4/4
f -4//1 -3//2 -1//3
`;
  const r = parseMesh(new TextEncoder().encode(obj).buffer, 'x.obj');
  assert.equal(r.tris.length / 9, 3, 'quad as two triangles plus one triangle');
  assert.deepEqual([...r.tris.slice(18, 27)], [1, 0, 0, 1, 1, 0, 0, 0, 1], 'negative indices count from the end');
});
