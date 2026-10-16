// The repair step in front of the conversion: diagnose → repair → validate.
//
//   diagnose(V, F)                  what is wrong (core/diagnose.js)
//   healMesh({V, F}, opts)          what is repaired (core/heal.js, SPEC 5.3)
//   validate(original, repaired)    how far the repair moved the surface
//   repairMesh(mesh, opts)          all three, with the policy for a repair
//                                   that moves the surface too far
//
// A repair changes the geometry a little – a filled hole is an estimate. The
// validation is therefore not optional: it measures how far the new surface
// is from the old one and what happened to the volume, and the report says so.

import { bbox, signedVolume } from './meshops.js';
import { healMesh, isDegenerateTriangle } from './heal.js';
import { diagnose } from './diagnose.js';
import { TripleSet, TriangleGrid } from './spatial.js';

/** Defaults of the optional repair settings (opts.repair of convert()). */
export const REPAIR_DEFAULTS = {
  maxDeviation: 0.01, // furthest the surface may move, as a share of the diagonal
  maxVolumeChange: 1, // percent, like the one-percent rule of the verification
  onExceed: 'warn', // 'warn' keep and say so | 'discard' redo without filling holes | 'abort'
  minShellTriangles: 0, // tiny loose shells go below this size (0 = keep every shell)
  minShellVolume: 0, // … or below this share of the largest shell's volume
  intersections: false, // the self-intersection test is the slow one
};

const de = (v, digits = 0) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 }) : '–');
const plural = (n, one, many) => `${de(n)} ${n === 1 ? one : many}`;

/** Exact lookup of the points of a mesh by their coordinates (open addressing). */
function pointIndex(V) {
  const n = V.length / 3;
  let size = 16;
  while (size < 2 * n) size *= 2;
  const mask = size - 1;
  const slots = new Int32Array(size).fill(-1);
  const coords = new Float64Array(3);
  const bits = new Int32Array(coords.buffer);
  const hash = (x, y, z) => {
    coords[0] = x;
    coords[1] = y;
    coords[2] = z;
    let h = 0;
    for (let k = 0; k < 6; k++) h = Math.imul(h ^ bits[k], 0x9e3779b1) ^ (h >>> 13);
    return h & mask;
  };
  for (let i = 0; i < n; i++) {
    let s = hash(V[3 * i], V[3 * i + 1], V[3 * i + 2]);
    while (slots[s] !== -1) s = (s + 1) & mask;
    slots[s] = i;
  }
  return (x, y, z) => {
    let s = hash(x, y, z);
    while (slots[s] !== -1) {
      const i = slots[s];
      if (V[3 * i] === x && V[3 * i + 1] === y && V[3 * i + 2] === z) return i;
      s = (s + 1) & mask;
    }
    return -1;
  };
}

const sameArray = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Points on a triangle that stand for its surface: the centre and the three
 * edge midpoints. (The corners are mesh points and lie on the surface anyway.)
 */
function samplesOf(V, F, t, out) {
  const p = [0, 1, 2].map((k) => [V[3 * F[3 * t + k]], V[3 * F[3 * t + k] + 1], V[3 * F[3 * t + k] + 2]]);
  out.push([(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3]);
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) out.push([(p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2, (p[a][2] + p[b][2]) / 2]);
}

/**
 * validate(original, repaired, tolerance?, after?, before?) → ValidationResult
 *
 * Which triangles the repair added and which it took away is found by their
 * points (repair never moves a point, so triangles can be matched exactly).
 * New triangles are sampled against the ORIGINAL surface, removed ones against
 * the REPAIRED surface; the largest distance is the deviation. The rest of the
 * surface is untouched and needs no test – which also keeps a clean mesh free.
 *
 *   changed            the repair did something to the triangles
 *   addedTriangles / removedTriangles
 *   maxDeviation       largest distance in mesh units, deviationRelative of the diagonal
 *   volumeBefore/After absolute values
 *   volumeChangePercent  only when the original was closed and consistently
 *                      wound (volumeComparable): the signed volume of a mesh
 *                      with holes, doubled triangles or turned neighbours is
 *                      no measure of anything, and a comparison with it would
 *                      report changes that never happened. Otherwise null.
 *   watertight, volumePositive
 *   exceeded + reasons the tolerance is overstepped; ok = closed and not exceeded
 */
export function validate(original, repaired, tolerance = {}, after = null, before = null) {
  const tol = { maxDeviation: REPAIR_DEFAULTS.maxDeviation, maxVolumeChange: REPAIR_DEFAULTS.maxVolumeChange, ...tolerance };
  const box = bbox(original.V);
  const afterReport = after ?? diagnose(repaired.V, repaired.F, { intersections: false });
  const beforeReport = before ?? diagnose(original.V, original.F, { intersections: false });
  const volumeBefore = Math.abs(signedVolume(original.V, original.F));
  const volumeAfter = Math.abs(signedVolume(repaired.V, repaired.F));
  const result = {
    changed: !(sameArray(original.F, repaired.F) && sameArray(original.V, repaired.V)),
    addedTriangles: 0,
    removedTriangles: 0,
    samples: 0,
    maxDeviation: 0,
    deviationRelative: 0,
    volumeBefore,
    volumeAfter,
    volumeChangePercent: 0,
    volumeComparable: beforeReport.watertight,
    watertight: afterReport.watertight,
    volumePositive: afterReport.volume > 0,
    tolerance: tol,
    exceeded: false,
    reasons: [],
    ok: true,
  };

  if (result.changed) {
    const find = pointIndex(original.V);
    const toOriginal = new Int32Array(repaired.V.length / 3);
    for (let i = 0; i < toOriginal.length; i++) toOriginal[i] = find(repaired.V[3 * i], repaired.V[3 * i + 1], repaired.V[3 * i + 2]);
    const nOriginal = original.F.length / 3;
    const nRepaired = repaired.F.length / 3;
    const inOriginal = new TripleSet(nOriginal);
    for (let t = 0; t < nOriginal; t++) inOriginal.add(original.F[3 * t], original.F[3 * t + 1], original.F[3 * t + 2]);
    const inRepaired = new TripleSet(nRepaired);
    const added = [];
    for (let t = 0; t < nRepaired; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => toOriginal[repaired.F[3 * t + k]]);
      if (a < 0 || b < 0 || c < 0 || !inOriginal.has(a, b, c)) added.push(t);
      if (a >= 0 && b >= 0 && c >= 0) inRepaired.add(a, b, c);
    }
    const removed = [];
    for (let t = 0; t < nOriginal; t++) {
      if (!inRepaired.has(original.F[3 * t], original.F[3 * t + 1], original.F[3 * t + 2])) removed.push(t);
    }
    result.addedTriangles = added.length;
    result.removedTriangles = removed.length;

    let worst = 0;
    const measure = (grid, V, F, triangles) => {
      const points = [];
      // A triangle without area is no part of the surface: nothing of it can deviate.
      for (const t of triangles) if (!isDegenerateTriangle(V, F, t, box.diagonal)) samplesOf(V, F, t, points);
      result.samples += points.length;
      for (const p of points) {
        const d = grid.nearest(p);
        if (d > worst) worst = d;
      }
    };
    if (added.length > 0 && nOriginal > 0) measure(new TriangleGrid(original.V, original.F), repaired.V, repaired.F, added);
    if (removed.length > 0 && nRepaired > 0) measure(new TriangleGrid(repaired.V, repaired.F), original.V, original.F, removed);
    result.maxDeviation = worst;
    result.deviationRelative = box.diagonal > 0 ? worst / box.diagonal : 0;
  }
  result.volumeChangePercent = result.volumeComparable && volumeBefore > 1e-12 ? ((volumeAfter - volumeBefore) / volumeBefore) * 100 : null;

  if (result.deviationRelative > tol.maxDeviation) {
    result.reasons.push(`Abweichung ${de(result.maxDeviation, 4)} mm (${de(result.deviationRelative * 100, 2)} % der Diagonale) über der Toleranz von ${de(tol.maxDeviation * 100, 2)} %`);
  }
  if (result.volumeChangePercent !== null && Math.abs(result.volumeChangePercent) > tol.maxVolumeChange) {
    result.reasons.push(`Volumen ändert sich um ${de(result.volumeChangePercent, 2)} % (erlaubt: ${de(tol.maxVolumeChange, 2)} %)`);
  }
  result.exceeded = result.reasons.length > 0;
  result.ok = result.watertight && result.volumePositive && !result.exceeded;
  return result;
}

/** One-line summary of a diagnosis, for messages. */
export function summarize(report) {
  const parts = [];
  if (report.boundaryEdges) parts.push(plural(report.boundaryEdges, 'offene Randkante', 'offene Randkanten') + (report.holes.length ? ` in ${plural(report.holes.length, 'Loch', 'Löchern')}` : ''));
  if (report.nonManifoldEdges) parts.push(plural(report.nonManifoldEdges, 'nicht-manifold Kante', 'nicht-manifold Kanten'));
  if (report.nonManifoldVertices) parts.push(plural(report.nonManifoldVertices, 'Berührungspunkt', 'Berührungspunkte'));
  if (report.windingConflicts) parts.push(plural(report.windingConflicts, 'Kante mit widersprüchlicher Orientierung', 'Kanten mit widersprüchlicher Orientierung'));
  if (report.degenerate) parts.push(plural(report.degenerate, 'entartetes Dreieck', 'entartete Dreiecke'));
  if (report.duplicate) parts.push(plural(report.duplicate, 'doppeltes Dreieck', 'doppelte Dreiecke'));
  if (report.inverted) parts.push('Netz nach innen orientiert (Volumen < 0)');
  if (report.selfIntersections?.count) parts.push(plural(report.selfIntersections.count, 'Selbstüberschneidung', 'Selbstüberschneidungen') + (report.selfIntersections.capped ? ' (mindestens)' : ''));
  return parts.length ? parts.join(', ') : 'keine Mängel gefunden';
}

/**
 * The repairs of a healing report as sentences with their numbers – empty
 * when nothing happened. The interface and the console report both use this.
 */
export function repairSteps(report) {
  const lines = [];
  const add = (n, one, many) => {
    if (n > 0) lines.push(plural(n, one, many));
  };
  add(report.degenerate, 'Dreieck ohne Fläche entfernt', 'Dreiecke ohne Fläche entfernt');
  add(report.duplicate, 'doppeltes Dreieck entfernt', 'doppelte Dreiecke entfernt');
  add(report.tJunctionsSplit, 'T-Kreuzung geteilt', 'T-Kreuzungen geteilt');
  add(report.nonManifoldRemoved, 'überzähliges Dreieck an einer Kante entfernt', 'überzählige Dreiecke an Kanten entfernt');
  add(report.flipped, 'Dreieck gedreht', 'Dreiecke gedreht');
  add(report.holesFilled, 'Loch gefüllt', 'Löcher gefüllt');
  add(report.unusedPoints, 'unbenutzter Punkt entfernt', 'unbenutzte Punkte entfernt');
  if (report.orientedGlobally) lines.push('Das Netz war komplett nach innen gedreht und wurde umgedreht.');
  for (const hole of report.holesOpen) {
    lines.push(`Loch mit ${plural(hole.edges, 'Kante', 'Kanten')} blieb offen (${hole.reason}).`);
  }
  for (const shell of report.shellsRemoved || []) {
    lines.push(`Kleine Schale entfernt (${plural(shell.triangles, 'Dreieck', 'Dreiecke')}, Volumen ${de(shell.volume, 3)} mm³).`);
  }
  for (const skipped of report.skipped || []) lines.push(`Abgeschaltet: ${skipped}.`);
  return lines;
}

/**
 * repairMesh({ V, F }, opts?) → { V, F, report, components, repair }
 * Same as healMesh() plus `repair`: the diagnosis before and after, the
 * validation, the outcome ('unverändert', 'repariert' or 'verworfen'), the
 * warnings and the time of each step. opts.repair holds REPAIR_DEFAULTS
 * overrides; every other option goes to healMesh() unchanged.
 */
export function repairMesh(mesh, opts = {}) {
  const settings = { ...REPAIR_DEFAULTS, ...(opts.repair || {}) };
  const timings = {};
  const timed = (name, work) => {
    const start = performance.now();
    const value = work();
    timings[name] = Math.round(performance.now() - start);
    return value;
  };
  const healOptions = (extra = {}) => ({
    ...opts,
    minShellTriangles: settings.minShellTriangles,
    minShellVolume: settings.minShellVolume,
    ...extra,
  });

  const before = timed('Diagnose vorher', () => diagnose(mesh.V, mesh.F, { intersections: settings.intersections }));
  let healed = timed('Reparatur', () => healMesh(mesh, healOptions()));
  // A mesh the repair did not touch has the diagnosis it had before: no second pass over a million triangles.
  const untouched = (result) => sameArray(mesh.F, result.F) && sameArray(mesh.V, result.V);
  let after = timed('Diagnose nachher', () => (untouched(healed) ? before : diagnose(healed.V, healed.F, { intersections: settings.intersections })));
  let validation = timed('Prüfung gegen die Eingabe', () => validate(mesh, healed, settings, after, before));
  let outcome = validation.changed ? 'repariert' : 'unverändert';
  const warnings = [];

  if (validation.exceeded) {
    const why = validation.reasons.join('; ');
    if (settings.onExceed === 'abort') {
      throw new Error(`Die Reparatur verändert das Netz zu stark: ${why}. Befund der Eingabe: ${summarize(before)}.`);
    }
    if (settings.onExceed === 'discard') {
      // The only step that moves the surface noticeably is the hole filling.
      const kept = healed;
      healed = timed('Reparatur ohne Löcher füllen', () => healMesh(mesh, healOptions({ fillHoles: false, minShellTriangles: 0, minShellVolume: 0 })));
      after = untouched(healed) ? before : diagnose(healed.V, healed.F, { intersections: settings.intersections });
      validation = validate(mesh, healed, settings, after, before);
      outcome = 'verworfen';
      warnings.push(`Die Reparatur wurde verworfen (${why}); das Netz ist ohne Löcher füllen bereinigt. ${kept.report.holesFilled === 1 ? '1 Loch blieb' : `${de(kept.report.holesFilled)} Löcher blieben`} offen.`);
    } else {
      warnings.push(`Die Reparatur verändert das Netz mehr als erlaubt: ${why}.`);
    }
  }
  for (const hole of healed.report.holesLarge) {
    warnings.push(`Großes Loch geschlossen (${plural(hole.edges, 'Kante', 'Kanten')}, ${de(hole.diameter, 2)} mm breit): die Füllung ist nur eine Schätzung der Fläche.`);
  }
  if (after.selfIntersections?.count) {
    warnings.push(`${plural(after.selfIntersections.count, 'Selbstüberschneidung', 'Selbstüberschneidungen')}${after.selfIntersections.capped ? ' (mindestens)' : ''} im Netz – die Reparatur behebt sie nicht.`);
  }

  Object.assign(timings, healed.report.timings);
  return {
    ...healed,
    repair: { settings, before, after, validation, outcome, warnings, timings },
  };
}

const ROWS = [
  ['Dreiecke', (r) => de(r.triangles)],
  ['Punkte', (r) => de(r.points)],
  ['Randkanten (offen)', (r) => de(r.boundaryEdges)],
  ['Löcher', (r) => de(r.holes.length)],
  ['nicht-manifold Kanten', (r) => de(r.nonManifoldEdges)],
  ['nicht-manifold Punkte', (r) => de(r.nonManifoldVertices)],
  ['Kanten mit falscher Orientierung', (r) => de(r.windingConflicts)],
  ['entartete Dreiecke', (r) => de(r.degenerate)],
  ['doppelte Dreiecke', (r) => de(r.duplicate)],
  ['nach innen orientiert', (r) => (r.inverted ? 'ja' : 'nein')],
  ['getrennte Schalen', (r) => de(r.shells)],
  // Of a mesh with holes, doubled triangles or turned neighbours the signed volume is only a guide.
  ['Volumen (mm³)', (r) => `${de(r.volume, 3)}${r.watertight ? '' : ' (Richtwert)'}`],
  ['Selbstüberschneidungen', (r) => (r.selfIntersections ? `${de(r.selfIntersections.count)}${r.selfIntersections.capped ? '+' : ''}` : `– (${r.selfIntersectionsSkipped})`)],
  ['geschlossen (watertight)', (r) => (r.watertight ? 'ja' : 'nein')],
];

/** The before/after rows as { label, before, after, changed } – for the console and the interface. */
export function comparisonRows(repair) {
  return ROWS.map(([label, value]) => {
    const [before, after] = [value(repair.before), value(repair.after)];
    return { label, before, after, changed: before !== after };
  });
}

/** One sentence on what the validation found, e.g. for the report in the interface. */
export function validationSummary(validation) {
  if (!validation.changed) return 'Das Netz wurde nicht verändert.';
  const volume = validation.volumeChangePercent === null
    ? 'Volumen nicht vergleichbar (Eingabe offen oder widersprüchlich orientiert)'
    : `Volumen ${validation.volumeChangePercent > 0 ? '+' : ''}${de(validation.volumeChangePercent, 3)} %`;
  return `Größter Abstand der Änderungen zum übrigen Netz ${de(validation.maxDeviation, 4)} mm (${de(validation.deviationRelative * 100, 3)} % der Diagonale, erlaubt ${de(validation.tolerance.maxDeviation * 100, 2)} %); ${volume}.`;
}

/** The before/after comparison as readable text for the console. */
export function formatRepairReport(repair, healReport = null, title = '') {
  const width = Math.max(...ROWS.map(([label]) => label.length));
  const lines = [];
  if (title) lines.push(title);
  lines.push(`${''.padEnd(width)}  ${'vorher'.padStart(24)}  ${'nachher'.padStart(24)}`);
  for (const { label, before, after } of comparisonRows(repair)) {
    lines.push(`${label.padEnd(width)}  ${before.padStart(24)}  ${after.padStart(24)}`);
  }
  lines.push('');
  const steps = healReport ? repairSteps(healReport) : [];
  lines.push(`Durchgeführt: ${steps.length ? '' : 'nichts – das Netz brauchte keine Reparatur.'}`);
  for (const step of steps) lines.push(`  - ${step}`);
  const v = repair.validation;
  lines.push('');
  lines.push(`Ergebnis: ${repair.outcome}`);
  lines.push(`Prüfung gegen die Eingabe: ${v.ok ? 'bestanden' : v.exceeded ? 'Toleranz überschritten' : 'Netz nicht geschlossen'}`);
  lines.push(`  hinzugefügt/entfernt: ${de(v.addedTriangles)} / ${de(v.removedTriangles)} Dreiecke`);
  lines.push(`  größte Abweichung: ${de(v.maxDeviation, 5)} mm (${de(v.deviationRelative * 100, 3)} % der Diagonale, erlaubt ${de(v.tolerance.maxDeviation * 100, 2)} %)`);
  lines.push(v.volumeChangePercent === null
    ? '  Volumenänderung: nicht vergleichbar (das Volumen der Eingabe ist bei offenem oder widersprüchlich orientiertem Netz nicht aussagekräftig)'
    : `  Volumenänderung: ${v.volumeChangePercent > 0 ? '+' : ''}${de(v.volumeChangePercent, 3)} % (erlaubt ${de(v.tolerance.maxVolumeChange, 2)} %)`);
  for (const warning of repair.warnings) lines.push(`Warnung: ${warning}`);
  lines.push('');
  lines.push(`Zeiten: ${Object.entries(repair.timings).map(([k, ms]) => `${k} ${ms} ms`).join(', ')}`);
  return lines.join('\n');
}
