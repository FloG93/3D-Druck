// Modifiers ("Modifikatoren") change rotation, size and position of the
// holes depending on where they are. They are applied in list order, like a
// modifier stack.
//
// Element passed through the stack:
//   { x, y, rot, sx, sy, i, j, R, removed }
// rot in radians, sx/sy scale factors for hole width/height, R circumradius.

import { DEG, clamp, lerp, lerpAngle, smoothstep, quadPoint } from './math.js';
import { createSimplex, hash2 } from './random.js';

export const MODIFIER_TYPES = ['point', 'line', 'linear', 'noise', 'image', 'edge'];

export const FALLOFFS = {
  linear: (x) => x,
  smooth: smoothstep,
  in: (x) => x * x,
  out: (x) => 1 - (1 - x) * (1 - x),
  step: (x) => (x > 0 ? 1 : 0),
};

const falloffFn = (name) => FALLOFFS[name] || FALLOFFS.smooth;

/** Weight in [0, 1] for distance d and radius R (1 at the centre, 0 at R). */
export function radialWeight(d, R, falloff) {
  if (!(R > 0) || d >= R) return 0;
  return falloff(1 - d / R);
}

function applyScale(el, s, axis) {
  if (s === 1) return;
  if (axis !== 'y') el.sx *= s;
  if (axis !== 'x') el.sy *= s;
}

/** Shared effect block of point and line attractors. */
function applyAttractorEffects(m, el, w, dirAngle, nx, ny, period) {
  if (w <= 0) return;
  const angle = (m.angle || 0) * DEG;
  if (m.rotateMode === 'tangent' || m.rotateMode === 'normal') {
    const target = dirAngle + (m.rotateMode === 'normal' ? Math.PI / 2 : 0) + angle;
    el.rot = lerpAngle(el.rot, target, w, period);
  } else if (angle) {
    el.rot += angle * w;
  }
  applyScale(el, lerp(1, m.scale ?? 1, w), m.scaleAxis);
  if (m.push) {
    el.x += nx * m.push * w;
    el.y += ny * m.push * w;
  }
}

/** Samples a quadratic Bezier (or a straight line) into a polyline. */
export function attractorPolyline(m) {
  if (m.curve) {
    const pts = [];
    const n = 48;
    for (let k = 0; k <= n; k++) pts.push(quadPoint(m.x1, m.y1, m.cx, m.cy, m.x2, m.y2, k / n));
    return pts;
  }
  return [[m.x1, m.y1], [m.x2, m.y2]];
}

function pointModifier(m, env) {
  const falloff = falloffFn(m.falloff);
  const R = Math.max(m.radius, 0);
  return (el) => {
    const dx = el.x - m.x;
    const dy = el.y - m.y;
    const d = Math.hypot(dx, dy);
    if (m.remove) {
      const hit = m.invert ? d > R - el.R : d < R + el.R;
      if (hit) {
        el.removed = true;
        return;
      }
    }
    let w = radialWeight(d, R, falloff);
    if (m.invert) w = 1 - w;
    const inv = d > 1e-12 ? 1 / d : 0;
    // Tangent direction of the circle around the attractor.
    applyAttractorEffects(m, el, w, Math.atan2(dy, dx) + Math.PI / 2, dx * inv, dy * inv, env.period);
  };
}

function lineModifier(m, env) {
  const falloff = falloffFn(m.falloff);
  const R = Math.max(m.radius, 0);
  const pts = attractorPolyline(m);
  return (el) => {
    let best = Infinity;
    let bx = 0;
    let by = 0;
    let tangent = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k];
      const [cx, cy] = pts[k + 1];
      const ex = cx - ax;
      const ey = cy - ay;
      const len2 = ex * ex + ey * ey;
      let t = len2 > 0 ? ((el.x - ax) * ex + (el.y - ay) * ey) / len2 : 0;
      t = clamp(t, 0, 1);
      const px = ax + ex * t;
      const py = ay + ey * t;
      const d2 = (el.x - px) ** 2 + (el.y - py) ** 2;
      if (d2 < best) {
        best = d2;
        bx = px;
        by = py;
        tangent = Math.atan2(ey, ex);
      }
    }
    const d = Math.sqrt(best);
    if (m.remove) {
      const hit = m.invert ? d > R - el.R : d < R + el.R;
      if (hit) {
        el.removed = true;
        return;
      }
    }
    let w = radialWeight(d, R, falloff);
    if (m.invert) w = 1 - w;
    const inv = d > 1e-12 ? 1 / d : 0;
    applyAttractorEffects(m, el, w, tangent, (el.x - bx) * inv, (el.y - by) * inv, env.period);
  };
}

function linearModifier(m) {
  const falloff = falloffFn(m.falloff);
  const vx = m.x2 - m.x1;
  const vy = m.y2 - m.y1;
  const len2 = vx * vx + vy * vy || 1;
  return (el) => {
    const t = clamp(((el.x - m.x1) * vx + (el.y - m.y1) * vy) / len2, 0, 1);
    const w = falloff(t);
    const a = lerp(m.angleFrom || 0, m.angleTo || 0, w);
    if (a) el.rot += a * DEG;
    applyScale(el, Math.max(0, lerp(m.scaleFrom ?? 1, m.scaleTo ?? 1, w)), m.scaleAxis);
  };
}

function noiseModifier(m) {
  const seed = Math.round(m.seed || 1);
  const n1 = createSimplex(seed);
  const n2 = createSimplex(seed + 101);
  const n3 = createSimplex(seed + 202);
  const n4 = createSimplex(seed + 303);
  const f = 1 / Math.max(m.size || 20, 0.1);
  const amount = clamp(m.amount ?? 1, 0, 1);
  return (el) => {
    let v1;
    let v2;
    let v3;
    let v4;
    if (m.mode === 'random') {
      v1 = hash2(el.i, el.j, seed) * 2 - 1;
      v2 = hash2(el.i, el.j, seed + 1) * 2 - 1;
      v3 = hash2(el.i, el.j, seed + 2) * 2 - 1;
      v4 = hash2(el.i, el.j, seed + 3) * 2 - 1;
    } else {
      const x = el.x * f;
      const y = el.y * f;
      v1 = n1(x, y);
      v2 = n2(x, y);
      v3 = n3(x, y);
      v4 = n4(x, y);
    }
    if (m.dropout > 0 && hash2(el.i, el.j, seed + 4) < m.dropout * amount) {
      el.removed = true;
      return;
    }
    if (m.angle) el.rot += m.angle * DEG * v1 * amount;
    if (m.scale) applyScale(el, Math.max(0, 1 + m.scale * v2 * amount), m.scaleAxis);
    if (m.jitter) {
      el.x += m.jitter * v3 * amount;
      el.y += m.jitter * v4 * amount;
    }
  };
}

function imageModifier(m, env) {
  const sample = env.sampleImage;
  if (!sample) return null;
  const gamma = Math.max(m.gamma ?? 1, 0.05);
  return (el) => {
    const b = sample(el.x, el.y);
    if (b == null) return;
    // w = darkness: dark areas get "scaleMax", bright areas "scaleMin".
    let w = m.invert ? b : 1 - b;
    w = Math.pow(clamp(w, 0, 1), gamma);
    applyScale(el, Math.max(0, lerp(m.scaleMin ?? 0, m.scaleMax ?? 1, w)), m.scaleAxis);
    if (m.angle) el.rot += m.angle * DEG * w;
  };
}

function edgeModifier(m, env) {
  const falloff = falloffFn(m.falloff);
  const width = Math.max(m.width, 0.01);
  return (el) => {
    const inside = -env.boundary.sdf(el.x, el.y);
    const t = clamp(inside / width, 0, 1);
    const w = t >= 1 ? 0 : falloff(1 - t);
    if (w <= 0) return;
    applyScale(el, lerp(1, m.scale ?? 1, w), m.scaleAxis);
    if (m.angle) el.rot += m.angle * DEG * w;
  };
}

const FACTORIES = {
  point: pointModifier,
  line: lineModifier,
  linear: linearModifier,
  noise: noiseModifier,
  image: imageModifier,
  edge: edgeModifier,
};

/**
 * Turns the modifier list of a document into apply functions.
 * env: { boundary, period, sampleImage }
 */
export function prepareModifiers(list, env) {
  const out = [];
  for (const m of list || []) {
    if (!m || m.enabled === false) continue;
    const factory = FACTORIES[m.type];
    if (!factory) continue;
    const fn = factory(m, env);
    if (fn) out.push(fn);
  }
  return out;
}

/** Largest displacement a modifier stack can cause (for lattice padding). */
export function maxDisplacement(list) {
  let d = 0;
  for (const m of list || []) {
    if (!m || m.enabled === false) continue;
    if ((m.type === 'point' || m.type === 'line') && m.push) d += Math.abs(m.push);
    if (m.type === 'noise' && m.jitter) d += Math.abs(m.jitter) * 1.5;
  }
  return d;
}
