// Healing a mesh (docs/SPEC.md 5.3). The order of the steps is binding: every
// later step relies on what the earlier ones cleaned up.
//
//   1. degenerate and duplicate triangles
//   2. T-junctions (a point in the interior of someone else's edge)
//   3. non-manifold edges (more than two triangles)
//   4. winding, consistent per component
//   5. holes (loops up to MAX_HOLE_EDGES; longer ones stay open)
//   6. overall direction per component (sign of the volume)
//   7. components, each of which becomes its own solid
//
// Every step counts what it found; the report is what the user sees. Measured
// in docs/MACHBARKEIT.md section 3 – especially the two cases the Python
// prototype got wrong: a second body must not be lost silently, and an edge
// with three triangles must lose the surplus one.

import { bbox, components, edgeTable, openHalfEdges, signedVolume, splitComponents, edgeKey, triangleNormals } from './meshops.js';
import { HashGrid } from './weld.js';

/** Loops with more edges than this stay open (SPEC 5.3 step 5). */
export const MAX_HOLE_EDGES = 64;
/** Area below (AREA_EPS_RELATIVE · diagonal)² counts as degenerate. */
export const AREA_EPS_RELATIVE = 1e-6;
/** A point this far from an edge sits on it (multiple of the welding tolerance). */
export const T_JUNCTION_TOL_FACTOR = 5;
/**
 * A filled hole counts as large – its patch is only an estimate of the real
 * surface – from this many edges, or when it spans this share of the diagonal.
 */
export const LARGE_HOLE_EDGES = 16;
export const LARGE_HOLE_DIAGONAL_FRACTION = 0.05;

/**
 * A triangle with a repeated corner or (almost) no area – the rule of step 1,
 * for callers that only want to ask (diagnose, validate).
 */
export function isDegenerateTriangle(V, F, t, diagonal) {
  const [a, b, c] = [F[3 * t], F[3 * t + 1], F[3 * t + 2]];
  if (a === b || b === c || a === c) return true;
  const e1 = [V[3 * b] - V[3 * a], V[3 * b + 1] - V[3 * a + 1], V[3 * b + 2] - V[3 * a + 2]];
  const e2 = [V[3 * c] - V[3 * a], V[3 * c + 1] - V[3 * a + 1], V[3 * c + 2] - V[3 * a + 2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  const areaEps = (diagonal * AREA_EPS_RELATIVE) ** 2;
  return (nx * nx + ny * ny + nz * nz) / 4 < areaEps * areaEps;
}

/**
 * healMesh({ V, F }, opts?) → { V, F, report, components }
 * opts: { weldTol, maxHoleEdges, fillHoles, splitTJunctions } – every repair
 * can be switched off, and then says so in the report.
 * Optional, off unless given: { minShellTriangles, minShellVolume } drops tiny
 * loose shells (fewer triangles than the first, or a volume below that share
 * of the largest shell), and { largeHoleEdges, largeHoleDiagonalFraction }
 * sets when a filled hole is reported as large.
 * The report also carries the time of every step in milliseconds.
 */
export function healMesh(mesh, opts = {}) {
  const V0 = mesh.V;
  const box = bbox(V0);
  const weldTol = opts.weldTol ?? Math.max(box.diagonal * 1e-5, Number.MIN_VALUE);
  const maxHoleEdges = opts.maxHoleEdges ?? MAX_HOLE_EDGES;
  const report = {
    weldTol,
    points: V0.length / 3,
    triangles: mesh.F.length / 3,
    degenerate: 0,
    duplicate: 0,
    tJunctionsSplit: 0,
    nonManifoldRemoved: 0,
    flipped: 0,
    holesFilled: 0,
    holesOpen: [],
    holesLarge: [],
    shellsRemoved: [],
    unusedPoints: 0,
    components: 1,
    orientedGlobally: false,
    skipped: [],
    timings: {},
  };
  let lapStart = performance.now();
  const lap = (name) => {
    const now = performance.now();
    report.timings[name] = Math.round(now - lapStart);
    lapStart = now;
  };

  let V = Float64Array.from(V0);
  let F = Uint32Array.from(mesh.F);

  F = dropBadTriangles(V, F, (box.diagonal * AREA_EPS_RELATIVE) ** 2, report);
  lap('entartete und doppelte Dreiecke');

  if (opts.splitTJunctions === false) report.skipped.push('T-Kreuzungen');
  else F = splitTJunctions(V, F, weldTol * T_JUNCTION_TOL_FACTOR, box.diagonal, report);
  lap('T-Kreuzungen');

  F = dropNonManifold(V, F, report);
  lap('nicht-manifold Kanten');

  F = orientConsistently(F, report);
  lap('Orientierung');

  const largeHole = {
    edges: opts.largeHoleEdges ?? LARGE_HOLE_EDGES,
    diameter: box.diagonal * (opts.largeHoleDiagonalFraction ?? LARGE_HOLE_DIAGONAL_FRACTION),
  };
  if (opts.fillHoles === false) report.skipped.push('Löcher füllen');
  else F = fillHoles(V, F, maxHoleEdges, report, largeHole);

  // Filling may insert triangles against the winding of their neighbours –
  // but only then, and the pass costs a full run over the mesh.
  if (report.holesFilled > 0) F = orientConsistently(F, report);
  lap('Löcher');

  ({ V, F } = dropUnusedPoints(V, F, report));

  // orientGlobally needs the components anyway, so it hands them back.
  const oriented = orientGlobally(V, F, report);
  F = oriented.F;
  let parts = oriented.parts;
  lap('Schalen und Richtung');

  const trimmed = dropSmallShells(V, F, parts, opts, report);
  if (trimmed) {
    ({ V, F } = dropUnusedPoints(trimmed.V, trimmed.F, report));
    parts = splitComponents(V, F);
    lap('kleine Schalen');
  }
  report.components = parts.length;
  report.points = V.length / 3;
  report.triangles = F.length / 3;
  return { V, F, report, components: parts };
}

/** 1. Triangles with a repeated index, without area, or occurring twice. */
function dropBadTriangles(V, F, areaEps, report) {
  const n = F.length / 3;
  const seen = new Set();
  const keep = [];
  for (let t = 0; t < n; t++) {
    const a = F[3 * t];
    const b = F[3 * t + 1];
    const c = F[3 * t + 2];
    if (a === b || b === c || a === c) {
      report.degenerate += 1;
      continue;
    }
    const e1 = [V[3 * b] - V[3 * a], V[3 * b + 1] - V[3 * a + 1], V[3 * b + 2] - V[3 * a + 2]];
    const e2 = [V[3 * c] - V[3 * a], V[3 * c + 1] - V[3 * a + 1], V[3 * c + 2] - V[3 * a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    if ((nx * nx + ny * ny + nz * nz) / 4 < areaEps * areaEps) {
      report.degenerate += 1;
      continue;
    }
    const sorted = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(sorted)) {
      report.duplicate += 1;
      continue;
    }
    seen.add(sorted);
    keep.push(a, b, c);
  }
  return Uint32Array.from(keep);
}

/**
 * 2. T-junctions. Only unpaired edges can carry one, so the candidates are the
 * points of open edges – a grid over those keeps this linear instead of
 * testing every point against every edge.
 */
function splitTJunctions(V, F, tol, diagonal, report) {
  let faces = Array.from(F);
  for (let round = 0; round < 8; round += 1) {
    const open = openDirectedEdges(faces);
    if (open.length === 0) break;
    const candidates = new Set();
    for (const [u, v] of open) {
      candidates.add(u);
      candidates.add(v);
    }
    const ids = [...candidates];
    const points = new Float64Array(3 * ids.length);
    ids.forEach((v, i) => points.set([V[3 * v], V[3 * v + 1], V[3 * v + 2]], 3 * i));
    const cell = Math.max(diagonal / 64, tol);
    const grid = new HashGrid(cell, points);

    const splits = new Map(); // triangle → [edge index, point]
    for (const [u, v, t, slot] of open) {
      const ax = V[3 * u];
      const ay = V[3 * u + 1];
      const az = V[3 * u + 2];
      const ex = V[3 * v] - ax;
      const ey = V[3 * v + 1] - ay;
      const ez = V[3 * v + 2] - az;
      const len2 = ex * ex + ey * ey + ez * ez;
      if (len2 < tol * tol || splits.has(t)) continue;
      const len = Math.sqrt(len2);
      const steps = Math.max(1, Math.ceil(len / cell));
      const hits = new Set();
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        for (const i of grid.within(ax + f * ex, ay + f * ey, az + f * ez, cell)) hits.add(ids[i]);
      }
      let best = -1;
      let bestParam = 0;
      for (const k of hits) {
        if (k === u || k === v) continue;
        const px = V[3 * k] - ax;
        const py = V[3 * k + 1] - ay;
        const pz = V[3 * k + 2] - az;
        const s = (px * ex + py * ey + pz * ez) / len2;
        if (s <= 1e-6 || s >= 1 - 1e-6) continue;
        const dx = px - s * ex;
        const dy = py - s * ey;
        const dz = pz - s * ez;
        if (Math.hypot(dx, dy, dz) > tol) continue;
        if (best < 0 || s < bestParam) {
          best = k;
          bestParam = s;
        }
      }
      if (best >= 0) splits.set(t, [slot, best]);
    }
    if (splits.size === 0) break;

    const next = [];
    for (let t = 0; t < faces.length / 3; t++) {
      const tri = [faces[3 * t], faces[3 * t + 1], faces[3 * t + 2]];
      const split = splits.get(t);
      if (!split) {
        next.push(...tri);
        continue;
      }
      const [slot, k] = split;
      const u = tri[slot];
      const v = tri[(slot + 1) % 3];
      const w = tri[(slot + 2) % 3];
      next.push(u, k, w, k, v, w);
      report.tJunctionsSplit += 1;
    }
    faces = next;
  }
  return Uint32Array.from(faces);
}

/** Open directed edges as [u, v, triangle, slot]. */
function openDirectedEdges(faces) {
  const F = faces instanceof Uint32Array ? faces : Uint32Array.from(faces);
  return openHalfEdges(F).map((e) => [F[e], F[e % 3 === 2 ? e - 2 : e + 1], (e / 3) | 0, e % 3]);
}

/**
 * 3. Non-manifold edges. A triangle that touches such an edge and has an open
 * edge of its own cannot be part of a closed shell: it is a flap and goes
 * first. Only if that is not enough does the smallest triangle on the edge go
 * (SPEC 5.3 step 3; the Python prototype left this case unsolved).
 */
function dropNonManifold(V, F, report) {
  let faces = Uint32Array.from(F);
  for (let round = 0; round < 32; round += 1) {
    const { count, group, start, members } = edgeTable(faces);
    const size = (g) => start[g + 1] - start[g];
    const bad = [];
    for (let g = 0; g < count; g++) if (size(g) > 2) bad.push(g);
    if (bad.length === 0) break;
    const { area } = triangleNormals(V, faces);
    const victims = new Set();
    for (const g of bad) {
      const tris = Array.from(members.subarray(start[g], start[g + 1]), (e) => (e / 3) | 0);
      const surplus = tris.length - 2;
      // A flap has an edge nobody else uses; otherwise take the smallest.
      const flap = (t) => [0, 1, 2].filter((slot) => size(group[3 * t + slot]) === 1).length;
      const ranked = tris.sort((x, y) => {
        const fx = flap(x);
        const fy = flap(y);
        if (fx !== fy) return fy - fx;
        return area[x] - area[y];
      });
      for (let i = 0; i < surplus; i++) victims.add(ranked[i]);
    }
    const keep = [];
    for (let t = 0; t < faces.length / 3; t++) {
      if (victims.has(t)) {
        report.nonManifoldRemoved += 1;
        continue;
      }
      keep.push(faces[3 * t], faces[3 * t + 1], faces[3 * t + 2]);
    }
    faces = Uint32Array.from(keep);
  }
  return faces;
}

/**
 * 4. Winding, consistent per component: breadth-first search over edges with
 * two triangles. A neighbour that uses the shared edge in the same direction
 * contradicts and is turned around.
 */
function orientConsistently(F, report) {
  const faces = Uint32Array.from(F);
  const n = faces.length / 3;
  const { group, start, members } = edgeTable(faces);
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  for (let seed = 0; seed < n; seed++) {
    if (seen[seed]) continue;
    seen[seed] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    while (head < tail) {
      const t = queue[head++];
      for (let slot = 0; slot < 3; slot++) {
        const g = group[3 * t + slot];
        if (start[g + 1] - start[g] !== 2) continue;
        const first = (members[start[g]] / 3) | 0;
        const other = first === t ? (members[start[g] + 1] / 3) | 0 : first;
        if (seen[other]) continue;
        // Same undirected edge, so the neighbour contradicts when it runs the same way.
        const u = faces[3 * t + slot];
        const v = faces[3 * t + ((slot + 1) % 3)];
        let sameDirection = false;
        for (let k = 0; k < 3; k++) {
          if (faces[3 * other + k] === u && faces[3 * other + ((k + 1) % 3)] === v) sameDirection = true;
        }
        if (sameDirection) {
          // Swapping two corners moves the edges of the table: slot 0 and 2 trade places.
          const tmp = faces[3 * other + 1];
          faces[3 * other + 1] = faces[3 * other + 2];
          faces[3 * other + 2] = tmp;
          const g0 = group[3 * other];
          group[3 * other] = group[3 * other + 2];
          group[3 * other + 2] = g0;
          report.flipped += 1;
        }
        seen[other] = 1;
        queue[tail++] = other;
      }
    }
  }
  return faces;
}

/** Boundary loops of directed edges without an opposite. */
export function boundaryLoops(F) {
  const open = openDirectedEdges(F);
  const next = new Map();
  for (const [u, v] of open) {
    const list = next.get(u);
    if (list) list.push(v);
    else next.set(u, [v]);
  }
  const used = new Set();
  const loops = [];
  for (const [u, v] of open) {
    if (used.has(edgeKey(u, v))) continue;
    used.add(edgeKey(u, v));
    const loop = [u, v];
    let cur = v;
    while (cur !== u && loop.length < 1e6) {
      const candidates = (next.get(cur) || []).filter((w) => !used.has(edgeKey(cur, w)));
      if (candidates.length === 0) break;
      used.add(edgeKey(cur, candidates[0]));
      cur = candidates[0];
      if (cur === u) break;
      loop.push(cur);
    }
    if (cur === u) loops.push(loop);
    else loops.push(Object.assign(loop, { broken: true }));
  }
  return loops;
}

/**
 * 5. Holes: ear clipping in the best-fit plane of the loop. The new triangles
 * run against the loop, because the loop follows the half-edges that are
 * still missing their partner.
 */
function fillHoles(V, F, maxEdges, report, large = { edges: Infinity, diameter: Infinity }) {
  const faces = Array.from(F);
  for (const loop of boundaryLoops(faces)) {
    const center = loopCenter(V, loop);
    if (loop.broken || loop.length > maxEdges || loop.length < 3) {
      report.holesOpen.push({ edges: loop.length, center, reason: loop.broken ? 'Randschleife schließt nicht' : `Schleife mit ${loop.length} Kanten` });
      continue;
    }
    const added = earClip(V, loop);
    if (!added) {
      report.holesOpen.push({ edges: loop.length, center, reason: 'Ohrenschnitt fand kein Ohr' });
      continue;
    }
    for (const [a, b, c] of added) faces.push(c, b, a); // against the loop
    report.holesFilled += 1;
    const diameter = loopDiameter(V, loop);
    // A hole of three edges is one missing triangle: only one patch fits, nothing to estimate.
    if (loop.length > 3 && (loop.length >= large.edges || diameter >= large.diameter)) {
      report.holesLarge.push({ edges: loop.length, diameter, center });
    }
  }
  return Uint32Array.from(faces);
}

/** Diagonal of the box around the points of a loop: how far across the hole is. */
function loopDiameter(V, loop) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const i of loop) {
    for (let k = 0; k < 3; k++) {
      if (V[3 * i + k] < lo[k]) lo[k] = V[3 * i + k];
      if (V[3 * i + k] > hi[k]) hi[k] = V[3 * i + k];
    }
  }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

function loopCenter(V, loop) {
  const c = [0, 0, 0];
  for (const i of loop) for (let k = 0; k < 3; k++) c[k] += V[3 * i + k] / loop.length;
  return c;
}

/** Ear clipping in the plane of the loop; null when no ear is left. */
function earClip(V, loop) {
  const center = loopCenter(V, loop);
  const n = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const ax = V[3 * a] - center[0];
    const ay = V[3 * a + 1] - center[1];
    const az = V[3 * a + 2] - center[2];
    const bx = V[3 * b] - center[0];
    const by = V[3 * b + 1] - center[1];
    const bz = V[3 * b + 2] - center[2];
    n[0] += ay * bz - az * by;
    n[1] += az * bx - ax * bz;
    n[2] += ax * by - ay * bx;
  }
  const len = Math.hypot(...n);
  if (len < 1e-18) return null;
  for (let k = 0; k < 3; k++) n[k] /= len;
  let ax = cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const al = Math.hypot(...ax);
  ax = ax.map((v) => v / al);
  const ay = cross(n, ax);
  const xy = (i) => {
    const d = [V[3 * i] - center[0], V[3 * i + 1] - center[1], V[3 * i + 2] - center[2]];
    return [d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2], d[0] * ay[0] + d[1] * ay[1] + d[2] * ay[2]];
  };
  const ids = loop.slice();
  const out = [];
  let guard = 0;
  while (ids.length > 3 && guard++ < 10000) {
    let ear = -1;
    for (let k = 0; k < ids.length; k++) {
      const a = ids[(k - 1 + ids.length) % ids.length];
      const b = ids[k];
      const c = ids[(k + 1) % ids.length];
      const pa = xy(a);
      const pb = xy(b);
      const pc = xy(c);
      const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      if (area <= 1e-12) continue;
      let inside = false;
      for (const o of ids) {
        if (o === a || o === b || o === c) continue;
        const q = xy(o);
        const d1 = (pb[0] - pa[0]) * (q[1] - pa[1]) - (pb[1] - pa[1]) * (q[0] - pa[0]);
        const d2 = (pc[0] - pb[0]) * (q[1] - pb[1]) - (pc[1] - pb[1]) * (q[0] - pb[0]);
        const d3 = (pa[0] - pc[0]) * (q[1] - pc[1]) - (pa[1] - pc[1]) * (q[0] - pc[0]);
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) {
          inside = true;
          break;
        }
      }
      if (!inside) {
        ear = k;
        break;
      }
    }
    if (ear < 0) return null;
    const a = ids[(ear - 1 + ids.length) % ids.length];
    const b = ids[ear];
    const c = ids[(ear + 1) % ids.length];
    out.push([a, b, c]);
    ids.splice(ear, 1);
  }
  if (ids.length !== 3) return null;
  out.push([ids[0], ids[1], ids[2]]);
  return out;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * 6. Overall direction per component: a negative volume is inside out.
 * Returns the triangles AND the components, because splitting the mesh is the
 * expensive part and the caller needs them too.
 */
function orientGlobally(V, F, report) {
  const faces = Uint32Array.from(F);
  let parts = splitComponents(V, faces);
  const flip = new Set();
  parts.forEach((part, i) => {
    if (signedVolume(part.V, part.F) < 0) flip.add(i);
  });
  if (flip.size === 0) return { F: faces, parts };
  const labels = components(faces).label;
  for (let t = 0; t < faces.length / 3; t++) {
    if (!flip.has(labels[t])) continue;
    const tmp = faces[3 * t + 1];
    faces[3 * t + 1] = faces[3 * t + 2];
    faces[3 * t + 2] = tmp;
  }
  report.orientedGlobally = true;
  parts = splitComponents(V, faces); // the turned triangles belong to the parts
  return { F: faces, parts };
}

/** Points no triangle uses any more (left over from removed triangles). */
function dropUnusedPoints(V, F, report) {
  const used = new Uint8Array(V.length / 3);
  for (const v of F) used[v] = 1;
  let unused = 0;
  for (const u of used) if (!u) unused += 1;
  if (unused === 0) return { V, F };
  const remap = new Int32Array(V.length / 3).fill(-1);
  const out = [];
  for (let i = 0; i < V.length / 3; i++) {
    if (!used[i]) continue;
    remap[i] = out.length / 3;
    out.push(V[3 * i], V[3 * i + 1], V[3 * i + 2]);
  }
  const faces = Uint32Array.from(F, (v) => remap[v]);
  report.unusedPoints += unused;
  return { V: Float64Array.from(out), F: faces };
}

/**
 * 8. Tiny loose shells (optional, off by default): floating specks from a
 * scan or a slicer. A shell goes when it has fewer triangles than
 * `minShellTriangles` or a volume below `minShellVolume` times that of the
 * largest shell. At least one shell always stays. Every shell that goes is
 * named in the report with its size – nothing disappears silently.
 */
function dropSmallShells(V, F, parts, opts, report) {
  const minTriangles = opts.minShellTriangles ?? 0;
  const minVolume = opts.minShellVolume ?? 0;
  if (!(minTriangles > 0 || minVolume > 0) || parts.length < 2) return null;
  const volumes = parts.map((part) => Math.abs(signedVolume(part.V, part.F)));
  const largest = volumes.reduce((best, v) => (v > best ? v : best), 0);
  const drop = parts.map((part, i) => part.F.length / 3 < minTriangles || volumes[i] < minVolume * largest);
  if (!drop.includes(true) || !drop.includes(false)) return null;
  parts.forEach((part, i) => {
    if (drop[i]) report.shellsRemoved.push({ triangles: part.F.length / 3, volume: volumes[i] });
  });
  const label = components(F).label;
  const keep = [];
  for (let t = 0; t < F.length / 3; t++) {
    if (!drop[label[t]]) keep.push(F[3 * t], F[3 * t + 1], F[3 * t + 2]);
  }
  return { V, F: Uint32Array.from(keep) };
}
