// The interface of STL-zu-STEP (SPEC 6): drop a file, watch the progress,
// read the report, change the options, download the STEP file.
//
// The conversion itself runs in js/worker.js; this module only owns the
// options, the state and the lifetime of the worker (cancelling terminates
// it). Settings are kept under the prefix `stl-zu-step.` (CLAUDE.md).

import { h, Panel, section, selectField, segmented, toggle, numberField, note, setStoragePrefix } from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { renderReport } from './report.js';

export const STORAGE_PREFIX = 'stl-zu-step';
/** Above this many triangles the interface warns before starting (SPEC 6.6). */
export const BIG_MESH_TRIANGLES = 500000;

// [value, text] pairs, as shared/js/controls.js expects them.
const UNITS = [
  ['1', 'Millimeter (mm)'],
  ['25.4', 'Zoll (inch)'],
  ['10', 'Zentimeter (cm)'],
  ['1000', 'Meter (m)'],
  ['custom', 'eigener Faktor …'],
];

const defaults = () => ({
  unit: '1',
  unitFactor: 1,
  cylinders: true,
  acceptUncertain: false,
  tolerance: 'standard',
  roundRadius: false,
});

export class App {
  constructor(dom) {
    this.dom = dom;
    this.options = { ...defaults(), ...this.loadOptions() };
    this.file = null;
    this.result = null;
    this.step = null;
    this.worker = null;
    this.busy = false;
    setStoragePrefix(STORAGE_PREFIX);
    this.buildOptions();
    this.renderReport();
    this.setStatus('Bereit. Datei ablegen oder auswählen.');
  }

  // --- settings -------------------------------------------------------------

  loadOptions() {
    try {
      return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}.options`) || '{}');
    } catch (e) {
      return {};
    }
  }

  saveOptions() {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}.options`, JSON.stringify(this.options));
    } catch (e) { /* private mode: keep going without saving */ }
  }

  get(path) {
    return this.options[path];
  }

  /** The shared controls call this after every change; set() does the work. */
  commit() {}

  set(path, value) {
    if (this.options[path] === value) return;
    this.options[path] = value;
    this.saveOptions();
    this.panel.refresh();
    if (this.file) this.convert(); // the options change the result
  }

  get scale() {
    if (this.options.unit === 'custom') return Math.max(1e-6, Number(this.options.unitFactor) || 1);
    return Number(this.options.unit) || 1;
  }

  // --- options panel --------------------------------------------------------

  buildOptions() {
    const panel = new Panel(this);
    this.panel = panel;
    const container = this.dom.options;
    container.textContent = '';

    const units = section('Einheit', { id: 'unit', icon: 'sliders' });
    units.body.append(
      selectField(panel, {
        label: 'Einheit der Datei',
        bind: { get: () => this.options.unit, set: (v) => this.set('unit', v) },
        options: UNITS,
        title: 'STL kennt keine Einheit. Millimeter ist der Normalfall; Thingiverse-Dateien in Zoll kommen vor.',
      }),
      numberField(panel, {
        label: 'Faktor auf Millimeter',
        bind: { get: () => this.options.unitFactor, set: (v) => this.set('unitFactor', v) },
        min: 1e-6,
        max: 1e6,
        step: 0.1,
        digits: 4,
        visible: () => this.options.unit === 'custom',
      }),
    );
    panel.register(units.el, null, null);

    const recognition = section('Erkennung', { id: 'erkennung', icon: 'curve' });
    recognition.body.append(
      toggle(panel, {
        label: 'Zylinder erkennen',
        bind: { get: () => this.options.cylinders, set: (v) => this.set('cylinders', v) },
        title: 'Aus: alles bleibt Ebene (Stufe 2). An: Bohrungen und Rundungen werden echte Zylinderflächen (Stufe 3).',
      }),
      toggle(panel, {
        label: 'Unsichere übernehmen',
        bind: { get: () => this.options.acceptUncertain, set: (v) => this.set('acceptUncertain', v) },
        title: 'Ein Loch mit 8 bis 11 Facetten kann ein grober Zylinder oder ein echtes Vieleck sein. Standard: aus.',
      }),
      segmented(panel, {
        label: 'Toleranz',
        bind: { get: () => this.options.tolerance, set: (v) => this.set('tolerance', v) },
        options: [
          ['streng', 'streng', null, 'Nur was wirklich eben ist, wird eine Fläche. Für saubere CAD-Exporte.'],
          ['standard', 'Standard', null, 'Der Normalfall.'],
          ['grob', 'grob', null, 'Für Scans und verrauschte Netze: Flächenstücke dürfen stärker von ihrer Ebene abweichen (5° statt 2°), und sie werden auch dann zu einer Fläche verschmolzen. Der Bericht nennt den größten Abstand.'],
        ],
      }),
      toggle(panel, {
        label: 'Radien auf 0,05 mm runden',
        bind: { get: () => this.options.roundRadius, set: (v) => this.set('roundRadius', v) },
        title: 'Rastet einen Radius auf einen runden Wert ein, aber nur innerhalb der gemessenen Unsicherheit.',
      }),
      note(panel, () => (this.options.tolerance === 'grob'
        ? 'Grobe Toleranz: größere Flächen, dafür liegt das Ergebnis weiter vom Netz entfernt – der Bericht nennt den größten Abstand.'
        : 'Aus einem unterteilten Netz kommt der Radius etwas zu klein heraus – die Sehnenhöhe steckt in den Daten. Der Bericht nennt die Unsicherheit.')),
    );
    panel.register(recognition.el, null, null);

    container.append(units.el, recognition.el);
    panel.refresh();
  }

  // --- conversion -----------------------------------------------------------

  async open(file) {
    if (!file) return;
    this.file = file;
    this.dom.app.dataset.state = 'arbeitet';
    await this.convert();
  }

  /** Reads the file and starts the worker; a running conversion is replaced. */
  async convert() {
    if (!this.file) return;
    this.stop(false);
    const buffer = await this.file.arrayBuffer();
    this.busy = true;
    this.dom.app.dataset.state = 'arbeitet';
    this.setProgress(0.02, 'Datei lesen');
    this.dom.cancel.hidden = false;

    const worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.addEventListener('message', (event) => this.onWorkerMessage(event.data));
    worker.addEventListener('error', (event) => {
      this.fail(event.message || 'Der Worker ist abgestürzt.');
    });
    worker.postMessage({
      type: 'convert',
      buffer,
      fileName: this.file.name,
      opts: {
        unitScale: this.scale,
        cylinders: this.options.cylinders,
        acceptUncertain: this.options.acceptUncertain,
        tolerance: this.options.tolerance,
        constraints: { roundRadius: this.options.roundRadius },
      },
    }, [buffer]);
  }

  onWorkerMessage(data) {
    if (!data) return;
    if (data.type === 'progress') {
      this.setProgress(data.fraction, data.text);
      return;
    }
    if (data.type === 'error') {
      this.fail(data.message);
      return;
    }
    if (data.type !== 'done') return;
    this.busy = false;
    this.dom.cancel.hidden = true;
    this.result = data.result;
    this.step = data.step;
    this.dom.app.dataset.state = 'fertig';
    this.setProgress(1, 'fertig');
    this.renderReport();
    this.dom.exportButton.disabled = false;
    this.onResult?.(data.result);
    const tiers = this.result.components.map((c) => c.tier);
    const open = tiers.includes('offen');
    this.setStatus(open
      ? 'Fertig, aber das Netz ließ sich nicht schließen: offene Schale.'
      : `Fertig: ${tiers.map((t) => `Stufe ${t}`).join(', ')}, ${this.result.components.reduce((s, c) => s + c.counts.faces, 0)} Flächen, ${Math.round(this.step.bytes / 1024)} kB STEP.`);
    this.stop(false);
  }

  /** Cancel: the worker is terminated, the previous result stays. */
  stop(userAsked = true) {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (!userAsked) return;
    this.busy = false;
    this.dom.cancel.hidden = true;
    this.dom.app.dataset.state = this.result ? 'fertig' : 'leer';
    this.setStatus('Abgebrochen.');
  }

  fail(message) {
    this.busy = false;
    this.stop(false);
    this.dom.cancel.hidden = true;
    this.dom.app.dataset.state = this.result ? 'fertig' : 'leer';
    this.setStatus(`Fehler: ${message}`);
    this.dom.error.textContent = message;
    this.dom.error.hidden = false;
  }

  renderReport() {
    this.dom.error.hidden = true;
    renderReport(this.dom.report, this.result, {
      onToggleUncertain: () => this.set('acceptUncertain', true),
    });
  }

  setProgress(fraction, text) {
    const percent = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100);
    this.dom.progressBar.style.width = `${percent}%`;
    this.dom.progress.setAttribute('aria-valuenow', String(percent));
    this.dom.progressText.textContent = text ? `${text} …` : '';
    this.dom.progress.hidden = percent >= 100 || percent === 0;
    if (text) this.setStatus(`${text} … ${percent} %`);
  }

  setStatus(text) {
    this.dom.status.textContent = text;
  }

  /** The file name for the download: same name, .step instead of .stl. */
  get stepName() {
    const base = (this.file?.name || 'modell').replace(/\.[^.]+$/, '');
    return `${base}.step`;
  }
}
