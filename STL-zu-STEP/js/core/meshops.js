// The mesh operations every later step builds on (docs/SPEC.md 4): edges,
// signed volume, components, bounding box, triangle normals and adjacency.
// Typed arrays throughout, no objects per triangle and no recursion, so that
// a mesh with hundreds of thousands of triangles stays within the budget of
// SPEC 8.

/**
 * Key of a directed edge (u,v) as one number: u·2^26 + v stays an exact double
 * for vertex indices below 2^26 (67 million). Numbers hash far cheaper than
 * the strings they replace and allocate nothing.
 */
const KEY_BASE = 67108864;
export const edgeKey = (u, v) => u * KEY_BASE + v;
export const undirectedKey = (u, v) => (u < v ? u * KEY_BASE + v : v * KEY_BASE + u);
/** The two vertices of an edge key. */
export const keyStart = (key) => Math.floor(key / KEY_BASE);
export const keyEnd = (key) => key % KEY_BASE;

/** The three directed edges of triangle t. */
export function triEdges(F, t) {
  const a = F[3 * t];
  const b = F[3 * t + 1];
  const c = F[3 * t + 2];
  return [[a, b], [b, c], [c, a]];
}

/**
 * edgeTable(F) → { count, group: Int32Array(3n), start: Uint32Array(count+1), members: Uint32Array(3n) }
 * Every triangle t has three half-edges 3t+slot, running from F[3t+slot] to
 * the next corner. Half-edges on the same undirected edge share a group; the
 * members of group g are members[start[g] … start[g+1]) in triangle order.
 * A group of one is a boundary edge, of more than two a non-manifold edge, and
 * two members that run in the same direction mean inconsistent winding.
 *
 * Open addressing over typed arrays: this is the hot path of every step, and
 * a Map with an array per edge cost more than the rest of the healing.
 */
export function edgeTable(F) {
  const h = F.length;
  let size = 16;
  while (size < 2 * h) size *= 2;
  const mask = size - 1;
  const slotA = new Int32Array(size).fill(-1);
  const slotB = new Int32Array(size);
  const slotGroup = new Int32Array(size);
  const group = new Int32Array(h);
  let count = 0;
  for (let e = 0; e < h; e++) {
    const slot = e % 3;
    let a = F[e];
    let b = F[slot === 2 ? e - 2 : e + 1];
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    let x = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b);
    x ^= x >>> 15;
    let i = x & mask;
    while (slotA[i] !== -1 && (slotA[i] !== a || slotB[i] !== b)) i = (i + 1) & mask;
    if (slotA[i] === -1) {
      slotA[i] = a;
      slotB[i] = b;
      slotGroup[i] = count++;
    }
    group[e] = slotGroup[i];
  }
  const start = new Uint32Array(count + 1);
  for (let e = 0; e < h; e++) start[group[e] + 1]++;
  for (let g = 0; g < count; g++) start[g + 1] += start[g];
  const members = new Uint32Array(h);
  const fill = start.slice(0, count);
  for (let e = 0; e < h; e++) members[fill[group[e]]++] = e;
  return { count, group, start, members };
}

/** The corner a half-edge runs to. */
const halfEdgeEnd = (F, e) => F[e % 3 === 2 ? e - 2 : e + 1];

/**
 * Half-edges without an opposite edge, in triangle order: the boundary of an
 * open mesh. Two triangles that run along their shared edge in the same
 * direction leave both of them without a partner, so they count here too.
 */
export function openHalfEdges(F) {
  const { group, start, members } = edgeTable(F);
  const out = [];
  for (let e = 0; e < F.length; e++) {
    const g = group[e];
    const u = F[e];
    const v = halfEdgeEnd(F, e);
    let opposite = false;
    for (let j = start[g]; j < start[g + 1] && !opposite; j++) {
      const o = members[j];
      opposite = F[o] === v && halfEdgeEnd(F, o) === u;
    }
    if (!opposite) out.push(e);
  }
  return out;
}

/** The same boundary as [u, v] pairs. */
export function openEdges(F) {
  return openHalfEdges(F).map((e) => [F[e], halfEdgeEnd(F, e)]);
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
  const { count, start: gStart, members } = edgeTable(F);
  const counts = new Uint32Array(n);
  for (let g = 0; g < count; g++) {
    const size = gStart[g + 1] - gStart[g];
    if (size < 2) continue;
    for (let i = gStart[g]; i < gStart[g + 1]; i++) counts[(members[i] / 3) | 0] += size - 1;
  }
  const start = new Uint32Array(n + 1);
  for (let t = 0; t < n; t++) start[t + 1] = start[t] + counts[t];
  const list = new Uint32Array(start[n]);
  const fill = start.slice(0, n);
  for (let g = 0; g < count; g++) {
    if (gStart[g + 1] - gStart[g] < 2) continue;
    for (let i = gStart[g]; i < gStart[g + 1]; i++) {
      const t = (members[i] / 3) | 0;
      for (let j = gStart[g]; j < gStart[g + 1]; j++) {
        const o = (members[j] / 3) | 0;
        if (o !== t) list[fill[t]++] = o;
      }
    }
  }
  return { start, list };
}

/** The neighbours of triangle t from an adjacency built with adjacency(). */
export function neighbours(adj, t) {
  return adj.list.subarray(adj.start[t], adj.start[t + 1]);
}

/**
 * components(F) → { count, label: Int32Array(n) }
 * Triangles connected by a shared EDGE belong to one component – union-find
 * over the edges, as SPEC 5.3 step 7 says, and iterative (a strip of 60 000
 * triangles must not blow the stack).
 *
 * Measured on the Utah teapot (docs/MACHBARKEIT.md section 7): its body is two
 * closed shells that share exactly one point. Connecting over POINTS makes
 * them one body with Euler characteristic 3, which is no valid solid, and the
 * whole part fell back to an open shell. Over edges they are two solids, and
 * the shared point simply belongs to both.
 */
export function components(F) {
  const n = F.length / 3;
  const parent = new Uint32Array(n);
  for (let t = 0; t < n; t++) parent[t] = t;
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
  const { count: groups, start, members } = edgeTable(F);
  for (let g = 0; g < groups; g++) {
    const first = (members[start[g]] / 3) | 0;
    for (let i = start[g] + 1; i < start[g + 1]; i++) {
      const a = find(first);
      const b = find((members[i] / 3) | 0);
      if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
    }
  }
  const ids = new Map();
  const label = new Int32Array(n);
  for (let t = 0; t < n; t++) {
    const root = find(t);
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
  const comps = components(F);
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
