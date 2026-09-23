// Modifier stack UI: add buttons plus one collapsible card per modifier.

import {
  h, Panel, bindModifier, numberField, selectField, segmented, toggle, note, grid, section,
} from './controls.js';
import { icon } from './icons.js';
import { MODIFIER_NAMES } from '../core/document.js';

const TYPE_ICONS = { point: 'point', line: 'line', linear: 'linear', noise: 'noise', image: 'image', edge: 'edge' };

const ADD_BUTTONS = [
  ['point', 'Punkt', 'Punkt-Attraktor: dreht/skaliert Löcher um einen Punkt (Doppelklick in die Fläche geht auch)'],
  ['line', 'Linie', 'Linien-Attraktor: wirkt entlang einer Linie oder Kurve'],
  ['linear', 'Verlauf', 'Linearer Verlauf von A nach B'],
  ['noise', 'Rauschen', 'Zufällige oder weiche Variation'],
  ['image', 'Bild', 'Helligkeit des Hintergrundbilds steuert die Lochgröße (Halbton)'],
  ['edge', 'Rand', 'Löcher zum Rand hin verkleinern'],
];

const FALLOFF_OPTIONS = [
  ['smooth', 'Weich (S-Kurve)'],
  ['linear', 'Linear'],
  ['in', 'Einlaufend'],
  ['out', 'Auslaufend'],
  ['step', 'Harte Kante'],
];

const AXIS_OPTIONS = [['both', 'Beide'], ['x', 'Breite'], ['y', 'Höhe']];

export class ModifiersPanel {
  constructor(app) {
    this.app = app;
    this.panel = new Panel(app);
    this.open = new Set();
    const { el, body } = section('Modifikatoren', { id: 'modifiers', icon: 'sliders' });
    this.el = el;
    const adds = h('div', { class: 'add-grid' }, ADD_BUTTONS.map(([type, label, title]) => {
      const b = h('button', { type: 'button', class: 'add-btn', title, html: `${icon(TYPE_ICONS[type])}<span>${label}</span>` });
      b.addEventListener('click', () => {
        const m = app.addModifier(type);
        this.open.add(m.id);
      });
      return b;
    }));
    this.list = h('div', { class: 'mod-list' });
    this.empty = h('p', { class: 'ctl-note empty' },
      'Noch keine Modifikatoren. Füge einen Punkt-Attraktor hinzu, um Löcher zu drehen oder zu skalieren – wie beim Wirbel-Muster.');
    body.append(adds, this.list, this.empty);
    app.on('structure', () => this.rebuild());
    app.on('selection', () => this.syncSelection());
    this.rebuild();
  }

  refresh() {
    this.panel.refresh();
  }

  rebuild() {
    const { app } = this;
    this.panel = new Panel(app);
    this.list.innerHTML = '';
    this.cards = new Map();
    const mods = app.doc.modifiers;
    this.empty.hidden = mods.length > 0;
    mods.forEach((m, index) => {
      const card = this.buildCard(m, index, mods.length);
      this.cards.set(m.id, card);
      this.list.append(card);
    });
    this.syncSelection();
    this.panel.refresh();
  }

  syncSelection() {
    const sel = this.app.selectedId;
    if (sel) this.open.add(sel);
    for (const [id, card] of this.cards || []) {
      card.classList.toggle('selected', id === sel);
      card.classList.toggle('open', this.open.has(id));
      if (id === sel) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  buildCard(m, index, count) {
    const { app } = this;
    const id = m.id;
    const B = (key) => bindModifier(app, id, key);
    const cur = () => app.modifier(id) || {};
    const panel = this.panel;

    const title = h('span', { class: 'mod-title' }, MODIFIER_NAMES[m.type]);
    const eye = h('button', { type: 'button', class: 'icon-btn', title: 'Ein/Aus' });
    const setEye = () => {
      const on = cur().enabled !== false;
      eye.innerHTML = icon(on ? 'eye' : 'eyeOff');
      card.classList.toggle('disabled', !on);
    };
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      app.setModifier(id, 'enabled', cur().enabled === false);
      app.commit();
      setEye();
    });
    const mk = (ic, t, fn, disabled = false) => {
      const b = h('button', { type: 'button', class: 'icon-btn', title: t, html: icon(ic), disabled });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    const head = h('div', { class: 'mod-head' },
      h('span', { class: 'mod-icon', html: icon(TYPE_ICONS[m.type]) }),
      title,
      h('span', { class: 'spacer' }),
      mk('up', 'Nach oben (früher anwenden)', () => app.moveModifier(id, -1), index === 0),
      mk('down', 'Nach unten (später anwenden)', () => app.moveModifier(id, 1), index === count - 1),
      eye,
      mk('copy', 'Duplizieren', () => app.duplicateModifier(id)),
      mk('trash', 'Löschen', () => app.removeModifier(id)),
    );
    const body = h('div', { class: 'mod-body' });
    const card = h('div', { class: 'mod-card', 'data-id': id }, head, body);
    head.addEventListener('click', () => {
      if (this.open.has(id) && app.selectedId === id) this.open.delete(id);
      else this.open.add(id);
      app.select(id);
      this.syncSelection();
    });
    setEye();

    const radiusField = () => numberField(panel, { label: 'Radius', unit: 'mm', bind: B('radius'), min: 0.5, max: 10000, step: 0.5, title: 'Wirkungsbereich – auch per Mausrad über dem Attraktor' });
    const effects = (modes) => [
      h('h4', { class: 'subhead' }, 'Wirkung'),
      grid(
        numberField(panel, { label: modes ? 'Winkel' : 'Drehung', unit: '°', bind: B('angle'), min: -3600, max: 3600, step: 1, title: 'Addieren: Drehung im Zentrum. Tangential/Radial: zusätzlicher Winkel zur Ausrichtung' }),
        numberField(panel, { label: 'Skalierung', unit: '×', bind: B('scale'), min: 0, max: 20, step: 0.05, title: 'Größenfaktor im Zentrum (1 = unverändert)' }),
      ),
      modes ? segmented(panel, { label: 'Drehmodus', bind: B('rotateMode'), options: modes }) : null,
      segmented(panel, { label: 'Skalieren', bind: B('scaleAxis'), options: AXIS_OPTIONS }),
    ];

    if (m.type === 'point') {
      body.append(
        grid(
          numberField(panel, { label: 'X', unit: 'mm', bind: B('x'), step: 0.5 }),
          numberField(panel, { label: 'Y', unit: 'mm', bind: B('y'), step: 0.5 }),
          radiusField(),
          selectField(panel, { label: 'Verlauf', wide: false, bind: B('falloff'), options: FALLOFF_OPTIONS }),
        ),
        toggle(panel, { label: 'Umkehren (außen statt innen)', bind: B('invert') }),
        ...effects([['add', 'Addieren'], ['tangent', 'Wirbel'], ['normal', 'Radial']]),
        grid(
          numberField(panel, { label: 'Verschieben', unit: 'mm', bind: B('push'), min: -1000, max: 1000, step: 0.5, title: 'Positiv: Löcher wegdrücken, negativ: anziehen' }),
          h('div'),
        ),
        toggle(panel, { label: 'Sperrzone (Löcher entfernen)', bind: B('remove'), title: 'Keine Löcher im Radius – z. B. für Schraubendome oder ein Logo' }),
      );
    } else if (m.type === 'line') {
      body.append(
        grid(
          numberField(panel, { label: 'Start X', unit: 'mm', bind: B('x1'), step: 0.5 }),
          numberField(panel, { label: 'Start Y', unit: 'mm', bind: B('y1'), step: 0.5 }),
          numberField(panel, { label: 'Ende X', unit: 'mm', bind: B('x2'), step: 0.5 }),
          numberField(panel, { label: 'Ende Y', unit: 'mm', bind: B('y2'), step: 0.5 }),
        ),
        toggle(panel, { label: 'Kurve (Rechtsklick auf die Linie)', bind: B('curve') }),
        grid(
          numberField(panel, { label: 'Kontrollpunkt X', unit: 'mm', bind: B('cx'), step: 0.5, visible: () => cur().curve }),
          numberField(panel, { label: 'Kontrollpunkt Y', unit: 'mm', bind: B('cy'), step: 0.5, visible: () => cur().curve }),
          radiusField(),
          selectField(panel, { label: 'Verlauf', wide: false, bind: B('falloff'), options: FALLOFF_OPTIONS }),
        ),
        toggle(panel, { label: 'Umkehren (außen statt innen)', bind: B('invert') }),
        ...effects([['add', 'Addieren'], ['tangent', 'Entlang'], ['normal', 'Quer']]),
        grid(
          numberField(panel, { label: 'Verschieben', unit: 'mm', bind: B('push'), min: -1000, max: 1000, step: 0.5, title: 'Positiv: von der Linie weg, negativ: zur Linie hin' }),
          h('div'),
        ),
        toggle(panel, { label: 'Sperrzone (Löcher entfernen)', bind: B('remove') }),
      );
    } else if (m.type === 'linear') {
      body.append(
        grid(
          numberField(panel, { label: 'Start X', unit: 'mm', bind: B('x1'), step: 0.5 }),
          numberField(panel, { label: 'Start Y', unit: 'mm', bind: B('y1'), step: 0.5 }),
          numberField(panel, { label: 'Ende X', unit: 'mm', bind: B('x2'), step: 0.5 }),
          numberField(panel, { label: 'Ende Y', unit: 'mm', bind: B('y2'), step: 0.5 }),
        ),
        selectField(panel, { label: 'Verlauf', bind: B('falloff'), options: FALLOFF_OPTIONS }),
        h('h4', { class: 'subhead' }, 'Wirkung (Start → Ende)'),
        grid(
          numberField(panel, { label: 'Skalierung Start', unit: '×', bind: B('scaleFrom'), min: 0, max: 20, step: 0.05 }),
          numberField(panel, { label: 'Skalierung Ende', unit: '×', bind: B('scaleTo'), min: 0, max: 20, step: 0.05 }),
          numberField(panel, { label: 'Drehung Start', unit: '°', bind: B('angleFrom'), min: -3600, max: 3600, step: 1 }),
          numberField(panel, { label: 'Drehung Ende', unit: '°', bind: B('angleTo'), min: -3600, max: 3600, step: 1 }),
        ),
        segmented(panel, { label: 'Skalieren', bind: B('scaleAxis'), options: AXIS_OPTIONS }),
      );
    } else if (m.type === 'noise') {
      const dice = h('button', { type: 'button', class: 'btn small', title: 'Neuer Zufallswert', html: `${icon('dice')}<span>Würfeln</span>` });
      dice.addEventListener('click', () => {
        app.setModifier(id, 'seed', 1 + Math.floor(Math.random() * 9999));
        app.commit();
      });
      body.append(
        segmented(panel, { label: 'Art', bind: B('mode'), options: [['smooth', 'Weich (Perlin)'], ['random', 'Zufall je Loch']] }),
        grid(
          numberField(panel, { label: 'Stärke', unit: '%', percent: true, bind: B('amount'), min: 0, max: 1, step: 1, digits: 0 }),
          numberField(panel, { label: 'Strukturgröße', unit: 'mm', bind: B('size'), min: 0.5, max: 5000, step: 1, visible: () => cur().mode !== 'random' }),
          numberField(panel, { label: 'Seed', bind: B('seed'), min: 1, max: 99999, step: 1, digits: 0 }),
          h('div', { class: 'ctl ctl-dice' }, dice),
        ),
        h('h4', { class: 'subhead' }, 'Wirkung (± maximal)'),
        grid(
          numberField(panel, { label: 'Drehung ±', unit: '°', bind: B('angle'), min: 0, max: 360, step: 1 }),
          numberField(panel, { label: 'Größe ±', unit: '%', percent: true, bind: B('scale'), min: 0, max: 1, step: 1, digits: 0 }),
          numberField(panel, { label: 'Position ±', unit: 'mm', bind: B('jitter'), min: 0, max: 100, step: 0.1 }),
          numberField(panel, { label: 'Ausdünnen', unit: '%', percent: true, bind: B('dropout'), min: 0, max: 1, step: 1, digits: 0, title: 'Anteil zufällig entfernter Löcher' }),
        ),
        segmented(panel, { label: 'Skalieren', bind: B('scaleAxis'), options: AXIS_OPTIONS }),
      );
    } else if (m.type === 'image') {
      body.append(
        note(panel, 'Lade links unter <b>Hintergrundbild</b> ein Bild. Dunkle Stellen ergeben große Löcher (oder umgekehrt).', () => !app.image, 'warn'),
        toggle(panel, { label: 'Umkehren (hell = große Löcher)', bind: B('invert') }),
        grid(
          numberField(panel, { label: 'Skalierung hell', unit: '×', bind: B('scaleMin'), min: 0, max: 20, step: 0.05 }),
          numberField(panel, { label: 'Skalierung dunkel', unit: '×', bind: B('scaleMax'), min: 0, max: 20, step: 0.05 }),
          numberField(panel, { label: 'Gamma', bind: B('gamma'), min: 0.05, max: 10, step: 0.05, title: '< 1 hebt helle Töne an, > 1 betont dunkle' }),
          numberField(panel, { label: 'Drehung', unit: '°', bind: B('angle'), min: -3600, max: 3600, step: 1 }),
        ),
        segmented(panel, { label: 'Skalieren', bind: B('scaleAxis'), options: AXIS_OPTIONS }),
        note(panel, 'Tipp: Mit „Mindestgröße“ in der Lochform verschwinden sehr kleine Löcher ganz.'),
      );
    } else if (m.type === 'edge') {
      body.append(
        grid(
          numberField(panel, { label: 'Breite', unit: 'mm', bind: B('width'), min: 0.1, max: 5000, step: 0.5, title: 'Abstand zum Rand, über den der Übergang läuft' }),
          selectField(panel, { label: 'Verlauf', wide: false, bind: B('falloff'), options: FALLOFF_OPTIONS }),
          numberField(panel, { label: 'Skalierung am Rand', unit: '×', bind: B('scale'), min: 0, max: 20, step: 0.05 }),
          numberField(panel, { label: 'Drehung am Rand', unit: '°', bind: B('angle'), min: -3600, max: 3600, step: 1 }),
        ),
        segmented(panel, { label: 'Skalieren', bind: B('scaleAxis'), options: AXIS_OPTIONS }),
      );
    }
    return card;
  }
}
