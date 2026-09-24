// Triangulation of a flat shape (outer ring + holes, any form) where every
// ring vertex and every ring edge is kept – so caps match the side walls
// exactly and meshes stay watertight. Constrained Delaunay (Delaunator +
// Constrainautor); triangles are inside when an odd number of ring edges
// separates them from the outside (even-odd rule).

import Delaunator from '../../../shared/vendor/delaunator.js';
import Constrainautor from '../../../shared/vendor/constrainautor.js';
import earcut from '../../../shared/vendor/earcut.js';

/**
 * rings: flat rings [x0, y0, …]. Returns { coords, triangles } with unique
 * points and triangle corner indices (orientation not normalised).
 */
export function triangulateShape(rings) {
  const index = new Map();
  const coords = [];
  const edges = [];
  const idOf = (x, y) => {
    const key = `${x},${y}`;
    let id = index.get(key);
    if (id === undefined) {
      id = coords.length / 2;
      index.set(key, id);
      coords.push(x, y);
    }
    return id;
  };
  for (const r of rings) {
    const n = r.length / 2;
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(idOf(r[2 * i], r[2 * i + 1]));
    for (let i = 0; i < n; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % n];
      if (a !== b) edges.push([a, b]);
    }
  }
  if (coords.length < 6) return { coords, triangles: [] };
  try {
    return { coords, triangles: constrained(coords, edges) };
  } catch {
    // Degenerate input (e.g. crossing edges): earcut still gives a usable cap.
    return { coords: rings.flat(), triangles: earcut(rings.flat(), holeStarts(rings), 2) };
  }
}

function holeStarts(rings) {
  const out = [];
  let n = 0;
  rings.forEach((r, i) => {
    if (i) out.push(n);
    n += r.length / 2;
  });
  return out;
}

function constrained(coords, edges) {
  const del = new Delaunator(Float64Array.from(coords));
  const con = new Constrainautor(del);
  con.constrainAll(edges);
  const { triangles, halfedges } = del;
  const count = triangles.length / 3;
  // Every point must be part of the triangulation.
  const used = new Uint8Array(coords.length / 2);
  for (let i = 0; i < triangles.length; i++) used[triangles[i]] = 1;
  if (used.includes(0)) throw new Error('point not triangulated');
  // Flood fill from the convex hull; crossing a ring edge flips inside/outside.
  const parity = new Int8Array(count).fill(-1);
  const queue = [];
  for (let e = 0; e < halfedges.length; e++) {
    if (halfedges[e] !== -1) continue;
    const t = Math.floor(e / 3);
    const p = con.isConstrained(e) ? 1 : 0;
    if (parity[t] === -1) {
      parity[t] = p;
      queue.push(t);
    }
  }
  while (queue.length) {
    const t = queue.pop();
    for (let k = 0; k < 3; k++) {
      const e = 3 * t + k;
      const o = halfedges[e];
      if (o === -1) continue;
      const u = Math.floor(o / 3);
      if (parity[u] !== -1) continue;
      parity[u] = parity[t] ^ (con.isConstrained(e) ? 1 : 0);
      queue.push(u);
    }
  }
  const out = [];
  for (let t = 0; t < count; t++) {
    if (parity[t] === 1) out.push(triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]);
  }
  return out;
}
