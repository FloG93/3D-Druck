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
import { verifyBrep } from './verify.js';
import { signedVolume, openEdges } from './meshops.js';

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
  let facesOfLowerTier;
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
      ...(opts.verify || {}),
      regionOfTriangle: built.regionOfTriangle,
      uncertainty: Math.max(0, ...features.cylinders.map((c) => c.uncertainty)),
      facesOfLowerTier,
      forceFail: opts.forceFail?.[`tier${tier}`],
    });
    facesOfLowerTier = check.counts.faces;
    if (check.ok) {
      return {
        tier,
        brep: built.brep,
        healReport,
        features,
        fallbackReasons,
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
  1: (mesh) => ({ brep: facetedBrep(mesh, 'Körper'), regionOfTriangle: null }),
};
