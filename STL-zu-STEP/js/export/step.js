// Writing the B-rep as STEP (ISO 10303-21, AP214), with the conventions of
// MusterGenerator/js/export/step.js: one VERTEX_POINT per corner, every edge
// exactly twice with opposite orientation, full circles split into halves.
// The writer itself comes from shared/js/step.js.

import { real, str, StepWriter } from '../../../shared/js/step.js';
import { loopVertices } from '../core/brep.js';
import { cross, dot, normalize, sub, norm } from '../core/linalg.js';

function timestamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** A name without the characters STEP would have to escape. */
const plain = (s) => String(s).replace(/[^\x20-\x7e]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }[c] ?? '_'));

/**
 * writeStep(brep, opts?) → string
 * opts: { name, fileName, open (shells are not closed), scale, description }
 * `scale` converts the unit of the file into millimetres (inches: 25.4).
 */
export function writeStep(brep, opts = {}) {
  const name = plain(opts.name || 'Koerper');
  const scale = opts.scale ?? 1;
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
  const items = [w.axis(0, 0, 0, [0, 0, 1], [1, 0, 0])];

  // One VERTEX_POINT per corner – shared by every edge that ends there.
  const point = (p) => [p[0] * scale, p[1] * scale, p[2] * scale];
  const vertices = brep.points.map((p) => w.vertex(...point(p)));

  // One EDGE_CURVE per edge, referenced twice as ORIENTED_EDGE.
  const edges = brep.edges.map((e) => {
    const p0 = point(brep.points[e.v0]);
    const p1 = point(brep.points[e.v1]);
    let curve;
    if (e.curve.type === 'circle') {
      const center = point(e.curve.center);
      const axis = normalize(e.curve.axis);
      const ref = normalize(e.curve.ref ?? sub(p0, center));
      curve = w.add(`CIRCLE('',${w.axis(center[0], center[1], center[2], axis, ref)},${real(e.curve.radius * scale)})`);
    } else {
      const d = sub(p1, p0);
      const len = norm(d);
      const dir = len > 0 ? [d[0] / len, d[1] / len, d[2] / len] : [1, 0, 0];
      curve = w.add(`LINE('',${w.pt(p0[0], p0[1], p0[2])},${w.add(`VECTOR('',${w.dir(...dir)},${real(len || 1)})`)})`);
    }
    return w.add(`EDGE_CURVE('',${vertices[e.v0]},${vertices[e.v1]},${curve},.T.)`);
  });

  const faceIds = brep.faces.map((face) => {
    const loops = face.loops.map((loop) => w.loop(loop.map((use) => w.oe(edges[use.edge], use.sense))));
    const surface = face.surface.type === 'cylinder'
      ? cylindricalSurface(w, face.surface, scale)
      : planeSurface(w, face.surface, brep, face, scale);
    return w.face(loops[0], loops.slice(1), surface, face.sameSense);
  });

  for (const solid of brep.solids) {
    const faces = solid.faces.map((i) => faceIds[i]);
    if (opts.open) {
      const shell = w.add(`OPEN_SHELL('',(${faces.join(',')}))`);
      items.push(w.add(`SHELL_BASED_SURFACE_MODEL(${str(plain(solid.name))},(${shell}))`));
    } else {
      const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
      items.push(w.add(`MANIFOLD_SOLID_BREP(${str(plain(solid.name))},${shell})`));
    }
  }

  const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(name)},(${items.join(',')}),${ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${plain(opts.description || 'STL-zu-STEP')}'),'2;1');`,
    `FILE_NAME(${str(`${plain(opts.fileName || name)}.step`)},'${timestamp()}',(''),(''),'STL-zu-STEP','STL-zu-STEP','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
  ];
  return `${header.join('\n')}\n${w.lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

function planeSurface(w, surface, brep, face, scale) {
  const n = normalize(surface.normal);
  const p = surface.point.map((v) => v * scale);
  let ref = surface.ref ? normalize(surface.ref) : null;
  if (!ref || Math.abs(dot(ref, n)) > 1e-6) {
    const first = loopVertices(brep, face.loops[0]);
    const a = brep.points[first[0]];
    const b = brep.points[first[1 % first.length]];
    const d = sub(b, a);
    const along = dot(d, n);
    ref = normalize([d[0] - along * n[0], d[1] - along * n[1], d[2] - along * n[2]]);
  }
  if (norm(ref) < 0.5) ref = normalize(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  return w.add(`PLANE('',${w.axis(p[0], p[1], p[2], n, ref)})`);
}

function cylindricalSurface(w, surface, scale) {
  const axis = normalize(surface.axis);
  const p = surface.point.map((v) => v * scale);
  let ref = surface.ref ? normalize(surface.ref) : normalize(cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const along = dot(ref, axis);
  ref = normalize([ref[0] - along * axis[0], ref[1] - along * axis[1], ref[2] - along * axis[2]]);
  return w.add(`CYLINDRICAL_SURFACE('',${w.axis(p[0], p[1], p[2], axis, ref)},${real(surface.radius * scale)})`);
}
