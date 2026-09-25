// Shared test helpers: fonts from the repository and mesh checks.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FontLibrary, BUILTIN_FONTS } from '../js/core/fonts.js';

export const FONT_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));

export async function loadFonts({ symbols = true } = {}) {
  const lib = new FontLibrary({
    builtinBase: FONT_DIR,
    fetchBytes: async (p) => {
      const b = fs.readFileSync(p);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  });
  for (const f of BUILTIN_FONTS) await lib.load(f);
  if (symbols) await lib.loadSymbols();
  return lib;
}

export const font = (id) => {
  const f = BUILTIN_FONTS.find((x) => x.id === id);
  return { id: f.id, family: f.family, weight: f.weight, style: 'normal' };
};

/**
 * Checks that a triangle soup (9 floats per triangle) is closed: after
 * merging equal points (like the 3MF writer, to 0.01 µm) and dropping the
 * triangles that collapse, every directed edge has exactly one opposite
 * edge. Returns { badEdges, volume }.
 */
export function meshCheck(positions, triangles) {
  const ids = new Map();
  const id = (i) => {
    const key = `${Math.round(positions[i] * 1e5)},${Math.round(positions[i + 1] * 1e5)},${Math.round(positions[i + 2] * 1e5)}`;
    let v = ids.get(key);
    if (v === undefined) {
      v = ids.size;
      ids.set(key, v);
    }
    return v;
  };
  const edges = new Map();
  let volume = 0;
  for (let t = 0; t < triangles; t++) {
    const o = t * 9;
    const a = id(o);
    const b = id(o + 3);
    const c = id(o + 6);
    // A sliver thinner than the merging grid collapses (the 3MF writer drops it too).
    if (a !== b && b !== c && a !== c) {
      for (const [u, v] of [[a, b], [b, c], [c, a]]) edges.set(`${u},${v}`, (edges.get(`${u},${v}`) || 0) + 1);
    }
    const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = positions.subarray(o, o + 9);
    volume += (x1 * (y2 * z3 - y3 * z2) - x2 * (y1 * z3 - y3 * z1) + x3 * (y1 * z2 - y2 * z1)) / 6;
  }
  let badEdges = 0;
  for (const [key, n] of edges) {
    const [u, v] = key.split(',');
    if (n !== 1 || edges.get(`${v},${u}`) !== 1) badEdges++;
  }
  return { badEdges, volume };
}
