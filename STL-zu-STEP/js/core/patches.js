// Flat patches: connected groups of triangles that share one plane
// (docs/SPEC.md 5.4). Everything that follows works on patches, not on single
// triangles, because triangle seeds depend on how the file was triangulated:
// docs/MACHBARKEIT.md section 2 measured 0 cylinders on subdivided meshes
// that way, while patches give the same 134 patches for platte.stl and both
// subdivided versions.

import { bbox, triangleNormals, adjacency, neighbours } from './meshops.js';

/** Thresholds from SPEC 5.4: clean mesh, and the relaxed pair for noise. */
export const PATCH_ANGLE_DEGREES = 2;
export const PATCH_OFFSET_RELATIVE = 1e-3;
export const NOISY_ANGLE_DEGREES = 5;
export const NOISY_OFFSET_RELATIVE = 2e-2;

/**
 * growPatches({ V, F }, opts?) → { labels, patches, planes, noisy, options }
 *   labels  Int32Array: triangle → patch
 *   patches Array<Int32Array>: patch → triangles, seeds by descending area
 *   planes  Array<{ point, normal }>: area-weighted plane of the patch
 *
 * opts: { noisy, angleDegrees, offsetRelative }. The relaxed thresholds for a
 * noisy mesh are switched on by the caller (option "grobe Toleranz" in the
 * interface), never guessed here: SPEC 5.4 wanted to estimate the noise from
 * the scatter of the points around the patch plane, but that scatter is just
 * as large on a legitimately curved surface – measured on kegel.stl, where it
 * relaxed the thresholds and merged the bands of the cone into 49 patches
 * instead of the 116 of the reference (noted in SPEC 5.4).
 *
 * Whichever thresholds were used are returned in `options` and go into the
 * report, so a result can always be traced back to them.
 */
export function growPatches(mesh, opts = {}) {
  const { V, F } = mesh;
  const box = bbox(V);
  const { N, area } = triangleNormals(V, F);
  const adj = adjacency(F);
  const order = Int32Array.from({ length: F.length / 3 }, (_, i) => i).sort((a, b) => area[b] - area[a]);

  const noisy = opts.noisy === true || opts.key === 'grob';
  const angleDegrees = opts.angleDegrees ?? (noisy ? NOISY_ANGLE_DEGREES : PATCH_ANGLE_DEGREES);
  const offset = (opts.offsetRelative ?? (noisy ? NOISY_OFFSET_RELATIVE : PATCH_OFFSET_RELATIVE)) * box.diagonal;
  const result = grow(V, F, N, area, adj, order, angleDegrees, offset);
  return { ...result, noisy, options: { angleDegrees, offset, diagonal: box.diagonal } };
}

function grow(V, F, N, area, adj, order, angleDegrees, offset) {
  const n = F.length / 3;
  const limit = Math.cos((angleDegrees * Math.PI) / 180);
  const labels = new Int32Array(n).fill(-1);
  const patches = [];
  const stack = new Int32Array(n);

  for (const seed of order) {
    if (labels[seed] >= 0) continue;
    const id = patches.length;
    labels[seed] = id;
    const sx = N[3 * seed];
    const sy = N[3 * seed + 1];
    const sz = N[3 * seed + 2];
    // Plane of the seed through its first point.
    const o = 3 * F[3 * seed];
    const ox = V[o];
    const oy = V[o + 1];
    const oz = V[o + 2];
    const members = [seed];
    let top = 0;
    stack[top++] = seed;
    while (top > 0) {
      const t = stack[--top];
      for (const u of neighbours(adj, t)) {
        if (labels[u] >= 0) continue;
        if (N[3 * u] * sx + N[3 * u + 1] * sy + N[3 * u + 2] * sz <= limit) continue;
        let far = 0;
        for (let k = 0; k < 3; k++) {
          const v = 3 * F[3 * u + k];
          const d = Math.abs((V[v] - ox) * sx + (V[v + 1] - oy) * sy + (V[v + 2] - oz) * sz);
          if (d > far) far = d;
        }
        if (far >= offset) continue;
        labels[u] = id;
        members.push(u);
        stack[top++] = u;
      }
    }
    patches.push(Int32Array.from(members));
  }
  return { labels, patches, planes: patches.map((tris) => patchPlane(V, F, N, area, tris)) };
}

/** Area-weighted normal and centroid of the points of a patch. */
export function patchPlane(V, F, N, area, tris) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const t of tris) {
    nx += N[3 * t] * area[t];
    ny += N[3 * t + 1] * area[t];
    nz += N[3 * t + 2] * area[t];
  }
  let len = Math.hypot(nx, ny, nz);
  if (len < 1e-18) {
    const t = tris[0];
    nx = N[3 * t];
    ny = N[3 * t + 1];
    nz = N[3 * t + 2];
    len = Math.hypot(nx, ny, nz) || 1;
  }
  const normal = [nx / len, ny / len, nz / len];
  const seen = new Set();
  const point = [0, 0, 0];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = F[3 * t + k];
      if (seen.has(v)) continue;
      seen.add(v);
      point[0] += V[3 * v];
      point[1] += V[3 * v + 1];
      point[2] += V[3 * v + 2];
    }
  }
  for (let k = 0; k < 3; k++) point[k] /= seen.size;
  return { point, normal };
}

/**
 * Patches that are connected smoothly: the dihedral angle between two
 * neighbouring triangles of different patches stays below `maxAngleDegrees`
 * (SPEC 5.5 step 1). Returns a Map patch → Set of patches.
 */
export function patchGraph(mesh, labels, maxAngleDegrees = 50) {
  const { V, F } = mesh;
  const { N } = triangleNormals(V, F);
  const adj = adjacency(F);
  const limit = Math.cos((maxAngleDegrees * Math.PI) / 180);
  const graph = new Map();
  const link = (a, b) => {
    const set = graph.get(a);
    if (set) set.add(b);
    else graph.set(a, new Set([b]));
  };
  for (let t = 0; t < F.length / 3; t++) {
    for (const u of neighbours(adj, t)) {
      if (labels[t] === labels[u]) continue;
      if (N[3 * t] * N[3 * u] + N[3 * t + 1] * N[3 * u + 1] + N[3 * t + 2] * N[3 * u + 2] <= limit) continue;
      link(labels[t], labels[u]);
      link(labels[u], labels[t]);
    }
  }
  return graph;
}
