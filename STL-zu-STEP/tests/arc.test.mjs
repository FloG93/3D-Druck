// Arcs as edges: a chain of only two points has no middle point, so the
// direction of its arc cannot be read from one. Measured on fandisk.obj: the
// short way (0.05 rad) became the long way round (2π − 0.05), which put a
// whole circle of area into a single triangle and made the volume of the body
// absurd (−3649 instead of +20). The check caught it, but a wrong arc can
// stay below the one-percent limit in another part.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTopology, buildBrep, planeModel, cylinderModel } from '../js/core/topology.js';
import { brepVolume, planarFaceArea, BrepBuilder } from '../js/core/brep.js';
import { verifyBrep } from '../js/core/verify.js';
import { triangleNormals } from '../js/core/meshops.js';
import { convert } from '../js/core/pipeline.js';
import { loadFixture, expected } from './helpers.mjs';

/** Capped cylinder: r, height, n segments; the caps are a fan from the centre. */
function cappedCylinder(r = 3, h = 10, n = 16) {
  const V = [];
  const F = [];
  const add = (x, y, z) => {
    V.push(x, y, z);
    return V.length / 3 - 1;
  };
  const bottom = [];
  const top = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    bottom.push(add(r * Math.cos(a), r * Math.sin(a), 0));
    top.push(add(r * Math.cos(a), r * Math.sin(a), h));
  }
  const cBottom = add(0, 0, 0);
  const cTop = add(0, 0, h);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    F.push(bottom[i], bottom[j], top[j], bottom[i], top[j], top[i]); // wall, outward
    F.push(cBottom, bottom[j], bottom[i]); // bottom cap, pointing down
    F.push(cTop, top[i], top[j]); // top cap, pointing up
  }
  return { V: Float64Array.from(V), F: Uint32Array.from(F), r, h, n };
}

/**
 * Regions as a real mesh produces them when the caps are NOT one flat patch:
 * every cap triangle is its own region, so every ring edge is a chain of two
 * points between the cylinder and a plane perpendicular to its axis.
 */
function facetedCapRegions(mesh) {
  const { V, F } = mesh;
  const { N } = triangleNormals(V, F);
  const count = F.length / 3;
  const regionOfTriangle = new Int32Array(count).fill(-1);
  const models = new Map();
  const wall = [];
  for (let t = 0; t < count; t++) {
    const flat = Math.abs(N[3 * t + 2]) > 0.99; // cap triangle
    if (!flat) {
      wall.push(t);
      continue;
    }
    const region = models.size + 1;
    regionOfTriangle[t] = region;
    const v = 3 * F[3 * t];
    models.set(region, planeModel({ point: [V[v], V[v + 1], V[v + 2]], normal: [N[3 * t], N[3 * t + 1], N[3 * t + 2]] }));
  }
  for (const t of wall) regionOfTriangle[t] = 0;
  models.set(0, cylinderModel({ axis: [0, 0, 1], center: [0, 0, 0], radius: mesh.r, outward: true }));
  return { regionOfTriangle, models };
}

test('a cylinder with faceted caps keeps its volume (two-point arc chains)', () => {
  const mesh = cappedCylinder();
  const { regionOfTriangle, models } = facetedCapRegions(mesh);
  const topology = buildTopology(mesh, regionOfTriangle, models);
  const arcs = topology.chains.filter((c) => c.points.length === 2).length;
  assert.ok(arcs > 0, 'the case really produces chains of two points');
  const brep = buildBrep(mesh, regionOfTriangle, models, topology, { diagonal: 20, name: 'Zylinder' });
  const want = Math.PI * mesh.r * mesh.r * mesh.h; // 282.743
  const deviation = (100 * Math.abs(brepVolume(brep) - want)) / want;
  assert.ok(deviation < 0.5, `volume ${brepVolume(brep).toFixed(3)} instead of ${want.toFixed(3)} (${deviation.toFixed(2)} %)`);
});

test('a short arc contributes a sliver, not a whole circle', () => {
  // A triangle whose middle edge is a 5° arc of radius 2: its area is the
  // triangle plus a thin circular segment, never π r².
  for (const sense of [true, false]) {
    const b = new BrepBuilder();
    const r = 2;
    const sweep = (5 * Math.PI) / 180;
    const centre = [0, 0, 0];
    const p0 = [r, 0, 0];
    const p1 = [r * Math.cos(sweep), r * Math.sin(sweep), 0];
    const v0 = b.vertex(centre, 'c');
    const v1 = b.vertex(p0, 'a');
    const v2 = b.vertex(p1, 'b');
    const axis = sense ? [0, 0, 1] : [0, 0, -1];
    const start = sense ? v1 : v2;
    const end = sense ? v2 : v1;
    const arc = b.edge(start, end, { type: 'circle', center: centre, axis, radius: r, ref: sense ? [1, 0, 0] : [Math.cos(sweep), Math.sin(sweep), 0] });
    const loop = sense
      ? [b.edge(v0, v1, { type: 'line' }), arc, b.edge(v2, v0, { type: 'line' })]
      : [b.edge(v0, v2, { type: 'line' }), arc, b.edge(v1, v0, { type: 'line' })];
    b.face({ surface: { type: 'plane', point: [0, 0, 0], normal: [0, 0, 1] }, loops: [loop] });
    const area = Math.abs(planarFaceArea(b.build(), b.faces[0]));
    const want = (r * r * sweep) / 2; // circular sector
    assert.ok(Math.abs(area - want) < 1e-9, `sense ${sense}: area ${area.toFixed(4)} instead of ${want.toFixed(4)} (full circle would be ${(Math.PI * r * r).toFixed(2)})`);
  }
});

test('kugel-bohrung.stl: the bore is recognised, and the report says why it stays tier 2', () => {
  // The rings of the bore end on the curved surface of the sphere, so the
  // region has a boundary tier 3 cannot build. The honest outcome is tier 2
  // with the volume of the mesh – and the cylinder still in the report.
  const name = 'kugel-bohrung.stl';
  const result = convert(loadFixture(name), name, {});
  const [c] = result.components;
  assert.equal(c.tier, 2);
  assert.ok(Math.abs(c.brepVolume - result.meshVolume) < 0.01, 'the volume is the volume of the mesh');
  const exact = expected(name).volumen;
  assert.ok(Math.abs(100 * (c.brepVolume - exact) / exact) < 1, `${c.brepVolume} against ${exact}`);
  assert.ok(c.fallbackReasons.length > 0, 'the fallback has a reason');
});
