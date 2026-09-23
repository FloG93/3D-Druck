// Triangle meshes of the perforated plate (STL export and 3D preview).

import earcut from '../../vendor/earcut.js';
import Delaunator from '../../vendor/delaunator.js';
import Constrainautor from '../../vendor/constrainautor.js';
import { polygonize } from '../core/shapes.js';

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
function triangulateCDT(coords, ringStarts) {
  const n = coords.length / 2;
  const ringOf = new Int32Array(n);
  const edges = [];
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
 * Builds a closed triangle mesh of the plate with holes.
 * Returns { positions: Float32Array (x,y,z per vertex, 3 vertices per triangle), triangles }.
 * holeOutlines: outlines of the holes, boundaryOutline: plate outline.
 * watertight: repair T-junctions (needed for STL, not for the preview).
 */
export function buildPlateMesh(boundaryOutline, holeOutlines, thickness, tol = 0.03, { watertight = true } = {}) {
  const outer = clean(polygonize(boundaryOutline, tol));
  if (signedArea(outer) < 0) outer.reverse();
  const holes = holeOutlines.map((o) => {
    const p = clean(polygonize(o, tol));
    if (signedArea(p) < 0) p.reverse();
    return p;
  }).filter((p) => p.length >= 3);

  // earcut input: outer ring followed by hole rings.
  const coords = [];
  const holeIndex = [];
  for (const p of outer) coords.push(p[0], p[1]);
  for (const hole of holes) {
    holeIndex.push(coords.length / 2);
    for (const p of hole) coords.push(p[0], p[1]);
  }
  let tris;
  try {
    tris = triangulateCDT(Float64Array.from(coords), [0, ...holeIndex]);
  } catch {
    // Touching or overlapping outlines: fall back to ear clipping.
    tris = earcut(coords, holeIndex, 2);
    if (watertight) tris = splitTJunctions(coords, tris);
  }

  const wallCount = outer.length + holes.reduce((s, p) => s + p.length, 0);
  const triangles = tris.length / 3 * 2 + wallCount * 2;
  const pos = new Float32Array(triangles * 9);
  let k = 0;
  const put = (x, y, z) => {
    pos[k++] = x;
    pos[k++] = y;
    pos[k++] = z;
  };
  const z0 = 0;
  const z1 = thickness;
  for (let i = 0; i < tris.length; i += 3) {
    let a = tris[i];
    let b = tris[i + 1];
    let c = tris[i + 2];
    const ax = coords[2 * a];
    const ay = coords[2 * a + 1];
    const cross = (coords[2 * b] - ax) * (coords[2 * c + 1] - ay) - (coords[2 * b + 1] - ay) * (coords[2 * c] - ax);
    if (cross < 0) [b, c] = [c, b];
    // top (counter-clockwise from above)
    put(coords[2 * a], coords[2 * a + 1], z1);
    put(coords[2 * b], coords[2 * b + 1], z1);
    put(coords[2 * c], coords[2 * c + 1], z1);
    // bottom (reversed)
    put(coords[2 * a], coords[2 * a + 1], z0);
    put(coords[2 * c], coords[2 * c + 1], z0);
    put(coords[2 * b], coords[2 * b + 1], z0);
  }
  const wall = (ring, inward) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      if (!inward) {
        put(p[0], p[1], z0); put(q[0], q[1], z0); put(q[0], q[1], z1);
        put(p[0], p[1], z0); put(q[0], q[1], z1); put(p[0], p[1], z1);
      } else {
        put(p[0], p[1], z0); put(q[0], q[1], z1); put(q[0], q[1], z0);
        put(p[0], p[1], z0); put(p[0], p[1], z1); put(q[0], q[1], z1);
      }
    }
  };
  wall(outer, false);
  for (const hole of holes) wall(hole, true);
  return { positions: pos.subarray(0, k), triangles: k / 9 };
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
