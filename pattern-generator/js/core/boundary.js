// Plate boundary: the region that holes must stay inside.
// All boundaries are convex, which keeps the inside tests exact and simple.

import { TAU, clamp, segmentDistance2 } from './math.js';
import { filletPolygon, maxFilletRadius, outlineArea, polygonSides } from './shapes.js';

export const BOUNDARY_TYPES = ['none', 'rect', 'ellipse', 'polygon'];

/** Signed distance to a convex CCW polygon given as a flat coordinate array. */
export function convexPolygonSdf(px, py, pts) {
  const n = pts.length / 2;
  if (n === 1) return Math.hypot(px - pts[0], py - pts[1]);
  let minD2 = Infinity;
  let inside = true;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[2 * i];
    const ay = pts[2 * i + 1];
    const bx = pts[2 * j];
    const by = pts[2 * j + 1];
    const d2 = segmentDistance2(px, py, ax, ay, bx, by);
    if (d2 < minD2) minD2 = d2;
    if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < 0) inside = false;
  }
  const d = Math.sqrt(minD2);
  return inside ? -d : d;
}

/**
 * Signed distance to an axis-aligned ellipse centred at the origin.
 * Iterative closest-point method (converges in a few steps for all points).
 */
export function ellipseSdf(px, py, a, b) {
  const x = Math.abs(px);
  const y = Math.abs(py);
  if (Math.abs(a - b) < 1e-9) return Math.hypot(px, py) - a;
  let tx = Math.SQRT1_2;
  let ty = Math.SQRT1_2;
  for (let k = 0; k < 4; k++) {
    const ex = ((a * a - b * b) * tx * tx * tx) / a;
    const ey = ((b * b - a * a) * ty * ty * ty) / b;
    const rx = a * tx - ex;
    const ry = b * ty - ey;
    const qx = x - ex;
    const qy = y - ey;
    const r = Math.hypot(rx, ry);
    const q = Math.hypot(qx, qy) || 1e-12;
    tx = clamp(((qx * r) / q + ex) / a, 0, 1);
    ty = clamp(((qy * r) / q + ey) / b, 0, 1);
    const t = Math.hypot(tx, ty) || 1;
    tx /= t;
    ty /= t;
  }
  const d = Math.hypot(x - a * tx, y - b * ty);
  return (x * x) / (a * a) + (y * y) / (b * b) < 1 ? -d : d;
}

/** Offsets a convex CCW polygon inwards by distance d (list of [x, y]). */
export function insetPolygonPoints(P, d) {
  const flat = insetPolygon(P, d);
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** Offsets a convex CCW polygon inwards by distance d (flat array output). */
function insetPolygon(P, d) {
  const n = P.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    lines.push({ px: a[0] + nx * d, py: a[1] + ny * d, dx, dy });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n];
    const l2 = lines[i];
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-12) {
      out.push(l2.px, l2.py);
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    out.push(l1.px + l1.dx * t, l1.py + l1.dy * t);
  }
  return out;
}

/** Unit regular polygon (circumradius 1) and its bounding box. */
export function regularPolygon(sides, rotationDeg) {
  const n = polygonSides(sides);
  const rot = ((rotationDeg || 0) * Math.PI) / 180;
  const P = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    const a = Math.PI / 2 + rot + (TAU * k) / n;
    const x = Math.cos(a);
    const y = Math.sin(a);
    P.push([x, y]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { P, minX, minY, maxX, maxY };
}

function boundaryPolygon(cfg, W, H) {
  if (cfg.type === 'polygon') {
    // Scale the regular polygon so that its bounding box fills the canvas.
    const { P, minX, minY, maxX, maxY } = regularPolygon(cfg.sides, cfg.rotation);
    const sx = W / (maxX - minX);
    const sy = H / (maxY - minY);
    const ox = (minX + maxX) / 2;
    const oy = (minY + maxY) / 2;
    return P.map(([x, y]) => [(x - ox) * sx, (y - oy) * sy]);
  }
  return [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
}

/**
 * Builds the boundary object for a boundary config and canvas size.
 * { type, outline, area, sdf(x, y), halfW, halfH }
 */
export function makeBoundary(cfg, canvas) {
  const W = Math.max(canvas.width, 1);
  const H = Math.max(canvas.height, 1);
  const type = BOUNDARY_TYPES.includes(cfg.type) ? cfg.type : 'none';
  if (type === 'ellipse') {
    const a = W / 2;
    const b = H / 2;
    const outline = Math.abs(a - b) < 1e-9
      ? { kind: 'circle', cx: 0, cy: 0, r: a }
      : a >= b
        ? { kind: 'ellipse', cx: 0, cy: 0, rx: a, ry: b, rot: 0 }
        : { kind: 'ellipse', cx: 0, cy: 0, rx: b, ry: a, rot: Math.PI / 2 };
    const sdf = (x, y) => ellipseSdf(x, y, a, b);
    return {
      type,
      outline,
      area: Math.PI * a * b,
      sdf,
      halfW: W / 2,
      halfH: H / 2,
      // Inner offset curve (used to draw the margin line). Points of the
      // naive offset that are not at distance m (swallowtails) are dropped.
      offsetOutline(m) {
        if (!(m > 0)) return outline;
        const pts = [];
        const n = 360;
        for (let k = 0; k < n; k++) {
          const t = (TAU * k) / n;
          const px = a * Math.cos(t);
          const py = b * Math.sin(t);
          let nx = b * Math.cos(t);
          let ny = a * Math.sin(t);
          const l = Math.hypot(nx, ny);
          nx /= l;
          ny /= l;
          const qx = px - nx * m;
          const qy = py - ny * m;
          if (Math.abs(sdf(qx, qy) + m) < 0.01 + m * 0.002) pts.push([qx, qy]);
        }
        return pts.length >= 3 ? polylineOutline(pts) : null;
      },
    };
  }
  const P = boundaryPolygon({ ...cfg, type }, W, H);
  const rmax = maxFilletRadius(P);
  const r = type === 'none' ? 0 : clamp(cfg.cornerRadius || 0, 0, rmax);
  const { outline } = filletPolygon(P, r >= rmax - 1e-9 ? rmax : r);
  const core = r > 0 ? insetPolygon(P, r) : P.flat();
  let halfW = 0;
  let halfH = 0;
  for (const p of P) {
    halfW = Math.max(halfW, Math.abs(p[0]));
    halfH = Math.max(halfH, Math.abs(p[1]));
  }
  return {
    type,
    outline,
    area: outlineArea(outline),
    sdf: (x, y) => convexPolygonSdf(x, y, core) - r,
    halfW,
    halfH,
    // Exact inner offset: inset the sharp polygon, reduce the corner radius.
    offsetOutline(m) {
      if (!(m > 0)) return outline;
      const Pm = insetPolygonPoints(P, m);
      const n = P.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dot = (Pm[j][0] - Pm[i][0]) * (P[j][0] - P[i][0]) + (Pm[j][1] - Pm[i][1]) * (P[j][1] - P[i][1]);
        if (dot <= 0) return null;
      }
      const r2 = Math.min(Math.max(0, r - m), maxFilletRadius(Pm));
      return filletPolygon(Pm, r2).outline;
    },
  };
}

function polylineOutline(pts) {
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    segs.push({ type: 'line', x0: p[0], y0: p[1], x1: q[0], y1: q[1] });
  }
  return { kind: 'path', segs };
}

/**
 * Smallest distance from a hole to the boundary edge (negative if the hole
 * crosses the edge). Exact for convex boundaries: the inner distance is
 * concave, so its minimum over the convex core is attained at a vertex.
 */
export function rimDistance(boundary, core) {
  const pts = core.pts;
  let min = Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const d = -boundary.sdf(pts[i], pts[i + 1]);
    if (d < min) min = d;
  }
  return min - core.r;
}
