// Step 6 of docs/PLAN.md: tier 1 (every triangle a planar face). The real
// check is OpenCascade in tests/tools/validate_step.py; here the structure is
// checked before anything is written – edges exactly twice, Euler, volume.

import test from 'node:test';
import assert from 'node:assert/strict';

import { convert, TIER_BUILDERS } from '../js/core/pipeline.js';
import { writeStep } from '../js/export/step.js';
import { mergeBreps, brepVolume, brepCounts, facetedBrep } from '../js/core/brep.js';
import { verifyBrep } from '../js/core/verify.js';
import { loadFixture, expected } from './helpers.mjs';

const run = (name, opts) => convert(loadFixture(name), name, opts);

test('tier 1: the cube becomes twelve planar faces with eight shared corners', () => {
  const result = run('wuerfel.stl', { tier: 1 });
  assert.equal(result.components.length, 1);
  const [c] = result.components;
  assert.equal(c.tier, 1);
  assert.deepEqual(brepCounts(c.brep), { points: 8, edges: 18, faces: 12, solids: 1, planes: 12, cylinders: 0 });
  assert.ok(Math.abs(c.brepVolume - 1000) < 1e-9);
  assert.equal(c.open, false);
});

test('tier 1 for every fixture: closed, volume equal to the mesh', () => {
  for (const [name, exp] of Object.entries(expected())) {
    const result = run(name, { tier: 1 });
    let volume = 0;
    for (const c of result.components) {
      assert.equal(c.tier, 1, `${name}: tier`);
      assert.equal(c.open, false, `${name}: closed`);
      volume += c.brepVolume;
    }
    assert.equal(result.components.length, exp.koerper ?? 1, `${name}: bodies`);
    const want = name === 'defekt-zweikoerper.stl' ? exp.netzvolumen : result.meshVolume;
    assert.ok(Math.abs(volume - want) < 0.01, `${name}: volume ${volume} != ${want}`);
  }
});

test('every edge is used exactly twice, in opposite directions', () => {
  for (const name of ['platte.stl', 'kugel.stl', 'defekt-zweikoerper.stl', 'loch-achteck.stl']) {
    const result = run(name, { tier: 1 });
    for (const c of result.components) {
      const check = verifyBrep(c.brep, { V: c.brep.points.flat(), F: new Uint32Array(0) }, { volumeTolerancePercent: Infinity });
      const edges = check.checks.find((x) => x.name.startsWith('Kanten'));
      assert.ok(edges.ok, `${name}: ${edges.detail}`);
      const euler = check.checks.find((x) => x.name === 'Euler-Formel');
      assert.ok(euler.ok, `${name}: ${euler.detail}`);
    }
  }
});

test('Euler of the cube: 8 − 18 + 12 = 2', () => {
  const brep = facetedBrep({ V: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), F: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]) });
  const counts = brepCounts(brep);
  assert.equal(counts.points - counts.edges + counts.faces, 2, 'tetrahedron: 4 − 6 + 4');
});

test('the STEP text is a valid ISO-10303-21 file with the expected entities', () => {
  const result = run('platte.stl', { tier: 1 });
  const text = writeStep(result.components[0].brep, { name: 'platte', fileName: 'platte.stl' });
  assert.ok(text.startsWith('ISO-10303-21;\n'), 'header');
  assert.ok(text.trimEnd().endsWith('END-ISO-10303-21;'), 'footer');
  assert.match(text, /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/);
  assert.equal((text.match(/MANIFOLD_SOLID_BREP/g) || []).length, 1);
  assert.equal((text.match(/CLOSED_SHELL/g) || []).length, 1);
  assert.equal((text.match(/ADVANCED_FACE/g) || []).length, 532);
  assert.equal((text.match(/VERTEX_POINT/g) || []).length, 264, 'one vertex per corner, shared');
  assert.equal((text.match(/EDGE_CURVE/g) || []).length, 798);
  assert.equal((text.match(/ORIENTED_EDGE/g) || []).length, 2 * 798, 'every edge used twice');
  assert.ok(!/CYLINDRICAL_SURFACE/.test(text), 'tier 1 has no cylinders');
  assert.ok(!/NaN|Infinity|undefined/.test(text), 'no broken numbers');
});

test('several components become one file with one solid each', () => {
  const result = run('defekt-zweikoerper.stl', { tier: 1 });
  const brep = mergeBreps(result.components.map((c) => c.brep), ['Körper 1', 'Körper 2']);
  assert.equal(brep.solids.length, 2);
  assert.equal(brep.faces.length, 1064);
  assert.ok(Math.abs(brepVolume(brep) - expected('defekt-zweikoerper.stl').netzvolumen) < 0.01);
  const text = writeStep(brep, { name: 'zwei' });
  assert.equal((text.match(/MANIFOLD_SOLID_BREP/g) || []).length, 2);
  assert.match(text, /MANIFOLD_SOLID_BREP\('Koerper 1'/);
});

test('umlauts and units: names are written plainly, inches are scaled', () => {
  const brep = facetedBrep({ V: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), F: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]) }, 'Grüße');
  const text = writeStep(brep, { name: 'Grüße', scale: 25.4 });
  assert.match(text, /PRODUCT\('Gruesse'/);
  assert.match(text, /CARTESIAN_POINT\('',\(25.4,0.,0.\)\)/, 'inch → mm');
});

test('an open shell is written as OPEN_SHELL, never as a solid', () => {
  // Single triangle: cannot be closed.
  const brep = facetedBrep({ V: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), F: Uint32Array.from([0, 1, 2]) });
  const text = writeStep(brep, { name: 'offen', open: true });
  assert.match(text, /OPEN_SHELL/);
  assert.match(text, /SHELL_BASED_SURFACE_MODEL/);
  assert.ok(!/MANIFOLD_SOLID_BREP/.test(text));
});

test('tier 1 is always available: the chain never ends without a result', () => {
  assert.ok(TIER_BUILDERS[1], 'tier 1 exists');
  const result = run('torus.stl', {});
  for (const c of result.components) assert.ok(c.tier === 'offen' || c.tier >= 1);
});
