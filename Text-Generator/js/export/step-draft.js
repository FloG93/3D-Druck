// Sloped flanks of a stamp as exact faces (the mesh keeps its fine steps):
// the letters grow by `grow` from the stamp face (z1) down to the plate
// (z0). The flank of
//   a line          → a sloping plane
//   a curve         → a ruled surface between the curve and its offset (a
//                     B-spline within 0.4 µm), straight lines down the slope
//   an outer corner → a piece of a cone standing on the corner
//   an inner corner → none: the flanks of both sides meet along the line
//                     (a curve, next to a curve) where they cut each other.
//                     The cut may run on across smooth joints; a short
//                     piece of outline it passes ends in a point above the
//                     foot, its flank a triangle.
// Letters whose feet grow together stay bodies of their own that overlap at
// the foot. Where growing changes a letter otherwise – a counter that
// closes, a curve tighter than the growth – it keeps its fine steps: the
// outline at the foot built here has to match the one Clipper grows to
// within 0.03 mm.

import { real, str } from '../../../shared/js/step.js';
import { containsPoint, ringArea, offset } from '../core/geometry.js';
import { fitRing, reverseSegments } from '../core/curves.js';
import { canonical, insidePoint, segPoint, segD1, segD2, hermiteBreakpoints, hermiteSpline } from './brep.js';

// Largest distance of a B-spline from the curve it stands for (mm).
const TOL = 4e-7;
// Largest distance between the foot outline built here and Clipper's (mm).
const MATCH = 0.03;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const unit = (a) => mul(a, 1 / Math.hypot(a[0], a[1]));

/** Outward normal of a segment (the material lies on its left). */
function normal(seg, s) {
  const t = unit(segD1(seg, s));
  return [t[1], -t[0]];
}

/** Derivative of the normal by the parameter (curvature × speed × tangent). */
function normalD1(seg, s) {
  const a = segD1(seg, s);
  const l2 = dot(a, a);
  return mul(a, cross(a, segD2(seg, s)) / (l2 * Math.sqrt(l2)));
}

/** The segment grown by d: point and derivative. */
const off = (seg, s, d) => add(segPoint(seg, s), mul(normal(seg, s), d));
const offD1 = (seg, s, d) => add(segD1(seg, s), mul(normalD1(seg, s), d));

/**
 * Newton's method for two unknowns: F(u, v) → [value, ∂F/∂u, ∂F/∂v]; the
 * solution near (u, v), or null.
 */
function newton(F, u0, v0) {
  let u = u0;
  let v = v0;
  for (let i = 0; i < 50; i++) {
    const [f, fu, fv] = F(u, v);
    if (Math.hypot(f[0], f[1]) < 1e-11) return [u, v];
    const det = cross(fu, fv);
    if (!(Math.abs(det) > 1e-15)) return null;
    u -= cross(f, fv) / det;
    v -= cross(fu, f) / det;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  }
  return null;
}

/** Where the offsets by d of a (parameter s) and b (parameter t) meet. */
const meet = (a, b, d, s, t) => newton((u, v) => [sub(off(a, u, d), off(b, v, d)), offD1(a, u, d), mul(offD1(b, v, d), -1)], s, t);

/** Where a's offset meets b's offset at the end of b: [s, d]. */
const meetEnd = (a, b, s, d) => newton((u, e) => [sub(off(a, u, e), off(b, 1, e)), offD1(a, u, e), sub(normal(a, u), normal(b, 1))], s, d);

/** Where b's offset meets a's offset at the start of a: [t, d]. */
const meetStart = (a, b, t, d) => newton((u, e) => [sub(off(a, 0, e), off(b, u, e)), mul(offD1(b, u, e), -1), sub(normal(a, 0), normal(b, u))], t, d);

/**
 * An inner corner (before segment i): where the flanks of both sides cut
 * each other, from the corner down to the foot, in pieces – one for each
 * pair of segments (L, R) that meet. When the cut runs off the end of a
 * segment across a smooth joint, that segment ends there (vanish) and the
 * line of the joint is cut at that depth. Pieces: { L, R, path: [[d, s,
 * t], …], start: joint it came across (null at the corner), end: joint it
 * runs across (null at the foot) }.
 */
function walkCorner(segs, kinds, i, g, state) {
  const n = segs.length;
  let L = (i + n - 1) % n;
  let R = i;
  let d = 0;
  let s = 1;
  let t = 0;
  let from = null;
  let path = [[0, 1, 0]];
  const pieces = [];
  const step = g / 16;
  let h = step;
  for (let guard = 0; guard < 4000 && d < g; guard++) {
    const next = Math.min(g, d + h);
    const r = meet(segs[L], segs[R], next, s, t);
    if (r && r[0] >= 0 && r[0] <= 1 && r[1] >= 0 && r[1] <= 1) {
      path.push([next, r[0], r[1]]);
      [s, t] = r;
      d = next;
      h = step;
      continue;
    }
    // A segment runs out between d and next: where exactly?
    let ev = null;
    if (r && r[1] > 1) {
      const e = meetEnd(segs[L], segs[R], s, (d + next) / 2);
      if (e && e[1] > d && e[1] <= next && e[0] >= 0 && e[0] <= 1) ev = { side: 'R', u: e[0], d: e[1] };
    }
    if (r && r[0] < 0) {
      const e = meetStart(segs[L], segs[R], t, (d + next) / 2);
      if (e && e[1] > d && e[1] <= next && e[0] >= 0 && e[0] <= 1 && (!ev || e[1] < ev.d)) ev = { side: 'L', u: e[0], d: e[1] };
    }
    if (!ev) {
      if (h > step / 256) {
        h /= 2;
        continue;
      }
      return null;
    }
    const J = ev.side === 'R' ? (R + 1) % n : L;
    const gone = ev.side === 'R' ? R : L;
    if (kinds[J] !== 'smooth' || state.vanish[gone] !== null || state.cut[J] < g) return null;
    path.push(ev.side === 'R' ? [ev.d, ev.u, 1] : [ev.d, 0, ev.u]);
    pieces.push({ L, R, path, start: from, end: J });
    state.vanish[gone] = ev.d;
    state.cut[J] = ev.d;
    if (ev.side === 'R') {
      R = J;
      [s, t] = [ev.u, 0];
    } else {
      L = (L + n - 1) % n;
      [s, t] = [1, ev.u];
    }
    if (L === R) return null;
    d = ev.d;
    from = J;
    path = [[d, s, t]];
    h = step;
  }
  if (d < g) return null;
  pieces.push({ L, R, path, start: from, end: null });
  return pieces;
}

/**
 * How the flanks of a ring grow: the kind of every joint (before segment
 * i: smooth, convex – a cone – or concave – a cut), the cuts, and for every
 * segment its boundaries down the slope (start and end: joint lines, cones
 * or pieces of cuts, each over a range of depths), how deep it reaches and
 * the part of it at the foot. { why } when growing by g changes the ring
 * otherwise.
 */
function planRing(segs, g) {
  const n = segs.length;
  const kinds = [];
  for (let i = 0; i < n; i++) {
    const ta = unit(segD1(segs[(i + n - 1) % n], 1));
    const tb = unit(segD1(segs[i], 0));
    const turn = cross(ta, tb);
    if (Math.abs(turn) < 1e-9) {
      if (dot(ta, tb) < 0) return { why: 'Spitze' };
      kinds.push('smooth');
    } else kinds.push(turn > 0 ? 'convex' : 'concave');
  }
  const state = { cut: Array(n).fill(g), vanish: Array(n).fill(null) };
  const pieces = [];
  for (let i = 0; i < n; i++) {
    if (kinds[i] !== 'concave') continue;
    const walked = walkCorner(segs, kinds, i, g, state);
    if (!walked) return { why: 'Innenecke ohne Schnitt' };
    for (const p of walked) pieces.push({ ...p, corner: i });
  }
  const bounds = [];
  for (let j = 0; j < n; j++) {
    const bottom = state.vanish[j] ?? g;
    // The boundary of one side, from the top down to the bottom.
    const side = (joint, own) => {
      const list = [];
      if (kinds[joint] === 'smooth') list.push({ kind: 'joint', d0: 0, d1: state.cut[joint] });
      else if (kinds[joint] === 'convex') list.push({ kind: 'cone', d0: 0, d1: g });
      for (const p of pieces) if (own(p)) list.push({ kind: 'cut', piece: p, d0: p.path[0][0], d1: p.path[p.path.length - 1][0] });
      list.sort((x, y) => x.d0 - y.d0);
      if (!list.length || list[0].d0 !== 0 || list[list.length - 1].d1 !== bottom) return null;
      for (let k = 1; k < list.length; k++) if (list[k].d0 !== list[k - 1].d1) return null;
      return list;
    };
    const start = side(j, (p) => p.R === j);
    const end = side((j + 1) % n, (p) => p.L === j);
    if (!start || !end) return { why: 'Innenecke ohne Schnitt' };
    let foot = null;
    if (state.vanish[j] === null) {
      const a = start[start.length - 1];
      const b = end[end.length - 1];
      foot = [a.kind === 'cut' ? a.piece.path[a.piece.path.length - 1][2] : 0, b.kind === 'cut' ? b.piece.path[b.piece.path.length - 1][1] : 1];
      if (!(foot[1] - foot[0] > 1e-6)) return { why: 'ein Stück verschwindet' };
    }
    bounds.push({ start, end, bottom, foot });
  }
  // A curve bending away from the material more tightly than it grows
  // would fold.
  for (let j = 0; j < n; j++) {
    const seg = segs[j];
    if (seg.type === 'line') continue;
    for (let k = 0; k <= 32; k++) {
      const s = k / 32;
      const a = segD1(seg, s);
      const l = Math.hypot(a[0], a[1]);
      if (!(l > 1e-9) || 1 + (bounds[j].bottom * cross(a, segD2(seg, s))) / (l * l * l) < 0.05) return { why: 'Kurve enger als die Schräge' };
    }
  }
  return { kinds, cut: state.cut, pieces, bounds };
}

/** The foot outline of a planned ring as a polygon (for the comparison). */
function footPolygon(segs, plan, g) {
  const out = [];
  const n = segs.length;
  segs.forEach((seg, j) => {
    const { foot } = plan.bounds[j];
    if (!foot) return;
    const steps = seg.type === 'line' ? 1 : 48;
    for (let k = 0; k < steps; k++) out.push(...off(seg, foot[0] + ((foot[1] - foot[0]) * k) / steps, g));
    if (plan.kinds[(j + 1) % n] === 'convex') {
      const P = segPoint(seg, 1);
      const na = normal(seg, 1);
      const nb = normal(segs[(j + 1) % n], 0);
      const a0 = Math.atan2(na[1], na[0]);
      let sweep = Math.atan2(nb[1], nb[0]) - a0;
      while (sweep <= 0) sweep += 2 * Math.PI;
      const m = Math.max(1, Math.ceil(sweep / (Math.PI / 36)));
      for (let k = 0; k < m; k++) out.push(P[0] + g * Math.cos(a0 + (sweep * k) / m), P[1] + g * Math.sin(a0 + (sweep * k) / m));
    }
  });
  return out;
}

/** Largest distance from the points of ring a to ring b. */
function farthest(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i += 2) {
    let best = Infinity;
    for (let j = 0; j < b.length; j += 2) {
      const k = (j + 2) % b.length;
      const ex = b[k] - b[j];
      const ey = b[k + 1] - b[j + 1];
      const l2 = ex * ex + ey * ey;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((a[i] - b[j]) * ex + (a[i + 1] - b[j + 1]) * ey) / l2)) : 0;
      best = Math.min(best, Math.hypot(a[i] - b[j] - u * ex, a[i + 1] - b[j + 1] - u * ey));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

function perimeter(r) {
  let l = 0;
  for (let i = 0; i < r.length; i += 2) l += Math.hypot(r[(i + 2) % r.length] - r[i], r[(i + 3) % r.length] - r[i + 1]);
  return l;
}

/** The same outline: area and distance both ways. */
const matches = (poly, ring) => poly.length >= 6 && Math.abs(ringArea(poly) - ringArea(ring)) < 0.02 * perimeter(ring)
  && farthest(poly, ring) < MATCH && farthest(ring, poly) < MATCH;

/** The cubic restricted to [a, b]: its Bézier points (blossoms). */
function subBezier(p, a, b) {
  const blossom = (t1, t2, t3) => {
    let q = p;
    for (const t of [t1, t2, t3]) q = q.slice(1).map((c, i) => [(1 - t) * q[i][0] + t * c[0], (1 - t) * q[i][1] + t * c[1]]);
    return q[0];
  };
  return [blossom(a, a, a), blossom(a, a, b), blossom(a, b, b), blossom(b, b, b)];
}

/** The cubic itself as a B-spline with the knots bps (double inner knots). */
function bezierSpline(seg, bps, z) {
  const points = [];
  for (let i = 0; i + 1 < bps.length; i++) {
    const q = subBezier(seg.p, bps[i], bps[i + 1]);
    if (i === 0) points.push(q[0]);
    points.push(q[1], q[2]);
    if (i + 2 === bps.length) points.push(q[3]);
  }
  return points.map(([x, y]) => [x, y, z]);
}

/** The segment grown by d, at height z. */
const grown = (seg, d, z) => ({ f: (s) => [...off(seg, s, d), z], df: (s) => [...offD1(seg, s, d), 0] });

/**
 * One piece of the cut of an inner corner, from its deep end (τ = 0) up to
 * its shallow end (τ = 1); z(d): height at a depth (linear).
 */
function cutCurve(segs, piece, z) {
  const a = segs[piece.L];
  const b = segs[piece.R];
  const { path } = piece;
  const top = path[0][0];
  const deep = path[path.length - 1][0];
  const solve = (d) => {
    let k = 0;
    for (let i = 1; i < path.length; i++) if (Math.abs(path[i][0] - d) < Math.abs(path[k][0] - d)) k = i;
    return meet(a, b, d, path[k][1], path[k][2]) || [path[k][1], path[k][2]];
  };
  const depth = (tau) => deep - (deep - top) * tau;
  const k = top - deep; // dd/dτ
  const dz = z(1) - z(0); // dz/dd
  return {
    f: (tau) => {
      const d = depth(tau);
      return [...off(a, solve(d)[0], d), z(d)];
    },
    df: (tau) => {
      const d = depth(tau);
      const [s, t] = solve(d);
      const Ja = offD1(a, s, d);
      const Jb = mul(offD1(b, t, d), -1);
      const ds = cross(mul(sub(normal(a, s), normal(b, t)), -1), Jb) / cross(Ja, Jb);
      const dX = add(mul(Ja, ds), normal(a, s));
      return [dX[0] * k, dX[1] * k, dz * k];
    },
  };
}

/** The rings of the top shape, planned (or why growing changes them). */
function planShape(shape, g) {
  const rings = [shape.outer, ...shape.holes].map((r, k) => {
    const segs = fitRing(canonical(r).ring);
    return k === 0 ? segs : reverseSegments(segs);
  });
  const plans = [];
  for (const segs of rings) {
    if (segs.length < 2) return { why: 'zu kleiner Umriss' };
    const plan = planRing(segs, g);
    if (plan.why) return plan;
    plans.push(plan);
  }
  return { rings, plans };
}

/** Does the foot built from the plan match Clipper's foot? */
function footMatches(planned, foot, g) {
  const polys = planned.rings.map((segs, k) => footPolygon(segs, planned.plans[k], g));
  if (!matches(polys[0], foot.outer)) return false;
  // Every counter matched to one of the foot's holes.
  const free = [...foot.holes];
  for (const poly of polys.slice(1)) {
    const i = free.findIndex((h) => matches(poly, h));
    if (i < 0) return false;
    free.splice(i, 1);
  }
  return free.length === 0;
}

/**
 * The plan for one letter, its foot as Clipper grows it: { planned } when
 * its flanks can be exact, else { why }.
 */
export function planLetter(shape, foot, g) {
  if (foot.length !== 1) return { why: 'der Fuß zerfällt' };
  if (shape.holes.length !== foot[0].holes.length) return { why: 'eine Öffnung wächst zu' };
  const planned = planShape(shape, g);
  if (planned.why) return planned;
  if (!footMatches(planned, foot[0], g)) return { why: 'der Fuß weicht vom Umriss ab' };
  return { planned };
}

/**
 * The letters of one piece of the foot with exact flanks, or null to keep
 * the steps. Letters whose feet grow together each become a body of their
 * own; the bodies overlap at the foot.
 */
export function draftedBodies(w, s, piece, name) {
  const { region: top, grow: g } = s.draft;
  const tops = top.filter((shape) => containsPoint([piece], ...insidePoint(shape)));
  if (!tops.length) return null;
  const plans = tops.map((shape) => planLetter(shape, tops.length === 1 ? [piece] : offset([shape], g), g));
  if (plans.some((p) => !p.planned)) return null;
  return plans.map((p) => writeBody(w, p.planned, s.z0, s.z1, g, name));
}

/** Edge of a fitted segment at height z (a line or the Bézier itself). */
function segEdge(w, seg, v0, v1, z) {
  const [p, q] = [seg.p[0], seg.p[seg.p.length - 1]];
  const curve = seg.type === 'line' ? w.line([p[0], p[1], z], [q[0], q[1], z]) : w.bspline(seg.p.map(([x, y]) => [x, y, z]), [4, 4], [0, 1]);
  return w.edge(v0, v1, curve);
}

function writeBody(w, { rings, plans }, z0, z1, g, name) {
  const z = (d) => z1 - ((z1 - z0) * d) / g;
  const faces = [];
  const topLoops = [];
  const footLoops = [];
  rings.forEach((segs, r) => {
    const { kinds, cut, pieces, bounds } = plans[r];
    const n = segs.length;
    const vertex = (p, d) => w.vertex(p[0], p[1], z(d));
    const topV = segs.map((seg) => vertex(seg.p[0], 0));
    const topE = segs.map((seg, i) => segEdge(w, seg, topV[i], topV[(i + 1) % n], z1));
    // Joints: the line down the slope of a smooth joint (to the foot, or to
    // where a cut runs across it), the cone of a convex one.
    const lowV = [];
    const jointE = [];
    const cones = [];
    for (let i = 0; i < n; i++) {
      const P = segs[i].p[0];
      if (kinds[i] === 'smooth') {
        const q = off(segs[i], 0, cut[i]);
        lowV[i] = vertex(q, cut[i]);
        jointE[i] = w.edge(lowV[i], topV[i], w.line([q[0], q[1], z(cut[i])], [P[0], P[1], z1]));
      } else if (kinds[i] === 'convex') {
        // A cone around the corner, its tip at the stamp face.
        const qa = off(segs[(i + n - 1) % n], 1, g);
        const qb = off(segs[i], 0, g);
        const va = vertex(qa, g);
        const vb = vertex(qb, g);
        const ea = w.edge(va, topV[i], w.line([qa[0], qa[1], z0], [P[0], P[1], z1]));
        const eb = w.edge(vb, topV[i], w.line([qb[0], qb[1], z0], [P[0], P[1], z1]));
        const arc = w.edge(va, vb, w.add(`CIRCLE('',${w.axis(P[0], P[1], z0, [0, 0, 1], [1, 0, 0])},${real(g)})`));
        const cone = w.add(`CONICAL_SURFACE('',${w.axis(P[0], P[1], z0, [0, 0, -1], [1, 0, 0])},${real(g)},${real(Math.atan2(g, z1 - z0))})`);
        faces.push(w.face(w.loop([w.oe(arc, true), w.oe(eb, true), w.oe(ea, false)]), [], cone, true));
        cones[i] = { va, vb, ea, eb, arc };
      }
    }
    // Cuts of inner corners, each piece from its deep end up to its top
    // (the corner, or the joint the piece before it ran across).
    for (const p of pieces) {
      const [d1, s1, t1] = p.path[p.path.length - 1];
      const [d0, s0] = p.path[0];
      p.top = p.start === null ? topV[p.corner] : lowV[p.start];
      p.low = p.end !== null ? lowV[p.end] : vertex(off(segs[p.R], t1, d1), d1);
      let curve;
      if (segs[p.L].type === 'line' && segs[p.R].type === 'line') {
        // Two sloping planes cut each other in a straight line.
        const lo = off(segs[p.L], s1, d1);
        const hi = off(segs[p.L], s0, d0);
        curve = w.line([lo[0], lo[1], z(d1)], [hi[0], hi[1], z(d0)]);
      } else {
        const c = cutCurve(segs, p, z);
        const sp = hermiteSpline(c, hermiteBreakpoints([c], 0, 1, TOL));
        curve = w.bspline(sp.points, sp.mults, sp.knots);
      }
      p.edge = w.edge(p.low, p.top, curve);
    }
    const edgeOf = (b, atStart, j) => {
      if (b.kind === 'joint') return jointE[atStart ? j : (j + 1) % n];
      if (b.kind === 'cone') return atStart ? cones[j].eb : cones[(j + 1) % n].ea;
      return b.piece.edge;
    };
    const lowOf = (b, atStart, j) => {
      if (b.kind === 'joint') return lowV[atStart ? j : (j + 1) % n];
      if (b.kind === 'cone') return atStart ? cones[j].vb : cones[(j + 1) % n].va;
      return b.piece.low;
    };
    // The foot of every segment that gets there.
    const footE = segs.map((seg, j) => {
      const { foot, start, end } = bounds[j];
      if (!foot) return null;
      let curve;
      if (seg.type === 'line') curve = w.line([...off(seg, foot[0], g), z0], [...off(seg, foot[1], g), z0]);
      else {
        const c = grown(seg, g, z0);
        const sp = hermiteSpline(c, hermiteBreakpoints([c], foot[0], foot[1], TOL));
        curve = w.bspline(sp.points, sp.mults, sp.knots);
      }
      return w.edge(lowOf(start[start.length - 1], true, j), lowOf(end[end.length - 1], false, j), curve);
    });
    // The flank of every segment: its foot (if it gets there), up its end,
    // back along the top, down its start.
    segs.forEach((seg, j) => {
      const b = bounds[j];
      let surface;
      if (seg.type === 'line') {
        const [p, q] = seg.p;
        const t = unit(sub(q, p));
        const l = Math.hypot(z1 - z0, g);
        surface = w.add(`PLANE('',${w.axis(p[0], p[1], z1, [((z1 - z0) * t[1]) / l, (-(z1 - z0) * t[0]) / l, g / l], [t[0], t[1], 0])})`);
      } else {
        // Ruled between the grown curve (as deep as the segment reaches)
        // and the curve on top.
        const c = grown(seg, b.bottom, z(b.bottom));
        const bps = hermiteBreakpoints([c], 0, 1, TOL);
        const low = hermiteSpline(c, bps);
        surface = w.ruled(low.points, bezierSpline(seg, bps, z1), low.mults, low.knots);
      }
      const oes = [];
      if (footE[j]) oes.push(w.oe(footE[j], true));
      for (const e of [...b.end].reverse()) oes.push(w.oe(edgeOf(e, false, j), true));
      oes.push(w.oe(topE[j], false));
      for (const e of b.start) oes.push(w.oe(edgeOf(e, true, j), false));
      faces.push(w.face(w.loop(oes), [], surface, true));
    });
    topLoops.push(w.loop(topE.map((e) => w.oe(e, true))));
    // The foot in the direction of the ring (segments and arcs), turned
    // round for the face looking down.
    const foot = [];
    for (let j = 0; j < n; j++) {
      if (footE[j]) foot.push(footE[j]);
      if (kinds[(j + 1) % n] === 'convex') foot.push(cones[(j + 1) % n].arc);
    }
    footLoops.push(w.loop(foot.reverse().map((e) => w.oe(e, false))));
  });
  faces.push(w.face(topLoops[0], topLoops.slice(1), w.plane(z1, true), true));
  faces.push(w.face(footLoops[0], footLoops.slice(1), w.plane(z0, false), true));
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(name)},${shell})`);
}
