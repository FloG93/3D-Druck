// STEP bodies of a cup. Every solid of a cup is designed flat – x around, y
// up the wall, z out of it – and bent around the Z axis exactly like the
// mesh (mesh.js addWrapped): the angle follows x, the height follows y, the
// radius y and z. A face at a constant z becomes a cone around the axis (a
// cylinder for a straight wall), and the flat design lies in its surface
// parameters without distortion. The pieces of an outline become
//   horizontal lines → circle arcs; their walls lie in horizontal planes
//                      (rim, foot, the bars of letters)
//   vertical lines   → straight lines up the wall; their walls lie in
//                      planes through the axis
//   anything else    → cubic B-splines within 0.4 µm of the bent curve; the
//                      wall between two heights consists of straight radial
//                      lines – a B-spline surface, straight across
// The wall closes at the back, where x0 and x1 meet: bands all the way round
// (the wall itself, a border) get full circles for edges and faces with a
// seam line there. Nothing else reaches the seam (SEAM_GAP in model.js).
// The floor is a disc up to the inside of the wall – not halfway into it as
// in the mesh, where the slicer merges both.

import { real, str } from '../../../shared/js/step.js';
import { union, difference, ringArea, containsPoint } from '../core/geometry.js';
import { fitRing, reverseSegments } from '../core/curves.js';
import { slabsOf, insidePoint, ringRuns, slabRings, edgeLoop, storedRing, hermiteBreakpoints, hermiteSpline, segPoint, segD1 } from './brep.js';

// Largest distance of a B-spline from the bent curve it stands for (mm),
// below the accuracy the file declares (1e-6 mm).
const TOL = 4e-7;

/** The bend of mesh.js addWrapped, with its derivative. */
export function bender(wrap) {
  const { seam: [x0, x1], radius: R, t, height: H, sin = 0, cos = 1 } = wrap;
  const k = (2 * Math.PI) / (x1 - x0);
  const onSeam = (x) => x <= x0 || x >= x1;
  const angle = (x) => (onSeam(x) ? Math.PI : k * (x - x0) - Math.PI);
  const rho = (y, z) => R + y * sin + (z - t) / cos;
  const Z = (y) => (y + H / 2) * cos;
  return {
    x0,
    x1,
    sin,
    cos,
    angle,
    rho,
    Z,
    point(x, y, z) {
      const r = rho(y, z);
      if (onSeam(x)) return [0, r, Z(y)];
      const a = angle(x);
      return [r * Math.sin(a), -r * Math.cos(a), Z(y)];
    },
    /** Derivative of the bent point in the flat direction (dx, dy). */
    derivative(x, y, z, dx, dy) {
      const r = rho(y, z);
      const a = angle(x);
      const s = Math.sin(a);
      const c = Math.cos(a);
      return [r * c * k * dx + sin * s * dy, r * s * k * dx - sin * c * dy, cos * dy];
    },
    /** Radius of the cone of height z at Z = 0. */
    base: (z) => R - (H / 2) * sin + (z - t) / cos,
  };
}

/** The bent segment at height z: point and derivative by its parameter. */
function bentAt(bend, seg, z) {
  return {
    f: (s) => bend.point(...segPoint(seg, s), z),
    df: (s) => {
      const [x, y] = segPoint(seg, s);
      return bend.derivative(x, y, z, ...segD1(seg, s));
    },
  };
}

/**
 * The bent segment at height z as a cubic B-spline on the breakpoints
 * (tangent continuous, the joints on the curve).
 */
const bentSpline = (bend, seg, z, bps) => hermiteSpline(bentAt(bend, seg, z), bps);

/** Breakpoints so that the segment stays within TOL at every level. */
const breakpoints = (bend, seg, levels) => hermiteBreakpoints(levels.map((z) => bentAt(bend, seg, z)), 0, 1, TOL);

/** A bent segment at height z as a B-spline (for tests). */
export function bentCurve(bend, seg, z) {
  return bentSpline(bend, seg, z, breakpoints(bend, seg, [z]));
}

/** How a segment is bent: circle arc, line up the wall or B-spline. */
function plan(bend, seg, levels) {
  if (seg.type === 'line') {
    const [[xa, ya], [xb, yb]] = seg.p;
    if (ya === yb) return { kind: 'arc' };
    if (xa === xb) return { kind: 'axial' };
  }
  return { kind: 'spline', bps: breakpoints(bend, seg, levels) };
}

const touchesSeam = (ring, bend) => {
  for (let i = 0; i < ring.length; i += 2) if (ring[i] <= bend.x0 + 1e-9 || ring[i] >= bend.x1 - 1e-9) return true;
  return false;
};

/**
 * A band all the way round (an outline that reaches the seam) in ring
 * order: full circles { y, dir } (dir +1 when running towards +x) and
 * pieces of the seam { ya, yb }.
 */
function bandPieces(ring, bend) {
  const side = (x) => (x <= bend.x0 + 1e-9 ? 0 : x >= bend.x1 - 1e-9 ? 1 : -1);
  const n = ring.length / 2;
  const raw = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [xa, ya, xb, yb] = [ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1]];
    if (side(xa) >= 0 && side(xa) === side(xb)) raw.push({ seam: side(xa), ya, yb });
    else if (ya === yb) raw.push({ y: ya, xa, xb });
    else throw new Error('Am Stoß des Bechers ist nur ein umlaufendes Band möglich.');
  }
  // Neighbours of the same kind become one piece.
  const joins = (a, b) => (a.seam !== undefined ? b.seam === a.seam && b.ya === a.yb : b.y === a.y && b.xa === a.xb);
  let start = 0;
  while (start < n && joins(raw[(start + n - 1) % n], raw[start])) start++;
  if (start === n) throw new Error('Am Stoß des Bechers ist nur ein umlaufendes Band möglich.');
  const out = [];
  for (let k = 0; k < n; k++) {
    const p = raw[(start + k) % n];
    const last = out[out.length - 1];
    if (last && joins(last, p)) {
      if (p.seam !== undefined) last.yb = p.yb;
      else last.xb = p.xb;
    } else out.push({ ...p });
  }
  return out.map((p) => {
    if (p.seam !== undefined) return { ya: p.ya, yb: p.yb };
    if (Math.abs(Math.abs(p.xb - p.xa) - (bend.x1 - bend.x0)) > 1e-9) throw new Error('Am Stoß des Bechers ist nur ein umlaufendes Band möglich.');
    return { y: p.y, dir: p.xb > p.xa ? 1 : -1 };
  });
}

/**
 * Shared geometry of all bodies of a cup: the bend and the cone (or
 * cylinder) of every height z, with its seam at the back (+Y).
 */
export function cupContext(w, model) {
  const wrap = model.parts.flatMap((p) => p.solids).find((s) => s.wrap)?.wrap;
  if (!wrap) throw new Error('Becher ohne Wand');
  const bend = bender(wrap);
  const surfaces = new Map();
  return {
    bend,
    surface(z) {
      let id = surfaces.get(z);
      if (id) return id;
      const r = bend.base(z);
      if (!(r > 0)) throw new Error('Die Wand ist für diesen Durchmesser zu dick.');
      const { sin, cos } = bend;
      if (Math.abs(sin) < 1e-12) id = w.add(`CYLINDRICAL_SURFACE('',${w.axis(0, 0, 0, [0, 0, 1], [0, 1, 0])},${real(r)})`);
      // Narrowing upwards: the axis points down, so the angle stays positive.
      else id = w.add(`CONICAL_SURFACE('',${w.axis(0, 0, 0, [0, 0, sin > 0 ? 1 : -1], [0, 1, 0])},${real(r)},${real(Math.atan2(Math.abs(sin), cos))})`);
      surfaces.set(z, id);
      return id;
    },
  };
}

/** Edges of one body at the seam: its vertices, full circles and seam lines. */
function seamTopology(w, bend) {
  const vertices = new Map();
  const circles = new Map();
  const seams = new Map();
  const vertex = (y, z) => {
    const key = `${y},${z}`;
    if (!vertices.has(key)) vertices.set(key, w.vertex(...bend.point(bend.x0, y, z)));
    return vertices.get(key);
  };
  return {
    /** Full circle at (y, z), counter-clockwise seen from above. */
    circle(y, z) {
      const key = `${y},${z}`;
      if (!circles.has(key)) {
        const v = vertex(y, z);
        circles.set(key, w.edge(v, v, w.circleZ(bend.Z(y), bend.rho(y, z))));
      }
      return circles.get(key);
    },
    /** Seam line at height z from ya up to yb. */
    seam(z, ya, yb) {
      const key = `${z},${ya},${yb}`;
      if (!seams.has(key)) seams.set(key, w.edge(vertex(ya, z), vertex(yb, z), w.line(bend.point(bend.x0, ya, z), bend.point(bend.x0, yb, z))));
      return seams.get(key);
    },
  };
}

/** Loop of a band at height z: its circles and the seam line between them. */
function bandLoop(w, seam, bend, ring, z, up) {
  const pairs = bandPieces(ring, bend).map((p) => (p.y !== undefined
    ? [seam.circle(p.y, z), p.dir > 0]
    : [seam.seam(z, Math.min(p.ya, p.yb), Math.max(p.ya, p.yb)), p.yb > p.ya]));
  const ordered = up ? pairs : pairs.reverse().map(([e, s]) => [e, !s]);
  return w.loop(ordered.map(([e, s]) => w.oe(e, s)));
}

/** Edges of an outline (not at the seam) bent at height z. */
function bentEdges(w, bend, segs, plans, z) {
  const vertices = segs.map((s) => w.vertex(...bend.point(s.p[0][0], s.p[0][1], z)));
  const splines = [];
  const edges = segs.map((s, i) => {
    const [xa, ya] = s.p[0];
    const [xb, yb] = s.p[s.p.length - 1];
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % segs.length];
    if (plans[i].kind === 'arc') return w.edge(v0, v1, w.circleZ(bend.Z(ya), bend.rho(ya, z)), xb > xa);
    if (plans[i].kind === 'axial') return w.edge(v0, v1, w.line(bend.point(xa, ya, z), bend.point(xb, yb, z)));
    // The wall surface uses the same control points.
    const sp = bentSpline(bend, s, z, plans[i].bps);
    sp.points = w.pts(sp.points);
    splines[i] = sp;
    return w.edge(v0, v1, w.bspline(sp.points, sp.mults, sp.knots));
  });
  return { vertices, edges, splines };
}

/** Side faces of an outline from z0 up to z1 (material on its left). */
function bentWalls(w, bend, segs, plans, bottom, top, z0, z1) {
  const n = segs.length;
  const verticals = segs.map((s, i) => {
    const [x, y] = s.p[0];
    return w.edge(bottom.vertices[i], top.vertices[i], w.line(bend.point(x, y, z0), bend.point(x, y, z1)));
  });
  return segs.map((s, i) => {
    const loop = w.loop([w.oe(bottom.edges[i], true), w.oe(verticals[(i + 1) % n], true), w.oe(top.edges[i], false), w.oe(verticals[i], false)]);
    const [xa, ya] = s.p[0];
    const [xb, yb] = s.p[s.p.length - 1];
    let surface;
    if (plans[i].kind === 'arc') {
      // Running towards +x the material lies above: the face looks down.
      surface = w.plane(bend.Z(ya), xb < xa);
    } else if (plans[i].kind === 'axial') {
      const a = bend.angle(xa);
      const k = yb > ya ? 1 : -1;
      surface = w.add(`PLANE('',${w.axis(...bend.point(xa, ya, z0), [k * Math.cos(a), k * Math.sin(a), 0], [0, 0, 1])})`);
    } else {
      surface = w.ruled(bottom.splines[i].points, top.splines[i].points, bottom.splines[i].mults, bottom.splines[i].knots);
    }
    return w.face(loop, [], surface, true);
  });
}

/** One connected bent solid (its slabs) as a MANIFOLD_SOLID_BREP. */
function bentSolid(w, cup, slabs, name) {
  const { bend } = cup;
  const seam = seamTopology(w, bend);
  const faces = [];
  const at = new Map(); // height → key → { edges, ccw }
  const store = (z, key, entry) => {
    if (!at.has(z)) at.set(z, new Map());
    if (at.get(z).has(key)) throw new Error('Umriss doppelt an einer Stufe');
    at.get(z).set(key, entry);
  };
  for (const [key, info] of slabRings(slabs)) {
    const runs = ringRuns(info.uses, slabs);
    if (touchesSeam(info.ring, bend)) {
      // A band all the way round: its circles give horizontal rings.
      const pieces = bandPieces(info.ring, bend);
      for (const { ccw, z0, z1 } of runs) {
        if (!ccw) throw new Error('Am Stoß des Bechers ist nur ein umlaufendes Band möglich.');
        for (const p of pieces.filter((q) => q.y !== undefined)) {
          const up = p.dir < 0;
          faces.push(w.face(w.loop([w.oe(seam.circle(p.y, z1), up)]), [w.loop([w.oe(seam.circle(p.y, z0), !up)])], w.plane(bend.Z(p.y), up), true));
        }
      }
      continue;
    }
    const segsCCW = fitRing(info.ring);
    for (const { ccw, z0, z1 } of runs) {
      const segs = ccw ? segsCCW : reverseSegments(segsCCW);
      const plans = segs.map((s) => plan(bend, s, [z0, z1]));
      const bottom = bentEdges(w, bend, segs, plans, z0);
      const top = bentEdges(w, bend, segs, plans, z1);
      faces.push(...bentWalls(w, bend, segs, plans, bottom, top, z0, z1));
      store(z0, key, { edges: bottom.edges, ccw });
      store(z1, key, { edges: top.edges, ccw });
    }
  }
  // Faces at a constant z (cones): what the slab below has and the one
  // above has not (pointing out), and the other way round (pointing in).
  const levels = [slabs[0].z0, ...slabs.map((sl) => sl.z1)];
  levels.forEach((z, i) => {
    const below = i > 0 ? slabs[i - 1].region : [];
    const above = i < slabs.length ? slabs[i].region : [];
    const stored = at.get(z) || new Map();
    const island = (r, up) => {
      const entry = storedRing(stored, r);
      if (!entry) throw new Error('Umriss ohne Wand');
      return edgeLoop(w, entry.edges, (entry.ccw === (ringArea(r) > 0)) === up);
    };
    for (const [region, up] of [[above.length ? difference(below, above) : below, true], [below.length ? difference(above, below) : above, false]]) {
      for (const shape of region) {
        const outer = touchesSeam(shape.outer, bend) ? bandLoop(w, seam, bend, shape.outer, z, up) : island(shape.outer, up);
        const holes = shape.holes.map((h) => {
          if (touchesSeam(h, bend)) throw new Error('Am Stoß des Bechers ist nur ein umlaufendes Band möglich.');
          return island(h, up);
        });
        faces.push(w.face(outer, holes, cup.surface(z), up));
      }
    }
  });
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(name)},${shell})`);
}

/** A bent solid as bodies: one per connected piece (every letter its own). */
function bentSolids(w, cup, s, name) {
  if (s.countersinks?.length) throw new Error('Ein Becher hat keine Schraublöcher.');
  const slabs = slabsOf(s).filter((sl) => sl.region.length);
  if (!slabs.length) return [];
  const pieces = union(...slabs.map((sl) => sl.region));
  if (pieces.length === 1) return [bentSolid(w, cup, slabs, name)];
  return pieces.map((piece) => bentSolid(w, cup, slabs
    .map((sl) => ({ ...sl, region: sl.region.filter((shape) => containsPoint([piece], ...insidePoint(shape))) }))
    .filter((sl) => sl.region.length), name));
}

/**
 * The floor inside the wall: from the foot up to its height, its side on
 * the inside of the wall (the cone at z = 0). { y0, y1, r0, r1, z0, z1 }:
 * y along the wall, radii and heights at the bottom and the top.
 */
export function cupFloor(model) {
  const wrap = model.parts.flatMap((p) => p.solids).find((s) => s.wrap)?.wrap;
  if (!wrap || !model.cup || !(model.cup.floor > 0)) return null;
  const bend = bender(wrap);
  const y0 = -wrap.height / 2;
  const y1 = model.cup.floor / bend.cos + y0;
  return { y0, y1, r0: bend.rho(y0, 0), r1: bend.rho(y1, 0), z0: bend.Z(y0), z1: bend.Z(y1) };
}

function floorBody(w, cup, model, name) {
  const f = cupFloor(model);
  if (!f) return null;
  const seam = seamTopology(w, cup.bend);
  const bottom = seam.circle(f.y0, 0);
  const top = seam.circle(f.y1, 0);
  const line = seam.seam(0, f.y0, f.y1);
  const faces = [
    w.face(w.loop([w.oe(bottom, true), w.oe(line, true), w.oe(top, false), w.oe(line, false)]), [], cup.surface(0), true),
    w.face(w.loop([w.oe(bottom, false)]), [], w.plane(f.z0, false), true),
    w.face(w.loop([w.oe(top, true)]), [], w.plane(f.z1, true), true),
  ];
  const shell = w.add(`CLOSED_SHELL('',(${faces.join(',')}))`);
  return w.add(`MANIFOLD_SOLID_BREP(${str(name)},${shell})`);
}

/** Bodies of one part of a cup. */
export function cupBodies(w, cup, model, part) {
  if (part.id === 'floor') return [floorBody(w, cup, model, part.name)].filter(Boolean);
  return part.solids.flatMap((s) => bentSolids(w, cup, s, part.name));
}
