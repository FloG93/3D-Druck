// Builds the 2D design (lettering, base plate, mount, border) and the 3D
// parts from the document. A part is a list of solids (see mesh.js): a
// region extruded between two heights, optionally with pockets from the top
// or bottom, countersunk holes or a step. Parts become separate bodies in
// the 3MF file so Bambu Studio can print them in different colours (AMS).

import {
  union, difference, intersection, offset, fillHoles, regionBounds, regionArea, regionMomentY, emptyBounds, addRingBounds,
  circleRing, ellipseRing, roundedRectRing, crossingsAtY, crossingsAtX, thinParts, transformRegion, insideRegion,
} from './geometry.js';
import { layoutBlock } from './layout.js';
import { isSymbolLike, DEFAULT_FONT } from './fonts.js';
import { qrBlock, graphicBlock, hasQrLogo } from './blocks.js';
import { bridgeIslands } from './stencil.js';
import { splitStencil } from './split.js';
import { stampHandle, handleVolume } from './stamp.js';
import { cupShape } from './cup.js';

export const PART_NAMES = { base: 'Platte', text: 'Schrift', border: 'Rand', outline: 'Kontur', back: 'Rückseite', piece: 'Teil', handle: 'Griff', floor: 'Boden' };
export const KIND_NAMES = { text: 'Text', qr: 'QR-Code', graphic: 'Grafik' };
// Smallest QR module that prints and scans reliably (mm).
export const QR_MIN_MODULE = 1;
export const RELIEF_NAMES = { raised: 'erhaben', engraved: 'vertieft', flush: 'bündig', cut: 'als Schablone' };
// PLA, for the weight estimate.
export const DENSITY = 1.24;
// Thinnest floor left under engraved text.
export const MIN_FLOOR = 0.4;
// Plate material kept between engraved letters and the plate edge.
export const MIN_WALL = 0.8;
// A cup keeps its lettering this far from the seam at the back (mm).
export const SEAM_GAP = 1.5;
// Material kept around magnet pockets and above them.
const MAGNET_WALL = 1.2;
const MIN_CEILING = 0.6;

const DEFAULT_BOX = { minX: -20, minY: -6, maxX: 20, maxY: 6 };
// A mount beside the plate moves away from half height when the plate edge
// there is more than this far inside its outermost point.
const NOTCH = 3;

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

/**
 * Base plate for the lettering (without mount holes). center: where a
 * round plate goes (the common centre of text on a circle, like a coin).
 */
function basePlate(doc, text, box, warnings, center = null) {
  const b = doc.base;
  // Border and outline take room from the padding.
  const p = b.padding + (doc.body.border ? doc.body.borderWidth : 0)
    + (doc.body.outline && doc.body.relief !== 'engraved' ? doc.body.outlineWidth : 0);
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
    case 'cup': {
      // The wall unrolled: the circumference (at half height) wide, as high
      // as the wall along its surface.
      const { circumference: C, length: H } = cupShape(doc.cup);
      return union([[-C / 2, -H / 2, C / 2, -H / 2, C / 2, H / 2, -C / 2, H / 2]]);
    }
    case 'circle': {
      if (fixed) return union([circleRing(0, 0, b.width / 2)]);
      const [mx, my] = center && text.length ? center : [cx, cy];
      const r = (text.length ? farthestDistance(text, mx, my) : Math.hypot(w, h) / 2) + p;
      return union([circleRing(mx, my, r)]);
    }
    default:
      return [];
  }
}

/** Stadium (slot) centred at (cx, cy) with width w and height h. */
function stadiumRing(cx, cy, w, h) {
  return roundedRectRing(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, Math.min(w, h) / 2);
}

/**
 * Point on the plate edge for a mount. Top: above the middle (so a tag
 * hangs straight). Left/right: at half height – unless the plate is
 * pinched there (two lines of different length on a contour); then beside
 * the nearest stretch that reaches out to within NOTCH of the outermost point.
 */
function edgeAt(base, position) {
  const bb = regionBounds(base);
  if (position === 'top') {
    const x = (bb.minX + bb.maxX) / 2;
    const ys = crossingsAtX(base, x);
    return { x, y: ys.length ? ys[ys.length - 1] : bb.maxY, dx: 0, dy: 1 };
  }
  const left = position === 'left';
  const outer = (y) => {
    const xs = crossingsAtY(base, y);
    if (!xs.length) return null;
    return left ? xs[0] : xs[xs.length - 1];
  };
  const n = 64;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const y = bb.minY + ((bb.maxY - bb.minY) * (i + 0.5)) / n;
    const x = outer(y);
    samples.push({ y, out: x === null ? -Infinity : left ? -x : x });
  }
  const best = Math.max(...samples.map((s) => s.out));
  const mid = (bb.minY + bb.maxY) / 2;
  const midX = outer(mid);
  let y = mid;
  if (midX === null || (left ? -midX : midX) < best - NOTCH) {
    // Stretches reaching out far enough; take the one nearest the middle
    // (the upper one if two are about as near).
    let pick = null;
    for (let i = 0; i < n;) {
      if (samples[i].out < best - NOTCH) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < n && samples[j + 1].out >= best - NOTCH) j++;
      const d = Math.max(samples[i].y - mid, mid - samples[j].y, 0);
      if (!pick || d <= pick.d + 0.5) pick = { i, j, d };
      i = j + 1;
    }
    if (pick) y = (samples[pick.i].y + samples[pick.j].y) / 2;
  }
  const x = outer(y);
  return { x: x ?? (left ? bb.minX : bb.maxX), y, dx: left ? -1 : 1, dy: 0 };
}

/** Top radius of countersunk screw holes (90°), limited by the plate. */
export function countersinkRadius(doc) {
  const m = doc.mount;
  const r = m.diameter / 2;
  if (!m.countersink) return r;
  return Math.max(r, Math.min(m.head / 2, r + Math.max(doc.body.thickness - MIN_CEILING, 0)));
}

/** How far the text box must grow for a mount inside the plate. */
function mountRoom(doc) {
  const m = doc.mount;
  if (doc.base.sizeMode !== 'auto' || doc.base.shape === 'contour' || doc.base.shape === 'none') return null;
  if (m.type === 'hole' || m.type === 'slot') return { side: m.position, e: m.diameter + m.ring };
  if (m.type === 'screws') return { side: 'both', e: 2 * countersinkRadius(doc) + m.ring };
  return null;
}

/**
 * Eyelet, hole, slot or two screw holes.
 * base:      plate with all through holes (2D)
 * solidBase: plate for the mesh; countersunk holes are cut by the mesh
 */
function addMount(doc, base, warnings) {
  const m = doc.mount;
  const result = { base, solidBase: base, holes: [], slots: [], countersinks: [] };
  if (m.type === 'none' || !base.length) return result;
  const ri = m.diameter / 2;
  const clear = 0.5;
  const contour = doc.base.shape === 'contour';
  const f = Math.min(1.5, m.ring);
  const fillet = (region) => offset(offset(region, f), -f);

  if (m.type === 'screws') {
    const R = countersinkRadius(doc);
    if (m.countersink && R < m.head / 2 - 1e-9) warnings.push('Die Senkung ist für die Plattendicke zu groß und wurde verkleinert.');
    let plate = base;
    const holes = [];
    for (const position of ['left', 'right']) {
      const e = edgeAt(plate, position);
      let cx;
      if (contour) {
        // Tabs outside the contour.
        cx = e.x + e.dx * (R + clear);
        plate = union(plate, [circleRing(cx, e.y, R + m.ring)]);
      } else {
        cx = e.x - e.dx * (R + m.ring);
      }
      holes.push({ cx, cy: e.y, r: ri, R });
    }
    if (contour) plate = fillet(plate);
    const through = difference(plate, holes.map((h) => circleRing(h.cx, h.cy, ri)));
    result.base = through;
    result.holes = holes;
    if (m.countersink && R > ri + 1e-6) {
      // The mesh cuts these holes itself: cylinder plus 90° cone.
      result.solidBase = plate;
      result.countersinks = holes.map((h) => ({ cx: h.cx, cy: h.cy, r: ri, R, depth: R - ri }));
    } else {
      result.solidBase = through;
    }
    return result;
  }

  const e = edgeAt(base, m.position);
  const outside = m.type === 'eyelet' || contour;
  if (m.type === 'slot') {
    const vertical = m.position !== 'top';
    const L = Math.max(m.length, m.diameter);
    const [sw, sh] = vertical ? [m.diameter, L] : [L, m.diameter];
    const inset = outside ? -(ri + clear) : m.ring + ri;
    const cx = e.x - e.dx * inset;
    const cy = e.y - e.dy * inset;
    let plate = base;
    if (outside) plate = fillet(union(base, [stadiumRing(cx, cy, sw + 2 * m.ring, sh + 2 * m.ring)]));
    const hole = stadiumRing(cx, cy, sw, sh);
    if (!outside && regionArea(difference([hole], offset(plate, -m.ring / 2))) > 0.01) {
      warnings.push('Der Schlitz passt nicht ganz in die Platte – kürzer machen oder die Platte vergrößern.');
    }
    result.base = difference(plate, [hole]);
    result.solidBase = result.base;
    result.slots = [hole];
    return result;
  }

  // Eyelet (ring outside) or hole inside the plate.
  const inset = outside ? -(ri + clear) : m.ring + ri;
  const cx = e.x - e.dx * inset;
  const cy = e.y - e.dy * inset;
  let plate = base;
  if (outside) plate = fillet(union(base, [circleRing(cx, cy, ri + m.ring)]));
  result.base = difference(plate, [circleRing(cx, cy, ri)]);
  result.solidBase = result.base;
  result.holes = [{ cx, cy, r: ri }];
  return result;
}

/**
 * Magnet pockets on the back, spread along the long axis of the plate and
 * away from holes, slots and whatever is on the back (avoid: region).
 */
function magnetPockets(doc, base, mount, avoid, warnings) {
  const mg = doc.magnets;
  if (!mg.enabled || !base.length) return { pockets: [], centers: [] };
  const r = mg.diameter / 2;
  let allowed = offset(base, -(r + MAGNET_WALL));
  const keepOut = [
    ...mount.holes.map((h) => circleRing(h.cx, h.cy, (h.R || h.r) + r + MAGNET_WALL)),
    ...mount.slots.map((s) => offset([s], r + MAGNET_WALL)).flat(),
    ...(avoid.length ? offset(avoid, r + MAGNET_WALL) : []),
  ];
  if (keepOut.length) allowed = difference(allowed, keepOut);
  if (!allowed.length) {
    warnings.push('Die Magnete passen nicht in die Platte – kleiner wählen, die Platte vergrößern oder Platz auf der Rückseite lassen.');
    return { pockets: [], centers: [] };
  }
  // The line along the long axis with the most room: first through the
  // middle, else a little above or below.
  const bb = regionBounds(base);
  const horizontal = bb.maxX - bb.minX >= bb.maxY - bb.minY;
  const mid = horizontal ? (bb.minY + bb.maxY) / 2 : (bb.minX + bb.maxX) / 2;
  const across = horizontal ? bb.maxY - bb.minY : bb.maxX - bb.minX;
  const intervalsAt = (c) => {
    const xs = horizontal ? crossingsAtY(allowed, c) : crossingsAtX(allowed, c);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
  };
  const room = (iv) => iv.reduce((sum, [a, b]) => sum + b - a, 0) + iv.length * 1e-3;
  let line = mid;
  let intervals = intervalsAt(mid);
  for (let k = 1; k <= 20 && !intervals.length; k++) {
    for (const c of [mid + (k * across) / 42, mid - (k * across) / 42]) {
      const iv = intervalsAt(c);
      if (room(iv) > room(intervals)) {
        intervals = iv;
        line = c;
      }
    }
  }
  if (!intervals.length) {
    warnings.push('Die Magnete passen nicht in die Platte – kleiner wählen, die Platte vergrößern oder Platz auf der Rückseite lassen.');
    return { pockets: [], centers: [] };
  }
  // Evenly over the whole span, each moved to the nearest free spot.
  const lo = intervals[0][0];
  const hi = intervals[intervals.length - 1][1];
  const snap = (s) => {
    let best = null;
    for (const [a, b] of intervals) {
      const v = Math.min(b, Math.max(a, s));
      if (best === null || Math.abs(v - s) < Math.abs(best - s)) best = v;
    }
    return best;
  };
  const pitch = 2 * r + MAGNET_WALL;
  let n = mg.count;
  let spots = [];
  for (; n >= 1; n--) {
    spots = [];
    for (let i = 0; i < n; i++) spots.push(snap(n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1)));
    spots.sort((a, b) => a - b);
    if (spots.every((s, i) => i === 0 || s - spots[i - 1] >= pitch - 1e-9)) break;
  }
  if (n < mg.count) warnings.push(`Nur ${n} Magnet${n === 1 ? '' : 'e'} passen nebeneinander in die Platte.`);
  const centers = spots.map((s) => (horizontal ? { cx: s, cy: line, r } : { cx: line, cy: s, r }));
  return { pockets: union(centers.map((c) => circleRing(c.cx, c.cy, r))), centers };
}

/** Label of a block as in the side panel: „Text 1“, „QR-Code 2“ … */
export function blockLabel(doc, block) {
  return `${KIND_NAMES[block.kind] || KIND_NAMES.text} ${doc.texts.indexOf(block) + 1}`;
}

const fmt = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** Relative luminance (WCAG) of a #rrggbb colour. */
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** A #rrggbb colour a bit darker (light colours) or lighter (dark ones). */
export function shade(hex, amount) {
  if (!amount) return hex;
  const target = luminance(hex) > 0.18 ? 0 : 255;
  return `#${[1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (target - v) * amount).toString(16).padStart(2, '0');
  }).join('')}`;
}

/**
 * Region of one block in the coordinates of its side (before a back block
 * is mirrored): { block, region, footprint, bounds, … }, null if empty,
 * 'pending' while its font loads.
 */
function blockLayout(block, getFace, keepCurves, warnings, missing) {
  if (block.kind === 'qr') {
    // Logo in the middle: a symbol (laid out with the default font, which
    // falls back to the symbol font) or an imported graphic.
    let logo = null;
    if (hasQrLogo(block) && block.qrLogo === 'symbol') {
      const face = getFace(DEFAULT_FONT);
      if (!face) return 'pending';
      const lay = layoutBlock({ text: block.qrLogoSymbol, size: 10, letterSpacing: 0, lineSpacing: 1.2, align: 'center', layout: 'line' }, face);
      for (const ch of lay.missing) missing.add(ch);
      logo = lay.region;
    } else if (hasQrLogo(block)) {
      logo = graphicBlock({ graphic: block.qrLogoGraphic, size: 100, x: 0, y: 0, rotation: 0 }).region;
    }
    const q = qrBlock(block, { logo });
    if (q.error) {
      warnings.push(`${KIND_NAMES.qr}: ${q.error}`);
      return null;
    }
    const region = block.bold ? offset(q.region, block.bold / 2, { join: 'miter' }) : q.region;
    return { block, region, footprint: q.footprint, bounds: regionBounds(q.footprint), qr: q };
  }
  if (block.kind === 'graphic') {
    const gr = graphicBlock(block);
    if (!gr.region.length) return null;
    const region = block.bold ? offset(gr.region, block.bold / 2) : gr.region;
    return { block, region, footprint: region, bounds: regionBounds(region), graphic: gr };
  }
  if (!block.text.trim()) return null;
  const face = getFace(block.font);
  if (!face) return 'pending';
  const lay = layoutBlock(block, face, { keepCurves });
  const region = block.bold ? offset(lay.region, block.bold / 2) : lay.region;
  for (const ch of lay.missing) missing.add(ch);
  const plain = [...lay.missing].filter((ch) => !isSymbolLike(ch));
  if (plain.length) warnings.push(`In „${block.font.family}“ fehlen die Zeichen ${plain.join(' ')}.`);
  return { block, ...lay, region, footprint: region };
}

/**
 * The whole model. getFace(fontRef) returns a loaded FontFace or null
 * (then `pending` is true and the text of that block is missing).
 * symbolsLoading: emoji outlines are still being loaded (for the warning).
 */
export function buildModel(doc, getFace, { keepCurves = false, symbolsLoading = false } = {}) {
  const warnings = [];
  const layouts = [];
  const missing = new Set();
  let pending = false;
  const hasPlate = doc.base.shape !== 'none';
  const MIRROR = [-1, 0, 0, 1, 0, 0];
  for (const block of doc.texts) {
    const lay = blockLayout(block, getFace, keepCurves, warnings, missing);
    if (lay === 'pending') {
      pending = true;
      continue;
    }
    if (!lay) continue;
    // The back is seen from behind: its content is mirrored into the plate.
    lay.side = block.side === 'back' && hasPlate ? 'back' : 'front';
    const toWorld = (r) => (lay.side === 'back' ? transformRegion(r, MIRROR) : r);
    lay.world = toWorld(lay.region);
    lay.worldFootprint = lay.footprint === lay.region ? lay.world : toWorld(lay.footprint);
    layouts.push(lay);
  }
  if (!hasPlate && doc.texts.some((b) => b.side === 'back')) warnings.push('Ohne Platte gibt es keine Rückseite – alles steht vorne.');
  const front = layouts.filter((l) => l.side === 'front');
  const back = layouts.filter((l) => l.side === 'back');
  // Everything the plate has to carry (QR codes with their quiet zone).
  const text = union(...layouts.map((l) => l.worldFootprint));
  const symbols = [...missing].filter(isSymbolLike);
  if (symbols.length) {
    warnings.push(symbolsLoading
      ? `Symbole ${symbols.join(' ')} werden geladen …`
      : `Für ${symbols.join(' ')} gibt es keinen Umriss – ${symbols.length === 1 ? 'das Symbol fehlt' : 'die Symbole fehlen'} im Modell.`);
  }

  const { body } = doc;
  // A cup (pen holder): the wall unrolled, bent around afterwards; no
  // mount, magnets, back or stamp (the panels say so; only dropped
  // lettering is worth a warning).
  const cup = doc.base.shape === 'cup';
  if (cup) {
    if (back.length) warnings.push('Ein Becher hat keine Rückseite – die Blöcke hinten entfallen.');
    doc = { ...doc, mount: { ...doc.mount, type: 'none' }, magnets: { ...doc.magnets, enabled: false }, stamp: { ...doc.stamp, enabled: false }, stencil: { ...doc.stencil, split: false } };
    back.length = 0;
    layouts.splice(0, layouts.length, ...front);
  }
  const box = boxOf(text);
  const room = mountRoom(doc);
  if (room) {
    if (room.side === 'left' || room.side === 'both') box.minX -= room.e;
    if (room.side === 'right' || room.side === 'both') box.maxX += room.e;
    if (room.side === 'top') box.maxY += room.e;
  }
  // Text on circles with one common centre (a coin): the round plate is
  // concentric with it.
  const circles = front.filter((l) => l.arc && l.block.layout !== 'bend').map((l) => l.arc);
  const common = circles.length && circles.every((c) => Math.hypot(c.cx - circles[0].cx, c.cy - circles[0].cy) < 0.01)
    ? [circles[0].cx, circles[0].cy] : null;
  const plate0 = basePlate(doc, text, box, warnings, common);
  const mount = addMount(doc, plate0, warnings);
  let base = mount.base;
  if (base.length > 1) warnings.push(`Die Platte zerfällt in ${base.length} Teile.`);
  // A stamp: mirrored lettering, the handle on the back.
  const stamp = doc.stamp.enabled && base.length > 0;
  if (stamp && doc.magnets.enabled) warnings.push('Ein Stempel hat hinten den Griff – keine Magnet-Taschen.');
  // Magnets keep clear of the back (a QR code there needs its quiet zone).
  const magnets = stamp ? { pockets: [], centers: [] } : magnetPockets(doc, base, mount, union(...back.map((l) => l.worldFootprint)), warnings);

  const t = body.thickness;
  let relief = base.length ? body.relief : 'raised';
  if (stamp && (relief === 'flush' || relief === 'cut')) {
    warnings.push('Ein Stempel braucht erhabene oder vertiefte Schrift – hier erhaben.');
    relief = 'raised';
  }
  // Sloped flanks of a raised stamp: the letters get wider towards the plate.
  const grow = stamp && relief === 'raised' ? body.height * Math.tan((doc.stamp.draft * Math.PI) / 180) : 0;
  const depth = Math.min(body.height, Math.max(t - MIN_FLOOR, 0.1));
  const sunk = relief === 'engraved' || relief === 'flush';
  if (sunk && body.height > depth + 1e-9) {
    warnings.push(`Die Vertiefung ist auf ${depth.toLocaleString('de-DE')} mm begrenzt, damit ${MIN_FLOOR.toLocaleString('de-DE')} mm Boden bleiben.`);
  }

  // Border: raised on top, or inlaid flush with the plate. Measured from
  // the plate the mesh uses, so there is no border ring around countersunk
  // holes (the mesh cuts those itself).
  let border = [];
  let inner = mount.solidBase;
  if (body.border && base.length && relief !== 'cut') {
    if (cup) {
      // Around a cup: a ring at the top and at the bottom.
      const b = regionBounds(base);
      const w = Math.min(body.borderWidth, (b.maxY - b.minY) / 3);
      border = union([[b.minX, b.maxY - w, b.maxX, b.maxY - w, b.maxX, b.maxY, b.minX, b.maxY]], [[b.minX, b.minY, b.maxX, b.minY, b.maxX, b.minY + w, b.minX, b.minY + w]]);
      inner = difference(mount.solidBase, border);
    } else {
      inner = offset(mount.solidBase, -body.borderWidth);
      border = difference(mount.solidBase, inner);
    }
  }
  // Where lettering may go (pockets keep a wall to every edge and hole).
  let area = base;
  if (base.length) {
    const plate = border.length ? inner : base;
    if (relief === 'flush') area = offset(plate, border.length ? -0.6 : -MIN_WALL);
    else if (relief === 'engraved') area = border.length ? inner : offset(base, -MIN_WALL);
    // A stencil keeps a frame all around.
    else if (relief === 'cut') area = offset(base, -MIN_WALL);
    // Sloped flanks must not run over the edge.
    else if (grow > 0) area = offset(plate, -(grow + MIN_WALL));
    else area = plate;
    const keepOut = mount.countersinks.map((c) => circleRing(c.cx, c.cy, c.R + (sunk ? MIN_WALL : 0.4)));
    if (keepOut.length) area = difference(area, keepOut);
    // A cup: nothing on the seam at the back, where the wall closes.
    if (cup) {
      const b = regionBounds(base);
      area = intersection(area, [[b.minX + SEAM_GAP, b.minY - 1, b.maxX - SEAM_GAP, b.minY - 1, b.maxX - SEAM_GAP, b.maxY + 1, b.minX + SEAM_GAP, b.maxY + 1]]);
    }
  }

  // Content per block, clipped to where it may go; where blocks overlap,
  // the later one wins.
  const clip = (list, zone) => {
    const out = [];
    let above = [];
    for (let i = list.length - 1; i >= 0; i--) {
      let r = zone ? intersection(list[i].world, zone) : list[i].world;
      if (above.length && r.length) r = difference(r, above);
      above = above.length ? union(above, list[i].world) : list[i].world;
      out.unshift({ block: list[i].block, region: r });
    }
    return out;
  };
  const blocks = clip(front, base.length ? area : null);
  let letters = union(...blocks.map((b) => b.region));
  if (base.length && regionArea(union(...front.map((l) => l.world))) - regionArea(letters) > 0.05) {
    warnings.push('Die Schrift ragt über die Platte hinaus und wird abgeschnitten.');
  }
  // Stencil: bridges hold the islands (the inside of O, A, B …).
  let bridges = [];
  let islands = 0;
  let loose = [];
  if (relief === 'cut' && letters.length) {
    const st = bridgeIslands(base, letters, { width: doc.stencil.bridge, count: doc.stencil.bridges, direction: doc.stencil.direction });
    bridges = st.bridges;
    letters = st.cut;
    islands = st.islands;
    loose = st.loose;
    if (st.unresolved) warnings.push(`${st.unresolved} Insel${st.unresolved === 1 ? '' : 'n'} der Schablone ließ${st.unresolved === 1 ? '' : 'en'} sich nicht mit Stegen halten – Schrift oder Stegrichtung ändern.`);
    for (const b of blocks) b.region = intersection(b.region, letters);
  }

  // Outline around the lettering (third colour).
  const useOutline = body.outline && base.length > 0 && relief !== 'engraved' && relief !== 'cut';
  let outline = useOutline && letters.length ? intersection(offset(letters, body.outlineWidth), area) : [];

  // Colour groups by AMS filament; own filaments are named after the first
  // block that uses them (Bambu Studio's object list).
  const colourGroups = (list, idBase, defaultName, ownName) => {
    const out = [];
    for (const b of list) {
      const slot = b.block.slot || doc.slots.text;
      let g = out.find((x) => x.slot === slot);
      if (!g) {
        const own = slot !== doc.slots.text;
        g = {
          slot,
          id: own ? `${idBase}-${slot}` : idBase,
          name: own ? ownName(b.block) : defaultName,
          color: own && b.block.color ? b.block.color : doc.colors.text,
          regions: [],
        };
        out.push(g);
      }
      g.regions.push(b.region);
    }
    out.sort((a, b) => (a.id === idBase ? -1 : b.id === idBase ? 1 : 0));
    for (const g of out) g.region = union(...g.regions);
    return out.filter((g) => g.region.length);
  };
  let groups = colourGroups(blocks, 'text', PART_NAMES.text, (b) => blockLabel(doc, b));
  // A stamp is one piece: all lettering together.
  if (stamp && groups.length > 1) {
    groups = [{ ...groups[0], id: 'text', name: PART_NAMES.text, color: doc.colors.text, slot: doc.slots.text, region: union(...groups.map((g) => g.region)) }];
  }

  // Back: sunk into the bottom (or inlaid there in its own colour), never
  // meeting the pockets from the top, the edge, holes or magnet pockets.
  let backLetters = [];
  let backGroups = [];
  let backDepth = 0;
  if (back.length && base.length && relief === 'cut') warnings.push('Eine Schablone hat keine Rückseite – die Blöcke hinten entfallen.');
  else if (back.length && stamp) warnings.push('Ein Stempel hat hinten den Griff – die Blöcke hinten entfallen.');
  if (back.length && base.length && relief !== 'cut' && !stamp) {
    const room = t - (sunk ? depth : 0) - MIN_FLOOR;
    backDepth = Math.min(doc.back.depth, room);
    if (backDepth < 0.1) {
      warnings.push(`Für die Rückseite ist die Platte zu dünn – mindestens ${fmt(doc.back.depth + MIN_FLOOR + (sunk ? depth : 0))} mm nötig.`);
      backDepth = 0;
    } else {
      if (backDepth < doc.back.depth - 1e-9) warnings.push(`Die Rückseite ist nur ${fmt(backDepth)} mm tief, damit ${fmt(MIN_FLOOR)} mm Material bleiben.`);
      let backArea = offset(base, -MIN_WALL);
      const keep = magnets.centers.map((c) => circleRing(c.cx, c.cy, c.r + MIN_WALL));
      if (keep.length) backArea = difference(backArea, keep);
      const backBlocks = clip(back, backArea);
      backLetters = union(...backBlocks.map((b) => b.region));
      if (regionArea(union(...back.map((l) => l.world))) - regionArea(backLetters) > 0.05) {
        warnings.push('Die Rückseite ragt über die Platte oder in Löcher und Magnet-Taschen und wird abgeschnitten.');
      }
      backGroups = colourGroups(backBlocks, 'back', PART_NAMES.back, (b) => `${PART_NAMES.back} ${blockLabel(doc, b)}`);
    }
  }

  // QR codes: big enough modules, contrast, nothing else in their area.
  for (const lay of layouts) {
    if (!lay.qr) continue;
    const label = blockLabel(doc, lay.block);
    const minModule = Math.max(QR_MIN_MODULE, doc.check.minStroke || 0);
    if (lay.qr.module < minModule - 1e-9) {
      warnings.push(`${label}: Die Module sind nur ${fmt(lay.qr.module)} mm groß – für einen sicheren Druck mindestens ${fmt(minModule)} mm (größer machen oder weniger Inhalt).`);
    }
    const others = layouts.filter((l) => l !== lay && l.side === lay.side);
    if (others.length && regionArea(intersection(union(...others.map((l) => l.world)), lay.worldFootprint)) > 0.01) {
      warnings.push(`${label}: Etwas anderes ragt in den QR-Code oder seinen Rand – dann lässt er sich nicht lesen.`);
    }
    if (!base.length) {
      warnings.push(`${label}: Ohne Platte zerfällt der QR-Code – eine Grundform wählen.`);
      continue;
    }
    const inlaid = lay.side === 'back' ? doc.back.relief === 'inlay' : relief !== 'engraved';
    if (!inlaid) {
      warnings.push(`${label}: Vertieft in derselben Farbe hat der QR-Code kaum Kontrast – besser erhaben oder bündig in einer zweiten Farbe.`);
      continue;
    }
    const color = lay.block.slot && lay.block.slot !== doc.slots.text && lay.block.color ? lay.block.color : doc.colors.text;
    const lq = luminance(color);
    const lp = luminance(doc.colors.base);
    const ratio = (Math.max(lq, lp) + 0.05) / (Math.min(lq, lp) + 0.05);
    if (ratio < 3) warnings.push(`${label}: Zu wenig Kontrast zwischen QR-Code und Platte – deutlich hellere und dunklere Farben wählen.`);
    else if (lq > lp) warnings.push(`${label}: Heller QR-Code auf dunkler Platte – nicht jede Kamera liest das. Sicherer: dunkel auf hell.`);
  }

  // Stamps: everything mirrored.
  const mirror = doc.mirror || stamp;
  let holes = mount.holes;
  let slots = mount.slots;
  let countersinks = mount.countersinks;
  let magnetCenters = magnets.centers;
  let solidBase = mount.solidBase;
  let magnetPocketRegion = magnets.pockets;
  if (mirror) {
    const M = [-1, 0, 0, 1, 0, 0];
    const flip = (r) => transformRegion(r, M);
    base = flip(base);
    solidBase = flip(solidBase);
    inner = flip(inner);
    letters = flip(letters);
    bridges = flip(bridges);
    loose = flip(loose);
    backLetters = flip(backLetters);
    for (const g of backGroups) g.region = flip(g.region);
    border = flip(border);
    outline = flip(outline);
    magnetPocketRegion = flip(magnetPocketRegion);
    for (const g of groups) g.region = flip(g.region);
    slots = slots.map((s) => transformRegion([{ outer: s, holes: [] }], M)[0].outer);
    holes = holes.map((h) => ({ ...h, cx: -h.cx }));
    countersinks = countersinks.map((c) => ({ ...c, cx: -c.cx }));
    magnetCenters = magnetCenters.map((c) => ({ ...c, cx: -c.cx }));
  }

  // Stencils bigger than the bed: pieces with puzzle connectors, which
  // keep clear of screw holes and magnets.
  let split = null;
  if (relief === 'cut' && doc.stencil.split && letters.length) {
    const avoid = [
      ...countersinks.map((c) => circleRing(c.cx, c.cy, c.R + MIN_WALL)),
      ...magnetCenters.map((c) => circleRing(c.cx, c.cy, c.r + MIN_WALL)),
    ];
    split = splitStencil(difference(solidBase, letters), {
      bed: doc.check.bed, clearance: doc.stencil.clearance, tab: doc.stencil.tab, islands: loose, avoid: avoid.length ? union(avoid) : [],
    });
    if (split) warnings.push(...split.warnings);
  }

  // Stamp: a socket in the back for the peg of the handle; the handle is an
  // object of its own beside the stamp, upside down as it is printed.
  let socket = [];
  let handle = null;
  if (stamp && doc.stamp.handle) {
    const made = stampHandle(doc, solidBase, t - (relief === 'engraved' ? depth : 0), warnings);
    socket = made.socket;
    handle = made.handle;
  }

  // Parts.
  const parts = [];
  const add = (id, name, color, slot, solids, extra = {}) => {
    const ok = solids.filter((s) => s.kind === 'handle' || (s.region.length && s.z1 > s.z0 + 1e-9));
    if (ok.length) parts.push({ id, name, color, slot, solids: ok, ...extra });
  };
  // Raised lettering, on a stamp with sloped flanks: thin steps, each a
  // little narrower, up to the letters themselves.
  const textSolid = (region, z0, z1) => {
    if (!(grow > 0)) return { region, z0, z1 };
    const k = Math.max(2, Math.min(12, Math.round((z1 - z0) / 0.25)));
    const steps = [];
    for (let i = 1; i < k; i++) {
      steps.push({ region: i === k - 1 ? region : offset(region, (grow * (k - 1 - i)) / (k - 1)), z: z0 + (i * (z1 - z0)) / k });
    }
    return { region: offset(region, grow), z0, z1, steps };
  };
  const textParts = (z0, z1) => groups.forEach((g) => add(g.id, g.name, g.color, g.slot, [textSolid(g.region, z0, z1)]));
  // Magnet pockets never reach the text pockets: at least MIN_CEILING stays.
  const magnetRoom = t - (sunk ? depth : 0) - MIN_CEILING;
  let magnetDepth = doc.magnets.depth;
  if (magnetCenters.length && magnetDepth > magnetRoom + 1e-9) {
    const need = doc.magnets.depth + MIN_CEILING + (sunk ? depth : 0);
    if (magnetRoom < 0.4) {
      warnings.push(`Für Magnet-Taschen ist die Platte zu dünn – mindestens ${fmt(need)} mm nötig.`);
      magnetCenters = [];
      magnetPocketRegion = [];
    } else {
      warnings.push(`Die Magnet-Taschen sind nur ${fmt(magnetRoom)} mm tief (statt ${fmt(doc.magnets.depth)} mm), damit ${fmt(MIN_CEILING)} mm Material darüber bleiben – für volle Tiefe die Platte auf ${fmt(need)} mm erhöhen.`);
      magnetDepth = magnetRoom;
    }
  }
  // Pockets in the bottom: magnets, the lettering of the back, the socket of a stamp.
  const bottom = [{ region: magnetPocketRegion, depth: magnetDepth }, { region: backLetters, depth: backDepth }];
  if (socket.length) bottom.push({ region: socket, depth: handle.socketDepth });
  const plateSolid = { region: solidBase, z0: 0, z1: t, countersinks, bottom };
  const ho = outline.length ? body.outlineHeight : 0;
  if (!base.length) {
    textParts(0, t);
  } else if (relief === 'raised') {
    add('base', PART_NAMES.base, doc.colors.base, doc.slots.base, [plateSolid]);
    if (outline.length) add('outline', PART_NAMES.outline, doc.colors.outline, doc.slots.outline, [{ region: outline, z0: t, z1: t + ho }]);
    textParts(t + ho, t + ho + body.height);
    if (border.length) add('border', PART_NAMES.border, doc.colors.border, doc.slots.border, [{ region: border, z0: t, z1: t + body.borderHeight }]);
  } else if (relief === 'engraved') {
    add('base', PART_NAMES.base, doc.colors.base, doc.slots.base, [{ ...plateSolid, pockets: letters, depth }]);
    if (border.length) add('border', PART_NAMES.border, doc.colors.border, doc.slots.border, [{ region: border, z0: t, z1: t + body.borderHeight }]);
  } else if (relief === 'flush') {
    const pockets = outline.length ? outline : letters;
    const step = border.length ? { region: inner, z: t - depth } : null;
    add('base', PART_NAMES.base, doc.colors.base, doc.slots.base, [{ ...plateSolid, pockets, depth, step }]);
    if (outline.length) add('outline', PART_NAMES.outline, doc.colors.outline, doc.slots.outline, [{ region: difference(outline, letters), z0: t - depth, z1: t }]);
    textParts(t - depth, t);
    if (border.length) add('border', PART_NAMES.border, doc.colors.border, doc.slots.border, [{ region: border, z0: t - depth, z1: t }]);
  } else if (relief === 'cut' && split) {
    // Every other piece a little darker, so they stand apart in the preview.
    for (const p of split.pieces) {
      const pocket = magnetPocketRegion.length ? intersection(magnetPocketRegion, p.region) : [];
      add(`piece-${p.label}`, `${PART_NAMES.piece} ${p.label}`, shade(doc.colors.base, (p.cell[0] + p.cell[1]) % 2 ? 0.12 : 0), doc.slots.base, [{
        region: p.region,
        z0: 0,
        z1: t,
        countersinks: countersinks.filter((c) => insideRegion(p.region, c.cx, c.cy)),
        bottom: [{ region: pocket, depth: magnetDepth }],
      }], { piece: p.label, cell: p.cell });
    }
  } else if (relief === 'cut') {
    add('base', PART_NAMES.base, doc.colors.base, doc.slots.base, [{ ...plateSolid, region: difference(solidBase, letters) }]);
  }
  // Back lettering inlaid in its own colour: the first layers on the bed.
  if (base.length && backDepth > 0 && doc.back.relief === 'inlay') {
    for (const g of backGroups) add(g.id, g.name, g.color, g.slot, [{ region: g.region, z0: 0, z1: backDepth }]);
  }
  if (handle) add('handle', PART_NAMES.handle, shade(doc.colors.base, 0.12), doc.slots.base, [handle.solid], { object: 'handle' });
  // A cup: every part is bent around the axis (the plate top is the
  // outside), plus a floor reaching halfway into the wall.
  let cupInfo = null;
  if (cup && base.length) {
    const b = regionBounds(base);
    const shape = cupShape(doc.cup);
    const { r0, r1, sin, cos } = shape;
    const segments = Math.max(72, Math.min(360, Math.round(2 * Math.max(r0, r1) * 2.5)));
    const wrap = { seam: [b.minX, b.maxX], radius: shape.radius, t, height: b.maxY - b.minY, sin, cos, segments };
    for (const part of parts) for (const s of part.solids) s.wrap = wrap;
    // The floor reaches halfway into the wall; on a sloped wall in slices
    // that follow it.
    const floor = Math.min(doc.cup.bottom, shape.height);
    const tan = sin / cos;
    const slices = Math.max(1, Math.ceil((floor * Math.abs(sin)) / (t / 2)));
    const discs = [];
    for (let i = 0; i < slices; i++) {
      const z0 = (floor * i) / slices;
      const z1 = (floor * (i + 1)) / slices;
      discs.push({ region: union([circleRing(0, 0, r0 + ((z0 + z1) / 2) * tan - t / (2 * cos))]), z0, z1 });
    }
    add('floor', PART_NAMES.floor, doc.colors.base, doc.slots.base, discs);
    if (t > Math.min(r0, r1) * 0.6) warnings.push('Die Wand ist für diesen Durchmesser zu dick.');
    const degrees = Math.abs((shape.slope * 180) / Math.PI);
    if (degrees > 35) warnings.push(`Die Wand ist ${Math.round(degrees)}° schräg – ohne Stützen druckt man meist bis etwa 40°.`);
    cupInfo = {
      diameter: doc.cup.diameter, top: 2 * r1, conical: r0 !== r1, height: shape.height, length: shape.length,
      circumference: b.maxX - b.minX, floor, wall: t, slope: degrees, shape,
    };
  }

  // Checks.
  // Stencils: thin material (bridges, walls between letters); else thin strokes.
  const thin = !doc.check.minStroke ? []
    : relief === 'cut' ? thinParts(difference(base, letters), doc.check.minStroke) : thinParts(letters, doc.check.minStroke);
  const thinBack = backLetters.length && doc.check.minStroke ? thinParts(backLetters, doc.check.minStroke) : [];
  if (!base.length && letters.length > 1) warnings.push(`Die Buchstaben bestehen aus ${letters.length} getrennten Teilen (z. B. i-Punkte) – ohne Platte fallen sie auseinander.`);

  const all = union(base, letters, border, outline);
  const bounds = all.length ? regionBounds(all) : emptyBounds();
  const bed = doc.check.bed;
  // A cup stands on the bed: its outer diameter (lettering included) and height count.
  const flatTop = parts.filter((p) => p.object !== 'handle' && p.id !== 'floor').reduce((z, part) => Math.max(z, ...part.solids.map((s) => s.z1)), 0);
  const cupRadius = cupInfo ? Math.max(cupInfo.shape.r0, cupInfo.shape.r1) + (flatTop - t) / cupInfo.shape.cos : 0;
  const size = cupInfo ? [2 * cupRadius, cupInfo.height] : [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY];
  if (!split && Number.isFinite(bounds.minX) && Math.max(...size) > bed - 4) {
    warnings.push(`Größer als das Druckbett (${bed} × ${bed} mm)${relief === 'cut' && !cupInfo ? ' – „In Teile aufteilen“ einschalten.' : '.'}`);
  }
  let volume = 0;
  for (const part of parts) {
    part.volume = part.solids.reduce((v, s) => v + solidVolume(s), 0);
    volume += part.volume;
  }
  // Height of the sign itself (a stamp's handle stands beside it).
  const top = cupInfo ? cupInfo.height : flatTop;
  const textBox = letters.length ? regionBounds(letters) : null;
  // Everything in the 3D view, a stamp's handle included, a cup standing.
  const extent = cupInfo ? { minX: -cupRadius, minY: -cupRadius, maxX: cupRadius, maxY: cupRadius, top } : { ...bounds, top };
  if (handle && Number.isFinite(bounds.minX)) {
    const { at, z1 } = handle.solid;
    const r = handle.diameter / 2;
    Object.assign(extent, {
      minX: Math.min(bounds.minX, at[0] - r), maxX: Math.max(bounds.maxX, at[0] + r),
      minY: Math.min(bounds.minY, at[1] - r), maxY: Math.max(bounds.maxY, at[1] + r),
      top: Math.max(top, z1),
    });
  }
  return {
    doc,
    layouts,
    text: letters,
    textGroups: groups,
    // Stencil bridges and the number of islands they hold.
    bridges,
    islands,
    // Pieces of a stencil bigger than the bed (with puzzle connectors).
    pieces: split ? split.pieces : [],
    // Lettering mirrored (stamps); a stamp's socket and handle.
    mirrored: mirror,
    socket,
    stamp: stamp ? { handle: handle ? { height: handle.height, diameter: handle.diameter, socketDepth: handle.socketDepth } : null, draft: grow > 0 ? doc.stamp.draft : 0 } : null,
    split: split ? { nx: split.nx, ny: split.ny, tabs: split.tabs.length, tabHead: split.tabHead } : null,
    // Back (world coordinates, i.e. mirrored as seen from the front).
    backText: backLetters,
    backGroups,
    backDepth,
    thinBack,
    base,
    // Plate as seen from above (with the lettering cut out when it goes through).
    plate: relief === 'cut' ? difference(base, letters) : base,
    inner,
    border,
    outline,
    holes,
    slots,
    countersinks,
    magnets: magnetCenters,
    magnetDepth,
    thin,
    parts,
    relief,
    depth,
    bounds,
    extent,
    warnings,
    pending,
    missing,
    // A flat top can be printed upside down (lettering on the textured plate).
    flippable: parts.length > 0 && !cupInfo && (relief === 'flush' || relief === 'cut' || !base.length),
    // A cup: diameter, height, circumference of the unrolled wall.
    cup: cupInfo,
    stats: {
      width: size[0],
      height: cupInfo ? size[0] : size[1],
      top,
      volume,
      grams: (volume / 1000) * DENSITY,
      textWidth: textBox ? textBox.maxX - textBox.minX : 0,
      textHeight: textBox ? textBox.maxY - textBox.minY : 0,
      thinCount: thin.length + thinBack.length,
    },
  };
}

/** Volume of a solid (see mesh.js addSolid). */
export function solidVolume(s) {
  if (s.kind === 'handle') return handleVolume(s);
  // Bent around a cup, a slab grows with its distance from the axis: the
  // flat size holds on the outside at half height (radius); further in it
  // shrinks, on a cone it also grows with the height (y) up the wall.
  const w = s.wrap;
  const slab = w
    ? (region, za, zb) => ((zb - za) * (regionArea(region) * (w.radius + ((za + zb) / 2 - w.t) / (w.cos ?? 1)) + (w.sin ?? 0) * regionMomentY(region))) / w.radius
    : (region, za, zb) => regionArea(region) * (zb - za);
  // Slabs: the region up to the first step, each step up to the next.
  const steps = s.steps || (s.step ? [s.step] : []);
  let v = 0;
  let region = s.region;
  let z = s.z0;
  for (const st of steps) {
    v += slab(region, z, st.z);
    region = st.region;
    z = st.z;
  }
  v += slab(region, z, s.z1);
  if (s.pockets) v -= slab(s.pockets, s.z1 - s.depth, s.z1);
  for (const b of s.bottom || []) if (b.region.length && b.depth > 0) v -= slab(b.region, s.z0, s.z0 + b.depth);
  for (const c of s.countersinks || []) {
    // Polygonal cylinder and cone with the same corner count as the mesh.
    const n = countersinkSegments(c.R);
    const area = (r) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
    const zc = s.z1 - c.depth;
    v -= area(c.r) * (zc - s.z0);
    v -= (c.depth / 3) * (area(c.r) + area(c.R) + Math.sqrt(area(c.r) * area(c.R)));
  }
  return v;
}

/** Corner count used for countersunk holes (same for both rings). */
export function countersinkSegments(R) {
  return Math.max(24, Math.min(96, Math.ceil(R * 8)));
}

/** Bounding box of a list of rings (for thumbnails etc.). */
export function ringsBounds(rings) {
  const b = emptyBounds();
  for (const r of rings) addRingBounds(b, r);
  return b;
}
