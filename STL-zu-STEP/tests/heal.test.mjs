// Step 3 of docs/PLAN.md: one test per defect fixture. The numbers are the
// ones docs/MACHBARKEIT.md section 3 measured with the Python prototype; the
// report has to name every repair with its count (CLAUDE.md: nothing may be
// lost or repaired silently).

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { healMesh } from '../js/core/heal.js';
import { signedVolume, openEdges, edgeMap } from '../js/core/meshops.js';
import { loadFixture, expected, meshStats } from './helpers.mjs';

const healed = (name, opts) => {
  const { V, F, tol } = weldMesh(parseMesh(loadFixture(name), name).tris);
  const out = healMesh({ V, F }, { weldTol: tol, ...opts });
  return { ...out, before: { V, F } };
};

const PLATE_VOLUME = expected('platte.stl').netzvolumen; // 7401.8573

/** Closed, consistently wound, positive volume – what every tier needs. */
function assertClosed(V, F, msg = '') {
  const stats = meshStats(V, F);
  assert.equal(stats.open, 0, `${msg}: ${stats.open} open edges`);
  assert.equal(stats.doubled, 0, `${msg}: ${stats.doubled} directed edges used twice`);
  const { undirected } = edgeMap(F);
  for (const tris of undirected.values()) assert.ok(tris.length === 2, `${msg}: non-manifold edge`);
  assert.ok(stats.volume > 0, `${msg}: volume ${stats.volume} is not positive`);
}

test('platte.stl is already clean: healing changes nothing', () => {
  const { V, F, report } = healed('platte.stl');
  assert.equal(F.length / 3, 532);
  assert.equal(V.length / 3, 264);
  assertClosed(V, F, 'platte');
  assert.deepEqual(
    [report.degenerate, report.duplicate, report.tJunctionsSplit, report.nonManifoldRemoved, report.flipped, report.holesFilled],
    [0, 0, 0, 0, 0, 0],
  );
  assert.equal(report.components, 1);
  assert.equal(report.orientedGlobally, false);
  assert.deepEqual(report.holesOpen, []);
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01);
});

test('3a degenerate: defekt-nulldreiecke.stl loses 5 triangles', () => {
  const { V, F, report } = healed('defekt-nulldreiecke.stl');
  assert.equal(report.degenerate, 5);
  assert.equal(report.duplicate, 0);
  assert.equal(F.length / 3, 532);
  assertClosed(V, F, 'nulldreiecke');
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01);
});

test('3a duplicates: defekt-doppelt.stl loses 10 triangles', () => {
  const { V, F, report } = healed('defekt-doppelt.stl');
  assert.equal(report.duplicate, 10);
  assert.equal(F.length / 3, 532);
  assertClosed(V, F, 'doppelt');
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01);
});

test('3b T-junction: defekt-tkreuzung.stl splits one triangle', () => {
  const { V, F, report, before } = healed('defekt-tkreuzung.stl');
  assert.equal(openEdges(before.F).length, 3, 'the defect leaves three unpaired edges');
  assert.equal(report.tJunctionsSplit, 1);
  assert.equal(F.length / 3, 534, 'one more triangle than the 533 of the file');
  assertClosed(V, F, 'tkreuzung');
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01);
});

test('3c non-manifold: defekt-nichtmanifold.stl loses the surplus triangle', () => {
  const { V, F, report } = healed('defekt-nichtmanifold.stl');
  assert.equal(report.nonManifoldRemoved, 1);
  assert.equal(F.length / 3, 532);
  assert.equal(V.length / 3, 264, 'the dangling point is gone too');
  assertClosed(V, F, 'nichtmanifold');
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01);
});

test('3d winding: defekt-gedreht.stl turns 26 triangles back', () => {
  const { V, F, report } = healed('defekt-gedreht.stl');
  assert.equal(report.flipped, 26);
  assert.equal(F.length / 3, 532);
  assertClosed(V, F, 'gedreht');
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01, `volume ${signedVolume(V, F)}`);
});

test('3e holes: defekt-loch.stl fills three holes', () => {
  const { V, F, report } = healed('defekt-loch.stl');
  assert.equal(report.holesFilled, 3);
  assert.deepEqual(report.holesOpen, []);
  assert.equal(F.length / 3, 532);
  assertClosed(V, F, 'loch');
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01, `volume ${signedVolume(V, F)}`);
});

test('3e holes: a hole with more than 64 edges stays open and is reported', () => {
  // Open cylinder wall with 72 segments: two boundary loops of 72 edges each,
  // both too long for the ear clipping (MAX_HOLE_EDGES = 64).
  const n = 72;
  const tris = [];
  const p = (i, z) => [3 * Math.cos((2 * Math.PI * i) / n), 3 * Math.sin((2 * Math.PI * i) / n), z];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push(...p(i, 0), ...p(j, 0), ...p(j, 10));
    tris.push(...p(i, 0), ...p(j, 10), ...p(i, 10));
  }
  const { F, report } = healMesh(weldMesh(Float64Array.from(tris)), {});
  assert.equal(report.holesFilled, 0, 'nothing is filled');
  assert.equal(report.holesOpen.length, 2, 'both rings are reported as open');
  assert.deepEqual(report.holesOpen.map((h) => h.edges), [n, n]);
  for (const h of report.holesOpen) {
    assert.equal(h.center.length, 3);
    assert.ok(h.reason.includes('72'), h.reason);
  }
  assert.equal(openEdges(F).length, 2 * n, 'the mesh stays open – the caller falls back to tier "offen"');
});

test('3f overall direction: defekt-invertiert.stl is turned as a whole', () => {
  const { V, F, report } = healed('defekt-invertiert.stl');
  assert.equal(report.orientedGlobally, true);
  assert.equal(report.flipped, 0, 'the file is consistent in itself, only inside out');
  assertClosed(V, F, 'invertiert');
  assert.ok(Math.abs(signedVolume(V, F) - PLATE_VOLUME) < 0.01);
});

test('3g components: defekt-zweikoerper.stl keeps both bodies', () => {
  const { V, F, report, components } = healed('defekt-zweikoerper.stl');
  assert.equal(report.components, 2);
  assert.equal(components.length, 2);
  let sum = 0;
  for (const c of components) {
    assertClosed(c.V, c.F, 'component');
    sum += signedVolume(c.V, c.F);
  }
  assert.ok(Math.abs(sum - expected('defekt-zweikoerper.stl').netzvolumen) < 0.01, `total volume ${sum}, expected 14803.7146`);
  assert.ok(Math.abs(sum - 2 * PLATE_VOLUME) < 0.01, 'the second body must not be lost');
});

test('two cubes touching in a point stay two closed bodies', () => {
  // Union-find over edges, not over points (see weld.test.mjs).
  const { V, F, report, components } = healed('defekt-punktberuehrung.stl');
  assert.equal(report.components, 2);
  assert.equal(components.length, 2);
  assertClosed(V, F, 'punktberuehrung');
  let sum = 0;
  for (const c of components) {
    assertClosed(c.V, c.F, 'cube');
    sum += signedVolume(c.V, c.F);
  }
  assert.ok(Math.abs(sum - 2000) < 1e-6, `total volume ${sum}`);
});

test('all defect fixtures end closed with the volume of the clean plate', () => {
  const special = { 'defekt-zweikoerper.stl': [2 * PLATE_VOLUME, 2], 'defekt-punktberuehrung.stl': [2000, 2] };
  for (const name of Object.keys(expected())) {
    if (!name.startsWith('defekt-')) continue;
    const { V, F, components } = healed(name);
    assertClosed(V, F, name);
    const [want, bodies] = special[name] ?? [PLATE_VOLUME, 1];
    const dev = Math.abs((100 * (signedVolume(V, F) - want)) / want);
    assert.ok(dev < 0.01, `${name}: volume deviates ${dev.toFixed(4)}%`);
    assert.equal(components.length, bodies, `${name}: components`);
  }
});

test('the sphere loses exactly its two collapsed pole triangles', () => {
  // Measured property of the fixture, not a defect of the file: the
  // tessellation of a sphere ends in two triangles whose points coincide
  // after welding. They carry no area, and removing them keeps the mesh
  // closed (noted in MACHBARKEIT.md section 3).
  const { V, F, report } = healed('kugel.stl');
  assert.equal(report.degenerate, 2);
  assert.equal(F.length / 3, expected('kugel.stl').dreiecke - 2);
  assertClosed(V, F, 'kugel');
  assert.ok(Math.abs(signedVolume(V, F) - expected('kugel.stl').netzvolumen) < 0.01, 'the volume does not change');
});

test('clean fixtures stay untouched (no repair is invented)', () => {
  for (const name of ['platte.stl', 'platte-unterteilt1.stl', 'platte-unterteilt2.stl', 'kegel.stl', 'torus.stl', 'wuerfel.stl', 'loch-sechseck.stl', 'loch-zwoelfeck.stl']) {
    const { V, F, report } = healed(name);
    assertClosed(V, F, name);
    assert.deepEqual(
      [report.degenerate, report.duplicate, report.tJunctionsSplit, report.nonManifoldRemoved, report.flipped, report.holesFilled],
      [0, 0, 0, 0, 0, 0],
      `${name}: ${JSON.stringify(report)}`,
    );
    assert.equal(F.length / 3, expected(name).dreiecke, `${name}: triangle count`);
  }
});
