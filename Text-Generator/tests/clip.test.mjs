// Cable clips: a ring that does not close, bent from the same wall a cup
// uses. The cable runs through it, the lettering sits on the outside.

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDoc } from '../js/core/document.js';
import { buildModel } from '../js/core/model.js';
import { clipCup } from '../js/core/cup.js';
import { modelMeshes } from '../js/export/mesh.js';
import { exportSTEP } from '../js/export/step.js';
import { loadFonts, font, meshCheck } from './helpers.mjs';

const lib = await loadFonts();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const clip = (patch = {}) => buildModel(normalizeDoc({
  texts: [{ text: 'X1:1', font: font('montserrat'), size: 4, ...(patch.text || {}) }],
  base: { shape: 'clip' },
  clip: { cable: 7, play: 0.2, opening: 95, length: 14, ...(patch.clip || {}) },
  body: { relief: 'raised', thickness: 1.2, height: 0.6, ...(patch.body || {}) },
}), (ref) => lib.peek(ref));

/** Radii, heights and the angle the mesh covers around the axis. */
function extent(mesh) {
  const p = mesh.positions;
  const out = { rMin: Infinity, rMax: 0, zMin: Infinity, zMax: -Infinity, aMax: 0 };
  for (let i = 0; i < mesh.triangles * 9; i += 3) {
    const r = Math.hypot(p[i], p[i + 1]);
    out.rMin = Math.min(out.rMin, r);
    out.rMax = Math.max(out.rMax, r);
    out.zMin = Math.min(out.zMin, p[i + 2]);
    out.zMax = Math.max(out.zMax, p[i + 2]);
    // x = 0 at the front, the opening lies at the back.
    out.aMax = Math.max(out.aMax, Math.abs((Math.atan2(p[i], -p[i + 1]) * 180) / Math.PI));
  }
  return out;
}

test('the clip is measured by its cable: inner width, wall and opening', () => {
  const cable = 7;
  const play = 0.2;
  const wall = 1.2;
  const m = clip();
  // The cup it is built from: inside the cable with play, outside one wall further.
  const cup = clipCup({ cable, play, opening: 95, length: 14 }, wall);
  near(cup.diameter, cable + 2 * play + 2 * wall, 1e-9, 'outer diameter');
  assert.equal(cup.bottom, 0, 'a clip has no floor');
  assert.equal(cup.conical, false);

  const plate = modelMeshes(m).find((x) => x.part.id === 'base');
  const e = extent(plate);
  near(2 * e.rMin, cable + 2 * play, 0.02, 'the cable fits inside');
  near(2 * e.rMax, cable + 2 * play + 2 * wall, 0.02, 'outside');
  near(e.zMax - e.zMin, 14, 1e-6, 'length along the cable');
  // 95° missing of 360° leaves 132.5° to either side of the front.
  near(e.aMax, (360 - 95) / 2, 0.5, 'half the covered angle');
  assert.equal(m.cup.open, true);
  assert.equal(m.cup.floor, 0);
  assert.ok(!m.parts.some((p) => p.id === 'floor'), 'no floor part');
});

test('the opening stays open, and only a narrow one holds the cable', () => {
  // The gap between the two ends, measured inside. The clip holds only
  // while that gap is narrower than the cable, so it has to spring over it.
  const gapOf = (e, opening) => 2 * e.rMin * Math.sin((opening * Math.PI) / 360);
  for (const opening of [40, 95]) {
    const m = clip({ clip: { opening } });
    const e = extent(modelMeshes(m).find((x) => x.part.id === 'base'));
    near(e.aMax, (360 - opening) / 2, 0.5, `opening ${opening}°`);
    assert.ok(gapOf(e, opening) < 7, `opening ${opening}°: gap vs cable 7 mm`);
  }
  // Wide open the gap grows past the cable: the clip would fall off, and
  // the model says so instead of quietly building it.
  const wide = clip({ clip: { opening: 150 } });
  const e = extent(modelMeshes(wide).find((x) => x.part.id === 'base'));
  near(e.aMax, (360 - 150) / 2, 0.5, 'opening 150°');
  assert.ok(gapOf(e, 150) > 7, 'gap wider than the cable');
  assert.ok(wide.warnings.some((w) => w.includes('hält nicht')), wide.warnings.join(' | '));
});

test('clips are closed bodies whose volume matches the model', () => {
  const cases = [
    clip(),
    clip({ clip: { cable: 3.2, play: 0.2, opening: 100, length: 10 }, body: { thickness: 0.9 }, text: { size: 3, rotation: 90 } }),
    clip({ clip: { cable: 12, play: 0.3, opening: 95, length: 16 }, body: { thickness: 1.6 } }),
    clip({ body: { relief: 'engraved', thickness: 2 } }),
    clip({ body: { border: true, borderWidth: 1.2, borderHeight: 0.6 } }),
  ];
  for (const [i, m] of cases.entries()) {
    assert.ok(m.parts.length, `case ${i}: has parts`);
    for (const mesh of modelMeshes(m)) {
      const { badEdges, volume } = meshCheck(mesh.positions, mesh.triangles);
      assert.equal(badEdges, 0, `case ${i} / ${mesh.part.name}: closed`);
      near(volume, mesh.part.volume, 1e-3 * mesh.part.volume, `case ${i} / ${mesh.part.name}: volume`);
    }
  }
});

test('the lettering sits outside the wall and may reach both ends', () => {
  const m = clip({ text: { text: 'HDMI 1', size: 5 } });
  const meshes = modelMeshes(m);
  const wall = extent(meshes.find((x) => x.part.id === 'base'));
  const text = extent(meshes.find((x) => x.part.id === 'text'));
  near(text.rMin, wall.rMax, 0.02, 'the lettering starts at the outside');
  assert.ok(text.rMax > wall.rMax, 'and stands proud of it');
  // A cup keeps its lettering clear of the seam; a clip is open there, so
  // the letters may run all the way to the ends.
  const wide = clip({ text: { text: 'ABCDEFGHIJKL', size: 4 } });
  const t = extent(modelMeshes(wide).find((x) => x.part.id === 'text'));
  const w = extent(modelMeshes(wide).find((x) => x.part.id === 'base'));
  assert.ok(t.aMax > w.aMax - 1.5, `lettering reaches the end: ${t.aMax} vs ${w.aMax}`);
});

test('a clip warns about a stiff wall and about a useless opening', () => {
  const stiff = clip({ clip: { cable: 2 }, body: { thickness: 1.6 } });
  assert.ok(stiff.warnings.some((w) => w.includes('federt kaum')), stiff.warnings.join(' | '));
  const narrow = clip({ clip: { opening: 40 } });
  assert.ok(narrow.warnings.some((w) => w.includes('aufschnappen')), narrow.warnings.join(' | '));
  const loose = clip({ clip: { opening: 150 } });
  assert.ok(loose.warnings.some((w) => w.includes('hält nicht')), loose.warnings.join(' | '));
  assert.equal(clip().warnings.length, 0, 'the default clip is fine');
  // No mount, magnets or back on a clip – the panels hide them, the model
  // drops them with a word.
  const back = clip({ text: { side: 'back' } });
  assert.ok(back.warnings.some((w) => w.includes('Kabelclip')), back.warnings.join(' | '));
});

test('STEP of a clip: one wall, letters of their own, no floor', () => {
  const text = exportSTEP(clip({ text: { text: 'L1' } }), { title: 'Clip' });
  assert.match(text, /^ISO-10303-21;/);
  assert.ok(text.includes('CYLINDRICAL_SURFACE'), 'the wall lies on a cylinder');
  assert.ok(!/PRODUCT\('Boden'/.test(text), 'no floor part');
  const shells = (text.match(/CLOSED_SHELL/g) || []).length;
  assert.ok(shells >= 2, `${shells} shells`);
});
