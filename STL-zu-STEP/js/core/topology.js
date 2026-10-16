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

import { edgeTable, triangleNormals } from './meshops.js';
import { BrepBuilder } from './brep.js';
import { cross, dot, normalize, sub, norm, frame } from './linalg.js';

/** A vertex belongs to this many regions before it counts as a corner. */
export const CORNER_REGIONS = 3;
/** Points closer than this (· diagonal) to the straight line count as collinear. */
export const COLLINEAR_RELATIVE = 1e-6;

/**
 * buildTopology(mesh, regionOfTriangle, models, opts?) → {
 *   corners: Set<vertex>, chains: [{ region, points, neighbours }],
 *   chainsByRegion: Map<region, chainIndex[]>, loops: Map<region, chainIndex[][]>,
 *   regionsAt: Map<corner vertex, Set<region>>
 * }
 */
export function buildTopology(mesh, regionOfTriangle, models, opts = {}) {
  const { F } = mesh;
  const n = F.length / 3;
  const vertexCount = mesh.V.length / 3;

  // Regions at every corner point: the triangles around each vertex in CSR
  // form, then the distinct regions among them. Only points that touch at
  // least CORNER_REGIONS regions are kept (the constraints look at no others).
  const vStart = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < F.length; i++) vStart[F[i] + 1]++;
  for (let v = 0; v < vertexCount; v++) vStart[v + 1] += vStart[v];
  const vTriangles = new Uint32Array(F.length);
  const fill = vStart.slice(0, vertexCount);
  for (let i = 0; i < F.length; i++) vTriangles[fill[F[i]]++] = (i / 3) | 0;
  const regionsAt = new Map();
  const corners = new Set();
  for (let v = 0; v < vertexCount; v++) {
    const distinct = [];
    for (let i = vStart[v]; i < vStart[v + 1]; i++) {
      const r = regionOfTriangle[vTriangles[i]];
      if (!distinct.includes(r)) distinct.push(r);
    }
    if (distinct.length >= CORNER_REGIONS) {
      regionsAt.set(v, new Set(distinct));
      corners.add(v);
    }
  }

  // Boundary half-edges per region as flat triples [u, v, region on the other side].
  const { group, start: gStart, members } = edgeTable(F);
  const boundary = new Map();
  for (let t = 0; t < n; t++) {
    const region = regionOfTriangle[t];
    for (let slot = 0; slot < 3; slot++) {
      const e = 3 * t + slot;
      const g = group[e];
      if (gStart[g + 1] - gStart[g] < 2) continue;
      const u = F[e];
      const v = F[slot === 2 ? e - 2 : e + 1];
      // The twin runs v → u; with several candidates the last one counts.
      let twin = -1;
      for (let i = gStart[g]; i < gStart[g + 1]; i++) {
        const o = members[i];
        if (F[o] === v && F[o % 3 === 2 ? o - 2 : o + 1] === u) twin = (o / 3) | 0;
      }
      if (twin < 0 || regionOfTriangle[twin] === region) continue;
      const list = boundary.get(region);
      if (list) list.push(u, v, regionOfTriangle[twin]);
      else boundary.set(region, [u, v, regionOfTriangle[twin]]);
    }
  }

  // Chains from corner to corner, with the region on the left. Rings without
  // a corner (a hole against a cap plane) become one closed chain.
  const chains = [];
  const chainsByRegion = new Map();
  for (const [region, flat] of boundary) {
    const m = flat.length / 3;
    const next = new Map(); // start point → entries that begin there
    for (let i = 0; i < m; i++) {
      const list = next.get(flat[3 * i]);
      if (list) list.push(i);
      else next.set(flat[3 * i], [i]);
    }
    const used = new Uint8Array(m);
    const starts = [];
    for (let i = 0; i < m; i++) if (corners.has(flat[3 * i])) starts.push(i);
    for (let i = 0; i < m; i++) starts.push(i);
    const ids = [];
    for (const i of starts) {
      if (used[i]) continue;
      used[i] = 1;
      const points = [flat[3 * i], flat[3 * i + 1]];
      const neighbours = new Set([flat[3 * i + 2]]);
      while (!corners.has(points[points.length - 1]) && points[points.length - 1] !== points[0]) {
        const candidate = (next.get(points[points.length - 1]) || []).find((j) => !used[j]);
        if (candidate === undefined) break;
        used[candidate] = 1;
        points.push(flat[3 * candidate + 1]);
        neighbours.add(flat[3 * candidate + 2]);
      }
      ids.push(chains.length);
      chains.push({ region, points, neighbours: [...neighbours] });
    }
    chainsByRegion.set(region, ids);
  }

  const loops = new Map();
  for (const [region, ids] of chainsByRegion) loops.set(region, assembleLoops(chains, ids));
  return { corners, chains, chainsByRegion, loops, regionsAt };
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
 * one face (with holes), a closed tube two half faces, an open fillet one
 * face of two arcs and two rulings.
 *
 * Both sides of a chain have to use the SAME edges, so the chains are paired
 * by their undirected edges and the geometry is built once; the other side
 * gets the same list reversed.
 *
 * `opts.points` may be a corrected copy of mesh.V (constraints.js).
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

  const geometry = topology.chains.map((chain) => classifyChain({ V, F: mesh.F }, chain, models, diagonal));
  const keys = topology.chains.map((chain) => chainKey(chain));
  const edgesOfChain = new Array(topology.chains.length).fill(null);
  const primary = new Map();
  const handled = new Set();

  // Edges of one chain, built on demand: the tube pass runs before the
  // general pass and needs the arcs of its rings already.
  const ensureEdges = (id) => {
    if (!edgesOfChain[id]) {
      const known = primary.get(keys[id]);
      if (known !== undefined && edgesOfChain[known]) {
        edgesOfChain[id] = reverseUses(edgesOfChain[known]);
      } else {
        primary.set(keys[id], id);
        edgesOfChain[id] = chainEdges(b, V, topology.chains[id], geometry[id], vertex, `k${id}`);
      }
    }
    return edgesOfChain[id];
  };

  // Tubes first: both rings have to be split at the same angle, otherwise the
  // seam between the halves is not a straight line on the cylinder.
  for (const [region, model] of models) {
    if (model.type !== 'cylinder') continue;
    const loops = topology.loops.get(region) ?? [];
    // A ring is one closed circle, or several arcs on the same circle – the
    // latter as soon as the face around the bore is not one flat patch.
    const isRing = (loop) => loop.every((id) => geometry[id].kind === 'circle' || geometry[id].kind === 'arc');
    const rings = loops.filter(isRing);
    if (loops.length !== 2 || rings.length !== 2) continue;
    const built = buildTube(b, V, region, model, rings, topology, geometry, keys, edgesOfChain, primary, ensureEdges);
    if (built) handled.add(region);
  }

  for (let i = 0; i < topology.chains.length; i++) {
    if (edgesOfChain[i]) continue;
    const known = primary.get(keys[i]);
    if (known !== undefined) {
      edgesOfChain[i] = reverseUses(edgesOfChain[known]);
      continue;
    }
    primary.set(keys[i], i);
    edgesOfChain[i] = chainEdges(b, V, topology.chains[i], geometry[i], vertex, `k${i}`);
  }

  const regions = [...topology.loops.keys()].sort((a, c) => a - c);
  for (const region of regions) {
    const model = models.get(region);
    if (!model || handled.has(region)) continue;
    const loops = topology.loops.get(region);
    if (model.type === 'plane') planeFace(b, V, region, model, loops, topology, edgesOfChain);
    else if (!cylinderFace(b, region, model, loops, edgesOfChain)) {
      throw new Error(`Zylinderfläche der Region ${region} hat eine Randform, die Stufe 3 nicht bauen kann (${loops.length} Schleifen)`);
    }
  }
  b.solid(opts.name || 'Körper');
  return b.build();
}

/** A chain and its twin have the same undirected edges – that is their key. */
function chainKey(chain) {
  const parts = [];
  for (let i = 0; i + 1 < chain.points.length; i++) {
    const u = chain.points[i];
    const v = chain.points[i + 1];
    parts.push(u < v ? `${u},${v}` : `${v},${u}`);
  }
  return parts.sort().join(';');
}

const reverseUses = (uses) => [...uses].reverse().map((use) => ({ edge: use.edge, sense: !use.sense }));

/** The edges of one chain, in the direction of the chain. */
function chainEdges(b, V, chain, geometry, vertex, tag) {
  const points = chain.points;
  if (geometry.kind === 'line' || geometry.kind === 'ruling') {
    const v0 = vertex(points[0]);
    const v1 = vertex(points[points.length - 1]);
    if (v0 === v1) return [];
    return [b.edge(v0, v1, { type: 'line' })];
  }
  if (geometry.kind === 'arc') return [arcEdge(b, V, chain, geometry, vertex, tag)];
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const v0 = vertex(points[i]);
    const v1 = vertex(points[i + 1]);
    if (v0 !== v1) out.push(b.edge(v0, v1, { type: 'line' }));
  }
  return out;
}

/** A right-handed frame of the cylinder, with its stored reference direction. */
export function cylinderFrame(cylinder) {
  const axis = normalize(cylinder.axis);
  const u1 = cylinder.ref ? normalize(cylinder.ref) : frame(axis).u1;
  return { axis, u1, u2: normalize(cross(axis, u1)) };
}

/** Centre of the circle in which a cap plane cuts the cylinder. */
function circleCenter(cylinder, height) {
  const axis = normalize(cylinder.axis);
  const shift = height - dot(cylinder.point, axis);
  return [cylinder.point[0] + shift * axis[0], cylinder.point[1] + shift * axis[1], cylinder.point[2] + shift * axis[2]];
}

const pointAt = (center, u1, u2, radius, angle) => [
  center[0] + radius * (Math.cos(angle) * u1[0] + Math.sin(angle) * u2[0]),
  center[1] + radius * (Math.cos(angle) * u1[1] + Math.sin(angle) * u2[1]),
  center[2] + radius * (Math.cos(angle) * u1[2] + Math.sin(angle) * u2[2]),
];

const unitAt = (u1, u2, angle) => normalize([
  Math.cos(angle) * u1[0] + Math.sin(angle) * u2[0],
  Math.cos(angle) * u1[1] + Math.sin(angle) * u2[1],
  Math.cos(angle) * u1[2] + Math.sin(angle) * u2[2],
]);

/**
 * An open arc between two corners. Start and end stay the corner vertices the
 * neighbouring faces share; the mid point of the chain only decides the
 * direction of the arc.
 */
function arcEdge(b, V, chain, geometry, vertex, tag) {
  const { cylinder, height } = geometry;
  const axis = normalize(cylinder.axis);
  const { u1, u2 } = cylinderFrame(cylinder);
  const center = circleCenter(cylinder, height);
  const angleOf = (v) => {
    const d = sub([V[3 * v], V[3 * v + 1], V[3 * v + 2]], center);
    return Math.atan2(dot(d, u2), dot(d, u1));
  };
  const first = chain.points[0];
  const last = chain.points[chain.points.length - 1];
  const a0 = angleOf(first);
  const a1 = angleOf(last);
  // Which way round does the arc go? A chain of three points or more says so
  // through its middle point. A chain of TWO points has no middle point – its
  // "middle" is the end point, and asking it always answers "clockwise".
  // Such a chain is a single edge of the mesh, so it can only be the short
  // way: a cylinder is never accepted with fewer than eight facets per full
  // circle, and one facet therefore spans far less than half of it.
  // (Measured on fandisk.obj: without this, 0.05 rad became 2π − 0.05 and the
  // volume of the body came out as −3649 instead of +20.)
  const ccw = chain.points.length >= 3
    ? isBetween(a0, angleOf(chain.points[Math.floor(chain.points.length / 2)]), a1)
    : turn(a1 - a0) <= Math.PI;
  const normal = ccw ? axis : [-axis[0], -axis[1], -axis[2]];
  const ref = unitAt(u1, u2, a0);
  return b.edge(vertex(first), vertex(last), { type: 'circle', center, axis: normal, radius: cylinder.radius, ref }, `:a:${tag}`);
}

/** An angle difference as a positive turn in [0, 2π). */
const turn = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** Does `mid` lie on the counter-clockwise way from a0 to a1? */
function isBetween(a0, mid, a1) {
  return turn(mid - a0) < turn(a1 - a0);
}

/**
 * A closed tube: both rings are split into halves at the same two angles, so
 * the two seams are straight lines on the cylinder (SPEC 5.7 step 7, as in
 * MusterGenerator/js/export/step.js for full circles).
 */
function buildTube(b, V, region, model, rings, topology, geometry, keys, edgesOfChain, primary, ensureEdges) {
  const axis = normalize(model.axis);
  const { u1, u2 } = cylinderFrame(model);
  const angleOf = (p) => {
    const d = sub(p, model.point);
    return Math.atan2(dot(d, u2), dot(d, u1));
  };

  // Where to cut the tube into halves. A ring that is already split into arcs
  // decides, because its corners are fixed; a ring that is one closed circle
  // gets its two vertices made at exactly those angles.
  const splitRing = rings.find((loop) => loop.length > 1 || geometry[loop[0]].kind !== 'circle');
  let angles;
  if (splitRing) {
    for (const id of splitRing) if (!ensureEdges(id)) return false;
    const joints = jointAngles(b, splitRing, geometry, edgesOfChain, angleOf);
    if (!joints) return false;
    angles = joints;
  } else {
    const first = topology.chains[rings[0][0]].points[0];
    const a0 = angleOf([V[3 * first], V[3 * first + 1], V[3 * first + 2]]);
    angles = [a0, a0 + Math.PI];
  }

  const built = rings.map((loop, index) => (loop.length === 1 && geometry[loop[0]].kind === 'circle'
    ? circleRing(b, V, model, region, index, loop, topology, geometry, angles, u1, u2, axis)
    : arcRing(b, loop, geometry, edgesOfChain, angles, angleOf, ensureEdges)));
  if (built.some((r) => r === null)) return false;

  const [A, B] = built;
  // The seams have to be rulings of the cylinder, so both ends of a seam must
  // sit at the same angle. If the rings were cut at different places, the
  // seam would cut through the body – then this region keeps its facets.
  for (const slot of [0, 1]) {
    const da = Math.abs(turn(angleOf(b.points[A.vs[slot]]) - angleOf(b.points[B.vs[slot]])));
    if (Math.min(da, 2 * Math.PI - da) > 1e-4) return false;
  }
  const seams = [0, 1].map((slot) => b.edge(A.vs[slot], B.vs[slot], { type: 'line' }, `:seam${region}:${slot}`));
  const surface = { type: 'cylinder', point: model.point, axis, ref: u1, radius: model.radius };
  const exact = A.kind === 'circle' && B.kind === 'circle';
  const zOf = (ring) => ring.height - dot(model.point, axis);
  for (const slot of [0, 1]) {
    const other = 1 - slot;
    b.face({
      surface,
      loops: [[
        ...A.arcFrom(slot),
        { edge: seams[other].edge, sense: seams[other].sense },
        ...B.arcFrom(other),
        { edge: seams[slot].edge, sense: !seams[slot].sense },
      ]],
      region,
      kind: 'cylinder',
      sameSense: model.outward !== false,
      // Two half circles share their two vertices, so their parameter range
      // cannot be read back from them and is recorded here. A half made of
      // several arcs carries enough vertices of its own.
      span: exact ? {
        theta0: angles[slot],
        theta1: angles[slot] + Math.PI,
        z0: Math.min(zOf(A), zOf(B)),
        z1: Math.max(zOf(A), zOf(B)),
        u1,
        u2,
        radius: model.radius,
      } : null,
    });
  }
  for (const ring of built) {
    for (const chainId of ring.chainIds) {
      edgesOfChain[chainId] = ring.usesOfChain.get(chainId);
      primary.set(keys[chainId], chainId);
    }
  }
  return true;
}

/** A ring that is one closed circle: two new vertices, two half circles. */
function circleRing(b, V, model, region, index, loop, topology, geometry, angles, u1, u2, axis) {
  const chainId = loop[0];
  const height = geometry[chainId].height;
  if (height === undefined) return null;
  const center = circleCenter(model, height);
  const vs = angles.map((angle, slot) => b.vertex(pointAt(center, u1, u2, model.radius, angle), `tube${region}:${index}:${slot}`));
  const halves = angles.map((angle, slot) => b.edge(
    vs[slot],
    vs[1 - slot],
    { type: 'circle', center, axis, radius: model.radius, ref: unitAt(u1, u2, angle) },
    `:tube${region}:${index}:${slot}`,
  ));
  const ccw = sweepSign(V, topology.chains[chainId].points, model, u1, u2) > 0;
  const arcFrom = (slot) => [ccw
    ? { edge: halves[slot].edge, sense: halves[slot].sense }
    : { edge: halves[1 - slot].edge, sense: !halves[1 - slot].sense }];
  return {
    kind: 'circle',
    vs,
    arcFrom,
    height,
    chainIds: [chainId],
    usesOfChain: new Map([[chainId, [...arcFrom(0), ...arcFrom(1)]]]),
  };
}

/**
 * A ring that is already split into arcs – which is what happens as soon as
 * the face around the bore is not one flat patch, because then every point of
 * the ring borders three regions. The existing corners are the cut points;
 * nothing new is created.
 */
function arcRing(b, loop, geometry, edgesOfChain, angles, angleOf, ensureEdges) {
  if (!loop.every((id) => geometry[id].kind === 'arc' || geometry[id].kind === 'circle')) return null;
  const uses = [];
  const chainOfUse = [];
  for (const id of loop) {
    for (const use of ensureEdges(id) ?? []) {
      uses.push(use);
      chainOfUse.push(id);
    }
  }
  if (uses.length < 2) return null;
  const startOf = (use) => (use.sense ? b.edges[use.edge].v0 : b.edges[use.edge].v1);
  const ownAngles = uses.map((use) => angleOf(b.points[startOf(use)]));
  const cut = angles.map((target) => {
    let best = -1;
    let bestError = Infinity;
    ownAngles.forEach((a, i) => {
      const d = Math.abs(((a - target + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (d < bestError) {
        bestError = d;
        best = i;
      }
    });
    return best;
  });
  if (cut[0] < 0 || cut[1] < 0 || cut[0] === cut[1]) return null;
  const run = (slot) => {
    const from = cut[slot];
    const to = cut[1 - slot];
    const out = [];
    for (let i = from; i !== to; i = (i + 1) % uses.length) {
      out.push(uses[i]);
      if (out.length > uses.length) return null;
    }
    return out;
  };
  const runs = [run(0), run(1)];
  if (runs.some((r) => r === null || r.length === 0)) return null;
  const usesOfChain = new Map();
  for (const id of loop) usesOfChain.set(id, []);
  uses.forEach((use, i) => usesOfChain.get(chainOfUse[i]).push(use));
  return {
    kind: 'arcs',
    vs: [startOf(uses[cut[0]]), startOf(uses[cut[1]])],
    arcFrom: (slot) => runs[slot],
    height: undefined,
    chainIds: loop,
    usesOfChain,
  };
}

/** Two cut angles from a ring that is already split: a corner and its opposite. */
function jointAngles(b, loop, geometry, edgesOfChain, angleOf) {
  const starts = [];
  for (const id of loop) {
    for (const use of edgesOfChain[id] ?? []) {
      const v = use.sense ? b.edges[use.edge].v0 : b.edges[use.edge].v1;
      starts.push(angleOf(b.points[v]));
    }
  }
  if (starts.length < 2) return null;
  const a0 = starts[0];
  let opposite = starts[1];
  let best = Infinity;
  for (const a of starts.slice(1)) {
    const d = Math.abs(Math.abs(((a - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (d < best) {
      best = d;
      opposite = a;
    }
  }
  return [a0, opposite];
}

/** Total signed sweep of a ring of mesh points around the axis. */
function sweepSign(V, points, model, u1, u2) {
  let total = 0;
  const angleOf = (v) => {
    const d = sub([V[3 * v], V[3 * v + 1], V[3 * v + 2]], model.point);
    return Math.atan2(dot(d, u2), dot(d, u1));
  };
  for (let i = 0; i + 1 < points.length; i++) {
    let step = angleOf(points[i + 1]) - angleOf(points[i]);
    while (step > Math.PI) step -= 2 * Math.PI;
    while (step < -Math.PI) step += 2 * Math.PI;
    total += step;
  }
  return total;
}

/** One planar face: the largest loop is the outer one, the rest are holes. */
function planeFace(b, V, region, model, loops, topology, edgesOfChain) {
  const built = loops.map((loop) => loop.flatMap((id) => edgesOfChain[id] ?? []));
  const usable = loops.map((_, i) => i).filter((i) => built[i].length > 0);
  if (usable.length === 0) return;
  const areas = loops.map((loop) => loopArea(V, loop, topology, model.normal));
  const order = usable.sort((x, y) => areas[y] - areas[x]);
  b.face({
    surface: { type: 'plane', point: model.point, normal: model.normal, ref: model.ref },
    loops: [built[order[0]], ...order.slice(1).map((i) => built[i])],
    region,
    kind: 'plane',
  });
}

/** Area of a loop in the plane of the region (outer loop vs. hole). */
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
 * A cylindrical region with a single loop (an open fillet). Its parameter
 * range is NOT recorded: the boundary points of such a face determine it
 * unambiguously, and brep.js reads it back from them. Only the two halves of
 * a tube need the range to be recorded, because they share their vertices.
 *
 * (Measured on fandisk.obj: computing the range from the arcs instead ignored
 * the direction the loop runs through an edge and turned a 90° fillet into a
 * sweep of 357°, which made the volume of the whole body absurd. The check
 * caught it, but a wrong range can stay below the one-percent limit in
 * another part and then nobody notices.)
 */
function cylinderFace(b, region, model, loops, edgesOfChain) {
  if (loops.length !== 1) return false;
  const uses = loops[0].flatMap((id) => edgesOfChain[id] ?? []);
  if (uses.length === 0) return false;
  const { axis, u1 } = cylinderFrame(model);
  b.face({
    surface: { type: 'cylinder', point: model.point, axis, ref: u1, radius: model.radius },
    loops: [uses],
    region,
    kind: 'cylinder',
    sameSense: model.outward !== false,
  });
  return true;
}

/** The plane of a patch, as a model for buildTopology/buildBrep. */
export function planeModel(plane) {
  return { type: 'plane', point: plane.point, normal: normalize(plane.normal) };
}

/** A cylinder as a model: a point on the axis, direction, radius. */
export function cylinderModel(cylinder) {
  const axis = normalize(cylinder.axis);
  const { u1 } = frame(axis);
  return {
    type: 'cylinder',
    point: cylinder.center,
    axis,
    radius: cylinder.radius,
    ref: cylinder.model?.u1 ?? u1,
    // A bore has its outward normal pointing AT the axis: same_sense = .F.
    outward: cylinder.outward !== false,
    uncertainty: cylinder.uncertainty,
  };
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
