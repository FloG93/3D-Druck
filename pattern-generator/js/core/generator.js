// Turns a document (the JSON state) into a list of holes.

import { DEG } from './math.js';
import { makeBoundary, rimDistance } from './boundary.js';
import { makeLattice } from './lattice.js';
import { prepareModifiers, maxDisplacement } from './modifiers.js';
import { buildHole, circumradius, shapePeriod } from './shapes.js';

const mod2 = (n) => ((n % 2) + 2) % 2;

function spinAmount(pattern, p) {
  const spin = (pattern.spin || 0) * DEG;
  if (!spin) return 0;
  const idx = pattern.spinBy === 'column' ? p.i : pattern.spinBy === 'checker' ? p.i + p.j : p.j;
  if (pattern.spinMode === 'progressive') return spin * idx;
  return (mod2(idx) === 1 ? 0.5 : -0.5) * spin;
}

/**
 * generate(doc, env) -> { holes, boundary, overflow, stats }
 * env.sampleImage(x, y) -> brightness 0..1 (optional)
 */
export function generate(doc, env = {}) {
  const { canvas, shape, pattern } = doc;
  const boundary = makeBoundary(doc.boundary, canvas);
  const margin = Math.max(doc.boundary.margin || 0, 0);
  const centerOnly = doc.boundary.fit === 'center';
  const baseR = circumradius(shape.type, shape.width, shape.height);
  const pad = baseR * 2 + maxDisplacement(doc.modifiers);
  const lattice = makeLattice(pattern, canvas, pad);
  const result = {
    holes: [],
    boundary,
    overflow: lattice.overflow ? lattice.estimate : 0,
    stats: { count: 0, openArea: 0, ratio: 0, minRim: Infinity },
  };
  if (lattice.overflow) return result;

  const period = shapePeriod(shape);
  const mods = prepareModifiers(doc.modifiers, { boundary, period, sampleImage: env.sampleImage });
  const shapeRot = (shape.rotation || 0) * DEG;
  const minSize = Math.max(shape.minSize || 0, 0.01);
  const el = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, i: 0, j: 0, R: baseR, removed: false };
  const holes = result.holes;
  let openArea = 0;
  let minRim = Infinity;

  for (const p of lattice.points) {
    el.x = p.x;
    el.y = p.y;
    el.rot = p.rot + shapeRot + spinAmount(pattern, p);
    el.sx = 1;
    el.sy = 1;
    el.i = p.i;
    el.j = p.j;
    el.removed = false;
    for (let k = 0; k < mods.length; k++) {
      mods[k](el);
      if (el.removed) break;
    }
    if (el.removed) continue;
    const w = shape.width * el.sx;
    const h = shape.height * el.sy;
    if (w < minSize || h < minSize) continue;
    // Cheap reject: the centre must be inside the boundary (minus margin).
    const sd = boundary.sdf(el.x, el.y);
    if (sd > -margin) continue;
    const hole = buildHole(shape, el.x, el.y, el.rot, w, h);
    if (!hole) continue;
    const rim = rimDistance(boundary, hole.core);
    if (!centerOnly && rim < margin - 1e-9) continue;
    hole.i = p.i;
    hole.j = p.j;
    holes.push(hole);
    openArea += hole.area;
    if (rim < minRim) minRim = rim;
  }

  result.stats = {
    count: holes.length,
    openArea,
    ratio: boundary.area > 0 ? openArea / boundary.area : 0,
    minRim,
  };
  return result;
}
