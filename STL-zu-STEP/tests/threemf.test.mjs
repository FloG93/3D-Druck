// Reading 3MF (js/core/threemf.js, zip.js, inflate.js, xml.js): the ZIP and
// deflate layers against node:zlib, the model against hand-computed numbers,
// every defect as a file, and the whole way through the pipeline to STEP.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

import { inflateRaw } from '../js/core/inflate.js';
import { readZip, crc32, looksLikeZip } from '../js/core/zip.js';
import { scanXml, attr, decodeEntities } from '../js/core/xml.js';
import { parseMesh } from '../js/core/parse.js';
import { weldMesh } from '../js/core/weld.js';
import { signedVolume } from '../js/core/meshops.js';
import { convert, toTransferable } from '../js/core/pipeline.js';
import { writeStep } from '../js/export/step.js';
import { zipFiles, make3mf, modelXml, meshOfFixture, move } from './helpers3mf.mjs';
import { build, OUT } from './tools/make_3mf_fixtures.mjs';
import { loadFixture } from './helpers.mjs';

const fixture3mf = (name) => {
  const b = fs.readFileSync(OUT + name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const asBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const parsed = (name) => parseMesh(fixture3mf(name), name);
const meshVolume = (name) => {
  const { tris } = parsed(name);
  const { V, F } = weldMesh(tris);
  return signedVolume(V, F);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// --- the layers underneath -----------------------------------------------------

test('inflate: stored, fixed and dynamic blocks agree with node:zlib', () => {
  const text = new TextEncoder().encode('<vertex x="1.5" y="2.25" z="3"/>\n'.repeat(5000));
  let s = 1;
  const noise = Uint8Array.from({ length: 20000 }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255);
  for (const data of [new Uint8Array(0), new TextEncoder().encode('hallo'), text, noise, Uint8Array.from([...noise.subarray(0, 3000), ...text.subarray(0, 9000)])]) {
    for (const options of [{ level: 0 }, { strategy: zlib.constants.Z_FIXED }, { level: 1 }, { level: 9 }, { strategy: zlib.constants.Z_RLE }]) {
      const out = inflateRaw(new Uint8Array(zlib.deflateRawSync(data, options)), 0);
      assert.equal(out.length, data.length);
      assert.ok(out.every((v, i) => v === data[i]), `data of ${data.length} bytes, ${JSON.stringify(options)}`);
    }
  }
});

test('inflate: damaged data is reported, not decoded into garbage', () => {
  const packed = new Uint8Array(zlib.deflateRawSync(new TextEncoder().encode('abc'.repeat(1000))));
  assert.throws(() => inflateRaw(packed.subarray(0, 4)), /beschädigt/);
  assert.throws(() => inflateRaw(Uint8Array.of(0xff, 0xff, 0xff)), /beschädigt/, 'block type 3 does not exist');
});

test('zip: entries read back exactly, deflated or stored, with a checksum', () => {
  const files = [
    { name: 'a.txt', data: 'Grüße'.repeat(500) },
    { name: 'dir/b.bin', data: Uint8Array.from({ length: 300 }, (_, i) => i % 251), store: true },
    { name: 'leer.txt', data: '' },
  ];
  const zip = readZip(zipFiles(files));
  assert.deepEqual(zip.names.sort(), ['a.txt', 'dir/b.bin', 'leer.txt']);
  assert.equal(new TextDecoder().decode(zip.read('a.txt')), 'Grüße'.repeat(500));
  assert.deepEqual([...zip.read('/dir/b.bin')], [...files[1].data], 'a leading slash is ignored');
  assert.equal(zip.read('leer.txt').length, 0);
  assert.equal(zip.has('fehlt'), false);
  assert.throws(() => zip.read('fehlt'), /fehlt der Eintrag/);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
});

test('zip: a wrong checksum and a cut-off archive are named', () => {
  const bad = readZip(zipFiles([{ name: 'a.txt', data: 'abc' }], { corruptCrc: 'a.txt' }));
  assert.throws(() => bad.read('a.txt'), /Prüfsumme/);
  const whole = zipFiles([{ name: 'a.txt', data: 'abc'.repeat(100) }]);
  assert.throws(() => readZip(whole.subarray(0, whole.length - 40)), /abgeschnitten|Verzeichnis/);
  assert.equal(looksLikeZip(whole), true);
  assert.equal(looksLikeZip(new TextEncoder().encode('solid x')), false);
});

test('xml: attributes, entities, comments, CDATA and text', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#65;&#x42; &unknown;'), 'a & b <c> AB &unknown;');
  const seen = [];
  scanXml(`<?xml version="1.0"?><!-- <fake a="1"/> --><m unit='inch' a:b="x&amp;y"><meta name="T">Titel <![CDATA[<roh>]]></meta><v x="1"  y = "2" /></m>`, {
    open: (name, raw, self) => seen.push(`<${name}${self ? '/' : ''} ${attr(raw, 'unit') ?? attr(raw, 'a:b') ?? attr(raw, 'y') ?? attr(raw, 'name') ?? ''}`),
    close: (name) => seen.push(`</${name}`),
    text: (t) => seen.push(`"${t.trim()}"`),
  });
  assert.deepEqual(seen, ['<m inch', '<meta T', '"Titel"', '"<roh>"', '</meta', '<v/ 2', '</v', '</m']);
  assert.equal(attr('xx="1" x="2"', 'x'), '2', 'x is not the end of xx');
});

// --- the fixtures are what the script writes ------------------------------------

test('fixtures: the committed 3MF files are what make_3mf_fixtures.mjs builds', () => {
  const cases = build();
  for (const [name, { data }] of Object.entries(cases)) {
    assert.ok(fs.existsSync(OUT + name), `${name} is missing – run tests/tools/make_3mf_fixtures.mjs`);
    assert.ok(Buffer.from(data).equals(fs.readFileSync(OUT + name)), `${name} differs from what the script writes`);
  }
  const onDisk = fs.readdirSync(OUT).filter((f) => f.endsWith('.3mf'));
  assert.deepEqual(onDisk.sort(), Object.keys(cases).sort());
});

// --- the model -----------------------------------------------------------------

test('3mf: a single object comes out like the STL it was made from', () => {
  const { tris, info, warnings } = parsed('wuerfel.3mf');
  const stl = parseMesh(loadFixture('wuerfel.stl'), 'wuerfel.stl');
  assert.equal(tris.length / 9, 12);
  assert.deepEqual(warnings, []);
  assert.equal(signedVolume(...(({ V, F }) => [V, F])(weldMesh(tris))), 1000);
  assert.equal(tris.length, stl.tris.length);
  assert.equal(info.format, '3mf');
  assert.equal(info.title, 'Würfel');
  assert.equal(info.application, 'STL-zu-STEP Test');
  assert.equal(info.unit, 'millimeter');
  assert.equal(info.objects.length, 1);
  const [row] = info.objects;
  assert.deepEqual([row.name, row.instances, row.triangles, row.mirrored], ['Würfel', 1, 12, false]);
  assert.deepEqual(row.size.map((v) => Math.round(v * 1e6) / 1e6), [10, 10, 10]);
  assert.ok(near(row.volume, 1000));
});

test('3mf: the unit of the file is converted to millimetres', () => {
  const { tris, info } = parsed('zoll.3mf');
  const { V, F } = weldMesh(tris);
  assert.ok(near(signedVolume(V, F), 254 ** 3, 1e-9), 'ten inches is 254 mm: 16 387 064 mm³');
  assert.equal(info.unit, 'inch');
  assert.equal(info.unitName, 'Zoll');
  assert.equal(info.unitFactor, 25.4);
  assert.ok(near(info.objects[0].size[0], 254, 1e-9));
});

test('3mf: instances in the build list are bodies of their own', () => {
  const { info, tris } = parsed('zwei-instanzen.3mf');
  assert.equal(tris.length / 9, 24);
  assert.equal(info.objects.length, 1, 'one object …');
  assert.equal(info.objects[0].instances, 2, '… used twice');
  assert.equal(info.objects[0].triangles, 12, 'triangles are counted per instance');
  const result = convert(fixture3mf('zwei-instanzen.3mf'), 'zwei-instanzen.3mf');
  assert.equal(result.components.length, 2);
  assert.ok(near(result.components.reduce((s, c) => s + c.brepVolume, 0), 2000, 1e-9));
});

test('3mf: components are nested and transformed in the order p · component · item', () => {
  const { info, tris } = parsed('komponenten.3mf');
  // Gruppe = Paar (two cubes) + one cube scaled by 0.5 and moved to x = 50, then the item moves y by 100.
  assert.equal(tris.length / 9, 36);
  const [row] = info.objects;
  assert.equal(row.name, 'Gruppe');
  assert.ok(near(row.volume, 2125), `2 · 1000 + 0.5³ · 1000 = 2125, got ${row.volume}`);
  assert.deepEqual(row.size.map((v) => Math.round(v * 1e6) / 1e6), [55, 10, 10], 'x runs from 0 to 55, y and z are one cube');
  let minY = Infinity;
  for (let i = 1; i < tris.length; i += 3) minY = Math.min(minY, tris[i]);
  assert.equal(minY, 100, 'the item transform is applied last');
});

test('3mf: a mirrored object keeps a positive volume and is reported', () => {
  const { info, warnings } = parsed('gespiegelt.3mf');
  assert.ok(info.objects[0].mirrored);
  assert.ok(near(info.objects[0].volume, 1000), 'without turning the triangles round the volume would be −1000');
  assert.ok(warnings.some((w) => /gespiegelt/.test(w)), warnings.join(' | '));
  assert.ok(near(meshVolume('gespiegelt.3mf'), 1000));
});

test('3mf: supports and parts marked not printable are left out, each one named', () => {
  const { info, tris } = parsed('stuetzen-und-nicht-druckbar.3mf');
  assert.equal(tris.length / 9, 12, 'only the part itself');
  assert.deepEqual(info.objects.map((o) => o.name), ['Bauteil']);
  assert.equal(info.skipped.length, 2);
  assert.ok(info.skipped.some((s) => /Stütze.*Typ „support“/.test(s)), info.skipped.join(' | '));
  assert.ok(info.skipped.some((s) => /Ausgeblendet.*nicht druckbar/.test(s)));
});

test('3mf (Bambu layout): parts in other model files, names, plates, negative parts and modifiers', () => {
  const { info, tris } = parsed('bambu-stil.3mf');
  assert.equal(info.slicer, 'Bambu Studio');
  assert.equal(tris.length / 9, 532, 'only the normal part: the plate');
  const [row] = info.objects;
  assert.equal(row.name, 'Gehäuse & Deckel', 'the name comes from model_settings.config, entities decoded');
  assert.equal(row.plate, '1');
  assert.ok(near(row.volume, 7401.8573, 1e-6));
  assert.equal(info.skipped.length, 2);
  assert.ok(info.skipped.some((s) => /Negativteil.*NICHT vom Körper abgezogen/.test(s)), info.skipped.join(' | '));
  assert.ok(info.skipped.some((s) => /Modifizierer/.test(s)));
  assert.equal(info.files, 2, 'the main model and the file of the part');
});

test('3mf (PrusaSlicer layout): modifier volumes inside the mesh are not printed', () => {
  const { info, tris } = parsed('prusa-stil.3mf');
  assert.equal(info.slicer, 'PrusaSlicer');
  assert.equal(tris.length / 9, 532, '544 triangles in the mesh, the 12 of the modifier are skipped');
  assert.equal(info.objects[0].name, 'Platte mit Modifizierer');
  assert.ok(near(info.objects[0].volume, 7401.8573, 1e-6));
  assert.ok(info.skipped.some((s) => /Modifizierer \(12 Dreiecke\)/.test(s)), info.skipped.join(' | '));
});

// --- errors, one by one --------------------------------------------------------

test('3mf: every way a file can be broken gets a German message', () => {
  const cube = meshOfFixture('wuerfel.stl');
  const good = make3mf({ objects: [{ id: 1, mesh: cube }], items: [{ id: 1 }] });
  const read = (bytes, name = 'x.3mf') => parseMesh(asBuffer(bytes), name);

  assert.throws(() => read(good.subarray(0, good.length - 30)), /abgeschnitten|Verzeichnis/, 'cut off');
  assert.throws(() => read(make3mf({ objects: [{ id: 1, mesh: cube }], items: [{ id: 1 }] }, [], { corruptCrc: '3D/3dmodel.model' })), /Prüfsumme/, 'checksum');
  assert.throws(() => read(zipFiles([{ name: 'readme.txt', data: 'kein Modell' }])), /3dmodel\.model.*fehlt/, 'no model file');
  assert.throws(() => read(new TextEncoder().encode('solid x\nendsolid x\n'), 'datei.3mf'), /kein ZIP/, 'not an archive');
  assert.throws(() => read(make3mf({ objects: [{ id: 1, type: 'support', mesh: cube }], items: [{ id: 1 }] })), /keine druckbare Geometrie/, 'only supports');
  assert.throws(() => read(make3mf({ objects: [], items: [] })), /keine druckbare Geometrie/, 'nothing at all');
  assert.throws(() => read(zipFiles([{ name: '3D/3dmodel.model', data: 'das ist kein XML' }])), /keine druckbare Geometrie/, 'no XML');
});

test('3mf: a zip is a 3MF whatever its name says', () => {
  const bytes = make3mf({ objects: [{ id: 1, mesh: meshOfFixture('wuerfel.stl') }], items: [{ id: 1 }] });
  assert.equal(parseMesh(asBuffer(bytes), 'umbenannt.stl').info.format, '3mf');
});

test('3mf: odd content is read as far as it goes and the rest is named', () => {
  const cube = meshOfFixture('wuerfel.stl');
  const read = (model, extra) => parseMesh(asBuffer(make3mf(model, extra)), 'x.3mf');

  const badIndex = modelXml({ objects: [{ id: 1, mesh: cube }], items: [{ id: 1 }] }).replace('v1="0"', 'v1="9999"');
  const a = read(badIndex);
  assert.ok(a.warnings.some((w) => /verweis(t|en) auf nicht vorhandene Punkte/.test(w)), a.warnings.join(' | '));
  assert.equal(a.tris.length / 9, 11);

  const unit = modelXml({ unit: 'furlong', objects: [{ id: 1, mesh: cube }], items: [{ id: 1 }] });
  assert.ok(read(unit).warnings.some((w) => /Unbekannte Einheit „furlong“/.test(w)));

  const noBuild = modelXml({ objects: [{ id: 1, mesh: cube }], items: [] });
  const b = read(noBuild);
  assert.equal(b.tris.length / 9, 12, 'without a build list every model object is taken');
  assert.ok(b.warnings.some((w) => /keine Bauliste/.test(w)));

  const missingFile = modelXml({ objects: [{ id: 1, mesh: cube }, { id: 2, components: [{ id: 1, path: '/3D/Objects/fehlt.model' }] }], items: [{ id: 1 }, { id: 2 }] });
  assert.ok(read(missingFile).warnings.some((w) => /fehlt\.model.*fehlt/.test(w)));

  const missingObject = modelXml({ objects: [{ id: 1, mesh: cube }], items: [{ id: 1 }, { id: 7 }] });
  assert.ok(read(missingObject).warnings.some((w) => /Objekt 7.*fehlt/.test(w)));

  const beam = modelXml({ objects: [{ id: 1, mesh: cube }], items: [{ id: 1 }] }).replace('<mesh>', '<mesh><b:beamlattice xmlns:b="x"><b:beams/></b:beamlattice>');
  assert.ok(read(beam).warnings.some((w) => /Gitterstäbe/.test(w)));
});

test('3mf: components that refer to each other end in a message, not in a hang', () => {
  const xml = modelXml({
    objects: [
      { id: 1, mesh: meshOfFixture('wuerfel.stl') },
      { id: 2, components: [{ id: 3 }, { id: 1 }] },
      { id: 3, components: [{ id: 2 }] },
    ],
    items: [{ id: 2 }],
  });
  const result = parseMesh(asBuffer(make3mf(xml)), 'x.3mf');
  assert.equal(result.tris.length / 9, 12, 'the cube is still there once');
  assert.ok(result.warnings.some((w) => /verweisen im Kreis/.test(w)), result.warnings.join(' | '));
});

// --- through the pipeline ------------------------------------------------------

test('pipeline: platte.3mf gives the same result as platte.stl', () => {
  const fromStl = convert(loadFixture('platte.stl'), 'platte.stl');
  const fromThreeMf = convert(fixture3mf('platte.3mf'), 'platte.3mf');
  const [a, b] = [fromStl.components[0], fromThreeMf.components[0]];
  assert.equal(b.tier, 3);
  assert.equal(b.counts.faces, 14);
  assert.deepEqual(b.counts, a.counts);
  assert.equal(b.brepVolume, a.brepVolume);
  assert.equal(fromThreeMf.triangles, fromStl.triangles);
  assert.equal(fromThreeMf.source.format, '3mf');
  assert.equal(fromStl.source, null, 'the other formats have no source analysis');
});

test('pipeline: a unit chosen in the interface is applied on top of the unit of the file, and says so', () => {
  const plain = convert(fixture3mf('wuerfel.3mf'), 'wuerfel.3mf');
  const scaled = convert(fixture3mf('wuerfel.3mf'), 'wuerfel.3mf', { unitScale: 10 });
  assert.deepEqual(plain.warnings, []);
  assert.ok(near(scaled.meshVolume, 1000 * 10 ** 3, 1e-9));
  assert.ok(scaled.warnings.some((w) => /bringt ihre Einheit mit/.test(w)), scaled.warnings.join(' | '));
  const stl = convert(loadFixture('wuerfel.stl'), 'wuerfel.stl', { unitScale: 10 });
  assert.ok(!stl.warnings.some((w) => /3MF/.test(w)), 'no such note for STL');
});

test('pipeline: a broken mesh inside a 3MF is repaired like any other', () => {
  const result = convert(fixture3mf('defekt-loch.3mf'), 'defekt-loch.3mf');
  assert.equal(result.healReport.holesFilled, 3);
  assert.equal(result.repair.after.watertight, true);
  assert.equal(result.components[0].tier, 3);
});

test('pipeline: Bambu and Prusa layouts reach a solid and write a STEP file', () => {
  for (const name of ['bambu-stil.3mf', 'prusa-stil.3mf', 'komponenten.3mf', 'gespiegelt.3mf', 'zoll.3mf']) {
    const result = convert(fixture3mf(name), name);
    assert.ok(result.components.every((c) => c.tier !== 'offen'), `${name}: a solid`);
    const text = writeStep(result.components[0].brep, { name });
    assert.ok(text.startsWith('ISO-10303-21;') && /MANIFOLD_SOLID_BREP/.test(text), name);
  }
});

test('pipeline: the analysis survives the hand-over to the interface', () => {
  const result = convert(fixture3mf('bambu-stil.3mf'), 'bambu-stil.3mf');
  const plain = JSON.parse(JSON.stringify(toTransferable(result)));
  assert.equal(plain.source.slicer, 'Bambu Studio');
  assert.equal(plain.source.objects[0].name, 'Gehäuse & Deckel');
  assert.equal(plain.source.skipped.length, 2);
  assert.ok(plain.source.skipped.some((s) => /Negativteil/.test(s)), 'what was left out reaches the interface with its reason');
});

test('pipeline: a 3MF with thousands of triangles is read quickly', () => {
  const big = meshOfFixture('platte-unterteilt2.stl');
  const bytes = make3mf({ objects: [{ id: 1, mesh: big }], items: [{ id: 1 }, { id: 1, transform: move(100, 0, 0) }] });
  const start = performance.now();
  const { tris } = parseMesh(asBuffer(bytes), 'gross.3mf');
  const ms = performance.now() - start;
  assert.equal(tris.length / 9, 2 * big.F.length / 3);
  assert.ok(ms < 3000, `${Math.round(ms)} ms for ${tris.length / 9} triangles`);
});
