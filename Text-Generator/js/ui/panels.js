// Side panels: text blocks on the left; base shape, mount, 3D body, colours
// and the print check on the right.

import {
  h, Panel, numberField, selectField, segmented, toggle, colorField, note, grid, section, bindPath,
} from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { BUILTIN_FONTS, fontKey, SYMBOLS } from '../core/fonts.js';

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
  const ta = h('textarea', { rows: '2', spellcheck: 'false', placeholder: 'Text eingeben', 'aria-label': opts.label || 'Text' });
  ta.addEventListener('input', () => {
    opts.bind.set(ta.value);
    ta.rows = Math.min(6, Math.max(1, ta.value.split('\n').length));
  });
  ta.addEventListener('change', () => panel.app.commit());
  const picker = symbolPicker(ta, (v) => {
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

function textCard(panel, app, t, index, openFontDialog) {
  const { id } = t;
  const bind = (key) => ({ get: () => app.text(id)?.[key], set: (v) => app.setText(id, key, v) });
  const del = h('button', { type: 'button', class: 'icon-btn', title: 'Text entfernen', html: icon('trash') });
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    app.removeText(id);
  });
  const multiple = () => app.doc.texts.length > 1;
  const head = h('div', { class: 'text-card-head' }, h('span', { class: 'text-card-title' }, `Text ${index + 1}`), h('span', { class: 'spacer' }), del);
  const body = h('div', { class: 'text-card-body' },
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
    grid(
      numberField(panel, { label: 'Position X', unit: 'mm', bind: bind('x'), step: 0.5, digits: 2 }),
      numberField(panel, { label: 'Position Y', unit: 'mm', bind: bind('y'), step: 0.5, digits: 2 }),
      numberField(panel, { label: 'Drehung', unit: '°', bind: bind('rotation'), min: -360, max: 360, step: 1, digits: 1, visible: multiple }),
    ),
    toggle(panel, {
      label: 'Eigene Farbe',
      title: 'Dieser Text bekommt eine eigene Farbe und ein eigenes AMS-Filament',
      bind: {
        get: () => (app.text(id)?.slot || 0) > 0,
        set: (on) => {
          const txt = app.text(id);
          if (!txt) return;
          if (on) {
            // Next AMS slot no part uses yet, and a colour that stands out.
            const used = new Set([app.doc.slots.base, app.doc.slots.text, ...app.doc.texts.map((x) => x.slot)]);
            for (const part of app.model?.parts || []) used.add(part.slot);
            let slot = 1;
            while (used.has(slot) && slot < 16) slot++;
            txt.slot = slot;
            txt.color = txt.color || OWN_COLORS[(slot - 1) % OWN_COLORS.length];
          } else {
            txt.slot = 0;
          }
          app.changed();
        },
      },
      // Engraved text is part of the plate; one text alone uses "Schrift".
      visible: () => (app.doc.body.relief !== 'engraved' || app.doc.base.shape === 'none') && (multiple() || (app.text(id)?.slot || 0) > 0),
    }),
    grid(
      colorField(panel, { label: 'Farbe', bind: { get: () => app.text(id)?.color || app.doc.colors.text, set: (v) => app.setText(id, 'color', v) }, visible: () => (app.text(id)?.slot || 0) > 0 }),
      selectField(panel, { label: 'AMS', bind: bind('slot'), options: Array.from({ length: 16 }, (_, i) => [i + 1, `Filament ${i + 1}`]), wide: false, visible: () => (app.text(id)?.slot || 0) > 0 }),
    ),
  );
  const card = h('div', { class: 'text-card', 'data-id': id }, head, body);
  card.addEventListener('pointerdown', () => app.select(id));
  card.addEventListener('focusin', () => app.select(id));
  panel.register(card, () => {
    card.classList.toggle('selected', multiple() && app.selectedId === id);
    del.hidden = !multiple();
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
  add.addEventListener('click', () => app.addText());
  const textSec = section('Text', { id: 'text', icon: 'text', actions: [add] });
  root.append(textSec.el);
  const list = h('div', { class: 'text-list' });
  const hint = h('p', { class: 'ctl-note' }, 'Mit ', h('b', {}, '+'), ' kommt ein weiterer Text dazu – eigene Schrift, Größe und Position. In der Vorschau lässt sich jeder Text mit der Maus verschieben.');
  textSec.body.append(list, hint);
  const rebuild = () => {
    list.innerHTML = '';
    panel.prune();
    app.doc.texts.forEach((t, i) => list.append(textCard(panel, app, t, i, openFontDialog)));
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

const RELIEF_NOTES = {
  raised: 'Die Schrift steht auf der Platte.',
  engraved: 'Die Schrift ist in die Platte vertieft.',
  flush: 'Die Schrift ist bündig in die Platte eingelegt – ideal zweifarbig mit AMS: glatte Oberfläche, Farbe nur in den Buchstaben.',
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
  const border = () => hasBase() && doc().body.border;
  body.body.append(
    segmented(panel, { label: 'Schrift', bind: bindPath(app, 'body.relief'), options: [['raised', 'Erhaben'], ['engraved', 'Vertieft'], ['flush', 'Bündig']], visible: hasBase }),
    note(panel, () => RELIEF_NOTES[relief()], hasBase),
    grid(
      numberField(panel, { label: 'Plattendicke', unit: 'mm', bind: bindPath(app, 'body.thickness'), min: 0.2, max: 100, step: 0.2, digits: 2, slider: [0.6, 8], visible: hasBase }),
      numberField(panel, { label: 'Dicke', title: 'Dicke der Buchstaben', unit: 'mm', bind: bindPath(app, 'body.thickness'), min: 0.2, max: 100, step: 0.2, digits: 2, slider: [0.6, 8], visible: () => !hasBase() }),
      numberField(panel, { label: 'Schrifthöhe', title: 'Wie weit die Schrift heraussteht', unit: 'mm', bind: bindPath(app, 'body.height'), min: 0.1, max: 50, step: 0.1, digits: 2, slider: [0.2, 4], visible: () => hasBase() && relief() === 'raised' }),
      numberField(panel, { label: 'Tiefe', title: 'Wie tief die Schrift in der Platte liegt', unit: 'mm', bind: bindPath(app, 'body.height'), min: 0.1, max: 50, step: 0.1, digits: 2, slider: [0.2, 4], visible: () => hasBase() && relief() !== 'raised' }),
    ),
    toggle(panel, { label: 'Rand', title: 'Erhaben – bei „Bündig“ bündig eingelegt', bind: bindPath(app, 'body.border'), visible: hasBase }),
    grid(
      numberField(panel, { label: 'Randbreite', unit: 'mm', bind: bindPath(app, 'body.borderWidth'), min: 0.2, max: 50, step: 0.1, digits: 2, slider: [0.4, 5], visible: border }),
      numberField(panel, { label: 'Randhöhe', unit: 'mm', bind: bindPath(app, 'body.borderHeight'), min: 0.1, max: 50, step: 0.1, digits: 2, slider: [0.2, 4], visible: () => border() && relief() !== 'flush' }),
    ),
    toggle(panel, { label: 'Kontur um die Schrift', title: 'Umriss um die Buchstaben in eigener Farbe (Sticker-Look)', bind: bindPath(app, 'body.outline'), visible: () => hasBase() && relief() !== 'engraved' }),
    grid(
      numberField(panel, { label: 'Konturbreite', unit: 'mm', bind: bindPath(app, 'body.outlineWidth'), min: 0.2, max: 20, step: 0.1, digits: 2, slider: [0.4, 4], visible: () => hasBase() && doc().body.outline && relief() !== 'engraved' }),
      numberField(panel, { label: 'Konturhöhe', title: 'Die Schrift steht auf der Kontur', unit: 'mm', bind: bindPath(app, 'body.outlineHeight'), min: 0.1, max: 20, step: 0.1, digits: 2, slider: [0.2, 3], visible: () => hasBase() && doc().body.outline && relief() === 'raised' }),
    ),
    note(panel, 'Bei „Bündig“ sind Rand und Kontur ebenfalls bündig eingelegt – die Oberfläche bleibt glatt.', () => hasBase() && relief() === 'flush' && (doc().body.border || doc().body.outline)),
    note(panel, 'Tipp: Dicken als Vielfache der Schichthöhe wählen (z. B. 0,2 mm) – dann liegt der Farbwechsel genau auf einer Schicht.'),
  );

  const colors = section('Farben & Filamente', { id: 'colors', icon: 'palette' });
  const slotOptions = Array.from({ length: 16 }, (_, i) => [i + 1, `Filament ${i + 1}`]);
  const partVisible = (key) => () => {
    const m = app.model;
    return m ? m.parts.some((p) => p.id === key) : true;
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
    numberField(panel, { label: 'Mindest-Strichstärke', title: 'Dünnere Stellen der Schrift werden orange markiert (0,4-mm-Düse: etwa 0,8 mm)', unit: 'mm', bind: bindPath(app, 'check.minStroke'), min: 0, max: 5, step: 0.1, digits: 2, slider: [0, 2], wide: true }),
    selectField(panel, { label: 'Druckbett', bind: bindPath(app, 'check.bed'), options: [[180, 'A1 mini – 180 × 180 mm'], [256, 'A1 / P1 / X1 – 256 × 256 mm'], [320, 'H2D – 320 × 320 mm']] }),
    note(panel, () => {
      const m = app.model;
      if (!m) return '';
      if (!doc().check.minStroke) return 'Prüfung aus.';
      if (!m.stats.thinCount) return `<span class="ok">Alle Striche sind mindestens ${de(doc().check.minStroke, 2)} mm breit.</span>`;
      return `<span class="warn">${m.stats.thinCount} Stelle${m.stats.thinCount === 1 ? '' : 'n'} dünner als ${de(doc().check.minStroke, 2)} mm</span> (orange markiert) – größere Schrift, „Fettung“ oder eine kräftigere Schrift wählen.`;
    }),
  );

  root.append(form.el, mount.el, mag.el, body.el, colors.el, check.el);
  return panel;
}
