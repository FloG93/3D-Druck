// Stencils: the plate with the lettering cut out. Islands – pieces of plate
// that would fall out, like the inside of O, A, B, e, 8 – are held by
// bridges across the letter strokes.

import {
  union, difference, intersection, offset, regionArea, regionBounds, containsPoint, crossingsAtX, crossingsAtY,
} from './geometry.js';

// Lines tried across an island: the middle first (the classic stencil
// look), then further out.
const STEPS = [0, 1, -1, 2, -2, 3, -3];
// Being off-centre costs a little; horizontal bridges have to be clearly
// shorter to win with direction 'auto'.
const OFF_CENTRE = 0.05;
const AUTO_BIAS = 1.1;
// Cost of a side that could not be bridged (count 2).
const MISSING = 1000;

/**
 * Bridges from island i along the line at c (vertical: x = c, else y = c)
 * to the nearest other piece on either side. Sampled at c and c ± w/2 so a
 * bridge reaches material over its whole width.
 * Returns { 1: { seg, to, gap }, [-1]: … } (either may be null; seg =
 * [from, to] along the line, to = the piece it reaches, gap = a point in
 * the cut it crosses) or null.
 */
function reach(pieces, boxes, i, c, w, vertical) {
  const cross = vertical ? crossingsAtX : crossingsAtY;
  const up = { ok: true, near: -Infinity, far: -Infinity, to: -1, gap: null };
  const down = { ok: true, near: Infinity, far: Infinity, to: -1, gap: null };
  const at = (t, v) => (vertical ? [t, v] : [v, t]);
  let hits = 0;
  for (const t of [c, c - w / 2, c + w / 2]) {
    const own = cross([pieces[i]], t);
    if (own.length < 2) continue;
    hits++;
    const t0 = own[0];
    const t1 = own[own.length - 1];
    let hi = Infinity;
    let hiTo = -1;
    let lo = -Infinity;
    let loTo = -1;
    for (let j = 0; j < pieces.length; j++) {
      const b = boxes[j];
      if (j === i || (vertical ? t < b.minX || t > b.maxX : t < b.minY || t > b.maxY)) continue;
      for (const v of cross([pieces[j]], t)) {
        if (v > t1 + 1e-6 && v < hi) {
          hi = v;
          hiTo = j;
        }
        if (v < t0 - 1e-6 && v > lo) {
          lo = v;
          loTo = j;
        }
      }
    }
    if (hiTo < 0) up.ok = false;
    else {
      up.near = Math.max(up.near, t1);
      up.far = Math.max(up.far, hi);
      if (up.to < 0) {
        up.to = hiTo;
        up.gap = at(t, (t1 + hi) / 2);
      }
    }
    if (loTo < 0) down.ok = false;
    else {
      down.near = Math.min(down.near, t0);
      down.far = Math.min(down.far, lo);
      if (down.to < 0) {
        down.to = loTo;
        down.gap = at(t, (lo + t0) / 2);
      }
    }
  }
  if (!hits) return null;
  return {
    1: up.ok && up.to >= 0 ? { seg: [up.near, up.far], to: up.to, gap: up.gap } : null,
    [-1]: down.ok && down.to >= 0 ? { seg: [down.far, down.near], to: down.to, gap: down.gap } : null,
  };
}

/** Candidate bridges of island i: [{ i, to, side, vertical, c, seg, gap, cost }]. */
function candidates(pieces, boxes, i, w, vertical, bias = 1) {
  const b = boxes[i];
  const [a0, a1] = vertical ? [b.minX, b.maxX] : [b.minY, b.maxY];
  const mid = (a0 + a1) / 2;
  const out = [];
  for (const k of STEPS) {
    const c = mid + (k * (a1 - a0)) / 8;
    const r = reach(pieces, boxes, i, c, w, vertical);
    if (!r) continue;
    for (const side of [1, -1]) {
      if (!r[side]) continue;
      const { seg, to, gap } = r[side];
      out.push({ i, to, side, vertical, c, seg, gap, cost: (seg[1] - seg[0] + Math.abs(c - mid) * OFF_CENTRE) * bias });
    }
  }
  return out;
}

const orientations = (direction) => (direction === 'horizontal' ? [false] : direction === 'vertical' ? [true] : [true, false]);

/** Candidates in the chosen direction – the other one if there are none. */
function islandCandidates(pieces, boxes, i, w, direction) {
  let out = [];
  for (const vertical of orientations(direction)) {
    out.push(...candidates(pieces, boxes, i, w, vertical, direction === 'auto' && !vertical ? AUTO_BIAS : 1));
  }
  if (!out.length && direction !== 'auto') out = candidates(pieces, boxes, i, w, direction !== 'vertical');
  return out;
}

/**
 * One bridge per island, as few and as short as possible: a minimum
 * spanning tree over the pieces, all frames counting as one.
 */
function treeBridges(pieces, boxes, islands, frames, { width, direction }) {
  const edges = islands.flatMap((i) => islandCandidates(pieces, boxes, i, width, direction));
  edges.sort((a, b) => a.cost - b.cost);
  const parent = pieces.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const [first, ...rest] = frames;
  for (const f of rest) parent[find(f)] = find(first);
  const chosen = [];
  for (const e of edges) {
    const a = find(e.i);
    const b = find(e.to);
    if (a === b) continue;
    parent[a] = b;
    chosen.push(e);
  }
  return chosen;
}

/**
 * Two bridges per island on opposite sides (above and below, or left and
 * right), preferably on one line through it. A bridge between two islands
 * counts for both, so a B gets three bridges, not four.
 */
function pairBridges(pieces, boxes, islands, frames, { width, direction }) {
  const held = pieces.map(() => new Set());
  const key = (vertical, side) => `${vertical ? 'v' : 'h'}${side}`;
  const chosen = [];
  const plan = (i, list, vertical) => {
    const need = [1, -1].filter((s) => !held[i].has(key(vertical, s)));
    if (!need.length) return { cost: 0, take: [] };
    const own = list.filter((e) => e.vertical === vertical && need.includes(e.side));
    let best = null;
    if (need.length === 1) {
      for (const e of own) if (!best || e.cost < best.cost) best = { cost: e.cost, take: [e] };
      return best;
    }
    // Both sides missing: the best line through the island.
    for (const c of new Set(own.map((e) => e.c))) {
      const take = need.map((s) => own.find((e) => e.c === c && e.side === s)).filter(Boolean);
      const cost = take.reduce((sum, e) => sum + e.cost, 0) + (need.length - take.length) * MISSING;
      if (!best || cost < best.cost) best = { cost, take };
    }
    return best;
  };
  for (const i of islands) {
    const list = islandCandidates(pieces, boxes, i, width, direction);
    let best = null;
    for (const vertical of [true, false]) {
      const p = plan(i, list, vertical);
      if (p && (!best || p.cost < best.cost)) best = p;
    }
    if (!best) continue;
    for (const e of best.take) {
      chosen.push(e);
      held[e.i].add(key(e.vertical, e.side));
      if (!frames.includes(e.to)) held[e.to].add(key(e.vertical, -e.side));
    }
  }
  return chosen;
}

function bridgeRect({ c, seg: [a, b], vertical }, w) {
  // Reaching w/2 into the material on both ends.
  const lo = a - w / 2;
  const hi = b + w / 2;
  return vertical
    ? [c - w / 2, lo, c + w / 2, lo, c + w / 2, hi, c - w / 2, hi]
    : [lo, c - w / 2, hi, c - w / 2, hi, c + w / 2, lo, c + w / 2];
}

// How far a bridge reaches into the material it holds on to: exactly to
// the edge would leave slivers of cut (rounding) that still separate.
const GRIP = 0.02;

/**
 * The bridges as a region: each only across the gap it spans, so none
 * reaches past thin material into the cut beyond.
 */
function bridgeRegion(chosen, cut, w) {
  const out = [];
  for (const e of chosen) {
    const [x, y] = e.gap;
    const part = cut.find((s) => containsPoint([s], x, y));
    const rect = bridgeRect(e, w);
    if (!part) {
      out.push(rect);
      continue;
    }
    const pieces = intersection([rect], [part]);
    const own = pieces.filter((s) => containsPoint([s], x, y));
    out.push(own.length ? intersection([rect], offset(own, GRIP, { join: 'miter' })) : pieces);
  }
  return union(...out);
}

/**
 * The frames: in each part of the plate its largest piece. Everything else
 * is an island that has to be held.
 */
function findFrames(plate, pieces) {
  const area = pieces.map((s) => regionArea([s]));
  const best = new Map();
  for (let i = 0; i < pieces.length; i++) {
    const part = plate.length > 1 ? plate.findIndex((p) => regionArea(intersection([pieces[i]], [p])) > 1e-6) : 0;
    if (!best.has(part) || area[i] > area[best.get(part)]) best.set(part, i);
  }
  return [...best.values()];
}

/**
 * Adds bridges so that every part of the stencil (plate minus cut) stays in
 * one piece.
 * opts: { width, count (1 or 2 per island), direction }
 * Returns { cut, bridges, islands (count), loose (the islands as a region),
 * unresolved }.
 */
export function bridgeIslands(plate, cut, { width = 1.2, count = 2, direction = 'vertical' } = {}) {
  let bridges = [];
  let current = cut;
  let islands = 0;
  let loose = [];
  let pieces = difference(plate, current);
  // Bridges between islands can leave groups of them unconnected: another
  // round joins those with single bridges.
  for (let pass = 0; pass < 4 && pieces.length > plate.length; pass++) {
    const frames = findFrames(plate, pieces);
    const held = pieces.map((_, i) => i).filter((i) => !frames.includes(i));
    if (pass === 0) {
      islands = held.length;
      loose = held.map((i) => pieces[i]);
    }
    const boxes = pieces.map((s) => regionBounds([s]));
    // Top to bottom, then left to right.
    held.sort((a, b) => boxes[b].maxY - boxes[a].maxY || boxes[a].minX - boxes[b].minX);
    const opts = { width, direction };
    const chosen = count >= 2 && pass === 0
      ? pairBridges(pieces, boxes, held, frames, opts)
      : treeBridges(pieces, boxes, held, frames, opts);
    if (!chosen.length) break;
    bridges = union(bridges, bridgeRegion(chosen, current, width));
    current = difference(cut, bridges);
    pieces = difference(plate, current);
  }
  return { cut: current, bridges, islands, loose, unresolved: Math.max(0, pieces.length - plate.length) };
}
