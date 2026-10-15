// Step 5 of docs/PLAN.md: cylinders with counter-hypotheses. The numbers are
// the ones the Python reference (probe4.py::detect, probe6.py::verdict,
// probe7.py) gives on these fixtures. The regression that matters most is 5c:
// a sphere test on points alone throws away real cylinders, so the sphere
// hypothesis needs the normals too (MACHBARKEIT section 2, point 4).

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { healMesh } from '../js/core/heal.js';
import { growPatches } from '../js/core/patches.js';
import { detectCylinders } from '../js/core/cylinders.js';
import { loadFixture, expected } from './helpers.mjs';

const run = (name, opts) => {
  const { V, F, tol } = weldMesh(parseMesh(loadFixture(name), name).tris);
  const mesh = healMesh({ V, F }, { weldTol: tol });
  const patches = growPatches({ V: mesh.V, F: mesh.F });
  return { ...detectCylinders({ V: mesh.V, F: mesh.F }, patches, opts), mesh, patches };
};

const radii = (cylinders) => cylinders.map((c) => Number(c.radius.toFixed(4))).sort((a, b) => a - b);

test('5a detect: platte.stl gives six cylinders, r = 2 and 3, axis (0,0,1)', () => {
  const { cylinders } = run('platte.stl');
  assert.equal(cylinders.length, 6);
  assert.deepEqual(radii(cylinders), [2, 2, 2, 2, 3, 3]);
  for (const c of cylinders) {
    assert.ok(Math.abs(Math.abs(c.axis[2]) - 1) < 1e-6, `axis ${c.axis}`);
    assert.equal(c.confidence, 'sicher');
    assert.ok(c.residual < 1e-3, `residual ${c.residual}`);
    assert.ok(c.segments >= 12, `segments ${c.segments}`);
    assert.ok(c.zRange[1] > c.zRange[0]);
  }
});

test('5a detect: the subdivided plates keep six cylinders within tolerance', () => {
  for (const name of ['platte-unterteilt1.stl', 'platte-unterteilt2.stl']) {
    const { cylinders } = run(name);
    const limit = expected(name).toleranz_radius_prozent;
    assert.equal(cylinders.length, 6, `${name}: six cylinders (merge!)`);
    const got = radii(cylinders);
    for (const [i, want] of [2, 2, 2, 2, 3, 3].entries()) {
      const dev = (100 * Math.abs(got[i] - want)) / want;
      assert.ok(dev <= limit, `${name}: radius ${got[i]} deviates ${dev.toFixed(3)}% from ${want} (limit ${limit}%)`);
    }
    // The chord height is the physical reason, and it is reported as uncertainty.
    for (const c of cylinders) assert.ok(c.uncertainty > 0, `${name}: uncertainty reported`);
  }
});

test('5b verify: sphere and cone are rejected, with reasons', () => {
  for (const name of ['kugel.stl', 'kegel.stl']) {
    const { cylinders, rejected } = run(name);
    assert.equal(cylinders.length, 0, `${name}: no cylinder is accepted`);
    assert.ok(rejected.length > 0, `${name}: the rejections are reported`);
    const reasons = new Set(rejected.flatMap((r) => r.reasons.map((x) => x.split(' (')[0])));
    assert.ok(reasons.has('Kugel passt besser') || reasons.has('Radius nicht konstant') || reasons.has('zu kurz'), [...reasons].join(', '));
  }
});

test('5b verify: the cone is rejected for a radius that is not constant', () => {
  const { rejected } = run('kegel.stl');
  const reasons = rejected.flatMap((r) => r.reasons.map((x) => x.split(' (')[0]));
  assert.ok(reasons.includes('Radius nicht konstant') || reasons.includes('Kugel passt besser'), reasons.join(', '));
});

test('5c regression: the sphere test must not throw away the six real cylinders', () => {
  // A cylinder with two rings of points lies on a sphere of radius
  // √(r² + (h/2)²); only the normals tell the two apart.
  const { cylinders, rejected } = run('platte.stl');
  assert.equal(cylinders.length, 6);
  assert.equal(rejected.filter((r) => r.reasons.some((x) => x.startsWith('Kugel'))).length, 0, 'no real cylinder is mistaken for a sphere');
});

test('5d confidence: hexagon no, octagon uncertain, twelve and up certain', () => {
  const six = run('loch-sechseck.stl');
  assert.equal(six.cylinders.length, 0, 'a hexagon stays a prism');
  assert.ok(six.rejected.some((r) => r.reasons.some((x) => x.startsWith('Segmente'))) || six.rejected.length === 0);

  const eight = run('loch-achteck.stl', { acceptUncertain: true });
  assert.equal(eight.cylinders.length, 1);
  assert.equal(eight.cylinders[0].confidence, 'unsicher');
  assert.ok(Math.abs(eight.cylinders[0].radius - 3) < 1e-3, `radius ${eight.cylinders[0].radius}`);
  assert.equal(eight.cylinders[0].segments, 8);

  // Default: uncertain features are off, and the report says so.
  const eightDefault = run('loch-achteck.stl');
  assert.equal(eightDefault.cylinders.length, 0);
  assert.equal(eightDefault.uncertain.length, 1, 'offered for confirmation');
  assert.equal(eightDefault.uncertain[0].segments, 8);

  for (const [name, segments] of [['loch-zwoelfeck.stl', 12], ['loch-sechzehneck.stl', 16], ['loch-zweiunddreissigeck.stl', 32]]) {
    const { cylinders } = run(name);
    assert.equal(cylinders.length, 1, `${name}`);
    assert.equal(cylinders[0].confidence, 'sicher');
    assert.equal(cylinders[0].segments, segments, `${name}: segments per full circle`);
    assert.ok(Math.abs(cylinders[0].radius - 3) < 0.01, `${name}: radius ${cylinders[0].radius}`);
  }
});

test('5e merge: a hole split in two by a distorted radius becomes one cylinder', () => {
  // Without merging the reference finds 8 cylinders on platte-unterteilt1.
  const { cylinders, merged } = run('platte-unterteilt1.stl');
  assert.equal(cylinders.length, 6);
  assert.ok(merged >= 1, `${merged} merges reported`);
  const unmerged = run('platte-unterteilt1.stl', { merge: false });
  assert.equal(unmerged.cylinders.length, 8, 'the reference number without merging');
});

test('5f torus: no phantom cylinders (boundary check)', () => {
  const { cylinders, rejected } = run('torus.stl');
  assert.equal(cylinders.length, 0, `${cylinders.length} phantom cylinders, radii ${radii(cylinders)}`);
  assert.ok(rejected.some((r) => r.reasons.some((x) => x.startsWith('Rand'))), 'the boundary check is the reason');
});

test('the cube and the clean plate: no feature is invented or lost', () => {
  assert.equal(run('wuerfel.stl').cylinders.length, 0);
  for (const name of Object.keys(expected())) {
    const exp = expected(name);
    if (!Array.isArray(exp.zylinder) || exp.vertrauen === 'unsicher') continue;
    const { cylinders } = run(name);
    assert.equal(cylinders.length, exp.zylinder.length, `${name}: expected ${exp.zylinder.length} cylinders, got ${cylinders.length}`);
  }
});

test('every triangle of an accepted cylinder really lies on it', () => {
  const { cylinders, mesh } = run('platte.stl');
  for (const c of cylinders) {
    for (const t of c.triangles) {
      for (let k = 0; k < 3; k++) {
        const v = 3 * mesh.F[3 * t + k];
        const d = [mesh.V[v] - c.center[0], mesh.V[v + 1] - c.center[1], mesh.V[v + 2] - c.center[2]];
        const along = d[0] * c.axis[0] + d[1] * c.axis[1] + d[2] * c.axis[2];
        const radial = Math.hypot(d[0] - along * c.axis[0], d[1] - along * c.axis[1], d[2] - along * c.axis[2]);
        assert.ok(Math.abs(radial - c.radius) < 0.01 * c.radius + 1e-3, `point off the cylinder: ${radial} vs ${c.radius}`);
      }
    }
  }
});
