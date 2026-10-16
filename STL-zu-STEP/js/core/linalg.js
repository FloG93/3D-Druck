// The little bit of linear algebra the recognition needs: eigenvalues and
// eigenvectors of a symmetric 3×3 matrix (axis of a cylinder from the
// covariance of the normals) and a least-squares solver for small normal
// equations (circle and sphere fits). Everything in plain arrays – the
// matrices never grow beyond 4×4.

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Largest and smallest value of a list of any length. Math.max(...list) puts
 * every element on the stack as an argument and fails with "Maximum call stack
 * size exceeded" from about 120 000 elements – a finely meshed cylinder has more.
 */
export function maxOf(values) {
  let best = -Infinity;
  for (const v of values) if (v > best) best = v;
  return best;
}
export function minOf(values) {
  let best = Infinity;
  for (const v of values) if (v < best) best = v;
  return best;
}

export function normalize(a) {
  const l = norm(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** Two unit vectors perpendicular to `axis` and to each other, right-handed. */
export function frame(axis) {
  const a = normalize(axis);
  let u1 = cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  if (norm(u1) < 0.1) u1 = cross(a, [0, 0, 1]);
  u1 = normalize(u1);
  const u2 = normalize(cross(a, u1));
  return { axis: a, u1, u2 };
}

/**
 * Eigenvalues and eigenvectors of a symmetric 3×3 matrix (Jacobi rotations),
 * ascending like numpy's eigh: { values: [λ0≤λ1≤λ2], vectors: [v0, v1, v2] }.
 */
export function eigh3(m) {
  const a = [[m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]];
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => normalize([v[0][i], v[1][i], v[2][i]])),
  };
}

/**
 * Solves A·x = b for a small square system (Gaussian elimination with partial
 * pivoting). Returns null when the matrix is singular.
 */
export function solve(A, b) {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-14) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Least squares through the normal equations: design rows `rows` (one array
 * per measurement) against right-hand sides `rhs`.
 */
export function leastSquares(rows, rhs) {
  const k = rows[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let p = 0; p < k; p++) {
      b[p] += rows[i][p] * rhs[i];
      for (let q = 0; q < k; q++) A[p][q] += rows[i][p] * rows[i][q];
    }
  }
  return solve(A, b);
}

/**
 * Circle through points in 2D, least squares (algebraic form, as in
 * referenz/probe4.py::fit): rows [2x, 2y, 1] against x² + y².
 * → { center: [cx, cy], radius } or null.
 */
export function fitCircle(xs, ys) {
  if (xs.length < 3) return null;
  const rows = xs.map((x, i) => [2 * x, 2 * ys[i], 1]);
  const rhs = xs.map((x, i) => x * x + ys[i] * ys[i]);
  const s = leastSquares(rows, rhs);
  if (!s) return null;
  const r2 = s[2] + s[0] * s[0] + s[1] * s[1];
  if (!(r2 > 0)) return null;
  return { center: [s[0], s[1]], radius: Math.sqrt(r2) };
}

/**
 * Sphere through points in 3D, least squares (counter-hypothesis in
 * referenz/probe6.py::verdict): rows [2x, 2y, 2z, 1] against x² + y² + z².
 */
export function fitSphere(points) {
  if (points.length < 4) return null;
  const rows = points.map((p) => [2 * p[0], 2 * p[1], 2 * p[2], 1]);
  const rhs = points.map((p) => p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  const s = leastSquares(rows, rhs);
  if (!s) return null;
  const r2 = s[3] + s[0] * s[0] + s[1] * s[1] + s[2] * s[2];
  if (!(r2 > 0)) return null;
  return { center: [s[0], s[1], s[2]], radius: Math.sqrt(r2) };
}

/** Slope of a straight line through (x, y), least squares. */
export function fitSlope(x, y) {
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const rows = x.map((v) => [1, v - mean]);
  const s = leastSquares(rows, y);
  return s ? s[1] : 0;
}
