// DXF export (AutoCAD R12 / AC1009, ASCII). Only LINE, ARC and CIRCLE
// entities are written, which every CAD, laser and CNC program understands
// (Fusion 360: "Einfügen → DXF einfügen"). Units: millimetres.

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

function fixed(v) {
  let r = Math.round(v * 1e6) / 1e6;
  if (r === 0) r = 0;
  return r.toFixed(6);
}

const deg = (rad) => {
  let d = (rad * 180) / Math.PI;
  d %= 360;
  if (d < 0) d += 360;
  return d;
};

/** Group codes that carry integers (DXF reference, "Group code value types"). */
function isIntegerCode(code) {
  return (code >= 60 && code <= 99) || (code >= 170 && code <= 179) || (code >= 270 && code <= 289)
    || (code >= 370 && code <= 389) || (code >= 400 && code <= 409) || (code >= 1060 && code <= 1071);
}

class DxfWriter {
  constructor() {
    this.out = [];
  }

  g(code, value) {
    let text = String(value);
    if (typeof value === 'number') text = isIntegerCode(code) ? String(Math.round(value)) : fixed(value);
    this.out.push(String(code), text);
  }

  line(layer, x0, y0, x1, y1) {
    this.g(0, 'LINE');
    this.g(8, layer);
    this.g(10, x0);
    this.g(20, y0);
    this.g(30, 0);
    this.g(11, x1);
    this.g(21, y1);
    this.g(31, 0);
  }

  arc(layer, cx, cy, r, a0, a1) {
    this.g(0, 'ARC');
    this.g(8, layer);
    this.g(10, cx);
    this.g(20, cy);
    this.g(30, 0);
    this.g(40, r);
    this.g(50, deg(a0));
    this.g(51, deg(a1));
  }

  circle(layer, cx, cy, r) {
    this.g(0, 'CIRCLE');
    this.g(8, layer);
    this.g(10, cx);
    this.g(20, cy);
    this.g(30, 0);
    this.g(40, r);
  }

  outline(layer, o) {
    if (o.kind === 'circle') {
      this.circle(layer, o.cx, o.cy, o.r);
      return;
    }
    const segs = o.kind === 'ellipse' ? ellipseToArcs(o) : o.segs;
    for (const s of segs) {
      if (s.type === 'line') this.line(layer, s.x0, s.y0, s.x1, s.y1);
      else this.arc(layer, s.cx, s.cy, s.r, s.a0, s.a0 + s.sweep);
    }
  }
}

/** opts: { origin: 'center' | 'corner', includeBoundary } */
export function exportDXF(result, doc, opts = {}) {
  const geo = exportGeometry(result, doc, opts);
  const [minX, minY, maxX, maxY] = outlineBoundsOf([geo.boundaryAlways, ...geo.holes]);
  const w = new DxfWriter();

  w.g(0, 'SECTION');
  w.g(2, 'HEADER');
  w.g(9, '$ACADVER');
  w.g(1, 'AC1009');
  w.g(9, '$INSBASE');
  w.g(10, 0);
  w.g(20, 0);
  w.g(30, 0);
  w.g(9, '$EXTMIN');
  w.g(10, minX);
  w.g(20, minY);
  w.g(30, 0);
  w.g(9, '$EXTMAX');
  w.g(10, maxX);
  w.g(20, maxY);
  w.g(30, 0);
  w.g(9, '$INSUNITS');
  w.g(70, 4);
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'TABLES');
  w.g(0, 'TABLE');
  w.g(2, 'LTYPE');
  w.g(70, 1);
  w.g(0, 'LTYPE');
  w.g(2, 'CONTINUOUS');
  w.g(70, 0);
  w.g(3, 'Solid line');
  w.g(72, 65);
  w.g(73, 0);
  w.g(40, 0);
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE');
  w.g(2, 'LAYER');
  w.g(70, 3);
  for (const [name, color] of [['0', 7], [LAYER_HOLES, 5], [LAYER_BOUNDARY, 1]]) {
    w.g(0, 'LAYER');
    w.g(2, name);
    w.g(70, 0);
    w.g(62, color);
    w.g(6, 'CONTINUOUS');
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'ENTITIES');
  if (geo.boundary) w.outline(LAYER_BOUNDARY, geo.boundary);
  for (const o of geo.holes) w.outline(LAYER_HOLES, o);
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return `${w.out.join('\r\n')}\r\n`;
}
