// SVG export in millimetres (width/height in mm, 1 user unit = 1 mm).
// No transforms are used, so CAD importers (Fusion 360 "SVG einfügen")
// read the coordinates directly.

import { exportGeometry, num } from './common.js';

function pathData(o, X, Y) {
  if (o.kind === 'ellipse') {
    const c = Math.cos(o.rot);
    const s = Math.sin(o.rot);
    const p0 = [o.cx + o.rx * c, o.cy + o.rx * s];
    const p1 = [o.cx - o.rx * c, o.cy - o.rx * s];
    const rot = num((-o.rot * 180) / Math.PI, 4);
    const arc = (p) => `A${num(o.rx)} ${num(o.ry)} ${rot} 0 0 ${num(X(p[0]))} ${num(Y(p[1]))}`;
    return `M${num(X(p0[0]))} ${num(Y(p0[1]))}${arc(p1)}${arc(p0)}Z`;
  }
  if (o.kind === 'circle') {
    // Two half circles as a path (used for compound paths).
    const a = [o.cx + o.r, o.cy];
    const b = [o.cx - o.r, o.cy];
    const arc = (p) => `A${num(o.r)} ${num(o.r)} 0 0 0 ${num(X(p[0]))} ${num(Y(p[1]))}`;
    return `M${num(X(a[0]))} ${num(Y(a[1]))}${arc(b)}${arc(a)}Z`;
  }
  let d = `M${num(X(o.segs[0].x0))} ${num(Y(o.segs[0].y0))}`;
  for (const sg of o.segs) {
    if (sg.type === 'line') {
      d += `L${num(X(sg.x1))} ${num(Y(sg.y1))}`;
    } else {
      // Counter-clockwise in CAD coordinates = sweep flag 0 in SVG (y down).
      const large = sg.sweep > Math.PI + 1e-9 ? 1 : 0;
      d += `A${num(sg.r)} ${num(sg.r)} 0 ${large} 0 ${num(X(sg.x1))} ${num(Y(sg.y1))}`;
    }
  }
  return `${d}Z`;
}

function element(o, X, Y) {
  if (o.kind === 'circle') return `<circle cx="${num(X(o.cx))}" cy="${num(Y(o.cy))}" r="${num(o.r)}"/>`;
  return `<path d="${pathData(o, X, Y)}"/>`;
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * opts: { style: 'fill' | 'stroke' | 'plate', includeBoundary, color }
 */
export function exportSVG(result, doc, opts = {}) {
  const W = doc.canvas.width;
  const H = doc.canvas.height;
  // Outlines are exported relative to the canvas centre; SVG has y down
  // and its origin in the top left corner.
  const geo = exportGeometry(result, doc, { origin: 'center', includeBoundary: opts.includeBoundary });
  const X = (x) => x + W / 2;
  const Y = (y) => H / 2 - y;
  const style = opts.style || 'fill';
  const color = opts.color || '#000000';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}">`,
    `  <title>${esc(doc.name || 'Muster')} – ${result.holes.length} Löcher</title>`,
    '  <desc>Erzeugt mit dem Muster-Generator. Einheit: mm (1 SVG-Einheit = 1 mm).</desc>',
  ];
  if (style === 'plate') {
    const parts = [pathData(geo.boundaryAlways, X, Y), ...geo.holes.map((o) => pathData(o, X, Y))];
    lines.push(`  <path id="platte" fill="${esc(color)}" fill-rule="evenodd" d="${parts.join('')}"/>`);
  } else {
    const holeAttrs = style === 'stroke'
      ? `fill="none" stroke="${esc(color)}" stroke-width="0.1"`
      : `fill="${esc(color)}"`;
    if (geo.boundary) {
      lines.push(`  <g id="begrenzung" fill="none" stroke="${esc(color)}" stroke-width="${style === 'stroke' ? '0.1' : '0.25'}">`);
      lines.push(`    ${element(geo.boundary, X, Y)}`);
      lines.push('  </g>');
    }
    lines.push(`  <g id="loecher" ${holeAttrs}>`);
    for (const o of geo.holes) lines.push(`    ${element(o, X, Y)}`);
    lines.push('  </g>');
  }
  lines.push('</svg>', '');
  return lines.join('\n');
}
