// Shared test helpers: the fixture corpus from tests/fixtures/ and the mesh
// checks every step of the pipeline is measured against.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** A fixture file as an ArrayBuffer, exactly as the browser hands it over. */
export function loadFixture(name) {
  const b = fs.readFileSync(FIXTURE_DIR + name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** The ground truth of the corpus (see fixtures/README.md for the vocabulary). */
export function expected(name) {
  const all = JSON.parse(fs.readFileSync(`${FIXTURE_DIR}expected.json`, 'utf8'));
  return name === undefined ? all : all[name];
}

export const FIXTURES = () => Object.keys(expected());

/**
 * Statistics of a welded mesh: how often each directed edge occurs, how many
 * edges lack their opposite (open) or occur more than once (non-manifold),
 * the signed volume and the number of connected components.
 */
export function meshStats(V, F) {
  const n = F.length / 3;
  const dir = new Map();
  for (let t = 0; t < n; t++) {
    const a = F[3 * t];
    const b = F[3 * t + 1];
    const c = F[3 * t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) dir.set(`${u},${v}`, (dir.get(`${u},${v}`) || 0) + 1);
  }
  let open = 0;
  let doubled = 0;
  for (const [key, count] of dir) {
    const [u, v] = key.split(',');
    if (!dir.has(`${v},${u}`)) open += 1;
    if (count > 1) doubled += 1;
  }
  return { triangles: n, points: V.length / 3, open, doubled, volume: signedVolume(V, F), components: componentCount(F) };
}

/** Σ p0·(p1×p2)/6 – positive when the triangles face outwards. */
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

/** Number of components connected by shared edges (union-find, no recursion). */
export function componentCount(F) {
  const parent = [];
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const edges = new Map();
  const n = F.length / 3;
  for (let t = 0; t < n; t++) parent[t] = t;
  for (let t = 0; t < n; t++) {
    const a = F[3 * t];
    const b = F[3 * t + 1];
    const c = F[3 * t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      const other = edges.get(key);
      if (other === undefined) edges.set(key, t);
      else {
        const ra = find(other);
        const rb = find(t);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
  }
  const roots = new Set();
  for (let t = 0; t < n; t++) roots.add(find(t));
  return roots.size;
}

/** Relative deviation in percent (for the volume comparisons of every step). */
export const deviation = (got, want) => (100 * (got - want)) / want;
