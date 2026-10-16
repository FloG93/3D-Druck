// The geometry behind diagnose() and validate(): vertex triples, the distance
// from a point to a mesh, and triangle–triangle intersection.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TripleSet, TriangleGrid, pointTriangleDistanceSq, trianglesIntersect, countSelfIntersections } from '../js/core/spatial.js';
import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { loadFixture } from './helpers.mjs';

test('TripleSet: order of the corners does not matter, the counts are exact', () => {
  const set = new TripleSet(10);
  assert.equal(set.add(1, 2, 3), true);
  assert.equal(set.add(3, 1, 2), false, 'same triple, other order');
  assert.equal(set.add(1, 2, 4), true);
  assert.equal(set.has(2, 3, 1), true);
  assert.equal(set.has(1, 2, 5), false);
  assert.equal(set.count, 2);
  const many = new TripleSet(1000);
  for (let i = 0; i < 1000; i++) many.add(i, i + 1, i + 2);
  assert.equal(many.count, 1000);
  for (let i = 0; i < 1000; i++) assert.equal(many.has(i + 2, i, i + 1), true);
});

test('pointTriangleDistanceSq: face, edge and corner regions', () => {
  const a = [0, 0, 0];
  const b = [4, 0, 0];
  const c = [0, 4, 0];
  assert.equal(pointTriangleDistanceSq([1, 1, 3], a, b, c), 9, 'above the face');
  assert.equal(pointTriangleDistanceSq([2, 2, 0], a, b, c), 0, 'on the long edge');
  assert.equal(pointTriangleDistanceSq([-3, -4, 0], a, b, c), 25, 'beyond corner a');
  assert.equal(pointTriangleDistanceSq([2, -2, 0], a, b, c), 4, 'beside edge ab');
  assert.ok(Math.abs(pointTriangleDistanceSq([5, 5, 0], a, b, c) - 18) < 1e-12, 'beside the long edge: ((5+5-4)/√2)² = 18');
});

test('TriangleGrid.nearest agrees with brute force', () => {
  const { V, F } = weldMesh(parseMesh(loadFixture('kugel.stl'), 'kugel.stl').tris);
  const grid = new TriangleGrid(V, F);
  const vertex = (t, k) => [V[3 * F[3 * t + k]], V[3 * F[3 * t + k] + 1], V[3 * F[3 * t + k] + 2]];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 40; i++) {
    const p = [(random() - 0.5) * 30, (random() - 0.5) * 30, (random() - 0.5) * 30];
    let best = Infinity;
    for (let t = 0; t < F.length / 3; t++) best = Math.min(best, pointTriangleDistanceSq(p, vertex(t, 0), vertex(t, 1), vertex(t, 2)));
    assert.ok(Math.abs(grid.nearest(p) - Math.sqrt(best)) < 1e-9, `point ${i}: ${grid.nearest(p)} vs ${Math.sqrt(best)}`);
  }
});

test('trianglesIntersect: cutting, parallel, coplanar and touching triangles', () => {
  const flat = [[0, 0, 0], [4, 0, 0], [0, 4, 0]];
  const eps = 1e-9;
  assert.equal(trianglesIntersect(flat, [[1, 1, -1], [1, 1, 1], [3, 1, 1]], eps), true, 'a triangle standing through the first');
  assert.equal(trianglesIntersect(flat, [[0, 0, 1], [4, 0, 1], [0, 4, 1]], eps), false, 'parallel above');
  assert.equal(trianglesIntersect(flat, [[1, 1, 0], [3, 1, 0], [1, 3, 0]], eps), false, 'coplanar overlap adds no volume error');
  assert.equal(trianglesIntersect(flat, [[0, 0, 0], [0, 0, 3], [-2, 0, 3]], eps), false, 'meeting in one corner');
  assert.equal(trianglesIntersect(flat, [[10, 10, -1], [10, 10, 1], [12, 10, 1]], eps), false, 'far away');
});

test('countSelfIntersections: a clean fixture has none, and the search can be capped', () => {
  const { V, F } = weldMesh(parseMesh(loadFixture('torus.stl'), 'torus.stl').tris);
  const clean = countSelfIntersections(V, F);
  assert.equal(clean.count, 0);
  assert.ok(clean.checked > 0, 'pairs were looked at');
  const two = weldMesh(parseMesh(loadFixture('defekt-zweikoerper.stl'), 'x').tris);
  const all = countSelfIntersections(two.V, two.F);
  assert.ok(all.count > 10);
  const capped = countSelfIntersections(two.V, two.F, { maxReport: 5 });
  assert.deepEqual([capped.count, capped.capped], [5, true]);
});
