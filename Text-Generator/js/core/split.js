// Stencils bigger than the print bed: cut into pieces along straight seams,
// held together by dovetail puzzle connectors. Seams avoid the lettering
// where they can, connectors sit in solid material, and the pieces keep a
// small clearance so they slide together.

import {
  union, difference, intersection, offset, fillHoles, regionArea, regionBounds, transformRegion,
  crossingsAtX, crossingsAtY, clipRegion, insideRegion, pointInRing,
} from './geometry.js';

// Free space around a piece on the bed (mm).
export const BED_MARGIN = 3;
// Seams keep this far from letters where they can (mm) – else the edges get thin.
const NEAR = 2;
// Material crumbs smaller than this are dropped (mm²).
const CRUMB = 1;
// A band must hold together this far from its seams – a hair-thin link
// right at the seam would be cut by the clearance (mm).
const KEEP = 0.6;
// Smallest connector tried when the set size does not fit (mm).
const MIN_TAB = 5;

/** Proportions of a dovetail with the given head width (mm). */
export function tabSize(head) {
  return { head, neck: 0.6 * head, depth: 0.7 * head, wall: Math.max(1.5, 0.15 * head), round: 0.15 * head };
}

/**
 * Dovetail in the seam frame: u across the seam into the neighbouring
 * piece, v along the seam; it reaches 1 mm back into its own piece.
 */
function tabRegion(size) {
  const { head, neck, depth, round } = size;
  const ring = [-1, -neck / 2, depth, -head / 2, depth, head / 2, -1, neck / 2];
  return offset(offset([ring], -round), round);
}

/** Seam frame → world: vertical seam x = s, position t along it, dir ±1. */
const seamMatrix = (vertical, s, t, dir) => (vertical ? [dir, 0, 0, 1, s, t] : [0, dir, 1, 0, t, s]);

/** Cells needed along one side: the edge cells get connectors on one side, the others on both. */
function cellCount(size, usable, depth) {
  if (size <= usable) return 1;
  for (let n = 2; n < 40; n++) if (size / n + (n > 2 ? 2 : 1) * depth <= usable) return n;
  return 40;
}

/** Intervals [a, b] of the line (vertical: x = c) inside the region. */
function intervals(region, c, vertical) {
  const xs = (vertical ? crossingsAtX : crossingsAtY)(region, c);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

const totalLength = (list) => {
  const sorted = [...list].sort((p, q) => p[0] - q[0]);
  let len = 0;
  let end = -Infinity;
  for (const [a, b] of sorted) {
    if (b <= end) continue;
    len += b - Math.max(a, end);
    end = b;
  }
  return len;
};

/**
 * How bad a seam along the line is: length through letters and holes, a
 * third of the length close to them (thin edges), and much more if it cuts
 * through an island (the inside of an O, held by bridges only).
 */
function seamCost(open, islands, c, vertical) {
  const through = totalLength(intervals(open, c, vertical));
  const near = [];
  for (const d of [-NEAR, -NEAR / 2, 0, NEAR / 2, NEAR]) {
    for (const [a, b] of intervals(open, c + d, vertical)) near.push([a - NEAR, b + NEAR]);
  }
  const crossesIsland = islands.length && intervals(islands, c, vertical).length > 0;
  return through + 0.3 * (totalLength(near) - through) + (crossesIsland ? 50 : 0);
}

/** Shapes of a region without crumbs. */
const solid = (region) => region.filter((s) => regionArea([s]) >= CRUMB);

/**
 * Where the piece number goes in the preview: inside the material with
 * some room around it, as near the middle of the piece as possible.
 */
function anchorOf(region) {
  const b = regionBounds(region);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rings = region.flatMap((sh) => [sh.outer, ...sh.holes]).map((r) => ({ r, b: regionBounds([{ outer: r, holes: [] }]) }));
  // Distance to the nearest edge (rings further away than the best so far are skipped).
  const room = (x, y, enough) => {
    let d2 = enough * enough;
    for (const { r, b: rb } of rings) {
      const dx = Math.max(rb.minX - x, 0, x - rb.maxX);
      const dy = Math.max(rb.minY - y, 0, y - rb.maxY);
      if (dx * dx + dy * dy >= d2) continue;
      for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
        const ax = r[j];
        const ay = r[j + 1];
        const ex = r[i] - ax;
        const ey = r[i + 1] - ay;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0;
        const qx = ax + t * ex - x;
        const qy = ay + t * ey - y;
        d2 = Math.min(d2, qx * qx + qy * qy);
      }
    }
    return Math.sqrt(d2);
  };
  let best = [cx, cy];
  let bestScore = -Infinity;
  const N = 12;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / N;
      const y = b.minY + ((b.maxY - b.minY) * j) / N;
      if (!insideRegion(region, x, y)) continue;
      const score = room(x, y, 8) - 0.03 * Math.hypot(x - cx, y - cy);
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  }
  return best;
}

/**
 * Seam positions along one axis: near the ideal, even spacing, but where
 * the seam crosses little lettering and every band stays in one piece.
 * connected(prev, c, last) tells whether the bands next to a seam at c do.
 */
function placeSeams(n, lo, hi, room, cost, connected) {
  const seams = [];
  const span = hi - lo;
  for (let i = 1; i < n; i++) {
    const ideal = lo + (i * span) / n;
    // Every seam may move by half the spare room, so no piece gets too big.
    const reach = Math.max(0, Math.min(room / 2, span / (4 * n)));
    const cands = [];
    for (let c = ideal - reach; c <= ideal + reach + 1e-9; c += 0.5) cands.push({ c, cost: cost(c) + 0.02 * Math.abs(c - ideal) });
    cands.sort((p, q) => p.cost - q.cost);
    const prev = seams.length ? seams[seams.length - 1] : -Infinity;
    const last = i === n - 1;
    let pick = null;
    for (const cand of cands.slice(0, 24)) {
      if (connected(prev, cand.c, last)) {
        pick = cand.c;
        break;
      }
    }
    seams.push(pick ?? cands[0].c);
  }
  return seams;
}

/**
 * Connectors along a seam segment (vertical seam x = s, from v0 to v1), in
 * solid material with a wall all around. Long segments want two or more;
 * smaller connectors (down to MIN_TAB) are used when that gives more of
 * them. openEnds: which ends of the segment are other seams (keep clear of
 * their connectors).
 */
function placeTabs(plate, vertical, s, v0, v1, head, openEnds) {
  const want = v1 - v0 < 40 ? 1 : Math.max(2, Math.ceil((v1 - v0) / 70));
  let best = { size: null, tabs: [] };
  for (let h = head; h >= MIN_TAB - 1e-9; h *= 0.8) {
    const got = tabsOfSize(plate, vertical, s, v0, v1, tabSize(h), openEnds, want);
    if (got.tabs.length > best.tabs.length) best = got;
    if (best.tabs.length >= want) break;
  }
  return best;
}

function tabsOfSize(plate, vertical, s, v0, v1, size, openEnds, want) {
  const none = { size, tabs: [] };
  const reach = size.depth + size.wall + 1;
  const lo = v0 + size.head / 2 + (openEnds[0] ? size.depth + size.wall : 0);
  const hi = v1 - size.head / 2 - (openEnds[1] ? size.depth + size.wall : 0);
  if (hi < lo) return none;
  const strip = vertical
    ? clipRegion(plate, s - reach, v0, s + reach, v1)
    : clipRegion(plate, v0, s - reach, v1, s + reach);
  // Where a connector may lie: the material less the wall.
  const room = offset(strip, -size.wall);
  if (!room.length) return none;
  const shape = tabRegion(size);
  const place = (t, dir) => transformRegion(shape, seamMatrix(vertical, s, t, dir));
  const fits = (region) => {
    const ring = region[0].outer;
    for (let i = 0; i < ring.length; i += 2) if (!insideRegion(room, ring[i], ring[i + 1])) return false;
    // Nothing of the lettering pokes into the connector.
    const b = regionBounds(region);
    for (const sh of room) {
      for (const r of [sh.outer, ...sh.holes]) {
        for (let i = 0; i < r.length; i += 2) {
          const x = r[i];
          const y = r[i + 1];
          if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && pointInRing(ring, x, y)) return false;
        }
      }
    }
    return true;
  };
  // Runs of positions (1 mm apart) where a connector fits either way round.
  const runs = [];
  let run = null;
  for (let t = lo; t <= hi + 1e-9; t += 1) {
    const dirs = [1, -1].filter((dir) => fits(place(t, dir)));
    if (dirs.length) {
      if (!run) runs.push(run = []);
      run.push({ t, dirs });
    } else run = null;
  }
  if (!runs.length) return none;
  // One connector per run, spread along the seam.
  const mid = (r) => r[Math.floor(r.length / 2)].t;
  let chosen = runs;
  if (runs.length > want) {
    chosen = [];
    for (let k = 0; k < want; k++) {
      const target = lo + ((k + 0.5) * (hi - lo)) / want;
      const next = runs.filter((r) => !chosen.includes(r)).sort((p, q) => Math.abs(mid(p) - target) - Math.abs(mid(q) - target))[0];
      if (next) chosen.push(next);
    }
    chosen.sort((p, q) => mid(p) - mid(q));
  }
  // In the middle of its run; the direction alternates where both fit.
  const tabs = chosen.map((r, k) => {
    const { t, dirs } = r[Math.floor(r.length / 2)];
    const dir = dirs.includes(k % 2 ? -1 : 1) ? (k % 2 ? -1 : 1) : dirs[0];
    return { t, dir, region: place(t, dir) };
  });
  return { size, tabs };
}

/**
 * Splits the stencil plate (one region) into pieces that fit the bed.
 * opts: { bed, clearance, tab (head width), islands (better not cut
 * through), avoid (seams and connectors keep off, e.g. countersinks) }
 * Returns null if it fits as it is, else
 * { nx, ny, xs, ys, pieces: [{ label, cell, region, bounds, anchor }], tabs,
 * tabHead, warnings }.
 */
export function splitStencil(full, { bed, clearance = 0.2, tab = 10, islands = [], avoid = [] } = {}) {
  if (!full.length) return null;
  // Seams, connectors and the checks see the plate without what to avoid.
  const plate = avoid.length ? difference(full, avoid) : full;
  const b = regionBounds(full);
  const usable = bed - 2 * BED_MARGIN;
  const depth = tabSize(tab).depth;
  const nx = cellCount(b.maxX - b.minX, usable, depth);
  const ny = cellCount(b.maxY - b.minY, usable, depth);
  if (nx * ny === 1) return null;
  const ctx = { full, plate, b, usable, depth, clearance, tab, islands, open: difference(fillHoles(plate), plate) };
  // With little room to move the seams, one more piece may hold together
  // where the least number does not.
  const tries = [[nx, ny], [nx + 1, ny], [nx, ny + 1], [nx + 1, ny + 1], [nx + 2, ny]];
  let first = null;
  let fallback = null;
  for (const [cx, cy] of tries) {
    const r = attempt(ctx, cx, cy);
    first ??= r;
    if (r.sound && !r.missing) return r.result;
    if (r.sound) fallback ??= r;
  }
  return (fallback || first).result;
}

/** One split into nx × ny cells: { result, sound (no loose bits, all fit), missing (connectors) }. */
function attempt({ full, plate, b, usable, depth, clearance, tab, islands, open }, nx, ny) {
  const W = b.maxX - b.minX;
  const H = b.maxY - b.minY;
  const warnings = [];
  const room = (size, n) => usable - (n > 2 ? 2 : 1) * depth - size / n;
  const band = (x0, y0, x1, y1) => solid(clipRegion(plate, x0, y0, x1, y1)).length <= 1;
  const E = 1;
  // Band edges: KEEP inside at seams, beyond the plate at its edges.
  const lower = (v, edge) => (v === -Infinity ? edge - E : v + KEEP);
  const xs = placeSeams(nx, b.minX, b.maxX, room(W, nx), (c) => seamCost(open, islands, c, true),
    (prev, c, last) => band(lower(prev, b.minX), b.minY - E, c - KEEP, b.maxY + E) && (!last || band(c + KEEP, b.minY - E, b.maxX + E, b.maxY + E)));
  const colEdges = [b.minX - E, ...xs, b.maxX + E];
  const colLo = (i) => (i ? colEdges[i] + KEEP : colEdges[i]);
  const colHi = (i) => (i < nx - 1 ? colEdges[i + 1] - KEEP : colEdges[i + 1]);
  const ys = placeSeams(ny, b.minY, b.maxY, room(H, ny), (c) => seamCost(open, islands, c, false),
    (prev, c, last) => xs.concat([0]).every((_, i) => band(colLo(i), lower(prev, b.minY), colHi(i), c - KEEP)
      && (!last || band(colLo(i), c + KEEP, colHi(i), b.maxY + E))));
  const rowEdges = [b.minY - E, ...ys, b.maxY + E];

  // Connectors on every seam segment between two cells.
  const tabs = [];
  const cellId = (i, j) => j * nx + i;
  const missing = [];
  xs.forEach((s, i) => {
    for (let j = 0; j < ny; j++) {
      const got = placeTabs(plate, true, s, Math.max(rowEdges[j], b.minY), Math.min(rowEdges[j + 1], b.maxY), tab, [j > 0, j < ny - 1]);
      for (const t of got.tabs) tabs.push({ ...t, size: got.size, vertical: true, from: cellId(t.dir > 0 ? i : i + 1, j), to: cellId(t.dir > 0 ? i + 1 : i, j) });
      if (!got.tabs.length) missing.push([cellId(i, j), cellId(i + 1, j)]);
    }
  });
  ys.forEach((s, j) => {
    for (let i = 0; i < nx; i++) {
      const got = placeTabs(plate, false, s, Math.max(colEdges[i], b.minX), Math.min(colEdges[i + 1], b.maxX), tab, [i > 0, i < nx - 1]);
      for (const t of got.tabs) tabs.push({ ...t, size: got.size, vertical: false, from: cellId(i, t.dir > 0 ? j : j + 1), to: cellId(i, t.dir > 0 ? j + 1 : j) });
      if (!got.tabs.length) missing.push([cellId(i, j), cellId(i, j + 1)]);
    }
  });

  // Pieces: cell ± connectors, less half the clearance all around.
  const label = (i, j) => (ny - 1 - j) * nx + i + 1;
  const pieces = [];
  const FAR = 50;
  let sound = true;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const id = cellId(i, j);
      const x0 = i ? xs[i - 1] : b.minX - FAR;
      const x1 = i < nx - 1 ? xs[i] : b.maxX + FAR;
      const y0 = j ? ys[j - 1] : b.minY - FAR;
      const y1 = j < ny - 1 ? ys[j] : b.maxY + FAR;
      let region = union([[x0, y0, x1, y0, x1, y1, x0, y1]], ...tabs.filter((t) => t.from === id).map((t) => t.region));
      const into = tabs.filter((t) => t.to === id).map((t) => t.region);
      if (into.length) region = difference(region, union(...into));
      if (clearance > 0) region = offset(region, -clearance / 2);
      const rb = regionBounds(region);
      const parts = solid(intersection(clipRegion(full, rb.minX, rb.minY, rb.maxX, rb.maxY), region));
      if (!parts.length) continue;
      const n = label(i, j);
      if (parts.length > 1) {
        warnings.push(`Teil ${n} zerfällt in ${parts.length} Stücke – Randabstand oder Schriftgröße ändern.`);
        sound = false;
      }
      const pb = regionBounds(parts);
      if (Math.max(pb.maxX - pb.minX, pb.maxY - pb.minY) > usable + 1e-6) {
        warnings.push(`Teil ${n} ist größer als das Druckbett.`);
        sound = false;
      }
      pieces.push({ label: n, cell: [i, j], region: parts, bounds: pb, anchor: anchorOf(parts) });
    }
  }
  pieces.sort((p, q) => p.label - q.label);
  const labelOf = (id) => label(id % nx, Math.floor(id / nx));
  for (const [a, c] of missing) {
    warnings.push(`Zwischen Teil ${Math.min(labelOf(a), labelOf(c))} und ${Math.max(labelOf(a), labelOf(c))} passt kein Puzzle-Verbinder – mehr Randabstand geben oder die Teile ankleben.`);
  }
  const sizes = tabs.map((t) => t.size.head);
  return {
    sound,
    missing: missing.length,
    result: { nx, ny, xs, ys, pieces, tabs, tabHead: sizes.length ? Math.min(...sizes) : 0, warnings },
  };
}
