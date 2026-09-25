// Triangle meshes from the model's parts. Every solid (a region between two
// heights, optionally with pockets sunk into its top) becomes closed shells:
// caps from a constrained triangulation, walls along every ring edge. Caps
// and walls share the ring vertices and edges exactly, so each shell is
// watertight.

import { subtractInterior, difference, pointInRing, reverseRing } from '../core/geometry.js';
import { countersinkSegments } from '../core/model.js';
import { triangulateShape } from './triangulate.js';

export class TriangleBuffer {
  constructor(estimate = 1024, Type = Float32Array) {
    this.Type = Type;
    this.data = new Type(Math.max(estimate, 16) * 9);
    this.count = 0;
  }

  push(ax, ay, az, bx, by, bz, cx, cy, cz) {
    if ((this.count + 1) * 9 > this.data.length) {
      const next = new this.Type(this.data.length * 2);
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
 * the right; `inward` flips that (walls of a pocket). seam: [x0, x1] – no
 * wall along these lines (a cup's wall closes there).
 */
function walls(buf, r, z0, z1, inward = false, seam = null) {
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    let px = r[i];
    let py = r[i + 1];
    let qx = r[j];
    let qy = r[j + 1];
    if (seam && px === qx && (px === seam[0] || px === seam[1])) continue;
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

/** Regular polygon, counter-clockwise, corner i at angle 2πi/n. */
function polygonRing(cx, cy, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** The region with extra holes (rings lying inside one of its shapes). */
function withHoles(region, rings) {
  if (!rings.length) return region;
  const out = region.map((s) => ({ outer: s.outer, holes: [...s.holes] }));
  for (const ring of rings) {
    const s = out.find((x) => pointInRing(x.outer, ring[0], ring[1]));
    if (s) s.holes.push(reverseRing(ring));
  }
  return out;
}

/**
 * Bottom or top face with pockets sunk into it: sets [{ region, depth }] of
 * pockets that do not touch each other, each with walls and a floor.
 */
function face(buf, region, sets, z, up) {
  const used = (sets || []).filter((p) => p.region && p.region.length && p.depth > 0);
  if (!used.length) {
    for (const s of region) cap(buf, s, z, up);
    return;
  }
  for (const s of subtractInterior(region, used.flatMap((p) => p.region))) cap(buf, s, z, up);
  for (const { region: pockets, depth } of used) {
    const zf = up ? z - depth : z + depth;
    for (const r of ringsOf(pockets)) {
      if (up) walls(buf, r, zf, z, true);
      else walls(buf, r, z, zf, true);
    }
    for (const s of pockets) cap(buf, s, zf, up);
  }
}

/**
 * Adds the closed body of one solid:
 *   region z0..z1               plate outline (outer rings and holes)
 *   pockets, depth              sunk into the top (engraved or inlaid text)
 *   bottom [{ region, depth }]  sunk into the bottom (magnets, lettering of the back, stamp socket)
 *   step { region, z }          above z only this smaller region remains
 *   steps [{ region, z }]       several such steps, each inside the one below (sloped flanks)
 *   countersinks [{cx, cy, r, R, depth}]  screw holes with a 90° cone
 * All faces share their rings, so the body is watertight.
 */
export function addSolid(buf, solid) {
  if (solid.kind === 'handle') {
    addHandle(buf, solid);
    return;
  }
  const { region, z0, z1, pockets, depth, bottom = [], step, countersinks = [] } = solid;
  const steps = solid.steps || (step ? [step] : []);
  const seam = solid.wrap ? solid.wrap.seam : null;
  const rings = countersinks.map((c) => {
    const n = countersinkSegments(c.R);
    return { c, n, inner: polygonRing(c.cx, c.cy, c.r, n), outer: polygonRing(c.cx, c.cy, c.R, n) };
  });
  face(buf, withHoles(region, rings.map((k) => k.inner)), bottom, z0, false);
  for (const r of ringsOf(region)) walls(buf, r, z0, steps.length ? steps[0].z : z1, false, seam);
  // Each step: the ledge left over from the region below, then its walls.
  let upper = region;
  steps.forEach(({ region: next, z }, i) => {
    // Around a cup the step reaches the seam (rings at the top and bottom):
    // not inside the region below, so the ledge is a plain difference.
    const ledge = seam ? difference(upper, next) : subtractInterior(upper, next);
    for (const s of ledge) cap(buf, s, z, true);
    for (const r of ringsOf(next)) walls(buf, r, z, i + 1 < steps.length ? steps[i + 1].z : z1, false, seam);
    upper = next;
  });
  // Countersunk holes: cylinder up to the cone, then the cone to the top.
  for (const { c, n, inner, outer } of rings) {
    const zc = z1 - c.depth;
    const hole = reverseRing(inner);
    walls(buf, hole, z0, zc);
    const top = reverseRing(outer);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      buf.push(hole[2 * i], hole[2 * i + 1], zc, hole[2 * j], hole[2 * j + 1], zc, top[2 * j], top[2 * j + 1], z1);
      buf.push(hole[2 * i], hole[2 * i + 1], zc, top[2 * j], top[2 * j + 1], z1, top[2 * i], top[2 * i + 1], z1);
    }
  }
  face(buf, withHoles(upper, rings.map((k) => k.outer)), [{ region: pockets, depth }], z1, true);
}

export function extrudeRegion(buf, region, z0, z1) {
  addSolid(buf, { region, z0, z1 });
}

/**
 * Stamp handle: a body of revolution from its profile [[r, z], …] (from the
 * flange at z = 0 up to the flat top), with a square peg below the flange
 * for the socket in the stamp. Built upright, then moved to `at` – turned
 * upside down with `flip` (flat top on the bed, as it is printed).
 *   { kind: 'handle', profile, segments, peg: { ring, depth }, at: [x, y], flip }
 */
function addHandle(buf, h) {
  const { profile, segments: n, peg, at = [0, 0], flip = false } = h;
  const top = profile[profile.length - 1][1];
  const P = (x, y, z) => (flip ? [at[0] + x, at[1] - y, top - z] : [at[0] + x, at[1] + y, z]);
  const tri = (a, b, c) => buf.push(...a, ...b, ...c);
  const rings = profile.map(([r, z]) => ({ ring: polygonRing(0, 0, r, n), z }));
  // Side: planar trapezoids between neighbouring rings.
  for (let k = 0; k + 1 < rings.length; k++) {
    const { ring: lo, z: z0 } = rings[k];
    const { ring: hi, z: z1 } = rings[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p0 = P(lo[2 * i], lo[2 * i + 1], z0);
      const q0 = P(lo[2 * j], lo[2 * j + 1], z0);
      const p1 = P(hi[2 * i], hi[2 * i + 1], z1);
      const q1 = P(hi[2 * j], hi[2 * j + 1], z1);
      tri(p0, q0, q1);
      tri(p0, q1, p1);
    }
  }
  // Flat top.
  const last = rings[rings.length - 1].ring;
  const c = P(0, 0, top);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(c, P(last[2 * i], last[2 * i + 1], top), P(last[2 * j], last[2 * j + 1], top));
  }
  // Underside of the flange around the peg, facing down.
  const flat = (shape, z, up) => {
    const { coords, triangles: t } = triangulateShape(shape);
    for (let i = 0; i < t.length; i += 3) {
      let a = t[i];
      let b = t[i + 1];
      const d = t[i + 2];
      const cross = (coords[2 * b] - coords[2 * a]) * (coords[2 * d + 1] - coords[2 * a + 1])
        - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * d] - coords[2 * a]);
      if ((cross < 0) === up) [a, b] = [b, a];
      tri(P(coords[2 * a], coords[2 * a + 1], z), P(coords[2 * b], coords[2 * b + 1], z), P(coords[2 * d], coords[2 * d + 1], z));
    }
  };
  const base = rings[0].ring;
  if (peg) {
    flat([base, reverseRing(peg.ring)], 0, false);
    // Peg: walls and its end face.
    const r = peg.ring;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const p0 = P(r[i], r[i + 1], -peg.depth);
      const q0 = P(r[j], r[j + 1], -peg.depth);
      const q1 = P(r[j], r[j + 1], 0);
      const p1 = P(r[i], r[i + 1], 0);
      tri(p0, q0, q1);
      tri(p0, q1, p1);
    }
    flat([r], -peg.depth, false);
  } else flat([base], 0, false);
}

/**
 * A solid of a cup: built flat (x along the circumference, y up the wall,
 * z out of it), cut into narrow strips and bent around the Z axis. x = 0
 * faces the front (-y), the plate top (z = t) is the outside at the given
 * radius (at half height); the seam lines at the back meet exactly. A
 * conical wall (slope sin, cos against the vertical) leans outwards or
 * inwards; y runs along its surface, z sideways, so the rim and the foot
 * stay level and the wall keeps its thickness.
 *   wrap: { seam: [x0, x1], radius, t, height, sin, cos, segments }
 */
function addWrapped(out, solid) {
  // Full precision: the seam points must stay exactly on the seam lines.
  const flat = new TriangleBuffer(4096, Float64Array);
  addSolid(flat, solid);
  const { seam: [x0, x1], radius: R, t, height: H, sin = 0, cos = 1, segments: n } = solid.wrap;
  const C = x1 - x0;
  const planes = [];
  for (let k = 0; k <= n; k++) planes.push(k === n ? x1 : x0 + (k * C) / n);
  const bend = (p) => {
    const a = p[0] >= x1 ? -Math.PI : (2 * Math.PI * (p[0] - x0)) / C - Math.PI;
    const rho = R + p[1] * sin + (p[2] - t) / cos;
    return [rho * Math.sin(a), -rho * Math.cos(a), (p[1] + H / 2) * cos];
  };
  sliceStrips(flat.positions, flat.count, planes, (poly) => {
    const q = poly.map(bend);
    for (let i = 1; i + 1 < q.length; i++) out.push(...q[0], ...q[i], ...q[i + 1]);
  });
}

/** Where the segment a–b crosses x = X, the same from either end. */
function crossAt(a, b, X) {
  const [p, r] = a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))) ? [a, b] : [b, a];
  const k = (X - p[0]) / (r[0] - p[0]);
  return [X, p[1] + k * (r[1] - p[1]), p[2] + k * (r[2] - p[2])];
}

// Points closer than this to a cutting plane count as lying on it (mm).
const ON_PLANE = 1e-7;

/**
 * Cuts every triangle at the planes x = planes[k] and hands each piece (a
 * convex polygon in the triangle's orientation) to emit. Shared edges are
 * cut at the same points on both sides, so closed shells stay closed.
 */
function sliceStrips(pos, count, planes, emit) {
  const last = planes.length - 1;
  const x0 = planes[0];
  const step = (planes[last] - x0) / last;
  const eps = ON_PLANE;
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const tri = [[pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]];
    const minX = Math.min(tri[0][0], tri[1][0], tri[2][0]);
    const maxX = Math.max(tri[0][0], tri[1][0], tri[2][0]);
    const j0 = Math.max(0, Math.floor((minX - x0) / step) - 1);
    const j1 = Math.min(last - 1, Math.floor((maxX - x0) / step) + 1);
    // Not crossing any plane inside: as it is.
    let crosses = false;
    for (let j = Math.max(1, j0); j <= Math.min(last - 1, j1 + 1); j++) {
      if (planes[j] > minX + eps && planes[j] < maxX - eps) crosses = true;
    }
    if (!crosses) {
      emit(tri);
      continue;
    }
    for (let j = j0; j <= j1; j++) {
      const lo = planes[j];
      const hi = planes[j + 1];
      if (hi <= minX + eps || lo >= maxX - eps) continue;
      const poly = [];
      for (let c = 0; c < 3; c++) {
        const a = tri[c];
        const b = tri[(c + 1) % 3];
        if (a[0] >= lo - eps && a[0] <= hi + eps) poly.push(a);
        const cuts = [];
        for (const X of [lo, hi]) {
          if (Math.abs(a[0] - X) > eps && Math.abs(b[0] - X) > eps && (a[0] - X) * (b[0] - X) < 0) cuts.push(X);
        }
        if (cuts.length === 2 && a[0] > b[0]) cuts.reverse();
        for (const X of cuts) poly.push(crossAt(a, b, X));
      }
      if (poly.length >= 3) emit(poly);
    }
  }
}

/** Mesh of one part: { positions (Float32Array, 9 per triangle), triangles }. */
export function partMesh(part) {
  const buf = new TriangleBuffer(4096);
  for (const s of part.solids) {
    if (s.wrap) addWrapped(buf, s);
    else addSolid(buf, s);
  }
  return { positions: buf.positions, triangles: buf.count };
}

/** Meshes of all parts, in model order. */
export function modelMeshes(model) {
  return model.parts.map((part) => ({ part, ...partMesh(part) }));
}

/**
 * Meshes turned upside down for printing with the lettering on the bed:
 * rotated 180° about the X axis (keeps the winding) and lifted to z = 0.
 */
export function flipMeshes(meshes, top) {
  return meshes.map((m) => {
    const n = m.triangles * 9;
    const p = new Float32Array(n);
    for (let i = 0; i < n; i += 3) {
      p[i] = m.positions[i];
      p[i + 1] = -m.positions[i + 1];
      p[i + 2] = top - m.positions[i + 2];
    }
    return { ...m, positions: p };
  });
}

/**
 * Pieces of a split stencil pulled apart by gap mm per row and column, so
 * the slicer sees separate objects to arrange on its plates.
 */
export function spreadPieces(meshes, gap = 10) {
  return meshes.map((m) => {
    const cell = m.part.cell;
    if (!cell) return m;
    const dx = cell[0] * gap;
    const dy = cell[1] * gap;
    const n = m.triangles * 9;
    const p = new Float32Array(n);
    for (let i = 0; i < n; i += 3) {
      p[i] = m.positions[i] + dx;
      p[i + 1] = m.positions[i + 1] + dy;
      p[i + 2] = m.positions[i + 2];
    }
    return { ...m, positions: p };
  });
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
