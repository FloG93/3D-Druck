// Triangle meshes from the model's parts. Every solid (a region between two
// heights, optionally with pockets sunk into its top) becomes closed shells:
// caps from a constrained triangulation, walls along every ring edge. Caps
// and walls share the ring vertices and edges exactly, so each shell is
// watertight.

import { subtractInterior } from '../core/geometry.js';
import { triangulateShape } from './triangulate.js';

export class TriangleBuffer {
  constructor(estimate = 1024) {
    this.data = new Float32Array(Math.max(estimate, 16) * 9);
    this.count = 0;
  }

  push(ax, ay, az, bx, by, bz, cx, cy, cz) {
    if ((this.count + 1) * 9 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const o = this.count * 9;
    const d = this.data;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = az;
    d[o + 3] = bx; d[o + 4] = by; d[o + 5] = bz;
    d[o + 6] = cx; d[o + 7] = cy; d[o + 8] = cz;
    this.count++;
  }

  get positions() {
    return this.data.subarray(0, this.count * 9);
  }
}

/** Flat cap of a shape at height z, facing up or down. */
function cap(buf, shape, z, up) {
  const { coords, triangles: tris } = triangulateShape([shape.outer, ...shape.holes]);
  for (let i = 0; i < tris.length; i += 3) {
    let a = tris[i];
    let b = tris[i + 1];
    const c = tris[i + 2];
    const cross = (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1])
      - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a]);
    // Counter-clockwise seen from the side the face looks at.
    if ((cross < 0) === up) [a, b] = [b, a];
    buf.push(coords[2 * a], coords[2 * a + 1], z, coords[2 * b], coords[2 * b + 1], z, coords[2 * c], coords[2 * c + 1], z);
  }
}

/**
 * Walls along a ring from z0 to z1. Outer rings run counter-clockwise and
 * holes clockwise, so the material is on the left and the normal points to
 * the right; `inward` flips that (walls of a pocket).
 */
function walls(buf, r, z0, z1, inward = false) {
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    let px = r[i];
    let py = r[i + 1];
    let qx = r[j];
    let qy = r[j + 1];
    if (inward) [px, py, qx, qy] = [qx, qy, px, py];
    buf.push(px, py, z0, qx, qy, z0, qx, qy, z1);
    buf.push(px, py, z0, qx, qy, z1, px, py, z1);
  }
}

function ringsOf(region) {
  const out = [];
  for (const s of region) out.push(s.outer, ...s.holes);
  return out;
}

/** Adds the closed body of one solid (see model.js). */
export function addSolid(buf, solid) {
  const { region, z0, z1, pockets, depth } = solid;
  for (const s of region) cap(buf, s, z0, false);
  for (const r of ringsOf(region)) walls(buf, r, z0, z1);
  if (!pockets || !pockets.length || !(depth > 0)) {
    for (const s of region) cap(buf, s, z1, true);
    return;
  }
  // One watertight body: top with the pocket outlines cut out, pocket walls
  // and pocket floors all built from the same rings.
  const zf = z1 - depth;
  for (const s of subtractInterior(region, pockets)) cap(buf, s, z1, true);
  for (const r of ringsOf(pockets)) walls(buf, r, zf, z1, true);
  for (const s of pockets) cap(buf, s, zf, true);
}

export function extrudeRegion(buf, region, z0, z1) {
  addSolid(buf, { region, z0, z1 });
}

/** Mesh of one part: { positions (Float32Array, 9 per triangle), triangles }. */
export function partMesh(part) {
  const buf = new TriangleBuffer(4096);
  for (const s of part.solids) addSolid(buf, s);
  return { positions: buf.positions, triangles: buf.count };
}

/** Meshes of all parts, in model order. */
export function modelMeshes(model) {
  return model.parts.map((part) => ({ part, ...partMesh(part) }));
}

/** Binary STL of the given meshes (merged into one file). */
export function toBinarySTL(meshes, header = 'Text-Generator') {
  const total = meshes.reduce((n, m) => n + m.triangles, 0);
  const buf = new ArrayBuffer(84 + total * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buf, 0, head.length).set(head);
  dv.setUint32(80, total, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.triangles; t++) {
      const i = t * 9;
      const ux = p[i + 3] - p[i];
      const uy = p[i + 4] - p[i + 1];
      const uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i];
      const vy = p[i + 7] - p[i + 1];
      const vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      dv.setFloat32(o, nx, true);
      dv.setFloat32(o + 4, ny, true);
      dv.setFloat32(o + 8, nz, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, p[i + k], true);
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
  }
  return new Uint8Array(buf);
}

/** Indexed mesh (shared vertices) for formats like 3MF. */
export function indexMesh(positions, triangles, digits = 5) {
  const f = 10 ** digits;
  const map = new Map();
  const vertices = [];
  const indices = new Uint32Array(triangles * 3);
  for (let v = 0; v < triangles * 3; v++) {
    const x = Math.round(positions[v * 3] * f);
    const y = Math.round(positions[v * 3 + 1] * f);
    const z = Math.round(positions[v * 3 + 2] * f);
    const key = `${x},${y},${z}`;
    let id = map.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      map.set(key, id);
      vertices.push(x / f, y / f, z / f);
    }
    indices[v] = id;
  }
  return { vertices, indices };
}
