// Step 4 of docs/PLAN.md: flat patches. The counts are the ones the Python
// reference (docs/referenz/probe4.py::patches) gives on these very fixtures;
// the point of the step is that they do not depend on the triangulation –
// platte.stl and both subdivided versions give the same 134 patches.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { healMesh } from '../js/core/heal.js';
import { growPatches } from '../js/core/patches.js';
import { bbox, triangleNormals } from '../js/core/meshops.js';
import { loadFixture, expected } from './helpers.mjs';

const prepare = (name) => {
  const { V, F, tol } = weldMesh(parseMesh(loadFixture(name), name).tris);
  return healMesh({ V, F }, { weldTol: tol });
};

/** Reference: docs/referenz/probe4.py on the committed fixtures. */
const REFERENCE_PATCHES = {
  'platte.stl': 134,
  'platte-unterteilt1.stl': 134,
  'platte-unterteilt2.stl': 134,
  'kegel.stl': 116,
  'torus.stl': 1702,
  'loch-sechseck.stl': 12,
  'loch-achteck.stl': 14,
  'loch-zwoelfeck.stl': 18,
  'loch-sechzehneck.stl': 22,
  'loch-zweiunddreissigeck.stl': 38,
  'wuerfel.stl': 6,
};

test('patch counts match the reference, independent of the triangulation', () => {
  for (const [name, want] of Object.entries(REFERENCE_PATCHES)) {
    const { V, F } = prepare(name);
    const { patches } = growPatches({ V, F });
    assert.equal(patches.length, want, `${name}`);
  }
});

test('kugel.stl: 1373 patches on the raw mesh, 1371 after healing', () => {
  // The reference measures 1374, because numpy gives the two collapsed pole
  // triangles a NaN normal and each of them stays a patch of its own; in
  // JavaScript their normal is the zero vector, which merges one of the two
  // with nothing. Healing removes both triangles, and with them their
  // patches (noted in SPEC 5.4).
  const raw = weldMesh(parseMesh(loadFixture('kugel.stl'), 'kugel.stl').tris);
  assert.equal(growPatches(raw).patches.length, 1373);
  const { V, F } = prepare('kugel.stl');
  assert.equal(growPatches({ V, F }).patches.length, 1371);
});

test('every triangle belongs to exactly one patch', () => {
  for (const name of Object.keys(expected())) {
    const { V, F } = prepare(name);
    const { labels, patches } = growPatches({ V, F });
    assert.equal(labels.length, F.length / 3, `${name}: one label per triangle`);
    const counted = new Int32Array(patches.length);
    for (let t = 0; t < labels.length; t++) {
      assert.ok(labels[t] >= 0 && labels[t] < patches.length, `${name}: triangle ${t} without a patch`);
      counted[labels[t]] += 1;
    }
    let total = 0;
    for (const [i, p] of patches.entries()) {
      assert.equal(p.length, counted[i], `${name}: patch ${i} size`);
      total += p.length;
    }
    assert.equal(total, F.length / 3, `${name}: patches cover the mesh`);
  }
});

test('every patch is flat: all points close to its plane', () => {
  for (const name of ['platte.stl', 'platte-unterteilt2.stl', 'loch-achteck.stl', 'kegel.stl']) {
    const { V, F } = prepare(name);
    const { patches, planes } = growPatches({ V, F });
    const limit = 1e-3 * bbox(V).diagonal;
    for (const [i, tris] of patches.entries()) {
      const { point, normal } = planes[i];
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-12, `${name}: patch normal is a unit vector`);
      for (const t of tris) {
        for (let k = 0; k < 3; k++) {
          const v = F[3 * t + k];
          const d = (V[3 * v] - point[0]) * normal[0] + (V[3 * v + 1] - point[1]) * normal[1] + (V[3 * v + 2] - point[2]) * normal[2];
          assert.ok(Math.abs(d) < limit, `${name}: patch ${i} is not flat (${d})`);
        }
      }
    }
  }
});

test('the six faces of the cube become six patches with the axis normals', () => {
  const { V, F } = prepare('wuerfel.stl');
  const { patches, planes } = growPatches({ V, F });
  assert.equal(patches.length, 6);
  for (const p of patches) assert.equal(p.length, 2, 'two triangles per face');
  const normals = planes.map((p) => p.normal.map((v) => Math.round(v)).join(' ')).sort();
  assert.deepEqual(normals, ['-1 0 0', '0 -1 0', '0 0 -1', '0 0 1', '0 1 0', '1 0 0']);
});

test('the plate: six flat faces carry most of the area, the rest are narrow strips', () => {
  const { V, F } = prepare('platte.stl');
  const { patches, planes, labels } = growPatches({ V, F });
  const { area } = triangleNormals(V, F);
  const areas = patches.map((tris) => tris.reduce((s, t) => s + area[t], 0)).sort((a, b) => b - a);
  // Top and bottom (≈ 40·20 minus the holes and the rounded corners) and the four walls.
  assert.ok(areas[0] > 700 && areas[1] > 700, `two large faces, got ${areas[0]}, ${areas[1]}`);
  assert.equal(patches.filter((tris) => tris.reduce((s, t) => s + area[t], 0) > 100).length, 6, 'six patches are real faces');
  assert.equal(labels.length, 532);
  assert.equal(planes.length, patches.length);
});

test('noise: the relaxed thresholds are an option and are reported', () => {
  const { V, F } = prepare('platte.stl');
  const noisy = Float64Array.from(V);
  // Deterministic pseudo noise of ±0.002 mm (MACHBARKEIT section 2).
  let seed = 7;
  for (let i = 0; i < noisy.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noisy[i] += ((seed / 0x7fffffff) - 0.5) * 0.004;
  }
  const strict = growPatches({ V: noisy, F });
  assert.equal(strict.noisy, false, 'nothing is relaxed on its own');
  assert.equal(strict.options.angleDegrees, 2);
  const relaxed = growPatches({ V: noisy, F }, { noisy: true });
  assert.equal(relaxed.noisy, true);
  assert.equal(relaxed.options.angleDegrees, 5);
  assert.ok(relaxed.options.offset > strict.options.offset, 'the offset grows too');
  // The six real faces survive the noise with either setting.
  for (const r of [strict, relaxed]) {
    const big = r.patches.filter((tris) => tris.length > 20).length;
    assert.ok(big >= 2, `${r.noisy ? 'relaxed' : 'strict'}: large faces stay whole (${big})`);
  }
});

test('the thresholds of a curved part are never relaxed behind the back', () => {
  // Measured: the automatic estimate of SPEC 5.4 (scatter of the points
  // around the patch plane > 1e-4 · diagonal) fires on every curved mesh,
  // because the scatter of a legitimately curved patch is just as large.
  // With it, kegel.stl gave 49 patches instead of 116.
  const { V, F } = prepare('kegel.stl');
  assert.equal(growPatches({ V, F }).patches.length, 116);
  assert.equal(growPatches({ V, F }, { noisy: true }).patches.length, 49, 'the relaxed thresholds do merge the bands');
});
