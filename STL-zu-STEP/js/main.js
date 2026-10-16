// Entry point: topbar, drop zone, preview, report and dialogs.

import { App, BIG_MESH_TRIANGLES } from './ui/app.js';
import { showExportDialog } from './ui/export-dialog.js';
import { showHelp } from './ui/help.js';
import { icon } from '../../shared/js/icons.js';

const $ = (id) => document.getElementById(id);

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--accent)"/>
  <g fill="none" stroke="var(--logo-ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M4.5 21.5 9 13l4.5 8.5z"/>
    <path d="M9 13 13.5 21.5 18 13z" opacity=".45"/>
    <path d="M20.5 10.5h3a4 4 0 0 1 0 8h-3z"/>
    <path d="M20.5 10.5v8"/>
  </g>
</svg>`;

const currentTheme = () => document.documentElement.dataset.theme
  || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

function main() {
  const dom = {
    app: $('app'),
    options: $('options'),
    report: $('report'),
    status: $('status'),
    error: $('error'),
    progress: $('progress'),
    progressBar: $('progress-bar'),
    progressText: $('progress-text'),
    cancel: $('btn-cancel'),
    exportButton: $('btn-export'),
  };
  const app = new App(dom);
  window.stlApp = app; // handy in the browser console and for the self-test

  $('logo').innerHTML = LOGO;
  $('drop-icon').innerHTML = icon('open');
  $('btn-back').innerHTML = `${icon('back')}<span>Zurück</span>`;
  $('btn-fit').innerHTML = icon('fit');
  $('btn-help').innerHTML = icon('help');
  $('btn-export').innerHTML = `${icon('download')}<span>Exportieren</span>`;
  const setThemeIcon = () => {
    $('btn-theme').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
  };
  setThemeIcon();

  // --- theme, help, mobile tabs ---------------------------------------------
  $('btn-theme').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('3d-druck.theme', next);
    } catch (e) { /* ignore */ }
    setThemeIcon();
    preview?.updateTheme();
  });
  $('btn-help').addEventListener('click', () => showHelp($('help-dialog')));
  for (const button of $('mobile-tabs').querySelectorAll('button')) {
    button.addEventListener('click', () => {
      for (const b of $('mobile-tabs').querySelectorAll('button')) b.classList.toggle('active', b === button);
      dom.app.dataset.tab = button.dataset.tab;
      preview?.resize();
    });
  }

  // --- file input and drop zone ---------------------------------------------
  const input = $('file-input');
  const choose = () => input.click();
  $('btn-choose').addEventListener('click', choose);
  input.addEventListener('change', () => {
    if (input.files?.length) openFile(input.files[0]);
    input.value = '';
  });

  const drop = $('drop');
  const stage = $('stage');
  for (const type of ['dragenter', 'dragover']) {
    stage.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const type of ['dragleave', 'dragend']) {
    stage.addEventListener(type, () => drop.classList.remove('over'));
  }
  stage.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('over');
    const file = event.dataTransfer?.files?.[0];
    if (file) openFile(file);
  });
  stage.addEventListener('click', (event) => {
    if (dom.app.dataset.state === 'leer' && !event.target.closest('button')) choose();
  });

  /** Warns about very large files before the work starts (SPEC 6.6). */
  function openFile(file) {
    const estimate = Math.round((file.size - 84) / 50); // binary STL: 50 bytes per triangle
    if (estimate > BIG_MESH_TRIANGLES) {
      const ok = window.confirm(`Die Datei hat etwa ${estimate.toLocaleString('de-DE')} Dreiecke. Das kann Minuten dauern und viel Speicher brauchen. Weitermachen?`);
      if (!ok) return;
    }
    app.open(file);
  }

  // --- export ---------------------------------------------------------------
  dom.exportButton.addEventListener('click', () => {
    if (!app.result || !app.step) return;
    showExportDialog($('export-dialog'), {
      result: app.result,
      step: app.step,
      fileName: app.stepName,
      onDownload: () => download(app.stepName, app.step.text),
      onDownloadReport: () => download(
        app.stepName.replace(/\.step$/, '.repair.json'),
        `${JSON.stringify({ datei: app.result.fileName, heilung: app.result.healReport, ...app.result.repair }, null, 2)}\n`,
        'application/json',
      ),
    });
  });
  dom.cancel.addEventListener('click', () => app.stop(true));
  $('btn-back').addEventListener('click', () => app.reset());

  // --- preview --------------------------------------------------------------
  let preview = null;
  const setMode = (mode) => {
    $('btn-eingabe').classList.toggle('active', mode === 'eingabe');
    $('btn-ergebnis').classList.toggle('active', mode === 'ergebnis');
    preview?.setMode(mode);
  };
  $('btn-eingabe').addEventListener('click', () => setMode('eingabe'));
  $('btn-ergebnis').addEventListener('click', () => setMode('ergebnis'));
  $('btn-fit').addEventListener('click', () => preview?.resetCamera());

  app.onResult = async (result) => {
    if (!preview) {
      try {
        const { Preview } = await import('./ui/preview.js');
        preview = new Preview($('view3d'));
        window.stlPreview = preview;
      } catch (err) {
        app.setStatus('Die 3D-Vorschau konnte nicht geladen werden; Bericht und Export funktionieren trotzdem.');
        return;
      }
    }
    preview.show(result.preview);
    setMode('ergebnis');
  };

  app.onReset = () => preview?.clear();

  // Keyboard: open with o, export with e, help with ?, Escape = back
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    if (event.key === 'o') choose();
    else if (event.key === 'e' && !dom.exportButton.disabled) dom.exportButton.click();
    else if (event.key === '?') showHelp($('help-dialog'));
    else if (event.key === 'f') preview?.resetCamera();
    else if (event.key === 'Escape' && dom.app.dataset.state !== 'leer' && !document.querySelector('dialog[open]')) app.reset();
  });
}

/** Hands a text (the STEP file, the repair report) to the browser as a download. */
function download(name, text, type = 'model/step') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

main();
