// The whole way from the file to the result (docs/SPEC.md 3):
//
//   parse → weld → heal → components ─┬─ per component: build the highest tier
//                                     │   that passes verify, otherwise fall
//                                     │   back a tier and say why
//                                     └─ one STEP file, one solid per component
//
// Nothing is lost silently: every repair, every rejected feature and every
// fallback ends up in the result and from there in the report.

import { parseMesh } from './parse.js';
import { weldMesh } from './weld.js';
import { healMesh } from './heal.js';
import { growPatches } from './patches.js';
import { detectCylinders } from './cylinders.js';
import { facetedBrep, brepCounts, brepVolume } from './brep.js';
import { buildTopology, buildBrep, planeModel, cylinderModel, patchFlatness, classifyChain } from './topology.js';
import { applyConstraints } from './constraints.js';
import { verifyBrep } from './verify.js';
import { signedVolume, openEdges, bbox, triangleNormals } from './meshops.js';

/** Warn above this many triangles (SPEC 6.6). */
export const BIG_MESH_TRIANGLES = 500000;

/** The tiers in the order they are tried (SPEC 3). */
export const TIERS = [3, 2, 1];

export const TIER_NAMES = {
  3: 'Stufe 3 – Ebenen und Zylinder',
  2: 'Stufe 2 – verschmolzene Ebenen',
  1: 'Stufe 1 – jedes Dreieck eine Ebene',
  offen: 'offene Schale – das Netz ließ sich nicht schließen',
};

/**
 * convert(buffer, fileName, opts?, onProgress?) → Result
 * opts: { unitScale, cylinders, acceptUncertain, noisy, tier (force), forceFail,
 *         fillHoles, splitTJunctions, verify: {...} }
 */
export function convert(buffer, fileName = 'modell.stl', opts = {}, onProgress = () => {}) {
  const step = (key, text, fraction) => onProgress({ key, text, fraction });
  const warnings = [];

  step('parse', 'Datei lesen', 0.05);
  const parsed = parseMesh(buffer, fileName);
  warnings.push(...parsed.warnings);
  const triangleCount = parsed.tris.length / 9;
  if (triangleCount > BIG_MESH_TRIANGLES) {
    warnings.push(`${triangleCount.toLocaleString('de-DE')} Dreiecke – das kann Minuten dauern.`);
  }

  const scale = opts.unitScale ?? 1;
  if (scale !== 1) {
    for (let i = 0; i < parsed.tris.length; i++) parsed.tris[i] *= scale;
  }

  step('weld', 'Punkte verschweißen', 0.15);
  const welded = weldMesh(parsed.tris);

  step('heal', 'Netz prüfen und heilen', 0.3);
  const healed = healMesh({ V: welded.V, F: welded.F }, { weldTol: welded.tol, ...opts });

  const components = [];
  const total = healed.components.length || 1;
  healed.components.forEach((part, index) => {
    const base = 0.35 + (0.6 * index) / total;
    step('component', total > 1 ? `Körper ${index + 1} von ${total}` : 'Flächen erkennen', base);
    components.push(convertComponent(part, healed.report, opts, (f, text) => step('component', text, base + f * (0.6 / total))));
  });

  step('fertig', 'fertig', 1);
  const meshVolume = signedVolume(healed.V, healed.F);
  const sumBrep = components.reduce((s, c) => s + c.brepVolume, 0);
  if (Math.abs(sumBrep - meshVolume) > Math.max(1e-6, Math.abs(meshVolume) * 0.01)) {
    warnings.push(`Das Volumen aller Körper (${sumBrep.toFixed(2)} mm³) passt nicht zum Netz (${meshVolume.toFixed(2)} mm³).`);
  }
  if (healed.report.holesOpen.length > 0) {
    warnings.push(`${healed.report.holesOpen.length} Loch/Löcher ließen sich nicht füllen – das Ergebnis ist eine offene Schale.`);
  }
  return {
    fileName,
    components,
    warnings,
    healReport: healed.report,
    mesh: { V: healed.V, F: healed.F },
    meshVolume,
    triangles: healed.F.length / 3,
    unit: parsed.unit,
    scale,
  };
}

/** One component: the highest tier that passes the check. */
function convertComponent(part, healReport, opts, progress = () => {}) {
  const fallbackReasons = [];
  const mesh = { V: part.V, F: part.F };
  const meshVolume = signedVolume(mesh.V, mesh.F);
  const closed = openEdges(mesh.F).length === 0;

  let features = { cylinders: [], rejected: [], uncertain: [], patches: 0, merged: 0 };
  let analysis = null;
  if (closed && opts.cylinders !== false) {
    progress(0.1, 'Flächenstücke suchen');
    const patches = growPatches(mesh, { noisy: opts.noisy });
    progress(0.4, 'Zylinder erkennen');
    const detected = detectCylinders(mesh, patches, { acceptUncertain: opts.acceptUncertain, merge: opts.merge });
    analysis = { patches, detected };
    features = {
      cylinders: detected.cylinders,
      rejected: detected.rejected,
      uncertain: detected.uncertain,
      patches: patches.patches.length,
      merged: detected.merged,
    };
  } else if (closed) {
    progress(0.1, 'Flächenstücke suchen');
    const patches = growPatches(mesh, { noisy: opts.noisy });
    analysis = { patches, detected: { cylinders: [], rejected: [], uncertain: [], merged: 0 } };
    features = { cylinders: [], rejected: [], uncertain: [], patches: patches.patches.length, merged: 0 };
    fallbackReasons.push('Zylindererkennung war abgeschaltet.');
  }

  const wanted = opts.tier ? [opts.tier] : TIERS;
  for (const tier of wanted) {
    const builder = TIER_BUILDERS[tier];
    if (!builder) continue;
    progress(0.6, `${TIER_NAMES[tier]} bauen`);
    let built;
    try {
      built = builder(mesh, analysis, opts);
    } catch (err) {
      fallbackReasons.push(`${TIER_NAMES[tier]}: Bau fehlgeschlagen (${err.message}).`);
      continue;
    }
    if (!built) {
      fallbackReasons.push(`${TIER_NAMES[tier]}: nicht anwendbar.`);
      continue;
    }
    const check = verifyBrep(built.brep, mesh, {
      surfaceTolerance: built.surfaceTolerance,
      ...(opts.verify || {}),
      regionOfTriangle: built.regionOfTriangle,
      uncertainty: Math.max(0, ...features.cylinders.map((c) => c.uncertainty)),
      forceFail: opts.forceFail?.[`tier${tier}`],
    });
    if (check.ok) {
      return {
        tier,
        brep: built.brep,
        healReport,
        features: built.cylinders ? { ...features, cylinders: built.cylinders } : features,
        fallbackReasons: [...fallbackReasons, ...(built.notes ?? [])],
        meshVolume,
        brepVolume: check.volume,
        maxDeviation: check.maxDeviation,
        deviationPercent: check.deviationPercent,
        checks: check.checks,
        counts: check.counts,
        open: false,
      };
    }
    fallbackReasons.push(`${TIER_NAMES[tier]}: ${check.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join('; ')}`);
  }

  // Nothing worked: an open shell, with a clear warning (SPEC 3).
  const brep = facetedBrep(mesh, 'Körper');
  const volume = brepVolume(brep);
  return {
    tier: 'offen',
    brep,
    healReport,
    features,
    fallbackReasons: [...fallbackReasons, closed ? 'Alle Stufen fielen durch die Prüfung.' : 'Das Netz ist nach der Heilung noch offen.'],
    meshVolume,
    brepVolume: volume,
    maxDeviation: 0,
    deviationPercent: meshVolume ? (100 * (volume - meshVolume)) / meshVolume : 0,
    checks: [],
    counts: brepCounts(brep),
    open: true,
  };
}

/**
 * The builders per tier. Each one returns { brep, regionOfTriangle } or null
 * when it does not apply. Tiers 2 and 3 are added by their own steps of the
 * plan; the chain always ends at tier 1, which works for every closed mesh.
 */
export const TIER_BUILDERS = {
  // Tier 1 is exact by construction: every face IS a triangle of the mesh.
  1: (mesh) => ({ brep: facetedBrep(mesh, 'Körper'), regionOfTriangle: null, surfaceTolerance: 1e-9 }),
  2: (mesh, analysis, opts) => buildPlanarTier(mesh, analysis, opts),
  3: (mesh, analysis, opts) => buildExactTier(mesh, analysis, opts),
};

/**
 * Tier 3: recognised cylinders become real cylindrical faces with arcs as
 * edges, everything flat around them one planar face each. Before the build
 * the constraints of SPEC 5.6 run, because the fitted surfaces otherwise
 * almost – but not exactly – fit together (MACHBARKEIT section 4).
 */
export function buildExactTier(mesh, analysis, opts = {}) {
  const accepted = analysis?.detected?.cylinders ?? [];
  if (accepted.length === 0) return null; // nothing to gain over tier 2
  const patchResult = analysis.patches;
  const diagonal = bbox(mesh.V).diagonal;
  const limit = (opts.planarTolerance ?? PLANAR_TOLERANCE_RELATIVE) * diagonal;
  const { N } = triangleNormals(mesh.V, mesh.F);
  const regionNotes = [];

  // A cylindrical region whose boundary is a shape tier 3 cannot build (SPEC
  // 5.7 step 7) falls back on its own: its patches stay planar patches, and
  // the rest of the part keeps tier 3.
  let cylinders = accepted;
  let setup = null;
  for (let round = 0; round < 4; round += 1) {
    setup = regionsFor(mesh, patchResult, cylinders, limit, N);
    const unbuildable = cylinders.filter((_, i) => !buildableBoundary(setup.topology, setup.regionOfCylinder[i], setup.geometryKinds));
    if (unbuildable.length === 0) break;
    for (const c of unbuildable) {
      regionNotes.push(`Zylinder r = ${c.radius.toFixed(3)} blieb Ebenenstück: seine Randform kann Stufe 3 nicht bauen.`);
    }
    cylinders = cylinders.filter((c) => !unbuildable.includes(c));
    if (cylinders.length === 0) return null;
  }

  const constrained = applyConstraints(mesh, setup.models, setup.topology, opts.constraints ?? {});
  const brep = buildBrep(mesh, setup.regionOfTriangle, constrained.models, setup.topology, {
    diagonal,
    name: 'Körper',
    points: constrained.points,
  });
  return {
    brep,
    regionOfTriangle: setup.regionOfTriangle,
    topology: setup.topology,
    models: constrained.models,
    constraintReport: constrained.report,
    cylinders,
    notes: regionNotes,
    // Tier 3 builds exact surfaces and snaps the corners onto them, so the
    // corners have to lie on them to machine precision (measured: 1e-15 with
    // the constraints, 1e-6 to 3e-3 without them – MACHBARKEIT section 4).
    surfaceTolerance: 1e-9,
  };
}

/** Regions and models for tier 3: cylinders first, then the flat patches. */
function regionsFor(mesh, patchResult, cylinders, limit, N) {
  const regionOfTriangle = new Int32Array(mesh.F.length / 3).fill(-1);
  const models = new Map();
  const regionOfCylinder = [];
  let next = 0;
  const taken = new Set();
  for (const cylinder of cylinders) {
    const region = next++;
    regionOfCylinder.push(region);
    for (const patch of cylinder.patchIds) taken.add(patch);
    for (const t of cylinder.triangles) regionOfTriangle[t] = region;
    models.set(region, cylinderModel(cylinder));
  }
  patchResult.patches.forEach((triangles, i) => {
    if (taken.has(i)) return;
    const plane = patchResult.planes[i];
    if (patchFlatness(mesh, triangles, plane) <= limit) {
      const region = next++;
      for (const t of triangles) regionOfTriangle[t] = region;
      models.set(region, planeModel(plane));
      return;
    }
    for (const t of triangles) {
      const region = next++;
      regionOfTriangle[t] = region;
      const v = 3 * mesh.F[3 * t];
      models.set(region, planeModel({
        point: [mesh.V[v], mesh.V[v + 1], mesh.V[v + 2]],
        normal: [N[3 * t], N[3 * t + 1], N[3 * t + 2]],
      }));
    }
  });
  const topology = buildTopology(mesh, regionOfTriangle, models);
  const geometryKinds = topology.chains.map((chain) => classifyChain(mesh, chain, models, 1).kind);
  return { regionOfTriangle, models, topology, regionOfCylinder, geometryKinds };
}

/** Can tier 3 build this cylindrical region: one loop, or two full rings? */
function buildableBoundary(topology, region, kinds) {
  const loops = topology.loops.get(region) ?? [];
  if (loops.length === 1) return true;
  if (loops.length !== 2) return false;
  return loops.every((loop) => loop.every((id) => kinds[id] === 'circle'));
}

/** Patches flatter than this (· diagonal) may become one planar face. */
export const PLANAR_TOLERANCE_RELATIVE = 1e-6;

/**
 * Tier 2: patches that really are flat become one planar face with holes;
 * everything else stays facets. Measured: the patches of a sphere or a torus
 * are up to 1e-2 mm away from their own plane, and a plane whose boundary
 * does not lie on it is not a valid face – on the plate all 134 patches are
 * flat to 2e-6 mm, so nothing is lost there.
 */
export function buildPlanarTier(mesh, analysis, opts = {}) {
  const patchResult = analysis?.patches ?? growPatches(mesh, { noisy: opts.noisy });
  const diagonal = bbox(mesh.V).diagonal;
  const limit = (opts.planarTolerance ?? PLANAR_TOLERANCE_RELATIVE) * diagonal;
  const { N } = triangleNormals(mesh.V, mesh.F);

  const regionOfTriangle = new Int32Array(mesh.F.length / 3).fill(-1);
  const models = new Map();
  let next = 0;
  patchResult.patches.forEach((triangles, i) => {
    const plane = patchResult.planes[i];
    if (patchFlatness(mesh, triangles, plane) <= limit) {
      const region = next++;
      for (const t of triangles) regionOfTriangle[t] = region;
      models.set(region, planeModel(plane));
      return;
    }
    // Not flat: every triangle stays its own face (tier 1 within tier 2).
    for (const t of triangles) {
      const region = next++;
      regionOfTriangle[t] = region;
      const v = 3 * mesh.F[3 * t];
      models.set(region, planeModel({
        point: [mesh.V[v], mesh.V[v + 1], mesh.V[v + 2]],
        normal: [N[3 * t], N[3 * t + 1], N[3 * t + 2]],
      }));
    }
  });

  const topology = buildTopology(mesh, regionOfTriangle, models);
  const brep = buildBrep(mesh, regionOfTriangle, models, topology, { diagonal, name: 'Körper' });
  // The plane of a patch is its average plane, so the face promises exactly
  // the flatness limit it was accepted with – and verify holds it to that.
  return { brep, regionOfTriangle, topology, models, surfaceTolerance: limit };
}
