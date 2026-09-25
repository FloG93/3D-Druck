// Stamps: mirrored lettering, sloped flanks, the socket in the back and the
// handle as an object of its own.

import test from 'node:test';
import assert from 'node:assert/strict';

import { regionArea, regionBounds, offset } from '../js/core/geometry.js';
import { normalizeDoc, STAMP_KINDS, STAMP_KIND_DEFAULTS } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { BUILTIN_PRESETS } from '../js/core/presets.js';
import { modelMeshes } from '../js/export/mesh.js';
import { build3MF } from '../js/export/threemf.js';
import { loadFonts, font, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const getFace = (ref) => lib.peek(ref);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const build = (patch = {}, kind = 'ink') => {
  const k = STAMP_KIND_DEFAULTS[kind];
  return buildModel(normalizeDoc({
    texts: [{ text: 'Danke', font: font('roboto'), size: 12 }],
    base: { shape: 'rect', padding: 3, radius: 2 },
    mount: { type: 'none' },
    body: { ...k.body },
    check: k.check,
    ...patch,
    stamp: { enabled: true, kind, ...k.stamp, ...patch.stamp },
  }), getFace);
};
const assertSolid = (m, label) => {
  for (const mesh of modelMeshes(m)) {
    const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
    assert.equal(badEdges, 0, `${label} / ${mesh.part.name}: closed`);
    near(volume, mesh.part.volume, Math.max(1e-3 * mesh.part.volume, 0.05), `${label} / ${mesh.part.name}: volume`);
  }
};

test('a stamp mirrors the lettering', () => {
  const plain = build({ stamp: { enabled: false } });
  const stamp = build();
  assert.equal(plain.mirrored, false);
  assert.equal(stamp.mirrored, true);
  near(regionArea(stamp.text), regionArea(plain.text), 1e-6, 'same lettering');
  const a = regionBounds(plain.text);
  const b = regionBounds(stamp.text);
  near(b.minX, -a.maxX, 1e-9, 'mirrored left edge');
  near(b.maxX, -a.minX, 1e-9, 'mirrored right edge');
});

test('stamp plate with a socket, handle with a matching peg', () => {
  const m = build();
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.parts.map((p) => p.name), ['Platte', 'Schrift', 'Griff']);
  assertSolid(m, 'ink stamp');
  // Socket in the back, the peg a little smaller all around.
  const plate = m.parts.find((p) => p.id === 'base').solids[0];
  const socket = plate.bottom.find((b) => b.region === m.socket);
  assert.ok(socket, 'socket in the bottom');
  near(socket.depth, 2, 1e-9, 'socket depth (3 mm plate, 1 mm stays)');
  const handle = m.parts.find((p) => p.id === 'handle');
  const { peg } = handle.solids[0];
  const s = regionBounds(m.socket);
  const p = regionBounds([{ outer: peg.ring, holes: [] }]);
  near((s.maxX - s.minX) - (p.maxX - p.minX), 2 * 0.15, 1e-6, 'clearance per side');
  near(peg.depth, socket.depth - 0.3, 1e-9, 'peg shorter than the socket');
  // The socket lies in the middle of the plate, inside it with a wall.
  assert.ok(regionArea(offset(m.socket, 1)) > 0);
  // Printed upside down: flat top on the bed, peg on top.
  const mesh = modelMeshes(m).find((x) => x.part.id === 'handle');
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 2; i < mesh.positions.length; i += 3) {
    minZ = Math.min(minZ, mesh.positions[i]);
    maxZ = Math.max(maxZ, mesh.positions[i]);
  }
  near(minZ, 0, 1e-4, 'on the bed');
  near(maxZ, m.stamp.handle.height + peg.depth, 1e-4, 'peg on top');
  // Beside the stamp, not on it.
  assert.ok(handle.solids[0].at[0] - m.stamp.handle.diameter / 2 > m.bounds.maxX);
  // Two objects in the 3MF: the stamp and the handle.
  const three = build3MF(modelMeshes(m), { title: 'Danke' });
  assert.equal(three.objects, 2);
  assert.match(three.config, /<metadata key="name" value="Griff"\/>/);
  // The height of the stamp does not count the handle.
  near(m.stats.top, 3 + 1.5, 1e-9, 'stamp height');
});

test('sloped flanks: the letters widen towards the plate', () => {
  const m = build({}, 'cookie');
  assert.equal(m.stamp.draft, 10);
  assertSolid(m, 'cookie stamp');
  const solid = m.parts.find((p) => p.id === 'text').solids[0];
  assert.ok(solid.steps.length >= 5, `steps: ${solid.steps.length}`);
  const top = solid.steps[solid.steps.length - 1].region;
  near(regionArea(top), regionArea(m.text), 1e-6, 'stamping face = lettering');
  const grow = 2.5 * Math.tan((10 * Math.PI) / 180);
  const wide = regionBounds(solid.region);
  const face = regionBounds(top);
  near(face.minX - wide.minX, grow, 0.02, 'wider at the base by h·tan(α)');
  for (let i = 1; i < solid.steps.length; i++) {
    assert.ok(regionArea(solid.steps[i].region) < regionArea(solid.steps[i - 1].region), 'each step narrower');
    assert.ok(solid.steps[i].z > solid.steps[i - 1].z, 'going up');
  }
  // No flanks without a draft; engraved stamps have none either.
  const straight = build({ stamp: { draft: 0 } }, 'cookie');
  assert.equal(straight.parts.find((p) => p.id === 'text').solids[0].steps, undefined);
  const engraved = build({ body: { relief: 'engraved', thickness: 4, height: 1.5 } }, 'cookie');
  assert.equal(engraved.stamp.draft, 0);
  assertSolid(engraved, 'engraved stamp');
});

test('stamps: no back, no magnets, raised or engraved only', () => {
  const m = build({
    texts: [{ text: 'Vorne', font: font('roboto'), size: 10 }, { text: 'Hinten', font: font('roboto'), size: 5, side: 'back' }],
    magnets: { enabled: true },
    body: { relief: 'flush', thickness: 3, height: 0.6 },
  });
  assert.ok(m.warnings.some((w) => w.includes('Griff – die Blöcke hinten entfallen')));
  assert.ok(m.warnings.some((w) => w.includes('keine Magnet-Taschen')));
  assert.ok(m.warnings.some((w) => w.includes('hier erhaben')));
  assert.equal(m.relief, 'raised');
  assert.equal(m.backText.length, 0);
  assert.equal(m.magnets.length, 0);
  // Too thin for a socket: the handle is glued on flat.
  const thin = build({ body: { relief: 'raised', thickness: 1.6, height: 1 } });
  assert.equal(thin.socket.length, 0);
  assert.equal(thin.parts.find((p) => p.id === 'handle').solids[0].peg, null);
  assertSolid(thin, 'flat handle');
  // Without a handle.
  const bare = build({ stamp: { handle: false } });
  assert.equal(bare.parts.some((p) => p.id === 'handle'), false);
  assert.equal(bare.socket.length, 0);
});

test('stamp kinds and presets', () => {
  assert.deepEqual(STAMP_KINDS, ['ink', 'cookie', 'clay']);
  for (const kind of STAMP_KINDS) {
    const d = STAMP_KIND_DEFAULTS[kind];
    assert.ok(d.body.height >= 1 && d.body.thickness >= 3 && d.check.minStroke >= 0.8, kind);
  }
  const names = ['Tinten-Stempel', 'Keksstempel', 'Seifenstempel'];
  for (const name of names) {
    const m = buildModel(normalizeDoc(BUILTIN_PRESETS.find((p) => p.name === name)), getFace);
    assert.ok(m.stamp && m.stamp.handle, `${name}: stamp with handle`);
    assert.equal(m.stats.thinCount, 0, `${name}: thin`);
    assertSolid(m, name);
  }
});
