// Point arrangements ("Anordnung"). Each point carries integer indices i/j
// (column/row, item/ring) used for alternating rotations and random noise,
// and a base rotation (e.g. tangential alignment on rings).

import { DEG, TAU, clamp } from './math.js';
import { mulberry32 } from './random.js';
import { qrMatrix } from './qr.js';

export const PATTERN_TYPES = ['grid', 'hex', 'radial', 'spiral', 'random', 'qr', 'bitmap'];
/** Arrangements whose cells come from a matrix (sizes per point, no turning). */
export const CELL_PATTERNS = ['qr', 'bitmap'];
export const MAX_POINTS = 60000;

const mod2 = (n) => ((n % 2) + 2) % 2;

/**
 * Generates lattice points that cover the canvas (plus padding).
 * wrap > 0: the canvas is the unrolled surface of a cylinder with this
 * circumference. Points are then generated once, with x in [-wrap/2, wrap/2),
 * and grids get a column spacing that divides the circumference, so the
 * pattern closes without a seam.
 * Returns { points, overflow, estimate, seamless, columns, spacingX }.
 */
export function makeLattice(pattern, canvas, pad = 0, wrap = 0, env = {}) {
  const halfW = wrap > 0 ? wrap / 2 : canvas.width / 2 + pad;
  const halfH = canvas.height / 2 + pad;
  switch (pattern.type) {
    case 'qr':
      return qrLattice(pattern, wrap);
    case 'bitmap':
      return bitmapLattice(pattern, canvas, env.sampleImage, wrap);
    case 'radial':
      return wrapFilter(radialLattice(pattern, halfW, halfH), wrap);
    case 'spiral':
      return wrapFilter(spiralLattice(pattern, halfW, halfH), wrap);
    case 'random':
      return randomLattice(pattern, halfW, halfH, wrap);
    case 'hex':
      return gridLattice(pattern, halfW, halfH, true, wrap);
    default:
      return gridLattice(pattern, halfW, halfH, false, wrap);
  }
}

/** x moved by whole periods into [-period/2, period/2). */
export function wrapX(x, period) {
  return x - period * Math.floor((x + period / 2) / period);
}

/** Keeps one copy of every point of a non-periodic lattice on a cylinder. */
function wrapFilter(lattice, wrap) {
  if (!(wrap > 0) || lattice.overflow) return lattice;
  const points = lattice.points.filter((p) => p.x < wrap / 2);
  return { ...lattice, points, estimate: points.length, seamless: false };
}

const isHalfTurn = (deg) => {
  const r = (((deg || 0) % 180) + 180) % 180;
  return r < 1e-9 || r > 180 - 1e-9;
};

/**
 * Grid closed around a cylinder: n columns with spacing wrap / n. Turning
 * holes alternately by column needs an even column count to meet at the seam.
 */
function periodicGrid(pattern, wrap, halfH, staggered) {
  const want = wrap / Math.max(pattern.spacingX, 0.05);
  const alternating = pattern.spin && pattern.spinMode !== 'progressive' && pattern.spinBy !== 'row';
  const n = alternating ? 2 * Math.max(1, Math.round(want / 2)) : Math.max(1, Math.round(want));
  const sx = wrap / n;
  const sy = Math.max(pattern.spacingY, 0.05);
  const estimate = n * ((2 * halfH) / sy);
  if (estimate > MAX_POINTS) return overflow(estimate);
  const c = Math.cos((pattern.rotation || 0) * DEG) < 0 ? -1 : 1;
  const ox = pattern.offsetX || 0;
  const oy = pattern.offsetY || 0;
  const shift = staggered ? (pattern.rowShift ?? 0.5) : 0;
  const nj = Math.ceil((halfH + Math.abs(oy)) / sy) + 1;
  const i0 = -Math.floor(n / 2);
  const rot = pattern.rotateHoles && c < 0 ? Math.PI : 0;
  const points = [];
  for (let j = -nj; j <= nj; j++) {
    const rowOffset = shift * sx * mod2(j);
    const y = c * j * sy + oy;
    if (Math.abs(y) > halfH) continue;
    for (let i = i0; i < i0 + n; i++) {
      points.push({ x: wrapX(c * (i * sx + rowOffset) + ox, wrap), y, i, j, rot });
    }
  }
  return { points, overflow: false, estimate: points.length, seamless: true, columns: n, spacingX: sx };
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

function gridLattice(pattern, halfW, halfH, staggered, wrap = 0) {
  if (wrap > 0 && isHalfTurn(pattern.rotation)) return periodicGrid(pattern, wrap, halfH, staggered);
  if (wrap > 0) return wrapFilter(gridLattice(pattern, halfW, halfH, staggered), wrap);
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

/**
 * Poisson disk sampling (Bridson) inside the padded canvas rectangle; with
 * wrap > 0 distances are measured around the cylinder, so it has no seam.
 */
function randomLattice(pattern, halfW, halfH, wrap = 0) {
  const r = Math.max(pattern.minDistance, 0.1);
  const estimate = (4 * halfW * halfH) / (0.7 * r * r);
  if (estimate > MAX_POINTS) return overflow(estimate);
  const periodic = wrap > 0;
  const rand = mulberry32((pattern.seed || 1) * 7919);
  const cellY = r / Math.SQRT2;
  // On a cylinder the columns must tile the circumference exactly.
  const gw = periodic ? Math.max(1, Math.ceil((2 * halfW) / cellY)) : Math.ceil((2 * halfW) / cellY) + 1;
  const cellX = periodic ? (2 * halfW) / gw : cellY;
  const gh = Math.ceil((2 * halfH) / cellY) + 1;
  const kx = Math.ceil(r / cellX);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const rot = pattern.rotateHoles ? (pattern.rotation || 0) * DEG : 0;
  const column = (x) => Math.min(gw - 1, Math.floor((x + halfW) / cellX));
  const insert = (x, y) => {
    const idx = pts.length;
    pts.push({ x, y, i: idx, j: 0, rot });
    active.push(idx);
    grid[Math.floor((y + halfH) / cellY) * gw + column(x)] = idx;
  };
  const fits = (x, y) => {
    if (x < -halfW || x > halfW || y < -halfH || y > halfH) return false;
    const gx = column(x);
    const gy = Math.floor((y + halfH) / cellY);
    for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++) {
      for (let k = -kx; k <= kx; k++) {
        let xx = gx + k;
        if (periodic) xx = ((xx % gw) + gw) % gw;
        else if (xx < 0 || xx >= gw) continue;
        const idx = grid[yy * gw + xx];
        if (idx >= 0) {
          const p = pts[idx];
          const dx = periodic ? wrapX(p.x - x, wrap) : p.x - x;
          if (dx * dx + (p.y - y) ** 2 < r * r) return false;
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
      let x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (periodic) x = wrapX(x, wrap);
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
  return { points: pts, overflow: false, estimate: pts.length, seamless: periodic };
}

/**
 * Dark cells of a cols x rows matrix with cell size m; (x0, y0) is the top
 * left corner. With merge, neighbouring cells of a row become one bar and
 * equal bars of consecutive rows one block, so the shapes keep the gap only
 * where they would touch. bars(r, c) forces merging for some cells (QR
 * position markers). Points carry absolute sizes w/h.
 */
function cellRuns(cols, rows, dark, m, gap, merge, x0, y0, wrap, bars = () => false) {
  const blocks = [];
  let open = new Map();
  for (let r = 0; r < rows; r++) {
    const next = new Map();
    for (let c = 0; c < cols;) {
      if (!dark(r, c)) {
        c += 1;
        continue;
      }
      const join = merge || bars(r, c);
      let e = c + 1;
      if (join) while (e < cols && dark(r, e) && (merge || bars(r, e))) e += 1;
      const key = c * 65536 + e;
      const above = join ? open.get(key) : null;
      if (above) {
        above.r1 = r + 1;
        next.set(key, above);
      } else {
        const block = { c, e, r0: r, r1: r + 1, join };
        blocks.push(block);
        if (join) next.set(key, block);
      }
      c = e;
    }
    open = next;
  }
  return blocks.map((b) => {
    const x = x0 + ((b.c + b.e) / 2) * m;
    return {
      x: wrap > 0 ? wrapX(x, wrap) : x,
      y: y0 - ((b.r0 + b.r1) / 2) * m,
      i: b.c,
      j: b.r0,
      rot: 0,
      w: (b.e - b.c) * m - (merge ? 0 : gap),
      h: (b.r1 - b.r0) * m - gap,
    };
  });
}

/** QR code for pattern.qrText, centred on the pattern offset. */
function qrLattice(pattern, wrap) {
  let matrix;
  try {
    matrix = qrMatrix(pattern.qrText, pattern.qrEcc);
  } catch (err) {
    return { points: [], overflow: false, estimate: 0, info: { kind: 'qr', error: err.message } };
  }
  const m = Math.max(pattern.module || 1, 0.05);
  const gap = clamp(pattern.gap || 0, 0, m / 2);
  const n = matrix.size;
  const x0 = (pattern.offsetX || 0) - (n * m) / 2;
  const y0 = (pattern.offsetY || 0) + (n * m) / 2;
  // The three position markers stay bars in every style, so scanners find them.
  const finder = (r, c) => (r < 7 && (c < 7 || c >= n - 7)) || (r >= n - 7 && c < 7);
  const points = cellRuns(n, n, matrix.dark, m, gap, pattern.merge !== false, x0, y0, wrap, finder);
  return {
    points,
    overflow: false,
    estimate: points.length,
    seamless: true,
    info: { kind: 'qr', size: n, version: matrix.version, expected: points.length, width: n * m },
  };
}

/**
 * Pixel image of the background image: cells darker than the threshold
 * (lighter with invert) become shapes. The cells cover the canvas.
 */
function bitmapLattice(pattern, canvas, sample, wrap) {
  if (!sample) return { points: [], overflow: false, estimate: 0, info: { kind: 'bitmap', missing: true } };
  const m = Math.max(pattern.module || 1, 0.05);
  const cols = Math.max(1, Math.round(canvas.width / m));
  const rows = Math.max(1, Math.round(canvas.height / m));
  if (cols * rows > MAX_POINTS * 40) return overflow((cols * rows) / 4);
  const gap = clamp(pattern.gap || 0, 0, m / 2);
  const t = clamp(pattern.threshold ?? 0.5, 0, 1);
  const x0 = (-cols * m) / 2;
  const y0 = (rows * m) / 2;
  const cells = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = sample(x0 + (c + 0.5) * m, y0 - (r + 0.5) * m);
      if (b != null) cells[r * cols + c] = (pattern.invert ? b > t : b < t) ? 1 : 0;
    }
  }
  const points = cellRuns(cols, rows, (r, c) => cells[r * cols + c] === 1, m, gap, pattern.merge !== false, x0, y0, wrap);
  if (points.length > MAX_POINTS) return overflow(points.length);
  return { points, overflow: false, estimate: points.length, seamless: false, info: { kind: 'bitmap', cols, rows } };
}
