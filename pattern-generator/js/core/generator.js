// Turns a document (the JSON state) into a list of holes.
//
// On a cylinder (doc.form.type 'cylinder') the canvas is the unrolled
// surface: its width is the circumference, the pattern repeats seamlessly in
// x, and holes near the seam get "ghost" copies on the other side (for
// drawing, the web check and the 3D mesh).

import { DEG } from './math.js';
import { makeBoundary, makeBandBoundary, rimDistance } from './boundary.js';
import { makeLattice, wrapX, CELL_PATTERNS } from './lattice.js';
import { prepareModifiers, maxDisplacement } from './modifiers.js';
import { buildHole, circumradius, shapePeriod, shiftHole } from './shapes.js';

const mod2 = (n) => ((n % 2) + 2) % 2;

function spinAmount(pattern, p) {
  const spin = (pattern.spin || 0) * DEG;
  if (!spin) return 0;
  const idx = pattern.spinBy === 'column' ? p.i : pattern.spinBy === 'checker' ? p.i + p.j : p.j;
  if (pattern.spinMode === 'progressive') return spin * idx;
  return (mod2(idx) === 1 ? 0.5 : -0.5) * spin;
}

export const isCylinder = (doc) => !!doc.form && doc.form.type === 'cylinder';

/**
 * Copies of the holes near the seam, moved by one circumference to the other
 * side. reach: how far beyond the seam copies are needed.
 */
export function seamGhosts(holes, period, reach) {
  const ghosts = [];
  holes.forEach((hole, src) => {
    if (hole.x + hole.R > period / 2 - reach) ghosts.push({ ...shiftHole(hole, -period), ghost: true, src });
    if (hole.x - hole.R < -period / 2 + reach) ghosts.push({ ...shiftHole(hole, period), ghost: true, src });
  });
  return ghosts;
}

/**
 * generate(doc, env) -> { holes, ghosts, boundary, overflow, stats, wrap }
 * env.sampleImage(x, y) -> brightness 0..1 (optional)
 * wrap: null for a flat plate, else { period, seamless, columns, spacingX }.
 */
export function generate(doc, env = {}) {
  const { canvas, shape, pattern } = doc;
  const cylinder = isCylinder(doc);
  const period = cylinder ? Math.max(canvas.width, 1) : 0;
  const boundary = cylinder ? makeBandBoundary(canvas, doc.form.bottom) : makeBoundary(doc.boundary, canvas);
  const margin = Math.max(doc.boundary.margin || 0, 0);
  const centerOnly = doc.boundary.fit === 'center';
  const baseR = circumradius(shape.type, shape.width, shape.height);
  const pad = baseR * 2 + maxDisplacement(doc.modifiers);
  const lattice = makeLattice(pattern, canvas, pad, period, { sampleImage: env.sampleImage });
  const result = {
    holes: [],
    ghosts: [],
    boundary,
    overflow: lattice.overflow ? lattice.estimate : 0,
    stats: { count: 0, openArea: 0, ratio: 0, minRim: Infinity },
    wrap: cylinder ? { period, seamless: !!lattice.seamless, columns: lattice.columns || 0, spacingX: lattice.spacingX || 0 } : null,
    // QR code / bitmap details (version, missing image, error text).
    info: lattice.info || null,
  };
  if (lattice.overflow) return result;

  const shapeSymmetry = shapePeriod(shape);
  const mods = prepareModifiers(doc.modifiers, { boundary, period: shapeSymmetry, sampleImage: env.sampleImage, wrap: period });
  // QR codes and bitmaps: cells keep their size and stay unturned.
  const cells = CELL_PATTERNS.includes(pattern.type);
  const shapeRot = cells ? 0 : (shape.rotation || 0) * DEG;
  const minSize = Math.max(shape.minSize || 0, 0.01);
  const el = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, i: 0, j: 0, R: baseR, removed: false };
  const holes = result.holes;
  let openArea = 0;
  let minRim = Infinity;

  for (const p of lattice.points) {
    el.x = p.x;
    el.y = p.y;
    el.rot = cells ? 0 : p.rot + shapeRot + spinAmount(pattern, p);
    el.sx = 1;
    el.sy = 1;
    el.i = p.i;
    el.j = p.j;
    el.R = p.w ? circumradius(shape.type, p.w, p.h) : baseR;
    el.removed = false;
    for (let k = 0; k < mods.length; k++) {
      mods[k](el);
      if (el.removed) break;
    }
    if (el.removed) continue;
    if (cylinder) el.x = wrapX(el.x, period);
    const w = (p.w ?? shape.width) * el.sx;
    const h = (p.h ?? shape.height) * el.sy;
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

  if (cylinder) {
    let maxR = 0;
    for (const h of holes) maxR = Math.max(maxR, h.R);
    result.ghosts = seamGhosts(holes, period, 2 * maxR + Math.max(doc.check.minWeb || 0, 2) + 1);
  }
  result.stats = {
    count: holes.length,
    openArea,
    ratio: boundary.area > 0 ? openArea / boundary.area : 0,
    minRim,
  };
  return result;
}
