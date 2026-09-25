// Cups and pen holders: the wall unrolled in 2D, bent around the axis in
// 3D, closed at the seam, with a floor.

import test from 'node:test';
import assert from 'node:assert/strict';

import { regionArea, regionBounds, difference } from '../js/core/geometry.js';
import { normalizeDoc } from '../js/core/document.js';
import { buildModel, SEAM_GAP } from '../js/core/model.js';
import { modelMeshes } from '../js/export/mesh.js';
import { build3MF } from '../js/export/threemf.js';
import { loadFonts, font, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const getFace = (ref) => lib.peek(ref);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const cup = (patch = {}) => buildModel(normalizeDoc({
  texts: [{ text: 'STIFTE', font: font('montserrat'), size: 16 }],
  base: { shape: 'cup' },
  mount: { type: 'none' },
  cup: { diameter: 72, height: 100, bottom: 2.4 },
  body: { relief: 'raised', thickness: 2.4, height: 1.2 },
  ...patch,
}), getFace);
const assertSolid = (m, label) => {
  for (const mesh of modelMeshes(m)) {
    const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
    assert.equal(badEdges, 0, `${label} / ${mesh.part.name}: closed`);
    near(volume, mesh.part.volume, 1e-3 * mesh.part.volume, `${label} / ${mesh.part.name}: volume`);
  }
};
/** Smallest and largest distance from the axis, lowest and highest point. */
function extent(mesh) {
  let rMin = Infinity;
  let rMax = 0;
  let zMin = Infinity;
  let zMax = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i], p[i + 1]);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
    zMin = Math.min(zMin, p[i + 2]);
    zMax = Math.max(zMax, p[i + 2]);
  }
  return { rMin, rMax, zMin, zMax };
}

test('the wall is unrolled in 2D: circumference × height', () => {
  const m = cup();
  assert.deepEqual(m.warnings, []);
  const b = regionBounds(m.base);
  near(b.maxX - b.minX, Math.PI * 72, 1e-3, 'circumference');
  near(b.maxY - b.minY, 100, 1e-9, 'height');
  near(m.cup.circumference, Math.PI * 72, 1e-3, 'reported');
  assert.equal(m.flippable, false);
  near(m.stats.top, 100, 1e-9, 'cup height');
  near(m.stats.width, 72 + 2 * 1.2, 1e-9, 'diameter with lettering');
  // Lettering keeps clear of the seam at the back.
  const t = regionBounds(m.text);
  assert.ok(t.minX > b.minX + SEAM_GAP - 1e-9 && t.maxX < b.maxX - SEAM_GAP + 1e-9);
});

test('bent around the axis: closed wall, lettering in front, floor', () => {
  const m = cup();
  assert.deepEqual(m.parts.map((p) => p.name), ['Platte', 'Schrift', 'Boden']);
  assertSolid(m, 'raised cup');
  const meshes = Object.fromEntries(modelMeshes(m).map((x) => [x.part.id, x]));
  const wall = extent(meshes.base);
  near(wall.rMax, 36, 1e-3, 'outside');
  near(wall.rMin, 36 - 2.4, 0.01, 'inside (chords)');
  near(wall.zMin, 0, 1e-6, 'standing on the bed');
  near(wall.zMax, 100, 1e-4, 'top');
  const text = extent(meshes.text);
  assert.ok(text.rMin > 36 - 0.01 && text.rMax < 36 + 1.2 + 1e-3, `lettering on the outside: ${text.rMin} … ${text.rMax}`);
  // The lettering faces the front (−y) and is centred.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const p = meshes.text.positions;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    y1 = Math.max(y1, p[i + 1]);
  }
  near((x0 + x1) / 2, 0, 1, 'centred');
  // About 75 mm of lettering on 226 mm: ±60° around the front.
  assert.ok(y1 < -10, `in the front half: ${y1}`);
  // The floor reaches halfway into the wall.
  const floor = extent(meshes.floor);
  near(floor.rMax, 36 - 1.2, 0.01, 'floor radius');
  near(floor.zMax, 2.4, 1e-6, 'floor thickness');
  // One object for the slicer.
  assert.equal(build3MF(modelMeshes(m)).objects, 1);
});

test('engraved, flush with rings, and a lantern (cut through)', () => {
  const engraved = cup({ body: { relief: 'engraved', thickness: 2.4, height: 1 } });
  assertSolid(engraved, 'engraved cup');
  near(engraved.stats.width, 72, 1e-9, 'nothing sticks out');
  const flush = cup({ body: { relief: 'flush', thickness: 2.4, height: 0.6, border: true, borderWidth: 3 } });
  assertSolid(flush, 'flush cup with rings');
  // The rings run all around: as wide as the unrolled wall.
  const rb = regionBounds(flush.border);
  near(rb.maxX - rb.minX, Math.PI * 72, 1e-3, 'ring all around');
  near(regionArea(flush.border), 2 * 3 * Math.PI * 72, 0.5, 'two rings');
  const lantern = cup({
    texts: [{ text: 'Frohes Fest', font: font('montserrat'), size: 18 }],
    cup: { diameter: 80, height: 100, bottom: 2 },
    body: { relief: 'cut', thickness: 1.6 },
  });
  assert.ok(lantern.islands >= 3, `islands held: ${lantern.islands}`);
  assert.equal(difference(lantern.base, lantern.text).length, 1, 'wall in one piece');
  assert.equal(lantern.split, null, 'never split');
  assertSolid(lantern, 'lantern');
});

test('a cup has no mount, back, magnets or stamp', () => {
  const m = cup({
    texts: [{ text: 'Vorne', font: font('roboto'), size: 12 }, { text: 'Hinten', font: font('roboto'), size: 8, side: 'back' }],
    mount: { type: 'eyelet' },
    magnets: { enabled: true },
    stamp: { enabled: true },
  });
  assert.deepEqual(m.warnings, ['Ein Becher hat keine Rückseite – die Blöcke hinten entfallen.']);
  near(regionArea(m.base), Math.PI * 72 * 100, 0.05, 'no eyelet on the wall');
  assert.equal(m.backText.length, 0);
  assert.equal(m.magnets.length, 0);
  assert.equal(m.stamp, null);
  assert.equal(m.mirrored, false);
  assert.ok(m.layouts.every((l) => l.side === 'front'));
  assertSolid(m, 'cup with ignored extras');
  // Too long for the circumference: cut off at the seam, with a warning.
  const long = cup({ texts: [{ text: 'Eine sehr lange Zeile rundherum um den Becher', font: font('roboto'), size: 12 }] });
  assert.ok(long.warnings.some((w) => w.includes('ragt über die Platte')));
  assertSolid(long, 'long text');
});
