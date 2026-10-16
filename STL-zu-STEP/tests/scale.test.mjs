// Very large inputs. "Maximum call stack size exceeded" in the browser came
// from spreading an array into a call (Math.max(...heights), push(...faces)):
// every element becomes an argument, and from about 120 000 of them the stack
// is full. Reproduced with a cylinder of 700 × 200 segments (281 400
// triangles) – the very part the tool is made for, only finely meshed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { maxOf, minOf } from '../js/core/linalg.js';
import { mergeBreps } from '../js/core/brep.js';
import { convert } from '../js/core/pipeline.js';

const HUGE = 500000;

test('maxOf and minOf take arrays of any size', () => {
  const values = Float64Array.from({ length: HUGE }, (_, i) => Math.sin(i));
  assert.equal(maxOf(values), values.reduce((a, b) => (b > a ? b : a), -Infinity));
  assert.equal(minOf(Array.from(values)), values.reduce((a, b) => (b < a ? b : a), Infinity));
  assert.equal(maxOf([]), -Infinity, 'an empty list has no maximum, like Math.max()');
});

test('mergeBreps joins bodies with several hundred thousand faces', () => {
  const body = (n) => ({
    points: Array.from({ length: n }, () => [0, 0, 0]),
    edges: Array.from({ length: n }, () => ({ v0: 0, v1: 0 })),
    faces: Array.from({ length: n }, () => ({ loops: [], surface: { type: 'plane' }, sense: 1 })),
    solids: [],
  });
  const merged = mergeBreps([body(300000), body(10)]);
  assert.equal(merged.faces.length, 300010);
  assert.equal(merged.solids.length, 2);
  assert.equal(merged.solids[1].faces[0], 300000, 'the second body starts after the first');
});

/** Capped cylinder, r = 5, length 50, with `seg` segments around and `rings` along. */
function fineCylinder(seg, rings) {
  const R = 5;
  const L = 50;
  const point = (j, k) => [R * Math.cos((2 * Math.PI * (j % seg)) / seg), R * Math.sin((2 * Math.PI * (j % seg)) / seg), (L * k) / rings];
  const T = [];
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < seg; j++) {
      const a = point(j, k);
      const b = point(j + 1, k);
      const c = point(j + 1, k + 1);
      const d = point(j, k + 1);
      T.push([a, b, c], [a, c, d]);
    }
  }
  for (let j = 0; j < seg; j++) {
    T.push([[0, 0, 0], point(j + 1, 0), point(j, 0)]);
    T.push([[0, 0, L], point(j, rings), point(j + 1, rings)]);
  }
  const buf = Buffer.alloc(84 + 50 * T.length);
  buf.writeUInt32LE(T.length, 80);
  T.forEach((t, i) => t.forEach((q, m) => q.forEach((x, n) => buf.writeFloatLE(x, 84 + 50 * i + 12 + 12 * m + 4 * n))));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test('a cylinder of 281 400 triangles converts (it used to overflow the stack)', () => {
  const result = convert(fineCylinder(700, 200), 'zylinder-fein.stl');
  const part = result.components[0];
  assert.equal(result.triangles, 281400);
  assert.equal(part.features.cylinders.length, 1, 'one cylinder is recognised');
  assert.ok(Math.abs(part.features.cylinders[0].radius - 5) < 0.01, 'with radius 5');
  assert.ok(part.tier >= 2, `a valid solid, not an open shell (tier ${part.tier})`);
  assert.ok(Math.abs(part.deviationPercent) < 1, 'volume within one percent of the mesh');
});
