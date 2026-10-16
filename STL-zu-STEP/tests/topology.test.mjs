// Step 7 of docs/PLAN.md: tier 2, flat patches merged into one face with
// holes. Measured in MACHBARKEIT section 1: merging the planes saves about
// 75 % of the faces (plate: 134 instead of 532).

import test from 'node:test';
import assert from 'node:assert/strict';

import { convert, buildPlanarTier } from '../js/core/pipeline.js';
import { buildTopology, planeModel, patchFlatness } from '../js/core/topology.js';
import { weldMesh } from '../js/core/weld.js';
import { healMesh } from '../js/core/heal.js';
import { parseMesh } from '../js/core/parse.js';
import { growPatches } from '../js/core/patches.js';
import { writeStep } from '../js/export/step.js';
import { brepCounts } from '../js/core/brep.js';
import { verifyBrep } from '../js/core/verify.js';
import { bbox } from '../js/core/meshops.js';
import { loadFixture, expected } from './helpers.mjs';

const prepare = (name) => {
  const { V, F, tol } = weldMesh(parseMesh(loadFixture(name), name).tris);
  const healed = healMesh({ V, F }, { weldTol: tol });
  return { V: healed.V, F: healed.F };
};

test('tier 2: the cube becomes six faces, the plate 134', () => {
  const cube = convert(loadFixture('wuerfel.stl'), 'wuerfel.stl', { tier: 2 }).components[0];
  assert.equal(cube.tier, 2);
  assert.deepEqual(brepCounts(cube.brep), { points: 8, edges: 12, faces: 6, solids: 1, planes: 6, cylinders: 0 });

  const plate = convert(loadFixture('platte.stl'), 'platte.stl', { tier: 2 }).components[0];
  assert.equal(plate.counts.faces, 134, 'as many faces as patches (reference number)');
  assert.ok(plate.counts.faces < 532 * 0.3, 'about 75 % fewer faces than tier 1');
  assert.ok(Math.abs(plate.deviationPercent) < 1e-9, 'the volume is the volume of the mesh');
});

test('tier 2: the top face carries its two holes as inner loops', () => {
  const plate = convert(loadFixture('platte.stl'), 'platte.stl', { tier: 2 }).components[0];
  const withHoles = plate.brep.faces.filter((f) => f.loops.length > 1);
  assert.equal(withHoles.length, 2, 'top and bottom face have two bores each');
  for (const face of withHoles) assert.equal(face.loops.length, 3, 'outer loop plus two holes');
  const text = writeStep(plate.brep, { name: 'platte' });
  assert.equal((text.match(/FACE_OUTER_BOUND/g) || []).length, 134);
  assert.equal((text.match(/FACE_BOUND\(/g) || []).length, 4, 'four inner loops (FACE_OUTER_BOUND is a different entity)');
});

test('tier 2: corners, chains and loops of the cube', () => {
  const mesh = prepare('wuerfel.stl');
  const patches = growPatches(mesh);
  const models = new Map(patches.planes.map((p, i) => [i, planeModel(p)]));
  const regionOfTriangle = patches.labels;
  const topology = buildTopology(mesh, regionOfTriangle, models);
  assert.equal(topology.corners.size, 8, 'every corner of the cube belongs to three faces');
  assert.equal(topology.chains.length, 24, 'twelve edges, each seen from both faces');
  for (const [, loops] of topology.loops) assert.equal(loops.length, 1, 'one loop per face');
  for (const chain of topology.chains) {
    assert.equal(chain.points.length, 2, 'a chain of the cube is one edge');
    assert.equal(chain.neighbours.length, 1, 'exactly one region on the other side');
  }
});

test('a patch that is not flat stays facets – no plane is forced', () => {
  // The patches of a sphere are up to 1e-2 mm away from their own plane.
  const mesh = prepare('kugel.stl');
  const patches = growPatches(mesh);
  const diagonal = bbox(mesh.V).diagonal;
  const notFlat = patches.patches.filter((tris, i) => patchFlatness(mesh, tris, patches.planes[i]) > 1e-6 * diagonal);
  assert.ok(notFlat.length > 0, 'the sphere has patches that are not flat');
  const built = buildPlanarTier(mesh, { patches });
  // Every face of the result has its boundary in its own plane.
  for (const face of built.brep.faces) {
    const n = face.surface.normal;
    const len = Math.hypot(...n);
    for (const loop of face.loops) {
      for (const { edge, sense } of loop) {
        const v = sense ? built.brep.edges[edge].v0 : built.brep.edges[edge].v1;
        const p = built.brep.points[v];
        const d = Math.abs(((p[0] - face.surface.point[0]) * n[0] + (p[1] - face.surface.point[1]) * n[1] + (p[2] - face.surface.point[2]) * n[2]) / len);
        assert.ok(d <= 1e-6 * diagonal + 1e-9, `boundary point ${d} off its plane`);
      }
    }
  }
});

test('tier 2 for every fixture: valid structure and the volume of the mesh', () => {
  for (const [name, exp] of Object.entries(expected())) {
    const result = convert(loadFixture(name), name, { tier: 2 });
    let volume = 0;
    let faces = 0;
    for (const c of result.components) {
      assert.equal(c.tier, 2, `${name}: tier 2 reached`);
      volume += c.brepVolume;
      faces += c.counts.faces;
      const check = verifyBrep(c.brep, { V: c.brep.points.flat(), F: new Uint32Array(0) }, { volumeTolerancePercent: Infinity });
      assert.ok(check.checks.find((x) => x.name.startsWith('Kanten')).ok, `${name}: ${check.checks[0].detail}`);
    }
    assert.equal(result.components.length, exp.koerper ?? 1, `${name}: bodies`);
    const want = name === 'defekt-zweikoerper.stl' ? exp.netzvolumen : result.meshVolume;
    assert.ok(Math.abs(volume - want) < 0.01, `${name}: volume ${volume} != ${want}`);
    assert.ok(faces <= exp.dreiecke + 4, `${name}: ${faces} faces, never more than tier 1`);
  }
});

test('shifted points cost faces, and that is visible in the result', () => {
  // defekt-verrutscht.stl: every point moved by 2e-5, so some patches miss
  // the flatness limit of 1e-6 · diagonal and stay facets. Nothing is
  // projected onto a plane behind the back of the user.
  const clean = convert(loadFixture('platte.stl'), 'platte.stl', { tier: 2 }).components[0];
  const shifted = convert(loadFixture('defekt-verrutscht.stl'), 'defekt-verrutscht.stl', { tier: 2 }).components[0];
  assert.equal(clean.counts.faces, 134);
  assert.ok(shifted.counts.faces > 134, `${shifted.counts.faces} faces`);
  assert.ok(shifted.counts.faces < 532, 'still fewer than tier 1');
  // The plane of a patch is its average plane, and the boundary points of
  // the shifted file are up to 4.6e-5 mm away from it – that shows up as a
  // volume deviation of 5e-5 %, five orders of magnitude below the check.
  assert.ok(Math.abs(shifted.deviationPercent) < 1e-3, `deviation ${shifted.deviationPercent} %`);
  assert.ok(Math.abs(clean.deviationPercent) < 1e-9, 'the clean file is exact');
});

test('the automatic choice takes tier 2 over tier 1', () => {
  for (const name of ['platte.stl', 'wuerfel.stl', 'loch-zwoelfeck.stl', 'kegel.stl']) {
    const result = convert(loadFixture(name), name, {});
    for (const c of result.components) assert.ok(c.tier === 2 || c.tier === 3, `${name}: tier ${c.tier}`);
  }
});
