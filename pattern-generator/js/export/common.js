// Helpers shared by the exporters.

/** Translates an outline by (dx, dy), returning a new outline. */
export function translateOutline(o, dx, dy) {
  if (!dx && !dy) return o;
  if (o.kind === 'circle' || o.kind === 'ellipse') return { ...o, cx: o.cx + dx, cy: o.cy + dy };
  return {
    kind: 'path',
    segs: o.segs.map((s) => (s.type === 'line'
      ? { ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy }
      : { ...s, cx: s.cx + dx, cy: s.cy + dy, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy })),
  };
}

/** Offset applied for the chosen origin ('center' or 'corner' = bottom left). */
export function originOffset(doc, origin) {
  return origin === 'corner' ? [doc.canvas.width / 2, doc.canvas.height / 2] : [0, 0];
}

/** Hole and boundary outlines in export coordinates. */
export function exportGeometry(result, doc, opts = {}) {
  const [dx, dy] = originOffset(doc, opts.origin);
  return {
    holes: result.holes.map((h) => translateOutline(h.outline, dx, dy)),
    boundary: opts.includeBoundary === false ? null : translateOutline(result.boundary.outline, dx, dy),
    boundaryAlways: translateOutline(result.boundary.outline, dx, dy),
    offset: [dx, dy],
  };
}

/** Number formatting without exponent notation and without "-0". */
export function num(v, decimals = 4) {
  const f = 10 ** decimals;
  let r = Math.round(v * f) / f;
  if (Object.is(r, -0) || r === 0) r = 0;
  const str = r.toFixed(decimals);
  return str.includes('.') ? str.replace(/\.?0+$/, '') : str;
}

/**
 * Splits an ellipse outline into circular arcs (through three points each).
 * Used where true ellipses are not available (DXF R12).
 */
export function ellipseToArcs(o, count = 24) {
  const n = count * 2;
  const pts = [];
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  for (let k = 0; k <= n; k++) {
    const t = (2 * Math.PI * k) / n;
    const lx = o.rx * Math.cos(t);
    const ly = o.ry * Math.sin(t);
    pts.push([o.cx + lx * c - ly * s, o.cy + lx * s + ly * c]);
  }
  pts[n] = pts[0];
  const arcs = [];
  for (let k = 0; k < count; k++) {
    const [ax, ay] = pts[2 * k];
    const [bx, by] = pts[2 * k + 1];
    const [ex, ey] = pts[2 * k + 2];
    const d = 2 * (ax * (by - ey) + bx * (ey - ay) + ex * (ay - by));
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const e2 = ex * ex + ey * ey;
    const cx = (a2 * (by - ey) + b2 * (ey - ay) + e2 * (ay - by)) / d;
    const cy = (a2 * (ex - bx) + b2 * (ax - ex) + e2 * (bx - ax)) / d;
    const r = Math.hypot(ax - cx, ay - cy);
    const a0 = Math.atan2(ay - cy, ax - cx);
    let sweep = Math.atan2(ey - cy, ex - cx) - a0;
    while (sweep <= 0) sweep += 2 * Math.PI;
    arcs.push({ type: 'arc', cx, cy, r, a0, sweep, x0: ax, y0: ay, x1: ex, y1: ey });
  }
  return arcs;
}

export function timestamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
