// Stencils: bridges that hold the islands (inside of O, A, B …), the
// material check and the mesh.

import test from 'node:test';
import assert from 'node:assert/strict';

import { union, difference, intersection, offset, regionArea, regionBounds } from '../js/core/geometry.js';
import { bridgeIslands } from '../js/core/stencil.js';
import { BED_MARGIN } from '../js/core/split.js';
import { build3MF } from '../js/export/threemf.js';
import { spreadPieces } from '../js/export/mesh.js';
import { defaultDoc, normalizeDoc } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { BUILTIN_FONTS } from '../js/core/fonts.js';
import { modelMeshes } from '../js/export/mesh.js';
import { loadFonts, font, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const getFace = (ref) => lib.peek(ref);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const rect = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
const box = (s) => {
  const b = regionBounds([s]);
  return { w: b.maxX - b.minX, h: b.maxY - b.minY, ...b };
};
const doc = (patch = {}) => {
  const d = defaultDoc();
  for (const [k, v] of Object.entries(patch)) d[k] = k === 'texts' ? v : { ...d[k], ...v };
  return normalizeDoc(d);
};
const stencil = (text, patch = {}, f = 'roboto') => buildModel(doc({
  base: { shape: 'rect' },
  body: { relief: 'cut', thickness: 1.2 },
  texts: [{ text, font: font(f), size: 20 }],
  ...patch,
  stencil: { ...patch.stencil },
}), getFace);

// A square ring cut out of a plate: the square inside is an island.
const plate = union([rect(-30, -30, 30, 30)]);
const ring = (outer, inner) => difference([outer], [inner]);

test('an island gets bridges above and below, one or two', () => {
  const cut = ring(rect(-15, -15, 15, 15), rect(-11, -11, 11, 11));
  for (const count of [1, 2]) {
    const r = bridgeIslands(plate, cut, { width: 1.5, count, direction: 'vertical' });
    assert.equal(r.islands, 1);
    assert.equal(r.unresolved, 0);
    assert.equal(difference(plate, r.cut).length, 1, 'one piece');
    assert.equal(r.bridges.length, count, `${count} bridge(s)`);
    for (const b of r.bridges.map(box)) {
      near(b.w, 1.5, 1e-6, 'bridge width');
      // Across the 4 mm stroke, a hair into the material on both ends.
      near(b.h, 4, 0.05, 'bridge length');
      near((b.minX + b.maxX) / 2, 0, 1e-6, 'in the middle');
    }
  }
  const h = bridgeIslands(plate, cut, { width: 1.5, count: 2, direction: 'horizontal' });
  assert.equal(h.bridges.length, 2);
  for (const b of h.bridges.map(box)) near(b.h, 1.5, 1e-6, 'horizontal bridge');
});

test('direction auto takes the shorter way across', () => {
  // Thick strokes above and below, thin ones left and right.
  const cut = ring(rect(-15, -18, 15, 18), rect(-12, -10, 12, 10));
  const auto = bridgeIslands(plate, cut, { width: 1.2, count: 2, direction: 'auto' });
  assert.equal(auto.bridges.length, 2);
  for (const b of auto.bridges.map(box)) {
    near(b.h, 1.2, 1e-6, 'horizontal bridge');
    near(b.w, 3, 0.05, 'across the thin stroke');
  }
  const vertical = bridgeIslands(plate, cut, { width: 1.2, count: 2, direction: 'vertical' });
  assert.ok(vertical.bridges.map(box).every((b) => b.w < b.h), 'vertical stays vertical');
  // Cut through from top to bottom: vertical is impossible, horizontal is used.
  const slot = union([rect(-1, -40, 1, 40)]);
  const split = bridgeIslands(plate, slot, { width: 1.2, count: 2, direction: 'vertical' });
  assert.equal(split.unresolved, 0);
  assert.equal(difference(plate, split.cut).length, 1);
});

test('nested islands, several plate parts and a bridge between two islands', () => {
  // Ring island with an island inside: both held.
  const cut = union(ring(rect(-20, -20, 20, 20), rect(-16, -16, 16, 16)), ring(rect(-10, -10, 10, 10), rect(-6, -6, 6, 6)));
  const r = bridgeIslands(plate, cut, { width: 1.2, count: 2 });
  assert.equal(r.islands, 2);
  assert.equal(difference(plate, r.cut).length, 1);
  // Like a B: two islands on top of each other share the bridge between them.
  const b = union(ring(rect(-10, 1, 10, 20), rect(-6, 5, 6, 16)), ring(rect(-10, -20, 10, -1), rect(-6, -16, 6, -5)), [rect(-10, -1, 10, 1)]);
  const two = bridgeIslands(plate, b, { width: 1.2, count: 2 });
  assert.equal(two.islands, 2);
  assert.equal(two.bridges.length, 3, 'top, middle, bottom');
  const one = bridgeIslands(plate, b, { width: 1.2, count: 1 });
  assert.equal(one.bridges.length, 2, 'as few as possible');
  assert.equal(difference(plate, one.cut).length, 1);
  // Two plates side by side, each with its own island.
  const plates = union([rect(-60, -20, -5, 20)], [rect(5, -20, 60, 20)]);
  const cuts = union(ring(rect(-45, -10, -20, 10), rect(-41, -6, -24, 6)), ring(rect(20, -10, 45, 10), rect(24, -6, 41, 6)));
  const pair = bridgeIslands(plates, cuts, { width: 1.2, count: 2 });
  assert.equal(pair.islands, 2);
  assert.equal(pair.unresolved, 0);
  assert.equal(difference(plates, pair.cut).length, 2);
});

test('an island with nothing next to it is reported', () => {
  // Two squares joined only by a diagonal web, which is cut away.
  const squares = union([rect(0, 0, 10, 10)], [rect(20, 20, 30, 30)]);
  const whole = union(squares, [[8, 10, 10, 8, 22, 20, 20, 22]]);
  const r = bridgeIslands(whole, difference(whole, squares), { width: 1.2, count: 2 });
  assert.equal(r.islands, 1);
  assert.equal(r.unresolved, 1);
});

test('stencil lettering: one piece in every direction, islands held', () => {
  for (const direction of ['vertical', 'horizontal', 'auto']) {
    for (const bridges of [1, 2]) {
      const m = stencil('ABOBAD 08 &', { stencil: { direction, bridges } });
      const label = `${direction} ×${bridges}`;
      assert.deepEqual(m.warnings, [], label);
      assert.equal(m.islands, 13, `${label}: islands`);
      assert.equal(difference(m.base, m.text).length, 1, `${label}: one piece`);
      assert.ok(m.bridges.length >= m.islands, `${label}: bridges`);
      // Every bridge is exactly as wide as set.
      for (const b of m.bridges.map(box)) near(Math.min(b.w, b.h), 1.2, 1e-3, `${label}: bridge width`);
      if (direction === 'vertical') assert.ok(m.bridges.map(box).every((b) => b.w < b.h), `${label}: vertical`);
      if (direction === 'horizontal') assert.ok(m.bridges.map(box).every((b) => b.h < b.w), `${label}: horizontal`);
    }
  }
  const one = stencil('ABOBAD 08 &', { stencil: { bridges: 1 } });
  const two = stencil('ABOBAD 08 &', { stencil: { bridges: 2 } });
  assert.ok(one.bridges.length < two.bridges.length, 'one bridge per island is fewer');
  const wide = stencil('O', { stencil: { bridge: 2.5 } });
  assert.equal(wide.bridges.length, 2);
  for (const b of wide.bridges.map(box)) near(b.w, 2.5, 1e-3, 'bridge width option');
  // Lettering without islands needs no bridges.
  const plain = stencil('LIFT');
  assert.equal(plain.islands, 0);
  assert.equal(plain.bridges.length, 0);
});

test('every built-in font gives a stencil in one piece', () => {
  for (const f of BUILTIN_FONTS) {
    for (const [direction, bridges] of [['vertical', 2], ['horizontal', 1]]) {
      const m = stencil('ABDOPQR\nabdegopq\n04689&', { stencil: { direction, bridges } }, f.id);
      const label = `${f.id} ${direction} ×${bridges}`;
      assert.ok(!m.warnings.some((w) => w.includes('Insel')), `${label}: ${m.warnings}`);
      // Black Ops One is a stencil font already: no islands at all.
      if (f.id === 'black-ops-one') assert.equal(m.islands, 0, label);
      else assert.ok(m.islands > 10, `${label}: islands ${m.islands}`);
      assert.equal(difference(m.base, m.text).length, 1, `${label}: one piece`);
    }
  }
});

test('stencil: frame all around, one closed part, material check', () => {
  const m = stencil('Paket', { base: { shape: 'rect', padding: 8 } });
  assert.equal(m.parts.length, 1);
  assert.equal(m.parts[0].id, 'base');
  assert.ok(m.flippable);
  // The lettering never reaches the edge.
  const b = regionBounds(m.base);
  const t = regionBounds(m.text);
  assert.ok(t.minX > b.minX + 0.5 && t.maxX < b.maxX - 0.5 && t.minY > b.minY + 0.5 && t.maxY < b.maxY - 0.5);
  near(regionArea(m.plate), regionArea(m.base) - regionArea(m.text), 1e-3, 'plate = base minus cut');
  for (const mesh of modelMeshes(m)) {
    const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
    assert.equal(badEdges, 0, 'closed');
    near(volume, mesh.part.volume, 2e-3 * mesh.part.volume, 'volume');
  }
  near(m.parts[0].volume, regionArea(m.plate) * 1.2, 1e-3, 'volume through');
  // Bridges thinner than the minimum are thin material.
  assert.equal(stencil('OB').thin.length, 0);
  const thin = stencil('OB', { stencil: { bridge: 0.5 } });
  assert.ok(thin.thin.length >= thin.bridges.length, `thin bridges found: ${thin.thin.length}`);
  // Mirrored (for the back of glass): still one piece.
  const mirrored = stencil('ABOBAD', { mirror: true });
  assert.equal(difference(mirrored.base, mirrored.text).length, 1);
  assert.ok(regionBounds(mirrored.bridges).minX < 0);
});

test('a stencil has no back, border or outline', () => {
  const m = stencil('Vorne', {
    body: { relief: 'cut', thickness: 1.2, border: true, outline: true },
    texts: [
      { text: 'Vorne', font: font('roboto'), size: 20 },
      { text: 'Hinten', font: font('roboto'), size: 8, side: 'back' },
    ],
  });
  assert.ok(m.warnings.some((w) => w.includes('keine Rückseite')));
  assert.equal(m.backText.length, 0);
  assert.equal(m.border.length, 0);
  assert.equal(m.outline.length, 0);
  assert.deepEqual(m.parts.map((p) => p.id), ['base']);
});

const big = (patch = {}) => stencil('GARAGE', {
  texts: [{ text: 'GARAGE', font: font('montserrat'), size: 70 }],
  base: { shape: 'rect', padding: 14 },
  mount: { type: 'none' },
  ...patch,
});

test('a stencil bigger than the bed is split into puzzle pieces that fit', () => {
  const m = big();
  assert.deepEqual(m.warnings, []);
  assert.ok(m.stats.width > 256, 'too big as a whole');
  assert.deepEqual([m.split.nx, m.split.ny], [2, 1]);
  assert.equal(m.pieces.length, 2);
  assert.ok(m.split.tabs >= 2, `connectors: ${m.split.tabs}`);
  const plate = difference(m.base, m.text);
  let sum = 0;
  for (const p of m.pieces) {
    assert.equal(p.region.length, 1, `piece ${p.label} in one piece`);
    const b = regionBounds(p.region);
    assert.ok(Math.max(b.maxX - b.minX, b.maxY - b.minY) <= 256 - 2 * BED_MARGIN, `piece ${p.label} fits the bed`);
    sum += regionArea(p.region);
  }
  // Only the clearance along the seams is missing.
  const loss = regionArea(plate) - sum;
  assert.ok(loss > 0 && loss < 0.01 * regionArea(plate), `loss ${loss}`);
  // The pieces keep the clearance (0.2 mm) between them and interlock.
  const [a, b] = m.pieces.map((p) => p.region);
  assert.ok(regionArea(intersection(offset(a, 0.19), b)) < 1e-6, 'clearance kept');
  assert.ok(regionArea(intersection(offset(a, 0.22), b)) > 0.1, 'side by side');
  const seam = m.pieces[0].bounds.maxX;
  assert.ok(m.pieces[1].bounds.minX < seam - 3, 'connectors reach across the seam');
  // One part and one 3MF object per piece, pulled apart for the slicer.
  assert.deepEqual(m.parts.map((p) => p.name), ['Teil 1', 'Teil 2']);
  const meshes = spreadPieces(modelMeshes(m));
  assert.equal(build3MF(meshes).objects, 2);
  for (const mesh of meshes) {
    const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
    assert.equal(badEdges, 0);
    near(volume, mesh.part.volume, 2e-3 * mesh.part.volume, `${mesh.part.name} volume`);
  }
});

test('splitting follows the bed and can be switched off', () => {
  // Smaller bed: more pieces, all fitting.
  const mini = big({ check: { bed: 180 } });
  assert.ok(mini.pieces.length >= 3, `pieces: ${mini.pieces.length}`);
  for (const p of mini.pieces) assert.ok(Math.max(p.bounds.maxX - p.bounds.minX, p.bounds.maxY - p.bounds.minY) <= 180 - 2 * BED_MARGIN);
  // Big bed: in one piece.
  const h2d = big({ check: { bed: 600 } });
  assert.equal(h2d.split, null);
  assert.equal(h2d.pieces.length, 0);
  // Switched off: one plate and a warning.
  const off = big({ stencil: { split: false } });
  assert.equal(off.split, null);
  assert.deepEqual(off.parts.map((p) => p.id), ['base']);
  assert.ok(off.warnings.some((w) => w.includes('Druckbett')));
  // Two lines on a small bed: a grid, pieces in one piece each.
  const grid = stencil('PRIVAT\nPARKPLATZ', { texts: [{ text: 'PRIVAT\nPARKPLATZ', font: font('roboto'), size: 60 }], base: { shape: 'rect', padding: 12 }, mount: { type: 'none' }, check: { bed: 180 } });
  assert.ok(grid.split.ny === 2 && grid.split.nx >= 3, `grid ${grid.split.nx} × ${grid.split.ny}`);
  assert.ok(grid.pieces.every((p) => p.region.length === 1));
  assert.deepEqual(grid.warnings, []);
});
