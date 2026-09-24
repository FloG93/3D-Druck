// Printability check: web thickness ("Stegbreite") between neighbouring holes.
// Uses the hole cores (see shapes.js): distance(hole A, hole B) =
// distance(core A, core B) - rA - rB, exact for all rounded polygons.

export const FLAG_OK = 0;
export const FLAG_THIN = 1;
export const FLAG_OVERLAP = 2;

function polygonArea2(p) {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return a;
}

function pointInConvex(x, y, p) {
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[2 * i];
    const ay = p[2 * i + 1];
    const bx = p[2 * j];
    const by = p[2 * j + 1];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < -1e-12) return false;
  }
  return true;
}

function cross(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function convexIntersect(a, b) {
  if (polygonArea2(b) > 1e-12) {
    for (let i = 0; i < a.length; i += 2) if (pointInConvex(a[i], a[i + 1], b)) return true;
  }
  if (polygonArea2(a) > 1e-12) {
    for (let i = 0; i < b.length; i += 2) if (pointInConvex(b[i], b[i + 1], a)) return true;
  }
  const na = a.length / 2;
  const nb = b.length / 2;
  if (na < 2 || nb < 2) return false;
  for (let i = 0; i < na; i++) {
    const i2 = (i + 1) % na;
    for (let j = 0; j < nb; j++) {
      const j2 = (j + 1) % nb;
      if (segmentsCross(a[2 * i], a[2 * i + 1], a[2 * i2], a[2 * i2 + 1],
        b[2 * j], b[2 * j + 1], b[2 * j2], b[2 * j2 + 1])) return true;
    }
  }
  return false;
}

function pointsToEdges2(P, Q) {
  let min = Infinity;
  const nq = Q.length / 2;
  for (let i = 0; i < P.length; i += 2) {
    const px = P[i];
    const py = P[i + 1];
    if (nq === 1) {
      const d2 = (px - Q[0]) ** 2 + (py - Q[1]) ** 2;
      if (d2 < min) min = d2;
      continue;
    }
    for (let j = 0; j < nq; j++) {
      const j2 = (j + 1) % nq;
      const ax = Q[2 * j];
      const ay = Q[2 * j + 1];
      const ex = Q[2 * j2] - ax;
      const ey = Q[2 * j2 + 1] - ay;
      const len2 = ex * ex + ey * ey;
      let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d2 = (px - ax - ex * t) ** 2 + (py - ay - ey * t) ** 2;
      if (d2 < min) min = d2;
    }
  }
  return min;
}

/** Signed gap between two holes (negative when they overlap). */
export function holeGap(a, b) {
  const ca = a.core;
  const cb = b.core;
  if (convexIntersect(ca.pts, cb.pts)) return -(ca.r + cb.r) - 1e-3;
  const d = Math.sqrt(Math.min(pointsToEdges2(ca.pts, cb.pts), pointsToEdges2(cb.pts, ca.pts)));
  return d - ca.r - cb.r;
}

/**
 * Checks all neighbouring hole pairs.
 * ghosts: copies of holes across a cylinder seam ({ src } = index of the
 * original); their findings count for the original hole.
 * Returns { minWeb, pair, thin, overlap, flags, threshold }.
 */
export function analyzeWebs(holes, threshold = 0.8, ghosts = []) {
  if (ghosts.length) {
    const all = analyzeWebs(holes.concat(ghosts), threshold);
    const count = holes.length;
    const flags = all.flags.slice(0, count);
    ghosts.forEach((g, k) => {
      flags[g.src] = Math.max(flags[g.src], all.flags[count + k]);
    });
    const home = (i) => (i < count ? i : ghosts[i - count].src);
    const result = { minWeb: all.minWeb, pair: all.pair && all.pair.map(home), thin: 0, overlap: 0, flags, threshold };
    for (const f of flags) {
      if (f === FLAG_OVERLAP) result.overlap++;
      else if (f === FLAG_THIN) result.thin++;
    }
    return result;
  }
  const n = holes.length;
  const flags = new Uint8Array(n);
  const result = { minWeb: Infinity, pair: null, thin: 0, overlap: 0, flags, threshold };
  if (n < 2) return result;
  let maxR = 0;
  for (const h of holes) if (h.R > maxR) maxR = h.R;
  const search = Math.max(threshold, 2);
  const cell = 2 * maxR + search;
  const grid = new Map();
  const keyOf = (gx, gy) => gx * 1048576 + gy;
  const cells = new Int32Array(2 * n);
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(holes[i].x / cell);
    const gy = Math.floor(holes[i].y / cell);
    cells[2 * i] = gx;
    cells[2 * i + 1] = gy;
    const k = keyOf(gx, gy);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  for (let i = 0; i < n; i++) {
    const a = holes[i];
    const gx = cells[2 * i];
    const gy = cells[2 * i + 1];
    for (let yy = gy - 1; yy <= gy + 1; yy++) {
      for (let xx = gx - 1; xx <= gx + 1; xx++) {
        const list = grid.get(keyOf(xx, yy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const b = holes[j];
          const lower = Math.hypot(a.x - b.x, a.y - b.y) - a.R - b.R;
          if (lower > search && lower > result.minWeb) continue;
          const gap = holeGap(a, b);
          if (gap < result.minWeb) {
            result.minWeb = gap;
            result.pair = [i, j];
          }
          if (gap < 0) {
            flags[i] = FLAG_OVERLAP;
            flags[j] = FLAG_OVERLAP;
          } else if (gap < threshold) {
            if (flags[i] === FLAG_OK) flags[i] = FLAG_THIN;
            if (flags[j] === FLAG_OK) flags[j] = FLAG_THIN;
          }
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (flags[i] === FLAG_OVERLAP) result.overlap++;
    else if (flags[i] === FLAG_THIN) result.thin++;
  }
  return result;
}
