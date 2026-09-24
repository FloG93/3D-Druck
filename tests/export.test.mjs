import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultDoc, normalizeDoc } from '../pattern-generator/js/core/document.js';
import { generate } from '../pattern-generator/js/core/generator.js';
import { exportDXF } from '../pattern-generator/js/export/dxf.js';
import { exportSVG } from '../pattern-generator/js/export/svg.js';
import { exportSTEP } from '../pattern-generator/js/export/step.js';
import { exportFusionJSON } from '../pattern-generator/js/export/fusion.js';
import { buildPlateMesh, buildTubeMesh, toBinarySTL, insetConvex } from '../pattern-generator/js/export/mesh.js';
import { polygonize } from '../pattern-generator/js/core/shapes.js';
import { encodeDoc, decodeHash } from '../pattern-generator/js/ui/share.js';

const CASES = {
  slots: defaultDoc(),
  mixed: normalizeDoc({
    canvas: { width: 90, height: 60 },
    boundary: { type: 'ellipse', margin: 3 },
    shape: { type: 'ellipse', width: 5, height: 2.5 },
    pattern: { type: 'grid', spacingX: 8, spacingY: 6, rotation: 10 },
  }),
  circles: normalizeDoc({
    canvas: { width: 60, height: 60 },
    boundary: { type: 'polygon', sides: 6, cornerRadius: 4, margin: 3 },
    shape: { type: 'ellipse', width: 3, height: 3 },
    pattern: { type: 'hex', spacingX: 5, spacingY: 4.33 },
  }),
  squares: normalizeDoc({
    canvas: { width: 60, height: 40 },
    boundary: { type: 'none', margin: 2 },
    shape: { type: 'rect', width: 4, height: 4, round: 0 },
    pattern: { type: 'grid', spacingX: 6, spacingY: 6 },
  }),
};

/** Parses DXF text into [code, value] pairs. */
function dxfPairs(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1]]);
  return pairs;
}

test('DXF: R12 structure, integer group codes and exact hole area', () => {
  for (const [name, doc] of Object.entries(CASES)) {
    const r = generate(doc);
    const text = exportDXF(r, doc, { origin: 'center', includeBoundary: true });
    assert.ok(text.includes('AC1009'), name);
    const pairs = dxfPairs(text);
    assert.deepEqual(pairs[pairs.length - 1], [0, 'EOF']);
    const sections = pairs.filter(([c, v]) => c === 0 && v === 'SECTION').length;
    assert.equal(sections, pairs.filter(([c, v]) => c === 0 && v === 'ENDSEC').length);
    for (const [code, value] of pairs) {
      if ((code >= 60 && code <= 99) || (code >= 170 && code <= 179)) assert.match(value, /^-?\d+$/, `integer code ${code}`);
    }
    // Area of all hole loops via Green's theorem over LINE/ARC/CIRCLE entities.
    let area = 0;
    let ent = null;
    const flush = () => {
      if (!ent || ent.layer !== 'LOECHER') return;
      const g = ent.g;
      if (ent.type === 'LINE') area += (g[10] * g[21] - g[11] * g[20]) / 2;
      if (ent.type === 'CIRCLE') area += Math.PI * g[40] ** 2;
      if (ent.type === 'ARC') {
        const a0 = (g[50] * Math.PI) / 180;
        let sw = ((g[51] - g[50]) * Math.PI) / 180;
        if (sw <= 0) sw += 2 * Math.PI;
        const a1 = a0 + sw;
        area += (g[40] ** 2 * sw + g[40] * (g[10] * (Math.sin(a1) - Math.sin(a0)) - g[20] * (Math.cos(a1) - Math.cos(a0)))) / 2;
      }
    };
    let inEntities = false;
    for (const [code, value] of pairs) {
      if (code === 2 && value === 'ENTITIES') inEntities = true;
      if (!inEntities) continue;
      if (code === 0) {
        flush();
        ent = { type: value, g: {} };
      } else if (code === 8) ent.layer = value;
      else if (ent) ent.g[code] = Number(value);
    }
    const rel = Math.abs(area - r.stats.openArea) / r.stats.openArea;
    assert.ok(rel < 1e-4, `${name}: DXF hole area ${area} vs ${r.stats.openArea}`);
  }
});

test('DXF: corner origin shifts all coordinates', () => {
  const doc = CASES.squares;
  const r = generate(doc);
  const pairs = dxfPairs(exportDXF(r, doc, { origin: 'corner', includeBoundary: true }));
  const xs = pairs.filter(([c]) => c === 10 || c === 11).map(([, v]) => Number(v));
  assert.ok(Math.min(...xs) >= -1e-6);
  assert.ok(Math.max(...xs) <= 60 + 1e-6);
});

test('SVG: millimetre units and one element per hole', () => {
  for (const [name, doc] of Object.entries(CASES)) {
    const r = generate(doc);
    const svg = exportSVG(r, doc, { style: 'fill', includeBoundary: true });
    assert.match(svg, new RegExp(`width="${doc.canvas.width}mm" height="${doc.canvas.height}mm"`));
    assert.match(svg, new RegExp(`viewBox="0 0 ${doc.canvas.width} ${doc.canvas.height}"`));
    const elements = (svg.match(/<(path|circle) /g) || []).length;
    assert.equal(elements, r.holes.length + 1, name);
    assert.ok(!svg.includes('NaN'));
    const plate = exportSVG(r, doc, { style: 'plate' });
    assert.equal((plate.match(/<path /g) || []).length, 1);
    assert.match(plate, /fill-rule="evenodd"/);
  }
});

function stepEntities(text) {
  const map = new Map();
  for (const m of text.matchAll(/^#(\d+)=(.*);$/gm)) map.set(Number(m[1]), m[2]);
  return map;
}

test('STEP: references resolve and every edge is used twice with opposite senses', () => {
  for (const [name, doc] of Object.entries(CASES)) {
    const r = generate(doc);
    for (const mode of ['tools', 'plate']) {
      const text = exportSTEP(r, doc, { mode, thickness: 2, name });
      assert.ok(text.startsWith('ISO-10303-21;'));
      assert.ok(text.trimEnd().endsWith('END-ISO-10303-21;'));
      const ents = stepEntities(text);
      for (const [id, body] of ents) {
        for (const ref of body.matchAll(/#(\d+)/g)) assert.ok(ents.has(Number(ref[1])), `#${id} references missing #${ref[1]}`);
      }
      const uses = new Map();
      for (const body of ents.values()) {
        const m = /^ORIENTED_EDGE\('',\*,\*,#(\d+),\.(T|F)\.\)$/.exec(body);
        if (!m) continue;
        const list = uses.get(m[1]) || [];
        list.push(m[2]);
        uses.set(m[1], list);
      }
      const edges = [...ents.entries()].filter(([, b]) => b.startsWith('EDGE_CURVE('));
      assert.equal(uses.size, edges.length, `${name}/${mode}: every edge is used`);
      for (const [edge, senses] of uses) {
        assert.deepEqual(senses.sort(), ['F', 'T'], `${name}/${mode}: edge #${edge} used ${senses}`);
      }
      const solids = [...ents.values()].filter((b) => b.startsWith('MANIFOLD_SOLID_BREP(')).length;
      assert.equal(solids, mode === 'tools' ? r.holes.length : 1);
    }
  }
});

test('Fusion JSON: schema and loop ordering', () => {
  const doc = CASES.slots;
  const r = generate(doc);
  const data = JSON.parse(exportFusionJSON(r, doc, { includeBoundary: true }));
  assert.equal(data.format, 'muster-generator/fusion');
  assert.equal(data.units, 'mm');
  assert.equal(data.holes.length, r.holes.length);
  for (const hole of data.holes) {
    assert.equal(hole.p[0][0], 'A');
    assert.equal(hole.p[hole.p.length - 1][0], 'L');
  }
  assert.ok(data.boundary && data.boundary.p.length === 8);
  assert.deepEqual(data.relief, { mode: 'cut', height: 1, taper: 0 });
  const mixed = JSON.parse(exportFusionJSON(generate(CASES.mixed), CASES.mixed, { includeBoundary: false }));
  assert.equal(mixed.boundary, null);
  assert.ok(mixed.holes.every((h) => Array.isArray(h.e) && h.e.length === 5));
});

/**
 * Checks that a triangle soup is closed: every directed edge is matched by
 * exactly one reverse edge (strict) or by as many reverse edges (shells that
 * touch each other). Returns the enclosed volume.
 */
function closedVolume(p, label, { strict = true } = {}) {
  const edges = new Map();
  let volume = 0;
  const key = (i) => `${p[i]},${p[i + 1]},${p[i + 2]}`;
  for (let i = 0; i < p.length; i += 9) {
    const v = [i, i + 3, i + 6];
    for (let k = 0; k < 3; k++) {
      const a = key(v[k]);
      const b = key(v[(k + 1) % 3]);
      assert.notEqual(a, b, `${label}: degenerate edge`);
      const e = `${a}|${b}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split('|');
    if (strict) assert.equal(n, 1, `${label}: duplicate edge`);
    assert.equal(edges.get(`${b}|${a}`), n, `${label}: open edge`);
  }
  return volume;
}

// Inscribed polygons lose at most tol x perimeter of area per outline.
function perimeter(o, tol) {
  const pts = polygonize(o, tol);
  return pts.reduce((s, q, i) => s + Math.hypot(pts[(i + 1) % pts.length][0] - q[0], pts[(i + 1) % pts.length][1] - q[1]), 0);
}

test('STL: closed two-manifold mesh with the expected volume', () => {
  for (const [name, doc] of Object.entries(CASES)) {
    const r = generate(doc);
    const t = 2.5;
    const mesh = buildPlateMesh(r.boundary.outline, r.holes.map((h) => h.outline), t, 0.01);
    const volume = closedVolume(mesh.positions, name);
    const bound = (perimeter(r.boundary.outline, 0.01) + r.holes.reduce((s, h) => s + perimeter(h.outline, 0.01), 0)) * 0.01 * t;
    const expected = (r.boundary.area - r.stats.openArea) * t;
    assert.ok(Math.abs(volume - expected) <= bound, `${name}: volume ${volume} vs ${expected} (bound ${bound})`);
    assert.equal(mesh.featureStart, mesh.triangles, 'through holes are not relief');
    const stl = toBinarySTL(mesh.positions);
    assert.equal(stl.length, 84 + 50 * mesh.triangles);
    assert.equal(new DataView(stl.buffer).getUint32(80, true), mesh.triangles);
  }
});

test('STL relief: raised and recessed shapes give one closed solid with the exact volume', () => {
  for (const [name, doc] of Object.entries(CASES)) {
    const r = generate(doc);
    const t = 2;
    const tol = 0.01;
    const bound = (perimeter(r.boundary.outline, tol) * t + r.holes.reduce((s, h) => s + perimeter(h.outline, tol), 0) * 1.5) * tol;
    for (const [mode, sign] of [['emboss', 1], ['deboss', -1]]) {
      const mesh = buildPlateMesh(r.boundary.outline, r.holes.map((h) => h.outline), t, tol, { relief: { mode, height: 1.5, taper: 0 } });
      const volume = closedVolume(mesh.positions, `${name}/${mode}`);
      const expected = r.boundary.area * t + sign * r.stats.openArea * 1.5;
      assert.ok(Math.abs(volume - expected) <= bound, `${name}/${mode}: volume ${volume} vs ${expected}`);
      assert.ok(mesh.featureStart > 0 && mesh.featureStart < mesh.triangles);
    }
    // Recesses never cut through the plate.
    const deep = buildPlateMesh(r.boundary.outline, r.holes.map((h) => h.outline), t, tol, { relief: { mode: 'deboss', height: 5 } });
    const volume = closedVolume(deep.positions, `${name}/deep`);
    assert.ok(Math.abs(volume - (r.boundary.area * t - r.stats.openArea * t * 0.95)) <= bound * 2);
  }
});

test('STL relief: sloped flanks stay closed and run to ridges and points', () => {
  // 4 x 4 mm squares: frustums, pyramids and inverted pyramids with known volume.
  const doc = CASES.squares;
  const r = generate(doc);
  const n = r.holes.length;
  const slab = r.boundary.area * 2;
  const outlines = r.holes.map((h) => h.outline);
  const frustum = (a, b, h) => (h / 3) * (a * a + b * b + a * b);
  const cases = [
    ['emboss', 1, 30, frustum(4, 4 - 2 * Math.tan(Math.PI / 6), 1)],
    ['emboss', 5, 60, frustum(4, 0, 2 / Math.tan(Math.PI / 3))],
    ['deboss', 1, 45, -frustum(4, 2, 1)],
    ['deboss', 1.9, 80, -frustum(4, 0, 2 / Math.tan((80 * Math.PI) / 180))],
  ];
  for (const [mode, height, taper, each] of cases) {
    const mesh = buildPlateMesh(r.boundary.outline, outlines, 2, 0.01, { relief: { mode, height, taper } });
    const volume = closedVolume(mesh.positions, `${mode} ${taper}°`);
    assert.ok(Math.abs(volume - (slab + n * each)) < 1e-3 * slab, `${mode} ${taper}°: ${volume} vs ${slab + n * each}`);
  }
  // Rounded shapes of every kind, with flanks from gentle to pointed.
  for (const [name, d] of Object.entries(CASES)) {
    const g = generate(d);
    for (const taper of [20, 50, 80]) {
      for (const mode of ['emboss', 'deboss']) {
        const mesh = buildPlateMesh(g.boundary.outline, g.holes.map((h) => h.outline), 2, 0.01, { relief: { mode, height: 1, taper } });
        const volume = closedVolume(mesh.positions, `${name}/${mode}/${taper}`);
        const full = g.boundary.area * 2 + (mode === 'emboss' ? 1 : -1) * g.stats.openArea;
        assert.ok(mode === 'emboss' ? volume > g.boundary.area * 2 - 1 && volume < full + 1 : volume < g.boundary.area * 2 + 1 && volume > full - 1,
          `${name}/${mode}/${taper}: volume ${volume}`);
      }
    }
  }
});

test('STL relief: overlapping raised shapes become separate closed shells', () => {
  const doc = normalizeDoc({
    canvas: { width: 60, height: 40 },
    shape: { type: 'rect', width: 8, height: 2, round: 1 },
    pattern: { type: 'grid', spacingX: 6, spacingY: 5 },
  });
  const r = generate(doc);
  const mesh = buildPlateMesh(r.boundary.outline, r.holes.map((h) => h.outline), 2, 0.02, { relief: { mode: 'emboss', height: 1, taper: 20 } });
  const volume = closedVolume(mesh.positions, 'overlap', { strict: false });
  assert.ok(volume > r.boundary.area * 2);
});

test('insetConvex: straight skeleton of rectangles, squares and slots', () => {
  const rect = [[0, 0], [10, 0], [10, 2], [0, 2]];
  const ridge = insetConvex(rect, 5);
  assert.equal(ridge.s, 1, 'collapses at half the width');
  assert.equal(ridge.top.length, 2);
  assert.deepEqual(ridge.top.map(([x, y]) => [Math.round(x * 1e9) / 1e9, y]).sort((a, b) => a[0] - b[0]), [[1, 1], [9, 1]]);
  const half = insetConvex(rect, 0.5);
  assert.equal(half.s, 0.5);
  assert.deepEqual(half.top, [[9.5, 0.5], [9.5, 1.5], [0.5, 1.5], [0.5, 0.5]]);
  const square = insetConvex([[0, 0], [4, 0], [4, 4], [0, 4]], 3);
  assert.equal(square.s, 2);
  assert.ok(square.apex && Math.hypot(square.apex[0] - 2, square.apex[1] - 2) < 1e-9);
  // Slot of radius 1: beyond the radius the round ends vanish into points.
  const slot = [];
  for (let k = 0; k <= 16; k++) slot.push([3 + Math.cos(-Math.PI / 2 + (Math.PI * k) / 16), Math.sin(-Math.PI / 2 + (Math.PI * k) / 16)]);
  for (let k = 0; k <= 16; k++) slot.push([-3 + Math.cos(Math.PI / 2 + (Math.PI * k) / 16), Math.sin(Math.PI / 2 + (Math.PI * k) / 16)]);
  const deep = insetConvex(slot, 0.9);
  assert.ok(deep.top.length >= 4);
  for (const [, y] of deep.top) assert.ok(Math.abs(y) <= 0.1 + 1e-9);
  const flat = insetConvex(slot, 0.2);
  assert.equal(flat.top.length, slot.length, 'small offsets keep every edge');
});

test('STEP relief: raised and recessed plates are closed B-reps', () => {
  for (const [name, doc] of Object.entries(CASES)) {
    const r = generate(doc);
    for (const mode of ['emboss', 'deboss']) {
      const text = exportSTEP(r, doc, { mode: 'plate', thickness: 3, relief: { mode, height: 1, taper: 20 }, name });
      const ents = stepEntities(text);
      const uses = new Map();
      for (const body of ents.values()) {
        const m = /^ORIENTED_EDGE\('',\*,\*,#(\d+),\.(T|F)\.\)$/.exec(body);
        if (!m) continue;
        const list = uses.get(m[1]) || [];
        list.push(m[2]);
        uses.set(m[1], list);
      }
      for (const [edge, senses] of uses) assert.deepEqual(senses.sort(), ['F', 'T'], `${name}/${mode}: edge #${edge}`);
      assert.equal([...ents.values()].filter((b) => b.startsWith('MANIFOLD_SOLID_BREP(')).length, 1);
      const faces = [...ents.values()].filter((b) => b.startsWith('ADVANCED_FACE(')).length;
      assert.ok(faces > r.holes.length * 2, `${name}/${mode}: every shape has walls and a top or floor`);
    }
  }
});

test('tube: a plain cylinder wall is closed with the exact volume', () => {
  const U = Math.PI * 40;
  const R = 20;
  const n = 90;
  const mesh = buildTubeMesh([], U, 30, 2, 0.01, { segments: n });
  const volume = closedVolume(mesh.positions, 'plain tube');
  // Every ring is a regular n-gon through the exact circle.
  const exact = (n / 2) * Math.sin((2 * Math.PI) / n) * (R * R - 18 * 18) * 30;
  assert.ok(Math.abs(volume - exact) < 1e-6 * exact, `${volume} vs ${exact}`);
  assert.equal(mesh.radius, R);
});

test('tube: holes across the seam, relief and flanks give closed tubes', () => {
  const U = Math.PI * 36;
  const doc = normalizeDoc({
    canvas: { width: U, height: 40 },
    form: { type: 'cylinder' },
    boundary: { margin: 3 },
    shape: { type: 'polygon', sides: 6, width: 6, height: 6, round: 0.2 },
    pattern: { type: 'hex', spacingX: 9, spacingY: 7.8, offsetX: U / 2 },
  });
  const r = generate(doc);
  assert.ok(r.holes.some((h) => Math.abs(h.x) + h.R > U / 2 + 1), 'holes on the seam');
  const outlines = [...r.holes, ...r.ghosts].map((h) => h.outline);
  const R = U / (2 * Math.PI);
  const t = 2;
  const A = r.stats.openArea;
  // Bent plate: an area element at depth z below the surface shrinks by (R - z) / R.
  const layer = (z0, z1) => (z1 - z0) - (z1 * z1 - z0 * z0) / (2 * R);
  const cases = [
    [{ mode: 'cut' }, (U * 40 - A) * layer(0, t)],
    [{ mode: 'emboss', height: 1, taper: 0 }, U * 40 * layer(0, t) + A * layer(-1, 0)],
    [{ mode: 'deboss', height: 1, taper: 0 }, U * 40 * layer(0, t) - A * layer(0, 1)],
    [{ mode: 'emboss', height: 1, taper: 45 }, null],
    [{ mode: 'deboss', height: 1.5, taper: 70 }, null],
  ];
  for (const [relief, expected] of cases) {
    const mesh = buildTubeMesh(outlines, U, 40, t, 0.01, { segments: 160, relief });
    const volume = closedVolume(mesh.positions, `tube ${relief.mode} ${relief.taper || 0}`);
    if (expected) assert.ok(Math.abs(volume - expected) < 2e-3 * expected, `${relief.mode}: ${volume} vs ${expected}`);
    assert.ok(mesh.featureStart <= mesh.triangles);
  }
  // A closed bottom is an extra shell reaching into the wall.
  const cup = buildTubeMesh(outlines, U, 40, t, 0.01, { segments: 120, bottom: 3 });
  const plain = buildTubeMesh(outlines, U, 40, t, 0.01, { segments: 120 });
  const floor = closedVolume(cup.positions, 'cup', { strict: false }) - closedVolume(plain.positions, 'tube');
  const rd = R - t / 2;
  const disc = 60 * Math.sin(Math.PI / 60) * rd * rd * 3;
  assert.ok(Math.abs(floor - disc) < 1e-5 * disc, `floor ${floor} vs ${disc}`);
});

test('cylinder exports are the unrolled surface', () => {
  const U = Math.PI * 30;
  const doc = normalizeDoc({ canvas: { width: U, height: 20 }, form: { type: 'cylinder', bottom: 2 }, shape: { type: 'ellipse', width: 3, height: 3 }, pattern: { type: 'grid', spacingX: 6, spacingY: 6 } });
  const r = generate(doc);
  const pairs = dxfPairs(exportDXF(r, doc, { origin: 'center', includeBoundary: true }));
  const xs = pairs.filter(([c]) => c === 10 || c === 11).map(([, v]) => Number(v));
  assert.ok(Math.max(...xs) >= U / 2 - 1e-3, 'boundary spans the circumference');
  const data = JSON.parse(exportFusionJSON(r, doc, { includeBoundary: true }));
  assert.deepEqual(data.form, { type: 'cylinder', diameter: 30, bottom: 2 });
});

test('share links round-trip the document', async () => {
  const doc = defaultDoc();
  doc.shape.width = 7.25;
  const hash = await encodeDoc(doc);
  assert.match(hash, /^m=[zj][A-Za-z0-9_-]+$/);
  const back = await decodeHash(`#${hash}`);
  assert.deepEqual(back, JSON.parse(JSON.stringify(doc)));
  assert.equal(await decodeHash('#nothing'), null);
});
