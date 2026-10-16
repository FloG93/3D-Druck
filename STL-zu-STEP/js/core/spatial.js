// Geometry helpers for diagnosing and checking a repair (docs/SPEC.md 5.3):
// a set of vertex triples, the distance from a point to a triangle mesh, and
// triangle–triangle intersection for the self-intersection check. Typed arrays
// throughout, like the rest of core/: no object per triangle.

import { bbox } from './meshops.js';

/** Set of unordered vertex triples with exact membership (open addressing). */
export class TripleSet {
  constructor(capacity) {
    let size = 16;
    while (size < 2 * capacity) size *= 2;
    this.mask = size - 1;
    this.a = new Int32Array(size).fill(-1);
    this.b = new Int32Array(size);
    this.c = new Int32Array(size);
    this.count = 0;
  }

  /** Slot of the triple (sorted), or the empty slot where it would go. */
  slot(x, y, z) {
    let a = x;
    let b = y;
    let c = z;
    if (a > b) [a, b] = [b, a];
    if (b > c) [b, c] = [c, b];
    if (a > b) [a, b] = [b, a];
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b) ^ Math.imul(c, 0xc2b2ae35);
    h ^= h >>> 15;
    let i = h & this.mask;
    while (this.a[i] !== -1 && (this.a[i] !== a || this.b[i] !== b || this.c[i] !== c)) i = (i + 1) & this.mask;
    return { i, a, b, c };
  }

  /** Adds the triple; false when it was there already. */
  add(x, y, z) {
    const { i, a, b, c } = this.slot(x, y, z);
    if (this.a[i] !== -1) return false;
    this.a[i] = a;
    this.b[i] = b;
    this.c[i] = c;
    this.count += 1;
    return true;
  }

  has(x, y, z) {
    return this.a[this.slot(x, y, z).i] !== -1;
  }
}

/** Squared distance from p to the triangle (a, b, c) – Ericson, Real-Time Collision Detection 5.1.5. */
export function pointTriangleDistanceSq(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  const at = (t0, t1) => {
    const q = [a[0] + t0 * ab[0] + t1 * ac[0], a[1] + t0 * ab[1] + t1 * ac[1], a[2] + t0 * ab[2] + t1 * ac[2]];
    return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  };
  if (d1 <= 0 && d2 <= 0) return at(0, 0);
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return at(1 - w, w);
  }
  const denom = 1 / (va + vb + vc);
  return at(vb * denom, vc * denom);
}

/**
 * Uniform grid over the triangles of a mesh. Every triangle is listed in each
 * cell its bounding box touches (CSR layout), so nearest() and the pair search
 * of countSelfIntersections() only look at what is close.
 */
export class TriangleGrid {
  constructor(V, F, cellSize = 0) {
    this.V = V;
    this.F = F;
    const box = bbox(V);
    this.lo = box.lo;
    const n = F.length / 3;
    // At most 64 cells along the longest side: bounded memory, and a triangle
    // of ordinary size touches a handful of cells.
    const widest = Math.max(box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2], 1e-12);
    this.cell = Math.max(cellSize, widest / 64);
    this.dims = [0, 1, 2].map((k) => Math.max(1, Math.floor((box.hi[k] - box.lo[k]) / this.cell) + 1));
    const cells = this.dims[0] * this.dims[1] * this.dims[2];
    this.boxes = new Float64Array(6 * n);
    this.start = new Uint32Array(cells + 1);
    const range = (t) => {
      let lo = [Infinity, Infinity, Infinity];
      let hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const v = 3 * F[3 * t + k];
        for (let j = 0; j < 3; j++) {
          if (V[v + j] < lo[j]) lo[j] = V[v + j];
          if (V[v + j] > hi[j]) hi[j] = V[v + j];
        }
      }
      for (let j = 0; j < 3; j++) {
        this.boxes[6 * t + j] = lo[j];
        this.boxes[6 * t + 3 + j] = hi[j];
      }
      lo = lo.map((x, j) => this.index(x, j));
      hi = hi.map((x, j) => this.index(x, j));
      return [lo, hi];
    };
    const ranges = new Int32Array(6 * n);
    for (let t = 0; t < n; t++) {
      const [lo, hi] = range(t);
      for (let j = 0; j < 3; j++) {
        ranges[6 * t + j] = lo[j];
        ranges[6 * t + 3 + j] = hi[j];
      }
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) this.start[this.cellId(x, y, z) + 1]++;
    }
    for (let c = 0; c < cells; c++) this.start[c + 1] += this.start[c];
    this.list = new Uint32Array(this.start[cells]);
    const fill = this.start.slice(0, cells);
    for (let t = 0; t < n; t++) {
      for (let x = ranges[6 * t]; x <= ranges[6 * t + 3]; x++) {
        for (let y = ranges[6 * t + 1]; y <= ranges[6 * t + 4]; y++) {
          for (let z = ranges[6 * t + 2]; z <= ranges[6 * t + 5]; z++) this.list[fill[this.cellId(x, y, z)]++] = t;
        }
      }
    }
    this.stamp = new Int32Array(n);
    this.query = 0;
  }

  index(value, axis) {
    const i = Math.floor((value - this.lo[axis]) / this.cell);
    return i < 0 ? 0 : i >= this.dims[axis] ? this.dims[axis] - 1 : i;
  }

  cellId(x, y, z) {
    return (x * this.dims[1] + y) * this.dims[2] + z;
  }

  vertex(t, k) {
    const v = 3 * this.F[3 * t + k];
    return [this.V[v], this.V[v + 1], this.V[v + 2]];
  }

  /** Distance from the point to the nearest triangle (expanding shells of cells). */
  nearest(p) {
    const c0 = [this.index(p[0], 0), this.index(p[1], 1), this.index(p[2], 2)];
    const rings = Math.max(...this.dims);
    let best = Infinity;
    this.query += 1;
    for (let r = 0; r <= rings; r++) {
      for (let x = Math.max(0, c0[0] - r); x <= Math.min(this.dims[0] - 1, c0[0] + r); x++) {
        for (let y = Math.max(0, c0[1] - r); y <= Math.min(this.dims[1] - 1, c0[1] + r); y++) {
          for (let z = Math.max(0, c0[2] - r); z <= Math.min(this.dims[2] - 1, c0[2] + r); z++) {
            // Only the shell of radius r: the inner cells were done before.
            if (Math.max(Math.abs(x - c0[0]), Math.abs(y - c0[1]), Math.abs(z - c0[2])) !== r) continue;
            const id = this.cellId(x, y, z);
            for (let i = this.start[id]; i < this.start[id + 1]; i++) {
              const t = this.list[i];
              if (this.stamp[t] === this.query) continue;
              this.stamp[t] = this.query;
              const d = pointTriangleDistanceSq(p, this.vertex(t, 0), this.vertex(t, 1), this.vertex(t, 2));
              if (d < best) best = d;
            }
          }
        }
      }
      // Every cell of the next shell is at least r cells away.
      if (Math.sqrt(best) <= r * this.cell) break;
    }
    return Math.sqrt(best);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The interval of the intersection line inside one triangle (Möller 1997). */
function lineInterval(proj, d) {
  let a;
  let b;
  let c;
  if (d[0] * d[1] > 0) [a, b, c] = [2, 0, 1];
  else if (d[0] * d[2] > 0) [a, b, c] = [1, 0, 2];
  else if (d[1] * d[2] > 0 || d[0] !== 0) [a, b, c] = [0, 1, 2];
  else if (d[1] !== 0) [a, b, c] = [1, 0, 2];
  else if (d[2] !== 0) [a, b, c] = [2, 0, 1];
  else return null;
  const t0 = proj[b] + ((proj[a] - proj[b]) * d[b]) / (d[b] - d[a]);
  const t1 = proj[c] + ((proj[a] - proj[c]) * d[c]) / (d[c] - d[a]);
  return t0 < t1 ? [t0, t1] : [t1, t0];
}

/**
 * Do the triangles p and q cut through each other? Coplanar triangles and
 * triangles that only touch count as not intersecting: the first is a flat
 * overlap that adds no volume error, the second is how neighbours meet.
 * `eps` is the length below which a distance counts as zero.
 */
export function trianglesIntersect(p, q, eps) {
  const n1 = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const d1 = -dot(n1, p[0]);
  const dq = q.map((x) => {
    const d = dot(n1, x) + d1;
    return Math.abs(d) < eps * Math.sqrt(dot(n1, n1)) ? 0 : d;
  });
  if ((dq[0] > 0 && dq[1] > 0 && dq[2] > 0) || (dq[0] < 0 && dq[1] < 0 && dq[2] < 0)) return false;
  const n2 = cross(sub(q[1], q[0]), sub(q[2], q[0]));
  const d2 = -dot(n2, q[0]);
  const dp = p.map((x) => {
    const d = dot(n2, x) + d2;
    return Math.abs(d) < eps * Math.sqrt(dot(n2, n2)) ? 0 : d;
  });
  if ((dp[0] > 0 && dp[1] > 0 && dp[2] > 0) || (dp[0] < 0 && dp[1] < 0 && dp[2] < 0)) return false;
  const dir = cross(n1, n2);
  const axis = Math.abs(dir[0]) >= Math.abs(dir[1]) && Math.abs(dir[0]) >= Math.abs(dir[2]) ? 0 : Math.abs(dir[1]) >= Math.abs(dir[2]) ? 1 : 2;
  const i1 = lineInterval(p.map((x) => x[axis]), dp);
  const i2 = lineInterval(q.map((x) => x[axis]), dq);
  if (!i1 || !i2) return false; // coplanar
  const scale = Math.hypot(dir[0], dir[1], dir[2]);
  const length = scale > 0 ? Math.abs(dir[axis]) / scale : 1;
  const tol = eps / Math.max(length, 1e-12);
  return Math.min(i1[1], i2[1]) - Math.max(i1[0], i2[0]) > tol;
}

/**
 * Pairs of triangles that cut through each other (neighbours sharing a point
 * are skipped). Returns { count, capped, checked }: `capped` when the search
 * stopped at maxReport pairs. Every pair is tested in exactly one cell – the
 * one holding the lower corner of the overlap of both bounding boxes.
 */
export function countSelfIntersections(V, F, { maxReport = 1000 } = {}) {
  const box = bbox(V);
  const eps = box.diagonal * 1e-9;
  const grid = new TriangleGrid(V, F);
  const { boxes, start, list } = grid;
  let count = 0;
  let checked = 0;
  const [nx, ny, nz] = grid.dims;
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const id = grid.cellId(x, y, z);
        for (let i = start[id]; i < start[id + 1]; i++) {
          const s = list[i];
          for (let j = i + 1; j < start[id + 1]; j++) {
            const t = list[j];
            const a = s < t ? s : t;
            const b = s < t ? t : s;
            // Bounding boxes must overlap, and this cell owns the pair.
            let overlap = true;
            const owner = [0, 0, 0];
            for (let k = 0; k < 3; k++) {
              const lo = Math.max(boxes[6 * a + k], boxes[6 * b + k]);
              const hi = Math.min(boxes[6 * a + 3 + k], boxes[6 * b + 3 + k]);
              if (hi < lo - eps) {
                overlap = false;
                break;
              }
              owner[k] = grid.index(lo, k);
            }
            if (!overlap || owner[0] !== x || owner[1] !== y || owner[2] !== z) continue;
            const ta = [F[3 * a], F[3 * a + 1], F[3 * a + 2]];
            const tb = [F[3 * b], F[3 * b + 1], F[3 * b + 2]];
            if (ta.some((v) => tb.includes(v))) continue;
            checked += 1;
            if (trianglesIntersect([0, 1, 2].map((k) => grid.vertex(a, k)), [0, 1, 2].map((k) => grid.vertex(b, k)), eps)) {
              count += 1;
              if (count >= maxReport) return { count, capped: true, checked };
            }
          }
        }
      }
    }
  }
  return { count, capped: false, checked };
}
