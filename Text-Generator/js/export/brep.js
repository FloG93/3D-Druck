// Building blocks of the STEP bodies (step.js for flat parts, step-cup.js
// for the bent wall of a cup): the writer with the curves and surfaces they
// need, outlines in a comparable form, and the slabs a solid is cut into.

import { StepWriter, real } from '../../../shared/js/step.js';
import { union, difference, ringArea } from '../core/geometry.js';

export const EPS = 1e-9;

/** A ring as its points, starting at the lowest-left one, counter-clockwise. */
export function canonical(r) {
  const n = r.length / 2;
  let m = 0;
  for (let i = 1; i < n; i++) {
    if (r[2 * i] < r[2 * m] || (r[2 * i] === r[2 * m] && r[2 * i + 1] < r[2 * m + 1])) m = i;
  }
  const ccw = ringArea(r) > 0;
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = ccw ? (m + k) % n : (m - k + n) % n;
    out.push(r[2 * i], r[2 * i + 1]);
  }
  return { key: out.join(','), ring: out, ccw };
}

/** Slabs of constant cross-section: [{ z0, z1, region }] from bottom to top. */
export function slabsOf(s) {
  const steps = s.steps || (s.step ? [s.step] : []);
  const pockets = s.pockets && s.pockets.length && s.depth > 0 ? s.pockets : null;
  const bottom = (s.bottom || []).filter((b) => b.region.length && b.depth > 0);
  const levels = [s.z0, s.z1, ...steps.map((st) => st.z), ...(pockets ? [s.z1 - s.depth] : []), ...bottom.map((b) => s.z0 + b.depth)];
  const zs = [...new Set(levels.filter((z) => z >= s.z0 - EPS && z <= s.z1 + EPS))].sort((a, b) => a - b)
    .filter((z, i, all) => i === 0 || z - all[i - 1] > 1e-7);
  const slabs = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const zm = (zs[i] + zs[i + 1]) / 2;
    let region = s.region;
    for (const st of steps) if (zm > st.z) region = st.region;
    const cut = [];
    if (pockets && zm > s.z1 - s.depth) cut.push(...pockets);
    for (const b of bottom) if (zm < s.z0 + b.depth) cut.push(...b.region);
    slabs.push({ z0: zs[i], z1: zs[i + 1], region: cut.length ? difference(region, cut) : union(region) });
  }
  return slabs;
}

/** A point just inside a shape (beside the middle of its first edge). */
export function insidePoint(shape) {
  const r = shape.outer;
  const [x0, y0, x1, y1] = [r[0], r[1], r[2], r[3]];
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  const k = ringArea(r) > 0 ? 1e-4 : -1e-4; // to the left of a counter-clockwise ring
  return [(x0 + x1) / 2 - ((y1 - y0) / l) * k, (y0 + y1) / 2 + ((x1 - x0) / l) * k];
}

/**
 * Runs of a ring through the slabs: as long as it bounds the next slab in
 * the same direction, its wall goes on. uses: [{ slab, ccw }] in slab order.
 */
export function ringRuns(uses, slabs) {
  const runs = [];
  let k = 0;
  while (k < uses.length) {
    let e = k;
    while (e + 1 < uses.length && uses[e + 1].slab === uses[e].slab + 1 && uses[e + 1].ccw === uses[k].ccw) e++;
    runs.push({ ccw: uses[k].ccw, z0: slabs[uses[k].slab].z0, z1: slabs[uses[e].slab].z1 });
    k = e + 1;
  }
  return runs;
}

/** Every outline of every slab: canonical key → { ring, uses }. */
export function slabRings(slabs) {
  const rings = new Map();
  slabs.forEach((sl, i) => {
    for (const shape of sl.region) {
      for (const [r, outer] of [[shape.outer, true], ...shape.holes.map((h) => [h, false])]) {
        const c = canonical(r);
        let info = rings.get(c.key);
        if (!info) rings.set(c.key, info = { ring: c.ring, uses: [] });
        info.uses.push({ slab: i, ccw: outer });
      }
    }
  });
  return rings;
}

export class BrepWriter extends StepWriter {
  line(p, q) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const l = Math.hypot(dx, dy, dz);
    return this.add(`LINE('',${this.pt(...p)},${this.add(`VECTOR('',${this.dir(dx / l, dy / l, dz / l)},${real(l)})`)})`);
  }

  /** Point entities: coordinates are written, ids are taken as they are. */
  pts(points) {
    return points.map((c) => (typeof c === 'string' ? c : this.pt(...c)));
  }

  /**
   * Cubic B-spline curve (control points as coordinates or point ids, knot
   * multiplicities, knots).
   */
  bspline(points, mults, knots) {
    const pts = this.pts(points);
    return this.add(`B_SPLINE_CURVE_WITH_KNOTS('',3,(${pts.join(',')}),.UNSPECIFIED.,.F.,.F.,(${mults.join(',')}),(${knots.map(real).join(',')}),.UNSPECIFIED.)`);
  }

  /**
   * Ruled B-spline surface between two cubic B-spline curves with the same
   * knots: cubic along them (u), straight across from the first to the
   * second (v).
   */
  ruled(a, b, mults, knots) {
    const pb = this.pts(b);
    const rows = this.pts(a).map((p, i) => `(${p},${pb[i]})`);
    return this.add(`B_SPLINE_SURFACE_WITH_KNOTS('',3,1,(${rows.join(',')}),.UNSPECIFIED.,.F.,.F.,.F.,(${mults.join(',')}),(2,2),(${knots.map(real).join(',')}),(0.,1.),.UNSPECIFIED.)`);
  }

  /** Circle around the Z axis at height z, starting at the back (+Y). */
  circleZ(z, r) {
    return this.add(`CIRCLE('',${this.axis(0, 0, z, [0, 0, 1], [0, 1, 0])},${real(r)})`);
  }

  edge(v0, v1, curve, sense = true) {
    return this.add(`EDGE_CURVE('',${v0},${v1},${curve},${sense ? '.T.' : '.F.'})`);
  }

  plane(z, up) {
    return this.add(`PLANE('',${this.axis(0, 0, z, [0, 0, up ? 1 : -1], [1, 0, 0])})`);
  }
}

/** Point of a fitted segment (line or cubic, see curves.js) – ends exact. */
export function segPoint(seg, s) {
  const p = seg.p;
  if (s === 0) return p[0];
  if (s === 1) return p[p.length - 1];
  if (seg.type === 'line') return [p[0][0] + (p[1][0] - p[0][0]) * s, p[0][1] + (p[1][1] - p[0][1]) * s];
  const u = 1 - s;
  const b = [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s];
  return [0, 1].map((c) => b[0] * p[0][c] + b[1] * p[1][c] + b[2] * p[2][c] + b[3] * p[3][c]);
}

/** First derivative of a fitted segment by its parameter. */
export function segD1(seg, s) {
  const p = seg.p;
  if (seg.type === 'line') return [p[1][0] - p[0][0], p[1][1] - p[0][1]];
  const u = 1 - s;
  return [0, 1].map((c) => 3 * (u * u * (p[1][c] - p[0][c]) + 2 * u * s * (p[2][c] - p[1][c]) + s * s * (p[3][c] - p[2][c])));
}

/** Second derivative of a fitted segment by its parameter. */
export function segD2(seg, s) {
  const p = seg.p;
  if (seg.type === 'line') return [0, 0];
  return [0, 1].map((c) => 6 * ((1 - s) * (p[2][c] - 2 * p[1][c] + p[0][c]) + s * (p[3][c] - 2 * p[2][c] + p[1][c])));
}

/**
 * Cubic through f(s0) and f(s1) with the tangents there (Hermite): its four
 * Bézier points. f(s) → point, df(s) → derivative by s.
 */
export function hermitePiece({ f, df }, s0, s1) {
  const h = (s1 - s0) / 3;
  const p0 = f(s0);
  const p3 = f(s1);
  const d0 = df(s0);
  const d3 = df(s1);
  return [p0, p0.map((v, i) => v + d0[i] * h), p3.map((v, i) => v - d3[i] * h), p3];
}

function hermiteError(curve, s0, s1) {
  const b = hermitePiece(curve, s0, s1);
  let worst = 0;
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    const c = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    const exact = curve.f(s0 + (s1 - s0) * t);
    worst = Math.max(worst, Math.hypot(...exact.map((v, k) => v - (c[0] * b[0][k] + c[1] * b[1][k] + c[2] * b[2][k] + c[3] * b[3][k]))));
  }
  return worst;
}

/**
 * Parameters on [a, b] where Hermite pieces meet: each piece as long as it
 * can be while it stays within tol of every one of the curves.
 */
export function hermiteBreakpoints(curves, a, b, tol) {
  const ok = (s0, s1) => curves.every((c) => hermiteError(c, s0, s1) <= tol);
  const out = [a];
  let s0 = a;
  while (s0 < b) {
    let s1 = b;
    if (!ok(s0, b)) {
      let lo = s0;
      let hi = b;
      for (let i = 0; i < 30 && hi - lo > 1e-6 * (b - a); i++) {
        const mid = (lo + hi) / 2;
        if (ok(s0, mid)) lo = mid;
        else hi = mid;
      }
      s1 = lo > s0 ? lo : hi;
    }
    out.push(s1);
    s0 = s1;
  }
  return out;
}

/**
 * The Hermite pieces on the breakpoints as one cubic B-spline: double
 * knots, so it is tangent continuous and passes through every joint.
 */
export function hermiteSpline(curve, bps) {
  const points = [];
  for (let i = 0; i + 1 < bps.length; i++) {
    const b = hermitePiece(curve, bps[i], bps[i + 1]);
    if (i === 0) points.push(b[0]);
    points.push(b[1], b[2]);
    if (i + 2 === bps.length) points.push(b[3]);
  }
  return { points, mults: bps.map((_, i) => (i === 0 || i === bps.length - 1 ? 4 : 2)), knots: bps };
}

/**
 * The stored outline (walls, at one height) a face's ring runs along:
 * the same ring – or, where Clipper moved a point of it by a hair while
 * cutting one slab from the next, the ring whose points are all within
 * 1 µm (at least 95 % of them exactly).
 */
export function storedRing(stored, r) {
  const c = canonical(r);
  const hit = stored.get(c.key);
  if (hit) return hit;
  const n = r.length / 2;
  const box = (q) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < q.length; i += 2) {
      b[0] = Math.min(b[0], q[i]);
      b[1] = Math.min(b[1], q[i + 1]);
      b[2] = Math.max(b[2], q[i]);
      b[3] = Math.max(b[3], q[i + 1]);
    }
    return b;
  };
  const rb = box(r);
  for (const [key, entry] of stored) {
    const q = key.split(',').map(Number);
    if (Math.abs(q.length / 2 - n) > Math.max(2, n * 0.05)) continue;
    const qb = box(q);
    if (qb.some((v, i) => Math.abs(v - rb[i]) > 1e-3)) continue;
    const exact = new Set();
    for (let i = 0; i < q.length; i += 2) exact.add(`${q[i]},${q[i + 1]}`);
    let same = 0;
    let near = true;
    for (let i = 0; i < r.length && near; i += 2) {
      if (exact.has(`${r[i]},${r[i + 1]}`)) same++;
      else {
        let best = Infinity;
        for (let j = 0; j < q.length; j += 2) best = Math.min(best, Math.hypot(q[j] - r[i], q[j + 1] - r[i + 1]));
        near = best < 1e-3;
      }
    }
    if (near && same >= 0.95 * n) return entry;
  }
  return undefined;
}

/** A loop of stored edges; forward keeps their direction. */
export function edgeLoop(w, edges, forward) {
  return forward ? w.loop(edges.map((e) => w.oe(e, true))) : w.loop([...edges].reverse().map((e) => w.oe(e, false)));
}
