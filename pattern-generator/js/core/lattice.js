// Point arrangements ("Anordnung"). Each point carries integer indices i/j
// (column/row, item/ring) used for alternating rotations and random noise,
// and a base rotation (e.g. tangential alignment on rings).

import { DEG, TAU } from './math.js';
import { mulberry32 } from './random.js';

export const PATTERN_TYPES = ['grid', 'hex', 'radial', 'spiral', 'random'];
export const MAX_POINTS = 60000;

const mod2 = (n) => ((n % 2) + 2) % 2;

/**
 * Generates lattice points that cover the canvas (plus padding).
 * Returns { points, overflow, estimate }.
 */
export function makeLattice(pattern, canvas, pad = 0) {
  const halfW = canvas.width / 2 + pad;
  const halfH = canvas.height / 2 + pad;
  switch (pattern.type) {
    case 'radial':
      return radialLattice(pattern, halfW, halfH);
    case 'spiral':
      return spiralLattice(pattern, halfW, halfH);
    case 'random':
      return randomLattice(pattern, halfW, halfH);
    case 'hex':
      return gridLattice(pattern, halfW, halfH, true);
    default:
      return gridLattice(pattern, halfW, halfH, false);
  }
}

function overflow(estimate) {
  return { points: [], overflow: true, estimate: Math.round(estimate) };
}

function baseRotation(pattern, angle) {
  const phi = (pattern.rotation || 0) * DEG;
  switch (pattern.align) {
    case 'tangent':
      return angle + Math.PI / 2 + phi;
    case 'radial':
      return angle + phi;
    default:
      return pattern.rotateHoles ? phi : 0;
  }
}

function gridLattice(pattern, halfW, halfH, staggered) {
  const sx = Math.max(pattern.spacingX, 0.05);
  const sy = Math.max(pattern.spacingY, 0.05);
  const estimate = ((2 * halfW) / sx) * ((2 * halfH) / sy);
  if (estimate > MAX_POINTS) return overflow(estimate);
  const phi = (pattern.rotation || 0) * DEG;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const ox = pattern.offsetX || 0;
  const oy = pattern.offsetY || 0;
  const shift = staggered ? (pattern.rowShift ?? 0.5) : 0;
  const reach = Math.hypot(halfW + Math.abs(ox), halfH + Math.abs(oy)) + Math.max(sx, sy);
  const ni = Math.ceil(reach / sx) + 1;
  const nj = Math.ceil(reach / sy) + 1;
  const rot = pattern.rotateHoles ? phi : 0;
  const points = [];
  for (let j = -nj; j <= nj; j++) {
    const rowOffset = shift * sx * mod2(j);
    const ly = j * sy;
    for (let i = -ni; i <= ni; i++) {
      const lx = i * sx + rowOffset;
      const x = lx * c - ly * s + ox;
      const y = lx * s + ly * c + oy;
      if (Math.abs(x) <= halfW && Math.abs(y) <= halfH) points.push({ x, y, i, j, rot });
    }
  }
  return { points, overflow: false, estimate: points.length };
}

function radialLattice(pattern, halfW, halfH) {
  const dr = Math.max(pattern.ringSpacing, 0.1);
  const ds = Math.max(pattern.itemSpacing, 0.1);
  const ox = pattern.offsetX || 0;
  const oy = pattern.offsetY || 0;
  const reach = Math.hypot(halfW + Math.abs(ox), halfH + Math.abs(oy));
  const fixedCount = Math.max(0, Math.round(pattern.ringCount || 0));
  const rings = Math.ceil(reach / dr);
  const estimate = fixedCount > 0 ? rings * fixedCount : (Math.PI * reach * reach) / (dr * ds);
  if (estimate > MAX_POINTS) return overflow(estimate);
  const phi = (pattern.rotation || 0) * DEG;
  const points = [];
  if (pattern.centerHole !== false) {
    points.push({ x: ox, y: oy, i: 0, j: 0, rot: baseRotation(pattern, 0) });
  }
  for (let k = 1; k <= rings; k++) {
    const r = k * dr;
    const n = fixedCount > 0 ? fixedCount : Math.max(1, Math.round((TAU * r) / ds));
    const stagger = pattern.stagger && k % 2 === 1 ? 0.5 : 0;
    for (let i = 0; i < n; i++) {
      const a = phi + (TAU * (i + stagger)) / n;
      const x = ox + r * Math.cos(a);
      const y = oy + r * Math.sin(a);
      if (Math.abs(x) <= halfW && Math.abs(y) <= halfH) {
        points.push({ x, y, i, j: k, rot: baseRotation(pattern, a - phi) });
      }
    }
  }
  return { points, overflow: false, estimate: points.length };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function spiralLattice(pattern, halfW, halfH) {
  const d = Math.max(pattern.spiralSpacing, 0.1);
  // Area per point of a hexagonal packing with spacing d is sqrt(3)/2 * d^2.
  const c = d * Math.sqrt(Math.sqrt(3) / (2 * Math.PI));
  const ox = pattern.offsetX || 0;
  const oy = pattern.offsetY || 0;
  const reach = Math.hypot(halfW + Math.abs(ox), halfH + Math.abs(oy));
  const count = Math.ceil((reach / c) ** 2);
  if (count > MAX_POINTS * 1.3) return overflow((count * 4 * halfW * halfH) / (Math.PI * reach * reach));
  const phi = (pattern.rotation || 0) * DEG;
  const points = [];
  for (let i = 0; i < count; i++) {
    const r = c * Math.sqrt(i + 0.5);
    const a = i * GOLDEN_ANGLE;
    const x = ox + r * Math.cos(a + phi);
    const y = oy + r * Math.sin(a + phi);
    if (Math.abs(x) <= halfW && Math.abs(y) <= halfH) {
      points.push({ x, y, i, j: 0, rot: baseRotation(pattern, a) });
    }
  }
  return { points, overflow: false, estimate: points.length };
}

/** Poisson disk sampling (Bridson) inside the padded canvas rectangle. */
function randomLattice(pattern, halfW, halfH) {
  const r = Math.max(pattern.minDistance, 0.1);
  const estimate = (4 * halfW * halfH) / (0.7 * r * r);
  if (estimate > MAX_POINTS) return overflow(estimate);
  const rand = mulberry32((pattern.seed || 1) * 7919);
  const cell = r / Math.SQRT2;
  const gw = Math.ceil((2 * halfW) / cell) + 1;
  const gh = Math.ceil((2 * halfH) / cell) + 1;
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const rot = pattern.rotateHoles ? (pattern.rotation || 0) * DEG : 0;
  const insert = (x, y) => {
    const idx = pts.length;
    pts.push({ x, y, i: idx, j: 0, rot });
    active.push(idx);
    grid[Math.floor((y + halfH) / cell) * gw + Math.floor((x + halfW) / cell)] = idx;
  };
  const fits = (x, y) => {
    if (x < -halfW || x > halfW || y < -halfH || y > halfH) return false;
    const gx = Math.floor((x + halfW) / cell);
    const gy = Math.floor((y + halfH) / cell);
    for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++) {
      for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
        const k = grid[yy * gw + xx];
        if (k >= 0) {
          const p = pts[k];
          if ((p.x - x) ** 2 + (p.y - y) ** 2 < r * r) return false;
        }
      }
    }
    return true;
  };
  insert((rand() - 0.5) * halfW, (rand() - 0.5) * halfH);
  while (active.length && pts.length < MAX_POINTS) {
    const ai = Math.floor(rand() * active.length);
    const p = pts[active[ai]];
    let placed = false;
    for (let k = 0; k < 30; k++) {
      const a = rand() * TAU;
      const d = r * (1 + rand());
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (fits(x, y)) {
        insert(x, y);
        placed = true;
        break;
      }
    }
    if (!placed) {
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }
  return { points: pts, overflow: false, estimate: pts.length };
}
