import test from 'node:test';
import assert from 'node:assert/strict';

import {
  union, difference, offset, regionArea, regionBounds, thinParts, subtractInterior, roundedRectRing, circleRing, ringArea,
} from '../js/core/geometry.js';
import { layoutBlock } from '../js/core/layout.js';
import { defaultDoc, normalizeDoc } from '../js/core/document.js';
import { buildModel, MIN_FLOOR } from '../js/core/model.js';
import { BUILTIN_FONTS } from '../js/core/fonts.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { loadFonts, font } from './helpers.mjs';

const lib = await loadFonts();
const face = (id) => lib.peek(font(id));
const getFace = (ref) => lib.peek(ref);
const sq = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const model = (patch) => buildModel(normalizeDoc({ ...defaultDoc(), ...patch }), getFace);

test('built-in fonts load and cover German text', () => {
  for (const f of BUILTIN_FONTS) {
    const fc = lib.peek(f);
    assert.ok(fc, f.id);
    assert.ok(fc.capRatio > 0.5 && fc.capRatio < 1, `${f.id} cap ratio ${fc.capRatio}`);
    for (const ch of 'ÄÖÜäöüß€') assert.ok(fc.fontFor(ch), `${f.id} has ${ch}`);
  }
});

test('boolean operations and offsets', () => {
  const a = union([sq(0, 0, 10)], [sq(5, 5, 10)]);
  assert.equal(a.length, 1);
  near(regionArea(a), 175, 1e-6, 'union area');
  const ring = difference([sq(0, 0, 10)], [sq(3, 3, 4)]);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].holes.length, 1);
  near(regionArea(ring), 84, 1e-6, 'area with hole');
  assert.ok(ringArea(ring[0].outer) > 0 && ringArea(ring[0].holes[0]) < 0, 'outer ccw, hole cw');
  // Offsetting a square by r adds the perimeter strip and a circle.
  near(regionArea(offset([sq(0, 0, 10)], 1)), 100 + 40 + Math.PI, 0.03, 'offset area (round corners as polygons)');
  near(regionArea(offset([sq(0, 0, 10)], -1)), 64, 1e-6, 'inset area');
});

test('thin parts: a 0.5 mm bar is found, sharp corners are not', () => {
  const bar = union([sq(0, 0, 10)], [[10, 4.75, 20, 4.75, 20, 5.25, 10, 5.25]]);
  const thin = thinParts(bar, 0.8);
  assert.equal(thin.length, 1);
  near(regionArea(thin), 5, 0.3, 'thin bar area');
  assert.equal(thinParts(union([sq(0, 0, 10)]), 0.8).length, 0);
});

test('subtractInterior keeps the inner rings exactly', () => {
  const base = union([roundedRectRing(-20, -10, 20, 10, 3)]);
  const inner = difference([sq(-10, -5, 10)], [sq(-7, -2, 4)]);
  const top = subtractInterior(base, inner);
  near(regionArea(top), regionArea(base) - regionArea(inner), 1e-6, 'area');
  const rings = new Set(top.flatMap((s) => [s.outer, ...s.holes]).map((r) => [...r].sort().join()));
  for (const r of [inner[0].outer, ...inner[0].holes]) assert.ok(rings.has([...r].sort().join()), 'ring reused');
});

test('text is sized by cap height and spaced as asked', () => {
  const lay = layoutBlock({ text: 'H', size: 10 }, face('roboto'));
  const b = lay.bounds;
  near(b.maxY - b.minY, 10, 0.01, 'cap height');
  const plain = layoutBlock({ text: 'HHHH', size: 10 }, face('roboto'));
  const wide = layoutBlock({ text: 'HHHH', size: 10, letterSpacing: 2 }, face('roboto'));
  near((wide.bounds.maxX - wide.bounds.minX) - (plain.bounds.maxX - plain.bounds.minX), 6, 0.01, 'letter spacing');
  // Two lines: baselines one pitch apart, block centred on the cap box.
  const two = layoutBlock({ text: 'H\nH', size: 10, lineSpacing: 1.5 }, face('roboto'));
  near(two.lines[0].baseline - two.lines[1].baseline, 1.5 * two.fontSize, 1e-9, 'line pitch');
  near(two.bounds.maxY + two.bounds.minY, 0, 0.01, 'centred');
});

test('text on arcs sits on the circle', () => {
  const top = layoutBlock({ text: 'OBEN', size: 6, layout: 'arcTop', radius: 30 }, face('roboto'));
  const bottom = layoutBlock({ text: 'UNTEN', size: 6, layout: 'arcBottom', radius: 30 }, face('roboto'));
  for (const s of top.region) for (let i = 0; i < s.outer.length; i += 2) {
    const r = Math.hypot(s.outer[i], s.outer[i + 1]);
    assert.ok(r > 26.5 && r < 33.8, `top radius ${r}`);
  }
  assert.ok(top.bounds.minY > 20, 'top text above');
  assert.ok(bottom.bounds.maxY < -20, 'bottom text below');
});

test('missing characters are reported', () => {
  const m = model({ texts: [{ text: 'A☃B', font: font('bebas-neue') }] });
  assert.ok(m.warnings.some((w) => w.includes('☃')));
});

test('contour key ring: one piece, text inside, eyelet hole', () => {
  const m = model({});
  assert.equal(m.base.length, 1);
  assert.equal(m.base[0].holes.length, 1, 'eyelet hole');
  near(regionArea(difference(m.text, m.base)), 0, 1e-6, 'text inside plate');
  const hole = m.holes[0];
  const tb = regionBounds(m.text);
  assert.ok(hole.cx + hole.r < tb.minX, 'hole left of the text');
});

test('separate words are joined into one plate', () => {
  const m = model({ texts: [{ text: 'Hallo      Welt', size: 8 }], base: { padding: 1 } });
  assert.equal(m.base.length, 1);
  assert.ok(m.warnings.some((w) => w.includes('Stegen')));
});

test('body volumes for raised, engraved and flush lettering', () => {
  const body = { thickness: 2.4, height: 1.2 };
  const raised = model({ body: { ...body, relief: 'raised' } });
  const A = regionArea(raised.base);
  const T = regionArea(raised.text);
  near(raised.stats.volume, A * 2.4 + T * 1.2, 1e-6, 'raised');
  const engraved = model({ body: { ...body, relief: 'engraved' } });
  const Te = regionArea(engraved.text);
  near(engraved.stats.volume, regionArea(engraved.base) * 2.4 - Te * 1.2, 1e-6, 'engraved');
  const flush = model({ body: { ...body, relief: 'flush' } });
  assert.deepEqual(flush.parts.map((p) => p.id), ['base', 'text']);
  near(flush.parts[1].volume, regionArea(flush.text) * 1.2, 1e-6, 'inlay volume');
  near(flush.stats.volume, regionArea(flush.base) * 2.4, 1e-6, 'flush fills the plate');
  // Engraving never leaves less than MIN_FLOOR under the text.
  const deep = model({ body: { thickness: 1.5, height: 3, relief: 'engraved' } });
  near(deep.depth, 1.5 - MIN_FLOOR, 1e-9, 'depth limited');
});

test('border, fixed size, mirror and letters without plate', () => {
  const b = model({ base: { shape: 'rect' }, body: { border: true, borderWidth: 1.5, borderHeight: 1 } });
  assert.ok(b.border.length && b.parts.some((p) => p.id === 'border'));
  near(regionArea(difference(b.text, offset(b.base, -1.5 + 0.01))), 0, 0.01, 'text inside the border');
  const fixed = model({ base: { shape: 'rect', sizeMode: 'fixed', width: 120, height: 40 }, mount: { type: 'none' } });
  near(fixed.stats.width, 120, 1e-6, 'fixed width');
  near(fixed.stats.height, 40, 1e-6, 'fixed height');
  const plain = model({ base: { shape: 'rect' }, mount: { type: 'none' } });
  const mirrored = model({ base: { shape: 'rect' }, mount: { type: 'none' }, mirror: true });
  near(mirrored.bounds.minX, -plain.bounds.maxX, 1e-6, 'mirrored');
  const none = model({ base: { shape: 'none' } });
  assert.deepEqual(none.parts.map((p) => p.id), ['text']);
  assert.equal(none.base.length, 0);
});

test('every preset builds without surprises', () => {
  for (const p of BUILTIN_PRESETS) {
    const m = buildModel(normalizeDoc(p), getFace);
    assert.ok(m.parts.length >= 1, p.name);
    assert.ok(m.base.length <= 1, `${p.name}: plate in one piece`);
    assert.equal(m.pending, false, p.name);
    assert.deepEqual(m.warnings.filter((w) => w.includes('ragt')), [], p.name);
  }
});

test('document normalisation keeps values in range', () => {
  const doc = normalizeDoc({ texts: [{ text: 'x', size: -3, align: 'diagonal' }], base: { shape: 'star', padding: -1 }, slots: { base: 99 }, colors: { text: 'red' } });
  assert.equal(doc.texts[0].size, 0.5);
  assert.equal(doc.texts[0].align, 'center');
  assert.equal(doc.base.shape, 'contour');
  assert.equal(doc.base.padding, 0);
  assert.equal(doc.slots.base, 16);
  assert.match(doc.colors.text, /^#[0-9a-f]{6}$/i);
  assert.ok(circleRing(0, 0, 5).length >= 32);
});
