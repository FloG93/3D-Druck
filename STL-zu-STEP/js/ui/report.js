// The report (SPEC 6.3). It is always visible and names every repair with its
// number, the tier each body reached in plain words, the reason for every
// fallback and every recognised feature with radius, axis, confidence and
// uncertainty. Nothing that happened to the mesh is left out.

import { h } from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';

const de = (v, digits = 2) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 }) : '–');
const plural = (n, one, many) => `${de(n, 0)} ${n === 1 ? one : many}`;

export const TOLERANCE_TEXT = { streng: 'streng', standard: 'Standard', grob: 'grob (verrauschtes Netz)' };

export const TIER_TEXT = {
  3: { name: 'Stufe 3', what: 'Ebenen und echte Zylinder', good: true },
  2: { name: 'Stufe 2', what: 'verschmolzene Ebenen, Zylinder bleiben Facetten' },
  1: { name: 'Stufe 1', what: 'jedes Dreieck eine Ebene' },
  offen: { name: 'offene Schale', what: 'das Netz ließ sich nicht schließen', bad: true },
};

const AXIS_NAMES = [[1, 0, 0, 'X'], [0, 1, 0, 'Y'], [0, 0, 1, 'Z']];

/** „Z“ for an axis along a coordinate direction, otherwise the vector. */
function axisText(axis) {
  for (const [x, y, z, name] of AXIS_NAMES) {
    if (Math.abs(Math.abs(axis[0] * x + axis[1] * y + axis[2] * z) - 1) < 1e-4) return name;
  }
  return `(${axis.map((v) => de(v, 3)).join(' | ')})`;
}

/** The repairs of the healing, each with its number – empty when nothing happened. */
export function repairLines(report) {
  const lines = [];
  const add = (n, text) => {
    if (n > 0) lines.push(`${plural(n, ...text)}`);
  };
  add(report.degenerate, ['Dreieck ohne Fläche entfernt', 'Dreiecke ohne Fläche entfernt']);
  add(report.duplicate, ['doppeltes Dreieck entfernt', 'doppelte Dreiecke entfernt']);
  add(report.tJunctionsSplit, ['T-Kreuzung geteilt', 'T-Kreuzungen geteilt']);
  add(report.nonManifoldRemoved, ['überzähliges Dreieck an einer Kante entfernt', 'überzählige Dreiecke an Kanten entfernt']);
  add(report.flipped, ['Dreieck gedreht', 'Dreiecke gedreht']);
  add(report.holesFilled, ['Loch gefüllt', 'Löcher gefüllt']);
  add(report.unusedPoints, ['unbenutzter Punkt entfernt', 'unbenutzte Punkte entfernt']);
  if (report.orientedGlobally) lines.push('Das Netz war komplett nach innen gedreht und wurde umgedreht.');
  for (const hole of report.holesOpen) {
    lines.push(`Loch mit ${plural(hole.edges, 'Kante', 'Kanten')} blieb offen (${hole.reason}).`);
  }
  for (const skipped of report.skipped || []) lines.push(`Abgeschaltet: ${skipped}.`);
  return lines;
}

function badge(text, kind = '') {
  return h('span', { class: `badge${kind ? ` ${kind}` : ''}` }, text);
}

/** One body: tier, numbers, fallback reasons. */
function bodyBlock(component, index, total) {
  const tier = TIER_TEXT[component.tier] ?? { name: String(component.tier), what: '' };
  // With a single body the section heading already says "Ergebnis".
  const title = total > 1 ? `Körper ${index + 1}` : null;
  const rows = [
    ['Flächen', `${de(component.counts.faces, 0)} (${de(component.counts.planes, 0)} Ebenen, ${de(component.counts.cylinders, 0)} Zylinderflächen)`],
    ['Volumen', `${de(component.brepVolume, 3)} mm³`],
    ['Abweichung zum Netz', `${component.deviationPercent >= 0 ? '+' : ''}${de(component.deviationPercent, 4)} %`],
  ];
  if (component.maxDeviation > 0) rows.push(['Größter Abstand zum Netz', `${de(component.maxDeviation, 5)} mm`]);
  if (component.tolerance && component.tolerance !== 'standard') rows.push(['Toleranz', TOLERANCE_TEXT[component.tolerance] ?? component.tolerance]);
  return h(
    'div',
    { class: 'report-body' },
    h('div', { class: 'report-head' },
      title ? h('b', {}, title) : null,
      badge(tier.name, component.open ? 'warn' : (component.tier === 3 ? 'good' : '')),
      h('span', { class: 'report-what' }, tier.what)),
    h('dl', { class: 'report-rows' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    component.fallbackReasons.length
      ? h('div', { class: 'report-fallback' },
        h('b', {}, 'Warum nicht höher?'),
        h('ul', {}, ...component.fallbackReasons.map((r) => h('li', {}, r))))
      : null,
  );
}

/** The recognised features with radius, axis, confidence and uncertainty. */
function featureList(result, onToggleUncertain) {
  if (result.cylinders.length === 0 && result.components.every((c) => c.uncertain.length === 0)) {
    return h('p', { class: 'report-empty' }, 'Keine Zylinder erkannt – das Ergebnis besteht aus Ebenen.');
  }
  const items = result.cylinders.map((c, i) => h(
    'li',
    { class: 'feature', 'data-cylinder': String(i) },
    h('span', { class: 'feature-dot', style: `background:${featureColor(i)}` }),
    h('div', { class: 'feature-text' },
      h('b', {}, `${c.outward ? 'Rundung' : 'Bohrung'} r = ${de(c.radius, 4)} mm`),
      h('span', {}, `Achse ${axisText(c.axis)}, Höhe ${de(c.height, 2)} mm, ${de(c.arc, 0)}° vom Umfang`),
      h('span', {}, `${de(c.segments, 0)} Facetten je Vollkreis · Unsicherheit ±${de(c.uncertainty, 4)} mm · Restfehler ${de(c.residual, 5)} mm`)),
    badge(c.confidence, c.confidence === 'sicher' ? 'good' : 'warn'),
  ));
  const uncertain = result.components.flatMap((c) => c.uncertain);
  if (uncertain.length > 0) {
    items.push(h('li', { class: 'feature feature-ask' },
      h('div', { class: 'feature-text' },
        h('b', {}, `${plural(uncertain.length, 'unsicheres Merkmal', 'unsichere Merkmale')} nicht übernommen`),
        h('span', {}, uncertain.map((u) => `r = ${de(u.radius, 3)} mm mit ${de(u.segments, 0)} Facetten`).join(', ')),
        h('span', {}, 'Ein Achteck kann ein grober Zylinder oder ein echtes Vieleck sein – das ist aus den Daten nicht zu entscheiden.')),
      h('button', { type: 'button', class: 'btn small', onclick: onToggleUncertain }, 'Als Zylinder übernehmen')));
  }
  return h('ul', { class: 'features' }, ...items);
}

/** Colour per cylinder, matching the preview. */
export function featureColor(i) {
  const hues = [28, 200, 140, 320, 265, 95, 10, 175];
  return `hsl(${hues[i % hues.length]} 85% 58%)`;
}

/** The rejections, so that no discarded feature stays invisible. */
function rejectionBlock(result) {
  const counts = new Map();
  for (const component of result.components) {
    for (const r of component.rejected) {
      for (const reason of r.reasons) {
        const key = reason.split(' (')[0];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  if (counts.size === 0) return null;
  const total = result.components.reduce((s, c) => s + c.rejected.length, 0);
  return h('details', { class: 'report-rejected' },
    h('summary', {}, `${plural(total, 'Kandidat verworfen', 'Kandidaten verworfen')}`),
    h('ul', {}, ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => h('li', {}, `${reason}: ${de(n, 0)}×`))));
}

/**
 * renderReport(container, result, handlers) – draws the whole report.
 * handlers: { onToggleUncertain }
 */
export function renderReport(container, result, handlers = {}) {
  container.textContent = '';
  if (!result) {
    container.append(h('p', { class: 'report-empty' }, 'Noch keine Datei umgewandelt.'));
    return;
  }
  const repairs = repairLines(result.healReport);
  const bodies = result.components.length;

  container.append(h('div', { class: 'report-file' },
    h('b', {}, result.fileName),
    h('span', {}, `${plural(result.triangles, 'Dreieck', 'Dreiecke')}, ${plural(result.healReport.points, 'Punkt', 'Punkte')}, ${plural(bodies, 'Körper', 'Körper')}`)));

  for (const warning of result.warnings) {
    container.append(h('p', { class: 'report-warn' }, h('span', { class: 'inline-icon', html: icon('warn') }), warning));
  }

  container.append(h('div', { class: 'report-section' },
    h('h3', {}, 'Netz geprüft'),
    repairs.length === 0
      ? h('p', { class: 'report-ok' }, h('span', { class: 'inline-icon', html: icon('check') }), 'Das Netz war geschlossen und brauchte keine Reparatur.')
      : h('ul', { class: 'report-list' }, ...repairs.map((r) => h('li', {}, r)))));

  container.append(h('div', { class: 'report-section' },
    h('h3', {}, bodies > 1 ? 'Körper' : 'Ergebnis'),
    ...result.components.map((c, i) => bodyBlock(c, i, bodies))));

  container.append(h('div', { class: 'report-section' },
    h('h3', {}, 'Erkannte Merkmale'),
    h('p', { class: 'report-note' }, `${plural(result.components.reduce((s, c) => s + c.patches, 0), 'Flächenstück', 'Flächenstücke')} gefunden${result.components.some((c) => c.merged) ? `, ${de(result.components.reduce((s, c) => s + c.merged, 0), 0)}× Zylinderstücke verschmolzen` : ''}.`),
    featureList(result, handlers.onToggleUncertain),
    rejectionBlock(result)));
}
