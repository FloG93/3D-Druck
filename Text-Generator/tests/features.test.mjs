// Mounts, magnets, outline, colours per text, symbols, print orientation
// and the bed check.

import test from 'node:test';
import assert from 'node:assert/strict';

import { regionArea, regionBounds, pointInRing, thinParts } from '../js/core/geometry.js';
import { layoutBlock } from '../js/core/layout.js';
import { defaultDoc, normalizeDoc } from '../js/core/document.js';
import { buildModel, countersinkSegments, MIN_FLOOR } from '../js/core/model.js';
import { SYMBOLS } from '../js/core/fonts.js';
import { modelMeshes, flipMeshes } from '../js/export/mesh.js';
import { build3MF } from '../js/export/threemf.js';
import { loadFonts, font, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const getFace = (ref) => lib.peek(ref);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const doc = (patch = {}) => {
  const d = defaultDoc();
  for (const [k, v] of Object.entries(patch)) d[k] = k === 'texts' ? v : { ...d[k], ...v };
  return normalizeDoc(d);
};
const build = (patch) => buildModel(doc(patch), getFace);

/** Every part is closed and its mesh volume matches the computed volume. */
function assertSolid(m, label) {
  assert.ok(m.parts.length, `${label}: no parts`);
  for (const mesh of modelMeshes(m)) {
    const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
    assert.equal(badEdges, 0, `${label} / ${mesh.part.name}: open edges`);
    near(volume, mesh.part.volume, Math.max(2e-3 * mesh.part.volume, 0.05), `${label} / ${mesh.part.name}: volume`);
  }
}

const inside = (region, x, y) => region.some((s) => pointInRing(s.outer, x, y) && !s.holes.some((hl) => pointInRing(hl, x, y)));

test('two countersunk screw holes: cylinder plus 90° cone', () => {
  for (const shape of ['rect', 'contour']) {
    const m = build({ base: { shape }, mount: { type: 'screws', diameter: 4, head: 8, countersink: true }, body: { thickness: 5 } });
    assert.equal(m.holes.length, 2, shape);
    assert.equal(m.countersinks.length, 2, shape);
    const [a, b] = m.countersinks;
    assert.ok(a.cx < 0 && b.cx > 0, `${shape}: left and right`);
    near(a.R, 4, 1e-9, `${shape}: head radius`);
    near(a.depth, a.R - a.r, 1e-9, `${shape}: 90° cone`);
    // The holes are inside the plate, the text stays clear of the cones.
    for (const c of m.countersinks) {
      assert.ok(!inside(m.text, c.cx, c.cy), `${shape}: text over the screw`);
      assert.ok(inside(m.base, c.cx + c.r + 0.5, c.cy) || inside(m.base, c.cx - c.r - 0.5, c.cy), `${shape}: hole in the plate`);
    }
    assertSolid(m, `screws ${shape}`);
  }
  // Thin plate: the countersink shrinks and says so.
  const thin = build({ base: { shape: 'rect' }, mount: { type: 'screws', diameter: 4, head: 9 }, body: { thickness: 2 } });
  near(thin.countersinks[0].R, 2 + 2 - 0.6, 1e-9, 'limited countersink');
  assert.ok(thin.warnings.some((w) => w.includes('Senkung')));
  // Without countersink: plain through holes, no cones.
  const plain = build({ base: { shape: 'rect' }, mount: { type: 'screws', countersink: false } });
  assert.equal(plain.countersinks.length, 0);
  assert.equal(plain.base[0].holes.length, 2);
  assertSolid(plain, 'screws without countersink');
});

test('countersink volume uses the same polygon as the mesh', () => {
  const m = build({ base: { shape: 'rect' }, mount: { type: 'screws', diameter: 3.4, head: 7 }, body: { thickness: 4, relief: 'flush', border: true } });
  const n = countersinkSegments(m.countersinks[0].R);
  assert.ok(n >= 24 && n <= 96);
  assertSolid(m, 'flush with border and countersinks');
});

test('slot for a band or clip, inside the plate or as a tab', () => {
  for (const [shape, position] of [['rect', 'left'], ['capsule', 'top'], ['contour', 'right']]) {
    const m = build({ base: { shape }, mount: { type: 'slot', position, diameter: 3, length: 12, ring: 2 } });
    assert.equal(m.slots.length, 1, shape);
    const bb = regionBounds([{ outer: m.slots[0], holes: [] }]);
    const [w, hgt] = [bb.maxX - bb.minX, bb.maxY - bb.minY];
    near(Math.max(w, hgt), 12, 1e-6, `${shape}: slot length`);
    near(Math.min(w, hgt), 3, 1e-6, `${shape}: slot width`);
    assert.ok(position === 'top' ? w > hgt : hgt > w, `${shape}: slot direction`);
    // The slot is a hole in the plate and does not touch the lettering.
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    assert.ok(!inside(m.base, cx, cy), `${shape}: slot is open`);
    assert.ok(!inside(m.text, cx, cy), `${shape}: text in the slot`);
    assert.ok(!m.warnings.some((x) => x.includes('Schlitz')), `${shape}: ${m.warnings.join(' | ')}`);
    assertSolid(m, `slot ${shape}`);
  }
});

test('eyelet beside the text, not in the notch between two lines', () => {
  const anna = { text: 'Anna', font: font('pacifico'), size: 10 };
  // One line: at half height, also with swashes.
  for (const t of [anna, { text: 'Jakob', font: font('lobster'), size: 10 }]) {
    const m = build({ texts: [t] });
    near(m.holes[0].cy, (m.bounds.minY + m.bounds.maxY) / 2, 0.6, `${t.text}: half height`);
  }
  // A short second line far below: the plate is pinched in the middle,
  // so the eyelet goes beside the first line.
  for (const position of ['left', 'right']) {
    const m = build({ texts: [anna, { text: 'Text', font: font('pacifico'), size: 6, y: -18 }], mount: { type: 'eyelet', position } });
    const h = m.holes[0];
    assert.ok(h.cy > -5 && h.cy < 5, `${position}: eyelet at y ${h.cy}`);
    assertSolid(m, `eyelet ${position}`);
  }
  // Two lines as long as each other: the upper one.
  const two = build({ texts: [{ text: 'Oma\nOpa', font: font('roboto'), size: 8 }] });
  assert.ok(two.holes[0].cy >= (two.bounds.minY + two.bounds.maxY) / 2 - 0.6, `upper line: ${two.holes[0].cy}`);
});

test('magnet pockets on the back', () => {
  const m = build({ base: { shape: 'rect' }, texts: [{ text: 'Magnet', font: font('roboto'), size: 12 }], magnets: { enabled: true, count: 3, diameter: 6.2, depth: 2.2 }, body: { thickness: 3.2 } });
  assert.equal(m.magnets.length, 3);
  near(m.magnetDepth, 2.2, 1e-9, 'full depth');
  for (const c of m.magnets) assert.ok(inside(m.base, c.cx, c.cy), 'pocket inside the plate');
  const d = Math.hypot(m.magnets[1].cx - m.magnets[0].cx, m.magnets[1].cy - m.magnets[0].cy);
  assert.ok(d >= 6.2 + 1.2 - 1e-6, `pockets apart: ${d}`);
  assertSolid(m, 'magnets raised');
  const plate = m.parts.find((p) => p.id === 'base');
  const full = regionArea(m.base) * 3.2;
  near(full - plate.volume, 3 * 2.2 * regionArea([{ outer: circlePolygon(3.1), holes: [] }]), 0.5, 'pocket volume');

  // Flush lettering takes depth from the top: the pockets get shallower.
  const flush = build({ base: { shape: 'rect' }, magnets: { enabled: true, count: 2 }, body: { relief: 'flush', thickness: 2.4, height: 0.6 } });
  near(flush.magnetDepth, 2.4 - 0.6 - 0.6, 1e-9, 'limited depth');
  assert.ok(flush.warnings.some((w) => w.includes('Magnet')));
  assertSolid(flush, 'magnets flush');

  // Too thin: no pockets at all.
  const thin = build({ base: { shape: 'rect' }, magnets: { enabled: true }, body: { relief: 'engraved', thickness: 1.6, height: 0.8 } });
  assert.equal(thin.magnets.length, 0);
  assert.ok(thin.warnings.some((w) => w.includes('zu dünn')));

  // More magnets than fit: fewer, with a note.
  const many = build({ base: { shape: 'rect' }, texts: [{ text: 'Hi', font: font('roboto'), size: 8 }], magnets: { enabled: true, count: 12 }, body: { thickness: 3.2 } });
  assert.ok(many.magnets.length < 12 && many.magnets.length >= 1);
  assert.ok(many.warnings.some((w) => w.includes('nebeneinander')));
});

function circlePolygon(r) {
  const out = [];
  const n = 256;
  for (let i = 0; i < n; i++) out.push(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n));
  return out;
}

test('outline around the lettering: third colour, raised or flush', () => {
  const raised = build({ body: { relief: 'raised', thickness: 2.4, height: 1, outline: true, outlineWidth: 1.5, outlineHeight: 0.6 } });
  const outline = raised.parts.find((p) => p.id === 'outline');
  const text = raised.parts.find((p) => p.id === 'text');
  assert.ok(outline && text);
  assert.equal(outline.slot, 3);
  near(outline.solids[0].z0, 2.4, 1e-9, 'outline on the plate');
  near(text.solids[0].z0, 3.0, 1e-9, 'text on the outline');
  // The outline covers the letters and reaches about 1.5 mm further.
  assert.ok(regionArea(raised.outline) > regionArea(raised.text) * 1.3);
  assert.ok(regionArea(raised.text) > 0);
  const tb = regionBounds(raised.text);
  const ob = regionBounds(raised.outline);
  near(tb.minX - ob.minX, 1.5, 0.05, 'outline width');
  // The plate grows by the outline width, so the outline stays on it.
  const pb = regionBounds(raised.base);
  assert.ok(ob.minX > pb.minX + 1 && ob.maxY < pb.maxY - 1, 'outline inside the plate');
  assertSolid(raised, 'outline raised');

  const flush = build({ base: { shape: 'rect' }, body: { relief: 'flush', thickness: 2, height: 0.6, outline: true, border: true } });
  const ids = flush.parts.map((p) => p.id);
  assert.deepEqual(ids, ['base', 'outline', 'text', 'border']);
  assert.ok(flush.flippable);
  assertSolid(flush, 'outline flush');
  // Engraved text has no outline.
  assert.equal(build({ body: { relief: 'engraved', outline: true } }).outline.length, 0);
});

test('every text can have its own colour (AMS filament)', () => {
  const texts = [
    { text: 'Lena', font: font('pacifico'), size: 10, y: 4 },
    { text: 'Nr. 7', font: font('roboto'), size: 5, y: -8, slot: 4, color: '#ffd166' },
    { text: '♥', font: font('roboto'), size: 5, x: 20, y: -8, slot: 5, color: '#ef476f' },
  ];
  const m = build({ base: { shape: 'rect' }, texts });
  assert.deepEqual(m.parts.map((p) => [p.id, p.name, p.slot, p.color]), [
    ['base', 'Platte', 1, '#f2f2ef'], ['text', 'Schrift', 2, '#1f6feb'],
    ['text-4', 'Text 2', 4, '#ffd166'], ['text-5', 'Text 3', 5, '#ef476f'],
  ]);
  assertSolid(m, 'colour groups');
  const { config } = build3MF(modelMeshes(m));
  for (const n of [1, 2, 4, 5]) assert.ok(config.includes(`key="extruder" value="${n}"`), `extruder ${n}`);
  // Same slot as "Schrift": one part.
  const same = build({ texts: [texts[0], { ...texts[1], slot: 2 }] });
  assert.deepEqual(same.parts.map((p) => p.id), ['base', 'text']);
  // Flush inlays get their own colour too.
  const flush = build({ base: { shape: 'rect' }, texts, body: { relief: 'flush' } });
  assert.deepEqual(flush.parts.map((p) => p.id), ['base', 'text', 'text-4', 'text-5']);
  assertSolid(flush, 'colour groups flush');
});

test('symbols come from the built-in solid icons', async () => {
  const m = build({ base: { shape: 'rect' }, texts: [{ text: 'Anna ♥', font: font('montserrat'), size: 10 }] });
  assert.equal(m.missing.size, 0);
  assert.ok(!m.warnings.length, m.warnings.join(' | '));
  assertSolid(m, 'heart');
  // Every symbol of the palette has an outline about as tall as a capital
  // letter, centred on it, with strokes thick enough to print.
  const face = lib.peek(font('roboto'));
  for (const ch of SYMBOLS) {
    const lay = layoutBlock({ text: `H${ch}`, size: 10, letterSpacing: 0, lineSpacing: 1.2, align: 'center', layout: 'line' }, face);
    assert.equal(lay.missing.size, 0, ch);
    const sym = lay.glyphs.find((g) => g.ch === ch);
    assert.ok(sym, `${ch} has an outline`);
    const b = regionBounds(sym.rings.map((r) => ({ outer: r, holes: [] })));
    const H = regionBounds(lay.glyphs[0].rings.map((r) => ({ outer: r, holes: [] })));
    assert.ok(b.maxY - b.minY <= 12 && b.maxY - b.minY >= 5, `${ch} height ${b.maxY - b.minY}`);
    near((b.minY + b.maxY) / 2, (H.minY + H.maxY) / 2, 1.3, `${ch} centred`);
    assert.ok(b.minX > H.maxX + 0.3, `${ch}: space after the H`);
    assert.equal(thinParts(lay.region, 0.8).length, 0, `${ch}: thin strokes at 10 mm`);
  }
  // Pasted emoji use the same icons (🐕 like 🐶, ❤ like ♥).
  const same = (a, b) => {
    const ga = layoutBlock({ text: a, size: 10 }, face).glyphs[0].rings;
    const gb = layoutBlock({ text: b, size: 10 }, face).glyphs[0].rings;
    assert.deepEqual(ga, gb, `${a} = ${b}`);
  };
  same('🐶', '🐕');
  same('♥', '❤');
  same('🌲', '🎄');
  // Without the symbol font: reported as missing, not as a font problem.
  const bare = await loadFonts({ symbols: false });
  const m2 = buildModel(doc({ texts: [{ text: 'Anna ♥', font: font('montserrat') }] }), (r) => bare.peek(r));
  assert.ok(m2.missing.has('♥'));
  assert.ok(m2.warnings.some((w) => w.includes('♥') && w.includes('keinen Umriss')), m2.warnings.join(' | '));
  const m3 = buildModel(doc({ texts: [{ text: 'Anna ♥', font: font('montserrat') }] }), (r) => bare.peek(r), { symbolsLoading: true });
  assert.ok(m3.warnings.some((w) => w.includes('geladen')));
  // Emoji variation selectors are ignored.
  assert.equal(build({ texts: [{ text: '❄️', font: font('roboto') }] }).missing.size, 0);
});

test('print orientation: lettering on the bed for flat tops', () => {
  const flush = build({ base: { shape: 'rect' }, body: { relief: 'flush', thickness: 2.4, height: 0.6, border: true } });
  assert.ok(flush.flippable);
  const top = flush.stats.top;
  const meshes = modelMeshes(flush);
  const flipped = flipMeshes(meshes, top);
  for (let i = 0; i < meshes.length; i++) {
    const a = meshCheck(meshes[i].positions, meshes[i].triangles);
    const b = meshCheck(flipped[i].positions, flipped[i].triangles);
    assert.equal(b.badEdges, 0);
    near(b.volume, a.volume, 1e-6 * Math.abs(a.volume) + 1e-6, 'volume kept (winding kept)');
    assert.ok(b.volume > 0, 'outward normals');
  }
  // After flipping, the text inlay is at the bottom (z 0 … depth).
  const text = flipped.find((m) => m.part.id === 'text');
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 2; i < text.triangles * 9; i += 3) {
    zMin = Math.min(zMin, text.positions[i]);
    zMax = Math.max(zMax, text.positions[i]);
  }
  near(zMin, 0, 1e-5, 'text on the bed');
  near(zMax, 0.6, 1e-5, 'text depth');
  // Raised or engraved lettering is not flat on top.
  assert.equal(build({ body: { relief: 'raised' } }).flippable, false);
  assert.equal(build({ body: { relief: 'engraved' } }).flippable, false);
  assert.equal(build({ base: { shape: 'none' } }).flippable, true);
});

test('bed size check follows the printer', () => {
  const big = { base: { shape: 'rect', sizeMode: 'fixed', width: 260, height: 40 } };
  assert.ok(build({ ...big, check: { bed: 256 } }).warnings.some((w) => w.includes('Druckbett (256')));
  assert.ok(!build({ ...big, check: { bed: 320 } }).warnings.some((w) => w.includes('Druckbett')));
  assert.ok(build({ base: { shape: 'rect', sizeMode: 'fixed', width: 178, height: 40 }, check: { bed: 180 } }).warnings.some((w) => w.includes('180 × 180')));
});

test('engraved lettering keeps the minimum floor also with magnets', () => {
  const m = build({ base: { shape: 'rect' }, body: { relief: 'engraved', thickness: 4, height: 1 }, magnets: { enabled: true, count: 2, depth: 2.2 } });
  assert.equal(m.magnets.length, 2);
  near(m.magnetDepth, 2.2, 1e-9, 'room for the magnets');
  assert.ok(4 - 1 - 2.2 >= MIN_FLOOR);
  assertSolid(m, 'engraved with magnets');
});

test('stake below the plate: plant marker and cake topper', () => {
  const plain = build({ texts: [{ text: 'Tomaten', font: font('pacifico'), size: 13 }], base: { shape: 'capsule', padding: 3 }, mount: { type: 'none' }, body: { thickness: 3.2 } });
  const one = build({ texts: [{ text: 'Tomaten', font: font('pacifico'), size: 13 }], base: { shape: 'capsule', padding: 3 }, mount: { type: 'stake', stakeLength: 80, stakeWidth: 8, stakes: 1 }, body: { thickness: 3.2 } });
  assert.deepEqual(one.warnings, []);
  assert.equal(one.base.length, 1, 'stake and plate in one piece');
  const p = regionBounds(plain.base);
  const b = regionBounds(one.base);
  near(p.minY - b.minY, 80, 1e-3, 'reaches the length below the plate');
  near(b.minX, p.minX, 1e-6, 'no wider');
  // Pointed: the lowest millimetre is narrower than the stake.
  const tipArea = regionArea(one.base.map((s) => s)) - regionArea(plain.base);
  assert.ok(tipArea < 8 * 80 + 8 * 12, `stake area ${tipArea}`);
  assertSolid(one, 'plant marker');
  // Two stakes for a cake topper, a warning for a thin plate.
  const two = build({ texts: [{ text: 'Happy', font: font('pacifico'), size: 15 }], base: { shape: 'contour', padding: 2.5 }, mount: { type: 'stake', stakeLength: 50, stakeWidth: 5, stakes: 2 }, body: { thickness: 2 } });
  assert.equal(two.base.length, 1);
  assert.ok(two.warnings.some((w) => w.includes('Stecker bricht')));
  const low = regionBounds(two.base).minY;
  const bottoms = [];
  for (const s of two.base) for (let i = 1; i < s.outer.length; i += 2) if (Math.abs(s.outer[i] - low) < 1e-6) bottoms.push(s.outer[i - 1]);
  assert.equal(new Set(bottoms.map((x) => Math.round(x))).size, 2, 'two tips');
  assertSolid(two, 'cake topper');
});
