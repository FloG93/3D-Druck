// Recognising cylinders on flat patches, with counter-hypotheses
// (docs/SPEC.md 5.5; ported from referenz/probe4.py::detect,
// referenz/probe6.py::verdict and referenz/recon.py::merge_cylinders).
//
// Why every single rule exists is measured in docs/MACHBARKEIT.md section 2:
//   * a seed needs an angular spread of its normals, or the axis is unstable;
//   * a triangle belongs to a cylinder only if ALL THREE points lie on it and
//     the normal points radially – otherwise a tangential fillet swallows the
//     whole wall behind it;
//   * without counter-hypotheses a sphere gives 48 phantom cylinders and a
//     cone 5;
//   * the sphere counter-hypothesis must look at the normals as well, because
//     the points of two rings of a cylinder do lie on a sphere;
//   * a hole may fall apart into two pieces when the radius is distorted, so
//     coaxial pieces of the same radius are merged;
//   * a short piece of a torus tube looks like a cylinder, so the boundary of
//     the region has to end somewhere – in a sharp edge, in a cap or in a
//     tangential transition.

import { triangleNormals, adjacency, neighbours, triEdges, undirectedKey } from './meshops.js';
import { patchGraph } from './patches.js';
import { dot, frame, normalize, fitCircle, fitSphere, fitSlope, eigh3, sub, norm, maxOf, minOf } from './linalg.js';

/** All thresholds of SPEC 5.5 in one place, every one of them measured. */
export const CYLINDER_DEFAULTS = {
  smoothAngleDegrees: 50, // patches below this angle count as smoothly connected
  minPatches: 3, // fewer patches never give a stable axis
  maxSeedPatches: 40, // upper bound while the seed grows
  seedSpread: 0.05, // λ₂/λ₃ of the normal covariance needed for the seed
  fitSpread: 0.02, // the same for a fit to be trusted at all
  radiusTolerance: 0.01, // |d − r| ≤ 0.01·r + radiusToleranceAbsolute
  radiusToleranceAbsolute: 1e-3,
  axisTolerance: 0.1, // |N·axis| must stay below this
  radialTolerance: 0.9, // |cos| between normal and radial direction
  minLengthFactor: 0.3, // length along the axis ≥ 0.3·r ("zu kurz")
  radiusDriftTolerance: 0.01, // slope · length ≤ 0.01·r (cone)
  sphereResidual: 0.01, // sphere fits better: residual < 0.01·r …
  sphereNormalCosine: 0.97, // … and the normals point radially from its centre
  certainSegments: 12, // ≥ 12 segments per full circle: certain
  minSegments: 8, // below that a polygon stays a prism
  mergeAxisTolerance: 1e-4, // |axis·axis'| > 1 − this
  mergeCenterTolerance: 0.01, // distance of the centre lines ≤ 0.01·r
  mergeRadiusTolerance: 0.01,
  boundaryTangentDegrees: 3, // tangential transition: plane ⊥ axis within this
  boundaryTangentTolerance: 0.02, // and at distance r (±2 %)
  boundaryInSurfaceShare: 0.02, // more than 2 % of the boundary "in the surface" → reject
};

/**
 * detectCylinders(mesh, patchResult, opts?) →
 *   { cylinders, rejected, uncertain, merged, options }
 *
 * `cylinders` are the accepted ones (uncertain ones only with
 * opts.acceptUncertain), `uncertain` the ones offered for confirmation,
 * `rejected` every candidate that failed a counter-hypothesis, with its
 * reasons – nothing is dropped silently.
 */
export function detectCylinders(mesh, patchResult, opts = {}) {
  const o = { ...CYLINDER_DEFAULTS, ...opts };
  const { V, F } = mesh;
  const { labels, patches } = patchResult;
  const { N, area } = triangleNormals(V, F);
  const graph = patchGraph(mesh, labels, o.smoothAngleDegrees);
  const adj = adjacency(F);
  const patchArea = patches.map((tris) => tris.reduce((s, t) => s + area[t], 0));
  const order = patches.map((_, i) => i).sort((a, b) => patchArea[a] - patchArea[b]);

  const taken = new Set();
  const found = [];
  const rejected = [];

  for (const seed of order) {
    if (taken.has(seed) || !graph.has(seed)) continue;
    // 1. Grow the seed until the normals have enough angular spread.
    const candidate = [seed];
    const inCandidate = new Set([seed]);
    let frontier = [seed];
    let model = null;
    let seedTriangles = [];
    // The covariance grows with the seed instead of being summed again from
    // scratch at every step (same order of summation, same numbers).
    const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    addCovariance(covariance, N, area, patches[seed]);
    while (candidate.length < o.maxSeedPatches) {
      const values = eigh3(covariance).values;
      const spread = values[1] / Math.max(values[2], 1e-12);
      if (candidate.length >= o.minPatches && spread >= o.seedSpread) {
        seedTriangles = candidate.flatMap((k) => [...patches[k]]);
        model = fitCylinder(V, F, N, area, seedTriangles, o);
        break;
      }
      const next = [];
      for (const k of frontier) for (const j of graph.get(k) || []) if (!inCandidate.has(j) && !taken.has(j)) next.push(j);
      if (next.length === 0) break;
      const pick = next.reduce((best, j) => (patchArea[j] < patchArea[best] ? j : best), next[0]);
      candidate.push(pick);
      inCandidate.add(pick);
      addCovariance(covariance, N, area, patches[pick]);
      frontier = [pick];
    }
    if (!model) continue;
    if (!allMembers(V, F, N, seedTriangles, model, o)) continue;

    // 2. Grow the region over the patch graph, patch by patch.
    const region = new Set(candidate);
    frontier = [...candidate];
    while (frontier.length > 0) {
      const next = [];
      for (const k of frontier) {
        for (const j of graph.get(k) || []) {
          if (region.has(j) || taken.has(j)) continue;
          if (!allMembers(V, F, N, patches[j], model, o)) continue;
          region.add(j);
          next.push(j);
        }
      }
      frontier = next;
    }
    if (region.size < o.minPatches) continue;

    // 3. Refit on the whole region, then the counter-hypotheses.
    const triangles = [...region].flatMap((k) => [...patches[k]]);
    const refit = fitCylinder(V, F, N, area, triangles, o) || model;
    const candidateCylinder = describe(V, F, N, labels, patches, region, triangles, refit, o);
    const reasons = verifyCylinder(V, F, N, triangles, refit, candidateCylinder, { adj, labels, patches, region }, o);
    for (const k of region) taken.add(k);
    if (reasons.length > 0) {
      rejected.push({ patchIds: [...region].sort((a, b) => a - b), reasons, radius: refit.radius, axis: refit.axis });
      continue;
    }
    found.push(candidateCylinder);
  }

  const merged = opts.merge === false ? { cylinders: found, count: 0 } : mergeCylinders(V, F, N, area, labels, patches, found, o);
  const uncertain = merged.cylinders.filter((c) => c.confidence === 'unsicher');
  const cylinders = opts.acceptUncertain ? merged.cylinders : merged.cylinders.filter((c) => c.confidence === 'sicher');
  for (const c of uncertain) {
    if (!opts.acceptUncertain) {
      rejected.push({ patchIds: c.patchIds, reasons: [`unsicher (${c.segments} Segmente, Bestätigung nötig)`], radius: c.radius, axis: c.axis });
    }
  }
  return { cylinders, rejected, uncertain, merged: merged.count, options: o };
}

/** Adds the area-weighted outer products of the triangle normals to a 3×3 sum. */
function addCovariance(m, N, area, triangles) {
  for (const t of triangles) {
    const x = N[3 * t];
    const y = N[3 * t + 1];
    const z = N[3 * t + 2];
    const w = area[t];
    m[0][0] += x * x * w;
    m[0][1] += x * y * w;
    m[0][2] += x * z * w;
    m[1][0] += y * x * w;
    m[1][1] += y * y * w;
    m[1][2] += y * z * w;
    m[2][0] += z * x * w;
    m[2][1] += z * y * w;
    m[2][2] += z * z * w;
  }
}

function normalCovarianceEigen(N, area, triangles) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  addCovariance(m, N, area, triangles);
  return eigh3(m);
}

/** True when every triangle passes the member test (no array copies in between). */
function allMembers(V, F, N, triangles, model, o) {
  for (const t of triangles) if (!isMember(V, F, N, t, model, o)) return false;
  return true;
}

/** Unique point indices of a set of triangles. */
function pointsOf(F, triangles) {
  const seen = new Set();
  for (const t of triangles) for (let k = 0; k < 3; k++) seen.add(F[3 * t + k]);
  return [...seen];
}

/**
 * Axis from the smallest eigenvalue of the normal covariance, radius from a
 * least-squares circle through the POINTS (they lie on the surface; the facets
 * lie inside it – MACHBARKEIT section 2).
 */
export function fitCylinder(V, F, N, area, triangles, opts = CYLINDER_DEFAULTS) {
  const eigen = normalCovarianceEigen(N, area, triangles);
  if (eigen.values[1] / Math.max(eigen.values[2], 1e-12) < opts.fitSpread) return null;
  const { axis, u1, u2 } = frame(eigen.vectors[0]);
  const ids = pointsOf(F, triangles);
  const xs = [];
  const ys = [];
  for (const v of ids) {
    const p = [V[3 * v], V[3 * v + 1], V[3 * v + 2]];
    xs.push(dot(p, u1));
    ys.push(dot(p, u2));
  }
  const circle = fitCircle(xs, ys);
  if (!circle) return null;
  return { axis, u1, u2, center2: circle.center, radius: circle.radius };
}

/** Point of the axis in 3D (the circle centre lifted into space). */
const axisPoint = (m) => [
  m.center2[0] * m.u1[0] + m.center2[1] * m.u2[0],
  m.center2[0] * m.u1[1] + m.center2[1] * m.u2[1],
  m.center2[0] * m.u1[2] + m.center2[1] * m.u2[2],
];

/**
 * Radial distance of a point from the axis, and its height along the axis.
 * This runs a few million times on a large mesh, so it reads the coordinates
 * straight out of the array instead of building vectors (measured: the member
 * test went from 2.5 s to under a second on 50 000 triangles).
 */
function cylindrical(V, v, m) {
  const px = V[3 * v];
  const py = V[3 * v + 1];
  const pz = V[3 * v + 2];
  const x = px * m.u1[0] + py * m.u1[1] + pz * m.u1[2] - m.center2[0];
  const y = px * m.u2[0] + py * m.u2[1] + pz * m.u2[2] - m.center2[1];
  return {
    radius: Math.hypot(x, y),
    angle: Math.atan2(y, x),
    height: px * m.axis[0] + py * m.axis[1] + pz * m.axis[2],
    x,
    y,
  };
}

/**
 * A triangle belongs to the cylinder only if all three points lie on it, its
 * normal is perpendicular to the axis and points radially. Measured: without
 * the radial test a tangential fillet swallows the wall behind it.
 */
function isMember(V, F, N, t, m, o) {
  const tolerance = o.radiusTolerance * m.radius + o.radiusToleranceAbsolute;
  const u1 = m.u1;
  const u2 = m.u2;
  const axis = m.axis;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < 3; k++) {
    const v = 3 * F[3 * t + k];
    const px = V[v];
    const py = V[v + 1];
    const pz = V[v + 2];
    const x = px * u1[0] + py * u1[1] + pz * u1[2] - m.center2[0];
    const y = px * u2[0] + py * u2[1] + pz * u2[2] - m.center2[1];
    if (Math.abs(Math.hypot(x, y) - m.radius) > tolerance) return false;
    sx += x;
    sy += y;
  }
  const len = Math.hypot(sx, sy);
  if (len < 1e-12) return false;
  const nx = N[3 * t];
  const ny = N[3 * t + 1];
  const nz = N[3 * t + 2];
  if (Math.abs(nx * axis[0] + ny * axis[1] + nz * axis[2]) >= o.axisTolerance) return false;
  const n1 = nx * u1[0] + ny * u1[1] + nz * u1[2];
  const n2 = nx * u2[0] + ny * u2[1] + nz * u2[2];
  return Math.abs((n1 * sx + n2 * sy) / len) > o.radialTolerance;
}

/** Everything the report and the reconstruction need about one cylinder. */
function describe(V, F, N, labels, patches, region, triangles, m, o) {
  const ids = pointsOf(F, triangles);
  // Does the material lie outside (fillet) or inside (bore)? The mesh normals
  // say it, and the exporter needs it for same_sense of the face.
  let outwardVotes = 0;
  for (const t of triangles) {
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 3; k++) {
      const c = cylindrical(V, F[3 * t + k], m);
      sx += c.x;
      sy += c.y;
    }
    const len = Math.hypot(sx, sy) || 1;
    const n = [N[3 * t], N[3 * t + 1], N[3 * t + 2]];
    outwardVotes += (dot(n, m.u1) * sx + dot(n, m.u2) * sy) / len > 0 ? 1 : -1;
  }
  let zMin = Infinity;
  let zMax = -Infinity;
  let residual = 0;
  const angles = [];
  for (const v of ids) {
    const c = cylindrical(V, v, m);
    if (c.height < zMin) zMin = c.height;
    if (c.height > zMax) zMax = c.height;
    residual = Math.max(residual, Math.abs(c.radius - m.radius));
    angles.push(c.angle);
  }
  const { arc, full } = angularExtent(angles);
  const facets = facetAngles(N, labels, patches, region, m);
  const segments = facets.segments;
  const uncertainty = m.radius * (1 - Math.cos(Math.PI / Math.max(segments, 3)));
  return {
    patchIds: [...region].sort((a, b) => a - b),
    triangles,
    axis: m.axis,
    center: axisPoint(m),
    radius: m.radius,
    zRange: [zMin, zMax],
    arc: (arc * 180) / Math.PI,
    full,
    segments,
    confidence: segments >= o.certainSegments ? 'sicher' : 'unsicher',
    residual,
    uncertainty,
    outward: outwardVotes >= 0,
    model: m,
  };
}

/** Angular extent of the points around the axis; `full` = closed tube. */
function angularExtent(angles) {
  const sorted = angles.map((a) => (a < 0 ? a + 2 * Math.PI : a)).sort((a, b) => a - b);
  let gap = 0;
  let gapAt = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 2 * Math.PI;
    if (next - sorted[i] > gap) {
      gap = next - sorted[i];
      gapAt = i;
    }
  }
  const full = gap < 0.5;
  return { arc: full ? 2 * Math.PI : 2 * Math.PI - gap, full, gapAt, sorted };
}

/**
 * Segments per full circle, from the mean angle between the facets: every
 * patch of the region is one facet of the prism that approximates the
 * cylinder. 360° / mean facet angle (SPEC 5.5, "Vertrauen").
 */
function facetAngles(N, labels, patches, region, m) {
  const directions = [];
  for (const k of region) {
    let sx = 0;
    let sy = 0;
    for (const t of patches[k]) {
      sx += dot([N[3 * t], N[3 * t + 1], N[3 * t + 2]], m.u1);
      sy += dot([N[3 * t], N[3 * t + 1], N[3 * t + 2]], m.u2);
    }
    if (Math.hypot(sx, sy) < 1e-12) continue;
    let a = Math.atan2(sy, sx);
    if (a < 0) a += 2 * Math.PI;
    directions.push(a);
  }
  directions.sort((a, b) => a - b);
  if (directions.length < 2) return { segments: directions.length, facetAngle: 2 * Math.PI };
  const gaps = [];
  for (let i = 1; i < directions.length; i++) gaps.push(directions[i] - directions[i - 1]);
  gaps.push(directions[0] + 2 * Math.PI - directions[directions.length - 1]);
  gaps.sort((a, b) => a - b);
  // The median gap is the facet angle; the largest gap may be the opening of
  // a fillet and must not count.
  const facetAngle = gaps[Math.floor(gaps.length / 2)];
  const segments = facetAngle > 1e-9 ? Math.round((2 * Math.PI) / facetAngle) : directions.length;
  return { segments, facetAngle };
}

/**
 * The counter-hypotheses of SPEC 5.5. Returns the list of reasons; empty means
 * accepted.
 */
export function verifyCylinder(V, F, N, triangles, m, info, context, o) {
  const reasons = [];
  const ids = pointsOf(F, triangles);
  const heights = [];
  const distances = [];
  for (const v of ids) {
    const c = cylindrical(V, v, m);
    heights.push(c.height);
    distances.push(c.radius);
  }
  const extent = maxOf(heights) - minOf(heights);
  if (extent < o.minLengthFactor * m.radius) {
    reasons.push(`zu kurz (${extent.toFixed(2)} < ${o.minLengthFactor} r)`);
  }
  const slope = Math.abs(fitSlope(heights, distances));
  if (slope * extent > o.radiusDriftTolerance * m.radius) {
    reasons.push(`Radius nicht konstant (Kegel? ${((100 * slope * extent) / m.radius).toFixed(1)} % r)`);
  }
  // Sphere: only when the points AND the normals fit it; the points of two
  // rings of a cylinder lie on a sphere of radius √(r² + (h/2)²).
  const points = ids.map((v) => [V[3 * v], V[3 * v + 1], V[3 * v + 2]]);
  const sphere = fitSphere(points);
  if (sphere) {
    let sphereResidual = 0;
    for (const p of points) sphereResidual = Math.max(sphereResidual, Math.abs(norm(sub(p, sphere.center)) - sphere.radius));
    let worstCosine = 1;
    for (const t of triangles) {
      const centroid = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const v = 3 * F[3 * t + k];
        for (let i = 0; i < 3; i++) centroid[i] += V[v + i] / 3;
      }
      const radial = normalize(sub(centroid, sphere.center));
      worstCosine = Math.min(worstCosine, Math.abs(dot([N[3 * t], N[3 * t + 1], N[3 * t + 2]], radial)));
    }
    const cylinderResidual = maxOf(distances.map((d) => Math.abs(d - m.radius)));
    if (sphereResidual < o.sphereResidual * m.radius
      && worstCosine > o.sphereNormalCosine
      && sphereResidual < cylinderResidual * 0.5 + 1e-9 + 0.002 * m.radius) {
      reasons.push(`Kugel passt besser (r = ${sphere.radius.toFixed(2)})`);
    }
  }
  if (info.segments < o.minSegments) {
    reasons.push(`Segmente < ${o.minSegments} (${info.segments}: Vieleck, kein Zylinder)`);
  }
  const boundary = boundaryVerdict(V, F, N, m, context, o);
  if (boundary) reasons.push(boundary);
  return reasons;
}

/**
 * The region must not end "in the surface" – the fix for the phantom
 * cylinders on a torus (SPEC 5.5, known weakness). Every boundary edge has to
 * end in a sharp edge (> smoothAngle), in a cap perpendicular to the axis, or
 * in a tangential transition to a plane that touches the cylinder.
 */
function boundaryVerdict(V, F, N, m, context, o) {
  const { adj, labels, patches, region } = context;
  const inRegion = (t) => region.has(labels[t]);
  const smooth = Math.cos((o.smoothAngleDegrees * Math.PI) / 180);
  const tangentLimit = Math.sin((o.boundaryTangentDegrees * Math.PI) / 180);
  let total = 0;
  let inSurface = 0;
  const planeCache = new Map();
  const patchTangent = (label) => {
    if (planeCache.has(label)) return planeCache.get(label);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const t of patches[label]) {
      nx += N[3 * t];
      ny += N[3 * t + 1];
      nz += N[3 * t + 2];
    }
    const n = normalize([nx, ny, nz]);
    let ok = false;
    if (Math.abs(dot(n, m.axis)) < tangentLimit) {
      // A plane parallel to the axis is tangential when it runs at distance r.
      const distance = distanceAxisToPlane(V, F, patches[label], m, n);
      ok = Math.abs(distance - m.radius) <= o.boundaryTangentTolerance * m.radius;
    }
    planeCache.set(label, ok);
    return ok;
  };

  for (let t = 0; t < F.length / 3; t++) {
    if (!inRegion(t)) continue;
    for (const u of neighbours(adj, t)) {
      if (inRegion(u)) continue;
      total += 1;
      const nt = [N[3 * t], N[3 * t + 1], N[3 * t + 2]];
      const nu = [N[3 * u], N[3 * u + 1], N[3 * u + 2]];
      if (dot(nt, nu) <= smooth) continue; // sharp edge: a proper end
      if (Math.abs(dot(nu, m.axis)) > 1 - tangentLimit) continue; // cap perpendicular to the axis
      if (patchTangent(labels[u])) continue; // tangential transition to a plane
      inSurface += 1;
    }
  }
  if (total === 0) return null;
  const share = inSurface / total;
  if (share > o.boundaryInSurfaceShare) {
    return `Rand endet in der Fläche (${Math.round(100 * share)} % der Randkanten; Torus?)`;
  }
  return null;
}

/** Distance of the cylinder axis from the plane of a patch. */
function distanceAxisToPlane(V, F, triangles, m, planeNormal) {
  const v = F[3 * triangles[0]];
  const p = [V[3 * v], V[3 * v + 1], V[3 * v + 2]];
  const a = axisPoint(m);
  // Component of (p − a) along the plane normal, with the axis direction
  // removed (the plane is parallel to the axis).
  const d = sub(p, a);
  const along = dot(d, m.axis);
  const radial = [d[0] - along * m.axis[0], d[1] - along * m.axis[1], d[2] - along * m.axis[2]];
  return Math.abs(dot(radial, planeNormal));
}

/**
 * Cylinders with the same axis, centre line and radius that touch each other
 * are one surface (measured: a hole fell apart into two pieces when the radius
 * was distorted – referenz/recon.py::merge_cylinders).
 */
function mergeCylinders(V, F, N, area, labels, patches, cylinders, o) {
  const list = cylinders.slice();
  let count = 0;
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (Math.abs(Math.abs(dot(a.axis, b.axis)) - 1) > o.mergeAxisTolerance) continue;
        const d = sub(b.center, a.center);
        const along = dot(d, a.axis);
        const offset = Math.hypot(d[0] - along * a.axis[0], d[1] - along * a.axis[1], d[2] - along * a.axis[2]);
        if (offset > o.mergeCenterTolerance * a.radius) continue;
        if (Math.abs(a.radius - b.radius) > o.mergeRadiusTolerance * a.radius) continue;
        if (!touching(F, a, b)) continue;
        const region = new Set([...a.patchIds, ...b.patchIds]);
        const triangles = [...region].flatMap((k) => [...patches[k]]);
        const model = fitCylinder(V, F, N, area, triangles, o) || a.model;
        list.splice(j, 1);
        list[i] = describe(V, F, N, labels, patches, region, triangles, model, o);
        count += 1;
        changed = true;
        break outer;
      }
    }
  }
  return { cylinders: list, count };
}

/** Do the two regions share an edge? */
function touching(F, a, b) {
  const edges = new Set();
  for (const t of a.triangles) for (const [u, v] of triEdges(F, t)) edges.add(undirectedKey(u, v));
  for (const t of b.triangles) for (const [u, v] of triEdges(F, t)) if (edges.has(undirectedKey(u, v))) return true;
  return false;
}
