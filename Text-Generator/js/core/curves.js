// Smooth outlines from polygons: a ring (letters, plate, bridges … after all
// the boolean operations) becomes a closed chain of lines and cubic Bézier
// curves within a small tolerance. Corners stay sharp, smooth joins stay
// smooth (the tangent carries on). For SVG files with real curves and exact
// STEP bodies – Fusion 360 gets a few splines instead of thousands of
// little lines.
//
// Fitting after P. J. Schneider, "An Algorithm for Automatically Fitting
// Digitized Curves", Graphics Gems (1990).

const MAX_EDGE = 0.5; // longer polygon edges get points in between (mm)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};

function bezier(b, t) {
  const s = 1 - t;
  return [
    s * s * s * b[0][0] + 3 * s * s * t * b[1][0] + 3 * s * t * t * b[2][0] + t * t * t * b[3][0],
    s * s * s * b[0][1] + 3 * s * s * t * b[1][1] + 3 * s * t * t * b[2][1] + t * t * t * b[3][1],
  ];
}

function bezierD1(b, t) {
  const s = 1 - t;
  return [
    3 * (s * s * (b[1][0] - b[0][0]) + 2 * s * t * (b[2][0] - b[1][0]) + t * t * (b[3][0] - b[2][0])),
    3 * (s * s * (b[1][1] - b[0][1]) + 2 * s * t * (b[2][1] - b[1][1]) + t * t * (b[3][1] - b[2][1])),
  ];
}

function bezierD2(b, t) {
  const s = 1 - t;
  return [
    6 * (s * (b[2][0] - 2 * b[1][0] + b[0][0]) + t * (b[3][0] - 2 * b[2][0] + b[1][0])),
    6 * (s * (b[2][1] - 2 * b[1][1] + b[0][1]) + t * (b[3][1] - 2 * b[2][1] + b[1][1])),
  ];
}

/** Least-squares cubic through P[first..last] with the given end tangents. */
function generateBezier(P, first, last, u, t1, t2) {
  const p0 = P[first];
  const p3 = P[last];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(P[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let ar = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const seg = len(sub(p3, p0));
  if (al < 1e-6 * seg || ar < 1e-6 * seg) {
    al = seg / 3;
    ar = seg / 3;
  }
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

/**
 * Largest squared distance at the points and halfway along the edges
 * between them (a short curve may bulge between two points).
 */
function maxError(P, first, last, b, u) {
  let max = 0;
  let split = Math.floor((first + last) / 2);
  for (let i = first; i < last; i++) {
    const k = i - first;
    if (i > first) {
      const d = sub(bezier(b, u[k]), P[i]);
      const e = dot(d, d);
      if (e >= max) {
        max = e;
        split = i;
      }
    }
    const d = sub(bezier(b, (u[k] + u[k + 1]) / 2), mul(add(P[i], P[i + 1]), 0.5));
    const e = dot(d, d);
    if (e > max) {
      max = e;
      split = Math.min(last - 1, Math.max(first + 1, i + (u[k + 1] - u[k] > 0 && k + 1 < u.length - 1 ? 1 : 0)));
    }
  }
  return { max, split };
}

function reparameterize(P, first, b, u) {
  return u.map((t, i) => {
    const d = sub(bezier(b, t), P[first + i]);
    const d1 = bezierD1(b, t);
    const d2 = bezierD2(b, t);
    const den = dot(d1, d1) + dot(d, d2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(d, d1) / den));
  });
}

function fitCubic(P, first, last, t1, t2, tol2, out) {
  if (last - first === 1) {
    const d = len(sub(P[last], P[first])) / 3;
    out.push([P[first], add(P[first], mul(t1, d)), add(P[last], mul(t2, d)), P[last]]);
    return;
  }
  // Chord-length parameters.
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(P[i], P[i - 1])));
  const total = u[u.length - 1];
  for (let i = 1; i < u.length; i++) u[i] /= total;
  let b = generateBezier(P, first, last, u, t1, t2);
  let { max, split } = maxError(P, first, last, b, u);
  if (max < tol2) {
    out.push(b);
    return;
  }
  if (max < tol2 * 16) {
    let uu = u;
    for (let k = 0; k < 6; k++) {
      uu = reparameterize(P, first, b, uu);
      b = generateBezier(P, first, last, uu, t1, t2);
      ({ max, split } = maxError(P, first, last, b, uu));
      if (max < tol2) {
        out.push(b);
        return;
      }
    }
  }
  const tc = unit(sub(P[split - 1], P[split + 1]));
  fitCubic(P, first, split, t1, tc, tol2, out);
  fitCubic(P, split, last, mul(tc, -1), t2, tol2, out);
}

/** Is the cubic a straight piece from its start to its end? */
function straight(b, tol) {
  const d = sub(b[3], b[0]);
  const l = len(d);
  if (l < 1e-12) return true;
  const n = [-d[1] / l, d[0] / l];
  for (const c of [b[1], b[2]]) {
    const v = sub(c, b[0]);
    const along = dot(v, d) / l;
    if (Math.abs(dot(v, n)) > tol || along < -tol || along > l + tol) return false;
  }
  return true;
}

/**
 * A closed ring (flat [x0, y0, x1, y1, …], either orientation) as segments
 * { type: 'line', p: [p0, p1] } or { type: 'cubic', p: [p0, c1, c2, p1] },
 * each starting where the last one ended, in the direction of the ring.
 * The ends of the segments are points of the ring (its corners among them).
 */
export function fitRing(ring, { tolerance = 0.01, corner = 30 } = {}) {
  // Points without repeats.
  const pts = [];
  for (let i = 0; i < ring.length; i += 2) {
    const p = [ring[i], ring[i + 1]];
    const q = pts[pts.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) pts.push(p);
  }
  while (pts.length > 1 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) <= 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) <= 1e-9) pts.pop();
  const n = pts.length;
  if (n < 3) return [];
  // Corners: where the outline turns by more than `corner` degrees at once.
  const cosCorner = Math.cos((corner * Math.PI) / 180);
  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = unit(sub(pts[i], pts[(i + n - 1) % n]));
    const b = unit(sub(pts[(i + 1) % n], pts[i]));
    if (dot(a, b) < cosCorner) corners.push(i);
  }
  // Runs from corner to corner; a smooth loop is cut in two at smooth joins.
  const smooth = !corners.length;
  const starts = smooth ? [0, Math.floor(n / 2)] : corners;
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const e = k + 1 < starts.length ? starts[k + 1] : starts[0] + n;
    // The run with extra points on long edges, so the fit follows them.
    const P = [pts[s % n]];
    for (let i = s + 1; i <= e; i++) {
      const a = pts[(i - 1) % n];
      const b = pts[i % n];
      const pieces = Math.ceil(len(sub(b, a)) / MAX_EDGE);
      for (let j = 1; j < pieces; j++) P.push(add(a, mul(sub(b, a), j / pieces)));
      P.push(b);
    }
    const last = P.length - 1;
    const join = (i) => unit(sub(pts[(i + 1) % n], pts[(i + n - 1) % n]));
    const t1 = smooth ? join(s % n) : unit(sub(P[1], P[0]));
    const t2 = smooth ? mul(join(e % n), -1) : unit(sub(P[last - 1], P[last]));
    const cubics = [];
    fitCubic(P, 0, last, t1, t2, tolerance * tolerance, cubics);
    for (const b of cubics) {
      out.push(straight(b, tolerance / 4) ? { type: 'line', p: [b[0], b[3]] } : { type: 'cubic', p: b });
    }
  }
  return mergeLines(out, tolerance / 4);
}

/** Neighbouring lines on one straight line become one. */
function mergeLines(segs, tol) {
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'line' && s.type === 'line' && straight([prev.p[0], prev.p[1], prev.p[1], s.p[1]], tol)) {
      prev.p = [prev.p[0], s.p[1]];
    } else out.push({ type: s.type, p: s.p });
  }
  // Around the start of the ring as well.
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first.type === 'line' && last.type === 'line' && straight([last.p[0], last.p[1], last.p[1], first.p[1]], tol)) {
      out.pop();
      first.p = [last.p[0], first.p[1]];
    }
  }
  return out;
}

/** Reverses segments (a ring the other way round). */
export function reverseSegments(segs) {
  return segs.slice().reverse().map((s) => ({ type: s.type, p: s.p.slice().reverse() }));
}

/** Largest distance of the ring's points from the segments (for tests). */
export function fitError(ring, segs) {
  // Curves as fine polylines (0.05 mm steps: the chords stay far inside).
  const poly = [];
  for (const s of segs) {
    if (s.type === 'line') poly.push(s.p[0]);
    else {
      const steps = Math.max(24, Math.ceil((len(sub(s.p[1], s.p[0])) + len(sub(s.p[2], s.p[1])) + len(sub(s.p[3], s.p[2]))) / 0.05));
      for (let i = 0; i < steps; i++) poly.push(bezier(s.p, i / steps));
    }
  }
  let worst = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const p = [ring[i], ring[i + 1]];
    let best = Infinity;
    for (let j = 0; j < poly.length; j++) {
      const a = poly[j];
      const b = poly[(j + 1) % poly.length];
      const ab = sub(b, a);
      const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
      best = Math.min(best, len(sub(p, add(a, mul(ab, t)))));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

export { bezier as bezierPoint };
