// From regions to a B-rep: boundary half-edges, corners, chains, loops and
// the geometry of each chain (docs/SPEC.md 5.7, ported from
// referenz/recon.py::boundary/chains/classify/plane_face).
//
// The two lessons of docs/MACHBARKEIT.md section 4 are built in:
//   * the geometry of an edge comes from the INTERSECTION of the neighbouring
//     surfaces, not from the mesh points. On subdivided meshes the chain
//     points sit on the chords, and a polygon rim on the plane does not match
//     the exact arc on the cylinder (552 free edges in the reference).
//   * one corner is one vertex id, shared by every edge that ends there.

import { triEdges, edgeKey, triangleNormals } from './meshops.js';
import { BrepBuilder } from './brep.js';
import { cross, dot, normalize, sub, norm, frame } from './linalg.js';

/** A vertex belongs to this many regions before it counts as a corner. */
export const CORNER_REGIONS = 3;
/** Points closer than this (· diagonal) to the straight line count as collinear. */
export const COLLINEAR_RELATIVE = 1e-6;

/**
 * buildTopology(mesh, regionOfTriangle, models, opts?) → {
 *   corners: Set<vertex>, chains: [{ region, points, neighbours }],
 *   chainsByRegion: Map<region, chainIndex[]>, loops: Map<region, chainIndex[][]>
 * }
 */
export function buildTopology(mesh, regionOfTriangle, models, opts = {}) {
  const { F } = mesh;
  const halfEdge = new Map(); // 'u,v' → triangle
  for (let t = 0; t < F.length / 3; t++) for (const [u, v] of triEdges(F, t)) halfEdge.set(edgeKey(u, v), t);

  // Regions at every vertex, and the boundary half-edges per region.
  const regionsAt = new Map();
  const touch = (v, r) => {
    const set = regionsAt.get(v);
    if (set) set.add(r);
    else regionsAt.set(v, new Set([r]));
  };
  const boundary = new Map(); // region → [[u, v]]
  for (const [key, t] of halfEdge) {
    const [u, v] = key.split(',').map(Number);
    const region = regionOfTriangle[t];
    touch(u, region);
    touch(v, region);
    const twin = halfEdge.get(edgeKey(v, u));
    if (twin === undefined || regionOfTriangle[twin] === region) continue;
    const list = boundary.get(region);
    if (list) list.push([u, v]);
    else boundary.set(region, [[u, v]]);
  }

  const corners = new Set();
  for (const [v, set] of regionsAt) if (set.size >= CORNER_REGIONS) corners.add(v);

  // Chains from corner to corner, with the region on the left. Rings without
  // a corner (a hole against a cap plane) become one closed chain.
  const chains = [];
  const chainsByRegion = new Map();
  for (const [region, halfEdges] of boundary) {
    const next = new Map();
    for (const [u, v] of halfEdges) {
      const list = next.get(u);
      if (list) list.push(v);
      else next.set(u, [v]);
    }
    const used = new Set();
    const starts = [...halfEdges.filter(([u]) => corners.has(u)), ...halfEdges];
    const ids = [];
    for (const [u, v] of starts) {
      if (used.has(edgeKey(u, v))) continue;
      used.add(edgeKey(u, v));
      const points = [u, v];
      while (!corners.has(points[points.length - 1]) && points[points.length - 1] !== points[0]) {
        const from = points[points.length - 1];
        const candidate = (next.get(from) || []).find((w) => !used.has(edgeKey(from, w)));
        if (candidate === undefined) break;
        used.add(edgeKey(from, candidate));
        points.push(candidate);
      }
      const neighbours = new Set();
      for (let i = 0; i + 1 < points.length; i++) {
        const twin = halfEdge.get(edgeKey(points[i + 1], points[i]));
        if (twin !== undefined) neighbours.add(regionOfTriangle[twin]);
      }
      ids.push(chains.length);
      chains.push({ region, points, neighbours: [...neighbours] });
    }
    chainsByRegion.set(region, ids);
  }

  const loops = new Map();
  for (const [region, ids] of chainsByRegion) loops.set(region, assembleLoops(chains, ids));
  return { corners, chains, chainsByRegion, loops, regionsAt, halfEdge };
}

/** Chains of a region into closed loops: the end of one is the start of the next. */
function assembleLoops(chains, ids) {
  const startsAt = new Map();
  for (const id of ids) {
    const first = chains[id].points[0];
    const list = startsAt.get(first);
    if (list) list.push(id);
    else startsAt.set(first, [id]);
  }
  const left = new Set(ids);
  const loops = [];
  while (left.size > 0) {
    const first = [...left][0];
    left.delete(first);
    const loop = [first];
    for (;;) {
      const last = chains[loop[loop.length - 1]].points;
      const end = last[last.length - 1];
      if (end === chains[loop[0]].points[0]) break;
      const candidate = (startsAt.get(end) || []).find((id) => left.has(id));
      if (candidate === undefined) break;
      left.delete(candidate);
      loop.push(candidate);
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * The geometry of a chain, from the models of the neighbouring regions
 * (SPEC 5.7 step 5):
 *   plane ⊥ axis + cylinder → circle (closed) or arc (open)
 *   plane ∥ axis + cylinder → ruling (a straight line on the cylinder)
 *   plane + plane, points collinear → line, otherwise a polyline
 */
export function classifyChain(mesh, chain, models, diagonal) {
  const own = models.get(chain.region);
  const others = chain.neighbours.map((r) => models.get(r)).filter(Boolean);
  const cylinder = own?.type === 'cylinder' ? own : others.find((m) => m.type === 'cylinder');
  const plane = own?.type === 'plane' ? own : others.find((m) => m.type === 'plane');
  const closed = chain.points[0] === chain.points[chain.points.length - 1];

  if (cylinder && plane && chain.neighbours.length === 1) {
    const axis = normalize(cylinder.axis);
    const n = normalize(plane.normal);
    if (Math.abs(Math.abs(dot(n, axis)) - 1) < 1e-6) {
      const height = dot(plane.point, axis);
      return { kind: closed ? 'circle' : 'arc', cylinder, height };
    }
    if (Math.abs(dot(n, axis)) < 1e-6) return { kind: 'ruling', cylinder };
  }
  if (chain.points.length === 2) return { kind: 'line' };
  if (!closed && isCollinear(mesh, chain.points, diagonal)) return { kind: 'line' };
  return { kind: 'poly' };
}

function isCollinear(mesh, points, diagonal) {
  const { V } = mesh;
  const a = [V[3 * points[0]], V[3 * points[0] + 1], V[3 * points[0] + 2]];
  const last = points[points.length - 1];
  const d = sub([V[3 * last], V[3 * last + 1], V[3 * last + 2]], a);
  const len = norm(d);
  if (len < 1e-12) return false;
  const dir = [d[0] / len, d[1] / len, d[2] / len];
  const limit = COLLINEAR_RELATIVE * diagonal;
  for (const p of points) {
    const q = sub([V[3 * p], V[3 * p + 1], V[3 * p + 2]], a);
    const along = dot(q, dir);
    if (norm([q[0] - along * dir[0], q[1] - along * dir[1], q[2] - along * dir[2]]) > limit) return false;
  }
  return true;
}

/**
 * Builds the B-rep from regions, models and topology. Planar regions become
 * one face (with holes), cylindrical ones the faces of cylinderFaces().
 * `points` may be a corrected copy of mesh.V (constraints.js).
 */
export function buildBrep(mesh, regionOfTriangle, models, topology, opts = {}) {
  const V = opts.points ?? mesh.V;
  const diagonal = opts.diagonal ?? 1;
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

  // Geometry per chain, computed once so both sides use the same edges.
  const geometry = topology.chains.map((chain) => classifyChain({ V, F: mesh.F }, chain, models, diagonal));
  const edgesOfChain = topology.chains.map((chain, i) => chainEdges(b, V, chain, geometry[i], vertex));

  const regions = [...topology.loops.keys()].sort((a, c) => a - c);
  for (const region of regions) {
    const model = models.get(region);
    const loops = topology.loops.get(region);
    if (!model) continue;
    if (model.type === 'plane') {
      planeFace(b, V, region, model, loops, topology, edgesOfChain);
    } else {
      cylinderFace(b, V, region, model, loops, topology, edgesOfChain, geometry);
    }
  }
  b.solid(opts.name || 'Körper');
  return b.build();
}

/** The edges of one chain, in the direction of the chain. */
function chainEdges(b, V, chain, geometry, vertex) {
  const points = chain.points;
  if (geometry.kind === 'line' || geometry.kind === 'ruling') {
    const v0 = vertex(points[0]);
    const v1 = vertex(points[points.length - 1]);
    if (v0 === v1) return [];
    return [b.edge(v0, v1, { type: 'line' })];
  }
  if (geometry.kind === 'arc' || geometry.kind === 'circle') {
    return arcEdges(b, V, chain, geometry, vertex);
  }
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const v0 = vertex(points[i]);
    const v1 = vertex(points[i + 1]);
    if (v0 !== v1) out.push(b.edge(v0, v1, { type: 'line' }));
  }
  return out;
}

/**
 * Arc or full circle on the intersection of cap plane and cylinder. A full
 * circle is split into two halves, as in MusterGenerator/js/export/step.js –
 * that avoids the seam a closed curve would need.
 */
function arcEdges(b, V, chain, geometry, vertex) {
  const { cylinder, height } = geometry;
  const axis = normalize(cylinder.axis);
  const { u1, u2 } = cylinderFrame(cylinder);
  const center = [
    cylinder.point[0] + (height - dot(cylinder.point, axis)) * axis[0],
    cylinder.point[1] + (height - dot(cylinder.point, axis)) * axis[1],
    cylinder.point[2] + (height - dot(cylinder.point, axis)) * axis[2],
  ];
  const at = (angle) => [
    center[0] + cylinder.radius * (Math.cos(angle) * u1[0] + Math.sin(angle) * u2[0]),
    center[1] + cylinder.radius * (Math.cos(angle) * u1[1] + Math.sin(angle) * u2[1]),
    center[2] + cylinder.radius * (Math.cos(angle) * u1[2] + Math.sin(angle) * u2[2]),
  ];
  const angleOf = (v) => {
    const d = sub([V[3 * v], V[3 * v + 1], V[3 * v + 2]], center);
    return Math.atan2(dot(d, u2), dot(d, u1));
  };
  const curve = { type: 'circle', center, axis, radius: cylinder.radius, ref: u1 };

  if (geometry.kind === 'circle') {
    // Two halves, starting at the angle of the first mesh point.
    const a0 = angleOf(chain.points[0]);
    const v0 = b.vertex(at(a0), `c${chain.region}:${chain.points[0]}:0`);
    const v1 = b.vertex(at(a0 + Math.PI), `c${chain.region}:${chain.points[0]}:1`);
    const first = b.edge(v0, v1, { ...curve, ref: unitAt(u1, u2, a0) }, `:h0:${chain.region}`);
    const second = b.edge(v1, v0, { ...curve, ref: unitAt(u1, u2, a0 + Math.PI) }, `:h1:${chain.region}`);
    return [first, second];
  }
  // Open arc: start and end stay the corner vertices, which the neighbouring
  // faces share; the mid point only fixes the direction.
  const v0 = vertex(chain.points[0]);
  const v1 = vertex(chain.points[chain.points.length - 1]);
  const a0 = angleOf(chain.points[0]);
  const a1 = angleOf(chain.points[chain.points.length - 1]);
  const mid = angleOf(chain.points[Math.floor(chain.points.length / 2)]);
  const ccw = isBetween(a0, mid, a1);
  const ref = unitAt(u1, u2, a0);
  const normal = ccw ? axis : [-axis[0], -axis[1], -axis[2]];
  return [b.edge(v0, v1, { type: 'circle', center, axis: normal, radius: cylinder.radius, ref }, `:a:${chain.region}`)];
}

const unitAt = (u1, u2, angle) => normalize([
  Math.cos(angle) * u1[0] + Math.sin(angle) * u2[0],
  Math.cos(angle) * u1[1] + Math.sin(angle) * u2[1],
  Math.cos(angle) * u1[2] + Math.sin(angle) * u2[2],
]);

/** Does `mid` lie on the counter-clockwise way from a0 to a1? */
function isBetween(a0, mid, a1) {
  const norm2 = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return norm2(mid - a0) < norm2(a1 - a0);
}

/** A right-handed frame of the cylinder, with the stored reference direction. */
export function cylinderFrame(cylinder) {
  const axis = normalize(cylinder.axis);
  const u1 = cylinder.ref ? normalize(cylinder.ref) : frame(axis).u1;
  return { axis, u1, u2: normalize(cross(axis, u1)) };
}

/** One planar face: the largest loop is the outer one, the rest are holes. */
function planeFace(b, V, region, model, loops, topology, edgesOfChain) {
  const built = loops.map((loop) => orientedLoop(loop, topology, edgesOfChain)).filter((l) => l.length > 0);
  if (built.length === 0) return;
  const areas = loops.map((loop) => loopArea(V, loop, topology, model.normal));
  const order = loops.map((_, i) => i).filter((i) => built[i] && built[i].length > 0).sort((x, y) => areas[y] - areas[x]);
  const outer = built[order[0]];
  const holes = order.slice(1).map((i) => built[i]);
  b.face({
    surface: { type: 'plane', point: model.point, normal: model.normal, ref: model.ref },
    loops: [outer, ...holes],
    region,
    kind: 'plane',
  });
}

/** Oriented edges of a loop, in the direction of its chains. */
function orientedLoop(loop, topology, edgesOfChain) {
  const out = [];
  for (const id of loop) for (const use of edgesOfChain[id]) out.push(use);
  return out;
}

/** Area of a loop in the plane of the region (for outer vs. hole). */
function loopArea(V, loop, topology, normal) {
  const n = normalize(normal);
  const { u1, u2 } = frame(n);
  const pts = [];
  for (const id of loop) {
    const points = topology.chains[id].points;
    for (let i = 0; i + 1 < points.length; i++) {
      const v = points[i];
      pts.push([dot([V[3 * v], V[3 * v + 1], V[3 * v + 2]], u1), dot([V[3 * v], V[3 * v + 1], V[3 * v + 2]], u2)]);
    }
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    area += a[0] * c[1] - c[0] * a[1];
  }
  return Math.abs(area / 2);
}

/**
 * The faces of a cylindrical region. A full tube is split into two halves
 * (SPEC 5.7 step 7), an open fillet becomes one face of two arcs and two
 * rulings. Anything else returns false, and the caller falls back for this
 * region.
 */
function cylinderFace(b, V, region, model, loops, topology, edgesOfChain, geometry) {
  const uses = [];
  for (const loop of loops) for (const id of loop) for (const use of edgesOfChain[id]) uses.push(use);
  if (uses.length === 0) return false;
  const { axis, u1 } = cylinderFrame(model);
  const surface = { type: 'cylinder', point: model.point, axis, ref: u1, radius: model.radius };
  const rings = loops.filter((loop) => loop.every((id) => geometry[id].kind === 'circle'));

  if (rings.length === 2 && loops.length === 2) {
    // Tube: two closed circles, each split into halves → two faces, the
    // rulings between them are the shared edges.
    const [top, bottom] = rings;
    const topEdges = top.flatMap((id) => edgesOfChain[id]);
    const bottomEdges = bottom.flatMap((id) => edgesOfChain[id]);
    if (topEdges.length !== 2 || bottomEdges.length !== 2) return false;
    const seam0 = b.edge(topEdges[0].edge === undefined ? 0 : b.edges[topEdges[0].edge].v0, b.edges[bottomEdges[0].edge].v0, { type: 'line' }, `:s0:${region}`);
    const seam1 = b.edge(b.edges[topEdges[1].edge].v0, b.edges[bottomEdges[1].edge].v0, { type: 'line' }, `:s1:${region}`);
    for (let half = 0; half < 2; half++) {
      const other = 1 - half;
      b.face({
        surface,
        loops: [[
          { edge: topEdges[half].edge, sense: topEdges[half].sense },
          { edge: half === 0 ? seam1.edge : seam0.edge, sense: half === 0 ? seam1.sense : seam0.sense },
          { edge: bottomEdges[other].edge, sense: !bottomEdges[other].sense },
          { edge: half === 0 ? seam0.edge : seam1.edge, sense: half === 0 ? !seam0.sense : !seam1.sense },
        ]],
        region,
        kind: 'cylinder',
      });
    }
    return true;
  }

  if (loops.length === 1) {
    b.face({ surface, loops: [uses], region, kind: 'cylinder' });
    return true;
  }
  return false;
}

/** The plane of a patch, as a model for buildTopology/buildBrep. */
export function planeModel(plane) {
  return { type: 'plane', point: plane.point, normal: normalize(plane.normal) };
}

/** A cylinder as a model: a point on the axis, direction, radius. */
export function cylinderModel(cylinder) {
  const axis = normalize(cylinder.axis);
  const { u1 } = frame(axis);
  return { type: 'cylinder', point: cylinder.center, axis, radius: cylinder.radius, ref: cylinder.model?.u1 ?? u1 };
}

/**
 * Maximum distance of the points of a patch from its own plane – decides
 * whether a patch may become ONE planar face (tier 2) or has to stay
 * facets: a patch on a sphere or a torus is not flat, and a plane whose
 * boundary points are 0.03 mm away from it is not a valid face.
 */
export function patchFlatness(mesh, triangles, plane) {
  const { V, F } = mesh;
  const n = normalize(plane.normal);
  let worst = 0;
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const v = 3 * F[3 * t + k];
      const d = Math.abs(dot(sub([V[v], V[v + 1], V[v + 2]], plane.point), n));
      if (d > worst) worst = d;
    }
  }
  return worst;
}
