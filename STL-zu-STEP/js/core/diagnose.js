// Diagnosis of a mesh without changing it (docs/SPEC.md 5.3): what is wrong,
// counted, in the same terms the repair uses. healMesh() repairs, this module
// only looks – before and after, so that the report can show both side by side.

import { bbox, components, edgeTable, signedVolume } from './meshops.js';
import { boundaryLoops, isDegenerateTriangle } from './heal.js';
import { TripleSet, countSelfIntersections } from './spatial.js';

/** Above this many triangles the self-intersection test is skipped (it is the one slow check). */
export const MAX_INTERSECTION_TRIANGLES = 200000;

/**
 * diagnose(V, F, opts?) → MeshReport
 *   triangles, points, unusedPoints, bbox, volume, shells,
 *   boundaryEdges (edges with a single triangle), holes (boundary loops),
 *   nonManifoldEdges (more than two triangles), nonManifoldVertices (points
 *   where the surface pinches: the triangles around them are not one fan),
 *   windingConflicts (neighbours that run an edge the same way),
 *   degenerate, duplicate, inverted (volume < 0), watertight,
 *   selfIntersections: { count, capped } or null when not checked, with the reason.
 * opts: { intersections: true | false (default true), maxIntersectionTriangles }
 */
export function diagnose(V, F, opts = {}) {
  const n = F.length / 3;
  const box = bbox(V);
  const { count: groups, start, members, group } = edgeTable(F);

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let windingConflicts = 0;
  for (let g = 0; g < groups; g++) {
    const size = start[g + 1] - start[g];
    if (size === 1) boundaryEdges += 1;
    else if (size > 2) nonManifoldEdges += 1;
    else {
      const [e1, e2] = [members[start[g]], members[start[g] + 1]];
      const [u1, v1] = [F[e1], F[e1 % 3 === 2 ? e1 - 2 : e1 + 1]];
      const [u2, v2] = [F[e2], F[e2 % 3 === 2 ? e2 - 2 : e2 + 1]];
      if (u1 === u2 && v1 === v2) windingConflicts += 1;
    }
  }

  // Degenerate and duplicate triangles, by the same rule healMesh() uses.
  const seen = new TripleSet(n);
  let degenerate = 0;
  let duplicate = 0;
  for (let t = 0; t < n; t++) {
    if (isDegenerateTriangle(V, F, t, box.diagonal)) degenerate += 1;
    else if (!seen.add(F[3 * t], F[3 * t + 1], F[3 * t + 2])) duplicate += 1;
  }

  const used = new Uint8Array(V.length / 3);
  for (let i = 0; i < F.length; i++) used[F[i]] = 1;
  const unusedPoints = used.reduce((s, u) => s + (u ? 0 : 1), 0);

  const volume = signedVolume(V, F);
  const holes = boundaryEdges > 0 ? boundaryLoops(F).map((loop) => loop.length) : [];
  const report = {
    triangles: n,
    points: V.length / 3,
    unusedPoints,
    bbox: { lo: [...box.lo], hi: [...box.hi], diagonal: box.diagonal },
    volume,
    shells: n > 0 ? components(F).count : 0,
    boundaryEdges,
    holes,
    nonManifoldEdges,
    nonManifoldVertices: countPinchPoints(F, group, start, members, V.length / 3),
    windingConflicts,
    degenerate,
    duplicate,
    inverted: volume < 0,
    watertight: false,
    selfIntersections: null,
    selfIntersectionsSkipped: null,
  };
  report.watertight = n > 0 && boundaryEdges === 0 && nonManifoldEdges === 0 && windingConflicts === 0;

  const limit = opts.maxIntersectionTriangles ?? MAX_INTERSECTION_TRIANGLES;
  if (opts.intersections === false) report.selfIntersectionsSkipped = 'nicht angefordert';
  else if (n > limit) report.selfIntersectionsSkipped = `mehr als ${limit.toLocaleString('de-DE')} Dreiecke`;
  else {
    const found = countSelfIntersections(V, F);
    report.selfIntersections = { count: found.count, capped: found.capped };
  }
  return report;
}

/**
 * Points where two parts of the surface touch in a single point: the
 * triangles around such a point do not form one fan over shared edges.
 */
function countPinchPoints(F, group, start, members, pointCount) {
  const vStart = new Uint32Array(pointCount + 1);
  for (let i = 0; i < F.length; i++) vStart[F[i] + 1]++;
  for (let v = 0; v < pointCount; v++) vStart[v + 1] += vStart[v];
  const around = new Uint32Array(F.length);
  const fill = vStart.slice(0, pointCount);
  for (let i = 0; i < F.length; i++) around[fill[F[i]]++] = i; // half-edge slots that start or end here
  let pinch = 0;
  for (let v = 0; v < pointCount; v++) {
    const k = vStart[v + 1] - vStart[v];
    if (k < 2) continue;
    // Triangles at v are connected when they share an edge that contains v:
    // every corner of v contributes the edges leaving it and arriving at it.
    const tris = [];
    const edgeOwner = new Map(); // edge group → local triangle index
    const parent = [];
    const find = (x) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    for (let i = vStart[v]; i < vStart[v + 1]; i++) {
      const corner = around[i];
      const t = (corner / 3) | 0;
      const local = tris.length;
      tris.push(t);
      parent.push(local);
      const slot = corner % 3;
      // The edges of triangle t that contain the corner: slot (leaves v) and slot-1 (arrives at v).
      for (const e of [3 * t + slot, 3 * t + ((slot + 2) % 3)]) {
        const g = group[e];
        const other = edgeOwner.get(g);
        if (other === undefined) edgeOwner.set(g, local);
        else parent[find(local)] = find(other);
      }
    }
    const root = find(0);
    for (let i = 1; i < tris.length; i++) {
      if (find(i) !== root) {
        pinch += 1;
        break;
      }
    }
  }
  return pinch;
}
