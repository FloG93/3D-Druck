// Download dialog (SPEC 6.5): the STEP file with its name, plus the warning
// banner when only tier 1 or an open shell came out – a file with tens of
// thousands of faceted faces makes Fusion 360 slow, and an open shell is not
// a solid.

import { h } from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { TIER_TEXT } from './report.js';

const de = (v, digits = 0) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '–');

/** The warnings that belong on the download, in the order of their weight. */
export function exportWarnings(result, bytes) {
  const warnings = [];
  const faces = result.components.reduce((s, c) => s + c.counts.faces, 0);
  if (result.components.some((c) => c.open)) {
    warnings.push('Das Ergebnis ist eine **offene Schale**, kein Volumenkörper: das Netz ließ sich nicht schließen. Fusion 360 und FreeCAD öffnen die Datei, können daraus aber keinen Körper machen.');
  }
  if (result.components.some((c) => c.tier === 1)) {
    warnings.push(`Nur **Stufe 1**: jedes Dreieck ist eine eigene Fläche (${de(faces)} Flächen). Die Datei ist groß und CAD-Programme werden damit langsam.`);
  }
  if (faces > 5000) {
    warnings.push(`${de(faces)} Flächen sind viel für ein CAD-Programm. Mit erkannten Zylindern wird es deutlich weniger.`);
  }
  if (bytes > 20 * 1024 * 1024) {
    warnings.push(`Die Datei ist ${de(bytes / (1024 * 1024), 1)} MB groß.`);
  }
  return warnings;
}

const bold = (text) => {
  const parts = String(text).split('**');
  return parts.map((part, i) => (i % 2 ? h('b', {}, part) : document.createTextNode(part)));
};

/**
 * showExportDialog(dialog, { result, step, fileName, onDownload, onDownloadReport })
 * onDownloadReport gives the repair report as a JSON file (only offered when the result has one).
 */
export function showExportDialog(dialog, { result, step, fileName, onDownload, onDownloadReport }) {
  dialog.textContent = '';
  const tiers = result.components.map((c) => TIER_TEXT[c.tier]?.name ?? String(c.tier));
  const faces = result.components.reduce((s, c) => s + c.counts.faces, 0);
  const warnings = exportWarnings(result, step.bytes);

  const rows = [
    ['Stufe', tiers.join(', ')],
    ['Körper', de(result.components.length)],
    ['Flächen', `${de(faces)} (${de(result.components.reduce((s, c) => s + c.counts.planes, 0))} Ebenen, ${de(result.components.reduce((s, c) => s + c.counts.cylinders, 0))} Zylinderflächen)`],
    ['Dateigröße', `${de(step.bytes / 1024)} kB`],
    ['Volumen', `${de(result.components.reduce((s, c) => s + c.brepVolume, 0), 2)} mm³`],
  ];

  const body = h('div', { class: 'dialog-body' },
    h('p', { class: 'export-name' }, 'Dateiname: ', h('b', {}, fileName)),
    h('dl', { class: 'report-rows' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    ...warnings.map((w) => h('p', { class: 'info-box warn' }, h('span', { class: 'inline-icon', html: icon('warn') }), ...bold(w))),
    h('p', { class: 'ctl-note' }, 'STEP (AP214) öffnet jedes CAD-Programm: Fusion 360, FreeCAD, Onshape, SolidWorks, Inventor.'),
  );

  const download = h('button', { type: 'button', class: 'btn primary' }, 'Herunterladen');
  download.addEventListener('click', () => {
    onDownload();
    dialog.close();
  });
  const close = h('button', { type: 'button', class: 'btn ghost' }, 'Schließen');
  close.addEventListener('click', () => dialog.close());
  const report = onDownloadReport && result.repair
    ? h('button', { type: 'button', class: 'btn ghost', title: 'Befund vorher und nachher, Reparaturen, Prüfung gegen die Eingabe und Zeiten als JSON' }, 'Reparaturbericht (JSON)')
    : null;
  report?.addEventListener('click', () => onDownloadReport());

  dialog.append(
    h('div', { class: 'dialog-inner' },
      h('div', { class: 'dialog-head' }, h('h2', {}, 'STEP herunterladen')),
      body,
      h('div', { class: 'dialog-foot' }, close, report, download)),
  );
  dialog.showModal();
}
