// Smooth outlines: polygons become lines and cubic curves within 0.01 mm.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fitRing, fitError, reverseSegments, bezierPoint } from '../js/core/curves.js';
import { circleRing, roundedRectRing, regionRings } from '../js/core/geometry.js';
import { normalizeDoc } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { loadFonts } from './helpers.mjs';

const lib = await loadFonts();
const TOL = 0.0101;

/** Largest distance of the curves from the polygon (they must not bulge). */
function bulge(ring, segs) {
  let worst = 0;
  const n = ring.length;
  for (const s of segs) {
    if (s.type === 'line') continue;
    for (let k = 1; k < 32; k++) {
      const p = bezierPoint(s.p, k / 32);
      let best = Infinity;
      for (let i = 0; i < n; i += 2) {
        const ax = ring[i];
        const ay = ring[i + 1];
        const dx = ring[(i + 2) % n] - ax;
        const dy = ring[(i + 3) % n] - ay;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
      }
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

function assertChain(segs, label) {
  for (let i = 0; i < segs.length; i++) {
    const end = segs[i].p[segs[i].p.length - 1];
    const next = segs[(i + 1) % segs.length].p[0];
    assert.deepEqual(end, next, `${label}: segment ${i} ends where the next begins`);
  }
}

test('straight outlines stay lines, corners stay corners', () => {
  const rect = [0, 0, 50, 0, 50, 20, 0, 20];
  const segs = fitRing(rect);
  assert.deepEqual(segs.map((s) => s.type), ['line', 'line', 'line', 'line']);
  assert.deepEqual(segs.map((s) => s.p[0]), [[0, 0], [50, 0], [50, 20], [0, 20]]);
  // Extra points on a straight edge do not matter.
  assert.equal(fitRing([0, 0, 10, 0, 20, 0, 30, 0, 30, 10, 0, 10]).length, 4);
  // A rounded rectangle: four lines and curves in the corners.
  const rr = fitRing(roundedRectRing(0, 0, 60, 25, 4));
  assert.equal(rr.filter((s) => s.type === 'line').length, 4);
  assert.ok(rr.length <= 24, `rounded rectangle: ${rr.length} segments`);
  assertChain(rr, 'rounded rectangle');
});

test('circles and letters: few curves, within 0.01 mm', () => {
  for (const r of [2, 10, 100]) {
    const ring = circleRing(0, 0, r);
    const segs = fitRing(ring);
    assert.ok(segs.every((s) => s.type === 'cubic'), `circle ${r}: curves only`);
    assert.ok(segs.length <= 24, `circle ${r}: ${segs.length} curves`);
    assert.ok(fitError(ring, segs) <= TOL, `circle ${r}: points on the curve`);
    assert.ok(bulge(ring, segs) <= TOL, `circle ${r}: curve on the polygon`);
    assertChain(segs, `circle ${r}`);
  }
  for (const name of ['Schlüsselanhänger', 'Glücksmünze', 'Große Schablone', 'Sticker-Look']) {
    const m = buildModel(normalizeDoc(BUILTIN_PRESETS.find((p) => p.name === name)), (ref) => lib.peek(ref));
    let points = 0;
    let count = 0;
    for (const ring of [...regionRings(m.text), ...regionRings(m.relief === 'cut' ? m.plate : m.base), ...regionRings(m.outline)]) {
      const segs = fitRing(ring);
      points += ring.length / 2;
      count += segs.length;
      assertChain(segs, name);
      assert.ok(fitError(ring, segs) <= TOL, `${name}: points on the curves`);
      assert.ok(bulge(ring, segs) <= TOL, `${name}: curves on the outline`);
    }
    assert.ok(count < points / 3, `${name}: ${points} points → ${count} segments`);
  }
});

test('reversed segments run the other way round', () => {
  const segs = fitRing(circleRing(5, 5, 3));
  const back = reverseSegments(segs);
  assert.equal(back.length, segs.length);
  assert.deepEqual(back[0].p[0], segs[segs.length - 1].p[3]);
  assert.deepEqual(back[0].p[3], segs[segs.length - 1].p[0]);
  assertChain(back, 'reversed');
});
