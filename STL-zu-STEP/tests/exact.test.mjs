// Step 8 of docs/PLAN.md: tier 3, the exact reconstruction. The target of the
// feasibility study (MACHBARKEIT section 4) is the plate as 14 faces with the
// volume of the original part, and the open point 3b – the fillets of a
// subdivided mesh – is what the constraints of SPEC 5.6 are for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { convert, buildExactTier } from '../js/core/pipeline.js';
import { applyConstraints, cornerError, solveCorner } from '../js/core/constraints.js';
import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { healMesh } from '../js/core/heal.js';
import { growPatches } from '../js/core/patches.js';
import { detectCylinders } from '../js/core/cylinders.js';
import { buildTopology, planeModel, cylinderModel } from '../js/core/topology.js';
import { writeStep } from '../js/export/step.js';
import { verifyBrep } from '../js/core/verify.js';
import { loadFixture, expected } from './helpers.mjs';

const analyse = (name, opts = {}) => {
  const { V, F, tol } = weldMesh(parseMesh(loadFixture(name), name).tris);
  const healed = healMesh({ V, F }, { weldTol: tol });
  const mesh = { V: healed.V, F: healed.F };
  const patches = growPatches(mesh, opts);
  const detected = detectCylinders(mesh, patches, opts);
  return { mesh, patches, detected };
};

test('8c platte.stl: 14 faces, volume of the original part, STEP under 100 kB', () => {
  const result = convert(loadFixture('platte.stl'), 'platte.stl', {});
  const [c] = result.components;
  assert.equal(c.tier, 3);
  assert.equal(c.counts.faces, 14, '6 planes, 4 fillets, 4 bore halves');
  assert.equal(c.counts.planes, 6);
  assert.equal(c.counts.cylinders, 8);
  const exact = expected('platte.stl').volumen; // 7400.177
  const deviation = (100 * Math.abs(c.brepVolume - exact)) / exact;
  assert.ok(deviation < 0.01, `volume ${c.brepVolume} deviates ${deviation.toFixed(5)} % from ${exact}`);
  const text = writeStep(c.brep, { name: 'platte' });
  assert.ok(text.length < 100 * 1024, `STEP is ${Math.round(text.length / 1024)} kB`);
  assert.equal((text.match(/CYLINDRICAL_SURFACE/g) || []).length, 8);
  assert.ok((text.match(/CIRCLE/g) || []).length >= 8, 'arcs as edges');
  // The faceted tier of the same part needs about a megabyte.
  const faceted = writeStep(convert(loadFixture('platte.stl'), 'platte.stl', { tier: 1 }).components[0].brep, { name: 'platte' });
  assert.ok(faceted.length > 10 * text.length, 'tier 3 is much smaller than tier 1');
});

test('8a constraints: a corner lands on all of its neighbouring surfaces', () => {
  const { mesh, patches, detected } = analyse('platte.stl');
  const models = new Map();
  const regionOfTriangle = new Int32Array(mesh.F.length / 3).fill(-1);
  let next = 0;
  const taken = new Set();
  for (const cylinder of detected.cylinders) {
    const region = next++;
    for (const p of cylinder.patchIds) taken.add(p);
    for (const t of cylinder.triangles) regionOfTriangle[t] = region;
    models.set(region, cylinderModel(cylinder));
  }
  patches.patches.forEach((triangles, i) => {
    if (taken.has(i)) return;
    const region = next++;
    for (const t of triangles) regionOfTriangle[t] = region;
    models.set(region, planeModel(patches.planes[i]));
  });
  const topology = buildTopology(mesh, regionOfTriangle, models);
  const { points, models: fixed, report } = applyConstraints(mesh, models, topology, {});
  assert.ok(report.cornersMoved > 0, 'corners were moved');
  assert.ok(report.tangential > 0, 'the walls were made tangential to the fillets');
  assert.ok(report.maxCornerError < 1e-9, `largest corner error ${report.maxCornerError}`);
  for (const [vertex, regions] of topology.regionsAt) {
    if (regions.size < 3) continue;
    const surfaces = [...regions].map((r) => fixed.get(r)).filter(Boolean);
    if (surfaces.length < 3) continue;
    const p = [points[3 * vertex], points[3 * vertex + 1], points[3 * vertex + 2]];
    assert.ok(cornerError(p, surfaces) <= 1e-9, `corner ${vertex} is ${cornerError(p, surfaces)} off`);
  }
});

test('8a constraints: three planes and a tangential pair are solved in closed form', () => {
  const planes = [
    { type: 'plane', point: [1, 0, 0], normal: [1, 0, 0] },
    { type: 'plane', point: [0, 2, 0], normal: [0, 1, 0] },
    { type: 'plane', point: [0, 0, 3], normal: [0, 0, 1] },
  ];
  assert.deepEqual(solveCorner(planes, [0, 0, 0]), [1, 2, 3]);
  const tangential = [
    { type: 'cylinder', point: [2, 0, 0], axis: [0, 0, 1], radius: 2 },
    { type: 'plane', point: [0, 0, 5], normal: [0, 0, 1] },
    { type: 'plane', point: [0, 0, 0], normal: [1, 0, 0] },
  ];
  const corner = solveCorner(tangential, [0.1, 0.1, 4.9]);
  assert.ok(cornerError(corner, tangential) < 1e-12, `error ${cornerError(corner, tangential)}`);
  assert.deepEqual(corner.map((v) => Math.round(v * 1e9) / 1e9), [0, 0, 5]);
  assert.equal(solveCorner([planes[0], planes[1]], [0, 0, 0]), null, 'two planes have no unique corner');
});

test('8d the subdivided plates reach tier 3 (the open point of MACHBARKEIT 4)', () => {
  for (const name of ['platte-unterteilt1.stl', 'platte-unterteilt2.stl']) {
    const result = convert(loadFixture(name), name, {});
    const [c] = result.components;
    assert.equal(c.tier, 3, `${name}: ${c.fallbackReasons.join(' | ')}`);
    assert.equal(c.counts.faces, 14, `${name}: faces`);
    const exact = expected(name).volumen;
    const deviation = (100 * Math.abs(c.brepVolume - exact)) / exact;
    assert.ok(deviation < 0.05, `${name}: volume ${c.brepVolume} deviates ${deviation.toFixed(4)} %`);
    // The radii carry the chord height, and the fixture says how much.
    for (const cyl of c.features.cylinders) {
      const want = cyl.radius > 2.5 ? 3 : 2;
      const dev = (100 * Math.abs(cyl.radius - want)) / want;
      assert.ok(dev <= expected(name).toleranz_radius_prozent, `${name}: radius ${cyl.radius}`);
    }
  }
});

test('8d without the constraints the subdivided plate does not reach tier 3', () => {
  // This is what MACHBARKEIT section 4 measured: the fitted wall plane does
  // not touch the fitted cylinder, so the fillet edges do not close.
  const { mesh, patches, detected } = analyse('platte-unterteilt1.stl');
  const withConstraints = buildExactTier(mesh, { patches, detected }, {});
  assert.ok(verifyBrep(withConstraints.brep, mesh, {}).ok, 'with constraints the check passes');
  const without = buildExactTier(mesh, { patches, detected }, { constraints: { tangential: false, corners: false } });
  const check = verifyBrep(without.brep, mesh, {});
  assert.equal(check.ok, false, 'without them it fails');
  assert.ok(check.checks.some((x) => !x.ok), check.checks.map((x) => x.name).join(', '));
});

test('8e a polygon hole becomes one cylinder, written as two halves', () => {
  for (const name of ['loch-zwoelfeck.stl', 'loch-sechzehneck.stl', 'loch-zweiunddreissigeck.stl']) {
    const result = convert(loadFixture(name), name, {});
    const [c] = result.components;
    assert.equal(c.tier, 3, `${name}: ${c.fallbackReasons.join(' | ')}`);
    assert.equal(c.features.cylinders.length, 1, `${name}: one cylinder`);
    assert.ok(Math.abs(c.features.cylinders[0].radius - 3) < 0.01, `${name}: radius`);
    assert.equal(c.counts.cylinders, 2, `${name}: the tube is written as two halves`);
    assert.equal(c.counts.planes, 6);
    // A round hole has a different volume than a polygon prism – expected.json
    // states both, and the result has to match the round one.
    const want = expected(name).volumen_als_zylinder;
    const deviation = (100 * Math.abs(c.brepVolume - want)) / want;
    assert.ok(deviation < 0.01, `${name}: volume ${c.brepVolume} instead of ${want}`);
  }
});

test('the uncertain octagon stays off, and switching it on reaches tier 3', () => {
  const off = convert(loadFixture('loch-achteck.stl'), 'loch-achteck.stl', {}).components[0];
  assert.equal(off.tier, 2, 'nothing uncertain is built without being asked');
  assert.equal(off.features.uncertain.length, 1);
  const on = convert(loadFixture('loch-achteck.stl'), 'loch-achteck.stl', { acceptUncertain: true }).components[0];
  assert.equal(on.tier, 3);
  assert.equal(on.features.cylinders[0].confidence, 'unsicher');
  assert.equal(on.counts.cylinders, 2);
});

test('SPEC 5.9: faces(tier 3) ≤ faces(tier 2) ≤ faces(tier 1) for every fixture', () => {
  for (const name of Object.keys(expected())) {
    const counts = {};
    for (const tier of [1, 2, 3]) {
      const result = convert(loadFixture(name), name, { tier });
      if (!result.components.every((c) => c.tier === tier)) continue;
      counts[tier] = result.components.reduce((s, c) => s + c.counts.faces, 0);
    }
    assert.ok(counts[1] !== undefined, `${name}: tier 1 is always available`);
    if (counts[2] !== undefined) assert.ok(counts[2] <= counts[1], `${name}: tier 2 ${counts[2]} > tier 1 ${counts[1]}`);
    if (counts[3] !== undefined && counts[2] !== undefined) {
      assert.ok(counts[3] <= counts[2], `${name}: tier 3 ${counts[3]} > tier 2 ${counts[2]}`);
    }
  }
});

test('no feature is lost: every expected cylinder is in the result', () => {
  for (const [name, exp] of Object.entries(expected())) {
    if (!Array.isArray(exp.zylinder) || exp.zylinder.length === 0) continue;
    const result = convert(loadFixture(name), name, { acceptUncertain: exp.vertrauen === 'unsicher' });
    const found = result.components.flatMap((c) => c.features.cylinders);
    assert.equal(found.length, exp.zylinder.length, `${name}: ${found.length} cylinders instead of ${exp.zylinder.length}`);
    const wanted = exp.zylinder.map((z) => z.r).sort((a, b) => a - b);
    const got = found.map((c) => c.radius).sort((a, b) => a - b);
    const tolerance = exp.toleranz_radius_prozent ?? 0.05;
    got.forEach((r, i) => {
      const dev = (100 * Math.abs(r - wanted[i])) / wanted[i];
      assert.ok(dev <= tolerance, `${name}: radius ${r} instead of ${wanted[i]} (${dev.toFixed(3)} % > ${tolerance} %)`);
    });
  }
});
