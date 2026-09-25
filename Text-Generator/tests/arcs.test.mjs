// Text on arcs: bent in place ('bend') and on a circle ('arcTop',
// 'arcBottom') like the lettering of a coin.

import test from 'node:test';
import assert from 'node:assert/strict';

import { intersection, regionArea, regionRings } from '../js/core/geometry.js';
import { layoutBlock } from '../js/core/layout.js';
import { normalizeDoc } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { loadFonts, font } from './helpers.mjs';

const lib = await loadFonts();
const face = lib.peek(font('montserrat'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const lay = (block) => layoutBlock({ lineSpacing: 1.15, align: 'center', size: 10, ...block }, face);

/** Smallest and largest distance of the outline points from (cx, cy). */
function radii(region, cx, cy) {
  let lo = Infinity;
  let hi = 0;
  for (const r of regionRings(region)) {
    for (let i = 0; i < r.length; i += 2) {
      const d = Math.hypot(r[i] - cx, r[i + 1] - cy);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
  }
  return [lo, hi];
}

test('bend: the text bends in place, up or down', () => {
  const straight = lay({ text: 'Willkommen' });
  const up = lay({ text: 'Willkommen', layout: 'bend', bend: 60 });
  const down = lay({ text: 'Willkommen', layout: 'bend', bend: -60 });
  assert.equal(straight.arc, null);
  // The middle of the capitals of the line stays at the block position.
  near(up.arc.cx, 0, 1e-9, 'arch: centre below');
  near(up.arc.cy + up.arc.r, 0, 1e-9, 'arch: apex at the position');
  near(down.arc.cy - down.arc.r, 0, 1e-9, 'sag: lowest point at the position');
  // The widest line spans the angle along the middle of the capitals.
  const w = straight.bounds.maxX - straight.bounds.minX;
  near(up.arc.r, w / (Math.PI / 3), 2, 'radius from the angle');
  // Bent text is narrower and taller than straight text; arch and sag mirror.
  for (const b of [up, down]) {
    assert.ok(b.bounds.maxX - b.bounds.minX < w, 'narrower');
    assert.ok(b.bounds.maxY - b.bounds.minY > straight.bounds.maxY - straight.bounds.minY + 3, 'taller');
  }
  assert.ok(up.bounds.minY < -5 && up.bounds.maxY < 8, 'ends go down');
  assert.ok(down.bounds.maxY > 5 && down.bounds.minY > -8, 'ends go up');
  // Letters stay on the circle.
  const [lo, hi] = radii(up.region, up.arc.cx, up.arc.cy);
  assert.ok(lo > up.arc.r - 10 && hi < up.arc.r + 10, `on the circle: ${lo} … ${hi}`);
  // No bend is straight; position and rotation move the circle along.
  assert.equal(lay({ text: 'Hallo', layout: 'bend', bend: 0 }).arc, null);
  const moved = lay({ text: 'Hallo', layout: 'bend', bend: 40, x: 12, y: -4, rotation: 90 });
  // Turned by 90°: the arch points left, its centre lies to the right.
  near(moved.arc.cx - moved.arc.r, 12, 1e-9, 'rotated: apex at the position');
  near(moved.arc.cy, -4, 1e-9, 'rotated: same height');
  // Several lines: the inner line of an arch keeps its room.
  const two = lay({ text: 'Familie\nMüller', size: 8, layout: 'bend', bend: 180 });
  assert.ok(two.arc.r >= 8 + 1.15 * (8 / face.capRatio) - 1e-9, 'room for the second line');
});

test('circle: text at the top and at the bottom of a coin', () => {
  const top = lay({ text: 'GLÜCKS', size: 5, layout: 'arcTop', radius: 15 });
  const bottom = lay({ text: 'MÜNZE', size: 5, layout: 'arcBottom', radius: 15 });
  for (const [name, l] of [['top', top], ['bottom', bottom]]) {
    assert.deepEqual([l.arc.cx, l.arc.cy, l.arc.r], [0, 0, 15], `${name}: circle around the position`);
    const [lo, hi] = radii(l.region, 0, 0);
    assert.ok(lo > 15 - 5 && hi < 15 + 5, `${name}: within the ring ${lo} … ${hi}`);
  }
  assert.ok(top.bounds.minY > 5, 'top half');
  assert.ok(bottom.bounds.maxY < -5, 'bottom half');
  // Centred: symmetric about the vertical axis.
  near(top.bounds.minX + top.bounds.maxX, 0, 1.5, 'top centred');
  near(bottom.bounds.minX + bottom.bounds.maxX, 0, 1.5, 'bottom centred');
  assert.equal(regionArea(intersection(top.region, bottom.region)), 0);
});

test('bent and circular text in the document and presets', () => {
  const doc = normalizeDoc({ texts: [{ text: 'x', layout: 'bend', bend: 999 }, { text: 'y', layout: 'spiral' }] });
  assert.equal(doc.texts[0].layout, 'bend');
  assert.equal(doc.texts[0].bend, 340);
  assert.equal(doc.texts[1].layout, 'line');
  const getFace = (ref) => lib.peek(ref);
  for (const name of ['Glücksmünze', 'Kinderzimmer']) {
    const p = BUILTIN_PRESETS.find((x) => x.name === name);
    const m = buildModel(normalizeDoc(p), getFace);
    assert.deepEqual(m.warnings, [], name);
    assert.ok(m.layouts.some((l) => l.arc), `${name}: arc text`);
  }
  // The coin: its round plate is concentric with the lettering circle.
  const coin = buildModel(normalizeDoc(BUILTIN_PRESETS.find((x) => x.name === 'Glücksmünze')), getFace);
  near(coin.bounds.minX + coin.bounds.maxX, 0, 0.02, 'coin centred x');
  near(coin.bounds.minY + coin.bounds.maxY, 0, 0.02, 'coin centred y');
});
