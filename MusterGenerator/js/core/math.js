// Small math helpers shared by the generator, the renderer and the exporters.
// World coordinates are millimetres, origin at the canvas centre, y pointing up.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const EPS = 1e-9;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Wraps an angle to the interval (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
}

/**
 * Shortest signed difference from angle a to angle b, taking a rotational
 * symmetry period into account (PI for slots/ellipses, 2PI/n for n-gons).
 */
export function angleDelta(a, b, period = TAU) {
  let d = (b - a) % period;
  if (d > period / 2) d -= period;
  else if (d < -period / 2) d += period;
  return d;
}

export const lerpAngle = (a, b, t, period = TAU) => a + angleDelta(a, b, period) * t;

/** Distance from point p to segment ab; also returns the segment parameter. */
export function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { d: Math.hypot(px - cx, py - cy), t, x: cx, y: cy };
}

/** Squared distance from point p to segment ab (no allocation, hot path). */
export function segmentDistance2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + dx * t);
  const ey = py - (ay + dy * t);
  return ex * ex + ey * ey;
}

/** Point on a quadratic Bezier curve. */
export function quadPoint(x0, y0, cx, cy, x1, y1, t) {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

/** Rounds to a fixed number of decimals and removes negative zero. */
export function round(v, decimals = 4) {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

/** Formats a number for text output with a fixed maximum number of decimals. */
export function fmt(v, decimals = 4) {
  const r = round(v, decimals);
  return String(r);
}
