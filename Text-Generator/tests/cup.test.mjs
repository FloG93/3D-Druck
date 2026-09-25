// Cups and pen holders: the wall unrolled in 2D, bent around the axis in
// 3D, closed at the seam, with a floor.

import test from 'node:test';
import assert from 'node:assert/strict';

import { regionArea, regionBounds, difference } from '../js/core/geometry.js';
import { normalizeDoc } from '../js/core/document.js';
import { buildModel, SEAM_GAP } from '../js/core/model.js';
import { modelMeshes } from '../js/export/mesh.js';
import { build3MF } from '../js/export/threemf.js';
import { exportSVG } from '../js/export/svg.js';
import { exportDXF, dxfLayers } from '../js/export/dxf.js';
import { developedModel } from '../js/core/cup.js';
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

test('conical: wider at the top, standing flat, closed', () => {
  const m = cup({ cup: { diameter: 70, height: 90, bottom: 2.4, conical: true, top: 90 }, body: { relief: 'raised', thickness: 2.4, height: 1.2, border: true, borderWidth: 3 } });
  assert.deepEqual(m.warnings, []);
  assert.equal(m.cup.conical, true);
  const slope = Math.atan(10 / 90);
  near(m.cup.slope, (slope * 180) / Math.PI, 1e-9, 'slope in degrees');
  // Designed flat: the circumference at half height × the wall's length.
  const b = regionBounds(m.base);
  near(b.maxX - b.minX, Math.PI * 80, 1e-3, 'circumference at half height');
  near(b.maxY - b.minY, 90 / Math.cos(slope), 1e-3, 'along the wall');
  near(m.stats.top, 90, 1e-9, 'height');
  assertSolid(m, 'conical cup');
  const meshes = Object.fromEntries(modelMeshes(m).map((x) => [x.part.id, x]));
  const p = meshes.base.positions;
  const { zMin, zMax } = extent(meshes.base);
  near(zMin, 0, 1e-9, 'on the bed');
  near(zMax, 90, 1e-3, 'rim height');
  let rBottom = 0;
  let rTop = 0;
  for (let i = 0; i < p.length; i += 3) {
    const r = Math.hypot(p[i], p[i + 1]);
    if (p[i + 2] === zMin) rBottom = Math.max(rBottom, r);
    if (p[i + 2] === zMax) rTop = Math.max(rTop, r);
  }
  near(rBottom, 35, 1e-3, 'foot');
  near(rTop, 45, 1e-3, 'rim');
  near(m.stats.width, 90 + (2 * 1.2) / Math.cos(slope), 1e-6, 'widest with lettering');
  // Lettering and rings stay on the outside of the sloped wall.
  const t = meshes.text.positions;
  for (let i = 0; i < t.length; i += 3) {
    const outside = 35 + t[i + 2] * Math.tan(slope);
    assert.ok(Math.hypot(t[i], t[i + 1]) > outside - 0.02, 'lettering outside the wall');
  }
});

test('conical: narrower at the top, the floor inside the wall', () => {
  const m = cup({ cup: { diameter: 90, height: 60, bottom: 3, conical: true, top: 60 }, body: { relief: 'engraved', thickness: 2, height: 0.8 } });
  near(m.cup.slope, (Math.atan(15 / 60) * 180) / Math.PI, 1e-9, 'slope');
  assertSolid(m, 'narrowing cup');
  const floor = modelMeshes(m).find((x) => x.part.id === 'floor').positions;
  const tan = -15 / 60;
  const cos = Math.cos(Math.atan(tan));
  for (let i = 0; i < floor.length; i += 3) {
    const r = Math.hypot(floor[i], floor[i + 1]);
    const outer = 45 + floor[i + 2] * tan;
    assert.ok(r < outer - 0.1 && r > outer - 2 / cos + 0.1, `floor edge in the wall: ${r} at ${floor[i + 2]}`);
  }
  // Very steep walls are flagged.
  const steep = cup({ cup: { diameter: 40, height: 30, bottom: 2, conical: true, top: 100 } });
  assert.ok(steep.warnings.some((w) => w.includes('schräg')));
  assertSolid(steep, 'steep cup');
});

test('conical: SVG and DXF get the flat pattern of the wall', () => {
  const m = cup({ cup: { diameter: 80, height: 85, bottom: 2.4, conical: true, top: 100 } });
  const d = developedModel(m);
  assert.notEqual(d, m);
  assert.equal(developedModel(d), d, 'only once');
  const straight = cup();
  assert.equal(developedModel(straight), straight, 'straight cups stay');
  // A ring sector around the apex: foot and rim are arcs as long as the
  // circumferences there.
  const slope = Math.atan(10 / 85);
  const k = Math.sin(slope) / 45;
  const L = 85 / Math.cos(slope);
  const s0 = 1 / k - L / 2;
  const s1 = 1 / k + L / 2;
  const ring = d.base[0].outer;
  let foot = 0;
  let rim = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const ra = Math.hypot(ring[i], ring[i + 1] + 1 / k);
    const rb = Math.hypot(ring[j], ring[j + 1] + 1 / k);
    assert.ok(ra > s0 - 1e-3 && ra < s1 + 1e-3, 'between the arcs');
    const len = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
    // On the Clipper grid (1e-4 mm).
    if (Math.abs(ra - s0) < 1e-3 && Math.abs(rb - s0) < 1e-3) foot += len;
    if (Math.abs(ra - s1) < 1e-3 && Math.abs(rb - s1) < 1e-3) rim += len;
  }
  near(foot, Math.PI * 80, 0.01, 'foot arc');
  near(rim, Math.PI * 100, 0.01, 'rim arc');
  // The same pattern in both files.
  assert.match(exportSVG(m, { style: 'outline' }), /id="platte"/);
  const layers = dxfLayers(m);
  near(regionArea(layers.find(([n]) => n === 'PLATTE')[2]), Math.PI * (40 + 50) * L, 0.5, 'wall area in the DXF');
  assert.match(exportDXF(m), /PLATTE/);
});
