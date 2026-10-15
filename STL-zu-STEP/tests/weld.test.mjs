// Step 2 of docs/PLAN.md: welding points and the mesh operations every later
// step builds on. Reference numbers from docs/MACHBARKEIT.md section 3
// (264 points for the clean plate and for the file with shifted points).

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { edgeMap, signedVolume, components, splitComponents, bbox, adjacency, triangleNormals, openEdges } from '../js/core/meshops.js';
import { loadFixture, expected, meshStats } from './helpers.mjs';

const mesh = (name) => weldMesh(parseMesh(loadFixture(name), name).tris);

test('platte.stl: 264 points, 532 triangles, closed, volume 7401.8573', () => {
  const { V, F } = mesh('platte.stl');
  assert.equal(V.length / 3, 264);
  assert.equal(F.length / 3, 532);
  const stats = meshStats(V, F);
  assert.equal(stats.open, 0, 'every edge has its opposite');
  assert.equal(stats.doubled, 0, 'no directed edge twice');
  assert.ok(Math.abs(stats.volume - expected('platte.stl').netzvolumen) < 0.01, `volume ${stats.volume}`);
  assert.equal(stats.components, 1);
});

test('defekt-verrutscht.stl: shifted points are welded back to 264', () => {
  const { V, F } = mesh('defekt-verrutscht.stl');
  assert.equal(V.length / 3, 264);
  assert.equal(F.length / 3, 532);
  assert.equal(meshStats(V, F).open, 0, 'closed again after welding');
});

test('defekt-zweikoerper.stl: two components', () => {
  const { V, F } = mesh('defekt-zweikoerper.stl');
  const comps = components(F);
  assert.equal(comps.count, 2);
  assert.equal(comps.label.length, F.length / 3);
  const sizes = [0, 0];
  for (const l of comps.label) sizes[l] += 1;
  assert.deepEqual(sizes.slice().sort((a, b) => a - b), [532, 532]);
  assert.equal(meshStats(V, F).components, 2, 'helper and module agree');
});

test('shells that touch in a point are separate bodies (union-find over edges)', () => {
  // Found in the Utah teapot: two closed shells sharing exactly one vertex.
  // Over points they look like one body with Euler characteristic 3, and no
  // valid solid comes out of that (MACHBARKEIT section 7).
  const { V, F } = mesh('defekt-punktberuehrung.stl');
  assert.equal(F.length / 3, 24);
  const comps = components(F);
  assert.equal(comps.count, 2, 'two cubes, two bodies');
  const sizes = [0, 0];
  for (const l of comps.label) sizes[l] += 1;
  assert.deepEqual(sizes, [12, 12]);
  // Both halves are closed in themselves, so both are solids.
  const parts = splitComponents(V, F);
  assert.equal(parts.length, 2);
  for (const part of parts) {
    const stats = meshStats(part.V, part.F);
    assert.equal(stats.open, 0);
    assert.equal(part.V.length / 3, 8, 'the shared point is in both bodies');
    assert.ok(Math.abs(stats.volume - 1000) < 1e-6, `volume ${stats.volume}`);
  }
});

test('every fixture: triangle count stays, volume matches expected.json', () => {
  for (const [name, exp] of Object.entries(expected())) {
    const { V, F } = mesh(name);
    assert.equal(F.length / 3, exp.dreiecke, `${name}: triangles`);
    if (exp.netzvolumen !== undefined) {
      assert.ok(Math.abs(signedVolume(V, F) - exp.netzvolumen) < 0.01, `${name}: mesh volume`);
    }
    assert.ok(V.length / 3 <= exp.dreiecke * 3, `${name}: welding reduced the points`);
  }
});

test('edgeMap: directed and undirected edges of the cube', () => {
  const { V, F } = mesh('wuerfel.stl');
  assert.equal(V.length / 3, 8);
  const em = edgeMap(F);
  assert.equal(em.undirected.size, 18, 'cube from 12 triangles has 18 edges');
  assert.equal(openEdges(F).length, 0);
  for (const tris of em.undirected.values()) assert.equal(tris.length, 2, 'every edge has two triangles');
});

test('bbox, normals and adjacency', () => {
  const { V, F } = mesh('wuerfel.stl');
  const box = bbox(V);
  assert.deepEqual([...box.lo], [0, 0, 0]);
  assert.deepEqual([...box.hi], [10, 10, 10]);
  assert.ok(Math.abs(box.diagonal - Math.sqrt(300)) < 1e-9);
  const { N, area } = triangleNormals(V, F);
  assert.equal(N.length / 3, 12);
  for (let t = 0; t < 12; t++) assert.ok(Math.abs(Math.hypot(N[3 * t], N[3 * t + 1], N[3 * t + 2]) - 1) < 1e-12);
  let total = 0;
  for (const a of area) total += a;
  assert.ok(Math.abs(total - 600) < 1e-9, `surface 600, got ${total}`);
  const adj = adjacency(F);
  for (let t = 0; t < 12; t++) assert.equal(adj.start[t + 1] - adj.start[t], 3, 'every triangle has three neighbours');
});

test('welding 100 000 triangles stays under a second', () => {
  // Synthetic grid of quads, every point written out per triangle.
  const n = 224; // 2 · 224² ≈ 100 k triangles
  const tris = new Float64Array(9 * 2 * n * n);
  let k = 0;
  const put = (x, y) => { tris[k++] = x; tris[k++] = y; tris[k++] = 0; };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      put(i, j); put(i + 1, j); put(i + 1, j + 1);
      put(i, j); put(i + 1, j + 1); put(i, j + 1);
    }
  }
  const t0 = performance.now();
  const { V, F } = weldMesh(tris);
  const ms = performance.now() - t0;
  assert.equal(F.length / 3, 2 * n * n);
  assert.equal(V.length / 3, (n + 1) * (n + 1));
  assert.ok(ms < 1000, `welding took ${Math.round(ms)} ms`);
});

test('components and union-find do not use recursion (deep strip of triangles)', () => {
  // A real strip: every triangle shares an EDGE with the next one, so all of
  // them are one component. A recursive flood fill would blow the stack here.
  const n = 30000;
  const tris = new Float64Array(9 * 2 * n);
  for (let i = 0; i < n; i++) {
    tris.set([i, 0, 0, i + 1, 0, 0, i, 1, 0], 18 * i);
    tris.set([i + 1, 0, 0, i + 1, 1, 0, i, 1, 0], 18 * i + 9);
  }
  const { V, F } = weldMesh(tris);
  assert.equal(F.length / 3, 2 * n);
  assert.equal(components(F).count, 1);
});
