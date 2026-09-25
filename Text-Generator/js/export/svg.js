// SVG export at 1:1, y axis flipped for SVG. Outlines are smooth curves
// (lines and cubic Béziers within 0.01 mm) instead of polygons.
//
// style 'color':   top view in the part colours (documentation, preview)
// style 'outline': cut lines only (laser, plotter, Fusion "SVG einfügen");
//                  a stencil gives one path with all its cut lines
// style 'text':    the lettering alone (QR codes and graphics included) –
//                  for a sketch on a face of one's own part in Fusion
// A cup gives its wall unrolled, a conical one as a ring sector.
//
// Units: width and height in mm, the drawing in px at 96 dpi. Programs that
// honour the units (browsers, Inkscape, laser software) get millimetres from
// the viewBox; Fusion 360 ignores them and reads 96 px per inch – both end
// up at the same size.

import { developedModel } from '../core/cup.js';
import { fitRing } from '../core/curves.js';
import { regionBounds } from '../core/geometry.js';

export const PX_PER_MM = 96 / 25.4;

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function num(v, digits = 3) {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return String(r === 0 ? 0 : r);
}

/** SVG path data of a region as polygons (all rings, fill-rule evenodd). */
export function regionPathData(region, X, Y, digits = 3) {
  let d = '';
  const ring = (r) => {
    d += `M${num(X(r[0]), digits)} ${num(Y(r[1]), digits)}`;
    for (let i = 2; i < r.length; i += 2) d += `L${num(X(r[i]), digits)} ${num(Y(r[i + 1]), digits)}`;
    d += 'Z';
  };
  for (const s of region) {
    ring(s.outer);
    for (const h of s.holes) ring(h);
  }
  return d;
}

/** SVG path data of a region with smooth curves (fill-rule evenodd). */
export function regionCurveData(region, X, Y, digits = 3) {
  let d = '';
  const P = (p) => `${num(X(p[0]), digits)} ${num(Y(p[1]), digits)}`;
  const ring = (r) => {
    const segs = fitRing(r);
    if (!segs.length) return;
    d += `M${P(segs[0].p[0])}`;
    for (const s of segs) d += s.type === 'line' ? `L${P(s.p[1])}` : `C${P(s.p[1])} ${P(s.p[2])} ${P(s.p[3])}`;
    d += 'Z';
  };
  for (const s of region) {
    ring(s.outer);
    for (const h of s.holes) ring(h);
  }
  return d;
}

export function exportSVG(input, { style = 'color', margin = 2, title = '' } = {}) {
  const model = developedModel(input);
  // Only the lettering: the drawing fits around it.
  const b = style === 'text' && model.text.length ? regionBounds(model.text) : model.bounds;
  const valid = Number.isFinite(b.minX);
  const x0 = valid ? b.minX - margin : -10;
  const y1 = valid ? b.maxY + margin : 10;
  const W = valid ? b.maxX - b.minX + 2 * margin : 20;
  const H = valid ? b.maxY - b.minY + 2 * margin : 20;
  const k = PX_PER_MM;
  const X = (x) => (x - x0) * k;
  const Y = (y) => (y1 - y) * k;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W, 3)}mm" height="${num(H, 3)}mm" viewBox="0 0 ${num(W * k, 3)} ${num(H * k, 3)}">`,
    `  <title>${esc(title || model.doc.name || 'Text')}</title>`,
    '  <desc>Erzeugt mit dem Text-Generator (3D-Druck-Werkzeuge). Maßstab 1:1 – Breite und Höhe in mm, gezeichnet in px mit 96 dpi (so liest auch Fusion 360 die Größe richtig).</desc>',
  ];
  const { colors } = model.doc;
  const layer = (id, region, attrs) => {
    if (!region.length) return;
    lines.push(`  <path id="${id}" ${attrs} fill-rule="evenodd" d="${regionCurveData(region, X, Y)}"/>`);
  };
  const stroke = `fill="none" stroke="#000000" stroke-width="${num(0.1 * k, 3)}"`;
  if (style === 'text') {
    layer('schrift', model.text, stroke);
  } else if (style === 'outline') {
    if (model.relief === 'cut') {
      layer('schnitt', model.plate, stroke);
    } else {
      layer('platte', model.base, stroke);
      layer('rand', model.border, stroke);
      layer('kontur', model.outline, stroke);
      layer('schrift', model.text, stroke);
    }
  } else {
    layer('platte', model.plate, `fill="${esc(colors.base)}" stroke="#00000040" stroke-width="${num(0.15 * k, 3)}"`);
    layer('rand', model.border, `fill="${esc(colors.border)}"`);
    layer('kontur', model.outline, `fill="${esc(colors.outline)}"`);
    if (model.relief === 'engraved') layer('schrift', model.text, 'fill="#00000038"');
    else if (model.relief !== 'cut') {
      model.textGroups.forEach((g, i) => layer(i ? `schrift-${i + 1}` : 'schrift', g.region, `fill="${esc(g.color)}"`));
    }
  }
  lines.push('</svg>', '');
  return lines.join('\n');
}
