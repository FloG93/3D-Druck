// STEP export (ISO 10303-21, AP214 "automotive_design") with exact B-rep
// solids: every hole outline is extruded with planar, cylindrical and
// elliptical (linear extrusion) side faces.
//
//   mode 'tools': one solid per hole ("Werkzeugkörper") for Combine → Cut
//   mode 'plate': the boundary plate with all holes cut out
//
// Topology conventions (outline loops are counter-clockwise seen from +Z):
//   prism side face i:  bottom_i(+), vertical_{i+1}(+), top_i(-), vertical_i(-)
//   hole wall i:        bottom_i(-), vertical_i(+), top_i(+), vertical_{i+1}(-)
// Every edge is used exactly twice with opposite orientation.

import { exportGeometry, timestamp } from './common.js';

function real(v) {
  let r = Math.round(v * 1e9) / 1e9;
  if (r === 0) r = 0;
  let s = r.toFixed(9).replace(/0+$/, '');
  if (s.endsWith('.')) s += '';
  if (!s.includes('.')) s += '.';
  return s;
}

const str = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_')}'`;

class StepWriter {
  constructor() {
    this.lines = [];
    this.n = 0;
    this.dirs = new Map();
  }

  add(s) {
    this.n += 1;
    this.lines.push(`#${this.n}=${s};`);
    return `#${this.n}`;
  }

  pt(x, y, z) {
    return this.add(`CARTESIAN_POINT('',(${real(x)},${real(y)},${real(z)}))`);
  }

  dir(x, y, z) {
    const key = `${real(x)},${real(y)},${real(z)}`;
    let id = this.dirs.get(key);
    if (!id) {
      id = this.add(`DIRECTION('',(${key}))`);
      this.dirs.set(key, id);
    }
    return id;
  }

  axis(x, y, z, zdir, xdir) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.pt(x, y, z)},${this.dir(...zdir)},${this.dir(...xdir)})`);
  }

  vertex(x, y, z) {
    return this.add(`VERTEX_POINT('',${this.pt(x, y, z)})`);
  }

  oe(edge, sense) {
    return this.add(`ORIENTED_EDGE('',*,*,${edge},${sense ? '.T.' : '.F.'})`);
  }

  loop(oes) {
    return this.add(`EDGE_LOOP('',(${oes.join(',')}))`);
  }

  face(outer, inners, surface, sameSense = true) {
    const bounds = [this.add(`FACE_OUTER_BOUND('',${outer},.T.)`)];
    for (const l of inners) bounds.push(this.add(`FACE_BOUND('',${l},.T.)`));
    return this.add(`ADVANCED_FACE('',(${bounds.join(',')}),${surface},${sameSense ? '.T.' : '.F.'})`);
  }
}

/** Converts an outline into closed loop segments (full curves split in halves). */
export function loopSegments(o) {
  if (o.kind === 'circle') {
    const a = { type: 'arc', cx: o.cx, cy: o.cy, r: o.r, a0: 0, sweep: Math.PI, x0: o.cx + o.r, y0: o.cy, x1: o.cx - o.r, y1: o.cy };
    const b = { type: 'arc', cx: o.cx, cy: o.cy, r: o.r, a0: Math.PI, sweep: Math.PI, x0: o.cx - o.r, y0: o.cy, x1: o.cx + o.r, y1: o.cy };
    return [a, b];
  }
  if (o.kind === 'ellipse') {
    const c = Math.cos(o.rot);
    const s = Math.sin(o.rot);
    const p0 = [o.cx + o.rx * c, o.cy + o.rx * s];
    const p1 = [o.cx - o.rx * c, o.cy - o.rx * s];
    const base = { type: 'ellipse', cx: o.cx, cy: o.cy, rx: o.rx, ry: o.ry, rot: o.rot };
    return [
      { ...base, x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1] },
      { ...base, x0: p1[0], y0: p1[1], x1: p0[0], y1: p0[1] },
    ];
  }
  return o.segs;
}

function curve(w, s, z) {
  if (s.type === 'line') {
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const len = Math.hypot(dx, dy);
    return w.add(`LINE('',${w.pt(s.x0, s.y0, z)},${w.add(`VECTOR('',${w.dir(dx / len, dy / len, 0)},${real(len)})`)})`);
  }
  if (s.type === 'arc') {
    return w.add(`CIRCLE('',${w.axis(s.cx, s.cy, z, [0, 0, 1], [1, 0, 0])},${real(s.r)})`);
  }
  return w.add(`ELLIPSE('',${w.axis(s.cx, s.cy, z, [0, 0, 1], [Math.cos(s.rot), Math.sin(s.rot), 0])},${real(s.rx)},${real(s.ry)})`);
}

function sideSurface(w, s, z0, height, hole) {
  if (s.type === 'line') {
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // Outward normal of a CCW loop is (uy, -ux); hole walls face the other way.
    const n = hole ? [-uy, ux, 0] : [uy, -ux, 0];
    return { surface: w.add(`PLANE('',${w.axis(s.x0, s.y0, z0, n, [ux, uy, 0])})`), sameSense: true };
  }
  if (s.type === 'arc') {
    const surface = w.add(`CYLINDRICAL_SURFACE('',${w.axis(s.cx, s.cy, z0, [0, 0, 1], [1, 0, 0])},${real(s.r)})`);
    return { surface, sameSense: !hole };
  }
  const ell = curve(w, s, z0);
  const surface = w.add(`SURFACE_OF_LINEAR_EXTRUSION('',${ell},${w.add(`VECTOR('',${w.dir(0, 0, 1)},${real(height)})`)})`);
  return { surface, sameSense: !hole };
}

/** Vertices and edges of an outline extruded from z0 to z1. */
function extrudeLoop(w, segs, z0, z1) {
  const n = segs.length;
  const vb = segs.map((s) => w.vertex(s.x0, s.y0, z0));
  const vt = segs.map((s) => w.vertex(s.x0, s.y0, z1));
  const eb = [];
  const et = [];
  const ev = [];
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    const j = (i + 1) % n;
    eb.push(w.add(`EDGE_CURVE('',${vb[i]},${vb[j]},${curve(w, s, z0)},.T.)`));
    et.push(w.add(`EDGE_CURVE('',${vt[i]},${vt[j]},${curve(w, s, z1)},.T.)`));
    const line = w.add(`LINE('',${w.pt(s.x0, s.y0, z0)},${w.add(`VECTOR('',${w.dir(0, 0, 1)},${real(z1 - z0)})`)})`);
    ev.push(w.add(`EDGE_CURVE('',${vb[i]},${vt[i]},${line},.T.)`));
  }
  return { n, eb, et, ev };
}

function prismSideFaces(w, segs, topo, z0, z1) {
  const faces = [];
  for (let i = 0; i < topo.n; i++) {
    const j = (i + 1) % topo.n;
    const loop = w.loop([w.oe(topo.eb[i], true), w.oe(topo.ev[j], true), w.oe(topo.et[i], false), w.oe(topo.ev[i], false)]);
    const { surface, sameSense } = sideSurface(w, segs[i], z0, z1 - z0, false);
    faces.push(w.face(loop, [], surface, sameSense));
  }
  return faces;
}

function holeWallFaces(w, segs, topo, z0, z1) {
  const faces = [];
  for (let i = 0; i < topo.n; i++) {
    const j = (i + 1) % topo.n;
    const loop = w.loop([w.oe(topo.eb[i], false), w.oe(topo.ev[i], true), w.oe(topo.et[i], true), w.oe(topo.ev[j], false)]);
    const { surface, sameSense } = sideSurface(w, segs[i], z0, z1 - z0, true);
    faces.push(w.face(loop, [], surface, sameSense));
  }
  return faces;
}

const forward = (w, edges) => edges.map((e) => w.oe(e, true));
const backward = (w, edges) => [...edges].reverse().map((e) => w.oe(e, false));

function solid(w, name, faces) {
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(name)},${shell})`);
}

function toolSolid(w, o, z0, z1, name) {
  const segs = loopSegments(o);
  const topo = extrudeLoop(w, segs, z0, z1);
  const faces = prismSideFaces(w, segs, topo, z0, z1);
  faces.push(w.face(w.loop(forward(w, topo.et)), [], w.add(`PLANE('',${w.axis(0, 0, z1, [0, 0, 1], [1, 0, 0])})`)));
  faces.push(w.face(w.loop(backward(w, topo.eb)), [], w.add(`PLANE('',${w.axis(0, 0, z0, [0, 0, -1], [1, 0, 0])})`)));
  return solid(w, name, faces);
}

function plateSolid(w, boundary, holes, z0, z1, name) {
  const bSegs = loopSegments(boundary);
  const bTopo = extrudeLoop(w, bSegs, z0, z1);
  const faces = prismSideFaces(w, bSegs, bTopo, z0, z1);
  const topInner = [];
  const bottomInner = [];
  for (const o of holes) {
    const segs = loopSegments(o);
    const topo = extrudeLoop(w, segs, z0, z1);
    faces.push(...holeWallFaces(w, segs, topo, z0, z1));
    topInner.push(w.loop(backward(w, topo.et)));
    bottomInner.push(w.loop(forward(w, topo.eb)));
  }
  faces.push(w.face(w.loop(forward(w, bTopo.et)), topInner, w.add(`PLANE('',${w.axis(0, 0, z1, [0, 0, 1], [1, 0, 0])})`)));
  faces.push(w.face(w.loop(backward(w, bTopo.eb)), bottomInner, w.add(`PLANE('',${w.axis(0, 0, z0, [0, 0, -1], [1, 0, 0])})`)));
  return solid(w, name, faces);
}

/**
 * opts: { mode: 'tools' | 'plate', thickness, zPlacement: 'center' | 'bottom' | 'top', origin, name }
 */
export function exportSTEP(result, doc, opts = {}) {
  const mode = opts.mode === 'plate' ? 'plate' : 'tools';
  const t = Math.max(opts.thickness || 2, 0.001);
  const geo = exportGeometry(result, doc, { origin: opts.origin, includeBoundary: true });
  let z0 = 0;
  if (mode === 'tools') {
    if (opts.zPlacement === 'center') z0 = -t / 2;
    else if (opts.zPlacement === 'top') z0 = -t;
  }
  const z1 = z0 + t;
  const name = (opts.name || 'Muster').replace(/[^\x20-\x7e]/g, '_');

  const w = new StepWriter();
  const appContext = w.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appContext})`);
  const productContext = w.add(`PRODUCT_CONTEXT('',${appContext},'mechanical')`);
  const product = w.add(`PRODUCT(${str(name)},${str(name)},'',(${productContext}))`);
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const formation = w.add(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const pdContext = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appContext},'design')`);
  const pd = w.add(`PRODUCT_DEFINITION('design','',${formation},${pdContext})`);
  const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const mm = w.add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  const rad = w.add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const sr = w.add('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = w.add(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);
  const origin = w.axis(0, 0, 0, [0, 0, 1], [1, 0, 0]);

  const items = [origin];
  if (mode === 'plate') {
    items.push(plateSolid(w, geo.boundaryAlways, geo.holes, z0, z1, name));
  } else {
    geo.holes.forEach((o, i) => items.push(toolSolid(w, o, z0, z1, `Loch ${i + 1}`)));
  }
  const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(name)},(${items.join(',')}),${ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Muster-Generator ${mode === 'plate' ? 'Lochplatte' : 'Werkzeugkoerper'}'),'2;1');`,
    `FILE_NAME(${str(`${name}.step`)},'${timestamp()}',(''),(''),'Muster-Generator','Muster-Generator','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
  ];
  return `${header.join('\n')}\n${w.lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
