import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDoc, defaultDoc } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { modelMeshes, toBinarySTL, indexMesh } from '../js/export/mesh.js';
import { build3MF, export3MF } from '../js/export/threemf.js';
import { zip, crc32 } from '../js/export/zip.js';
import { exportSVG } from '../js/export/svg.js';
import { exportDXF } from '../js/export/dxf.js';
import { regionArea, regionRings } from '../js/core/geometry.js';
import { triangulateShape } from '../js/export/triangulate.js';
import { encodeDoc, decodeHash } from '../../shared/js/share.js';
import { loadFonts, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const getFace = (ref) => lib.peek(ref);
const build = (doc) => buildModel(normalizeDoc(doc), getFace);

test('every part of every preset is a closed mesh with the right volume', () => {
  const docs = [
    ...BUILTIN_PRESETS,
    { ...defaultDoc(), body: { relief: 'engraved', thickness: 2.4, height: 1 } },
    { ...defaultDoc(), base: { shape: 'rect' }, body: { relief: 'flush', thickness: 2, height: 0.6, border: true } },
  ];
  for (const doc of docs) {
    const m = build(doc);
    for (const mesh of modelMeshes(m)) {
      const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
      assert.equal(badEdges, 0, `${doc.name} / ${mesh.part.name}: open edges`);
      assert.ok(Math.abs(volume - mesh.part.volume) <= Math.max(1e-3 * mesh.part.volume, 0.05),
        `${doc.name} / ${mesh.part.name}: volume ${volume} vs ${mesh.part.volume}`);
    }
  }
});

test('triangulation keeps every point, also with collinear edges', () => {
  // Three squares whose bottom edges lie on one line (like letters on a baseline).
  const outer = [-20, -10, 20, -10, 20, 10, -20, 10];
  const hole = (x) => [x, -5, x, 0, x + 4, 0, x + 4, -5];
  const { coords, triangles } = triangulateShape([outer, hole(-15), hole(-5), hole(5)]);
  const used = new Set(triangles);
  assert.equal(used.size, coords.length / 2);
  let area = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
    area += Math.abs((coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1])
      - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a])) / 2;
  }
  assert.ok(Math.abs(area - (800 - 3 * 20)) < 1e-9, `area ${area}`);
});

test('3MF: one object with parts and their AMS filaments', () => {
  const m = build({ ...defaultDoc(), base: { shape: 'rect' }, body: { relief: 'raised', border: true }, slots: { base: 3, text: 1, border: 4 } });
  const { model, config, parts } = build3MF(modelMeshes(m), { title: 'Test & Co' });
  assert.deepEqual(parts.map((p) => p.part.name), ['Platte', 'Schrift', 'Rand']);
  assert.match(model, /<model unit="millimeter"/);
  assert.equal((model.match(/<component objectid=/g) || []).length, 3);
  assert.match(model, /<build>\s*<item objectid="4"\/>/);
  assert.match(model, /Test &amp; Co/);
  assert.match(config, /<object id="4">/);
  for (const [id, slot] of [[1, 3], [2, 1], [3, 4]]) {
    assert.match(config, new RegExp(`<part id="${id}" subtype="normal_part">\\s*<metadata key="name" value="[^"]+"/>\\s*<metadata key="extruder" value="${slot}"/>`));
  }
});

test('ZIP container: entries, CRCs and sizes are consistent', async () => {
  const bytes = await zip([{ name: 'a.txt', data: 'hallo '.repeat(100) }, { name: 'ordner/ü.bin', data: new Uint8Array([1, 2, 3]) }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  let p = dv.getUint32(end + 16, true);
  const names = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    names.push(name);
    assert.equal(dv.getUint32(local, true), 0x04034b50);
    if (name === 'ordner/ü.bin') {
      assert.equal(usize, 3);
      assert.equal(crc, crc32(new Uint8Array([1, 2, 3])));
    }
    p += 46 + nameLen;
  }
  assert.deepEqual(names, ['a.txt', 'ordner/ü.bin']);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('3MF archive and STL are written', async () => {
  const m = build(defaultDoc());
  const meshes = modelMeshes(m);
  const file = await export3MF(meshes, { title: 'Anna' });
  assert.equal(new DataView(file.buffer).getUint32(0, true), 0x04034b50);
  const stl = toBinarySTL(meshes);
  const n = new DataView(stl.buffer).getUint32(80, true);
  assert.equal(n, meshes.reduce((s, x) => s + x.triangles, 0));
  assert.equal(stl.length, 84 + 50 * n);
  const { vertices, indices } = indexMesh(meshes[0].positions, meshes[0].triangles);
  assert.ok(vertices.length / 3 < indices.length, 'vertices are shared');
});

test('SVG export in millimetres', () => {
  const m = build(defaultDoc());
  const svg = exportSVG(m);
  assert.match(svg, /width="[\d.]+mm" height="[\d.]+mm"/);
  assert.match(svg, /<path id="platte"/);
  assert.match(svg, /<path id="schrift"/);
  const outline = exportSVG(m, { style: 'outline' });
  assert.match(outline, /fill="none" stroke="#000000"/);
});

/** Closed and open polylines of an R12 DXF: [{ layer, closed, pts }]. */
function dxfPolylines(text) {
  const lines = text.split('\r\n');
  const out = [];
  let entity = '';
  let cur = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    const value = lines[i + 1];
    if (code === 0) {
      entity = value;
      if (value === 'POLYLINE') out.push(cur = { layer: '', closed: false, pts: [] });
      else if (value === 'VERTEX') cur.pts.push(0, 0);
      else if (value === 'SEQEND') cur = null;
    } else if (cur && entity === 'POLYLINE' && code === 8) cur.layer = value;
    else if (cur && entity === 'POLYLINE' && code === 70) cur.closed = (Number(value) & 1) === 1;
    else if (cur && entity === 'VERTEX' && code === 10) cur.pts[cur.pts.length - 2] = Number(value);
    else if (cur && entity === 'VERTEX' && code === 20) cur.pts[cur.pts.length - 1] = Number(value);
  }
  return out;
}
const signedArea = (r) => {
  let a = 0;
  for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
};

test('DXF export: closed polylines in mm, one layer per part', () => {
  const sign = build(BUILTIN_PRESETS.find((p) => p.name === 'Namensschild'));
  const dxf = exportDXF(sign);
  assert.match(dxf, /\$ACADVER\r\n1\r\nAC1009/);
  assert.match(dxf, /\$INSUNITS\r\n70\r\n4/);
  assert.ok(dxf.endsWith('0\r\nEOF\r\n'));
  const polys = dxfPolylines(dxf);
  assert.ok(polys.every((p) => p.closed && p.pts.length >= 6));
  for (const [layer, region] of [['PLATTE', sign.base], ['RAND', sign.border], ['SCHRIFT', sign.text]]) {
    const own = polys.filter((p) => p.layer === layer);
    assert.equal(own.length, regionRings(region).length, `${layer}: one polyline per ring`);
    const area = own.reduce((a, p) => a + signedArea(p.pts), 0);
    assert.ok(Math.abs(area - regionArea(region)) < 1e-3, `${layer}: area ${area} vs ${regionArea(region)}`);
  }
});

test('stencil: DXF and SVG hold every cut line, bridges included', () => {
  const m = build(BUILTIN_PRESETS.find((p) => p.name === 'Sprühschablone'));
  const polys = dxfPolylines(exportDXF(m));
  assert.deepEqual([...new Set(polys.map((p) => p.layer))], ['SCHNITT']);
  assert.equal(polys.length, regionRings(m.plate).length);
  const area = polys.reduce((a, p) => a + signedArea(p.pts), 0);
  assert.ok(Math.abs(area - regionArea(m.plate)) < 1e-3, `cut area ${area}`);
  const svg = exportSVG(m, { style: 'outline' });
  assert.match(svg, /<path id="schnitt"/);
  assert.doesNotMatch(svg, /id="schrift"/);
  assert.equal((svg.match(/Z/g) || []).length, regionRings(m.plate).length, 'one closed path per ring');
});

test('share links round-trip', async () => {
  const doc = normalizeDoc({ ...defaultDoc(), texts: [{ text: 'Grüße\nzwei Zeilen' }] });
  const hash = await encodeDoc(doc, 't');
  assert.match(hash, /^t=[zj]/);
  assert.deepEqual(await decodeHash(`#${hash}`, 't'), JSON.parse(JSON.stringify(doc)));
  assert.equal(await decodeHash(`#${hash}`, 'm'), null);
});
