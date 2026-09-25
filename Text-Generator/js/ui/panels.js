// Side panels: text blocks on the left; base shape, mount, 3D body, colours
// and the print check on the right.

import {
  h, Panel, numberField, selectField, segmented, toggle, colorField, note, grid, section, bindPath, textField,
} from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { BUILTIN_FONTS, fontKey, SYMBOLS } from '../core/fonts.js';
import { KIND_NAMES, QR_MIN_MODULE } from '../core/model.js';
import { STENCIL_THICKNESS, STAMP_KIND_DEFAULTS } from '../core/document.js';
import { parseSVG } from '../core/svgimport.js';

// Suggested colours for texts with their own filament.
const OWN_COLORS = ['#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#8338ec', '#ff7f11'];

const de = (v, digits = 1) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '–');

// --- text blocks ------------------------------------------------------------------

/** Button that shows a grid of symbols; a click inserts one at the cursor. */
function symbolPicker(textarea, onInsert) {
  const grid = h('div', { class: 'symbol-grid', role: 'group', 'aria-label': 'Symbole', hidden: true });
  for (const ch of SYMBOLS) {
    const b = h('button', { type: 'button', class: 'symbol', title: `„${ch}“ einfügen` }, ch);
    b.addEventListener('click', () => {
      const v = textarea.value;
      const a = textarea.selectionStart ?? v.length;
      const e = textarea.selectionEnd ?? v.length;
      textarea.value = v.slice(0, a) + ch + v.slice(e);
      const pos = a + ch.length;
      textarea.setSelectionRange(pos, pos);
      onInsert(textarea.value);
    });
    grid.append(b);
  }
  const btn = h('button', { type: 'button', class: 'btn small symbol-btn', title: 'Symbol einfügen (Herz, Stern, Pfote …)', 'aria-expanded': 'false' }, '♥ Symbol');
  btn.addEventListener('click', () => {
    grid.hidden = !grid.hidden;
    btn.setAttribute('aria-expanded', String(!grid.hidden));
    btn.classList.toggle('active', !grid.hidden);
  });
  return [h('div', { class: 'symbol-bar' }, btn), grid];
}

function textArea(panel, opts) {
  const ta = h('textarea', { rows: '2', spellcheck: 'false', placeholder: opts.placeholder || 'Text eingeben', 'aria-label': opts.label || 'Text' });
  ta.addEventListener('input', () => {
    opts.bind.set(ta.value);
    ta.rows = Math.min(6, Math.max(1, ta.value.split('\n').length));
  });
  ta.addEventListener('change', () => panel.app.commit());
  const picker = opts.symbols === false ? [] : symbolPicker(ta, (v) => {
    opts.bind.set(v);
    panel.app.commit();
  });
  const el = h('div', { class: 'ctl ctl-textarea wide' }, ta, ...picker);
  return panel.register(el, () => {
    const v = String(opts.bind.get() ?? '');
    if (document.activeElement !== ta && ta.value !== v) ta.value = v;
    ta.rows = Math.min(6, Math.max(1, ta.value.split('\n').length));
  }, opts.visible);
}

function fontRow(panel, app, id, openFontDialog) {
  const select = h('select', { 'aria-label': 'Schrift' });
  const more = h('button', { type: 'button', class: 'btn small', title: 'Alle Google-Schriften durchsuchen', html: `${icon('font')}<span>Mehr …</span>` });
  const status = h('span', { class: 'font-status' });
  const fill = () => {
    const t = app.text(id);
    if (!t) return;
    const current = fontKey(t.font);
    const opts = BUILTIN_FONTS.map((f) => [fontKey(f), `${f.family}${f.weight >= 700 ? ' (fett)' : ''}`]);
    if (!opts.some(([k]) => k === current)) opts.unshift([current, `${t.font.family}${t.font.weight !== 400 ? ` ${t.font.weight}` : ''}`]);
    select.innerHTML = '';
    for (const [k, label] of opts) select.append(h('option', { value: k }, label));
    select.value = current;
    const loading = app.loading.has(current);
    const error = app.fontErrors.get(current);
    status.textContent = loading ? 'lädt …' : error ? 'nicht geladen' : '';
    status.className = `font-status${error ? ' warn' : ''}`;
  };
  select.addEventListener('change', async () => {
    const f = BUILTIN_FONTS.find((x) => fontKey(x) === select.value);
    if (f) await app.useFont(id, f);
    fill();
  });
  more.addEventListener('click', () => openFontDialog(id));
  app.on('fonts', fill);
  const el = h('div', { class: 'ctl wide' }, h('span', { class: 'ctl-label' }, 'Schrift'),
    h('div', { class: 'font-row' }, h('div', { class: 'ctl-field' }, select), more), status);
  return panel.register(el, fill);
}

/** Reads an SVG file chosen by the user; resolves to the graphic or null. */
function pickGraphic(app) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.svg,image/svg+xml', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve(null);
      try {
        const g = parseSVG(await file.text(), { name: file.name });
        for (const w of g.warnings) app.emit('toast', w);
        resolve(g);
      } catch (err) {
        app.emit('toast', `SVG nicht lesbar: ${err.message}`);
        resolve(null);
      }
    });
    document.body.append(input);
    input.click();
  });
}

/** Position, rotation, side and own colour – the same for every kind of block. */
function commonFields(panel, app, id, bind) {
  const block = () => app.text(id);
  const hasBase = () => app.doc.base.shape !== 'none';
  const multiple = () => app.doc.texts.length > 1;
  // Only lettering that is a part of its own can have its own filament.
  const colourable = () => {
    const b = block();
    if (!b) return false;
    if (b.side === 'back' && hasBase()) return app.doc.back.relief === 'inlay';
    return app.doc.body.relief !== 'engraved' || !hasBase();
  };
  return [
    grid(
      numberField(panel, { label: 'Position X', unit: 'mm', bind: bind('x'), step: 0.5, digits: 2 }),
      numberField(panel, { label: 'Position Y', unit: 'mm', bind: bind('y'), step: 0.5, digits: 2 }),
      numberField(panel, { label: 'Drehung', unit: '°', bind: bind('rotation'), min: -360, max: 360, step: 1, digits: 1, visible: () => multiple() || block()?.kind !== 'text' }),
    ),
    segmented(panel, {
      label: 'Seite',
      bind: {
        get: () => block()?.side,
        set: (side) => {
          const b = block();
          if (!b || b.side === side) return;
          b.side = side;
          // Start in the middle of the other side.
          b.x = 0;
          b.y = 0;
          app.changed();
        },
      },
      options: [['front', 'Vorne'], ['back', 'Hinten']],
      visible: hasBase,
    }),
    toggle(panel, {
      label: 'Eigene Farbe',
      title: 'Dieser Block bekommt eine eigene Farbe und ein eigenes AMS-Filament',
      bind: {
        get: () => (block()?.slot || 0) > 0,
        set: (on) => {
          const b = block();
          if (!b) return;
          if (on) {
            // Next AMS slot no part uses yet, and a colour that stands out.
            const used = new Set([app.doc.slots.base, app.doc.slots.text, ...app.doc.texts.map((x) => x.slot)]);
            for (const part of app.model?.parts || []) used.add(part.slot);
            let slot = 1;
            while (used.has(slot) && slot < 16) slot++;
            b.slot = slot;
            b.color = b.color || OWN_COLORS[(slot - 1) % OWN_COLORS.length];
          } else {
            b.slot = 0;
          }
          app.changed();
        },
      },
      visible: () => colourable() && (multiple() || (block()?.slot || 0) > 0),
    }),
    grid(
      colorField(panel, { label: 'Farbe', bind: { get: () => block()?.color || app.doc.colors.text, set: (v) => app.setText(id, 'color', v) }, visible: () => colourable() && (block()?.slot || 0) > 0 }),
      selectField(panel, { label: 'AMS', bind: bind('slot'), options: Array.from({ length: 16 }, (_, i) => [i + 1, `Filament ${i + 1}`]), wide: false, visible: () => colourable() && (block()?.slot || 0) > 0 }),
    ),
  ];
}

function textFields(panel, app, id, index, bind, openFontDialog) {
  return [
    textArea(panel, { bind: bind('text'), label: `Text ${index + 1}` }),
    fontRow(panel, app, id, openFontDialog),
    grid(
      numberField(panel, { label: 'Schrifthöhe', title: 'Höhe der Großbuchstaben (H)', unit: 'mm', bind: bind('size'), min: 0.5, max: 500, step: 0.5, digits: 2, slider: [3, 40] }),
      numberField(panel, { label: 'Fettung', title: 'Striche dicker (+) oder dünner (−), in mm', unit: 'mm', bind: bind('bold'), min: -2, max: 5, step: 0.05, digits: 2, slider: [-0.6, 1.2] }),
      numberField(panel, { label: 'Zeichenabstand', unit: 'mm', bind: bind('letterSpacing'), min: -10, max: 50, step: 0.1, digits: 2, slider: [-1.5, 4] }),
      numberField(panel, { label: 'Zeilenabstand', title: 'Abstand der Grundlinien als Vielfaches der Schriftgröße', unit: '×', bind: bind('lineSpacing'), min: 0.5, max: 4, step: 0.05, digits: 2, slider: [0.7, 2], visible: () => (app.text(id)?.text || '').includes('\n') }),
    ),
    segmented(panel, {
      label: 'Ausrichtung',
      bind: bind('align'),
      iconOnly: true,
      options: [['left', 'Links', 'alignLeft', 'Linksbündig'], ['center', 'Mitte', 'alignCenter', 'Zentriert'], ['right', 'Rechts', 'alignRight', 'Rechtsbündig']],
      visible: () => (app.text(id)?.text || '').includes('\n'),
    }),
    segmented(panel, {
      label: 'Form',
      bind: bind('layout'),
      options: [
        ['line', 'Gerade', null, 'Gerade Zeilen'],
        ['bend', 'Bogen', null, 'Der Text wird an seiner Stelle gebogen'],
        ['arcTop', 'Kreis oben', null, 'Oben auf einem Kreis um die Position, z. B. für Münzen und Siegel'],
        ['arcBottom', 'Kreis unten', null, 'Unten auf einem Kreis um die Position, lesbar von links nach rechts'],
      ],
    }),
    numberField(panel, { label: 'Biegung', title: 'Wie weit der Text um den Bogen läuft: positiv nach oben gewölbt, negativ nach unten', unit: '°', bind: bind('bend'), min: -340, max: 340, step: 5, digits: 0, slider: [-180, 180], wide: true, visible: () => app.text(id)?.layout === 'bend' }),
    numberField(panel, { label: 'Radius', title: 'Von der Kreismitte (Position des Textes) bis zur Mitte der Großbuchstaben', unit: 'mm', bind: bind('radius'), min: 1, max: 2000, step: 0.5, digits: 1, slider: [5, 120], wide: true, visible: () => isCircle(app.text(id)) }),
    note(panel, 'Die Position ist die Kreismitte (gestrichelt in der Vorschau). Für eine Münze oder ein Siegel: Text oben und Text unten mit derselben Position und demselben Radius.', () => isCircle(app.text(id))),
  ];
}

const isCircle = (b) => b?.layout === 'arcTop' || b?.layout === 'arcBottom';

/** Grid of the built-in symbols; the chosen one is highlighted. */
function symbolChooser(panel, bind, visible) {
  const grid = h('div', { class: 'symbol-grid chooser', role: 'group', 'aria-label': 'Symbol für die Mitte' });
  const buttons = [...SYMBOLS].map((ch) => {
    const b = h('button', { type: 'button', class: 'symbol', title: `„${ch}“`, 'data-ch': ch }, ch);
    b.addEventListener('click', () => {
      bind.set(ch);
      panel.app.commit();
    });
    grid.append(b);
    return b;
  });
  const el = h('div', { class: 'ctl wide' }, grid);
  return panel.register(el, () => {
    const cur = bind.get();
    for (const b of buttons) b.classList.toggle('active', b.dataset.ch === cur);
  }, visible);
}

function qrFields(panel, app, id, bind) {
  const block = () => app.text(id);
  const wifi = () => block()?.qrMode === 'wifi';
  const logo = () => (block()?.qrLogo || 'none') !== 'none';
  const info = () => app.model?.layouts.find((l) => l.block.id === id)?.qr;
  const pickLogo = h('button', { type: 'button', class: 'btn small', html: `${icon('open')}<span>SVG laden …</span>` });
  pickLogo.addEventListener('click', async () => {
    const g = await pickGraphic(app);
    if (!g) return;
    app.setText(id, 'qrLogoGraphic', g);
    app.commit();
  });
  const logoName = h('span', { class: 'graphic-name' });
  const logoRow = panel.register(h('div', { class: 'ctl wide graphic-row' }, logoName, pickLogo), () => {
    const g = block()?.qrLogoGraphic;
    logoName.textContent = g ? (g.name || 'Grafik') : 'Noch keine Grafik';
  }, () => block()?.qrLogo === 'graphic');
  return [
    segmented(panel, { label: 'Inhalt', bind: bind('qrMode'), options: [['link', 'Link / Text'], ['wifi', 'WLAN']] }),
    textArea(panel, { bind: bind('qrText'), label: 'Inhalt des QR-Codes', placeholder: 'https://… oder beliebiger Text', symbols: false, visible: () => !wifi() }),
    textField(panel, { label: 'Netzwerkname (SSID)', bind: bind('wifiSsid'), maxlength: 64, visible: wifi }),
    textField(panel, { label: 'Passwort', bind: bind('wifiPassword'), maxlength: 64, visible: () => wifi() && app.text(id)?.wifiSecurity !== 'nopass' }),
    selectField(panel, { label: 'Verschlüsselung', bind: bind('wifiSecurity'), options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP (alt)'], ['nopass', 'Offen, ohne Passwort']], visible: wifi }),
    toggle(panel, { label: 'Verstecktes Netz', title: 'Das Netz sendet seinen Namen nicht', bind: bind('wifiHidden'), visible: wifi }),
    note(panel, 'Handy-Kamera auf das Schild – schon ist man im WLAN. Das Passwort steht auch im Teilen-Link und in Projektdateien.', wifi),
    grid(
      numberField(panel, { label: 'Größe', title: 'Kantenlänge des QR-Codes (ohne Rand)', unit: 'mm', bind: bind('size'), min: 3, max: 1000, step: 1, digits: 1, slider: [10, 80] }),
      selectField(panel, { label: 'Fehlerkorrektur', title: 'Mehr Korrektur: robuster, aber mehr (kleinere) Module', bind: bind('qrLevel'), options: [['L', 'L – 7 %'], ['M', 'M – 15 %'], ['Q', 'Q – 25 %'], ['H', 'H – 30 %']], wide: false, visible: () => !logo() }),
    ),
    segmented(panel, { label: 'Stil', bind: bind('qrStyle'), options: [['square', 'Quadrate'], ['dots', 'Runde Punkte']] }),
    numberField(panel, { label: 'Punktgröße', title: 'Durchmesser der Punkte, bezogen auf ein Modul (die Positionsmarken bleiben massiv)', unit: '%', percent: true, bind: bind('qrDot'), min: 0.5, max: 1, step: 5, digits: 0, slider: [0.5, 1], wide: true, visible: () => block()?.qrStyle === 'dots' }),
    segmented(panel, { label: 'Logo in der Mitte', bind: bind('qrLogo'), options: [['none', 'Keins'], ['symbol', 'Symbol'], ['graphic', 'Grafik']] }),
    symbolChooser(panel, bind('qrLogoSymbol'), () => block()?.qrLogo === 'symbol'),
    logoRow,
    numberField(panel, { label: 'Logo-Größe', title: 'Breite der freien Mitte, bezogen auf den Code', unit: '%', percent: true, bind: bind('qrLogoSize'), min: 0.1, max: 0.35, step: 1, digits: 0, slider: [0.1, 0.35], wide: true, visible: logo }),
    note(panel, 'Mit Logo nutzt der Code die höchste Fehlerkorrektur (H) – dadurch mehr und kleinere Module; den Code dafür etwas größer machen.', logo),
    note(panel, () => {
      const q = info();
      if (!q) return '';
      const min = Math.max(QR_MIN_MODULE, app.doc.check.minStroke || 0);
      const ok = q.module >= min - 1e-9;
      return `${q.modules} × ${q.modules} Module à <span class="${ok ? 'ok' : 'warn'}">${de(q.module, 2)} mm</span>`
        + (ok ? ' – gut druckbar.' : ` – größer machen (Module ab ${de(min, 1)} mm).`)
        + ' Am besten dunkel auf hell, bündig oder erhaben in zweiter Farbe.';
    }),
  ];
}

function graphicFields(panel, app, id, bind) {
  const block = () => app.text(id);
  const replace = h('button', { type: 'button', class: 'btn small', title: 'Andere SVG-Datei laden', html: `${icon('open')}<span>Andere SVG …</span>` });
  replace.addEventListener('click', async () => {
    const g = await pickGraphic(app);
    if (!g) return;
    app.setText(id, 'graphic', g);
    app.commit();
  });
  const nameEl = h('span', { class: 'graphic-name' });
  const row = panel.register(h('div', { class: 'ctl wide graphic-row' }, nameEl, replace), () => {
    const g = block()?.graphic;
    nameEl.textContent = g ? (g.name || 'Grafik') : 'Keine Grafik';
  });
  return [
    row,
    grid(
      numberField(panel, { label: 'Höhe', unit: 'mm', bind: bind('size'), min: 0.5, max: 1000, step: 0.5, digits: 1, slider: [5, 100] }),
      numberField(panel, { label: 'Fettung', title: 'Linien dicker (+) oder dünner (−), in mm', unit: 'mm', bind: bind('bold'), min: -2, max: 5, step: 0.05, digits: 2, slider: [-0.6, 1.2] }),
    ),
    toggle(panel, { label: 'Hell und dunkel tauschen', title: 'Für Grafiken, die hell auf dunklem Grund gezeichnet sind', bind: bind('invert') }),
    note(panel, () => {
      const lay = app.model?.layouts.find((l) => l.block.id === id);
      if (!lay) return block()?.graphic ? 'Die Grafik ist leer – „Hell und dunkel tauschen“ probieren.' : '';
      const b = lay.bounds;
      return `${de(b.maxX - b.minX)} × ${de(b.maxY - b.minY)} mm. Dunkle Flächen werden gedruckt, weiße darauf sparen aus.`;
    }),
  ];
}

function blockCard(panel, app, t, index, openFontDialog) {
  const { id } = t;
  const kind = t.kind || 'text';
  const bind = (key) => ({ get: () => app.text(id)?.[key], set: (v) => app.setText(id, key, v) });
  const del = h('button', { type: 'button', class: 'icon-btn', title: 'Entfernen', html: icon('trash') });
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    app.removeText(id);
  });
  const multiple = () => app.doc.texts.length > 1;
  const sideTag = h('span', { class: 'side-tag' }, 'hinten');
  const head = h('div', { class: 'text-card-head' }, h('span', { class: 'text-card-title' }, `${KIND_NAMES[kind]} ${index + 1}`), sideTag, h('span', { class: 'spacer' }), del);
  const fields = kind === 'qr' ? qrFields(panel, app, id, bind)
    : kind === 'graphic' ? graphicFields(panel, app, id, bind)
      : textFields(panel, app, id, index, bind, openFontDialog);
  const body = h('div', { class: 'text-card-body' }, ...fields, ...commonFields(panel, app, id, bind));
  const card = h('div', { class: `text-card kind-${kind}`, 'data-id': id }, head, body);
  card.addEventListener('pointerdown', () => app.select(id));
  card.addEventListener('focusin', () => app.select(id));
  panel.register(card, () => {
    card.classList.toggle('selected', multiple() && app.selectedId === id);
    del.hidden = !multiple();
    sideTag.hidden = !(app.text(id)?.side === 'back' && app.doc.base.shape !== 'none');
  });
  return card;
}

export function buildLeftPanel(root, app, { onPresetsSection, openFontDialog }) {
  const panel = new Panel(app);
  root.innerHTML = '';

  const presets = section('Vorlagen', { id: 'presets', icon: 'layers' });
  root.append(presets.el);
  onPresetsSection(presets.body);

  const add = h('button', { type: 'button', class: 'icon-btn', title: 'Weiteren Text hinzufügen (z. B. zweite Zeile in anderer Schrift)', html: icon('plus') });
  add.addEventListener('click', () => app.addBlock('text'));
  const textSec = section('Inhalt', { id: 'text', icon: 'text', actions: [add] });
  root.append(textSec.el);
  const list = h('div', { class: 'text-list' });
  const addButton = (label, title, onClick) => {
    const b = h('button', { type: 'button', class: 'btn small', title, html: `${icon('plus')}<span>${label}</span>` });
    b.addEventListener('click', onClick);
    return b;
  };
  const adds = h('div', { class: 'add-row' },
    addButton('Text', 'Weiteren Text hinzufügen – eigene Schrift, Größe und Position', () => app.addBlock('text')),
    addButton('QR-Code', 'QR-Code hinzufügen, z. B. für WLAN oder einen Link', () => app.addBlock('qr')),
    addButton('Grafik …', 'Eigene Grafik (SVG-Datei) hinzufügen, z. B. ein Logo', async () => {
      const g = await pickGraphic(app);
      if (g) app.addBlock('graphic', { graphic: g });
    }));
  const hint = h('p', { class: 'ctl-note' }, 'In der Vorschau lässt sich jeder Block mit der Maus verschieben. Mit „Seite: Hinten“ kommt er auf die Rückseite.');
  textSec.body.append(list, adds, hint);
  const rebuild = () => {
    list.innerHTML = '';
    panel.prune();
    app.doc.texts.forEach((t, i) => list.append(blockCard(panel, app, t, i, openFontDialog)));
    panel.refresh();
  };
  app.on('structure', rebuild);
  app.on('selection', () => panel.refresh());
  rebuild();
  return panel;
}

// --- form, mount, body, colours, check ------------------------------------------------

const SHAPE_NOTES = {
  contour: 'Die Platte folgt dem Umriss der Schrift – typisch für Namens-Anhänger.',
  rect: 'Rechteckige Platte, automatisch um die Schrift oder mit festen Maßen.',
  capsule: 'Platte mit runden Enden.',
  oval: 'Ovale Platte.',
  circle: 'Runde Platte.',
  none: 'Keine Platte: Die Buchstaben selbst sind das Teil. Getrennte Teile (i-Punkte, Umlaute) fallen auseinander – eine Schreibschrift oder „Fettung“ hilft.',
};

const STAMP_NOTES = {
  ink: 'Tinten-Stempel: Schrift spiegelverkehrt und 1,5 mm erhaben. Eine kräftige Schrift wählen (Striche ab 0,8 mm); mit TPU für die Platte werden die Abdrücke gleichmäßiger.',
  cookie: 'Keks- und Fondantstempel: 2,5 mm tief, schräge Flanken lösen sich leichter aus dem Teig. Für Lebensmittel PETG oder PLA mit Lebensmittelfreigabe nehmen, vor dem Stempeln mit Mehl bestäuben, nicht in die Spülmaschine.',
  clay: 'Für Ton, Seife und Leder: tiefe, robuste Prägung mit schrägen Flanken. Vor dem Prägen leicht einölen oder mit Speisestärke bestäuben, Leder vorher anfeuchten.',
};

const RELIEF_NOTES = {
  raised: 'Die Schrift steht auf der Platte.',
  engraved: 'Die Schrift ist in die Platte vertieft.',
  flush: 'Die Schrift ist bündig in die Platte eingelegt – ideal zweifarbig mit AMS: glatte Oberfläche, Farbe nur in den Buchstaben.',
  cut: 'Schablone zum Sprühen oder Airbrushen: Die Schrift ist ausgeschnitten, das Innere von O, A, B … halten automatische Stege.',
};

export function buildRightPanel(root, app) {
  const panel = new Panel(app);
  root.innerHTML = '';
  const doc = () => app.doc;
  const shape = () => doc().base.shape;
  const hasBase = () => shape() !== 'none';
  const sizable = () => ['rect', 'capsule', 'oval', 'circle'].includes(shape());
  const fixed = () => sizable() && doc().base.sizeMode === 'fixed';

  const form = section('Grundform', { id: 'base', icon: 'shapeRect' });
  form.body.append(
    segmented(panel, {
      bind: bindPath(app, 'base.shape'),
      iconOnly: true,
      options: [
        ['contour', 'Kontur', 'shapeContour', 'Kontur – folgt der Schrift'],
        ['rect', 'Rechteck', 'shapeRect', 'Rechteck'],
        ['capsule', 'Kapsel', 'shapeCapsule', 'Kapsel (runde Enden)'],
        ['oval', 'Oval', 'shapeOval', 'Oval'],
        ['circle', 'Kreis', 'shapeCircle', 'Kreis'],
        ['none', 'Ohne', 'shapeNone', 'Ohne Platte – nur Buchstaben'],
      ],
    }),
    note(panel, () => SHAPE_NOTES[shape()]),
    segmented(panel, { label: 'Größe', bind: bindPath(app, 'base.sizeMode'), options: [['auto', 'Um die Schrift'], ['fixed', 'Feste Maße']], visible: sizable }),
    grid(
      numberField(panel, { label: 'Randabstand', title: 'Abstand zwischen Schrift und Plattenrand', unit: 'mm', bind: bindPath(app, 'base.padding'), min: 0, max: 100, step: 0.2, digits: 2, slider: [0, 10], visible: () => hasBase() && !fixed() }),
      numberField(panel, { label: 'Breite', unit: 'mm', bind: bindPath(app, 'base.width'), min: 1, max: 2000, step: 1, digits: 1, visible: () => fixed() && shape() !== 'circle' }),
      numberField(panel, { label: 'Durchmesser', unit: 'mm', bind: bindPath(app, 'base.width'), min: 1, max: 2000, step: 1, digits: 1, visible: () => fixed() && shape() === 'circle' }),
      numberField(panel, { label: 'Höhe', unit: 'mm', bind: bindPath(app, 'base.height'), min: 1, max: 2000, step: 1, digits: 1, visible: () => fixed() && shape() !== 'circle' }),
      numberField(panel, { label: 'Eckenradius', unit: 'mm', bind: bindPath(app, 'base.radius'), min: 0, max: 500, step: 0.5, digits: 1, slider: [0, 15], visible: () => shape() === 'rect' }),
    ),
  );

  const mount = section('Befestigung', { id: 'mount', icon: 'ring' });
  const mtype = () => doc().mount.type;
  const mountOn = () => hasBase() && mtype() !== 'none';
  const screws = () => hasBase() && mtype() === 'screws';
  const MOUNT_NOTES = {
    eyelet: 'Die Öse sitzt außen an der Platte – für Schlüsselring oder Band.',
    hole: 'Das Loch liegt in der Platte; sie wird dafür verlängert.',
    slot: 'Längliches Loch für Band, Lanyard oder Clip.',
    screws: 'Zwei Schraublöcher links und rechts; mit Senkung für Senkkopfschrauben (90°).',
  };
  mount.body.append(
    segmented(panel, { label: 'Art', bind: bindPath(app, 'mount.type'), options: [['none', 'Keine'], ['eyelet', 'Öse'], ['hole', 'Loch'], ['slot', 'Schlitz'], ['screws', 'Schrauben']], visible: hasBase }),
    note(panel, () => (shape() === 'contour' && (mtype() === 'hole' || mtype() === 'slot' || mtype() === 'screws')
      ? `${MOUNT_NOTES[mtype()]} Bei der Kontur wird dafür eine Lasche angesetzt.`
      : MOUNT_NOTES[mtype()] || ''), mountOn),
    segmented(panel, { label: 'Position', bind: bindPath(app, 'mount.position'), options: [['left', 'Links'], ['right', 'Rechts'], ['top', 'Oben']], visible: () => mountOn() && !screws() }),
    grid(
      numberField(panel, { label: 'Loch-Ø', unit: 'mm', bind: bindPath(app, 'mount.diameter'), min: 0.5, max: 50, step: 0.1, digits: 2, slider: [2, 10], visible: () => mountOn() && mtype() !== 'slot' }),
      numberField(panel, { label: 'Schlitzbreite', unit: 'mm', bind: bindPath(app, 'mount.diameter'), min: 0.5, max: 50, step: 0.1, digits: 2, slider: [2, 8], visible: () => mountOn() && mtype() === 'slot' }),
      numberField(panel, { label: 'Schlitzlänge', unit: 'mm', bind: bindPath(app, 'mount.length'), min: 1, max: 200, step: 0.5, digits: 1, slider: [6, 40], visible: () => mountOn() && mtype() === 'slot' }),
      numberField(panel, { label: 'Ringbreite', title: 'Material rund um das Loch', unit: 'mm', bind: bindPath(app, 'mount.ring'), min: 0.4, max: 20, step: 0.1, digits: 2, slider: [1, 5], visible: mountOn }),
    ),
    toggle(panel, { label: 'Senkung für Senkkopfschrauben', bind: bindPath(app, 'mount.countersink'), visible: screws }),
    numberField(panel, { label: 'Kopf-Ø', title: 'Durchmesser des Schraubenkopfs (Senkung 90°)', unit: 'mm', bind: bindPath(app, 'mount.head'), min: 1, max: 40, step: 0.1, digits: 2, slider: [5, 14], visible: () => screws() && doc().mount.countersink }),
    note(panel, 'Ohne Platte gibt es keine Befestigung.', () => !hasBase()),
  );

  const mag = section('Magnete (hinten)', { id: 'magnets', icon: 'shapeCircle', open: false });
  const magOn = () => hasBase() && doc().magnets.enabled;
  mag.body.append(
    toggle(panel, { label: 'Magnet-Taschen auf der Rückseite', bind: bindPath(app, 'magnets.enabled'), visible: hasBase }),
    grid(
      numberField(panel, { label: 'Anzahl', bind: bindPath(app, 'magnets.count'), min: 1, max: 12, step: 1, digits: 0, slider: [1, 6], visible: magOn }),
      numberField(panel, { label: 'Ø', title: 'Durchmesser der Tasche (Magnet + etwa 0,2 mm Spiel)', unit: 'mm', bind: bindPath(app, 'magnets.diameter'), min: 1, max: 60, step: 0.1, digits: 2, slider: [3, 20], visible: magOn }),
      numberField(panel, { label: 'Tiefe', title: 'Tiefe der Tasche (Magnet + etwa 0,2 mm)', unit: 'mm', bind: bindPath(app, 'magnets.depth'), min: 0.2, max: 20, step: 0.1, digits: 2, slider: [1, 6], visible: magOn }),
    ),
    note(panel, 'Runde Taschen hinten zum Einkleben, z. B. für 6 × 2 mm Neodym-Magnete (Tasche 6,2 × 2,2 mm) – ohne Druckpause. In der Vorschau gestrichelt.', magOn),
    note(panel, 'Ohne Platte gibt es keine Magnet-Taschen.', () => !hasBase()),
  );

  const body = section('Körper (3D)', { id: 'body', icon: 'cube' });
  const relief = () => doc().body.relief;
  const hasBack = () => hasBase() && relief() !== 'cut' && doc().texts.some((t) => t.side === 'back');
  const stencil = () => hasBase() && relief() === 'cut';
  const split = () => stencil() && doc().stencil.split;
  const stampOn = () => hasBase() && relief() !== 'cut' && doc().stamp.enabled;
  // Settings that suit the kind of stamp, folded into the same undo step.
  const applyStampKind = (kind) => {
    const d = STAMP_KIND_DEFAULTS[kind];
    const cur = doc();
    Object.assign(cur.body, d.body);
    Object.assign(cur.stamp, d.stamp);
    Object.assign(cur.check, d.check);
    app.changed();
    app.amend();
  };
  const border = () => hasBase() && doc().body.border && relief() !== 'cut';
  body.body.append(
    segmented(panel, {
      label: 'Schrift',
      bind: bindPath(app, 'body.relief'),
      options: [['raised', 'Erhaben'], ['engraved', 'Vertieft'], ['flush', 'Bündig'], ['cut', 'Schablone']],
      visible: hasBase,
      // A stencil wants to be thin (sharp edges, little filament).
      onChange: (v) => {
        if (v === 'cut' && doc().body.thickness > STENCIL_THICKNESS + 0.4) {
          app.set('body.thickness', STENCIL_THICKNESS);
          app.amend();
        }
      },
    }),
    note(panel, () => RELIEF_NOTES[relief()], () => hasBase() && !stampOn()),
    toggle(panel, {
      label: 'Stempel (Schrift gespiegelt)',
      title: 'Tinten-, Keks- oder Tonstempel: die Schrift wird gespiegelt, dazu ein Griff zum Aufstecken',
      bind: bindPath(app, 'stamp.enabled'),
      visible: () => hasBase() && relief() !== 'cut',
      onChange: (on) => {
        if (on) applyStampKind(doc().stamp.kind);
      },
    }),
    segmented(panel, { label: 'Stempel für', bind: bindPath(app, 'stamp.kind'), options: [['ink', 'Tinte'], ['cookie', 'Keks & Fondant'], ['clay', 'Ton, Seife, Leder']], visible: stampOn, onChange: (k) => applyStampKind(k) }),
    note(panel, () => STAMP_NOTES[doc().stamp.kind], stampOn),
    grid(
      numberField(panel, { label: 'Plattendicke', unit: 'mm', bind: bindPath(app, 'body.thickness'), min: 0.2, max: 100, step: 0.2, digits: 2, slider: [0.6, 8], visible: hasBase }),
      numberField(panel, { label: 'Dicke', title: 'Dicke der Buchstaben', unit: 'mm', bind: bindPath(app, 'body.thickness'), min: 0.2, max: 100, step: 0.2, digits: 2, slider: [0.6, 8], visible: () => !hasBase() }),
      numberField(panel, { label: 'Schrifthöhe', title: 'Wie weit die Schrift heraussteht', unit: 'mm', bind: bindPath(app, 'body.height'), min: 0.1, max: 50, step: 0.1, digits: 2, slider: [0.2, 4], visible: () => hasBase() && relief() === 'raised' }),
      numberField(panel, { label: 'Tiefe', title: 'Wie tief die Schrift in der Platte liegt', unit: 'mm', bind: bindPath(app, 'body.height'), min: 0.1, max: 50, step: 0.1, digits: 2, slider: [0.2, 4], visible: () => hasBase() && (relief() === 'engraved' || relief() === 'flush') }),
      numberField(panel, { label: 'Stegbreite', title: 'Breite der Stege, die die Inseln halten', unit: 'mm', bind: bindPath(app, 'stencil.bridge'), min: 0.4, max: 20, step: 0.1, digits: 2, slider: [0.8, 4], visible: stencil }),
    ),
    segmented(panel, { label: 'Stege je Insel', bind: bindPath(app, 'stencil.bridges'), options: [[1, 'Einer'], [2, 'Zwei (stabiler)']], visible: stencil }),
    segmented(panel, { label: 'Richtung der Stege', bind: bindPath(app, 'stencil.direction'), options: [['vertical', 'Senkrecht'], ['horizontal', 'Waagerecht'], ['auto', 'Kürzeste']], visible: stencil }),
    note(panel, () => {
      const m = app.model;
      const n = m ? m.islands : 0;
      return `${n ? `${n} Insel${n === 1 ? '' : 'n'} mit Stegen gehalten. ` : ''}Dicke für PLA/PETG: 0,8–1,5 mm – dünner gibt schärfere Kanten, dicker hält mehr aus. Rundherum genug Rand lassen (Randabstand), damit kein Sprühnebel danebengeht.`;
    }, stencil),
    grid(
      numberField(panel, { label: 'Schräge Flanken', title: 'Die Buchstaben werden zur Platte hin breiter und lösen sich leichter aus Teig, Ton oder Seife', unit: '°', bind: bindPath(app, 'stamp.draft'), min: 0, max: 30, step: 1, digits: 0, slider: [0, 25], visible: () => stampOn() && relief() === 'raised' }),
      numberField(panel, { label: 'Griffhöhe', unit: 'mm', bind: bindPath(app, 'stamp.handleHeight'), min: 15, max: 120, step: 1, digits: 0, slider: [20, 80], visible: () => stampOn() && doc().stamp.handle }),
    ),
    toggle(panel, { label: 'Griff mit Zapfen', title: 'Eigenes Teil, steckt in einer Tasche auf der Rückseite des Stempels', bind: bindPath(app, 'stamp.handle'), visible: stampOn }),
    numberField(panel, { label: 'Spiel am Zapfen', title: 'Luft je Seite zwischen Zapfen und Tasche (0,1–0,2 mm: stramm, mit etwas Kleber sicher)', unit: 'mm', bind: bindPath(app, 'stamp.clearance'), min: 0, max: 1, step: 0.05, digits: 2, slider: [0, 0.4], wide: true, visible: () => stampOn() && doc().stamp.handle }),
    note(panel, () => {
      const m = app.model;
      const hd = m?.stamp?.handle;
      if (!hd) return 'Ohne Griff: die glatte Rückseite z. B. auf einen Holzklotz kleben.';
      return `Der Griff (Ø ${de(hd.diameter, 0)} mm, ${de(hd.height, 0)} mm hoch) liegt als eigenes Teil daneben – kopfüber gedruckt, ohne Stützen.${hd.socketDepth ? ` Sein Zapfen steckt ${de(hd.socketDepth, 1)} mm tief in der Tasche auf der Rückseite.` : ''}`;
    }, stampOn),
    toggle(panel, { label: 'In Teile aufteilen, wenn größer als das Druckbett', title: 'Große Schablonen werden in Teile mit Puzzle-Verbindern (Schwalbenschwanz) zerlegt', bind: bindPath(app, 'stencil.split'), visible: stencil }),
    grid(
      numberField(panel, { label: 'Verbinder', title: 'Breite des Schwalbenschwanz-Kopfes – passt er nicht, wird er automatisch kleiner (bis 5 mm)', unit: 'mm', bind: bindPath(app, 'stencil.tab'), min: 4, max: 40, step: 0.5, digits: 1, slider: [5, 20], visible: split }),
      numberField(panel, { label: 'Spiel', title: 'Luft zwischen den Teilen, damit sie sich zusammenstecken lassen (PLA/PETG: 0,1–0,3 mm)', unit: 'mm', bind: bindPath(app, 'stencil.clearance'), min: 0, max: 2, step: 0.05, digits: 2, slider: [0, 0.5], visible: split }),
    ),
    note(panel, () => {
      const m = app.model;
      const bed = doc().check.bed;
      if (!m || !m.split) return `Passt aufs Druckbett (${bed} × ${bed} mm) – kein Aufteilen nötig.`;
      return `Aufgeteilt in <b>${m.pieces.length} Teile</b> (${m.split.nx} × ${m.split.ny}) für das Druckbett ${bed} × ${bed} mm, verbunden mit ${m.split.tabs} Puzzle-Verbinder${m.split.tabs === 1 ? '' : 'n'}${m.split.tabHead ? ` (ab ${de(m.split.tabHead, 1)} mm)` : ''}. Die Nähte laufen möglichst zwischen den Buchstaben. Das Druckbett stellst du unter „Prüfung“ ein.`;
    }, split),
    toggle(panel, { label: 'Rand', title: 'Erhaben – bei „Bündig“ bündig eingelegt', bind: bindPath(app, 'body.border'), visible: () => hasBase() && relief() !== 'cut' }),
    grid(
      numberField(panel, { label: 'Randbreite', unit: 'mm', bind: bindPath(app, 'body.borderWidth'), min: 0.2, max: 50, step: 0.1, digits: 2, slider: [0.4, 5], visible: border }),
      numberField(panel, { label: 'Randhöhe', unit: 'mm', bind: bindPath(app, 'body.borderHeight'), min: 0.1, max: 50, step: 0.1, digits: 2, slider: [0.2, 4], visible: () => border() && relief() !== 'flush' }),
    ),
    toggle(panel, { label: 'Kontur um die Schrift', title: 'Umriss um die Buchstaben in eigener Farbe (Sticker-Look)', bind: bindPath(app, 'body.outline'), visible: () => hasBase() && relief() !== 'engraved' && relief() !== 'cut' }),
    grid(
      numberField(panel, { label: 'Konturbreite', unit: 'mm', bind: bindPath(app, 'body.outlineWidth'), min: 0.2, max: 20, step: 0.1, digits: 2, slider: [0.4, 4], visible: () => hasBase() && doc().body.outline && relief() !== 'engraved' && relief() !== 'cut' }),
      numberField(panel, { label: 'Konturhöhe', title: 'Die Schrift steht auf der Kontur', unit: 'mm', bind: bindPath(app, 'body.outlineHeight'), min: 0.1, max: 20, step: 0.1, digits: 2, slider: [0.2, 3], visible: () => hasBase() && doc().body.outline && relief() === 'raised' }),
    ),
    note(panel, 'Bei „Bündig“ sind Rand und Kontur ebenfalls bündig eingelegt – die Oberfläche bleibt glatt.', () => hasBase() && relief() === 'flush' && (doc().body.border || doc().body.outline)),
    segmented(panel, { label: 'Rückseite', bind: bindPath(app, 'back.relief'), options: [['inlay', 'Farbig eingelegt'], ['engraved', 'Vertieft']], visible: hasBack }),
    numberField(panel, { label: 'Tiefe hinten', title: 'Wie tief die Beschriftung der Rückseite in der Platte liegt', unit: 'mm', bind: bindPath(app, 'back.depth'), min: 0.1, max: 20, step: 0.1, digits: 2, slider: [0.2, 2], visible: hasBack }),
    note(panel, () => (doc().back.relief === 'inlay'
      ? 'Die Rückseite liegt beim Druck unten auf dem Druckbett – glatt, die Schrift in eigener Farbe in den ersten Schichten.'
      : 'Die Rückseite ist in den Boden vertieft (gespiegelt, damit sie von hinten richtig herum steht).'), hasBack),
    note(panel, 'Tipp: Dicken als Vielfache der Schichthöhe wählen (z. B. 0,2 mm) – dann liegt der Farbwechsel genau auf einer Schicht.', () => relief() !== 'cut' || !hasBase()),
  );

  const colors = section('Farben & Filamente', { id: 'colors', icon: 'palette' });
  const slotOptions = Array.from({ length: 16 }, (_, i) => [i + 1, `Filament ${i + 1}`]);
  const partVisible = (key) => () => {
    const m = app.model;
    // The pieces of a split stencil are the plate, too.
    return m ? m.parts.some((p) => p.id === key || (key === 'base' && p.piece)) : true;
  };
  for (const [key, label] of [['base', 'Platte'], ['text', 'Schrift'], ['outline', 'Kontur'], ['border', 'Rand']]) {
    colors.body.append(grid(
      colorField(panel, { label, bind: bindPath(app, `colors.${key}`), visible: partVisible(key) }),
      selectField(panel, { label: 'AMS', bind: bindPath(app, `slots.${key}`), options: slotOptions, wide: false, visible: partVisible(key) }),
    ));
  }
  colors.body.append(note(panel, () => {
    const own = doc().texts.map((t, i) => [t, i]).filter(([t]) => t.slot > 0);
    return own.map(([t, i]) => `Text ${i + 1}: eigene Farbe, Filament ${t.slot}`).join(' · ') + (own.length ? ' – einstellbar beim Text.' : '');
  }, () => doc().texts.some((t) => t.slot > 0) && (relief() !== 'engraved' || !hasBase())));
  colors.body.append(note(panel, 'Die Farben sind für die Vorschau. In der 3MF-Datei ist jedes Teil seinem Filament zugeordnet – in Bambu Studio wählst du dazu die AMS-Farben.'));

  const check = section('Prüfung (3D-Druck)', { id: 'check', icon: 'check' });
  check.body.append(
    numberField(panel, { label: 'Mindest-Strichstärke', title: 'Dünnere Stellen der Schrift – bei Schablonen des Materials (Stege, Stellen zwischen Buchstaben) – werden orange markiert (0,4-mm-Düse: etwa 0,8 mm)', unit: 'mm', bind: bindPath(app, 'check.minStroke'), min: 0, max: 5, step: 0.1, digits: 2, slider: [0, 2], wide: true }),
    selectField(panel, { label: 'Druckbett', bind: bindPath(app, 'check.bed'), options: [[180, 'A1 mini – 180 × 180 mm'], [256, 'A1 / P1 / X1 – 256 × 256 mm'], [320, 'H2D – 320 × 320 mm']] }),
    note(panel, () => {
      const m = app.model;
      if (!m) return '';
      if (!doc().check.minStroke) return 'Prüfung aus.';
      const cut = m.relief === 'cut';
      if (!m.stats.thinCount) return `<span class="ok">${cut ? 'Stege und Material sind' : 'Alle Striche sind'} mindestens ${de(doc().check.minStroke, 2)} mm breit.</span>`;
      const where = `<span class="warn">${m.stats.thinCount} Stelle${m.stats.thinCount === 1 ? '' : 'n'} dünner als ${de(doc().check.minStroke, 2)} mm</span> (orange markiert)`;
      return cut
        ? `${where} – das Material der Schablone bricht dort leicht: breitere Stege, mehr Buchstabenabstand oder größere Schrift.`
        : `${where} – größere Schrift, „Fettung“ oder eine kräftigere Schrift wählen.`;
    }),
  );

  root.append(form.el, mount.el, mag.el, body.el, colors.el, check.el);
  return panel;
}
