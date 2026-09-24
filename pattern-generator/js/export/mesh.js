// Triangle meshes of the plate (STL export and 3D preview). The pattern
// shapes are either cut through the plate or become raised / recessed
// relief, optionally with sloped flanks.

import earcut from '../../vendor/earcut.js';
import Delaunator from '../../vendor/delaunator.js';
import Constrainautor from '../../vendor/constrainautor.js';
import { polygonize } from '../core/shapes.js';
import { reliefParams } from '../core/relief.js';

const DEG = Math.PI / 180;

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Removes consecutive duplicate points (would create degenerate walls). */
function clean(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-7) out.push(p);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-7) out.pop();
  return out;
}

/**
 * Ear clipping may place a vertex exactly on the edge of another triangle
 * when outline edges are collinear (e.g. square holes in a grid). Such
 * T-junctions leave the mesh open, so those triangles are split at the
 * vertices lying on their edges.
 */
function splitTJunctions(coords, tris) {
  const n = coords.length / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, coords[2 * i]);
    maxX = Math.max(maxX, coords[2 * i]);
    minY = Math.min(minY, coords[2 * i + 1]);
    maxY = Math.max(maxY, coords[2 * i + 1]);
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const cell = Math.max(size / Math.sqrt(n), size / 4096);
  const eps = size * 1e-10;
  const grid = new Map();
  const keyOf = (gx, gy) => gx * 65536 + gy;
  for (let i = 0; i < n; i++) {
    const k = keyOf(Math.floor((coords[2 * i] - minX) / cell), Math.floor((coords[2 * i + 1] - minY) / cell));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  // First vertex strictly inside segment u-v (closest to u), or -1.
  const onSegment = (u, v) => {
    const ux = coords[2 * u];
    const uy = coords[2 * u + 1];
    const dx = coords[2 * v] - ux;
    const dy = coords[2 * v + 1] - uy;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    if (len < eps) return -1;
    let best = -1;
    let bestT = 2;
    const seen = new Set();
    const steps = Math.ceil(len / cell) + 1;
    for (let s = 0; s <= steps; s++) {
      const px = ux + (dx * s) / steps;
      const py = uy + (dy * s) / steps;
      const gx = Math.floor((px - minX) / cell);
      const gy = Math.floor((py - minY) / cell);
      for (let yy = gy - 1; yy <= gy + 1; yy++) {
        for (let xx = gx - 1; xx <= gx + 1; xx++) {
          const k = keyOf(xx, yy);
          if (seen.has(k)) continue;
          seen.add(k);
          const list = grid.get(k);
          if (!list) continue;
          for (const w of list) {
            if (w === u || w === v) continue;
            const wx = coords[2 * w] - ux;
            const wy = coords[2 * w + 1] - uy;
            if (Math.abs(dx * wy - dy * wx) > eps * len) continue;
            const t = (dx * wx + dy * wy) / len2;
            if (t * len <= eps || (1 - t) * len <= eps) continue;
            if (t > 0 && t < 1 && t < bestT) {
              bestT = t;
              best = w;
            }
          }
        }
      }
    }
    return best;
  };
  const out = [];
  const stack = [];
  for (let i = 0; i < tris.length; i += 3) stack.push([tris[i], tris[i + 1], tris[i + 2]]);
  while (stack.length) {
    const [a, b, c] = stack.pop();
    // Zero-area triangles (collinear corners) only hide T-junctions: drop them.
    const area2 = (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1])
      - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a]);
    if (Math.abs(area2) <= eps * size) continue;
    let split = false;
    for (const [u, v, w] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const k = onSegment(u, v);
      if (k >= 0) {
        stack.push([u, k, w], [k, v, w]);
        split = true;
        break;
      }
    }
    if (!split) out.push(a, b, c);
  }
  return out;
}

/**
 * Constrained Delaunay triangulation of the plate face. The plate outline is
 * convex (it is the hull of all points) and every hole is convex, so a
 * triangle lies inside a hole exactly when all three corners belong to that
 * hole. Runs in O(n log n), unlike ear clipping with many holes.
 * ringOf[i] = 0 for the outline, k >= 1 for the k-th hole.
 */
function triangulateCDT(coords, ringStarts, extraEdges = []) {
  const n = coords.length / 2;
  const ringOf = new Int32Array(n);
  const edges = [...extraEdges];
  for (let r = 0; r < ringStarts.length; r++) {
    const start = ringStarts[r];
    const end = r + 1 < ringStarts.length ? ringStarts[r + 1] : n;
    for (let i = start; i < end; i++) {
      ringOf[i] = r;
      edges.push([i, i + 1 < end ? i + 1 : start]);
    }
  }
  const del = new Delaunator(coords);
  if (del.hull.length < 3) throw new Error('degenerate triangulation');
  const con = new Constrainautor(del);
  con.constrainAll(edges);
  const tris = del.triangles;
  const out = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t];
    const b = tris[t + 1];
    const c = tris[t + 2];
    const ra = ringOf[a];
    if (ra > 0 && ra === ringOf[b] && ra === ringOf[c]) continue;
    out.push(a, b, c);
  }
  // Every point must be used, otherwise Delaunator skipped duplicates.
  const used = new Uint8Array(n);
  for (const i of out) used[i] = 1;
  for (let i = 0; i < n; i++) if (!used[i]) throw new Error('point not triangulated');
  return out;
}

/**
 * Inward offset of a convex CCW ring by distance s: the top (or floor) of a
 * feature with sloped flanks. Edges shrink while the offset grows; an edge
 * that shrinks to nothing is dropped (straight skeleton of a convex polygon).
 * If the ring collapses to a ridge or point before s, the offset stops there.
 *
 * Returns { s, alive, end, apex, top }: s is the offset reached, alive[i]
 * tells whether edge i still exists, end[2i..2i+1] is the end point of a
 * surviving edge (its start is the end of the previous surviving edge). A
 * dropped edge collapsed into the end point of the surviving edge before it.
 * top lists the end points in order (a polygon, a ridge or empty); when every
 * edge is gone the feature ends in the single point apex.
 */
export function insetConvex(ring, s) {
  const n = ring.length;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  let extent = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-300;
    dx[i] = (q[0] - p[0]) / len;
    dy[i] = (q[1] - p[1]) / len;
    extent = Math.max(extent, Math.abs(p[0]), Math.abs(p[1]));
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  // Points closer than this are merged, so they stay distinct in float32 files.
  const eps = 1e-6 * (extent + Math.hypot(maxX - minX, maxY - minY));
  const prev = new Int32Array(n);
  const next = new Int32Array(n);
  const alive = new Uint8Array(n).fill(1);
  // Start vertex of edge i: position (sx, sy) at offset st, moving with (ux, uy).
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const st = new Float64Array(n);
  const ux = new Float64Array(n);
  const uy = new Float64Array(n);
  // The vertex between edges a and b moves so that it keeps unit distance
  // per unit offset from both edges. Outward normal of edge i: (dy, -dx).
  const setVelocity = (a, b, v) => {
    const dot = dx[a] * dx[b] + dy[a] * dy[b];
    if (dot < -1 + 1e-12) return false;
    const f = -1 / (1 + dot);
    ux[v] = (dy[a] + dy[b]) * f;
    uy[v] = -(dx[a] + dx[b]) * f;
    return true;
  };
  // Offset at which edge i has shrunk to length zero.
  const collapseAt = (i) => {
    const j = next[i];
    const rate = dx[i] * (ux[j] - ux[i]) + dy[i] * (uy[j] - uy[i]);
    if (rate >= -1e-12) return Infinity;
    const len0 = dx[i] * (sx[j] - st[j] * ux[j] - sx[i] + st[i] * ux[i])
      + dy[i] * (sy[j] - st[j] * uy[j] - sy[i] + st[i] * uy[i]);
    return -len0 / rate;
  };
  for (let i = 0; i < n; i++) {
    prev[i] = (i + n - 1) % n;
    next[i] = (i + 1) % n;
    sx[i] = ring[i][0];
    sy[i] = ring[i][1];
    setVelocity(prev[i], i, i);
  }
  const at = new Float64Array(n);
  for (let i = 0; i < n; i++) at[i] = collapseAt(i);

  let count = n;
  let t = 0;
  let collapsed = false;
  for (;;) {
    let b = -1;
    let tb = Infinity;
    for (let i = 0; i < n; i++) {
      if (alive[i] && at[i] < tb) {
        tb = at[i];
        b = i;
      }
    }
    if (b < 0 || tb >= s) break;
    t = Math.max(t, tb);
    const a = prev[b];
    const c = next[b];
    const x = (sx[b] + (t - st[b]) * ux[b] + sx[c] + (t - st[c]) * ux[c]) / 2;
    const y = (sy[b] + (t - st[b]) * uy[b] + sy[c] + (t - st[c]) * uy[c]) / 2;
    alive[b] = 0;
    count -= 1;
    next[a] = c;
    prev[c] = a;
    sx[c] = x;
    sy[c] = y;
    st[c] = t;
    // Two edges facing each other met: the ring became a ridge or a point.
    if (count < 3 || !setVelocity(a, c, c)) {
      collapsed = true;
      break;
    }
    at[a] = collapseAt(a);
    at[c] = collapseAt(c);
  }

  const T = collapsed ? t : s;
  let first = -1;
  for (let i = 0; i < n && first < 0; i++) if (alive[i]) first = i;
  const list = [];
  let i = first;
  do {
    const j = next[i];
    list.push({ i, x: sx[j] + (T - st[j]) * ux[j], y: sy[j] + (T - st[j]) * uy[j] });
    i = j;
  } while (i !== first);
  // Drop top edges of (nearly) zero length; their end merges with the start.
  let apex = null;
  for (let changed = true; changed && list.length;) {
    changed = false;
    for (let k = 0; k < list.length; k++) {
      const p = list[(k + list.length - 1) % list.length];
      const q = list[k];
      if (list.length === 1 || Math.hypot(q.x - p.x, q.y - p.y) <= eps) {
        if (list.length === 1) apex = [q.x, q.y];
        alive[q.i] = 0;
        list.splice(k, 1);
        changed = true;
        break;
      }
    }
  }
  const end = new Float64Array(2 * n);
  for (const e of list) {
    end[2 * e.i] = e.x;
    end[2 * e.i + 1] = e.y;
  }
  return { s: T, alive, end, apex, top: list.map((e) => [e.x, e.y]) };
}

/** Growable buffer of triangles (x, y, z per corner), float32 unless stated. */
class TriangleBuffer {
  constructor(estimate, Type = Float32Array) {
    this.Type = Type;
    this.pos = new Type(Math.max(estimate, 64) * 9);
    this.k = 0;
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    if (this.k + 9 > this.pos.length) {
      const grown = new this.Type(this.pos.length * 2);
      grown.set(this.pos);
      this.pos = grown;
    }
    const p = this.pos;
    let k = this.k;
    p[k++] = ax; p[k++] = ay; p[k++] = az;
    p[k++] = bx; p[k++] = by; p[k++] = bz;
    p[k++] = cx; p[k++] = cy; p[k++] = cz;
    this.k = k;
  }

  get count() {
    return this.k / 9;
  }
}

/** Triangulates a convex CCW polygon (zig-zag strip, all triangles CCW). */
function convexCap(buf, pts, z, up) {
  let lo = 0;
  let hi = pts.length - 1;
  let turn = true;
  while (hi - lo > 1) {
    const a = pts[lo];
    const b = turn ? pts[lo + 1] : pts[hi - 1];
    const c = pts[hi];
    if (up) buf.tri(a[0], a[1], z, b[0], b[1], z, c[0], c[1], z);
    else buf.tri(a[0], a[1], z, c[0], c[1], z, b[0], b[1], z);
    if (turn) lo += 1;
    else hi -= 1;
    turn = !turn;
  }
}

/**
 * Side faces from the ring P at height zP to its inset at height zV (vertical
 * walls without inset). With zV > zP they face outwards (a boss or the plate
 * rim), with zV < zP into the pocket or hole they enclose.
 */
function flank(buf, P, zP, inset, zV) {
  const n = P.length;
  if (!inset) {
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const q = P[(i + 1) % n];
      buf.tri(p[0], p[1], zP, q[0], q[1], zP, q[0], q[1], zV);
      buf.tri(p[0], p[1], zP, q[0], q[1], zV, p[0], p[1], zV);
    }
    return;
  }
  const { alive, end, apex } = inset;
  if (apex) {
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const q = P[(i + 1) % n];
      buf.tri(p[0], p[1], zP, q[0], q[1], zP, apex[0], apex[1], zV);
    }
    return;
  }
  let last = n - 1;
  while (!alive[last]) last -= 1;
  let cx = end[2 * last];
  let cy = end[2 * last + 1];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const q = P[(i + 1) % n];
    if (alive[i]) {
      const ex = end[2 * i];
      const ey = end[2 * i + 1];
      buf.tri(p[0], p[1], zP, q[0], q[1], zP, ex, ey, zV);
      buf.tri(p[0], p[1], zP, ex, ey, zV, cx, cy, zV);
      cx = ex;
      cy = ey;
    } else {
      buf.tri(p[0], p[1], zP, q[0], q[1], zP, cx, cy, zV);
    }
  }
}

/**
 * One feature above (emboss) or below (deboss) the plate surface at zs.
 * Sloped flanks inset the ring; a feature that runs to a ridge or a point
 * before reaching the full height stays lower.
 */
function feature(buf, P, zs, height, taper, dir) {
  let inset = null;
  let h = height;
  if (taper > 0) {
    const k = Math.tan(taper * DEG);
    inset = insetConvex(P, height * k);
    h = Math.min(height, inset.s / k);
  }
  const zV = zs + dir * h;
  flank(buf, P, zs, inset, zV);
  if (!inset) convexCap(buf, P, zV, true);
  else if (inset.top.length >= 3) convexCap(buf, inset.top, zV, true);
}

/**
 * Builds a closed triangle mesh of the plate.
 * Returns { positions: Float32Array (x,y,z per corner, 3 corners per triangle),
 * triangles, featureStart } – triangles from featureStart on belong to the
 * relief features (for colouring).
 * relief: { mode: 'cut' | 'emboss' | 'deboss', height, taper (degrees) }.
 * watertight: repair T-junctions of the fallback triangulation (STL).
 * Raised features that overlap are written as separate closed shells, which
 * slicers merge.
 */
export function buildPlateMesh(boundaryOutline, holeOutlines, thickness, tol = 0.03, { watertight = true, relief = null } = {}) {
  const t = thickness;
  const { mode, height, taper } = reliefParams(relief, t);
  const outer = clean(polygonize(boundaryOutline, tol));
  if (signedArea(outer) < 0) outer.reverse();
  const holes = holeOutlines.map((o) => {
    const p = clean(polygonize(o, tol));
    if (signedArea(p) < 0) p.reverse();
    return p;
  }).filter((p) => p.length >= 3);

  // Outer ring followed by the hole rings.
  const coords = [];
  const holeIndex = [];
  for (const p of outer) coords.push(p[0], p[1]);
  for (const hole of holes) {
    holeIndex.push(coords.length / 2);
    for (const p of hole) coords.push(p[0], p[1]);
  }
  let tris = null;
  try {
    tris = triangulateCDT(Float64Array.from(coords), [0, ...holeIndex]);
  } catch {
    tris = null;
  }
  const vertexCount = coords.length / 2;
  const buf = new TriangleBuffer(vertexCount * 6);

  if (!tris && mode === 'emboss') {
    // Overlapping features: plain slab plus one closed shell per feature,
    // reaching into the slab so the parts overlap instead of touching.
    convexCap(buf, outer, t, true);
    convexCap(buf, outer, 0, false);
    flank(buf, outer, 0, null, t);
    const featureStart = buf.count;
    const zb = t - Math.min(t / 2, 0.5);
    for (const P of holes) {
      convexCap(buf, P, zb, false);
      flank(buf, P, zb, null, t);
      feature(buf, P, t, height, taper, 1);
    }
    return { positions: buf.pos.subarray(0, buf.k), triangles: buf.count, featureStart };
  }
  if (!tris) {
    // Touching or overlapping outlines: fall back to ear clipping.
    tris = earcut(coords, holeIndex, 2);
    if (watertight) tris = splitTJunctions(coords, tris);
  }

  const cut = mode === 'cut';
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    let b = tris[i + 1];
    let c = tris[i + 2];
    const ax = coords[2 * a];
    const ay = coords[2 * a + 1];
    const cross = (coords[2 * b] - ax) * (coords[2 * c + 1] - ay) - (coords[2 * b + 1] - ay) * (coords[2 * c] - ax);
    if (cross < 0) [b, c] = [c, b];
    const bx = coords[2 * b];
    const by = coords[2 * b + 1];
    const cx = coords[2 * c];
    const cy = coords[2 * c + 1];
    buf.tri(ax, ay, t, bx, by, t, cx, cy, t);
    if (cut) buf.tri(ax, ay, 0, cx, cy, 0, bx, by, 0);
  }
  if (!cut) convexCap(buf, outer, 0, false);
  flank(buf, outer, 0, null, t);
  const featureStart = cut ? Infinity : buf.count;
  for (const P of holes) {
    if (cut) flank(buf, P, t, null, 0);
    else feature(buf, P, t, height, taper, mode === 'emboss' ? 1 : -1);
  }
  return { positions: buf.pos.subarray(0, buf.k), triangles: buf.count, featureStart: Math.min(featureStart, buf.count) };
}

/** Polygonized outlines as CCW rings without duplicate points. */
function ringsOf(outlines, tol) {
  return outlines.map((o) => {
    const p = clean(polygonize(o, tol));
    if (signedArea(p) < 0) p.reverse();
    return p;
  }).filter((p) => p.length >= 3);
}

/** Inserts the points where a ring crosses the vertical line x = X. */
function withSeamPoints(ring, X) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    out.push(p);
    if ((p[0] - X) * (q[0] - X) < 0) out.push([X, p[1] + ((X - p[0]) / (q[0] - p[0])) * (q[1] - p[1])]);
  }
  return out;
}

/** Point on segment a-b at x = X, computed the same way from either end. */
function crossAt(a, b, X) {
  const swap = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
  const p = swap ? b : a;
  const q = swap ? a : b;
  const t = (X - p[0]) / (q[0] - p[0]);
  return [X, p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])];
}

/**
 * Cuts every triangle into the strips between the planes x = planes[k] and
 * keeps the pieces inside [planes[0], planes[last]]. Crossing points depend
 * only on the edge, so neighbouring triangles stay conforming.
 * emit(polygon) receives each convex piece as a list of [x, y, z].
 */
function splitIntoStrips(pos, from, to, planes, emit) {
  const last = planes.length - 1;
  const x0 = planes[0];
  const step = (planes[last] - x0) / last;
  // Points this close to a plane are moved onto it; otherwise they would
  // create slivers that collapse in the float32 output.
  const snapTol = 1e-6 * (planes[last] - x0);
  const snap = (x) => {
    const j = Math.round((x - x0) / step);
    return j >= 0 && j <= last && Math.abs(x - planes[j]) <= snapTol ? planes[j] : x;
  };
  const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let t = from; t < to; t++) {
    const k = t * 9;
    for (let c = 0; c < 3; c++) {
      tri[c][0] = snap(pos[k + 3 * c]);
      tri[c][1] = pos[k + 3 * c + 1];
      tri[c][2] = pos[k + 3 * c + 2];
    }
    const minX = Math.min(tri[0][0], tri[1][0], tri[2][0]);
    const maxX = Math.max(tri[0][0], tri[1][0], tri[2][0]);
    if (maxX < x0 || minX > planes[last]) continue;
    let j0;
    let j1;
    if (minX === maxX) {
      // Lies in a plane x = const: belongs to exactly one strip.
      j0 = Math.min(Math.max(Math.floor((minX - x0) / step), 0), last - 1);
      while (j0 > 0 && planes[j0] > minX) j0 -= 1;
      while (j0 < last - 1 && planes[j0 + 1] <= minX) j0 += 1;
      if (minX === planes[last]) continue;
      j1 = j0;
    } else {
      j0 = Math.max(0, Math.floor((minX - x0) / step) - 1);
      j1 = Math.min(last - 1, Math.floor((maxX - x0) / step) + 1);
    }
    for (let j = j0; j <= j1; j++) {
      const lo = planes[j];
      const hi = planes[j + 1];
      if (minX !== maxX && (hi <= minX || lo >= maxX)) continue;
      const poly = [];
      for (let c = 0; c < 3; c++) {
        const a = tri[c];
        const b = tri[(c + 1) % 3];
        if (a[0] >= lo && a[0] <= hi) poly.push([a[0], a[1], a[2]]);
        const cuts = [];
        for (const X of [lo, hi]) if ((a[0] - X) * (b[0] - X) < 0) cuts.push(X);
        if (cuts.length === 2 && (cuts[0] - a[0]) * (cuts[1] - cuts[0]) < 0) cuts.reverse();
        for (const X of cuts) poly.push(crossAt(a, b, X));
      }
      if (poly.length >= 3) emit(poly);
    }
  }
}

/**
 * Closed tube for a cylinder whose circumference is `period`: the plate is
 * built flat (the band plus the seam copies of the holes, with the seams as
 * constraint lines), cut into narrow strips, trimmed at the seams and bent
 * around the Z axis. The pattern surface is the outside (radius period / 2π),
 * the wall thickness goes inwards, Z runs from 0 to height.
 * holeOutlines must include the ghost copies at the seams.
 * bottom > 0 adds a closed floor of that thickness (a separate, overlapping shell).
 * Returns { positions, triangles, featureStart, radius }.
 */
export function buildTubeMesh(holeOutlines, period, height, thickness, tol = 0.03, { watertight = true, relief = null, segments = 180, bottom = 0 } = {}) {
  const U = period;
  const R = U / (2 * Math.PI);
  const H = height;
  const t = Math.min(thickness, R * 0.95);
  const { mode, height: rh, taper } = reliefParams(relief, t);
  const XL = -U / 2;
  const XR = U / 2;
  const holes = ringsOf(holeOutlines, tol).map((r) => withSeamPoints(withSeamPoints(r, XL), XR));
  let E = 1;
  for (const r of holes) for (const p of r) E = Math.max(E, p[0] - XR + 1, XL - p[0] + 1);
  const outer = [[XL - E, -H / 2], [XL, -H / 2], [XR, -H / 2], [XR + E, -H / 2], [XR + E, H / 2], [XR, H / 2], [XL, H / 2], [XL - E, H / 2]];

  const coords = [];
  const ringStarts = [0];
  for (const p of outer) coords.push(p[0], p[1]);
  for (const r of holes) {
    ringStarts.push(coords.length / 2);
    for (const p of r) coords.push(p[0], p[1]);
  }
  // Seam lines as constraints, except where they run inside a hole.
  const seams = [];
  const ringIndex = (v) => {
    let r = 0;
    while (r + 1 < ringStarts.length && ringStarts[r + 1] <= v) r += 1;
    return r;
  };
  for (const X of [XL, XR]) {
    const on = [];
    for (let v = 0; v < coords.length / 2; v++) if (coords[2 * v] === X) on.push(v);
    on.sort((a, b) => coords[2 * a + 1] - coords[2 * b + 1]);
    for (let k = 0; k + 1 < on.length; k++) {
      const ra = ringIndex(on[k]);
      if (ra > 0 && ra === ringIndex(on[k + 1])) continue;
      seams.push([on[k], on[k + 1]]);
    }
  }
  let tris = null;
  try {
    tris = triangulateCDT(Float64Array.from(coords), ringStarts, seams);
  } catch {
    tris = null;
  }

  // Full precision: seam points must stay exactly on the seam planes.
  const flat = new TriangleBuffer(coords.length * 4, Float64Array);
  let featureStart;
  if (!tris && mode === 'emboss') {
    // Overlapping features: plain band plus one closed shell per feature.
    const band = [[XL, -H / 2], [XR, -H / 2], [XR, H / 2], [XL, H / 2]];
    convexCap(flat, band, t, true);
    convexCap(flat, band, 0, false);
    for (const [a, b] of [[band[0], band[1]], [band[2], band[3]]]) {
      flat.tri(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], t);
      flat.tri(a[0], a[1], 0, b[0], b[1], t, a[0], a[1], t);
    }
    featureStart = flat.count;
    const zb = t - Math.min(t / 2, 0.5);
    for (const P of holes) {
      convexCap(flat, P, zb, false);
      flank(flat, P, zb, null, t);
      feature(flat, P, t, rh, taper, 1);
    }
  } else {
    if (!tris) {
      tris = earcut(coords, ringStarts.slice(1), 2);
      if (watertight) tris = splitTJunctions(coords, tris);
    }
    const cut = mode === 'cut';
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i];
      let b = tris[i + 1];
      let c = tris[i + 2];
      const ax = coords[2 * a];
      const ay = coords[2 * a + 1];
      const cross = (coords[2 * b] - ax) * (coords[2 * c + 1] - ay) - (coords[2 * b + 1] - ay) * (coords[2 * c] - ax);
      if (cross < 0) [b, c] = [c, b];
      const bx = coords[2 * b];
      const by = coords[2 * b + 1];
      const cx = coords[2 * c];
      const cy = coords[2 * c + 1];
      flat.tri(ax, ay, t, bx, by, t, cx, cy, t);
      if (cut) flat.tri(ax, ay, 0, cx, cy, 0, bx, by, 0);
    }
    if (!cut) convexCap(flat, [[XL, -H / 2], [XR, -H / 2], [XR, H / 2], [XL, H / 2]], 0, false);
    flank(flat, outer, 0, null, t);
    featureStart = flat.count;
    for (const P of holes) {
      if (cut) flank(flat, P, t, null, 0);
      else feature(flat, P, t, rh, taper, mode === 'emboss' ? 1 : -1);
    }
    if (cut) featureStart = flat.count;
  }

  // Strips of at most 360° / segments, trimmed to one turn.
  const n = Math.max(12, Math.round(segments));
  const planes = [];
  for (let k = 0; k <= n; k++) planes.push(k === n ? XR : XL + (k * U) / n);
  const pieces = [];
  const collect = (from, to) => {
    const list = [];
    splitIntoStrips(flat.pos, from, to, planes, (poly) => list.push(poly));
    return list;
  };
  const base = collect(0, featureStart);
  const feats = collect(featureStart, flat.count);
  pieces.push(...base, ...feats);

  // Weld: points on the left seam take the exact values of the right seam.
  const key = (y, z) => `${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  const right = new Map();
  for (const poly of pieces) {
    for (const p of poly) {
      if (p[0] !== XR) continue;
      const k = key(p[1], p[2]);
      if (!right.has(k)) right.set(k, p);
    }
  }
  const weldTol = 1e-6 * (U + H);
  for (const poly of pieces) {
    for (const p of poly) {
      if (p[0] !== XL) continue;
      const iy = Math.round(p[1] * 1e5);
      const iz = Math.round(p[2] * 1e5);
      let found = null;
      for (let dy = -1; dy <= 1 && !found; dy++) {
        for (let dz = -1; dz <= 1 && !found; dz++) {
          const q = right.get(`${iy + dy},${iz + dz}`);
          if (q && Math.abs(q[1] - p[1]) <= weldTol && Math.abs(q[2] - p[2]) <= weldTol) found = q;
        }
      }
      if (found) {
        p[1] = found[1];
        p[2] = found[2];
      }
    }
  }

  // Bend: x -> angle, z -> radius (the plate top is the outside), y -> Z.
  const out = new TriangleBuffer(pieces.length * 2 + (bottom > 0 ? n * 4 : 0));
  const place = (p) => {
    let k = (p[0] - XL) / U;
    if (k >= 1) k -= 1;
    const a = 2 * Math.PI * k - Math.PI;
    const rho = R - t + p[2];
    return [rho * Math.cos(a), rho * Math.sin(a), p[1] + H / 2];
  };
  if (bottom > 0) {
    // Floor disc reaching halfway into the wall.
    const b = Math.min(bottom, H);
    const rd = R - t / 2;
    const ring = [];
    for (let k = 0; k < n; k++) ring.push([rd * Math.cos((2 * Math.PI * k) / n), rd * Math.sin((2 * Math.PI * k) / n)]);
    for (let k = 1; k + 1 < n; k++) {
      out.tri(ring[0][0], ring[0][1], b, ring[k][0], ring[k][1], b, ring[k + 1][0], ring[k + 1][1], b);
      out.tri(ring[0][0], ring[0][1], 0, ring[k + 1][0], ring[k + 1][1], 0, ring[k][0], ring[k][1], 0);
    }
    for (let k = 0; k < n; k++) {
      const p = ring[k];
      const q = ring[(k + 1) % n];
      out.tri(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], b);
      out.tri(p[0], p[1], 0, q[0], q[1], b, p[0], p[1], b);
    }
  }
  const emitPieces = (list) => {
    for (const poly of list) {
      const m = poly.map(place);
      for (let k = 1; k + 1 < m.length; k++) {
        const a = m[0];
        const b = m[k];
        const c = m[k + 1];
        out.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
    }
  };
  emitPieces(base);
  const start = out.count;
  emitPieces(feats);
  return { positions: out.pos.subarray(0, out.k), triangles: out.count, featureStart: start, radius: R };
}

/** Binary STL from a triangle position array. */
export function toBinarySTL(positions, header = 'Muster-Generator') {
  const count = positions.length / 9;
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(head);
  dv.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < count; t++) {
    const i = t * 9;
    const ux = positions[i + 3] - positions[i];
    const uy = positions[i + 4] - positions[i + 1];
    const uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i];
    const vy = positions[i + 7] - positions[i + 1];
    const vz = positions[i + 8] - positions[i + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    for (let j = 0; j < 9; j++) dv.setFloat32(o + 12 + j * 4, positions[i + j], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return new Uint8Array(buf);
}
