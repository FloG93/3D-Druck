// The repair step in front of the conversion (core/diagnose.js, core/repair.js,
// the extensions of core/heal.js): diagnose → repair → validate. Every defect
// fixture is diagnosed, repaired and checked; a clean mesh must come out
// untouched; the options that are off by default must change nothing when off.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { diagnose } from '../js/core/diagnose.js';
import { repairMesh, validate, formatRepairReport, repairSteps, REPAIR_DEFAULTS } from '../js/core/repair.js';
import { healMesh } from '../js/core/heal.js';
import { convert } from '../js/core/pipeline.js';
import { writeStep } from '../js/export/step.js';
import { loadFixture } from './helpers.mjs';

const welded = (name) => {
  const { V, F, tol } = weldMesh(parseMesh(loadFixture(name), name).tris);
  return { V, F, tol };
};
const repaired = (name, opts = {}) => {
  const { V, F, tol } = welded(name);
  return { before: { V, F }, ...repairMesh({ V, F }, { weldTol: tol, ...opts }) };
};

/** A soup of triangles (flat array of 9 numbers each) welded into a mesh. */
const meshOf = (tris) => {
  const { V, F, tol } = weldMesh(Float32Array.from(tris));
  return { V, F, tol };
};

/** Axis-aligned box as 12 outward triangles. */
function box([x0, y0, z0], [x1, y1, z1]) {
  const p = (x, y, z) => [x, y, z];
  const c = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return quads.flatMap(([a, b, d, e]) => [...c[a], ...c[b], ...c[d], ...c[a], ...c[d], ...c[e]]);
}

/** UV sphere of radius r with `rings` bands; triangles whose centre lies above `cut·r` can be left out. */
function sphere(r, rings, cut = Infinity) {
  const seg = 2 * rings;
  const point = (i, j) => {
    const th = (Math.PI * i) / rings;
    const ph = (2 * Math.PI * (j % seg)) / seg;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  const out = [];
  const add = (a, b, c) => {
    if ((a[2] + b[2] + c[2]) / 3 > cut * r) return;
    out.push(...a, ...b, ...c);
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const [a, b, c, d] = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
      if (i > 0) add(a, b, d);
      if (i < rings - 1) add(d, b, c);
    }
  }
  return out;
}

// --- diagnose ----------------------------------------------------------------

test('diagnose: a clean part is watertight and reports nothing', () => {
  const { V, F } = welded('platte.stl');
  const d = diagnose(V, F);
  assert.equal(d.watertight, true);
  assert.deepEqual(
    [d.boundaryEdges, d.holes.length, d.nonManifoldEdges, d.nonManifoldVertices, d.windingConflicts, d.degenerate, d.duplicate, d.shells],
    [0, 0, 0, 0, 0, 0, 0, 1],
  );
  assert.equal(d.inverted, false);
  assert.ok(Math.abs(d.volume - 7401.857) < 0.01);
  assert.equal(d.selfIntersections.count, 0);
  assert.equal(d.triangles, 532);
});

test('diagnose: every defect fixture is named with its numbers', () => {
  const find = (name) => {
    const { V, F } = welded(name);
    return diagnose(V, F);
  };
  const hole = find('defekt-loch.stl');
  assert.equal(hole.boundaryEdges, 9, 'three missing triangles leave nine open edges');
  assert.equal(hole.holes.length, 3);
  assert.equal(hole.watertight, false);

  assert.equal(find('defekt-gedreht.stl').windingConflicts, 74, 'neighbours that run an edge the same way');
  assert.equal(find('defekt-gedreht.stl').watertight, false);

  const inverted = find('defekt-invertiert.stl');
  assert.equal(inverted.inverted, true);
  assert.ok(inverted.volume < 0);
  assert.equal(inverted.watertight, true, 'closed, only turned inside out');

  assert.equal(find('defekt-doppelt.stl').duplicate, 10);
  assert.equal(find('defekt-doppelt.stl').nonManifoldEdges, 30, 'a doubled triangle makes its three edges non-manifold');
  assert.equal(find('defekt-nichtmanifold.stl').nonManifoldEdges, 1);
  assert.equal(find('defekt-nulldreiecke.stl').degenerate, 5);

  const touching = find('defekt-punktberuehrung.stl');
  assert.equal(touching.nonManifoldVertices, 1, 'two shells meet in a single point');
  assert.equal(touching.shells, 2);
  assert.equal(touching.watertight, true);
});

test('diagnose: overlapping bodies are found as self-intersections, touching ones are not', () => {
  const { V, F } = welded('defekt-zweikoerper.stl');
  assert.ok(diagnose(V, F).selfIntersections.count > 0, 'two bodies that overlap cut through each other');
  assert.equal(diagnose(V, F, { intersections: false }).selfIntersections, null);

  const apart = meshOf([...box([0, 0, 0], [10, 10, 10]), ...box([20, 0, 0], [30, 10, 10])]);
  assert.equal(diagnose(apart.V, apart.F).selfIntersections.count, 0, 'two boxes with a gap');

  const crossing = meshOf([...box([0, 0, 0], [10, 10, 10]), ...box([5, 5, 5], [15, 15, 15])]);
  assert.ok(diagnose(crossing.V, crossing.F).selfIntersections.count > 0, 'two boxes that overlap');
});

test('diagnose: a mesh above the limit skips the intersection test and says why', () => {
  const { V, F } = welded('platte.stl');
  const d = diagnose(V, F, { maxIntersectionTriangles: 100 });
  assert.equal(d.selfIntersections, null);
  assert.match(d.selfIntersectionsSkipped, /Dreiecke/);
});

// --- repair ------------------------------------------------------------------

test('repair: every defect fixture comes out closed, validated and inside the tolerance', () => {
  for (const name of [
    'defekt-loch.stl', 'defekt-gedreht.stl', 'defekt-invertiert.stl', 'defekt-doppelt.stl',
    'defekt-nichtmanifold.stl', 'defekt-nulldreiecke.stl', 'defekt-tkreuzung.stl', 'defekt-verrutscht.stl',
  ]) {
    const { repair } = repaired(name);
    assert.equal(repair.after.watertight, true, `${name}: watertight after the repair`);
    assert.ok(repair.after.volume > 0, `${name}: positive volume`);
    assert.equal(repair.validation.ok, true, `${name}: ${repair.validation.reasons.join('; ')}`);
    // defekt-verrutscht is healed by the welding already: the repair finds nothing left to do.
    assert.equal(repair.outcome, name === 'defekt-verrutscht.stl' ? 'unverändert' : 'repariert', name);
    assert.deepEqual(
      [repair.after.boundaryEdges, repair.after.nonManifoldEdges, repair.after.windingConflicts, repair.after.degenerate, repair.after.duplicate],
      [0, 0, 0, 0, 0],
      name,
    );
  }
});

test('repair: a clean mesh stays exactly as it is', () => {
  const { before, V, F, repair, report } = repaired('platte.stl');
  assert.deepEqual([...F], [...before.F], 'same triangles');
  assert.deepEqual([...V], [...before.V], 'same points');
  assert.equal(repair.outcome, 'unverändert');
  assert.equal(repair.after, repair.before, 'the diagnosis is not made a second time');
  assert.equal(repair.validation.changed, false);
  assert.equal(repair.validation.maxDeviation, 0);
  assert.equal(repair.validation.volumeChangePercent, 0);
  assert.deepEqual(repairSteps(report), [], 'nothing to report');
  assert.deepEqual(repair.warnings, []);
});

test('validate: the volume of a broken input is not compared, a closed one is', () => {
  const turned = repaired('defekt-gedreht.stl').repair.validation;
  assert.equal(turned.volumeComparable, false, 'neighbours that run an edge the same way: the signed volume means nothing');
  assert.equal(turned.volumeChangePercent, null);
  assert.equal(turned.exceeded, false, 'and nothing moved: the distance is 0');
  const inverted = repaired('defekt-invertiert.stl').repair.validation;
  assert.equal(inverted.volumeComparable, true, 'closed, only turned inside out');
  assert.equal(inverted.volumeChangePercent, 0);
});

test('validate: removed triangles without area deviate from nothing', () => {
  const { repair, report } = repaired('defekt-nulldreiecke.stl');
  assert.equal(report.degenerate, 5);
  assert.equal(repair.before.degenerate, report.degenerate, 'diagnose and healing use the same rule');
  assert.equal(repair.validation.maxDeviation, 0);
  assert.equal(repair.validation.ok, true);
});

test('repair: the heal report is what healMesh alone gives (nothing changed when the new options are off)', () => {
  const { V, F, tol } = welded('defekt-loch.stl');
  const alone = healMesh({ V, F }, { weldTol: tol });
  const stepped = repairMesh({ V, F }, { weldTol: tol });
  assert.deepEqual([...stepped.F], [...alone.F]);
  const { timings: t1, ...r1 } = alone.report;
  const { timings: t2, ...r2 } = stepped.report;
  assert.deepEqual(r2, r1);
  assert.deepEqual(Object.keys(t2), Object.keys(t1));
});

test('repair: the time of every step is in the report', () => {
  const { repair, report } = repaired('defekt-loch.stl');
  for (const key of ['Diagnose vorher', 'Reparatur', 'Diagnose nachher', 'Prüfung gegen die Eingabe']) {
    assert.ok(Number.isFinite(repair.timings[key]), key);
  }
  assert.ok(Number.isFinite(report.timings['Löcher']), 'and those of the healing');
});

// --- large holes -------------------------------------------------------------

test('repair: a large hole in a curved surface is closed with a warning', () => {
  const { V, F, tol } = meshOf(sphere(10, 24, 0.85));
  const out = repairMesh({ V, F }, { weldTol: tol });
  assert.equal(out.report.holesFilled, 1);
  assert.equal(out.report.holesLarge.length, 1);
  assert.ok(out.report.holesLarge[0].edges >= 16);
  assert.ok(out.repair.warnings.some((w) => /Großes Loch geschlossen/.test(w)), out.repair.warnings.join(' | '));
  assert.equal(out.repair.after.watertight, true);
});

test('repair: a hole of one triangle is no estimate and no warning', () => {
  const { repair, report } = repaired('defekt-loch.stl');
  assert.equal(report.holesFilled, 3);
  assert.equal(report.holesLarge.length, 0);
  assert.equal(repair.warnings.length, 0);
});

// --- validation and the policy for a repair that goes too far ----------------

test('validate: the distance and the volume change of a filled hole are measured', () => {
  const { V, F, tol } = meshOf(sphere(10, 24, 0.85));
  const healed = healMesh({ V, F }, { weldTol: tol });
  const v = validate({ V, F }, healed);
  assert.equal(v.changed, true);
  assert.ok(v.addedTriangles > 0 && v.removedTriangles === 0);
  assert.ok(v.maxDeviation > 1 && v.maxDeviation < 12, `deviation ${v.maxDeviation}`);
  assert.ok(v.deviationRelative > REPAIR_DEFAULTS.maxDeviation, 'the flat patch is far from what is left of the sphere');
  assert.equal(v.exceeded, true);
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /Abweichung/);
});

test('repair: onExceed "warn" keeps the repair and says so', () => {
  const { V, F, tol } = meshOf(sphere(10, 24, 0.85));
  const out = repairMesh({ V, F }, { weldTol: tol, repair: { maxDeviation: 0.001 } });
  assert.equal(out.repair.outcome, 'repariert');
  assert.equal(out.repair.after.watertight, true);
  assert.ok(out.repair.warnings.some((w) => /mehr als erlaubt/.test(w)));
});

test('repair: onExceed "discard" goes back to the mesh without hole filling', () => {
  const { V, F, tol } = meshOf(sphere(10, 24, 0.85));
  const out = repairMesh({ V, F }, { weldTol: tol, repair: { maxDeviation: 0.001, onExceed: 'discard' } });
  assert.equal(out.repair.outcome, 'verworfen');
  assert.equal(out.report.holesFilled, 0);
  assert.equal(out.repair.after.watertight, false, 'the hole stays open');
  assert.equal(out.repair.validation.exceeded, false, 'without the patch nothing moved');
  assert.ok(out.repair.warnings.some((w) => /verworfen/.test(w)));
});

test('repair: onExceed "abort" stops with the diagnosis in the message', () => {
  const { V, F, tol } = meshOf(sphere(10, 24, 0.85));
  assert.throws(
    () => repairMesh({ V, F }, { weldTol: tol, repair: { maxDeviation: 0.001, onExceed: 'abort' } }),
    (e) => /Reparatur verändert das Netz zu stark/.test(e.message) && /offene Randkante/.test(e.message),
  );
});

// --- small shells ------------------------------------------------------------

test('repair: tiny loose shells go only when asked, and each one is named', () => {
  const speck = box([100, 100, 100], [101, 101, 101]);
  const { V, F, tol } = meshOf([...sphere(10, 12), ...speck]);

  const kept = repairMesh({ V, F }, { weldTol: tol });
  assert.equal(kept.components.length, 2, 'by default both shells stay');
  assert.deepEqual(kept.report.shellsRemoved, []);

  const trimmed = repairMesh({ V, F }, { weldTol: tol, repair: { minShellTriangles: 50 } });
  assert.equal(trimmed.components.length, 1);
  assert.equal(trimmed.report.shellsRemoved.length, 1);
  assert.equal(trimmed.report.shellsRemoved[0].triangles, 12);
  assert.ok(Math.abs(trimmed.report.shellsRemoved[0].volume - 1) < 1e-9);
  assert.equal(trimmed.repair.after.shells, 1);
  assert.equal(trimmed.repair.after.points < trimmed.repair.before.points, true, 'the points of the speck are gone too');
  assert.ok(repairSteps(trimmed.report).some((line) => /Kleine Schale entfernt/.test(line)));

  const byVolume = repairMesh({ V, F }, { weldTol: tol, repair: { minShellVolume: 0.01 } });
  assert.equal(byVolume.components.length, 1, 'a share of the largest shell works as well');
});

test('repair: the last shell is never removed', () => {
  const { V, F, tol } = meshOf(box([0, 0, 0], [1, 1, 1]));
  const out = repairMesh({ V, F }, { weldTol: tol, repair: { minShellTriangles: 1000 } });
  assert.equal(out.components.length, 1);
  assert.deepEqual(out.report.shellsRemoved, []);
});

// --- report ------------------------------------------------------------------

test('report: the console text has the before/after table, the steps and the validation', () => {
  const { repair, report } = repaired('defekt-loch.stl');
  const text = formatRepairReport(repair, report, 'defekt-loch.stl');
  assert.match(text, /vorher\s+nachher/);
  assert.match(text, /Randkanten \(offen\)\s+9\s+0/);
  assert.match(text, /geschlossen \(watertight\)\s+nein\s+ja/);
  assert.match(text, /3 Löcher gefüllt/);
  assert.match(text, /Prüfung gegen die Eingabe: bestanden/);
  assert.match(text, /Zeiten:/);
});

test('report: the result is plain data and survives JSON', () => {
  const { repair } = repaired('defekt-gedreht.stl');
  assert.deepEqual(JSON.parse(JSON.stringify(repair)).outcome, repair.outcome);
  assert.equal(JSON.parse(JSON.stringify(repair)).before.windingConflicts, 74);
});

// --- through the whole pipeline ----------------------------------------------

test('integration: a broken STL is repaired, converted and written as a STEP file', () => {
  for (const name of ['defekt-loch.stl', 'defekt-gedreht.stl', 'defekt-doppelt.stl', 'defekt-invertiert.stl']) {
    const result = convert(loadFixture(name), name, { repair: { intersections: true } });
    assert.ok(result.repair, `${name}: the result carries the repair report`);
    assert.equal(result.repair.after.watertight, true, name);
    assert.ok(result.components.every((c) => c.tier !== 'offen'), `${name}: a solid, not an open shell`);
    const text = writeStep(result.components[0].brep, { name });
    assert.ok(text.length > 1000, `${name}: the STEP file is not empty`);
    assert.ok(text.startsWith('ISO-10303-21;') && text.trimEnd().endsWith('END-ISO-10303-21;'));
    assert.ok(/MANIFOLD_SOLID_BREP/.test(text), `${name}: a closed solid`);
  }
});

test('integration: a clean mesh converts exactly as before', () => {
  const a = convert(loadFixture('platte.stl'), 'platte.stl');
  assert.equal(a.repair.outcome, 'unverändert');
  assert.deepEqual(a.warnings, []);
  assert.equal(a.components[0].tier, 3);
  assert.equal(a.components[0].counts.faces, 14);
});

test('integration: abort stops the conversion with a German message', () => {
  const buffer = loadFixture('defekt-loch.stl');
  assert.throws(
    () => convert(buffer, 'defekt-loch.stl', { repair: { maxDeviation: 0.0001, onExceed: 'abort' } }),
    /Reparatur verändert das Netz zu stark/,
  );
});
