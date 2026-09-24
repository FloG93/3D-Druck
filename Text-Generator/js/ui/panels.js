// Side panels: text blocks on the left; base shape, mount, 3D body, colours
// and the print check on the right.

import {
  h, Panel, numberField, selectField, segmented, toggle, colorField, note, grid, section, bindPath,
} from '../../../shared/js/controls.js';
import { icon } from '../../../shared/js/icons.js';
import { BUILTIN_FONTS, fontKey } from '../core/fonts.js';

const de = (v, digits = 1) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: digits }) : '–');

// --- text blocks ------------------------------------------------------------------

function textArea(panel, opts) {
  const ta = h('textarea', { rows: '2', spellcheck: 'false', placeholder: 'Text eingeben', 'aria-label': opts.label || 'Text' });
  ta.addEventListener('input', () => {
    opts.bind.set(ta.value);
    ta.rows = Math.min(6, Math.max(1, ta.value.split('\n').length));
  });
  ta.addEventListener('change', () => panel.app.commit());
  const el = h('div', { class: 'ctl ctl-textarea wide' }, ta);
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
  const mountOn = () => hasBase() && doc().mount.type !== 'none';
  mount.body.append(
    segmented(panel, { label: 'Art', bind: bindPath(app, 'mount.type'), options: [['none', 'Keine'], ['eyelet', 'Öse'], ['hole', 'Loch']], visible: hasBase }),
    segmented(panel, { label: 'Position', bind: bindPath(app, 'mount.position'), options: [['left', 'Links'], ['right', 'Rechts'], ['top', 'Oben']], visible: mountOn }),
    grid(
      numberField(panel, { label: 'Loch-Ø', unit: 'mm', bind: bindPath(app, 'mount.diameter'), min: 0.5, max: 50, step: 0.1, digits: 2, slider: [2, 10], visible: mountOn }),
      numberField(panel, { label: 'Ringbreite', title: 'Material rund um das Loch', unit: 'mm', bind: bindPath(app, 'mount.ring'), min: 0.4, max: 20, step: 0.1, digits: 2, slider: [1, 5], visible: mountOn }),
    ),
    note(panel, () => (doc().mount.type === 'hole' && shape() === 'contour'
      ? 'Bei der Kontur wird statt eines Lochs eine Öse angesetzt.'
      : doc().mount.type === 'eyelet' ? 'Die Öse sitzt außen an der Platte – für Schlüsselring oder Band.' : 'Das Loch liegt in der Platte; sie wird dafür verlängert.'), mountOn),
    note(panel, 'Ohne Platte gibt es keine Befestigung.', () => !hasBase()),
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
    toggle(panel, { label: 'Erhabener Rand', bind: bindPath(app, 'body.border'), visible: hasBase }),
    grid(
      numberField(panel, { label: 'Randbreite', unit: 'mm', bind: bindPath(app, 'body.borderWidth'), min: 0.2, max: 50, step: 0.1, digits: 2, slider: [0.4, 5], visible: border }),
      numberField(panel, { label: 'Randhöhe', unit: 'mm', bind: bindPath(app, 'body.borderHeight'), min: 0.1, max: 50, step: 0.1, digits: 2, slider: [0.2, 4], visible: border }),
    ),
    note(panel, 'Tipp: Dicken als Vielfache der Schichthöhe wählen (z. B. 0,2 mm) – dann liegt der Farbwechsel genau auf einer Schicht.'),
  );

  const colors = section('Farben & Filamente', { id: 'colors', icon: 'palette' });
  const slotOptions = Array.from({ length: 16 }, (_, i) => [i + 1, `Filament ${i + 1}`]);
  const partVisible = (key) => () => {
    const m = app.model;
    return m ? m.parts.some((p) => p.id === key) : true;
  };
  for (const [key, label] of [['base', 'Platte'], ['text', 'Schrift'], ['border', 'Rand']]) {
    colors.body.append(grid(
      colorField(panel, { label, bind: bindPath(app, `colors.${key}`), visible: partVisible(key) }),
      selectField(panel, { label: 'AMS', bind: bindPath(app, `slots.${key}`), options: slotOptions, wide: false, visible: partVisible(key) }),
    ));
  }
  colors.body.append(note(panel, 'Die Farben sind für die Vorschau. In der 3MF-Datei ist jedes Teil seinem Filament zugeordnet – in Bambu Studio wählst du dazu die AMS-Farben.'));

  const check = section('Prüfung (3D-Druck)', { id: 'check', icon: 'check' });
  check.body.append(
    numberField(panel, { label: 'Mindest-Strichstärke', title: 'Dünnere Stellen der Schrift werden orange markiert (0,4-mm-Düse: etwa 0,8 mm)', unit: 'mm', bind: bindPath(app, 'check.minStroke'), min: 0, max: 5, step: 0.1, digits: 2, slider: [0, 2], wide: true }),
    note(panel, () => {
      const m = app.model;
      if (!m) return '';
      if (!doc().check.minStroke) return 'Prüfung aus.';
      if (!m.stats.thinCount) return `<span class="ok">Alle Striche sind mindestens ${de(doc().check.minStroke, 2)} mm breit.</span>`;
      return `<span class="warn">${m.stats.thinCount} Stelle${m.stats.thinCount === 1 ? '' : 'n'} dünner als ${de(doc().check.minStroke, 2)} mm</span> (orange markiert) – größere Schrift, „Fettung“ oder eine kräftigere Schrift wählen.`;
    }),
  );

  root.append(form.el, mount.el, body.el, colors.el, check.el);
  return panel;
}
