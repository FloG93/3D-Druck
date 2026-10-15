// Checking the B-rep before anything is written (docs/SPEC.md 5.9). The
// thresholds are options and every check reports its number, so a fallback
// always has a reason the report can name.

import { brepVolume, brepCounts, loopVertices } from './brep.js';
import { signedVolume, bbox } from './meshops.js';
import { dot, normalize, sub, norm } from './linalg.js';

export const VERIFY_DEFAULTS = {
  volumeTolerancePercent: 1, // SPEC 5.9: chord error measured ≤ 0.3 %
  deviationRelative: 1e-3, // max distance mesh ↔ surface, · diagonal
  uncertaintyFactor: 3, // … or 3 · the uncertainty of the recognition
  // Every corner has to lie on every surface that meets there, within the
  // uncertainty the STEP file itself declares (1e-6 mm). Measured in
  // MACHBARKEIT section 4: without the constraints the fitted wall plane
  // misses the fitted cylinder by about 4e-4 mm, and the wire stays open in
  // the CAD kernel – a combinatorially perfect B-rep can still be unusable.
  surfaceTolerance: 1e-6,
  requireClosed: true,
};

/**
 * verifyBrep(brep, mesh, opts?) → { ok, checks: [{ name, ok, detail }] }
 * opts.forceFail = { tier1, tier2, tier3 } lets the tests force a fallback.
 */
export function verifyBrep(brep, mesh, opts = {}) {
  // An option that is not set must not overwrite a default with `undefined`.
  const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  const o = { ...VERIFY_DEFAULTS, ...given };
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // 1. Every edge exactly twice, in opposite directions.
  const uses = new Map();
  for (const face of brep.faces) {
    for (const loop of face.loops) {
      for (const use of loop) {
        const key = use.edge;
        const entry = uses.get(key) || { forward: 0, backward: 0 };
        if (use.sense) entry.forward += 1;
        else entry.backward += 1;
        uses.set(key, entry);
      }
    }
  }
  let wrongEdges = 0;
  for (const [, entry] of uses) if (entry.forward !== 1 || entry.backward !== 1) wrongEdges += 1;
  const unused = brep.edges.length - uses.size;
  add('Kanten genau zweimal gegenläufig', o.requireClosed ? wrongEdges === 0 && unused === 0 : true,
    wrongEdges === 0 && unused === 0 ? 'alle' : `${wrongEdges} Kanten falsch benutzt, ${unused} unbenutzt`);

  // 2. Euler per shell: V − E + F = 2 − 2·handles, so the parity has to work out.
  const counts = brepCounts(brep);
  const euler = counts.points - counts.edges + counts.faces;
  const expectedEuler = 2 * counts.solids;
  add('Euler-Formel', euler === expectedEuler || (expectedEuler - euler) % 2 === 0,
    `V−E+F = ${euler} (${counts.points}−${counts.edges}+${counts.faces}), erwartet ${expectedEuler} oder 2−2·Henkel`);

  // 3. Volume of the B-rep against the volume of the mesh.
  const meshVolume = signedVolume(mesh.V, mesh.F);
  const volume = brepVolume(brep);
  const deviation = meshVolume !== 0 ? (100 * (volume - meshVolume)) / meshVolume : 0;
  add('Volumen Brep ↔ Netz', Math.abs(deviation) <= o.volumeTolerancePercent,
    `${volume.toFixed(4)} gegen ${meshVolume.toFixed(4)} (${deviation >= 0 ? '+' : ''}${deviation.toFixed(4)} %)`);

  // 4. Largest distance of a mesh point from the surface of its region.
  const diagonal = bbox(mesh.V).diagonal;
  const limit = Math.max(o.deviationRelative * diagonal, o.uncertaintyFactor * (opts.uncertainty ?? 0));
  const maxDeviation = surfaceDeviation(brep, mesh, opts.regionOfTriangle);
  add('Abstand Netz ↔ Fläche', maxDeviation <= limit, `${maxDeviation.toExponential(2)} ≤ ${limit.toExponential(2)}`);

  // SPEC 5.9 also wanted "tier 3 must not have more faces than tier 2" here.
  // That cannot be checked while walking the tiers from the top: when tier 3
  // is being checked, tier 2 has not been built, and when tier 2 is being
  // checked, tier 3 has already failed. The comparison is a property of the
  // whole corpus instead and is tested in tests/exact.test.mjs over every
  // fixture (noted in SPEC 5.9).

  // 5. Geometric consistency: does every corner lie on its surfaces?
  const geometry = geometricError(brep);
  const geometryLimit = Math.max(o.surfaceTolerance, 1e-9 * diagonal);
  add('Eckpunkte liegen auf ihren Flächen', geometry.worst <= geometryLimit,
    `größter Abstand ${geometry.worst.toExponential(2)} ≤ ${geometryLimit.toExponential(2)}${geometry.face >= 0 ? ` (Fläche ${geometry.face})` : ''}`);

  if (opts.forceFail) add('Erzwungener Fehlschlag (Test)', false, 'forceFail');

  return {
    ok: checks.every((c) => c.ok),
    checks,
    volume,
    meshVolume,
    deviationPercent: deviation,
    maxDeviation,
    geometricError: geometry.worst,
    counts,
  };
}

/**
 * Largest distance of a mesh point from the surface of the face that was built
 * from its triangle. Without the mapping (tier 1) the faces are the triangles
 * themselves and the distance is zero by construction.
 */
function surfaceDeviation(brep, mesh, regionOfTriangle) {
  if (!regionOfTriangle) return 0;
  const { V, F } = mesh;
  const byRegion = new Map();
  for (const face of brep.faces) if (face.region >= 0 && !byRegion.has(face.region)) byRegion.set(face.region, face.surface);
  let worst = 0;
  for (let t = 0; t < F.length / 3; t++) {
    const surface = byRegion.get(regionOfTriangle[t]);
    if (!surface) continue;
    for (let k = 0; k < 3; k++) {
      const v = 3 * F[3 * t + k];
      const p = [V[v], V[v + 1], V[v + 2]];
      const d = surface.type === 'cylinder' ? cylinderDistance(p, surface) : Math.abs(dot(sub(p, surface.point), normalize(surface.normal)));
      if (d > worst) worst = d;
    }
  }
  return worst;
}

function cylinderDistance(p, surface) {
  const axis = normalize(surface.axis);
  const d = sub(p, surface.point);
  const along = dot(d, axis);
  const radial = norm([d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]]);
  return Math.abs(radial - surface.radius);
}

/**
 * Largest distance of a corner from the surface of a face that uses it, plus
 * the same for the plane of an arc: a cap plane and the circle it cuts out of
 * a cylinder have to be the same plane.
 */
export function geometricError(brep) {
  let worst = 0;
  let face = -1;
  const note = (d, i) => {
    if (d > worst) {
      worst = d;
      face = i;
    }
  };
  for (const [i, f] of brep.faces.entries()) {
    for (const loop of f.loops) {
      for (const use of loop) {
        const edge = brep.edges[use.edge];
        for (const v of [edge.v0, edge.v1]) note(distanceToSurface(brep.points[v], f.surface), i);
        if (edge.curve.type !== 'circle') continue;
        note(distanceToSurface(edge.curve.center, f.surface, true), i);
        if (f.surface.type === 'plane') {
          // The circle has to lie IN the plane: its axis is the normal.
          const cosine = Math.abs(dot(normalize(edge.curve.axis), normalize(f.surface.normal)));
          note((1 - cosine) * edge.curve.radius, i);
        }
      }
    }
  }
  return { worst, face };
}

/** Distance of a point from a surface; `center` treats it as a point on the axis. */
function distanceToSurface(p, surface, center = false) {
  if (surface.type === 'plane') return Math.abs(dot(sub(p, surface.point), normalize(surface.normal)));
  const axis = normalize(surface.axis);
  const d = sub(p, surface.point);
  const along = dot(d, axis);
  const radial = norm([d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]]);
  return center ? radial : Math.abs(radial - surface.radius);
}
