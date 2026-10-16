// The B-rep the exporter writes: vertices, edges, faces and shells, without
// any knowledge of STEP (docs/SPEC.md 5.8). export/step.js turns it into
// entities, verify.js checks it before a single line is written.
//
// Two rules decide whether a CAD program accepts the result, both measured in
// docs/MACHBARKEIT.md section 4:
//   * one corner is one vertex (one id). Comparing coordinates with a
//     tolerance leaves wires open, because the rounding error of 1e-6 is
//     larger than the tolerance a CAD kernel uses for a wire.
//   * every edge is used exactly twice, in opposite directions.

import { triangleNormals } from './meshops.js';
import { cross, dot, normalize, sub, norm, frame } from './linalg.js';

/**
 * Collects vertices, edges and faces and hands out ids. Curves and surfaces
 * are plain objects:
 *   curve   { type: 'line' } | { type: 'circle', center, axis, ref, radius }
 *   surface { type: 'plane', point, normal, ref } | { type: 'cylinder', point, axis, ref, radius }
 */
export class BrepBuilder {
  constructor() {
    this.points = [];
    this.edges = [];
    this.faces = [];
    this.solids = [];
    this.edgeIndex = new Map();
  }

  /** A vertex; `key` lets the caller keep one corner one vertex. */
  vertex(point, key) {
    const k = key ?? `p${this.points.length}`;
    let id = this.edgeIndex.get(`v:${k}`);
    if (id === undefined) {
      id = this.points.length;
      this.points.push([point[0], point[1], point[2]]);
      this.edgeIndex.set(`v:${k}`, id);
    }
    return id;
  }

  /**
   * An edge between two vertices. Reused when it already exists, so that each
   * one is written once and referenced twice. `variant` separates two edges
   * between the same pair of vertices (the two halves of a full circle).
   */
  edge(v0, v1, curve, variant = '') {
    const key = `e:${Math.min(v0, v1)},${Math.max(v0, v1)},${curve.type}${variant}`;
    const known = this.edgeIndex.get(key);
    if (known !== undefined) {
      const e = this.edges[known];
      return { edge: known, sense: e.v0 === v0 };
    }
    const id = this.edges.length;
    this.edges.push({ v0, v1, curve, uses: 0 });
    this.edgeIndex.set(key, id);
    return { edge: id, sense: true };
  }

  /**
   * A face; `loops` are arrays of { edge, sense }, the first one is the outer.
   * `span` is the parameter range of a cylindrical face, recorded where it is
   * known exactly (the two halves of a tube share their vertices, so it
   * cannot be read back from them).
   */
  face({ surface, loops, sameSense = true, region = -1, kind = '', span = null }) {
    for (const loop of loops) for (const use of loop) this.edges[use.edge].uses += 1;
    const id = this.faces.length;
    this.faces.push({ surface, loops, sameSense, region, kind, span });
    return id;
  }

  solid(name, faces) {
    this.solids.push({ name, faces: faces ?? this.faces.map((_, i) => i) });
    return this.solids.length - 1;
  }

  build() {
    if (this.solids.length === 0) this.solid('Körper 1');
    return { points: this.points, edges: this.edges, faces: this.faces, solids: this.solids };
  }
}

/**
 * Tier 1: every triangle becomes its own planar face (SPEC 3). Always
 * available as long as the healed mesh is closed, and the guarantee the
 * fallback chain rests on.
 */
export function facetedBrep(mesh, name = 'Körper 1') {
  const { V, F } = mesh;
  const { N } = triangleNormals(V, F);
  const b = new BrepBuilder();
  const vertexOf = new Map();
  const vertex = (v) => {
    let id = vertexOf.get(v);
    if (id === undefined) {
      id = b.vertex([V[3 * v], V[3 * v + 1], V[3 * v + 2]], `m${v}`);
      vertexOf.set(v, id);
    }
    return id;
  };
  for (let t = 0; t < F.length / 3; t++) {
    const ids = [vertex(F[3 * t]), vertex(F[3 * t + 1]), vertex(F[3 * t + 2])];
    const loop = [
      b.edge(ids[0], ids[1], { type: 'line' }),
      b.edge(ids[1], ids[2], { type: 'line' }),
      b.edge(ids[2], ids[0], { type: 'line' }),
    ];
    const p0 = b.points[ids[0]];
    const normal = [N[3 * t], N[3 * t + 1], N[3 * t + 2]];
    b.face({
      surface: { type: 'plane', point: p0, normal, ref: normalize(sub(b.points[ids[1]], p0)) },
      loops: [loop],
      region: t,
      kind: 'facet',
    });
  }
  b.solid(name);
  return b.build();
}

/** Points of a loop, in order (the start vertex of each oriented edge). */
export function loopVertices(brep, loop) {
  return loop.map(({ edge, sense }) => (sense ? brep.edges[edge].v0 : brep.edges[edge].v1));
}

/**
 * Volume of the B-rep from the divergence theorem, V = ⅓ ∮ (p·n) dA, with the
 * contribution of every face computed in closed form: planar faces through
 * their area, cylindrical faces through their parameter range. This is what
 * the volume comparison against the mesh is based on (SPEC 5.9).
 */
export function brepVolume(brep) {
  let sum = 0;
  for (const face of brep.faces) sum += faceFlux(brep, face);
  return sum / 3;
}

/** ∫ (p·n) dA over one face, with the outward normal. */
function faceFlux(brep, face) {
  const sign = face.sameSense ? 1 : -1;
  if (face.surface.type === 'plane') {
    const n = normalize(face.surface.normal);
    const area = planarFaceArea(brep, face);
    const offset = dot(face.surface.point, n);
    return sign * offset * area;
  }
  // Cylinder: p = o + r·e(θ) + z·a, n = ±e(θ) → p·n = o·e(θ) + r.
  const { point, radius } = face.surface;
  // The parameter range is recorded when the face is built (the two halves of
  // a tube share their vertices, so it cannot be read back from them).
  const span = face.span ?? cylinderSpan(brep, face);
  if (!span) return 0;
  const { theta0, theta1, z0, z1, u1, u2 } = span;
  const dTheta = theta1 - theta0;
  const dz = z1 - z0;
  // ∫ o·e(θ) r dθ dz  with e(θ) = cos θ · u1 + sin θ · u2
  const iCos = Math.sin(theta1) - Math.sin(theta0);
  const iSin = -(Math.cos(theta1) - Math.cos(theta0));
  const o = point;
  const first = radius * dz * (dot(o, u1) * iCos + dot(o, u2) * iSin);
  const second = radius * radius * dTheta * dz;
  return sign * (first + second);
}

/** Signed area of a planar face, arcs included (outer loop minus holes). */
export function planarFaceArea(brep, face) {
  const n = normalize(face.surface.normal);
  const { u1, u2 } = frame(n);
  let total = 0;
  for (const [index, loop] of face.loops.entries()) {
    const area = loopArea(brep, loop, u1, u2, n);
    total += index === 0 ? Math.abs(area) : -Math.abs(area);
  }
  return total;
}

/**
 * Area of one closed loop in the plane coordinates (u1, u2); arcs exact.
 *
 * The sweep of an arc may not be read from its end points alone: for a half
 * circle the difference of the angles is ±π and the sign is a coin toss in
 * floating point (measured on loch-sechzehneck.stl, where the two halves of
 * the bore cancelled each other and the hole vanished from the face). The
 * direction comes from the axis of the circle and the direction the loop runs
 * through it.
 */
function loopArea(brep, loop, u1, u2, n) {
  const pts = loopVertices(brep, loop).map((v) => {
    const p = brep.points[v];
    return [dot(p, u1), dot(p, u2)];
  });
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    area += a[0] * c[1] - c[0] * a[1];
  }
  area /= 2;
  // Circular segments between chord and arc.
  for (const [i, use] of loop.entries()) {
    const curve = brep.edges[use.edge].curve;
    if (curve.type !== 'circle') continue;
    const start = pts[i];
    const end = pts[(i + 1) % pts.length];
    const center = [dot(curve.center, u1), dot(curve.center, u2)];
    const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
    const direction = (dot(curve.axis, n) > 0) === use.sense ? 1 : -1;
    let delta = ((((a1 - a0) * direction) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (delta < 1e-9) delta = 2 * Math.PI; // start = end: the full circle
    const sweep = direction * delta;
    const r = curve.radius;
    area += (r * r * (sweep - Math.sin(sweep))) / 2;
  }
  return area;
}

/** Parameter range (angles, heights) of a cylindrical face from its loop. */
function cylinderSpan(brep, face) {
  const { point, axis, radius, ref } = face.surface;
  const a = normalize(axis);
  const u1 = normalize(ref ?? frame(a).u1);
  const u2 = normalize(cross(a, u1));
  let zMin = Infinity;
  let zMax = -Infinity;
  const angles = [];
  for (const loop of face.loops) {
    for (const v of loopVertices(brep, loop)) {
      const d = sub(brep.points[v], point);
      const z = dot(d, a);
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      angles.push(Math.atan2(dot(d, u2), dot(d, u1)));
    }
  }
  if (angles.length === 0 || !Number.isFinite(zMin)) return null;
  const sorted = angles.map((x) => (x < 0 ? x + 2 * Math.PI : x)).sort((x, y) => x - y);
  let gap = 0;
  let at = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 2 * Math.PI;
    if (next - sorted[i] > gap) {
      gap = next - sorted[i];
      at = i;
    }
  }
  const theta0 = sorted[(at + 1) % sorted.length];
  const theta1 = theta0 + (2 * Math.PI - gap);
  return { theta0, theta1, z0: zMin + dot(point, a) - dot(point, a), z1: zMax, u1, u2, radius };
}

/** Number of faces, edges and vertices actually used (for the report). */
export function brepCounts(brep) {
  return {
    points: brep.points.length,
    edges: brep.edges.length,
    faces: brep.faces.length,
    solids: brep.solids.length,
    planes: brep.faces.filter((f) => f.surface.type === 'plane').length,
    cylinders: brep.faces.filter((f) => f.surface.type === 'cylinder').length,
  };
}

/** Several component B-reps in one file: one solid per component. */
export function mergeBreps(breps, names = []) {
  const out = new BrepBuilder();
  for (const [i, brep] of breps.entries()) {
    const pointOffset = out.points.length;
    const edgeOffset = out.edges.length;
    const faceOffset = out.faces.length;
    out.points.push(...brep.points.map((p) => [p[0], p[1], p[2]]));
    out.edges.push(...brep.edges.map((e) => ({ ...e, v0: e.v0 + pointOffset, v1: e.v1 + pointOffset })));
    out.faces.push(...brep.faces.map((f) => ({
      ...f,
      loops: f.loops.map((loop) => loop.map((use) => ({ edge: use.edge + edgeOffset, sense: use.sense }))),
    })));
    const faces = (brep.solids.length ? brep.solids.flatMap((s) => s.faces) : brep.faces.map((_, k) => k)).map((k) => k + faceOffset);
    out.solids.push({ name: names[i] ?? `Körper ${i + 1}`, faces });
  }
  return { points: out.points, edges: out.edges, faces: out.faces, solids: out.solids };
}
