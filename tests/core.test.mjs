import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHole, outlineArea, polygonize, shapePeriod } from '../pattern-generator/js/core/shapes.js';
import { makeBoundary, makeBandBoundary, ellipseSdf } from '../pattern-generator/js/core/boundary.js';
import { makeLattice, wrapX } from '../pattern-generator/js/core/lattice.js';
import { prepareModifiers } from '../pattern-generator/js/core/modifiers.js';
import { generate, seamGhosts } from '../pattern-generator/js/core/generator.js';
import { analyzeWebs, holeGap } from '../pattern-generator/js/core/analysis.js';
import { defaultDoc, normalizeDoc, createModifier } from '../pattern-generator/js/core/document.js';
import { BUILTIN_PRESETS } from '../pattern-generator/js/core/preset-library.js';
import { knurlSettings, withKnurl, twistsShapes } from '../pattern-generator/js/core/knurl.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

function assertContinuous(outline) {
  const segs = outline.segs;
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    const b = segs[(i + 1) % segs.length];
    close(Math.hypot(a.x1 - b.x0, a.y1 - b.y0), 0, 1e-9, 'gap between segments');
    if (a.type === 'arc') {
      assert.ok(a.sweep > 0 && a.sweep < 2 * Math.PI, 'arcs are counter-clockwise');
      close(Math.hypot(a.cx + a.r * Math.cos(a.a0 + a.sweep) - a.x1, a.cy + a.r * Math.sin(a.a0 + a.sweep) - a.y1), 0, 1e-9);
    }
  }
}

test('slot: area, canonical order and continuity', () => {
  const h = buildHole({ type: 'rect', round: 1 }, 3, -2, 0.7, 10, 2.6);
  assert.equal(h.outline.kind, 'path');
  assert.deepEqual(h.outline.segs.map((s) => s.type), ['arc', 'line', 'arc', 'line']);
  close(h.area, 10 * 2.6 - (4 - Math.PI) * 1.3 * 1.3, 1e-9, 'slot area');
  assertContinuous(h.outline);
  assert.equal(h.core.r, 1.3);
});

test('rounded rectangle, sharp rectangle, polygons', () => {
  const rr = buildHole({ type: 'rect', round: 0.5 }, 0, 0, 0, 20, 10);
  close(rr.area, 200 - (4 - Math.PI) * 2.5 * 2.5, 1e-9);
  assertContinuous(rr.outline);
  const sharp = buildHole({ type: 'rect', round: 0 }, 0, 0, 0.3, 6, 4);
  close(sharp.area, 24, 1e-9);
  assert.ok(sharp.outline.segs.every((s) => s.type === 'line'));
  const hex = buildHole({ type: 'polygon', sides: 6, round: 0 }, 0, 0, 0, 10, 10);
  close(hex.area, (3 * Math.sqrt(3) / 2) * 25, 1e-9);
  const tri = buildHole({ type: 'polygon', sides: 3, round: 0.3 }, 1, 1, 0.2, 8, 8);
  assertContinuous(tri.outline);
});

test('full rounding turns squares and regular polygons into circles', () => {
  const c1 = buildHole({ type: 'rect', round: 1 }, 1, 2, 0.4, 5, 5);
  assert.equal(c1.outline.kind, 'circle');
  close(c1.outline.r, 2.5, 1e-9);
  const c2 = buildHole({ type: 'polygon', sides: 6, round: 1 }, 0, 0, 0, 10, 10);
  assert.equal(c2.outline.kind, 'circle');
  close(c2.outline.r, 5 * Math.cos(Math.PI / 6), 1e-9);
});

test('ellipses are normalised to rx >= ry', () => {
  const e = buildHole({ type: 'ellipse' }, 0, 0, 0.2, 3, 8);
  assert.equal(e.outline.kind, 'ellipse');
  assert.ok(e.outline.rx >= e.outline.ry);
  close(e.outline.rot, 0.2 + Math.PI / 2, 1e-12);
  close(e.area, Math.PI * 4 * 1.5, 1e-9);
  const c = buildHole({ type: 'ellipse' }, 0, 0, 0, 4, 4);
  assert.equal(c.outline.kind, 'circle');
});

test('polygonize approximates the exact area', () => {
  const h = buildHole({ type: 'rect', round: 0.7 }, 0, 0, 1, 12, 7);
  const pts = polygonize(h.outline, 0.001);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  close(a / 2, outlineArea(h.outline), 0.01);
});

test('shape symmetry periods', () => {
  close(shapePeriod({ type: 'rect', width: 5, height: 2 }), Math.PI);
  close(shapePeriod({ type: 'rect', width: 5, height: 5 }), Math.PI / 2);
  close(shapePeriod({ type: 'polygon', sides: 6, width: 5, height: 5 }), Math.PI / 3);
});

test('ellipse SDF matches brute force distance', () => {
  const a = 50;
  const b = 20;
  const samples = [];
  for (let k = 0; k < 20000; k++) {
    const t = (2 * Math.PI * k) / 20000;
    samples.push([a * Math.cos(t), b * Math.sin(t)]);
  }
  for (const [x, y] of [[0, 0], [10, 5], [49, 0], [0, 19], [60, 30], [-30, 12], [5, -25], [30, 15]]) {
    let d = Infinity;
    for (const [sx, sy] of samples) d = Math.min(d, Math.hypot(x - sx, y - sy));
    const inside = (x * x) / (a * a) + (y * y) / (b * b) < 1;
    close(ellipseSdf(x, y, a, b), inside ? -d : d, 2e-3, `point ${x},${y}`);
  }
});

test('boundaries: areas, SDF signs and margin offsets', () => {
  const canvas = { width: 200, height: 150 };
  const rect = makeBoundary({ type: 'rect', cornerRadius: 20 }, canvas);
  close(rect.area, 200 * 150 - (4 - Math.PI) * 400, 1e-6);
  close(rect.sdf(0, 0), -75, 1e-9);
  close(rect.sdf(100, 0), 0, 1e-9);
  close(rect.sdf(100, 75), Math.hypot(20, 20) - 20, 1e-9);
  const none = makeBoundary({ type: 'none' }, canvas);
  close(none.area, 30000, 1e-9);
  const ell = makeBoundary({ type: 'ellipse' }, canvas);
  close(ell.area, Math.PI * 100 * 75, 1e-6);
  const poly = makeBoundary({ type: 'polygon', sides: 6, rotation: 0, cornerRadius: 0 }, canvas);
  close(poly.halfW, 100, 1e-9);
  close(poly.halfH, 75, 1e-9);
  const off = rect.offsetOutline(8);
  close(outlineArea(off), 184 * 134 - (4 - Math.PI) * 144, 1e-6);
  assert.ok(ell.offsetOutline(5));
});

test('lattices', () => {
  const canvas = { width: 100, height: 60 };
  const grid = makeLattice({ type: 'grid', spacingX: 10, spacingY: 10, rotation: 0 }, canvas, 0);
  assert.equal(grid.points.length, 11 * 7);
  const hex = makeLattice({ type: 'hex', spacingX: 10, spacingY: 10, rowShift: 0.5 }, canvas, 0);
  assert.ok(hex.points.some((p) => Math.abs(p.x - 5) < 1e-9 && Math.abs(p.y - 10) < 1e-9));
  const radial = makeLattice({ type: 'radial', ringSpacing: 10, itemSpacing: 10, centerHole: true }, { width: 45, height: 45 }, 0);
  const inner = radial.points.filter((p) => Math.hypot(p.x, p.y) < 20.5);
  assert.equal(inner.length, 1 + Math.round(2 * Math.PI) + Math.round(4 * Math.PI));
  const random = makeLattice({ type: 'random', minDistance: 5, seed: 3 }, canvas, 0);
  for (let i = 0; i < random.points.length; i++) {
    for (let j = i + 1; j < random.points.length; j++) {
      const a = random.points[i];
      const b = random.points[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 5 - 1e-9);
    }
  }
  const again = makeLattice({ type: 'random', minDistance: 5, seed: 3 }, canvas, 0);
  assert.deepEqual(again.points, random.points);
  const overflow = makeLattice({ type: 'grid', spacingX: 0.05, spacingY: 0.05 }, { width: 1000, height: 1000 }, 0);
  assert.ok(overflow.overflow && overflow.estimate > 60000);
});

test('point attractor rotates, scales, removes', () => {
  const env = { period: Math.PI };
  const [rot] = prepareModifiers([{ type: 'point', x: 0, y: 0, radius: 10, falloff: 'linear', angle: 90, rotateMode: 'add', scale: 2 }], env);
  const el = { x: 5, y: 0, rot: 0, sx: 1, sy: 1, R: 1 };
  rot(el);
  close(el.rot, Math.PI / 4, 1e-12);
  close(el.sx, 1.5, 1e-12);
  const [rm] = prepareModifiers([{ type: 'point', x: 0, y: 0, radius: 10, remove: true }], env);
  const inside = { x: 3, y: 0, rot: 0, sx: 1, sy: 1, R: 1 };
  rm(inside);
  assert.equal(inside.removed, true);
  const outside = { x: 20, y: 0, rot: 0, sx: 1, sy: 1, R: 1 };
  rm(outside);
  assert.ok(!outside.removed);
  const [inv] = prepareModifiers([{ type: 'point', x: 0, y: 0, radius: 10, falloff: 'step', invert: true, angle: 30, rotateMode: 'add' }], env);
  const far = { x: 50, y: 0, rot: 0, sx: 1, sy: 1, R: 1 };
  inv(far);
  close(far.rot, Math.PI / 6, 1e-12);
});

test('linear gradient and noise are deterministic', () => {
  const [lin] = prepareModifiers([{ type: 'linear', x1: -10, y1: 0, x2: 10, y2: 0, falloff: 'linear', scaleFrom: 0.5, scaleTo: 1.5 }], {});
  const a = { x: -20, y: 0, rot: 0, sx: 1, sy: 1 };
  const b = { x: 0, y: 3, rot: 0, sx: 1, sy: 1 };
  lin(a);
  lin(b);
  close(a.sx, 0.5, 1e-12);
  close(b.sx, 1, 1e-12);
  const mods = () => prepareModifiers([{ ...createModifier('noise'), angle: 30, scale: 0.3, jitter: 1 }], {});
  const e1 = { x: 12.3, y: -4.5, rot: 0, sx: 1, sy: 1, i: 2, j: 3 };
  const e2 = { ...e1 };
  mods()[0](e1);
  mods()[0](e2);
  assert.deepEqual(e1, e2);
  assert.notEqual(e1.rot, 0);
});

test('default pattern: holes inside the margin, no thin webs', () => {
  const doc = defaultDoc();
  const res = generate(doc);
  assert.ok(res.holes.length > 250, `holes: ${res.holes.length}`);
  assert.ok(res.stats.minRim >= doc.boundary.margin - 1e-9);
  const a = analyzeWebs(res.holes, doc.check.minWeb);
  assert.equal(a.overlap, 0);
  assert.equal(a.thin, 0);
  assert.ok(a.minWeb >= 0.8, `min web ${a.minWeb}`);
  // Deterministic
  const again = generate(defaultDoc());
  assert.deepEqual(again.holes.map((h) => [h.x, h.y, h.rot]), res.holes.map((h) => [h.x, h.y, h.rot]));
});

test('built-in presets generate holes without overlaps', () => {
  for (const { name, doc: make } of BUILTIN_PRESETS) {
    const doc = normalizeDoc(make());
    const res = generate(doc);
    // Rib presets have few, long shapes.
    assert.ok(res.holes.length >= 10, `${name}: ${res.holes.length} holes`);
    const a = analyzeWebs(res.holes, doc.check.minWeb, res.ghosts);
    assert.equal(a.overlap, 0, `${name} has overlapping holes`);
    if (res.wrap) assert.ok(res.wrap.seamless, `${name} closes seamlessly around the cylinder`);
  }
});

test('hole gaps are exact', () => {
  const A = buildHole({ type: 'rect', round: 1 }, 0, 0, 0, 10, 2);
  close(holeGap(A, buildHole({ type: 'rect', round: 1 }, 12, 0, 0, 10, 2)), 2, 1e-9);
  close(holeGap(A, buildHole({ type: 'rect', round: 1 }, 0, 3, 0, 10, 2)), 1, 1e-9);
  assert.ok(holeGap(A, buildHole({ type: 'rect', round: 1 }, 0, 0, Math.PI / 2, 10, 2)) < 0);
  close(holeGap(A, buildHole({ type: 'ellipse' }, 0, 5, 0, 4, 4)), 2, 1e-9);
  const r1 = buildHole({ type: 'rect', round: 0 }, 0, 0, 0, 4, 4);
  const r2 = buildHole({ type: 'rect', round: 0 }, 5, 5, 0, 4, 4);
  close(holeGap(r1, r2), Math.SQRT2, 1e-9);
});

test('normalizeDoc completes and sanitises documents', () => {
  const doc = normalizeDoc({ canvas: { width: '120', height: -5 }, shape: { width: 'abc' }, modifiers: [{ type: 'nope' }, { type: 'point', radius: 12 }] });
  assert.equal(doc.canvas.width, 120);
  assert.equal(doc.canvas.height, 1);
  assert.equal(doc.shape.width, defaultDoc().shape.width);
  assert.equal(doc.modifiers.length, 1);
  assert.equal(doc.modifiers[0].radius, 12);
  assert.equal(doc.modifiers[0].angle, 90);
  assert.equal(normalizeDoc(null).pattern.type, 'hex');
});

test('cylinder lattice: grid columns divide the circumference', () => {
  const canvas = { width: 100, height: 50 };
  const grid = makeLattice({ type: 'grid', spacingX: 12, spacingY: 10, rotation: 0 }, canvas, 0, 100);
  assert.equal(grid.columns, 8);
  close(grid.spacingX, 12.5);
  assert.ok(grid.seamless);
  const rows = new Map();
  for (const p of grid.points) {
    assert.ok(p.x >= -50 && p.x < 50, `x ${p.x} inside one turn`);
    rows.set(p.j, (rows.get(p.j) || 0) + 1);
  }
  for (const n of rows.values()) assert.equal(n, 8);
  // Alternating turns by column need an even number of columns.
  const fish = makeLattice({ type: 'grid', spacingX: 14.3, spacingY: 10, spin: 90, spinMode: 'alternate', spinBy: 'column' }, canvas, 0, 100);
  assert.equal(fish.columns % 2, 0);
  // A rotated grid cannot close exactly.
  assert.equal(makeLattice({ type: 'grid', spacingX: 12, spacingY: 10, rotation: 20 }, canvas, 0, 100).seamless, false);
  close(wrapX(50, 100), -50);
  close(wrapX(-50, 100), -50);
  close(wrapX(149, 100), 49);
});

test('cylinder lattice: Poisson disk keeps its distance across the seam', () => {
  const r = 7;
  const lat = makeLattice({ type: 'random', minDistance: r, seed: 5 }, { width: 90, height: 40 }, 0, 90);
  assert.ok(lat.seamless);
  const pts = lat.points;
  assert.ok(pts.length > 30);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = wrapX(pts[i].x - pts[j].x, 90);
      assert.ok(Math.hypot(dx, pts[i].y - pts[j].y) >= r - 1e-9, 'distance measured around the cylinder');
    }
  }
});

test('cylinder: attractors act across the seam', () => {
  const boundary = makeBandBoundary({ width: 100, height: 40 });
  const m = { type: 'point', x: 49, y: 0, radius: 10, falloff: 'linear', angle: 90, rotateMode: 'add', scale: 1 };
  const el = () => ({ x: -49, y: 0, rot: 0, sx: 1, sy: 1, i: 0, j: 0, R: 1, removed: false });
  const [wrapped] = prepareModifiers([m], { boundary, period: Math.PI, wrap: 100 });
  const a = el();
  wrapped(a);
  close(a.rot, (Math.PI / 2) * 0.8, 1e-9, 'distance 2 across the seam');
  const [flat] = prepareModifiers([m], { boundary, period: Math.PI });
  const b = el();
  flat(b);
  assert.equal(b.rot, 0);
  // Band boundary: only top and bottom (above an optional floor) limit the pattern.
  close(boundary.sdf(1000, 0), -20);
  close(makeBandBoundary({ width: 100, height: 40 }, 5).sdf(0, -16), 1);
});

test('cylinder: holes cross the seam, ghosts complete them and the check sees across', () => {
  const doc = normalizeDoc({
    canvas: { width: 100, height: 40 },
    form: { type: 'cylinder' },
    boundary: { margin: 3 },
    shape: { type: 'ellipse', width: 5, height: 5 },
    pattern: { type: 'hex', spacingX: 10, spacingY: 8.66, offsetX: 50 },
  });
  const res = generate(doc);
  assert.ok(res.wrap && res.wrap.seamless);
  assert.equal(res.wrap.columns, 10);
  const crossing = res.holes.filter((h) => Math.abs(h.x) + h.R > 50);
  assert.ok(crossing.length > 0, 'some holes sit on the seam');
  for (const h of crossing) {
    assert.ok(res.ghosts.some((g) => res.holes[g.src] === h && Math.abs(Math.abs(g.x - h.x) - 100) < 1e-9));
  }
  const a = analyzeWebs(res.holes, 0.8, res.ghosts);
  assert.equal(a.overlap, 0);
  close(a.minWeb, 5, 1e-3, 'hexagonal gap 10 - 5');
  // Two holes that only touch around the back of the cylinder.
  const holes = [buildHole({ type: 'ellipse' }, -49.5, 0, 0, 2, 2), buildHole({ type: 'ellipse' }, 49.5, 0, 0, 2, 2)];
  assert.equal(analyzeWebs(holes, 0.8).overlap, 0);
  assert.equal(analyzeWebs(holes, 0.8, seamGhosts(holes, 100, 5)).overlap, 2);
  assert.equal(generate(normalizeDoc({ form: { type: 'cylinder' } })).boundary.type, 'band');
  const bad = normalizeDoc({ form: { type: 'kegel', bottom: -3 } });
  assert.equal(bad.form.type, 'plate');
  assert.equal(bad.form.bottom, 0);
});

test('knurl: diamond grooves at the chosen angle, one pitch apart, separated by the gap', () => {
  const plate = normalizeDoc({ canvas: { width: 80, height: 50 }, boundary: { type: 'rect', margin: 2 } });
  for (const angle of [30, 45]) {
    const k = knurlSettings({ type: 'diamond', pitch: 2.5, angle, profile: 90, gap: 0.1 }, plate);
    const a = (angle * Math.PI) / 180;
    // Cell rhombus: diagonals spacingX and 2 * spacingY.
    const w = k.pattern.spacingX;
    const h = 2 * k.pattern.spacingY;
    close(Math.atan2(w, h), a, 1e-4, 'groove angle to the axis');
    close(w * Math.cos(a), 2.5, 1e-4, 'pitch between parallel grooves');
    close(k.shape.width / w, (2.5 - 0.1) / 2.5, 1e-4);
    close(k.relief.height, 1.2, 1e-4, 'flanks at 45° meet in a point');
    assert.equal(k.relief.taper, 45);
    const doc = normalizeDoc(withKnurl(plate, { type: 'diamond', pitch: 2.5, angle, gap: 0.1 }));
    const res = generate(doc);
    const webs = analyzeWebs(res.holes, doc.check.minWeb);
    assert.equal(webs.overlap, 0);
    close(webs.minWeb, 0.1, 2e-3, 'neighbouring points keep the gap');
  }
  // On a cylinder a whole number of points goes around.
  const knob = normalizeDoc(withKnurl({ canvas: { width: Math.PI * 30, height: 20 }, form: { type: 'cylinder' }, boundary: { margin: 1 } }, { type: 'diamond', pitch: 2 }));
  const cols = knob.canvas.width / knob.pattern.spacingX;
  close(cols, Math.round(cols), 1e-9);
  const res = generate(knob);
  assert.ok(res.wrap.seamless);
  assert.equal(res.wrap.columns, Math.round(cols));
  assert.equal(analyzeWebs(res.holes, knob.check.minWeb, res.ghosts).overlap, 0);
  // Straight knurl: ridges along the axis, above a closed bottom.
  const cup = normalizeDoc(withKnurl({ canvas: { width: Math.PI * 24, height: 16 }, form: { type: 'cylinder', bottom: 3 }, boundary: { margin: 1 } }, { type: 'straight', pitch: 1.5, profile: 60 }));
  const ridges = generate(cup);
  assert.ok(ridges.holes.length >= 40);
  for (const h of ridges.holes) assert.ok(h.y - h.h / 2 >= -8 + 3 + 1 - 1e-6, 'ridges stay above the floor');
  assert.equal(cup.relief.taper, 30);
  // Turning or moving modifiers would break the tiling, scaling ones are fine.
  assert.ok(twistsShapes(createModifier('point')));
  assert.ok(!twistsShapes({ ...createModifier('point'), angle: 0, scale: 0.5 }));
  assert.ok(!twistsShapes(createModifier('edge')));
  assert.ok(twistsShapes({ ...createModifier('noise'), angle: 0, jitter: 1 }));
});
