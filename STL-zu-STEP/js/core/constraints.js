// Constraints before the build (docs/SPEC.md 5.6). Without them the fitted
// surfaces almost, but not exactly, fit together, and the edges of the
// reconstruction do not close: docs/MACHBARKEIT.md section 4 measured a gap of
// about 4e-4 mm between the fitted wall plane and the fitted cylinder of a
// fillet on a subdivided mesh, which left the B-rep invalid.
//
// In this order, each step countable and switchable:
//   1. parallel / coaxial axes
//   2. planes exactly perpendicular or parallel to an axis
//   3. tangential: a wall plane runs at exactly the radius from the axis
//   4. corners onto the intersection of their neighbouring surfaces
//   5. optional: radii snapped to round values (only on request)

import { dot, normalize, cross, sub, norm, scale, add, solve } from './linalg.js';
import { bbox } from './meshops.js';

export const CONSTRAINT_DEFAULTS = {
  parallelDegrees: 0.5,
  coaxialTolerance: 0.01, // · radius
  perpendicularDegrees: 0.5,
  tangentTolerance: 0.01, // · radius
  cornerIterations: 200,
  roundRadius: false,
  roundRadiusStep: 0.05, // mm (1/64 inch for inch parts)
};

/**
 * applyConstraints(mesh, models, topology, opts?) →
 *   { points, models, report }
 * `points` is a copy of mesh.V with the corners moved; `models` is a new Map
 * with the corrected surfaces. The original data stays untouched.
 */
export function applyConstraints(mesh, models, topology, opts = {}) {
  const o = { ...CONSTRAINT_DEFAULTS, ...opts };
  const out = new Map();
  for (const [region, model] of models) out.set(region, { ...model });
  const report = {
    parallel: 0, coaxial: 0, perpendicular: 0, tangential: 0,
    cornersMoved: 0, cornersExact: 0, cornersIterated: 0, radiiRounded: 0,
    maxCornerShift: 0, maxCornerError: 0, maxAxisShift: 0,
    // Constraints that were taken back because they moved a surface away
    // from its own points (see keepsItsData below).
    verworfen: 0,
    skipped: [],
  };

  const cylinders = [...out.entries()].filter(([, m]) => m.type === 'cylinder');
  const planes = [...out.entries()].filter(([, m]) => m.type === 'plane');
  const neighbours = neighbourRegions(topology);
  const guard = dataGuard(mesh, opts.trianglesOfRegion, o);

  if (opts.parallel !== false) alignAxes(cylinders, report, o);
  else report.skipped.push('Achsen parallel setzen');

  if (opts.perpendicular !== false) alignPlanes(planes, cylinders, neighbours, guard, report, o);
  else report.skipped.push('Ebenen rechtwinklig setzen');

  if (opts.tangential !== false) makeTangential(planes, cylinders, neighbours, guard, report, o);
  else report.skipped.push('Tangentialität');

  if (o.roundRadius) roundRadii(cylinders, report, o);

  const points = opts.corners === false ? Float64Array.from(mesh.V) : snapCorners(mesh, out, topology, report, o);
  if (opts.corners === false) report.skipped.push('Eckpunkte einrasten');

  return { points, models: out, report };
}


/** Which regions share a boundary with which (from the chains of the topology). */
function neighbourRegions(topology) {
  const map = new Map();
  if (!topology?.chains) return map;
  for (const chain of topology.chains) {
    const own = map.get(chain.region) ?? new Set();
    for (const other of chain.neighbours) own.add(other);
    map.set(chain.region, own);
    for (const other of chain.neighbours) {
      const set = map.get(other) ?? new Set();
      set.add(chain.region);
      map.set(other, set);
    }
  }
  return map;
}

/**
 * Returns a test "does this surface still fit its own points?". A constraint
 * may tidy a surface up, but it may never move it away from the triangles it
 * was fitted to – a result that no longer matches the mesh is worse than one
 * that is not quite square (CLAUDE.md).
 */
function dataGuard(mesh, trianglesOfRegion, o) {
  if (!trianglesOfRegion) return () => true;
  const diagonal = bbox(mesh.V).diagonal;
  return (region, model, before) => {
    const triangles = trianglesOfRegion.get(region);
    if (!triangles || triangles.length === 0) return true;
    const after = residualOf(mesh, model, triangles);
    const allowed = model.type === 'cylinder'
      ? o.tangentTolerance * model.radius + 1e-3 // the tolerance recognition used
      : Math.max(1e-6 * diagonal, residualOf(mesh, before, triangles));
    return after <= Math.max(allowed, residualOf(mesh, before, triangles));
  };
}

/** Largest distance of the points of these triangles from the surface. */
function residualOf(mesh, model, triangles) {
  const { V, F } = mesh;
  let worst = 0;
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const v = 3 * F[3 * t + k];
      const p = [V[v], V[v + 1], V[v + 2]];
      let d;
      if (model.type === 'plane') {
        d = Math.abs(dot(sub(p, model.point), normalize(model.normal)));
      } else {
        const axis = normalize(model.axis);
        const q = sub(p, model.point);
        const along = dot(q, axis);
        d = Math.abs(norm([q[0] - along * axis[0], q[1] - along * axis[1], q[2] - along * axis[2]]) - model.radius);
      }
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** 1. Axes that are nearly parallel become exactly parallel; coaxial ones share a line. */
function alignAxes(cylinders, report, o) {
  const limit = Math.cos((o.parallelDegrees * Math.PI) / 180);
  const groups = [];
  for (const [, m] of cylinders) {
    const group = groups.find((g) => Math.abs(dot(g.axis, m.axis)) > limit);
    if (group) group.members.push(m);
    else groups.push({ axis: normalize(m.axis), members: [m] });
  }
  for (const group of groups) {
    // Average direction, with every axis turned to the same side.
    let sum = [0, 0, 0];
    for (const m of group.members) {
      const sign = dot(m.axis, group.axis) < 0 ? -1 : 1;
      sum = add(sum, scale(normalize(m.axis), sign));
    }
    const axis = normalize(sum);
    for (const m of group.members) {
      if (Math.abs(Math.abs(dot(normalize(m.axis), axis)) - 1) > 1e-15) report.parallel += 1;
      const sign = dot(m.axis, axis) < 0 ? -1 : 1;
      m.axis = sign < 0 ? scale(axis, -1) : axis;
      m.ref = perpendicularTo(m.ref ?? [1, 0, 0], m.axis);
    }
    // Coaxial: centre lines closer than 0.01·r become one line.
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        const a = group.members[i];
        const b = group.members[j];
        const d = sub(b.point, a.point);
        const along = dot(d, axis);
        const offset = norm(sub(d, scale(axis, along)));
        if (offset > o.coaxialTolerance * a.radius || offset === 0) continue;
        const mid = scale(add(a.point, sub(b.point, scale(axis, along))), 0.5);
        a.point = mid;
        b.point = add(mid, scale(axis, along));
        report.coaxial += 1;
      }
    }
  }
}

/**
 * 2. Planes almost perpendicular to an axis become exactly perpendicular –
 * but only planes that really border that cylinder. Measured on fandisk.obj:
 * without that restriction 1006 of 11 000 regions were snapped to some axis
 * they never touch, every one of them rotated away from its own triangles.
 */
function alignPlanes(planes, cylinders, neighbours, guard, report, o) {
  const limit = Math.cos((o.perpendicularDegrees * Math.PI) / 180);
  for (const [region, plane] of planes) {
    const near = neighbours.get(region);
    if (!near) continue;
    const n = normalize(plane.normal);
    for (const [other, cylinder] of cylinders) {
      if (!near.has(other)) continue;
      const axis = normalize(cylinder.axis);
      const c = dot(n, axis);
      if (Math.abs(c) <= limit) continue;
      const target = c > 0 ? axis : scale(axis, -1);
      if (Math.abs(Math.abs(c) - 1) < 1e-15) break;
      const before = { ...plane };
      plane.normal = target;
      if (!guard(region, plane, before)) {
        Object.assign(plane, before);
        report.verworfen += 1;
      } else {
        report.perpendicular += 1;
      }
      break;
    }
  }
}

/**
 * 3. Tangency. A fillet runs tangentially into its walls, and the edge only
 * closes when the distance between axis and wall is EXACTLY the radius.
 *
 * The axis is moved, not the wall: a wall carries many points and is the
 * better determined surface, while the axis is fitted from a narrow band. It
 * also makes both walls of a corner fillet come out exactly tangential – with
 * the wall being moved instead, only the first of them could be satisfied,
 * which left eight of the sixteen corners of the plate off by 1e-7.
 */
function makeTangential(planes, cylinders, neighbours, guard, report, o) {
  const perpendicular = Math.sin((o.perpendicularDegrees * Math.PI) / 180);
  for (const [region, cylinder] of cylinders) {
    const axis = normalize(cylinder.axis);
    const near = neighbours.get(region) ?? new Set();
    const touching = [];
    for (const [other, plane] of planes) {
      // Only walls the cylinder really runs into – a plane somewhere else in
      // the part says nothing about where this axis belongs.
      if (!near.has(other)) continue;
      const n = normalize(plane.normal);
      if (Math.abs(dot(n, axis)) > perpendicular) continue;
      const distance = dot(sub(cylinder.point, plane.point), n);
      if (Math.abs(Math.abs(distance) - cylinder.radius) > o.tangentTolerance * cylinder.radius) continue;
      touching.push({ plane, normal: n, side: distance >= 0 ? 1 : -1 });
    }
    if (touching.length === 0) continue;

    // Independent normals pin the axis down completely; one normal leaves it
    // free along the wall, and it is only pushed to the right distance.
    const independent = [touching[0]];
    for (const candidate of touching.slice(1)) {
      if (independent.length === 2) break;
      if (Math.abs(dot(candidate.normal, independent[0].normal)) < Math.cos((5 * Math.PI) / 180)) independent.push(candidate);
    }
    const before = { ...cylinder };
    if (independent.length === 2) {
      // dot(a, n_i) = dot(p_i, n_i) + side_i · r, solved inside the plane ⊥ axis.
      const [first, second] = independent;
      const u1 = normalize(sub(first.normal, scale(axis, dot(first.normal, axis))));
      const u2 = normalize(cross(axis, u1));
      const rows = [first, second].map((t) => [dot(t.normal, u1), dot(t.normal, u2)]);
      const rhs = [first, second].map((t) => dot(t.plane.point, t.normal) + t.side * cylinder.radius - dot(scale(axis, dot(cylinder.point, axis)), t.normal));
      const solved = solve(rows, rhs);
      if (solved && solved.every(Number.isFinite)) {
        cylinder.point = add(scale(axis, dot(cylinder.point, axis)), add(scale(u1, solved[0]), scale(u2, solved[1])));
      }
    } else {
      const t = independent[0];
      const distance = dot(sub(cylinder.point, t.plane.point), t.normal);
      cylinder.point = add(cylinder.point, scale(t.normal, t.side * cylinder.radius - distance));
    }
    const shift = norm(sub(cylinder.point, before.point));
    if (shift === 0) continue;
    // The axis may be nudged onto the wall, but never away from the points it
    // was fitted to (measured on fandisk.obj: 0.00002 mm became 0.0328 mm).
    if (!guard(region, cylinder, before)) {
      Object.assign(cylinder, before);
      report.verworfen += 1;
      continue;
    }
    report.tangential += 1;
    report.maxAxisShift = Math.max(report.maxAxisShift, shift);
  }
}

/** 5. Radii on a round value – only when the user asked for it. */
function roundRadii(cylinders, report, o) {
  for (const [, m] of cylinders) {
    const rounded = Math.round(m.radius / o.roundRadiusStep) * o.roundRadiusStep;
    if (rounded <= 0 || Math.abs(rounded - m.radius) > (m.uncertainty ?? Infinity)) continue;
    if (Math.abs(rounded - m.radius) < 1e-15) continue;
    m.radius = rounded;
    report.radiiRounded += 1;
  }
}

/**
 * 4. Corners onto the intersection of their neighbouring surfaces (alternating
 * projection, referenz/recon.py::snap_corners). Afterwards every edge that
 * ends there uses the same model, and the wires close without tolerance
 * tricks.
 */
function snapCorners(mesh, models, topology, report, o) {
  const points = Float64Array.from(mesh.V);
  if (!topology) return points;
  for (const [vertex, regions] of topology.regionsAt) {
    if (regions.size < 3) continue;
    const surfaces = [...regions].map((r) => models.get(r)).filter(Boolean);
    if (surfaces.length < 3) continue;
    const start = [points[3 * vertex], points[3 * vertex + 1], points[3 * vertex + 2]];
    const exact = solveCorner(surfaces, start);
    let x = exact ?? start;
    if (exact) report.cornersExact += 1;
    else {
      for (let i = 0; i < o.cornerIterations; i++) for (const surface of surfaces) x = project(x, surface);
      report.cornersIterated += 1;
    }
    const shift = norm(sub(x, start));
    report.maxCornerError = Math.max(report.maxCornerError, cornerError(x, surfaces));
    if (shift > 0) {
      report.cornersMoved += 1;
      report.maxCornerShift = Math.max(report.maxCornerShift, shift);
      points[3 * vertex] = x[0];
      points[3 * vertex + 1] = x[1];
      points[3 * vertex + 2] = x[2];
    }
  }
  return points;
}


/**
 * The corner in closed form, where the surfaces allow it. SPEC 5.6 asks for
 * this: alternating projection converges badly at a tangential pair, because
 * plane and cylinder touch instead of crossing (measured: 1e-8 left over
 * after 200 rounds, while the closed form is exact).
 *
 *   three planes            → 3x3 system
 *   cylinder + cap + wall   → the cap height on the tangent line of the wall
 *
 * Returns null when no pattern fits, and the caller iterates.
 */
export function solveCorner(surfaces, near) {
  const planes = surfaces.filter((s) => s.type === 'plane');
  const cylinders = surfaces.filter((s) => s.type === 'cylinder');

  if (planes.length >= 3) {
    const [a, b, c] = pickIndependent(planes) ?? [];
    if (a) {
      const rows = [a, b, c].map((p) => normalize(p.normal));
      const rhs = [a, b, c].map((p, i) => dot(rows[i], p.point));
      const x = solve(rows.map((r) => [...r]), rhs);
      if (x && x.every(Number.isFinite)) return x;
    }
  }

  if (cylinders.length === 1 && planes.length >= 2) {
    const cylinder = cylinders[0];
    const axis = normalize(cylinder.axis);
    const cap = planes.find((p) => Math.abs(Math.abs(dot(normalize(p.normal), axis)) - 1) < 1e-9);
    const wall = planes.find((p) => {
      const n = normalize(p.normal);
      if (Math.abs(dot(n, axis)) > 1e-9) return false;
      return Math.abs(Math.abs(dot(sub(p.point, cylinder.point), n)) - cylinder.radius) < 1e-9;
    });
    if (cap && wall) {
      const n = normalize(wall.normal);
      const side = dot(sub(wall.point, cylinder.point), n) >= 0 ? 1 : -1;
      const touch = add(cylinder.point, scale(n, side * cylinder.radius));
      const height = dot(cap.point, axis) - dot(touch, axis);
      return add(touch, scale(axis, height));
    }
  }
  return null;
}

/** Three planes whose normals span the space (otherwise no unique corner). */
function pickIndependent(planes) {
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const a = normalize(planes[i].normal);
        const b = normalize(planes[j].normal);
        const c = normalize(planes[k].normal);
        if (Math.abs(dot(cross(a, b), c)) > 1e-6) return [planes[i], planes[j], planes[k]];
      }
    }
  }
  return null;
}

/** Nearest point on a surface. */
export function project(x, surface) {
  if (surface.type === 'plane') {
    const n = normalize(surface.normal);
    return sub(x, scale(n, dot(sub(x, surface.point), n)));
  }
  const axis = normalize(surface.axis);
  const d = sub(x, surface.point);
  const along = dot(d, axis);
  const radial = sub(d, scale(axis, along));
  const len = norm(radial);
  if (len < 1e-15) return x;
  return add(add(surface.point, scale(axis, along)), scale(radial, surface.radius / len));
}

/** Largest distance of a point from the surfaces of its regions (for tests). */
export function cornerError(point, surfaces) {
  let worst = 0;
  for (const surface of surfaces) worst = Math.max(worst, norm(sub(point, project(point, surface))));
  return worst;
}

function perpendicularTo(reference, axis) {
  const a = normalize(axis);
  let r = normalize(reference);
  if (Math.abs(dot(r, a)) > 0.99) r = normalize(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const along = dot(r, a);
  return normalize(sub(r, scale(a, along)));
}
