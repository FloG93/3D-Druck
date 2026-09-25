// Entry point: wires document, views, panels and dialogs together.

import { App } from './ui/app.js';
import { Renderer } from './ui/renderer.js';
import { buildLeftPanel, buildRightPanel } from './ui/panels.js';
import { PresetsView } from './ui/presets.js';
import { FontDialog } from './ui/fontpicker.js';
import { ExportDialog } from './ui/export-dialog.js';
import { showHelp } from './ui/help.js';
import { icon } from '../../shared/js/icons.js';
import { setStoragePrefix } from '../../shared/js/controls.js';
import { encodeDoc, decodeHash } from '../../shared/js/share.js';
import { RELIEF_NAMES } from './core/model.js';
import { BUILTIN_PRESETS } from './core/presets.js';

const $ = (id) => document.getElementById(id);
const de = (v, digits = 1) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '–');

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--accent)"/>
  <g fill="var(--logo-ink)">
    <rect x="8" y="8" width="16" height="3.6" rx="1.2"/>
    <rect x="14.2" y="8" width="3.6" height="15.5" rx="1.2"/>
    <rect x="8" y="21.8" width="16" height="2.2" rx="1.1" opacity=".55"/>
  </g>
</svg>`;

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const isTyping = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

async function main() {
  setStoragePrefix('text-generator');
  const app = new App();
  window.textApp = app; // handy for debugging in the browser console

  // --- topbar ------------------------------------------------------------
  $('logo').innerHTML = LOGO;
  $('btn-undo').innerHTML = icon('undo');
  $('btn-redo').innerHTML = icon('redo');
  $('btn-fit').innerHTML = icon('fit');
  $('btn-2d').innerHTML = icon('square');
  $('btn-3d').innerHTML = icon('cube');
  $('btn-share').innerHTML = icon('link');
  $('btn-help').innerHTML = icon('help');
  $('btn-export').innerHTML = `${icon('download')}<span>Exportieren</span>`;
  const setThemeIcon = () => {
    $('btn-theme').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
  };
  setThemeIcon();

  // --- views ---------------------------------------------------------------
  const canvas = $('view');
  const renderer = new Renderer(canvas, app);
  let view3d = null;
  let mode = '2d';
  let fitPending = true;

  // --- panels & dialogs ------------------------------------------------------
  const fontDialog = new FontDialog($('font-dialog'), app);
  const left = buildLeftPanel($('panel-left'), app, {
    onPresetsSection: (body) => new PresetsView(app, body),
    openFontDialog: (id) => fontDialog.open(id),
  });
  const right = buildRightPanel($('panel-right'), app);
  const exportDialog = new ExportDialog($('export-dialog'), app);

  // --- front / back ------------------------------------------------------------
  const sideSwitch = document.createElement('div');
  sideSwitch.className = 'side-switch segmented';
  sideSwitch.setAttribute('role', 'group');
  sideSwitch.setAttribute('aria-label', 'Seite');
  sideSwitch.innerHTML = '<button type="button" class="seg-btn active" data-side="front" title="Vorderseite">Vorne</button>'
    + '<button type="button" class="seg-btn" data-side="back" title="Rückseite (von hinten gesehen)">Hinten</button>';
  $('stage').append(sideSwitch);
  const hasBack = () => Boolean(app.model && app.model.layouts.some((l) => l.side === 'back'));
  const setSide = (side) => {
    if (renderer.side === side) return;
    renderer.side = side;
    for (const b of sideSwitch.children) b.classList.toggle('active', b.dataset.side === side);
    renderer.fit();
  };
  sideSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSide(b.dataset.side);
  });
  // Show the side of the selected block (also right after it moved sides).
  let selSide = null;
  const followSelection = () => {
    const sel = app.text(app.selectedId);
    const side = sel && sel.side === 'back' && hasBack() ? 'back' : 'front';
    if (side !== selSide) {
      selSide = side;
      setSide(side);
    }
  };

  // --- events ----------------------------------------------------------------
  app.on('doc', () => {
    left.refresh();
    right.refresh();
  });
  app.on('model', () => {
    // Fit views once the new design is complete (fonts loaded).
    if (fitPending && app.model && !app.model.pending) {
      fitPending = false;
      renderer.fit();
      if (view3d) view3d.resetCamera();
    }
    // Both panels show values of the model (QR module size, graphic size, …).
    left.refresh();
    right.refresh();
    sideSwitch.hidden = !hasBack() || mode !== '2d';
    if (!hasBack()) setSide('front');
    followSelection();
    renderer.requestDraw();
    updateStatus();
    if (view3d && mode === '3d') view3d.update();
  });
  app.on('selection', () => {
    selSide = null;
    followSelection();
    renderer.requestDraw();
  });
  // A text was added or removed: show the whole design again.
  app.on('structure', () => {
    fitPending = true;
  });
  app.on('fonts', updateStatus);
  app.on('history', () => {
    $('btn-undo').disabled = !app.history.canUndo;
    $('btn-redo').disabled = !app.history.canRedo;
  });
  app.on('fit', () => {
    fitPending = true;
  });

  const toastEl = $('toast');
  let toastTimer = 0;
  app.on('toast', (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  });

  // --- status bar & hint -------------------------------------------------------
  const statusEl = $('status');
  function updateStatus() {
    const m = app.model;
    if (!m) return;
    const s = m.stats;
    const parts = [];
    if (app.loading.size) parts.push('<span class="warn">Schrift wird geladen …</span>');
    parts.push(`<span title="Außenmaße">Größe <b>${de(s.width)} × ${de(s.height)} mm</b></span>`);
    parts.push(`<span title="Gesamthöhe">Höhe <b>${de(s.top, 2)} mm</b></span>`);
    if (m.base.length) parts.push(`<span>Schrift <b>${RELIEF_NAMES[m.relief]}</b></span>`);
    if (m.split) parts.push(`<span title="Für das Druckbett in Teile mit Puzzle-Verbindern aufgeteilt"><b>${m.pieces.length} Teile</b> (${m.split.nx} × ${m.split.ny})</span>`);
    if (m.stamp) parts.push(`<span title="Die Schrift ist gespiegelt, damit der Abdruck richtig herum steht"><b>Stempel</b>${m.stamp.handle ? ' mit Griff' : ''}</span>`);
    parts.push(`<span title="Gewicht bei PLA (1,24 g/cm³), massiv">≈ <b>${de(s.grams)} g</b></span>`);
    if (s.thinCount) parts.push(`<span class="warn" title="Striche dünner als die Mindest-Strichstärke">${s.thinCount} dünne Stelle${s.thinCount === 1 ? '' : 'n'}</span>`);
    if (m.warnings.length) parts.push(`<span class="warn" title="${m.warnings.join(' ').replace(/"/g, '&quot;')}">${m.warnings.length} Hinweis${m.warnings.length === 1 ? '' : 'e'}</span>`);
    statusEl.innerHTML = parts.join('');
    renderer.insetBottom = statusEl.offsetWidth > renderer.width * 0.6 ? statusEl.offsetHeight + 16 : 0;
  }

  const hintEl = $('hint');
  hintEl.innerHTML = '<b>Tipp</b> Text, QR-Code oder Grafik mit der Maus verschieben · Mausrad zoomt · Ziehen im Leeren verschiebt die Ansicht';

  // --- toolbar actions ---------------------------------------------------------
  $('btn-undo').addEventListener('click', () => app.undo());
  $('btn-redo').addEventListener('click', () => app.redo());
  $('btn-fit').addEventListener('click', () => {
    renderer.fit();
    if (view3d) view3d.resetCamera();
  });
  $('btn-zoom-in').addEventListener('click', () => renderer.zoomAt(renderer.width / 2, renderer.height / 2, 1.25));
  $('btn-zoom-out').addEventListener('click', () => renderer.zoomAt(renderer.width / 2, renderer.height / 2, 0.8));
  $('btn-theme').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('3d-druck.theme', next);
    } catch {
      /* ignore */
    }
    setThemeIcon();
    renderer.readColors();
    renderer.draw();
    if (view3d) view3d.updateTheme();
  });
  $('btn-help').addEventListener('click', () => showHelp($('help-dialog')));
  $('btn-export').addEventListener('click', () => exportDialog.open());

  $('btn-share').addEventListener('click', async () => {
    const hash = await encodeDoc(app.doc, 't');
    const url = `${location.origin}${location.pathname}#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      app.emit('toast', 'Link mit dem aktuellen Design kopiert.');
    } catch {
      window.prompt('Link zum Teilen:', url);
    }
  });

  const setMode = async (next) => {
    if (next === mode) return;
    mode = next;
    $('btn-2d').classList.toggle('active', mode === '2d');
    $('btn-3d').classList.toggle('active', mode === '3d');
    $('stage').classList.toggle('mode-3d', mode === '3d');
    const el3d = $('view3d');
    sideSwitch.hidden = mode !== '2d' || !hasBack();
    if (mode === '3d') {
      el3d.hidden = false;
      canvas.hidden = true;
      hintEl.hidden = true;
      if (!view3d) {
        try {
          const { View3D } = await import('./ui/view3d.js');
          view3d = new View3D(el3d, app);
        } catch (err) {
          console.error(err);
          el3d.innerHTML = '<div class="msg">Die 3D-Vorschau konnte nicht geladen werden (three.js vom CDN nicht erreichbar oder WebGL nicht verfügbar).</div>';
          return;
        }
      }
      if (mode === '3d') view3d.show();
    } else {
      el3d.hidden = true;
      canvas.hidden = false;
      hintEl.hidden = false;
      if (view3d) view3d.hide();
      renderer.resize();
      renderer.draw();
    }
  };
  $('btn-2d').addEventListener('click', () => setMode('2d'));
  $('btn-3d').addEventListener('click', () => setMode('3d'));

  // Mobile: switch between the two panels.
  const tabs = $('mobile-tabs');
  const showTab = (name) => {
    for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === name);
    $('panel-left').classList.toggle('mobile-active', name === 'left');
    $('panel-right').classList.toggle('mobile-active', name === 'right');
  };
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) showTab(b.dataset.tab);
  });
  showTab('left');

  // --- keyboard ----------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z' && !isTyping()) {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
    } else if (mod && key === 'y' && !isTyping()) {
      e.preventDefault();
      app.redo();
    } else if (mod && key === 's') {
      e.preventDefault();
      exportDialog.open();
    } else if (!mod && !isTyping() && key === 'f') {
      renderer.fit();
      if (view3d) view3d.resetCamera();
    }
  });

  // --- sizing --------------------------------------------------------------------
  const ro = new ResizeObserver(() => {
    if (mode === '2d') renderer.resize();
    else if (view3d) view3d.resize();
  });
  ro.observe($('stage'));
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    setThemeIcon();
    renderer.readColors();
    renderer.draw();
  });

  // --- initial document ------------------------------------------------------------
  const shared = await decodeHash(location.hash, 't');
  if (shared) {
    app.load(shared);
    history.replaceState(null, '', location.pathname + location.search);
    app.emit('toast', 'Geteiltes Design geladen.');
  } else {
    const saved = app.restoreSaved();
    app.load(saved || structuredClone(BUILTIN_PRESETS[0]));
  }
  renderer.resize();
  app.emit('history');
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="padding:12px;background:#b42318;color:#fff;font:14px system-ui">Fehler beim Start: ${String(err && err.message)}</div>`);
});
