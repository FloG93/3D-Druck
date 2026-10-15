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
  requireClosed: true,
};

/**
 * verifyBrep(brep, mesh, opts?) → { ok, checks: [{ name, ok, detail }] }
 * opts.forceFail = { tier1, tier2, tier3 } lets the tests force a fallback.
 */
export function verifyBrep(brep, mesh, opts = {}) {
  const o = { ...VERIFY_DEFAULTS, ...opts };
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

  // 5. A higher tier must not have more faces than a lower one.
  if (opts.facesOfLowerTier !== undefined) {
    add('Flächenzahl gegen niedrigere Stufe', counts.faces <= opts.facesOfLowerTier,
      `${counts.faces} gegen ${opts.facesOfLowerTier}`);
  }

  if (opts.forceFail) add('Erzwungener Fehlschlag (Test)', false, 'forceFail');

  return {
    ok: checks.every((c) => c.ok),
    checks,
    volume,
    meshVolume,
    deviationPercent: deviation,
    maxDeviation,
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
