// The corpus itself: every entry of expected.json has a file, every file an
// entry. Guards against a fixture that is added but never measured.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FIXTURE_DIR, FIXTURES, expected, loadFixture, meshStats, signedVolume, componentCount } from './helpers.mjs';

test('corpus: 23 files, every file has ground truth', () => {
  const names = FIXTURES();
  assert.equal(names.length, 23);
  const onDisk = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.stl') || f.endsWith('.obj'));
  assert.deepEqual(onDisk.slice().sort(), names.slice().sort());
  for (const name of names) {
    assert.ok(loadFixture(name).byteLength > 0, `${name} is empty`);
    const exp = expected(name);
    assert.ok(exp.beschreibung, `${name} without description`);
    assert.ok(exp.volumen > 0, `${name} without exact volume`);
  }
});

test('helpers: statistics of a hand-made tetrahedron', () => {
  // Unit tetrahedron (0,0,0), (1,0,0), (0,1,0), (0,0,1), triangles facing outwards.
  const V = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const F = Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const stats = meshStats(V, F);
  assert.deepEqual([stats.triangles, stats.points, stats.open, stats.doubled, stats.components], [4, 4, 0, 0, 1]);
  assert.ok(Math.abs(stats.volume - 1 / 6) < 1e-12);
  assert.ok(signedVolume(V, Uint32Array.from([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2])) < 0, 'inverted triangles give a negative volume');
  assert.equal(componentCount(Uint32Array.from([...F, 4, 6, 5, 4, 5, 7, 4, 7, 6, 5, 6, 7])), 2);
});
