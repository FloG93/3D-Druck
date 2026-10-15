// Step 10 of docs/PLAN.md: the parts of the interface that are plain
// functions – the wording of the report and the warnings on the download.
// The interface as a whole is tested in a real browser with
// tests/tools/ui-selftest.mjs (Playwright, outside the repository).

import test from 'node:test';
import assert from 'node:assert/strict';

import { repairLines, featureColor, TIER_TEXT } from '../js/ui/report.js';
import { exportWarnings } from '../js/ui/export-dialog.js';
import { convert, toTransferable } from '../js/core/pipeline.js';
import { loadFixture } from './helpers.mjs';

const transfer = (name, opts) => toTransferable(convert(loadFixture(name), name, opts || {}));

const emptyReport = {
  degenerate: 0, duplicate: 0, tJunctionsSplit: 0, nonManifoldRemoved: 0, flipped: 0,
  holesFilled: 0, unusedPoints: 0, orientedGlobally: false, holesOpen: [], skipped: [],
};

test('a clean mesh produces no repair lines', () => {
  assert.deepEqual(repairLines(emptyReport), []);
});

test('every repair is named with its number, singular and plural', () => {
  const lines = repairLines({ ...emptyReport, flipped: 1, duplicate: 10, holesFilled: 3 });
  assert.deepEqual(lines, ['10 doppelte Dreiecke entfernt', '1 Dreieck gedreht', '3 Löcher gefüllt']);
  const global = repairLines({ ...emptyReport, orientedGlobally: true });
  assert.match(global[0], /umgedreht/);
  const open = repairLines({ ...emptyReport, holesOpen: [{ edges: 72, center: [0, 0, 0], reason: 'Schleife mit 72 Kanten' }] });
  assert.match(open[0], /72 Kanten/);
  assert.match(repairLines({ ...emptyReport, skipped: ['Löcher füllen'] })[0], /Abgeschaltet/);
});

test('the report of a real file names what happened to the mesh', () => {
  const lines = repairLines(transfer('defekt-gedreht.stl').healReport);
  assert.deepEqual(lines, ['26 Dreiecke gedreht']);
  assert.deepEqual(repairLines(transfer('defekt-doppelt.stl').healReport), ['10 doppelte Dreiecke entfernt']);
  assert.deepEqual(repairLines(transfer('defekt-loch.stl').healReport), ['3 Löcher gefüllt']);
  assert.deepEqual(repairLines(transfer('platte.stl').healReport), []);
});

test('tier 3 needs no warning on the download, tier 1 does', () => {
  const good = transfer('platte.stl');
  assert.deepEqual(exportWarnings(good, 16000), []);
  const faceted = transfer('platte.stl', { tier: 1 });
  const warnings = exportWarnings(faceted, 372000);
  assert.ok(warnings.some((w) => w.includes('Stufe 1')), warnings.join(' | '));
  assert.ok(warnings.some((w) => /532/.test(w)), 'the number of faces is in the warning');
});

test('an open shell warns that it is not a solid', () => {
  const open = transfer('platte.stl', { forceFail: { tier3: true, tier2: true, tier1: true } });
  const warnings = exportWarnings(open, 400000);
  assert.ok(warnings[0].includes('offene Schale'), warnings.join(' | '));
  assert.ok(warnings[0].includes('kein Volumenkörper'));
});

test('a very large file is called out by its size', () => {
  const result = transfer('platte.stl');
  const warnings = exportWarnings(result, 40 * 1024 * 1024);
  assert.ok(warnings.some((w) => /MB/.test(w)), warnings.join(' | '));
});

test('every tier has a German name and an explanation', () => {
  for (const key of [1, 2, 3, 'offen']) {
    assert.ok(TIER_TEXT[key].name, `${key}: name`);
    assert.ok(TIER_TEXT[key].what.length > 10, `${key}: explanation`);
  }
});

test('the colours of the features are stable and distinguishable', () => {
  const colors = Array.from({ length: 8 }, (_, i) => featureColor(i));
  assert.equal(new Set(colors).size, 8, 'eight different colours');
  assert.equal(featureColor(0), featureColor(8), 'the palette repeats');
  for (const c of colors) assert.match(c, /^hsl\(\d+ \d+% \d+%\)$/);
});

test('the data for the preview marks exactly the triangles of the cylinders', () => {
  const result = transfer('platte.stl');
  const marked = [...result.preview.cylinderOfTriangle].filter((v) => v >= 0).length;
  const fromFeatures = result.cylinders.reduce((s, c) => s + c.triangles, 0);
  assert.equal(marked, fromFeatures);
  assert.equal(result.preview.F.length / 3, result.triangles);
  for (const id of result.preview.cylinderOfTriangle) assert.ok(id < result.cylinders.length);
});

test('the transferable result survives structured cloning (worker → page)', () => {
  const result = transfer('defekt-zweikoerper.stl');
  const clone = structuredClone(result);
  assert.equal(clone.components.length, 2);
  assert.equal(clone.cylinders.length, 12);
  assert.equal(clone.preview.V.length, result.preview.V.length);
  assert.deepEqual(clone.components[0].counts, result.components[0].counts);
});
