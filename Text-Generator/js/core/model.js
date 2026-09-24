// Builds the 2D design (lettering, base plate, mount, border) and the 3D
// parts from the document. A part is a list of slabs: a region extruded
// between two heights. Parts become separate bodies in the 3MF file so
// Bambu Studio can print them in different colours (AMS).

import {
  union, difference, intersection, offset, fillHoles, regionBounds, regionArea, emptyBounds, addRingBounds,
  circleRing, ellipseRing, roundedRectRing, crossingsAtY, crossingsAtX, thinParts, transformRegion,
} from './geometry.js';
import { layoutBlock } from './layout.js';

export const PART_NAMES = { base: 'Platte', text: 'Schrift', border: 'Rand' };
export const RELIEF_NAMES = { raised: 'erhaben', engraved: 'vertieft', flush: 'bündig', cut: 'durchbrochen' };
// PLA, for the weight estimate.
export const DENSITY = 1.24;
// Thinnest floor left under engraved text.
export const MIN_FLOOR = 0.4;
// Plate material kept between engraved letters and the plate edge.
export const MIN_WALL = 0.8;

const DEFAULT_BOX = { minX: -20, minY: -6, maxX: 20, maxY: 6 };

function boxOf(region) {
  const b = regionBounds(region);
  return Number.isFinite(b.minX) ? b : { ...DEFAULT_BOX };
}

/** Rectangle of width w around the segment (x0, y0) – (x1, y1). */
function barRing(x0, y0, x1, y1, w) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / len) * (w / 2);
  const ny = ((x1 - x0) / len) * (w / 2);
  return [x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny];
}

function closestPoints(a, b) {
  let best = { d: Infinity };
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) {
      const d = (a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2;
      if (d < best.d) best = { d, x0: a[i], y0: a[i + 1], x1: b[j], y1: b[j + 1] };
    }
  }
  return best;
}

/**
 * Joins separate pieces of a region with bars along a minimum spanning
 * tree of the shortest gaps (e.g. words of a contour key ring far apart).
 */
export function connectPieces(region, barWidth) {
  if (region.length < 2) return { region, bridges: 0 };
  const pieces = region.map((s) => s.outer);
  const n = pieces.length;
  const inTree = [true, ...new Array(n - 1).fill(false)];
  const bars = [];
  const pair = new Map();
  const gap = (i, j) => {
    const k = i < j ? `${i},${j}` : `${j},${i}`;
    if (!pair.has(k)) pair.set(k, closestPoints(pieces[i], pieces[j]));
    return pair.get(k);
  };
  for (let added = 1; added < n; added++) {
    let best = null;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const g = gap(i, j);
        if (!best || g.d < best.g.d) best = { i, j, g };
      }
    }
    inTree[best.j] = true;
    const { x0, y0, x1, y1 } = best.g;
    // Reach a little into both pieces so the union is solid.
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ex = ((x1 - x0) / len) * barWidth;
    const ey = ((y1 - y0) / len) * barWidth;
    bars.push(barRing(x0 - ex, y0 - ey, x1 + ex, y1 + ey, barWidth));
  }
  return { region: union(region, bars), bridges: bars.length };
}

function farthestDistance(region, cx, cy) {
  let r = 0;
  for (const s of region) {
    for (let i = 0; i < s.outer.length; i += 2) r = Math.max(r, Math.hypot(s.outer[i] - cx, s.outer[i + 1] - cy));
  }
  return r;
}

/** Base plate for the lettering (without mount holes). */
function basePlate(doc, text, box, warnings) {
  const b = doc.base;
  // A raised border takes room from the padding.
  const p = b.padding + (doc.body.border ? doc.body.borderWidth : 0);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const fixed = b.sizeMode === 'fixed';
  switch (b.shape) {
    case 'none':
      return [];
    case 'contour': {
      if (!text.length) return union([roundedRectRing(box.minX - p, box.minY - p, box.maxX + p, box.maxY + p, p)]);
      const grown = fillHoles(offset(text, Math.max(p, 0.2)));
      const joined = connectPieces(grown, Math.max(2 * p, 2.5));
      if (joined.bridges) warnings.push(`Die Kontur bestand aus ${joined.bridges + 1} Teilen – sie sind mit Stegen verbunden. Mehr Randabstand schließt die Lücken.`);
      // Round off the inner corners between letters.
      return fillHoles(offset(offset(joined.region, p * 0.6), -p * 0.6));
    }
    case 'rect':
      return union([fixed
        ? roundedRectRing(-b.width / 2, -b.height / 2, b.width / 2, b.height / 2, b.radius)
        : roundedRectRing(box.minX - p, box.minY - p, box.maxX + p, box.maxY + p, b.radius)]);
    case 'capsule': {
      if (fixed) return union([roundedRectRing(-b.width / 2, -b.height / 2, b.width / 2, b.height / 2, b.height / 2)]);
      // Long enough that the round ends clear the corners of the text box.
      const R = h / 2 + p;
      const reach = Math.sqrt(Math.max((R - p / 2) ** 2 - (h / 2) ** 2, 0));
      const half = Math.max(w / 2 - reach, 0) + R;
      return union([roundedRectRing(cx - half, cy - R, cx + half, cy + R, R)]);
    }
    case 'oval': {
      if (fixed) return union([ellipseRing(0, 0, b.width / 2, b.height / 2)]);
      return union([ellipseRing(cx, cy, (w / 2 + p) * Math.SQRT2, (h / 2 + p) * Math.SQRT2)]);
    }
    case 'circle': {
      if (fixed) return union([circleRing(0, 0, b.width / 2)]);
      const r = (text.length ? farthestDistance(text, cx, cy) : Math.hypot(w, h) / 2) + p;
      return union([circleRing(cx, cy, r)]);
    }
    default:
      return [];
  }
}

/** Adds the key ring eyelet or hole. Returns { base, holes }. */
function addMount(doc, base) {
  const m = doc.mount;
  if (m.type === 'none' || !base.length) return { base, holes: [] };
  const ri = m.diameter / 2;
  const ro = ri + m.ring;
  const bb = regionBounds(base);
  const outside = m.type === 'eyelet' || doc.base.shape === 'contour';
  // Eyelet: the hole just clears the plate edge, the ring overlaps it.
  const clear = 0.5;
  let cx;
  let cy;
  if (m.position === 'top') {
    cx = (bb.minX + bb.maxX) / 2;
    const ys = crossingsAtX(base, cx);
    const edge = ys.length ? ys[ys.length - 1] : bb.maxY;
    cy = outside ? edge + ri + clear : edge - m.ring - ri;
  } else {
    cy = (bb.minY + bb.maxY) / 2;
    const xs = crossingsAtY(base, cy);
    const left = m.position === 'left';
    const edge = xs.length ? (left ? xs[0] : xs[xs.length - 1]) : (left ? bb.minX : bb.maxX);
    const dir = left ? -1 : 1;
    cx = outside ? edge + dir * (ri + clear) : edge - dir * (m.ring + ri);
  }
  let out = base;
  if (outside) {
    // Fillet the joint between plate and ring.
    const f = Math.min(1.5, m.ring);
    out = offset(offset(union(base, [circleRing(cx, cy, ro)]), f), -f);
  }
  const hole = circleRing(cx, cy, ri);
  return { base: difference(out, [hole]), holes: [{ cx, cy, r: ri }] };
}

/**
 * The whole model. getFace(fontRef) returns a loaded FontFace or null
 * (then `pending` is true and the text of that block is missing).
 */
export function buildModel(doc, getFace, { keepCurves = false } = {}) {
  const warnings = [];
  const layouts = [];
  let pending = false;
  let text = [];
  for (const block of doc.texts) {
    if (!block.text.trim()) continue;
    const face = getFace(block.font);
    if (!face) {
      pending = true;
      continue;
    }
    const lay = layoutBlock(block, face, { keepCurves });
    let region = lay.region;
    if (block.bold) region = offset(region, block.bold / 2);
    if (lay.missing.size) warnings.push(`In „${block.font.family}“ fehlen die Zeichen ${[...lay.missing].join(' ')}.`);
    layouts.push({ block, ...lay, region });
    text = text.length ? union(text, region) : region;
  }

  // Room for an inner hole: widen the text box on that side.
  const box = boxOf(text);
  const m = doc.mount;
  if (m.type === 'hole' && doc.base.shape !== 'contour' && doc.base.shape !== 'none' && doc.base.sizeMode === 'auto') {
    const e = m.diameter + m.ring;
    if (m.position === 'left') box.minX -= e;
    else if (m.position === 'right') box.maxX += e;
    else box.maxY += e;
  }
  let base = basePlate(doc, text, box, warnings);
  const mounted = addMount(doc, base);
  base = mounted.base;
  if (base.length > 1) warnings.push(`Die Platte zerfällt in ${base.length} Teile.`);

  const { body } = doc;
  let border = [];
  let inner = base;
  if (body.border && base.length) {
    inner = offset(base, -body.borderWidth);
    border = difference(base, inner);
  }
  let letters = text;
  if (base.length) {
    // Pockets need a wall to the plate edge; raised text may run to the edge.
    const sunk = body.relief === 'engraved' || body.relief === 'flush';
    const area = sunk && !border.length ? offset(base, -MIN_WALL) : inner;
    letters = intersection(text, area);
    if (regionArea(text) - regionArea(letters) > 0.05) warnings.push('Die Schrift ragt über die Platte hinaus und wird abgeschnitten.');
  }

  // Stamps: everything mirrored.
  let holes = mounted.holes;
  if (doc.mirror) {
    const M = [-1, 0, 0, 1, 0, 0];
    base = transformRegion(base, M);
    letters = transformRegion(letters, M);
    border = transformRegion(border, M);
    holes = holes.map((h) => ({ ...h, cx: -h.cx }));
  }

  const t = body.thickness;
  const relief = base.length ? body.relief : 'raised';
  const depth = Math.min(body.height, Math.max(t - MIN_FLOOR, 0.1));
  if ((relief === 'engraved' || relief === 'flush') && body.height > depth + 1e-9) {
    warnings.push(`Die Gravur ist auf ${depth.toLocaleString('de-DE')} mm begrenzt, damit ${MIN_FLOOR.toLocaleString('de-DE')} mm Boden bleiben.`);
  }
  // Parts are lists of solids: a region extruded from z0 to z1, optionally
  // with pockets (a region sunk by `depth` from the top).
  const parts = [];
  const add = (id, solids) => {
    const ok = solids.filter((s) => s.region.length && s.z1 > s.z0 + 1e-9);
    if (ok.length) parts.push({ id, name: PART_NAMES[id], color: doc.colors[id], slot: doc.slots[id], solids: ok });
  };
  if (!base.length) {
    add('text', [{ region: letters, z0: 0, z1: t }]);
  } else if (relief === 'raised') {
    add('base', [{ region: base, z0: 0, z1: t }]);
    add('text', [{ region: letters, z0: t, z1: t + body.height }]);
  } else if (relief === 'engraved' || relief === 'flush') {
    add('base', [{ region: base, z0: 0, z1: t, pockets: letters, depth }]);
    if (relief === 'flush') add('text', [{ region: letters, z0: t - depth, z1: t }]);
  } else if (relief === 'cut') {
    add('base', [{ region: difference(base, letters), z0: 0, z1: t }]);
  }
  if (border.length) add('border', [{ region: border, z0: t, z1: t + body.borderHeight }]);

  // 3D-print check: strokes thinner than the limit.
  const thin = relief === 'cut' || !doc.check.minStroke ? [] : thinParts(letters, doc.check.minStroke);

  const all = union(base, letters, border);
  const bounds = all.length ? regionBounds(all) : emptyBounds();
  let volume = 0;
  for (const part of parts) {
    part.volume = part.solids.reduce((v, s) => v + regionArea(s.region) * (s.z1 - s.z0)
      - (s.pockets ? regionArea(s.pockets) * s.depth : 0), 0);
    volume += part.volume;
  }
  const top = parts.reduce((z, part) => Math.max(z, ...part.solids.map((s) => s.z1)), 0);
  const textBox = letters.length ? regionBounds(letters) : null;
  return {
    doc,
    layouts,
    text: letters,
    base,
    // Plate as seen from above (with the lettering cut out when it goes through).
    plate: relief === 'cut' ? difference(base, letters) : base,
    border,
    holes,
    thin,
    parts,
    relief,
    depth,
    bounds,
    warnings,
    pending,
    stats: {
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      top,
      volume,
      grams: (volume / 1000) * DENSITY,
      textWidth: textBox ? textBox.maxX - textBox.minX : 0,
      textHeight: textBox ? textBox.maxY - textBox.minY : 0,
      thinCount: thin.length,
    },
  };
}

/** Bounding box of a list of rings (for thumbnails etc.). */
export function ringsBounds(rings) {
  const b = emptyBounds();
  for (const r of rings) addRingBounds(b, r);
  return b;
}
