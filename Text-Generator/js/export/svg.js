// SVG export in millimetres (1 user unit = 1 mm), y axis flipped for SVG.
//
// style 'color':   top view in the part colours (documentation, preview)
// style 'outline': cut lines only (laser, plotter, Fusion "SVG einfügen")

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function num(v, digits = 3) {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return String(r === 0 ? 0 : r);
}

/** SVG path data of a region (all rings, use fill-rule evenodd). */
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

export function exportSVG(model, { style = 'color', margin = 2, title = '' } = {}) {
  const b = model.bounds;
  const valid = Number.isFinite(b.minX);
  const x0 = valid ? b.minX - margin : -10;
  const y1 = valid ? b.maxY + margin : 10;
  const W = valid ? b.maxX - b.minX + 2 * margin : 20;
  const H = valid ? b.maxY - b.minY + 2 * margin : 20;
  const X = (x) => x - x0;
  const Y = (y) => y1 - y;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W, 2)}mm" height="${num(H, 2)}mm" viewBox="0 0 ${num(W, 3)} ${num(H, 3)}">`,
    `  <title>${esc(title || model.doc.name || 'Text')}</title>`,
    '  <desc>Erzeugt mit dem Text-Generator (3D-Druck-Werkzeuge). Einheit: mm (1 SVG-Einheit = 1 mm).</desc>',
  ];
  const { colors } = model.doc;
  const layer = (id, region, attrs) => {
    if (!region.length) return;
    lines.push(`  <path id="${id}" ${attrs} fill-rule="evenodd" d="${regionPathData(region, X, Y)}"/>`);
  };
  if (style === 'outline') {
    const stroke = 'fill="none" stroke="#000000" stroke-width="0.1"';
    layer('platte', model.base, stroke);
    layer('rand', model.border, stroke);
    layer('schrift', model.text, stroke);
  } else {
    layer('platte', model.plate, `fill="${esc(colors.base)}" stroke="#00000040" stroke-width="0.15"`);
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
