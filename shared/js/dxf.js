// Minimal DXF writer (AutoCAD R12 / AC1009, ASCII) shared by the tools.
// R12 is what every CAD, laser, plotter and CNC program reads (Fusion 360:
// "Einfügen → DXF einfügen"). Units: millimetres.

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

export class DxfWriter {
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

  /** Arc counter-clockwise from angle a0 to a1 (radians). */
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

  /** Polyline through a flat ring [x0, y0, x1, y1, …], closed by default. */
  polyline(layer, ring, closed = true) {
    this.g(0, 'POLYLINE');
    this.g(8, layer);
    this.g(66, 1);
    this.g(10, 0);
    this.g(20, 0);
    this.g(30, 0);
    this.g(70, closed ? 1 : 0);
    for (let i = 0; i < ring.length; i += 2) {
      this.g(0, 'VERTEX');
      this.g(8, layer);
      this.g(10, ring[i]);
      this.g(20, ring[i + 1]);
      this.g(30, 0);
    }
    this.g(0, 'SEQEND');
    this.g(8, layer);
  }

  toString() {
    return `${this.out.join('\r\n')}\r\n`;
  }
}

/**
 * A complete DXF file: header with the drawing extents, line type and layer
 * tables, and the entities that draw(writer) adds.
 * bounds: [minX, minY, maxX, maxY]; layers: [[name, ACI colour]].
 */
export function dxfFile({ bounds: [minX, minY, maxX, maxY], layers }, draw) {
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
  w.g(70, layers.length);
  for (const [name, color] of layers) {
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
  draw(w);
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return w.toString();
}
