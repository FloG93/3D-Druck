// PNG raster export (holes as transparent or dark areas on a light plate).

import { addOutlineToPath } from '../ui/renderer.js';

/** opts: { pxPerMm, background: 'white' | 'transparent', holeColor, plateColor } */
export function exportPNG(result, doc, opts = {}) {
  const k = Math.max(1, Math.min(opts.pxPerMm || 8, 40));
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  let pw = Math.round(W * k);
  let ph = Math.round(H * k);
  const maxSide = 12000;
  let scale = k;
  if (Math.max(pw, ph) > maxSide) {
    scale = (k * maxSide) / Math.max(pw, ph);
    pw = Math.round(W * scale);
    ph = Math.round(H * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d');
  if (opts.background !== 'transparent') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pw, ph);
  }
  ctx.setTransform(scale, 0, 0, -scale, pw / 2, ph / 2);
  const plate = new Path2D();
  addOutlineToPath(plate, result.boundary.outline);
  ctx.fillStyle = opts.plateColor || '#d9dde3';
  ctx.fill(plate);
  const holes = new Path2D();
  for (const h of result.holes) addOutlineToPath(holes, h.outline);
  ctx.fillStyle = opts.holeColor || '#111418';
  ctx.fill(holes);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
