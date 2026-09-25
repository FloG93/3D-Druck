// STEP export: an assembly with one component per part, exact solids whose
// every edge is used twice in opposite directions (closed shells).

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDoc } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { exportSTEP, stepSupported } from '../js/export/step.js';
import { bender, bentCurve, cupFloor } from '../js/export/step-cup.js';
import { planLetter } from '../js/export/step-draft.js';
import { offset } from '../js/core/geometry.js';
import { str } from '../../shared/js/step.js';
import { loadFonts, font } from './helpers.mjs';

const lib = await loadFonts();
const preset = (name) => buildModel(normalizeDoc(BUILTIN_PRESETS.find((p) => p.name === name)), (ref) => lib.peek(ref));
const stamp = (text, id, draft, size = 12) => buildModel(normalizeDoc({
  texts: [{ text, font: font(id), size }],
  base: { shape: 'rect', padding: 3 },
  mount: { type: 'none' },
  body: { relief: 'raised', thickness: 4, height: 2.5 },
  stamp: { enabled: true, kind: 'cookie', draft, handle: false },
}), (ref) => lib.peek(ref));
/** The plan of every letter of a stamp (its own foot as Clipper grows it). */
const letterPlans = (m) => {
  const { draft } = m.parts.find((p) => p.id === 'text').solids[0];
  return draft.region.map((shape) => planLetter(shape, offset([shape], draft.grow), draft.grow));
};

/** Entities of a STEP file: id → { type, args }. */
function parse(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = /^#(\d+)=([A-Z_0-9]+)?\((.*)\);$/.exec(line) || /^#(\d+)=(\(.*\));$/.exec(line);
    if (m) out.set(`#${m[1]}`, { type: m[2] || 'COMPLEX', args: m[3] || m[2] });
  }
  return out;
}

/** Every shell: each edge used exactly twice, once in each direction. */
function checkShells(entities) {
  const refs = (s) => [...s.matchAll(/#\d+/g)].map((x) => x[0]);
  let shells = 0;
  for (const [, e] of entities) {
    if (e.type !== 'CLOSED_SHELL') continue;
    shells++;
    const uses = new Map();
    for (const face of refs(e.args)) {
      for (const bound of refs(entities.get(face).args).slice(0, -1)) {
        const loop = refs(entities.get(bound).args)[0];
        for (const oe of refs(entities.get(loop).args)) {
          const o = entities.get(oe);
          assert.equal(o.type, 'ORIENTED_EDGE');
          const [edge] = refs(o.args);
          const u = uses.get(edge) || { t: 0, f: 0 };
          if (o.args.endsWith('.T.')) u.t++;
          else u.f++;
          uses.set(edge, u);
        }
      }
    }
    for (const [edge, u] of uses) assert.ok(u.t === 1 && u.f === 1, `edge ${edge}: ${u.t}× forward, ${u.f}× backward`);
  }
  return shells;
}

test('STEP: one component per part, closed solids, curves', () => {
  const m = preset('Sticker-Look');
  assert.ok(stepSupported(m));
  const text = exportSTEP(m, { title: 'Sticker' });
  assert.match(text, /^ISO-10303-21;/);
  assert.match(text, /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/);
  assert.ok(text.trimEnd().endsWith('END-ISO-10303-21;'));
  const entities = parse(text);
  const products = [...entities.values()].filter((e) => e.type === 'PRODUCT').map((e) => e.args.split(',')[0]);
  assert.deepEqual(products, ["'Sticker'", ...m.parts.map((p) => `'${p.name}'`)]);
  assert.equal([...entities.values()].filter((e) => e.type === 'NEXT_ASSEMBLY_USAGE_OCCURRENCE').length, m.parts.length);
  const shells = checkShells(entities);
  assert.equal(shells, [...entities.values()].filter((e) => e.type === 'MANIFOLD_SOLID_BREP').length);
  // Curves and their extrusions instead of facets; colours for every body.
  assert.ok([...entities.values()].some((e) => e.type === 'B_SPLINE_CURVE_WITH_KNOTS'));
  assert.ok([...entities.values()].some((e) => e.type === 'SURFACE_OF_LINEAR_EXTRUSION'));
  assert.equal([...entities.values()].filter((e) => e.type === 'STYLED_ITEM').length, shells);
});

test('STEP: every letter a body, pockets, countersinks, stamp handle, stencil pieces', () => {
  for (const name of ['Namensschild', 'Werkstattschild', 'Oval vertieft', 'Hundemarke', 'Keksstempel', 'Große Schablone', 'WLAN-Schild']) {
    const m = preset(name);
    const entities = parse(exportSTEP(m, { title: name }));
    const shells = checkShells(entities);
    const solids = [...entities.values()].filter((e) => e.type === 'MANIFOLD_SOLID_BREP');
    assert.equal(shells, solids.length, name);
    assert.ok(solids.length >= m.parts.length, `${name}: ${solids.length} bodies`);
    if (name === 'Werkstattschild') {
      // Countersunk screws: cylinders and cones.
      assert.ok([...entities.values()].some((e) => e.type === 'CONICAL_SURFACE'));
      assert.ok([...entities.values()].some((e) => e.type === 'CYLINDRICAL_SURFACE'));
    }
  }
});

test('STEP: names beyond ASCII', () => {
  assert.equal(str('Rückseite'), "'R\\X2\\00FC\\X0\\ckseite'");
  assert.equal(str("Tim's"), "'Tim''s'");
  const m = preset('Hundemarke');
  assert.match(exportSTEP(m), /PRODUCT\('R\\X2\\00FC\\X0\\ckseite'/);
});

test('STEP of a cup: wall, lettering, border and floor bent around the axis', () => {
  for (const name of ['Stifthalter', 'Zahnputzbecher', 'Windlicht', 'Übertopf']) {
    const m = preset(name);
    assert.ok(stepSupported(m), name);
    const entities = parse(exportSTEP(m, { title: name }));
    const all = [...entities.values()];
    const count = (type) => all.filter((e) => e.type === type).length;
    // One component per part, every body closed.
    const products = all.filter((e) => e.type === 'PRODUCT').map((e) => e.args.split(',')[0]);
    assert.deepEqual(products, [str(name), ...m.parts.map((p) => str(p.name))], name);
    assert.equal(checkShells(entities), count('MANIFOLD_SOLID_BREP'), name);
    // Faces at a constant distance from the wall lie on cylinders or cones,
    // the side faces of letters are ruled B-spline surfaces.
    if (m.cup.conical) assert.ok(count('CONICAL_SURFACE') > 0 && count('CYLINDRICAL_SURFACE') === 0, name);
    else assert.ok(count('CYLINDRICAL_SURFACE') > 0 && count('CONICAL_SURFACE') === 0, name);
    assert.ok(count('B_SPLINE_SURFACE_WITH_KNOTS') > 0, name);
    // The wall closes at the back: faces all the way round use their seam
    // line twice, once in each direction.
    const refs = (s) => [...s.matchAll(/#\d+/g)].map((x) => x[0]);
    const seamFaces = all.filter((e) => e.type === 'EDGE_LOOP').filter((loop) => {
      const edges = refs(loop.args).map((oe) => refs(entities.get(oe).args)[0]);
      return new Set(edges).size < edges.length;
    });
    assert.ok(seamFaces.length >= 2, `${name}: ${seamFaces.length} faces with a seam`);
  }
});

test('STEP of a cup: bent outlines within 0.4 µm, floor up to the inside of the wall', () => {
  // A cubic of the design bent onto a cone: the B-spline stays on the curve.
  const bend = bender({ seam: [-120, 120], radius: 240 / (2 * Math.PI), t: 2.4, height: 90, sin: 0.2, cos: Math.sqrt(1 - 0.04) });
  const seg = { type: 'cubic', p: [[-30, -20], [-8, 25], [10, -30], [35, 18]] };
  const { points, mults, knots } = bentCurve(bend, seg, 3.6);
  assert.ok(knots.length > 2, 'several pieces');
  const U = knots.flatMap((k, i) => Array(mults[i]).fill(k));
  const deBoor = (s) => {
    let k = 3;
    while (k < points.length - 1 && s >= U[k + 1]) k++;
    const d = points.slice(k - 3, k + 1).map((p) => [...p]);
    for (let r = 1; r <= 3; r++) {
      for (let j = 3; j >= r; j--) {
        const a = (s - U[j + k - 3]) / (U[j + 1 + k - r] - U[j + k - 3]);
        d[j] = d[j].map((v, c) => (1 - a) * d[j - 1][c] + a * v);
      }
    }
    return d[3];
  };
  let worst = 0;
  for (let i = 0; i <= 400; i++) {
    const s = i / 400;
    const u = 1 - s;
    const b = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s];
    const x = b.reduce((v, w, j) => v + w * seg.p[j][0], 0);
    const y = b.reduce((v, w, j) => v + w * seg.p[j][1], 0);
    const exact = bend.point(x, y, 3.6);
    worst = Math.max(worst, Math.hypot(...deBoor(s).map((v, c) => v - exact[c])));
  }
  assert.ok(worst <= 4.5e-7, `${worst} mm`);
  // The floor: a disc touching the inside of the wall.
  for (const name of ['Stifthalter', 'Übertopf']) {
    const m = preset(name);
    const { shape, wall, floor } = m.cup;
    const f = cupFloor(m);
    const inside = (z) => shape.r0 + (z * shape.sin) / shape.cos - wall / shape.cos;
    assert.ok(Math.abs(f.z0) < 1e-9 && Math.abs(f.z1 - floor) < 1e-9, name);
    // (The wall's height is rounded to the 0.1 µm grid of the outlines.)
    assert.ok(Math.abs(f.r0 - inside(0)) < 1e-5 && Math.abs(f.r1 - inside(floor)) < 1e-5, name);
  }
});

test('STEP of a stamp: sloped flanks as exact faces, every letter a body', () => {
  for (const name of ['Keksstempel', 'Seifenstempel']) {
    const m = preset(name);
    // Every letter can have exact flanks – also where the feet of two
    // letters grow together (they stay bodies of their own).
    const plans = letterPlans(m);
    for (const p of plans) assert.ok(p.planned, `${name}: ${p.why}`);
    const entities = parse(exportSTEP(m, { title: name }));
    const all = [...entities.values()];
    const count = (type) => all.filter((e) => e.type === type).length;
    assert.equal(checkShells(entities), count('MANIFOLD_SOLID_BREP'), name);
    // Plate, handle and one body per letter.
    assert.equal(count('MANIFOLD_SOLID_BREP'), 2 + plans.length, name);
    // Outer corners are pieces of cones; a few faces instead of hundreds of steps.
    assert.ok(count('CONICAL_SURFACE') > plans.length, name);
    assert.ok(count('ADVANCED_FACE') < 400, `${name}: ${count('ADVANCED_FACE')} faces`);
  }
});

test('STEP of a stamp: cuts across smooth joints, letters that keep their steps', () => {
  // A script letter: the cuts of inner corners run on across smooth joints,
  // short pieces of the outline end above the foot.
  const k = letterPlans(stamp('K', 'pacifico', 10))[0];
  assert.ok(k.planned, k.why);
  const ends = k.planned.plans.flatMap((p) => p.bounds).filter((b) => !b.foot);
  assert.ok(ends.length > 0, 'pieces that end above the foot');
  assert.equal(checkShells(parse(exportSTEP(stamp('K', 'pacifico', 10)))) > 0, true);
  // A counter that closes as the letter grows keeps the fine steps.
  const e = letterPlans(stamp('e', 'montserrat', 15, 10))[0];
  assert.equal(e.why, 'eine Öffnung wächst zu');
  assert.ok(exportSTEP(stamp('e', 'montserrat', 15, 10)).includes('MANIFOLD_SOLID_BREP'));
  // Script lettering with sloped flanks exports (Clipper moves a point of
  // an outline by a hair between two steps – the wall is still found).
  for (const [text, id, draft] of [['Mia', 'pacifico', 8], ['Lobster', 'lobster', 15]]) {
    const m = stamp(text, id, draft, 10);
    const entities = parse(exportSTEP(m));
    assert.equal(checkShells(entities), [...entities.values()].filter((e) => e.type === 'MANIFOLD_SOLID_BREP').length, text);
  }
});
