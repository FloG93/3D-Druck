// QR codes, imported graphics (SVG) and lettering on the back.

import test from 'node:test';
import assert from 'node:assert/strict';

import { regionArea, regionBounds, intersection, circleRing, union } from '../js/core/geometry.js';
import { defaultDoc, normalizeDoc, createBlock } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { qrBlock, qrContent, graphicBlock } from '../js/core/blocks.js';
import { parseSVG, parsePathData, parseTransform } from '../js/core/svgimport.js';
import { qrMatrix, wifiPayload } from '../../shared/js/qr.js';
import { modelMeshes } from '../js/export/mesh.js';
import { loadFonts, font, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const getFace = (ref) => lib.peek(ref);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const doc = (patch = {}) => {
  const d = defaultDoc();
  for (const [k, v] of Object.entries(patch)) d[k] = k === 'texts' ? v : { ...d[k], ...v };
  return normalizeDoc(d);
};
const build = (patch) => buildModel(doc(patch), getFace);

function assertSolid(m, label) {
  assert.ok(m.parts.length, `${label}: no parts`);
  for (const mesh of modelMeshes(m)) {
    const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
    assert.equal(badEdges, 0, `${label} / ${mesh.part.name}: open edges`);
    near(volume, mesh.part.volume, Math.max(2e-3 * mesh.part.volume, 0.05), `${label} / ${mesh.part.name}: volume`);
  }
}

// --- QR codes ------------------------------------------------------------------

test('Wi-Fi QR text escapes special characters', () => {
  assert.equal(wifiPayload('Mein;Netz', 'pa:ss,wo"rd\\', 'WPA'), 'WIFI:T:WPA;S:Mein\\;Netz;P:pa\\:ss\\,wo\\"rd\\\\;;');
  assert.equal(wifiPayload('Gast', 'egal', 'nopass'), 'WIFI:T:nopass;S:Gast;;');
  assert.equal(wifiPayload('Versteckt', 'x', 'WEP', true), 'WIFI:T:WEP;S:Versteckt;P:x;H:true;;');
  const b = createBlock('qr', { qrMode: 'wifi', wifiSsid: 'Zuhause', wifiPassword: 'geheim123' });
  assert.equal(qrContent(b), 'WIFI:T:WPA;S:Zuhause;P:geheim123;;');
  assert.equal(qrContent({ ...b, wifiSsid: '' }), '');
});

test('QR block: modules as one region, quiet zone in the footprint', () => {
  const b = createBlock('qr', { qrText: 'https://flog93.github.io/3D-Druck/', size: 25, x: 3, y: -2 });
  const q = qrBlock(b);
  const matrix = qrMatrix(q.content, 'M');
  assert.equal(q.modules, matrix.size);
  near(q.module, 25 / matrix.size, 1e-12, 'module size');
  const dark = matrix.cells.reduce((n, c) => n + c, 0);
  near(regionArea(q.region), dark * q.module ** 2, 0.02 * dark * q.module ** 2, 'dark area');
  const r = regionBounds(q.region);
  near(r.minX, 3 - 12.5, 1e-3, 'left edge');
  near(r.maxY, -2 + 12.5, 1e-3, 'top edge');
  const f = regionBounds(q.footprint);
  near(f.maxX - f.minX, 25 + 4 * q.module, 1e-3, 'quiet zone of 2 modules');
  // Too much for a QR code: a German error message, no region.
  const long = qrBlock(createBlock('qr', { qrText: 'x'.repeat(3000), qrLevel: 'H' }));
  assert.equal(long.region.length, 0);
  assert.match(long.error, /zu lang/);
});

test('QR with round dots and a logo in the middle', () => {
  const text = 'https://flog93.github.io/3D-Druck/';
  const square = qrBlock(createBlock('qr', { qrText: text, size: 30 }));
  const dots = qrBlock(createBlock('qr', { qrText: text, size: 30, qrStyle: 'dots', qrDot: 0.8 }));
  // Same code, smaller dark area; the three finder patterns stay solid.
  assert.equal(dots.modules, square.modules);
  assert.ok(regionArea(dots.region) < regionArea(square.region) * 0.85);
  const m = dots.module;
  const corner = [[-15, 15 - 7 * m, -15 + 7 * m, 15 - 7 * m, -15 + 7 * m, 15, -15, 15]];
  near(regionArea(intersection(dots.region, union(corner))), regionArea(intersection(square.region, union(corner))), 1e-3, 'finder pattern solid');
  // Logo: error correction H, the middle is cleared except for the logo.
  const logo = [{ outer: circleRing(0, 0, 1), holes: [] }];
  const withLogo = qrBlock(createBlock('qr', { qrText: text, size: 30, qrLevel: 'L', qrLogo: 'symbol', qrLogoSymbol: '♥', qrLogoSize: 0.24 }), { logo });
  assert.equal(withLogo.level, 'H');
  const plain = qrBlock(createBlock('qr', { qrText: text, size: 30, qrLevel: 'H' }));
  assert.equal(withLogo.modules, plain.modules);
  const k = regionBounds(intersection(withLogo.region, union([[-4, -4, 4, -4, 4, 4, -4, 4]])));
  // Only the fitted logo (a circle) remains in the middle.
  near(k.maxX - k.minX, k.maxY - k.minY, 1e-3, 'round logo');
  assert.ok(k.maxX - k.minX < 30 * 0.24, 'logo inside the cleared square');
});

test('QR sign: plate covers the quiet zone, closed meshes, warnings', () => {
  const qr = createBlock('qr', { qrMode: 'wifi', wifiSsid: 'Zuhause', wifiPassword: 'geheim123', size: 30, y: -6 });
  const title = { text: 'WLAN', font: font('montserrat'), size: 8, y: 16 };
  for (const relief of ['raised', 'flush']) {
    const m = build({ base: { shape: 'rect', padding: 3 }, texts: [title, qr], body: { relief, thickness: 2.4, height: 0.6 }, colors: { base: '#ffffff', text: '#111111' } });
    assert.deepEqual(m.warnings, [], `${relief}: ${m.warnings.join(' | ')}`);
    const lay = m.layouts.find((l) => l.block.kind === 'qr');
    const quiet = intersection(lay.worldFootprint, m.base);
    near(regionArea(quiet), regionArea(lay.worldFootprint), 0.01, `${relief}: quiet zone on the plate`);
    assertSolid(m, `qr ${relief}`);
  }
  // Dots and a logo from the symbol font still give closed meshes.
  // (error correction H: more modules, so the code is made a bit larger)
  const fancy = build({ base: { shape: 'rect' }, texts: [{ ...qr, size: 36, qrStyle: 'dots', qrLogo: 'symbol', qrLogoSymbol: '🐾' }], colors: { base: '#ffffff', text: '#111111' } });
  assert.deepEqual(fancy.warnings, [], fancy.warnings.join(' | '));
  assert.equal(fancy.layouts[0].qr.level, 'H');
  assertSolid(fancy, 'qr dots + logo');
  const tiny = build({ base: { shape: 'rect' }, texts: [{ ...qr, size: 12 }] });
  assert.ok(tiny.warnings.some((w) => w.includes('Module')), tiny.warnings.join(' | '));
  const inverted = build({ base: { shape: 'rect' }, texts: [qr], colors: { base: '#111111', text: '#ffffff' } });
  assert.ok(inverted.warnings.some((w) => w.includes('Heller QR-Code')));
  const engraved = build({ base: { shape: 'rect' }, texts: [qr], body: { relief: 'engraved' } });
  assert.ok(engraved.warnings.some((w) => w.includes('Kontrast')));
  const overlap = build({ base: { shape: 'rect' }, texts: [qr, { ...title, y: -6 }] });
  assert.ok(overlap.warnings.some((w) => w.includes('ragt in den QR-Code')));
});

// --- graphics ------------------------------------------------------------------

test('SVG path data: relative commands, curves and arcs', () => {
  const [p] = parsePathData('m10 10 h20 v20 h-20 z');
  assert.deepEqual(p.start, [10, 10]);
  assert.deepEqual(p.segs, [[30, 10], [30, 30], [10, 30]]);
  assert.equal(p.closed, true);
  // A full circle of radius 5 from two arcs, compact flags ("0 01").
  const [c] = parsePathData('M0 5a5 5 0 0 1 10 0a5 5 0 01-10 0Z');
  assert.equal(c.segs.length, 4);
  const end = c.segs[c.segs.length - 1];
  near(end[4], 0, 1e-9, 'arc end x');
  near(end[5], 5, 1e-9, 'arc end y');
  // Transforms: rotate about a point, then translate.
  const m = parseTransform('translate(10 0) rotate(90 5 5)');
  const x = m[0] * 10 + m[2] * 5 + m[4];
  const y = m[1] * 10 + m[3] * 5 + m[5];
  near(x, 15, 1e-9, 'rotated x');
  near(y, 10, 1e-9, 'rotated y');
});

const LOGO = `<?xml version="1.0"?>
<!DOCTYPE svg>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
  <style>.dark { fill: #202020 } .none { fill: none }</style>
  <defs><circle id="dot" r="5"/></defs>
  <rect class="dark" x="0" y="0" width="100" height="100"/>
  <rect x="25" y="25" width="50" height="50" fill="white"/>
  <use xlink:href="#dot" x="50" y="50"/>
  <text x="0" y="0">Hallo</text>
</svg>`;

test('SVG import: painter order, white cuts away, use and CSS', () => {
  const g = parseSVG(LOGO, { name: 'logo.svg' });
  assert.equal(g.name, 'logo');
  assert.equal(g.shapes.length, 3);
  assert.deepEqual(g.shapes.map((s) => s.op), [1, -1, 1]);
  assert.ok(g.warnings.some((w) => w.includes('Text')));
  near(g.w, 100, 1e-6, 'normalised width');
  near(g.h, 100, 1e-6, 'normalised height');
  // 20 mm tall: 400 mm² square, 100 mm² hole, a dot of radius 1 mm.
  const block = createBlock('graphic', { graphic: g, size: 20 });
  const r = graphicBlock(block);
  near(regionArea(r.region), 400 - 100 + Math.PI, 0.05, 'area');
  const bb = regionBounds(r.region);
  near(bb.maxX - bb.minX, 20, 1e-3, 'width');
  near((bb.minY + bb.maxY) / 2, 0, 1e-3, 'centred');
  // Inverted: the white square minus the dot.
  const inv = graphicBlock({ ...block, invert: true });
  near(regionArea(inv.region), 100 - Math.PI, 0.05, 'inverted area');
});

test('SVG import: fill rules, strokes, transforms', () => {
  const svg = (body) => parseSVG(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  const ring = 'M0 0H100V100H0Z M25 25H75V75H25Z';
  const area = (g) => regionArea(graphicBlock(createBlock('graphic', { graphic: g, size: 100 })).region);
  near(area(svg(`<path d="${ring}"/>`)), 10000, 1, 'nonzero: same winding fills');
  near(area(svg(`<path d="${ring}" fill-rule="evenodd"/>`)), 7500, 1, 'evenodd: hole');
  near(area(svg(`<path style="fill-rule:evenodd" d="${ring}"/>`)), 7500, 1, 'rule from style');
  // A 100 long line, 10 wide, round ends: 1000 + π·25 (height = line width + round ends).
  const line = svg('<line x1="0" y1="0" x2="100" y2="0" stroke="#000" stroke-width="10"/>');
  assert.equal(line.shapes[0].stroke > 0, true);
  const lg = graphicBlock(createBlock('graphic', { graphic: line, size: 10 }));
  near(regionArea(lg.region), 1000 + Math.PI * 25, 2, 'stroke area');
  // Icons drawn with lines in currentColor (e.g. Lucide/Feather).
  const icon = svg('<g fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></g>');
  assert.equal(icon.shapes.length, 1);
  assert.ok(icon.shapes[0].stroke > 0);
  // Scaled group: aspect ratio is kept.
  const scaled = svg('<g transform="scale(2 1)"><rect width="10" height="10"/></g>');
  near(scaled.w / scaled.h, 2, 1e-9, 'aspect');
  assert.throws(() => parseSVG('<html></html>'), /keine SVG/);
  assert.throws(() => parseSVG('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="none"/></svg>'), /keine Formen/);
});

test('graphic on a plate: closed mesh, own colour', () => {
  const g = parseSVG(LOGO);
  const m = build({
    base: { shape: 'rect' },
    texts: [{ text: 'Team', font: font('roboto'), size: 7, y: -15 }, createBlock('graphic', { graphic: g, size: 20, y: 6, slot: 3, color: '#ff0000' })],
  });
  assert.deepEqual(m.parts.map((p) => [p.id, p.name]), [['base', 'Platte'], ['text', 'Schrift'], ['text-3', 'Grafik 2']]);
  assert.deepEqual(m.warnings, []);
  assertSolid(m, 'graphic');
});

// --- back ----------------------------------------------------------------------

const PHONE = { text: '0171 2345678', font: font('roboto'), size: 4, side: 'back' };

test('back lettering: mirrored, sunk into the bottom or inlaid', () => {
  const name = { text: 'BELLO', font: font('bebas-neue'), size: 9 };
  for (const relief of ['engraved', 'inlay']) {
    const m = build({ base: { shape: 'circle' }, texts: [name, { ...PHONE, x: 2 }], back: { relief, depth: 0.6 }, body: { thickness: 2.4 } });
    assert.ok(m.backText.length, relief);
    near(m.backDepth, 0.6, 1e-9, `${relief}: depth`);
    // Seen from the front the back reads mirrored: x of the block is flipped.
    const lay = m.layouts.find((l) => l.side === 'back');
    const bb = regionBounds(m.backText);
    near((bb.minX + bb.maxX) / 2, -(lay.bounds.minX + lay.bounds.maxX) / 2, 0.05, `${relief}: mirrored`);
    const plate = m.parts.find((p) => p.id === 'base');
    assert.equal(plate.solids[0].bottom[1].depth, 0.6);
    const ids = m.parts.map((p) => p.id);
    assert.deepEqual(ids, relief === 'inlay' ? ['base', 'text', 'back'] : ['base', 'text'], relief);
    if (relief === 'inlay') {
      const part = m.parts.find((p) => p.id === 'back');
      assert.equal(part.name, 'Rückseite');
      assert.equal(part.solids[0].z0, 0);
      near(part.volume, regionArea(m.backText) * 0.6, 1e-6, 'inlay volume');
    }
    assert.deepEqual(m.warnings, [], m.warnings.join(' | '));
    assertSolid(m, `back ${relief}`);
  }
});

test('magnets make room for the back, which leaves a floor', () => {
  // A QR code in the middle of the back: one magnet on each side of it.
  const qr = createBlock('qr', { qrText: 'Hallo', size: 24, side: 'back' });
  const m = build({
    base: { shape: 'rect', sizeMode: 'fixed', width: 80, height: 36 },
    texts: [{ text: 'Küche', font: font('pacifico'), size: 10 }, qr],
    magnets: { enabled: true, count: 2 },
    body: { thickness: 3.4 },
  });
  assert.equal(m.magnets.length, 2);
  const [a, b] = [...m.magnets].sort((p, q) => p.cx - q.cx);
  assert.ok(a.cx < -12 - 3 && b.cx > 12 + 3, `left and right of the code: ${a.cx}, ${b.cx}`);
  const lay = m.layouts.find((l) => l.qr);
  for (const c of m.magnets) {
    const zone = [circleRing(c.cx, c.cy, c.r + 1.19)];
    near(regionArea(intersection(lay.worldFootprint, zone)), 0, 1e-6, 'magnet clear of the quiet zone');
  }
  assert.deepEqual(m.warnings, []);
  assertSolid(m, 'back + magnets');
  // No room left: fewer magnets and a note.
  const full = build({
    base: { shape: 'rect' },
    texts: [{ text: 'Küche', font: font('pacifico'), size: 10 }, { ...PHONE, text: 'HALLO HALLO HALLO', size: 5 }],
    magnets: { enabled: true, count: 2 },
    body: { thickness: 3.2 },
  });
  assert.ok(full.magnets.length < 2);
  assert.ok(full.warnings.some((w) => w.includes('Magnet')));
  // Engraved front 1.2 mm on a 2 mm plate: only 0.4 mm left for the back.
  const thin = build({ base: { shape: 'rect' }, texts: [{ text: 'A', font: font('roboto'), size: 10 }, PHONE], body: { relief: 'engraved', thickness: 2, height: 1.2 } });
  near(thin.backDepth, 0.4, 1e-9, 'limited depth');
  assert.ok(thin.warnings.some((w) => w.includes('Rückseite ist nur')));
  assertSolid(thin, 'thin back');
  // Without a plate there is no back.
  const none = build({ base: { shape: 'none' }, texts: [PHONE] });
  assert.equal(none.backText.length, 0);
  assert.ok(none.warnings.some((w) => w.includes('keine Rückseite')));
});

test('documents from before keep working (text blocks without kind)', () => {
  const d = normalizeDoc({ texts: [{ text: 'Alt' }] });
  assert.equal(d.texts[0].kind, 'text');
  assert.equal(d.texts[0].side, 'front');
  assert.equal(d.back.relief, 'inlay');
  const q = normalizeDoc({ texts: [{ kind: 'qr', qrLevel: 'Z', size: -1, side: 'hinten' }] }).texts[0];
  assert.equal(q.qrLevel, 'M');
  assert.equal(q.size, 3);
  assert.equal(q.side, 'front');
  const g = normalizeDoc({ texts: [{ kind: 'graphic', graphic: { shapes: [{ d: 'M0 0L1 0L1 1Z', op: -5 }, { d: 42 }] } }] }).texts[0];
  assert.equal(g.graphic.shapes.length, 1);
  assert.equal(g.graphic.shapes[0].op, -1);
  assert.equal(normalizeDoc({ texts: [{ kind: 'graphic', graphic: 'kaputt' }] }).texts[0].graphic, null);
  // Blocks are a union of what the plate has to carry.
  assert.ok(union([]).length === 0);
});
