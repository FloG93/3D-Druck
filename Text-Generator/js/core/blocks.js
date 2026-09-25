// Content blocks besides text: QR codes and graphics (imported SVG). Each
// gives its region in mm (world coordinates of its side, before a back-side
// block is mirrored) and a footprint the plate has to cover.

import { qrMatrix, wifiPayload } from '../../../shared/js/qr.js';
import {
  TOLERANCE, union, difference, offset, fillRings, strokePaths, transformRegion, regionBounds, circleRing,
} from './geometry.js';
import { flattenCommands, flattenPaths } from './layout.js';
import { pathCommands } from './svgimport.js';

const DEG = Math.PI / 180;

/** Block frame → world: scale, rotate by block.rotation, then move to (x, y). */
export function blockMatrix(block, scale = 1) {
  const r = (Number(block.rotation) || 0) * DEG;
  const c = Math.cos(r) * scale;
  const s = Math.sin(r) * scale;
  return [c, s, -s, c, Number(block.x) || 0, Number(block.y) || 0];
}

/** Text encoded in the QR code of a block. */
export function qrContent(block) {
  if (block.qrMode === 'wifi') {
    return block.wifiSsid ? wifiPayload(block.wifiSsid, block.wifiPassword, block.wifiSecurity, block.wifiHidden) : '';
  }
  return String(block.qrText || '');
}

/** Does the QR code carry a logo in the middle? */
export const hasQrLogo = (block) => (block.qrLogo === 'symbol' && Boolean(block.qrLogoSymbol))
  || (block.qrLogo === 'graphic' && Boolean(block.qrLogoGraphic));

/**
 * QR code: dark modules as one region (block.size = edge length in mm, the
 * quiet zone of block.quiet modules around it belongs to the footprint).
 * Round dots keep the three finder patterns solid. A logo (region in any
 * frame, see buildModel) is fitted into a cleared middle; the code then
 * uses error correction H.
 * Returns { region, footprint, modules, module, version, content, level, error }.
 */
export function qrBlock(block, { logo = null } = {}) {
  const content = qrContent(block);
  if (!content) return { region: [], footprint: [], error: block.qrMode === 'wifi' ? 'Netzwerkname (SSID) fehlt.' : 'Kein Inhalt.' };
  const withLogo = Boolean(logo && logo.length);
  const level = withLogo ? 'H' : block.qrLevel;
  let matrix;
  try {
    matrix = qrMatrix(content, level);
  } catch (err) {
    return { region: [], footprint: [], error: err.message };
  }
  const n = matrix.size;
  const m = block.size / n;
  const half = block.size / 2;
  // Cleared middle for the logo: whole modules, centred.
  let k = withLogo ? Math.round(n * block.qrLogoSize) : 0;
  if (k && (n - k) % 2) k += 1;
  const c0 = (n - k) / 2;
  const cleared = (r, c) => k > 0 && r >= c0 && r < c0 + k && c >= c0 && c < c0 + k;
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const dots = block.qrStyle === 'dots';
  const dark = (r, c) => matrix.dark(r, c) && !cleared(r, c) && !(dots && !finder(r, c));
  // Runs of dark modules per row as rectangles.
  const rects = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n;) {
      if (!dark(r, c)) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < n && dark(r, e + 1)) e++;
      const x0 = -half + c * m;
      const x1 = -half + (e + 1) * m;
      const y1 = half - r * m;
      const y0 = half - (r + 1) * m;
      rects.push([x0, y0, x1, y0, x1, y1, x0, y1]);
      c = e + 1;
    }
  }
  // Modules that only touch at a corner get a tiny joint (a closing with
  // round joins; square ones would leave the corners touching), so no
  // outline touches itself: clean meshes. Outer corners stay sharp.
  const eps = Math.min(0.02, m / 40);
  let region = rects.length ? offset(offset(union(rects), eps), -eps) : [];
  if (dots) {
    const circles = [];
    const rd = (m * block.qrDot) / 2;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix.dark(r, c) && !cleared(r, c) && !finder(r, c)) circles.push(circleRing(-half + (c + 0.5) * m, half - (r + 0.5) * m, rd));
      }
    }
    region = union(region, circles);
  }
  if (withLogo) {
    // Fitted into the cleared square, one module of light margin around it.
    const b = regionBounds(logo);
    const room = Math.max(k - 2, 1) * m;
    const s = room / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    // Centre of the cleared square (the code is centred on the origin).
    const mid = -half + (c0 + k / 2) * m;
    region = union(region, transformRegion(logo, [s, 0, 0, s, mid - s * cx, -mid - s * cy]));
  }
  const q = half + Math.max(0, Number(block.quiet) || 0) * m;
  const M = blockMatrix(block);
  return {
    region: transformRegion(region, M),
    footprint: transformRegion(union([[-q, -q, q, -q, q, q, -q, q]]), M),
    modules: n,
    module: m,
    version: matrix.version,
    content,
    level,
  };
}

/**
 * Imported graphic at block.size mm height. Shapes are painted in order:
 * dark ones add, near-white ones cut away (swapped with block.invert).
 * Returns { region, footprint, width, height }.
 */
export function graphicBlock(block, tol = TOLERANCE) {
  const g = block.graphic;
  if (!g || !Array.isArray(g.shapes) || !g.shapes.length) return { region: [], footprint: [], width: 0, height: 0 };
  const k = block.size / (g.h || 100);
  const M = blockMatrix(block, k);
  let region = [];
  let batch = [];
  let batchOp = 0;
  const flush = () => {
    if (!batch.length) return;
    const r = union(...batch);
    if (batchOp > 0) region = region.length ? union(region, r) : r;
    else if (region.length) region = difference(region, r);
    batch = [];
  };
  for (const s of g.shapes) {
    const cmds = pathCommands(s.d);
    const r = s.stroke > 0
      ? strokePaths(flattenPaths(cmds, M, tol), s.stroke * k, tol)
      : fillRings(flattenCommands(cmds, M, tol), s.rule);
    if (!r.length) continue;
    const op = (s.op > 0) !== Boolean(block.invert) ? 1 : -1;
    if (op !== batchOp) flush();
    batchOp = op;
    batch.push(r);
  }
  flush();
  return { region, footprint: region, width: (g.w || 0) * k, height: (g.h || 0) * k };
}
