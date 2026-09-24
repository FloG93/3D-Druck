// Hole shapes.
//
// Every hole is a convex shape. Its outline is described exactly with lines,
// circular arcs, circles or ellipses (all counter-clockwise), which is what the
// CAD exporters need. In addition every hole carries a "core": a convex point
// set that, offset by `core.r`, gives the hole. For a slot the core is a
// segment, for a rounded rectangle an inner rectangle, for a circle its centre.
// Distances between holes are therefore exact and cheap to compute.

import { TAU, EPS, clamp } from './math.js';

export const SHAPE_TYPES = ['rect', 'ellipse', 'polygon'];

/** Rotational symmetry period of a hole shape (radians). */
export function shapePeriod(shape) {
  const square = Math.abs(shape.width - shape.height) < 1e-9;
  if (shape.type === 'ellipse') return square ? TAU : Math.PI;
  if (shape.type === 'rect') return square ? Math.PI / 2 : Math.PI;
  const n = polygonSides(shape.sides);
  if (square) return TAU / n;
  return n % 2 === 0 ? Math.PI : TAU;
}

export const polygonSides = (s) => clamp(Math.round(s || 6), 3, 64);

/** Upper bound of the distance from the hole centre to its outline. */
export function circumradius(type, w, h) {
  if (type === 'ellipse' || type === 'polygon') return Math.max(w, h) / 2;
  return Math.hypot(w, h) / 2;
}

function polygonVertices(type, sides, x, y, rot, w, h) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const local = [];
  if (type === 'rect') {
    local.push([-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]);
  } else {
    const n = polygonSides(sides);
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + (TAU * k) / n;
      local.push([(w / 2) * Math.cos(a), (h / 2) * Math.sin(a)]);
    }
  }
  return local.map(([lx, ly]) => [x + lx * c - ly * s, y + lx * s + ly * c]);
}

/** Largest fillet radius that fits into every corner of a convex CCW polygon. */
export function maxFilletRadius(P) {
  const n = P.length;
  const cot = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = cornerAngle(P, i);
    cot[i] = 1 / Math.tan(a / 2);
  }
  let rmax = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]);
    rmax = Math.min(rmax, len / (cot[i] + cot[j]));
  }
  return rmax;
}

function cornerAngle(P, i) {
  const n = P.length;
  const p = P[i];
  const q = P[(i + n - 1) % n];
  const s = P[(i + 1) % n];
  const u1x = q[0] - p[0];
  const u1y = q[1] - p[1];
  const u2x = s[0] - p[0];
  const u2y = s[1] - p[1];
  const cosA = (u1x * u2x + u1y * u2y) / (Math.hypot(u1x, u1y) * Math.hypot(u2x, u2y));
  return Math.acos(clamp(cosA, -1, 1));
}

export function lineSeg(x0, y0, x1, y1) {
  return { type: 'line', x0, y0, x1, y1 };
}

/** CCW arc around (cx, cy) from start point S to end point E. */
export function arcSeg(cx, cy, r, x0, y0, x1, y1) {
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let sweep = Math.atan2(y1 - cy, x1 - cx) - a0;
  while (sweep <= 1e-12) sweep += TAU;
  while (sweep > TAU) sweep -= TAU;
  return { type: 'arc', cx, cy, r, a0, sweep, x0, y0, x1, y1 };
}

/**
 * Rounds the corners of a convex CCW polygon with radius r.
 * Returns the outline and the fillet centres (the "core" polygon).
 */
export function filletPolygon(P, r) {
  const n = P.length;
  if (r <= EPS) {
    const segs = [];
    for (let i = 0; i < n; i++) {
      const a = P[i];
      const b = P[(i + 1) % n];
      segs.push(lineSeg(a[0], a[1], b[0], b[1]));
    }
    return { outline: { kind: 'path', segs }, centers: P.map((p) => [p[0], p[1]]) };
  }
  const T1 = [];
  const T2 = [];
  const C = [];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const q = P[(i + n - 1) % n];
    const s = P[(i + 1) % n];
    let u1x = q[0] - p[0];
    let u1y = q[1] - p[1];
    const l1 = Math.hypot(u1x, u1y);
    u1x /= l1;
    u1y /= l1;
    let u2x = s[0] - p[0];
    let u2y = s[1] - p[1];
    const l2 = Math.hypot(u2x, u2y);
    u2x /= l2;
    u2y /= l2;
    const A = Math.acos(clamp(u1x * u2x + u1y * u2y, -1, 1));
    const t = r / Math.tan(A / 2);
    let bx = u1x + u2x;
    let by = u1y + u2y;
    const bl = Math.hypot(bx, by);
    bx /= bl;
    by /= bl;
    const dc = r / Math.sin(A / 2);
    T1.push([p[0] + u1x * t, p[1] + u1y * t]);
    T2.push([p[0] + u2x * t, p[1] + u2y * t]);
    C.push([p[0] + bx * dc, p[1] + by * dc]);
  }
  let segs = [];
  for (let i = 0; i < n; i++) {
    segs.push(arcSeg(C[i][0], C[i][1], r, T1[i][0], T1[i][1], T2[i][0], T2[i][1]));
    const a = T2[i];
    const b = T1[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) segs.push(lineSeg(a[0], a[1], b[0], b[1]));
  }
  segs = mergeArcs(segs);
  if (segs.length === 1 && segs[0].type === 'arc' && segs[0].sweep > TAU - 1e-6) {
    const s = segs[0];
    return { outline: { kind: 'circle', cx: s.cx, cy: s.cy, r: s.r }, centers: [[s.cx, s.cy]] };
  }
  return { outline: { kind: 'path', segs: startWithArc(segs) }, centers: C };
}

/** Merges consecutive arcs that share centre and radius (cyclic). */
function mergeArcs(segs) {
  let changed = true;
  while (changed && segs.length > 1) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      const j = (i + 1) % segs.length;
      const a = segs[i];
      const b = segs[j];
      if (i === j || a.type !== 'arc' || b.type !== 'arc') continue;
      if (Math.abs(a.cx - b.cx) > 1e-7 || Math.abs(a.cy - b.cy) > 1e-7 || Math.abs(a.r - b.r) > 1e-7) continue;
      const merged = { ...a, sweep: a.sweep + b.sweep, x1: b.x1, y1: b.y1 };
      if (j === 0) {
        // b is the first element: keep the merged arc at the front.
        segs = [merged, ...segs.slice(1, i)];
      } else {
        segs = [...segs.slice(0, i), merged, ...segs.slice(j + 1)];
      }
      changed = true;
      break;
    }
  }
  return segs;
}

/**
 * Canonical order: start with an arc that follows a straight line, so the
 * last segment is a line. The Fusion 360 script relies on this to close
 * sketch loops through shared sketch points.
 */
function startWithArc(segs) {
  const n = segs.length;
  if (!segs.some((s) => s.type === 'line') || !segs.some((s) => s.type === 'arc')) return segs;
  for (let k = 0; k < n; k++) {
    if (segs[k].type === 'arc' && segs[(k + n - 1) % n].type === 'line') {
      return k === 0 ? segs : [...segs.slice(k), ...segs.slice(0, k)];
    }
  }
  return segs;
}

/**
 * Builds a hole of the given shape at (x, y), rotated by rot (radians),
 * with overall size w x h (mm). Returns null for degenerate sizes.
 */
export function buildHole(shape, x, y, rot, w, h) {
  if (!(w > 1e-6) || !(h > 1e-6)) return null;
  const type = shape.type;
  let outline;
  let core;
  if (type === 'ellipse') {
    if (Math.abs(w - h) < 1e-9) {
      outline = { kind: 'circle', cx: x, cy: y, r: w / 2 };
      core = { pts: [x, y], r: w / 2 };
    } else {
      let rx = w / 2;
      let ry = h / 2;
      let a = rot;
      if (ry > rx) {
        [rx, ry] = [ry, rx];
        a += Math.PI / 2;
      }
      a %= Math.PI;
      if (a < 0) a += Math.PI;
      outline = { kind: 'ellipse', cx: x, cy: y, rx, ry, rot: a };
      core = { pts: flatten(polygonize(outline, 0.01)), r: 0 };
    }
  } else {
    const P = polygonVertices(type, shape.sides, x, y, rot, w, h);
    const rmax = maxFilletRadius(P);
    const r = clamp(shape.round || 0, 0, 1) * rmax;
    const res = filletPolygon(P, r >= rmax - 1e-9 ? rmax : r);
    outline = res.outline;
    core = outline.kind === 'circle'
      ? { pts: [outline.cx, outline.cy], r: outline.r }
      : { pts: flatten(res.centers), r: r <= EPS ? 0 : r };
  }
  return {
    x,
    y,
    rot,
    w,
    h,
    R: circumradius(type, w, h),
    outline,
    core,
    area: outlineArea(outline),
  };
}

function flatten(points) {
  const out = new Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[2 * i] = points[i][0];
    out[2 * i + 1] = points[i][1];
  }
  return out;
}

/** Translates an outline by (dx, dy), returning a new outline. */
export function translateOutline(o, dx, dy) {
  if (!dx && !dy) return o;
  if (o.kind === 'circle' || o.kind === 'ellipse') return { ...o, cx: o.cx + dx, cy: o.cy + dy };
  return {
    kind: 'path',
    segs: o.segs.map((s) => (s.type === 'line'
      ? { ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy }
      : { ...s, cx: s.cx + dx, cy: s.cy + dy, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy })),
  };
}

/** Copy of a hole moved by dx along x (the other side of a cylinder seam). */
export function shiftHole(hole, dx) {
  const pts = hole.core.pts.slice();
  for (let i = 0; i < pts.length; i += 2) pts[i] += dx;
  return { ...hole, x: hole.x + dx, outline: translateOutline(hole.outline, dx, 0), core: { pts, r: hole.core.r } };
}

/** Signed area of an outline (positive for CCW outlines). */
export function outlineArea(o) {
  if (o.kind === 'circle') return Math.PI * o.r * o.r;
  if (o.kind === 'ellipse') return Math.PI * o.rx * o.ry;
  let a = 0;
  for (const s of o.segs) {
    if (s.type === 'line') {
      a += s.x0 * s.y1 - s.x1 * s.y0;
    } else {
      const a1 = s.a0 + s.sweep;
      a += s.r * s.r * s.sweep
        + s.r * (s.cx * (Math.sin(a1) - Math.sin(s.a0)) - s.cy * (Math.cos(a1) - Math.cos(s.a0)));
    }
  }
  return a / 2;
}

/** Number of chords needed to approximate an arc within tolerance tol. */
export function arcSteps(r, sweep, tol, min = 1) {
  if (r <= 0) return min;
  const da = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 2;
  return clamp(Math.ceil(Math.abs(sweep) / Math.max(da, 1e-3)), min, 1024);
}

/** Point on an ellipse outline for parameter t. */
export function ellipsePoint(o, t) {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const lx = o.rx * Math.cos(t);
  const ly = o.ry * Math.sin(t);
  return [o.cx + lx * c - ly * s, o.cy + lx * s + ly * c];
}

/**
 * Approximates an outline by a CCW polygon whose vertices lie on the exact
 * outline. Returns an array of [x, y].
 */
export function polygonize(o, tol = 0.05) {
  const pts = [];
  if (o.kind === 'circle') {
    const n = arcSteps(o.r, TAU, tol, 12);
    for (let k = 0; k < n; k++) {
      const a = (TAU * k) / n;
      pts.push([o.cx + o.r * Math.cos(a), o.cy + o.r * Math.sin(a)]);
    }
    return pts;
  }
  if (o.kind === 'ellipse') {
    // Uniform parameter steps: the chord error is largest at the ends of the
    // major axis and behaves like a circle of radius rx there.
    const n = arcSteps(o.rx, TAU, tol, 16);
    for (let k = 0; k < n; k++) pts.push(ellipsePoint(o, (TAU * k) / n));
    return pts;
  }
  for (const s of o.segs) {
    if (s.type === 'line') {
      pts.push([s.x0, s.y0]);
    } else {
      const n = arcSteps(s.r, s.sweep, tol, 2);
      pts.push([s.x0, s.y0]);
      for (let k = 1; k < n; k++) {
        const a = s.a0 + (s.sweep * k) / n;
        pts.push([s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)]);
      }
    }
  }
  return pts;
}

/** Axis-aligned bounds of an outline: [minX, minY, maxX, maxY]. */
export function outlineBounds(o) {
  if (o.kind === 'circle') return [o.cx - o.r, o.cy - o.r, o.cx + o.r, o.cy + o.r];
  if (o.kind === 'ellipse') {
    const c = Math.cos(o.rot);
    const s = Math.sin(o.rot);
    const hx = Math.hypot(o.rx * c, o.ry * s);
    const hy = Math.hypot(o.rx * s, o.ry * c);
    return [o.cx - hx, o.cy - hy, o.cx + hx, o.cy + hy];
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const s of o.segs) {
    add(s.x0, s.y0);
    add(s.x1, s.y1);
    if (s.type === 'arc') {
      // Include the axis extremes that lie inside the sweep.
      for (let q = Math.ceil(s.a0 / (Math.PI / 2)); q * (Math.PI / 2) < s.a0 + s.sweep; q++) {
        const a = q * (Math.PI / 2);
        add(s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a));
      }
    }
  }
  return [minX, minY, maxX, maxY];
}
