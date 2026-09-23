import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultDoc, normalizeDoc } from '../pattern-generator/js/core/document.js';
import { generate } from '../pattern-generator/js/core/generator.js';
import { exportDXF } from '../pattern-generator/js/export/dxf.js';
import { exportSVG } from '../pattern-generator/js/export/svg.js';
import { exportSTEP } from '../pattern-generator/js/export/step.js';
import { exportFusionJSON } from '../pattern-generator/js/export/fusion.js';
import { buildPlateMesh, toBinarySTL } from '../pattern-generator/js/export/mesh.js';
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
  const mixed = JSON.parse(exportFusionJSON(generate(CASES.mixed), CASES.mixed, { includeBoundary: false }));
  assert.equal(mixed.boundary, null);
  assert.ok(mixed.holes.every((h) => Array.isArray(h.e) && h.e.length === 5));
});

test('STL: closed two-manifold mesh with the expected volume', () => {
  for (const [name, doc] of Object.entries(CASES)) {
    const r = generate(doc);
    const t = 2.5;
    const mesh = buildPlateMesh(r.boundary.outline, r.holes.map((h) => h.outline), t, 0.01);
    const p = mesh.positions;
    const edges = new Map();
    let volume = 0;
    const key = (i) => `${p[i]},${p[i + 1]},${p[i + 2]}`;
    for (let i = 0; i < p.length; i += 9) {
      const v = [i, i + 3, i + 6];
      for (let k = 0; k < 3; k++) {
        const e = `${key(v[k])}|${key(v[(k + 1) % 3])}`;
        edges.set(e, (edges.get(e) || 0) + 1);
      }
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
      volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    for (const [e, n] of edges) {
      const [a, b] = e.split('|');
      assert.equal(n, 1, `${name}: duplicate edge`);
      assert.equal(edges.get(`${b}|${a}`), 1, `${name}: open edge`);
    }
    // Inscribed polygons lose at most tol x perimeter of area per outline.
    const perimeter = (o) => {
      const pts = polygonize(o, 0.01);
      return pts.reduce((s, q, i) => s + Math.hypot(pts[(i + 1) % pts.length][0] - q[0], pts[(i + 1) % pts.length][1] - q[1]), 0);
    };
    const bound = (perimeter(r.boundary.outline) + r.holes.reduce((s, h) => s + perimeter(h.outline), 0)) * 0.01 * t;
    const expected = (r.boundary.area - r.stats.openArea) * t;
    assert.ok(Math.abs(volume - expected) <= bound, `${name}: volume ${volume} vs ${expected} (bound ${bound})`);
    const stl = toBinarySTL(p);
    assert.equal(stl.length, 84 + 50 * mesh.triangles);
    assert.equal(new DataView(stl.buffer).getUint32(80, true), mesh.triangles);
  }
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
