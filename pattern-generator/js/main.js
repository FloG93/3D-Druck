// Entry point: wires document, views, panels and dialogs together.

import { App } from './ui/app.js';
import { Renderer } from './ui/renderer.js';
import { Interaction, isTyping } from './ui/interaction.js';
import { buildLeftPanel, buildRightPanel } from './ui/panels.js';
import { ModifiersPanel } from './ui/modifiers-panel.js';
import { PresetsView } from './ui/presets.js';
import { icon, LOGO } from './ui/icons.js';
import { encodeDoc, decodeHash } from './ui/share.js';
import { createImage } from './ui/image.js';
import { ExportDialog } from './ui/export-dialog.js';
import { showHelp } from './ui/help.js';

const $ = (id) => document.getElementById(id);

export const de = (v, digits = 1) => (Number.isFinite(v)
  ? v.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
  : '–');

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

async function main() {
  const app = new App();
  window.musterApp = app; // handy for debugging in the browser console

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
  new Interaction(canvas, renderer, app);
  let view3d = null;
  let mode = '2d';

  // --- panels --------------------------------------------------------------
  let presetsView = null;
  const left = buildLeftPanel($('panel-left'), app, {
    onPresetsSection: (body) => {
      presetsView = new PresetsView(app, body, () => renderer.colors);
    },
  });
  const mods = new ModifiersPanel(app);
  const right = buildRightPanel($('panel-right'), app, { modifiersSection: mods.el });

  const refreshPanels = () => {
    left.refresh();
    right.refresh();
    mods.refresh();
  };

  // --- events ----------------------------------------------------------------
  app.on('doc', refreshPanels);
  app.on('image', refreshPanels);
  app.on('analysis', () => {
    right.refresh();
    renderer.requestDraw();
    updateStatus();
  });
  app.on('result', () => {
    renderer.requestDraw();
    updateStatus();
    if (view3d && mode === '3d') view3d.update();
  });
  app.on('selection', () => {
    updateHint();
    renderer.requestDraw();
  });
  app.on('history', () => {
    $('btn-undo').disabled = !app.history.canUndo;
    $('btn-redo').disabled = !app.history.canRedo;
  });
  app.on('fit', () => {
    renderer.fit();
    if (view3d) view3d.resetCamera();
  });

  const toastEl = $('toast');
  let toastTimer = 0;
  app.on('toast', (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  });

  // --- status bar & hint -------------------------------------------------------
  const statusEl = $('status');
  function updateStatus() {
    const r = app.result;
    if (!r) return;
    const a = app.analysis;
    const { width: W, height: H } = app.doc.canvas;
    const parts = [
      `<span title="Arbeitsfläche">Fläche <b>${de(W, 2)} × ${de(H, 2)} mm</b></span>`,
      `<span>Löcher <b>${r.stats.count.toLocaleString('de-DE')}</b></span>`,
      `<span title="Anteil der Lochfläche an der Plattenfläche">Offene Fläche <b>${de(r.stats.ratio * 100, 1)} %</b></span>`,
    ];
    if (a && Number.isFinite(a.minWeb)) {
      const cls = a.overlap ? 'danger' : a.thin ? 'warn' : 'ok';
      const txt = a.minWeb < 0 ? 'Überlappung' : `${de(a.minWeb, 2)} mm`;
      parts.push(`<span class="${cls}" title="Schmalster Steg zwischen zwei Löchern">Steg min <b>${txt}</b></span>`);
    }
    if (Number.isFinite(r.stats.minRim)) parts.push(`<span title="Kleinster Abstand zum Rand">Rand min <b>${de(r.stats.minRim, 1)} mm</b></span>`);
    if (a && a.overlap) parts.push(`<span class="danger">${a.overlap} überlappen</span>`);
    else if (a && a.thin) parts.push(`<span class="warn">${a.thin} zu dünn</span>`);
    statusEl.innerHTML = parts.join('');
    // Narrow screens: the status bar spans the stage width, so fit above it.
    renderer.insetBottom = statusEl.offsetWidth > renderer.width * 0.6 ? statusEl.offsetHeight + 16 : 0;
  }

  const hintEl = $('hint');
  function updateHint() {
    const m = app.selected;
    let t = '<b>Tipp</b> Doppelklick setzt einen Punkt-Attraktor · Mausrad zoomt · Ziehen verschiebt die Ansicht';
    if (m && m.type === 'point') t = '<b>Punkt</b> ziehen: verschieben · Ring ziehen oder Mausrad über dem Punkt: Radius · Entf: löschen';
    else if (m && m.type === 'line') t = '<b>Linie</b> Punkte ziehen · Mausrad über der Linie: Radius · <b>Rechtsklick</b>: Gerade ⇄ Kurve';
    else if (m && m.type === 'linear') t = '<b>Verlauf</b> Start- und Endpunkt ziehen, um Richtung und Länge festzulegen';
    hintEl.innerHTML = t;
  }
  updateHint();

  // --- toolbar actions ---------------------------------------------------------
  $('btn-undo').addEventListener('click', () => app.undo());
  $('btn-redo').addEventListener('click', () => app.redo());
  $('btn-fit').addEventListener('click', () => app.emit('fit'));
  $('btn-zoom-in').addEventListener('click', () => renderer.zoomAt(renderer.width / 2, renderer.height / 2, 1.25));
  $('btn-zoom-out').addEventListener('click', () => renderer.zoomAt(renderer.width / 2, renderer.height / 2, 0.8));
  $('btn-theme').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('muster-generator.theme', next);
    } catch {
      /* ignore */
    }
    setThemeIcon();
    renderer.readColors();
    renderer._cache = null;
    renderer.draw();
    if (view3d) view3d.updateTheme();
    if (presetsView) presetsView.drawAll();
  });
  $('btn-help').addEventListener('click', () => showHelp($('help-dialog')));
  const exportDialog = new ExportDialog($('export-dialog'), app);
  $('btn-export').addEventListener('click', () => exportDialog.open());

  $('btn-share').addEventListener('click', async () => {
    const hash = await encodeDoc(app.doc);
    const url = `${location.origin}${location.pathname}#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      app.emit('toast', 'Link mit dem aktuellen Muster kopiert.');
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
  showTab('right');

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
    } else if (!mod && !isTyping()) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && app.selectedId) {
        e.preventDefault();
        app.removeModifier(app.selectedId);
      } else if (key === 'f') {
        app.emit('fit');
      } else if (e.key === 'Escape') {
        app.select(null);
      }
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
  const shared = await decodeHash(location.hash);
  if (shared) {
    app.load(shared);
    history.replaceState(null, '', location.pathname + location.search);
    app.emit('toast', 'Geteiltes Muster geladen.');
  } else {
    const saved = app.restoreSaved();
    if (saved) app.load(saved);
  }
  app.flush();
  renderer.resize();
  renderer.fit();
  app.emit('history');

  const imgUrl = app.savedImageUrl();
  if (imgUrl) {
    try {
      app.setImage(await createImage(imgUrl, () => app.doc, 'Hintergrundbild'), { persist: false });
    } catch {
      /* ignore broken image */
    }
  }
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="padding:12px;background:#b42318;color:#fff;font:14px system-ui">Fehler beim Start: ${String(err && err.message)}</div>`);
});
