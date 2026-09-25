// STEP export: an assembly with one component per part, exact solids whose
// every edge is used twice in opposite directions (closed shells).

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDoc } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { exportSTEP, stepSupported } from '../js/export/step.js';
import { str } from '../../shared/js/step.js';
import { loadFonts } from './helpers.mjs';

const lib = await loadFonts();
const preset = (name) => buildModel(normalizeDoc(BUILTIN_PRESETS.find((p) => p.name === name)), (ref) => lib.peek(ref));

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

test('STEP: names beyond ASCII, no STEP for cups', () => {
  assert.equal(str('Rückseite'), "'R\\X2\\00FC\\X0\\ckseite'");
  assert.equal(str("Tim's"), "'Tim''s'");
  const m = preset('Hundemarke');
  assert.match(exportSTEP(m), /PRODUCT\('R\\X2\\00FC\\X0\\ckseite'/);
  const cup = preset('Stifthalter');
  assert.equal(stepSupported(cup), false);
  assert.throws(() => exportSTEP(cup), /Becher/);
});
