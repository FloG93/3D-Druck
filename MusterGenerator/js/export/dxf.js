// DXF export (AutoCAD R12 / AC1009, ASCII). Only LINE, ARC and CIRCLE
// entities are written, which every CAD, laser and CNC program understands
// (Fusion 360: "Einfügen → DXF einfügen"). Units: millimetres.

import { dxfFile } from '../../../shared/js/dxf.js';
import { exportGeometry, ellipseToArcs } from './common.js';
import { outlineBounds } from '../core/shapes.js';

const LAYER_HOLES = 'LOECHER';
const LAYER_BOUNDARY = 'BEGRENZUNG';

function outlineBoundsOf(outlines) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const o of outlines) {
    const [x0, y0, x1, y1] = outlineBounds(o);
    b[0] = Math.min(b[0], x0);
    b[1] = Math.min(b[1], y0);
    b[2] = Math.max(b[2], x1);
    b[3] = Math.max(b[3], y1);
  }
  return b;
}

/** A Muster outline (circle, ellipse or line/arc segments) as entities. */
function outline(w, layer, o) {
  if (o.kind === 'circle') {
    w.circle(layer, o.cx, o.cy, o.r);
    return;
  }
  const segs = o.kind === 'ellipse' ? ellipseToArcs(o) : o.segs;
  for (const s of segs) {
    if (s.type === 'line') w.line(layer, s.x0, s.y0, s.x1, s.y1);
    else w.arc(layer, s.cx, s.cy, s.r, s.a0, s.a0 + s.sweep);
  }
}

/** opts: { origin: 'center' | 'corner', includeBoundary } */
export function exportDXF(result, doc, opts = {}) {
  const geo = exportGeometry(result, doc, opts);
  const bounds = outlineBoundsOf([geo.boundaryAlways, ...geo.holes]);
  const layers = [['0', 7], [LAYER_HOLES, 5], [LAYER_BOUNDARY, 1]];
  return dxfFile({ bounds, layers }, (w) => {
    if (geo.boundary) outline(w, LAYER_BOUNDARY, geo.boundary);
    for (const o of geo.holes) outline(w, LAYER_HOLES, o);
  });
}
