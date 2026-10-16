// Welding a triangle soup into a shared vertex list (docs/SPEC.md 5.2).
//
// Measured in docs/MACHBARKEIT.md section 3: with tol = 1e-5 · diagonal the
// file whose points are shifted by 2e-5 per triangle falls back to the 264
// points of the clean file.
//
// Two passes, because a mesh file writes every point once per triangle:
//   1. identical points (same cell of a fine grid, q = tol/64) become one –
//      this alone turns 3·n coordinates into roughly n/2 candidates;
//   2. candidates closer than tol are merged with union-find over the 27
//      neighbouring cells of a grid with cell size tol.
// Both passes hash the integer cell triple into a number: string keys cost
// more than the whole rest of the step (measured: 2.2 s vs. 0.3 s for
// 100 000 triangles).

import { soupBounds } from './parse.js';

/** Default tolerance, relative to the bounding box diagonal (SPEC 5.2). */
export const WELD_TOL_RELATIVE = 1e-5;

const hashCell = (ix, iy, iz) => (((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & 0x7fffffff);

/** Union-find over `count` elements, iterative and with path compression. */
export function makeUnionFind(count) {
  const parent = new Uint32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return false;
      parent[ra < rb ? rb : ra] = ra < rb ? ra : rb; // smallest index wins: the first point stays the representative
      return true;
    },
  };
}

/**
 * weldMesh(tris, tol?) → { V: Float64Array(3·m), F: Uint32Array(3·n), tol }
 * The order of the triangles is kept; the representative of a group of points
 * is the one that comes first in the file.
 */
export function weldMesh(tris, tol) {
  const bounds = soupBounds(tris);
  const weldTol = tol !== undefined ? tol : Math.max(bounds.diagonal * WELD_TOL_RELATIVE, Number.MIN_VALUE);
  const count = tris.length / 3;

  // Pass 1: identical points (fine grid) → candidate list.
  const q = weldTol / 64;
  const heads = new Map();
  const next = new Int32Array(count).fill(-1);
  const cells = new Int32Array(3 * count);
  const candidate = new Int32Array(count); // point → candidate index
  const candidateOf = []; // candidate index → first point
  for (let i = 0; i < count; i++) {
    const ix = Math.floor(tris[3 * i] / q);
    const iy = Math.floor(tris[3 * i + 1] / q);
    const iz = Math.floor(tris[3 * i + 2] / q);
    const h = hashCell(ix, iy, iz);
    let found = -1;
    for (let j = heads.get(h) ?? -1; j >= 0; j = next[j]) {
      if (cells[3 * j] === ix && cells[3 * j + 1] === iy && cells[3 * j + 2] === iz) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      candidate[i] = candidate[found];
      continue;
    }
    cells[3 * i] = ix;
    cells[3 * i + 1] = iy;
    cells[3 * i + 2] = iz;
    next[i] = heads.get(h) ?? -1;
    heads.set(h, i);
    candidate[i] = candidateOf.length;
    candidateOf.push(i);
  }

  // Pass 2: candidates closer than tol become one point.
  const m = candidateOf.length;
  const uf = makeUnionFind(m);
  const gridHeads = new Map();
  const gridNext = new Int32Array(m).fill(-1);
  const tol2 = weldTol * weldTol;
  const cx = new Int32Array(m);
  const cy = new Int32Array(m);
  const cz = new Int32Array(m);
  for (let c = 0; c < m; c++) {
    const p = 3 * candidateOf[c];
    const x = tris[p];
    const y = tris[p + 1];
    const z = tris[p + 2];
    const ix = Math.floor(x / weldTol);
    const iy = Math.floor(y / weldTol);
    const iz = Math.floor(z / weldTol);
    cx[c] = ix;
    cy[c] = iy;
    cz[c] = iz;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const h = hashCell(ix + dx, iy + dy, iz + dz);
          for (let o = gridHeads.get(h) ?? -1; o >= 0; o = gridNext[o]) {
            if (cx[o] !== ix + dx || cy[o] !== iy + dy || cz[o] !== iz + dz) continue; // hash collision
            const pp = 3 * candidateOf[o];
            const ex = tris[pp] - x;
            const ey = tris[pp + 1] - y;
            const ez = tris[pp + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= tol2) uf.union(c, o);
          }
        }
      }
    }
    const h = hashCell(ix, iy, iz);
    gridNext[c] = gridHeads.get(h) ?? -1;
    gridHeads.set(h, c);
  }

  // Representative → new index, in the order the points appear in the file.
  const remap = new Int32Array(m).fill(-1);
  const V = [];
  const F = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const root = uf.find(candidate[i]);
    if (remap[root] < 0) {
      remap[root] = V.length / 3;
      const p = 3 * candidateOf[root];
      V.push(tris[p], tris[p + 1], tris[p + 2]);
    }
    F[i] = remap[root];
  }
  return { V: Float64Array.from(V), F, tol: weldTol };
}

/**
 * Spatial hash grid for point queries (T-junctions in heal.js, corner search
 * in topology.js). Cell size should be the search radius.
 */
export class HashGrid {
  constructor(cell, points) {
    this.cell = cell > 0 ? cell : 1;
    this.points = points;
    this.heads = new Map();
    this.next = new Int32Array(points.length / 3).fill(-1);
    for (let i = 0; i < points.length / 3; i++) this.add(i);
  }

  add(i) {
    const h = hashCell(
      Math.floor(this.points[3 * i] / this.cell),
      Math.floor(this.points[3 * i + 1] / this.cell),
      Math.floor(this.points[3 * i + 2] / this.cell),
    );
    this.next[i] = this.heads.get(h) ?? -1;
    this.heads.set(h, i);
  }

  /** Indices of all points within `radius` of (x,y,z). */
  within(x, y, z, radius) {
    const r = Math.max(1, Math.ceil(radius / this.cell));
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    const iz = Math.floor(z / this.cell);
    const out = [];
    const r2 = radius * radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const h = hashCell(ix + dx, iy + dy, iz + dz);
          for (let i = this.heads.get(h) ?? -1; i >= 0; i = this.next[i]) {
            const ex = this.points[3 * i] - x;
            const ey = this.points[3 * i + 1] - y;
            const ez = this.points[3 * i + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= r2) out.push(i);
          }
        }
      }
    }
    return out;
  }
}
