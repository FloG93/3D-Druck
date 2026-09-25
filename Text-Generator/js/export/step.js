// STEP export (ISO 10303-21, AP214) for Fusion 360 and other CAD programs:
// every part of the sign (plate, lettering, border, contour, back, pieces
// of a stencil, the handle of a stamp) is a component of its own with a
// solid body in its colour. The outlines are exact curves – lines and cubic
// B-splines fitted to the polygons within 0.01 mm – so a letter has a few
// smooth side faces instead of hundreds of facets.
//
// A flat solid (see mesh.js) is cut into slabs where its cross-section
// changes (pockets from the top or bottom, the steps of a stamp): every
// outline runs up as one wall as long as it lasts, the horizontal faces
// between slabs are what one slab has and the next one has not.
// Topology conventions: outlines keep the material on their left (outer
// rings counter-clockwise, holes clockwise, seen from +Z); a wall face is
//   bottom_i(+), vertical_{i+1}(+), top_i(-), vertical_i(-)
// and every edge is used exactly twice with opposite orientation.
// Cups (bent walls) have no exact body here.

import { StepWriter, real, str } from '../../../shared/js/step.js';
import { union, difference, ringArea, containsPoint } from '../core/geometry.js';
import { fitRing, reverseSegments } from '../core/curves.js';

const EPS = 1e-9;

/** A ring as its points, starting at the lowest-left one, counter-clockwise. */
function canonical(r) {
  const n = r.length / 2;
  let m = 0;
  for (let i = 1; i < n; i++) {
    if (r[2 * i] < r[2 * m] || (r[2 * i] === r[2 * m] && r[2 * i + 1] < r[2 * m + 1])) m = i;
  }
  const ccw = ringArea(r) > 0;
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = ccw ? (m + k) % n : (m - k + n) % n;
    out.push(r[2 * i], r[2 * i + 1]);
  }
  return { key: out.join(','), ring: out, ccw };
}

/** Slabs of constant cross-section: [{ z0, z1, region }] from bottom to top. */
function slabsOf(s) {
  const steps = s.steps || (s.step ? [s.step] : []);
  const pockets = s.pockets && s.pockets.length && s.depth > 0 ? s.pockets : null;
  const bottom = (s.bottom || []).filter((b) => b.region.length && b.depth > 0);
  const levels = [s.z0, s.z1, ...steps.map((st) => st.z), ...(pockets ? [s.z1 - s.depth] : []), ...bottom.map((b) => s.z0 + b.depth)];
  const zs = [...new Set(levels.filter((z) => z >= s.z0 - EPS && z <= s.z1 + EPS))].sort((a, b) => a - b)
    .filter((z, i, all) => i === 0 || z - all[i - 1] > 1e-7);
  const slabs = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const zm = (zs[i] + zs[i + 1]) / 2;
    let region = s.region;
    for (const st of steps) if (zm > st.z) region = st.region;
    const cut = [];
    if (pockets && zm > s.z1 - s.depth) cut.push(...pockets);
    for (const b of bottom) if (zm < s.z0 + b.depth) cut.push(...b.region);
    slabs.push({ z0: zs[i], z1: zs[i + 1], region: cut.length ? difference(region, cut) : union(region) });
  }
  return slabs;
}

class BrepWriter extends StepWriter {
  line(p, q) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const l = Math.hypot(dx, dy, dz);
    return this.add(`LINE('',${this.pt(...p)},${this.add(`VECTOR('',${this.dir(dx / l, dy / l, dz / l)},${real(l)})`)})`);
  }

  /** Curve of a fitted segment at height z. */
  segCurve(seg, z) {
    const [p, ...rest] = seg.p;
    if (seg.type === 'line') return this.line([p[0], p[1], z], [rest[0][0], rest[0][1], z]);
    const pts = seg.p.map((c) => this.pt(c[0], c[1], z));
    return this.add(`B_SPLINE_CURVE_WITH_KNOTS('',3,(${pts.join(',')}),.UNSPECIFIED.,.F.,.F.,(4,4),(0.,1.),.UNSPECIFIED.)`);
  }

  edge(v0, v1, curve) {
    return this.add(`EDGE_CURVE('',${v0},${v1},${curve},.T.)`);
  }

  plane(z, up) {
    return this.add(`PLANE('',${this.axis(0, 0, z, [0, 0, up ? 1 : -1], [1, 0, 0])})`);
  }
}

/**
 * Edges of one outline at height z, in its direction: vertices at the
 * segment ends, one edge per segment.
 */
function ringEdges(w, segs, z) {
  const vertices = segs.map((s) => w.vertex(s.p[0][0], s.p[0][1], z));
  const edges = segs.map((s, i) => w.edge(vertices[i], vertices[(i + 1) % segs.length], w.segCurve(s, z)));
  return { vertices, edges };
}

/** The side faces of an outline from z0 to z1 (material on its left). */
function wallFaces(w, segs, bottom, top, z0, z1) {
  const n = segs.length;
  const verticals = segs.map((s, i) => w.edge(bottom.vertices[i], top.vertices[i], w.line([s.p[0][0], s.p[0][1], z0], [s.p[0][0], s.p[0][1], z1])));
  const faces = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const loop = w.loop([w.oe(bottom.edges[i], true), w.oe(verticals[j], true), w.oe(top.edges[i], false), w.oe(verticals[i], false)]);
    const s = segs[i];
    let surface;
    if (s.type === 'line') {
      const [p, q] = s.p;
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const ux = (q[0] - p[0]) / l;
      const uy = (q[1] - p[1]) / l;
      surface = w.add(`PLANE('',${w.axis(p[0], p[1], z0, [uy, -ux, 0], [ux, uy, 0])})`);
    } else {
      surface = w.add(`SURFACE_OF_LINEAR_EXTRUSION('',${w.segCurve(s, z0)},${w.add(`VECTOR('',${w.dir(0, 0, 1)},${real(z1 - z0)})`)})`);
    }
    faces.push(w.face(loop, [], surface, true));
  }
  return faces;
}

/** A loop of stored edges; forward keeps their direction. */
function edgeLoop(w, edges, forward) {
  return forward ? w.loop(edges.map((e) => w.oe(e, true))) : w.loop([...edges].reverse().map((e) => w.oe(e, false)));
}

/**
 * Countersunk (or plain) round hole through the solid: a cylinder up to
 * the cone, the cone up to the top. Returns the wall faces and the loops
 * for the bottom and the top face.
 */
function roundHole(w, c, z0, z1) {
  const cone = c.depth > EPS && c.R > c.r + EPS;
  const zc = cone ? z1 - c.depth : z1;
  const circle = (r, z) => {
    const a = w.vertex(c.cx + r, c.cy, z);
    const b = w.vertex(c.cx - r, c.cy, z);
    const curve = w.add(`CIRCLE('',${w.axis(c.cx, c.cy, z, [0, 0, 1], [1, 0, 0])},${real(r)})`);
    // Upper half from a to b, lower half from b back to a.
    return { a, b, up: w.edge(a, b, curve), low: w.edge(b, a, curve), r, z };
  };
  const levels = [circle(c.r, z0), circle(c.r, zc)];
  if (cone) levels.push(circle(c.R, z1));
  const faces = [];
  for (let k = 0; k + 1 < levels.length; k++) {
    const lo = levels[k];
    const hi = levels[k + 1];
    const sa = w.edge(lo.a, hi.a, w.line([c.cx + lo.r, c.cy, lo.z], [c.cx + hi.r, c.cy, hi.z]));
    const sb = w.edge(lo.b, hi.b, w.line([c.cx - lo.r, c.cy, lo.z], [c.cx - hi.r, c.cy, hi.z]));
    const surface = hi.r === lo.r
      ? w.add(`CYLINDRICAL_SURFACE('',${w.axis(c.cx, c.cy, lo.z, [0, 0, 1], [1, 0, 0])},${real(lo.r)})`)
      : w.add(`CONICAL_SURFACE('',${w.axis(c.cx, c.cy, lo.z, [0, 0, 1], [1, 0, 0])},${real(lo.r)},${real(Math.atan((hi.r - lo.r) / (hi.z - lo.z)))})`);
    // The material lies outside: seen from the axis the loops run
    // counter-clockwise, the faces point to the axis.
    faces.push(w.face(w.loop([w.oe(lo.low, false), w.oe(sb, true), w.oe(hi.low, true), w.oe(sa, false)]), [], surface, false));
    faces.push(w.face(w.loop([w.oe(lo.up, false), w.oe(sa, true), w.oe(hi.up, true), w.oe(sb, false)]), [], surface, false));
  }
  const first = levels[0];
  const last = levels[levels.length - 1];
  return {
    faces,
    // Bottom face (pointing down): around the hole counter-clockwise.
    bottomLoop: w.loop([w.oe(first.up, true), w.oe(first.low, true)]),
    // Top face (pointing up): around the hole clockwise.
    topLoop: w.loop([w.oe(last.low, false), w.oe(last.up, false)]),
  };
}

/** A point just inside a shape (beside the middle of its first edge). */
function insidePoint(shape) {
  const r = shape.outer;
  const [x0, y0, x1, y1] = [r[0], r[1], r[2], r[3]];
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  const k = ringArea(r) > 0 ? 1e-4 : -1e-4; // to the left of a counter-clockwise ring
  return [(x0 + x1) / 2 - ((y1 - y0) / l) * k, (y0 + y1) / 2 + ((x1 - x0) / l) * k];
}

/**
 * A flat solid of the model as bodies: one MANIFOLD_SOLID_BREP per
 * connected piece (every letter of the lettering on its own).
 */
function flatSolids(w, s, name) {
  const slabs = slabsOf(s).filter((sl) => sl.region.length);
  if (!slabs.length) return [];
  const pieces = union(...slabs.map((sl) => sl.region));
  if (pieces.length === 1) return [flatSolid(w, s, slabs, name)];
  return pieces.map((piece) => {
    const own = slabs.map((sl) => ({ ...sl, region: sl.region.filter((shape) => containsPoint([piece], ...insidePoint(shape))) }));
    const countersinks = (s.countersinks || []).filter((c) => containsPoint([piece], c.cx, c.cy));
    return flatSolid(w, { ...s, countersinks }, own.filter((sl) => sl.region.length), name);
  });
}

/** One connected flat solid (its slabs) as a MANIFOLD_SOLID_BREP. */
function flatSolid(w, s, slabs, name) {
  // Every outline of every slab, oriented with the material on its left.
  const rings = new Map();
  slabs.forEach((sl, i) => {
    for (const shape of sl.region) {
      for (const [r, outer] of [[shape.outer, true], ...shape.holes.map((h) => [h, false])]) {
        const c = canonical(r);
        let info = rings.get(c.key);
        if (!info) rings.set(c.key, info = { ring: c.ring, uses: [] });
        info.uses.push({ slab: i, ccw: outer });
      }
    }
  });
  // Walls: an outline runs up as long as it lasts in the same direction.
  const faces = [];
  const at = new Map(); // height → key → { edges, ccw }
  const store = (z, key, entry) => {
    if (!at.has(z)) at.set(z, new Map());
    if (at.get(z).has(key)) throw new Error('Umriss doppelt an einer Stufe');
    at.get(z).set(key, entry);
  };
  for (const [key, info] of rings) {
    const segsCCW = fitRing(info.ring);
    let k = 0;
    while (k < info.uses.length) {
      let e = k;
      while (e + 1 < info.uses.length && info.uses[e + 1].slab === info.uses[e].slab + 1 && info.uses[e + 1].ccw === info.uses[k].ccw) e++;
      const { ccw } = info.uses[k];
      const z0 = slabs[info.uses[k].slab].z0;
      const z1 = slabs[info.uses[e].slab].z1;
      const segs = ccw ? segsCCW : reverseSegments(segsCCW);
      const bottom = ringEdges(w, segs, z0);
      const top = ringEdges(w, segs, z1);
      faces.push(...wallFaces(w, segs, bottom, top, z0, z1));
      store(z0, key, { edges: bottom.edges, ccw });
      store(z1, key, { edges: top.edges, ccw });
      k = e + 1;
    }
  }
  // Round holes (countersunk screws): through all slabs.
  const holes = (s.countersinks || []).map((c) => ({ c, ...roundHole(w, c, s.z0, s.z1) }));
  for (const h of holes) faces.push(...h.faces);
  // Horizontal faces: what the slab below has and the one above has not
  // (pointing up), and the other way round (pointing down).
  const levels = [slabs[0].z0, ...slabs.map((sl) => sl.z1)];
  levels.forEach((z, i) => {
    const below = i > 0 ? slabs[i - 1].region : [];
    const above = i < slabs.length ? slabs[i].region : [];
    const stored = at.get(z) || new Map();
    for (const [region, up] of [[above.length ? difference(below, above) : below, true], [below.length ? difference(above, below) : above, false]]) {
      for (const shape of region) {
        const loops = [shape.outer, ...shape.holes].map((r) => {
          const c = canonical(r);
          const entry = stored.get(c.key);
          if (!entry) throw new Error('Umriss ohne Wand');
          // The face on the left of its outline (outer ccw, holes cw); a
          // face pointing up runs that way, one pointing down the other.
          const faceCcw = ringArea(r) > 0;
          return edgeLoop(w, entry.edges, (entry.ccw === faceCcw) === up);
        });
        for (const h of holes) {
          if ((Math.abs(z - s.z0) < 1e-7 && !up) || (Math.abs(z - s.z1) < 1e-7 && up)) {
            if (containsPoint([shape], h.c.cx, h.c.cy)) loops.push(up ? h.topLoop : h.bottomLoop);
          }
        }
        faces.push(w.face(loops[0], loops.slice(1), w.plane(z, up), true));
      }
    }
  });
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(name)},${shell})`);
}

/**
 * The handle of a stamp, upright around the Z axis: surfaces of revolution
 * (two halves each), the flat top, the underside with the peg.
 */
function handleSolid(w, h, name) {
  const levels = h.profile.map(([r, z]) => {
    const a = w.vertex(r, 0, z);
    const b = w.vertex(-r, 0, z);
    const curve = w.add(`CIRCLE('',${w.axis(0, 0, z, [0, 0, 1], [1, 0, 0])},${real(r)})`);
    return { r, z, a, b, up: w.edge(a, b, curve), low: w.edge(b, a, curve) };
  });
  const faces = [];
  for (let k = 0; k + 1 < levels.length; k++) {
    const lo = levels[k];
    const hi = levels[k + 1];
    const sa = w.edge(lo.a, hi.a, w.line([lo.r, 0, lo.z], [hi.r, 0, hi.z]));
    const sb = w.edge(lo.b, hi.b, w.line([-lo.r, 0, lo.z], [-hi.r, 0, hi.z]));
    let surface;
    if (Math.abs(hi.r - lo.r) < EPS) surface = w.add(`CYLINDRICAL_SURFACE('',${w.axis(0, 0, lo.z, [0, 0, 1], [1, 0, 0])},${real(lo.r)})`);
    else if (Math.abs(hi.z - lo.z) < EPS) surface = w.plane(lo.z, hi.r < lo.r);
    else if (hi.r > lo.r) surface = w.add(`CONICAL_SURFACE('',${w.axis(0, 0, lo.z, [0, 0, 1], [1, 0, 0])},${real(lo.r)},${real(Math.atan((hi.r - lo.r) / (hi.z - lo.z)))})`);
    else surface = w.add(`CONICAL_SURFACE('',${w.axis(0, 0, hi.z, [0, 0, -1], [1, 0, 0])},${real(hi.r)},${real(Math.atan((lo.r - hi.r) / (hi.z - lo.z)))})`);
    faces.push(w.face(w.loop([w.oe(lo.up, true), w.oe(sb, true), w.oe(hi.up, false), w.oe(sa, false)]), [], surface, true));
    faces.push(w.face(w.loop([w.oe(lo.low, true), w.oe(sa, true), w.oe(hi.low, false), w.oe(sb, false)]), [], surface, true));
  }
  const top = levels[levels.length - 1];
  faces.push(w.face(w.loop([w.oe(top.up, true), w.oe(top.low, true)]), [], w.plane(top.z, true), true));
  const foot = levels[0];
  const inner = [];
  if (h.peg) {
    // The peg: a prism below the underside.
    const c = canonical(h.peg.ring);
    const segs = fitRing(c.ring);
    const z0 = foot.z - h.peg.depth;
    const bottom = ringEdges(w, segs, z0);
    const topEdges = ringEdges(w, segs, foot.z);
    faces.push(...wallFaces(w, segs, bottom, topEdges, z0, foot.z));
    faces.push(w.face(edgeLoop(w, bottom.edges, false), [], w.plane(z0, false), true));
    inner.push(edgeLoop(w, topEdges.edges, true));
  }
  faces.push(w.face(w.loop([w.oe(foot.low, false), w.oe(foot.up, false)]), inner, w.plane(foot.z, false), true));
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(name)},${shell})`);
}

const rgb = (hex) => {
  const v = /^#?([\da-f]{6})$/i.exec(hex || '');
  const n = v ? parseInt(v[1], 16) : 0xb0b0b0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
};

/** Can this model be written as exact bodies? (Not a bent cup.) */
export function stepSupported(model) {
  return Boolean(model.parts.length && !model.cup);
}

/**
 * STEP file of the model: an assembly with one component per part, named
 * and coloured like the parts. opts: { title }.
 */
export function exportSTEP(model, { title = '' } = {}) {
  if (!stepSupported(model)) throw new Error('Für Becher gibt es keine STEP-Datei.');
  const name = title || model.doc.name || 'Text';
  const w = new BrepWriter();
  const appContext = w.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appContext})`);
  const productContext = w.add(`PRODUCT_CONTEXT('',${appContext},'mechanical')`);
  const pdContext = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appContext},'design')`);
  const mm = w.add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  const rad = w.add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const sr = w.add('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = w.add(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);
  const product = (label) => {
    const p = w.add(`PRODUCT(${str(label)},${str(label)},'',(${productContext}))`);
    w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${p}))`);
    const pd = w.add(`PRODUCT_DEFINITION('design','',${w.add(`PRODUCT_DEFINITION_FORMATION('','',${p})`)},${pdContext})`);
    return { pd, pds: w.add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`) };
  };

  const top = product(name);
  const topOrigin = w.axis(0, 0, 0, [0, 0, 1], [1, 0, 0]);
  const children = [];
  const styled = [];
  for (const part of model.parts) {
    const handle = part.solids[0]?.kind === 'handle' ? part.solids[0] : null;
    const bodies = handle ? [handleSolid(w, handle, part.name)] : part.solids.flatMap((s) => flatSolids(w, s, part.name));
    if (!bodies.length) continue;
    const comp = product(part.name);
    const origin = w.axis(0, 0, 0, [0, 0, 1], [1, 0, 0]);
    const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(part.name)},(${[origin, ...bodies].join(',')}),${ctx})`);
    w.add(`SHAPE_DEFINITION_REPRESENTATION(${comp.pds},${rep})`);
    // A handle is printed upside down beside the stamp, like in the 3MF.
    let place = w.axis(0, 0, 0, [0, 0, 1], [1, 0, 0]);
    if (handle) {
      const [x, y] = handle.at || [0, 0];
      const topZ = handle.profile[handle.profile.length - 1][1];
      place = handle.flip ? w.axis(x, y, topZ, [0, 0, -1], [1, 0, 0]) : w.axis(x, y, 0, [0, 0, 1], [1, 0, 0]);
    }
    children.push({ comp, rep, origin, place, name: part.name });
    const [r, g, b] = rgb(part.color);
    const colour = w.add(`COLOUR_RGB('',${real(r)},${real(g)},${real(b)})`);
    const fill = w.add(`FILL_AREA_STYLE('',(${w.add(`FILL_AREA_STYLE_COLOUR('',${colour})`)}))`);
    const side = w.add(`SURFACE_SIDE_STYLE('',(${w.add(`SURFACE_STYLE_FILL_AREA(${fill})`)}))`);
    const style = w.add(`PRESENTATION_STYLE_ASSIGNMENT((${w.add(`SURFACE_STYLE_USAGE(.BOTH.,${side})`)}))`);
    for (const body of bodies) styled.push(w.add(`STYLED_ITEM('color',(${style}),${body})`));
  }
  const topRep = w.add(`SHAPE_REPRESENTATION(${str(name)},(${[topOrigin, ...children.map((c) => c.place)].join(',')}),${ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(${top.pds},${topRep})`);
  children.forEach((c, i) => {
    const usage = w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${i + 1}',${str(c.name)},'',${top.pd},${c.comp.pd},$)`);
    const transform = w.add(`ITEM_DEFINED_TRANSFORMATION('','',${c.origin},${c.place})`);
    const rel = w.add(`( REPRESENTATION_RELATIONSHIP('','',${c.rep},${topRep}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${transform}) SHAPE_REPRESENTATION_RELATIONSHIP() )`);
    w.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rel},${w.add(`PRODUCT_DEFINITION_SHAPE('Placement','Placement of an item',${usage})`)})`);
  });
  if (styled.length) w.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled.join(',')}),${ctx})`);

  const stamp = new Date().toISOString().slice(0, 19);
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Text-Generator'),'2;1');",
    `FILE_NAME(${str(`${name}.step`)},'${stamp}',(''),(''),'Text-Generator','Text-Generator','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
  ];
  return `${header.join('\n')}\n${w.lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
