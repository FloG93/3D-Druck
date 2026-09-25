// Series: one piece per name of a list, side by side on the bed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDoc, defaultDoc } from '../js/core/document.js';
import { seriesNames, seriesDoc, seriesTarget, shelfLayout } from '../js/core/series.js';
import { seriesModels, seriesMeshes, seriesSheet } from '../js/export/series.js';
import { modelMeshes } from '../js/export/mesh.js';
import { build3MF } from '../js/export/threemf.js';
import { exportSVG } from '../js/export/svg.js';
import { exportDXF } from '../js/export/dxf.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { loadFonts, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const getFace = (ref) => lib.peek(ref);
const withSeries = (base, names) => normalizeDoc({ ...base, series: { enabled: true, names, gap: 5 } });

test('names: one per line, trimmed, "|" breaks the line', () => {
  const doc = withSeries(defaultDoc(), '  Anna \n\nBen\nFamilie | Müller\n');
  assert.deepEqual(seriesNames(doc), ['Anna', 'Ben', 'Familie\nMüller']);
  assert.deepEqual(seriesNames({ ...doc, series: { ...doc.series, enabled: false } }), []);
  // The first plain text is replaced, QR codes and graphics stay.
  const qrFirst = normalizeDoc({ texts: [{ kind: 'qr', text: 'https://example.org' }, { text: 'Name' }, { text: 'Klasse 3b' }] });
  assert.equal(seriesTarget(qrFirst), 1);
  const one = seriesDoc(qrFirst, 'Clara');
  assert.deepEqual(one.texts[0], qrFirst.texts[0], 'the QR code stays');
  assert.deepEqual(one.texts.slice(1).map((t) => t.text), ['Clara', 'Klasse 3b']);
  assert.equal(one.series.enabled, false);
});

test('shelf layout: rows no wider than the bed, no overlaps', () => {
  const sizes = [[40, 15], [60, 20], [50, 15], [120, 30], [30, 10]];
  const pos = shelfLayout(sizes, { width: 150, gap: 5 });
  assert.deepEqual(pos[0], [0, 0]);
  assert.deepEqual(pos[1], [45, 0]);
  assert.deepEqual(pos[2], [0, 25], 'next row below the highest of the first');
  for (let i = 0; i < sizes.length; i++) {
    assert.ok(pos[i][0] + sizes[i][0] <= 150 || pos[i][0] === 0);
    for (let j = 0; j < i; j++) {
      const apart = pos[i][0] >= pos[j][0] + sizes[j][0] || pos[j][0] >= pos[i][0] + sizes[i][0]
        || pos[i][1] >= pos[j][1] + sizes[j][1] || pos[j][1] >= pos[i][1] + sizes[i][1];
      assert.ok(apart, `${i} and ${j} apart`);
    }
  }
});

test('3MF: one object per name, named after it, laid out on the bed', () => {
  const doc = withSeries(BUILTIN_PRESETS.find((p) => p.name === 'Schlüsselanhänger'), 'Anna\nBen\nClara\nMaximilian\nLea\nTim');
  const items = seriesModels(doc, getFace);
  assert.equal(items.length, 6);
  assert.deepEqual(items.map((i) => i.model.doc.texts[0].text), ['Anna', 'Ben', 'Clara', 'Maximilian', 'Lea', 'Tim']);
  const meshes = seriesMeshes(items, { bed: 180, gap: 5, prepare: modelMeshes });
  const three = build3MF(meshes, { title: 'Klasse' });
  assert.equal(three.objects, 6);
  for (const name of ['Anna', 'Maximilian', 'Tim']) assert.match(three.config, new RegExp(`<metadata key="name" value="${name}"/>`));
  // Every piece closed; all of them within the width of the bed, apart.
  const boxes = new Map();
  for (const m of meshes) {
    assert.equal(meshCheck(m.positions, m.triangles).badEdges, 0);
    const key = m.part.object;
    const b = boxes.get(key) || { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (let i = 0; i < m.positions.length; i += 3) {
      b.minX = Math.min(b.minX, m.positions[i]);
      b.maxX = Math.max(b.maxX, m.positions[i]);
      b.minY = Math.min(b.minY, m.positions[i + 1]);
      b.maxY = Math.max(b.maxY, m.positions[i + 1]);
    }
    boxes.set(key, b);
  }
  const list = [...boxes.values()];
  assert.ok(Math.max(...list.map((b) => b.maxX)) - Math.min(...list.map((b) => b.minX)) <= 170 + 1e-6, 'within the bed');
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = list[i];
      const b = list[j];
      assert.ok(a.minX >= b.maxX + 4.9 || b.minX >= a.maxX + 4.9 || a.minY >= b.maxY + 4.9 || b.minY >= a.maxY + 4.9, 'at least the gap apart');
    }
  }
});

test('stamps in a series keep their handles; SVG and DXF on one sheet', () => {
  const stamp = withSeries(BUILTIN_PRESETS.find((p) => p.name === 'Tinten-Stempel'), 'Anna\nBen');
  const meshes = seriesMeshes(seriesModels(stamp, getFace), { bed: 256, gap: 5, prepare: modelMeshes });
  const three = build3MF(meshes, { title: 'Stempel' });
  assert.equal(three.objects, 4, 'two stamps, two handles');
  assert.match(three.config, /value="Anna – Griff"/);
  const tags = withSeries(BUILTIN_PRESETS.find((p) => p.name === 'Kofferanhänger'), 'Anna\nBen\nClara');
  const items = seriesModels(tags, getFace);
  const sheet = seriesSheet(items, { width: 300, gap: 5 });
  const single = items[0].model;
  assert.equal(sheet.base.length, items.reduce((n, i) => n + i.model.base.length, 0));
  assert.ok(sheet.bounds.maxX - sheet.bounds.minX > 2 * (single.bounds.maxX - single.bounds.minX), 'side by side');
  const svg = exportSVG(sheet, { style: 'outline' });
  assert.equal((svg.match(/<path id="platte"/g) || []).length, 1);
  const dxf = exportDXF(sheet);
  assert.ok((dxf.match(/POLYLINE/g) || []).length >= 3 * (single.base.length + single.text.length));
});
