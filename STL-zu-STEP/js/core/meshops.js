// The mesh operations every later step builds on (docs/SPEC.md 4): edges,
// signed volume, components, bounding box, triangle normals and adjacency.
// Typed arrays throughout, no objects per triangle and no recursion, so that
// a mesh with hundreds of thousands of triangles stays within the budget of
// SPEC 8.

/** Key of a directed edge (u,v); vertex indices stay below 2^26 per key half. */
export const edgeKey = (u, v) => `${u},${v}`;
export const undirectedKey = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);

/** The three directed edges of triangle t. */
export function triEdges(F, t) {
  const a = F[3 * t];
  const b = F[3 * t + 1];
  const c = F[3 * t + 2];
  return [[a, b], [b, c], [c, a]];
}

/**
 * edgeMap(F) → { directed: Map('u,v' → [triangles]), undirected: Map('min,max' → [triangles]) }
 * A directed edge in more than one triangle means the winding is inconsistent;
 * an undirected edge in more than two means the mesh is non-manifold.
 */
export function edgeMap(F) {
  const directed = new Map();
  const undirected = new Map();
  const n = F.length / 3;
  for (let t = 0; t < n; t++) {
    for (const [u, v] of triEdges(F, t)) {
      const dk = edgeKey(u, v);
      const d = directed.get(dk);
      if (d) d.push(t); else directed.set(dk, [t]);
      const uk = undirectedKey(u, v);
      const e = undirected.get(uk);
      if (e) e.push(t); else undirected.set(uk, [t]);
    }
  }
  return { directed, undirected };
}

/** Directed edges without an opposite edge – the boundary of an open mesh. */
export function openEdges(F) {
  const { directed } = edgeMap(F);
  const out = [];
  for (const key of directed.keys()) {
    const [u, v] = key.split(',');
    if (!directed.has(edgeKey(v, u))) out.push([Number(u), Number(v)]);
  }
  return out;
}

/** Σ p0·(p1×p2)/6 – positive when the triangles face outwards (SPEC 5.3 step 6). */
export function signedVolume(V, F) {
  let sum = 0;
  for (let t = 0; t < F.length; t += 3) {
    const a = 3 * F[t];
    const b = 3 * F[t + 1];
    const c = 3 * F[t + 2];
    const cx = V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1];
    const cy = V[b + 2] * V[c] - V[b] * V[c + 2];
    const cz = V[b] * V[c + 1] - V[b + 1] * V[c];
    sum += V[a] * cx + V[a + 1] * cy + V[a + 2] * cz;
  }
  return sum / 6;
}

/** Area-weighted centroid times 3 and the area of one triangle. */
export function triangleNormals(V, F) {
  const n = F.length / 3;
  const N = new Float64Array(3 * n);
  const area = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const a = 3 * F[3 * t];
    const b = 3 * F[3 * t + 1];
    const c = 3 * F[3 * t + 2];
    const e1x = V[b] - V[a];
    const e1y = V[b + 1] - V[a + 1];
    const e1z = V[b + 2] - V[a + 2];
    const e2x = V[c] - V[a];
    const e2y = V[c + 1] - V[a + 1];
    const e2z = V[c + 2] - V[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    area[t] = len / 2;
    if (len > 0) {
      N[3 * t] = nx / len;
      N[3 * t + 1] = ny / len;
      N[3 * t + 2] = nz / len;
    }
  }
  return { N, area };
}

/**
 * adjacency(F) → { start: Uint32Array(n+1), list: Uint32Array } in CSR form:
 * the neighbours of triangle t are list[start[t] … start[t+1]). Neighbours are
 * triangles that share an edge; on a non-manifold edge all of them are listed.
 */
export function adjacency(F) {
  const n = F.length / 3;
  const { undirected } = edgeMap(F);
  const counts = new Uint32Array(n);
  for (const tris of undirected.values()) {
    if (tris.length < 2) continue;
    for (const t of tris) counts[t] += tris.length - 1;
  }
  const start = new Uint32Array(n + 1);
  for (let t = 0; t < n; t++) start[t + 1] = start[t] + counts[t];
  const list = new Uint32Array(start[n]);
  const fill = start.slice(0, n);
  for (const tris of undirected.values()) {
    if (tris.length < 2) continue;
    for (const t of tris) for (const o of tris) if (o !== t) list[fill[t]++] = o;
  }
  return { start, list };
}

/** The neighbours of triangle t from an adjacency built with adjacency(). */
export function neighbours(adj, t) {
  return adj.list.subarray(adj.start[t], adj.start[t + 1]);
}

/**
 * components(F, pointCount) → { count, label: Int32Array(n) }
 * Triangles connected by a shared edge belong to one component; union-find
 * over the vertices, iterative (a strip of 60 000 triangles must not blow the
 * stack).
 */
export function components(F, pointCount) {
  const n = F.length / 3;
  const parent = new Uint32Array(pointCount);
  for (let i = 0; i < pointCount; i++) parent[i] = i;
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
  for (let t = 0; t < n; t++) {
    const a = find(F[3 * t]);
    const b = find(F[3 * t + 1]);
    const c = find(F[3 * t + 2]);
    const root = Math.min(a, b, c);
    if (a !== root) parent[a] = root;
    if (b !== root) parent[b] = root;
    if (c !== root) parent[c] = root;
  }
  const ids = new Map();
  const label = new Int32Array(n);
  for (let t = 0; t < n; t++) {
    const root = find(F[3 * t]);
    let id = ids.get(root);
    if (id === undefined) {
      id = ids.size;
      ids.set(root, id);
    }
    label[t] = id;
  }
  return { count: ids.size, label };
}

/** bbox(V) → { lo, hi, diagonal } */
export function bbox(V) {
  const lo = new Float64Array([Infinity, Infinity, Infinity]);
  const hi = new Float64Array([-Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < V.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (V[i + k] < lo[k]) lo[k] = V[i + k];
      if (V[i + k] > hi[k]) hi[k] = V[i + k];
    }
  }
  return { lo, hi, diagonal: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}

/**
 * Splits a mesh into one mesh per component, keeping the point order.
 * `sourceTriangle[i]` is the triangle of the original mesh – the preview needs
 * it to colour the triangles of a component in the whole mesh again.
 */
export function splitComponents(V, F) {
  const comps = components(F, V.length / 3);
  const out = [];
  for (let c = 0; c < comps.count; c++) {
    const remap = new Int32Array(V.length / 3).fill(-1);
    const verts = [];
    const faces = [];
    const sourceTriangle = [];
    for (let t = 0; t < F.length / 3; t++) {
      if (comps.label[t] !== c) continue;
      sourceTriangle.push(t);
      for (let k = 0; k < 3; k++) {
        const v = F[3 * t + k];
        if (remap[v] < 0) {
          remap[v] = verts.length / 3;
          verts.push(V[3 * v], V[3 * v + 1], V[3 * v + 2]);
        }
        faces.push(remap[v]);
      }
    }
    out.push({
      V: Float64Array.from(verts),
      F: Uint32Array.from(faces),
      sourceVertex: remap,
      sourceTriangle: Uint32Array.from(sourceTriangle),
    });
  }
  return out;
}
