// Builds the 2D design (lettering, base plate, mount, border) and the 3D
// parts from the document. A part is a list of solids (see mesh.js): a
// region extruded between two heights, optionally with pockets from the top
// or bottom, countersunk holes or a step. Parts become separate bodies in
// the 3MF file so Bambu Studio can print them in different colours (AMS).

import {
  union, difference, intersection, offset, fillHoles, regionBounds, regionArea, emptyBounds, addRingBounds,
  circleRing, ellipseRing, roundedRectRing, crossingsAtY, crossingsAtX, thinParts, transformRegion,
} from './geometry.js';
import { layoutBlock } from './layout.js';
import { isSymbolLike } from './fonts.js';

export const PART_NAMES = { base: 'Platte', text: 'Schrift', border: 'Rand', outline: 'Kontur' };
export const RELIEF_NAMES = { raised: 'erhaben', engraved: 'vertieft', flush: 'bündig', cut: 'durchbrochen' };
// PLA, for the weight estimate.
export const DENSITY = 1.24;
// Thinnest floor left under engraved text.
export const MIN_FLOOR = 0.4;
// Plate material kept between engraved letters and the plate edge.
export const MIN_WALL = 0.8;
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

/** Base plate for the lettering (without mount holes). */
function basePlate(doc, text, box, warnings) {
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
    case 'circle': {
      if (fixed) return union([circleRing(0, 0, b.width / 2)]);
      const r = (text.length ? farthestDistance(text, cx, cy) : Math.hypot(w, h) / 2) + p;
      return union([circleRing(cx, cy, r)]);
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

/** Magnet pockets on the back, spread along the long axis of the plate. */
function magnetPockets(doc, base, mount, warnings) {
  const mg = doc.magnets;
  if (!mg.enabled || !base.length) return { pockets: [], centers: [] };
  const r = mg.diameter / 2;
  let allowed = offset(base, -(r + MAGNET_WALL));
  const keepOut = [
    ...mount.holes.map((h) => circleRing(h.cx, h.cy, (h.R || h.r) + r + MAGNET_WALL)),
    ...mount.slots.map((s) => offset([s], r + MAGNET_WALL)).flat(),
  ];
  if (keepOut.length) allowed = difference(allowed, keepOut);
  if (!allowed.length) {
    warnings.push('Die Magnete passen nicht in die Platte – kleiner wählen oder die Platte vergrößern.');
    return { pockets: [], centers: [] };
  }
  // Largest free piece, along its longer axis through the middle.
  const piece = allowed.reduce((a, s) => (regionArea([s]) > regionArea([a]) ? s : a));
  const bb = regionBounds([piece]);
  const horizontal = bb.maxX - bb.minX >= bb.maxY - bb.minY;
  const mid = horizontal ? (bb.minY + bb.maxY) / 2 : (bb.minX + bb.maxX) / 2;
  const cross = horizontal ? crossingsAtY([piece], mid) : crossingsAtX([piece], mid);
  let a = cross[0];
  let b = cross[1];
  for (let i = 0; i + 1 < cross.length; i += 2) {
    if (cross[i + 1] - cross[i] > b - a) {
      a = cross[i];
      b = cross[i + 1];
    }
  }
  let n = mg.count;
  const pitch = 2 * r + MAGNET_WALL;
  const fit = Math.floor((b - a) / pitch) + 1;
  if (n > fit) {
    warnings.push(`Nur ${fit} Magnet${fit === 1 ? '' : 'e'} passen nebeneinander in die Platte.`);
    n = fit;
  }
  const centers = [];
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1);
    centers.push(horizontal ? { cx: s, cy: mid, r } : { cx: mid, cy: s, r });
  }
  return { pockets: union(centers.map((c) => circleRing(c.cx, c.cy, r))), centers };
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
    for (const ch of lay.missing) missing.add(ch);
    const plain = [...lay.missing].filter((ch) => !isSymbolLike(ch));
    if (plain.length) warnings.push(`In „${block.font.family}“ fehlen die Zeichen ${plain.join(' ')}.`);
    layouts.push({ block, ...lay, region });
    text = text.length ? union(text, region) : region;
  }
  const symbols = [...missing].filter(isSymbolLike);
  if (symbols.length) {
    warnings.push(symbolsLoading
      ? `Symbole ${symbols.join(' ')} werden geladen …`
      : `Für ${symbols.join(' ')} gibt es keinen Umriss – ${symbols.length === 1 ? 'das Symbol fehlt' : 'die Symbole fehlen'} im Modell.`);
  }

  const { body } = doc;
  const box = boxOf(text);
  const room = mountRoom(doc);
  if (room) {
    if (room.side === 'left' || room.side === 'both') box.minX -= room.e;
    if (room.side === 'right' || room.side === 'both') box.maxX += room.e;
    if (room.side === 'top') box.maxY += room.e;
  }
  const plate0 = basePlate(doc, text, box, warnings);
  const mount = addMount(doc, plate0, warnings);
  let base = mount.base;
  if (base.length > 1) warnings.push(`Die Platte zerfällt in ${base.length} Teile.`);
  const magnets = magnetPockets(doc, base, mount, warnings);

  const t = body.thickness;
  const relief = base.length ? body.relief : 'raised';
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
  if (body.border && base.length) {
    inner = offset(mount.solidBase, -body.borderWidth);
    border = difference(mount.solidBase, inner);
  }
  // Where lettering may go (pockets keep a wall to every edge and hole).
  let area = base;
  if (base.length) {
    const plate = border.length ? inner : base;
    if (relief === 'flush') area = offset(plate, border.length ? -0.6 : -MIN_WALL);
    else if (relief === 'engraved') area = border.length ? inner : offset(base, -MIN_WALL);
    else area = plate;
    const keepOut = mount.countersinks.map((c) => circleRing(c.cx, c.cy, c.R + (sunk ? MIN_WALL : 0.4)));
    if (keepOut.length) area = difference(area, keepOut);
  }

  // Lettering per text block; where texts overlap, the later one wins.
  const blocks = [];
  let above = [];
  for (let i = layouts.length - 1; i >= 0; i--) {
    let r = base.length ? intersection(layouts[i].region, area) : layouts[i].region;
    if (above.length && r.length) r = difference(r, above);
    above = above.length ? union(above, layouts[i].region) : layouts[i].region;
    blocks.unshift({ block: layouts[i].block, region: r });
  }
  let letters = union(...blocks.map((b) => b.region));
  if (base.length && regionArea(text) - regionArea(letters) > 0.05) warnings.push('Die Schrift ragt über die Platte hinaus und wird abgeschnitten.');

  // Outline around the lettering (third colour).
  const useOutline = body.outline && base.length > 0 && relief !== 'engraved' && relief !== 'cut';
  let outline = useOutline && letters.length ? intersection(offset(letters, body.outlineWidth), area) : [];

  // Text colour groups by AMS filament.
  const groups = [];
  for (const b of blocks) {
    const slot = b.block.slot || doc.slots.text;
    let g = groups.find((x) => x.slot === slot);
    if (!g) {
      const own = slot !== doc.slots.text;
      g = {
        slot,
        id: own ? `text-${slot}` : 'text',
        // Named after the first text with this filament (Bambu Studio's object list).
        name: own ? `Text ${doc.texts.indexOf(b.block) + 1}` : PART_NAMES.text,
        color: own && b.block.color ? b.block.color : doc.colors.text,
        regions: [],
      };
      groups.push(g);
    }
    g.regions.push(b.region);
  }
  groups.sort((a, b) => (a.id === 'text' ? -1 : b.id === 'text' ? 1 : 0));
  for (const g of groups) g.region = union(...g.regions);

  // Stamps: everything mirrored.
  let holes = mount.holes;
  let slots = mount.slots;
  let countersinks = mount.countersinks;
  let magnetCenters = magnets.centers;
  let solidBase = mount.solidBase;
  let magnetPocketRegion = magnets.pockets;
  if (doc.mirror) {
    const M = [-1, 0, 0, 1, 0, 0];
    const flip = (r) => transformRegion(r, M);
    base = flip(base);
    solidBase = flip(solidBase);
    inner = flip(inner);
    letters = flip(letters);
    border = flip(border);
    outline = flip(outline);
    magnetPocketRegion = flip(magnetPocketRegion);
    for (const g of groups) g.region = flip(g.region);
    slots = slots.map((s) => transformRegion([{ outer: s, holes: [] }], M)[0].outer);
    holes = holes.map((h) => ({ ...h, cx: -h.cx }));
    countersinks = countersinks.map((c) => ({ ...c, cx: -c.cx }));
    magnetCenters = magnetCenters.map((c) => ({ ...c, cx: -c.cx }));
  }

  // Parts.
  const parts = [];
  const add = (id, name, color, slot, solids) => {
    const ok = solids.filter((s) => s.region.length && s.z1 > s.z0 + 1e-9);
    if (ok.length) parts.push({ id, name, color, slot, solids: ok });
  };
  const textParts = (z0, z1) => groups.forEach((g) => add(g.id, g.name, g.color, g.slot, [{ region: g.region, z0, z1 }]));
  // Magnet pockets never reach the text pockets: at least MIN_CEILING stays.
  const magnetRoom = t - (sunk ? depth : 0) - MIN_CEILING;
  let magnetDepth = doc.magnets.depth;
  if (magnetCenters.length && magnetDepth > magnetRoom + 1e-9) {
    const need = doc.magnets.depth + MIN_CEILING + (sunk ? depth : 0);
    const fmt = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
    if (magnetRoom < 0.4) {
      warnings.push(`Für Magnet-Taschen ist die Platte zu dünn – mindestens ${fmt(need)} mm nötig.`);
      magnetCenters = [];
      magnetPocketRegion = [];
    } else {
      warnings.push(`Die Magnet-Taschen sind nur ${fmt(magnetRoom)} mm tief (statt ${fmt(doc.magnets.depth)} mm), damit ${fmt(MIN_CEILING)} mm Material darüber bleiben – für volle Tiefe die Platte auf ${fmt(need)} mm erhöhen.`);
      magnetDepth = magnetRoom;
    }
  }
  const plateSolid = {
    region: solidBase, z0: 0, z1: t, countersinks, bottomPockets: magnetPocketRegion, bottomDepth: magnetDepth,
  };
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
  } else if (relief === 'cut') {
    add('base', PART_NAMES.base, doc.colors.base, doc.slots.base, [{ ...plateSolid, region: difference(solidBase, letters) }]);
  }

  // Checks.
  const thin = relief === 'cut' || !doc.check.minStroke ? [] : thinParts(letters, doc.check.minStroke);
  if (!base.length && letters.length > 1) warnings.push(`Die Buchstaben bestehen aus ${letters.length} getrennten Teilen (z. B. i-Punkte) – ohne Platte fallen sie auseinander.`);

  const all = union(base, letters, border, outline);
  const bounds = all.length ? regionBounds(all) : emptyBounds();
  const bed = doc.check.bed;
  if (Number.isFinite(bounds.minX) && Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) > bed - 4) {
    warnings.push(`Größer als das Druckbett (${bed} × ${bed} mm).`);
  }
  let volume = 0;
  for (const part of parts) {
    part.volume = part.solids.reduce((v, s) => v + solidVolume(s), 0);
    volume += part.volume;
  }
  const top = parts.reduce((z, part) => Math.max(z, ...part.solids.map((s) => s.z1)), 0);
  const textBox = letters.length ? regionBounds(letters) : null;
  return {
    doc,
    layouts,
    text: letters,
    textGroups: groups,
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
    warnings,
    pending,
    missing,
    // A flat top can be printed upside down (lettering on the textured plate).
    flippable: parts.length > 0 && (relief === 'flush' || relief === 'cut' || !base.length),
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

/** Volume of a solid (see mesh.js addSolid). */
export function solidVolume(s) {
  let v = regionArea(s.region) * (s.z1 - s.z0);
  if (s.step) v -= (regionArea(s.region) - regionArea(s.step.region)) * (s.z1 - s.step.z);
  if (s.pockets) v -= regionArea(s.pockets) * s.depth;
  if (s.bottomPockets) v -= regionArea(s.bottomPockets) * s.bottomDepth;
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
