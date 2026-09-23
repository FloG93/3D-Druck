// Left and right side panels (document, boundary, image, hole shape,
// arrangement, check). The modifier list lives in modifiers-panel.js.

import {
  h, Panel, bindPath, numberField, selectField, segmented, toggle, colorField,
  buttonRow, note, grid, section, formatNumber,
} from './controls.js';
import { regularPolygon } from '../core/boundary.js';
import { createImage } from './image.js';

const fmt = (v, d = 2) => formatNumber(v, d);

export function buildLeftPanel(root, app, { onPresetsSection }) {
  const panel = new Panel(app);
  const P = (path) => bindPath(app, path);
  const doc = () => app.doc;

  // Presets are rendered by presets.js into this section.
  const presets = section('Vorlagen', { id: 'presets', icon: 'layers' });
  root.append(presets.el);
  onPresetsSection(presets.body);

  // Canvas
  const canvas = section('Arbeitsfläche', { id: 'canvas', icon: 'square' });
  canvas.body.append(
    grid(
      numberField(panel, { label: 'Breite', unit: 'mm', bind: P('canvas.width'), min: 1, max: 5000, step: 1, title: 'Breite der Fläche, z. B. des Deckels in Fusion 360' }),
      numberField(panel, { label: 'Höhe', unit: 'mm', bind: P('canvas.height'), min: 1, max: 5000, step: 1 }),
    ),
    buttonRow(panel, [
      {
        label: 'Tauschen',
        icon: 'swap',
        title: 'Breite und Höhe tauschen',
        onClick: () => {
          const { width, height } = app.doc.canvas;
          app.doc.canvas.width = height;
          app.doc.canvas.height = width;
          app.changed();
          app.commit();
        },
      },
      { label: 'Ansicht einpassen', icon: 'fit', onClick: () => app.emit('fit') },
    ]),
  );
  root.append(canvas.el);

  // Boundary
  const bnd = section('Begrenzung', { id: 'boundary', icon: 'edge' });
  const isPoly = () => ['rect', 'polygon'].includes(doc().boundary.type);
  bnd.body.append(
    segmented(panel, {
      bind: P('boundary.type'),
      options: [['none', 'Keine'], ['rect', 'Rechteck'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon']],
    }),
    grid(
      numberField(panel, { label: 'Eckenradius', unit: 'mm', bind: P('boundary.cornerRadius'), min: 0, max: 5000, step: 0.5, visible: isPoly }),
      numberField(panel, { label: 'Ecken', bind: P('boundary.sides'), min: 3, max: 64, step: 1, digits: 0, visible: () => doc().boundary.type === 'polygon' }),
      numberField(panel, { label: 'Drehung', unit: '°', bind: P('boundary.rotation'), min: -360, max: 360, step: 1, visible: () => doc().boundary.type === 'polygon' }),
      numberField(panel, { label: 'Randabstand', unit: 'mm', bind: P('boundary.margin'), min: 0, max: 1000, step: 0.5, title: 'Mindestabstand der Löcher zum Rand der Begrenzung' }),
    ),
    buttonRow(panel, [{
      label: 'Regelmäßig machen',
      title: 'Höhe so anpassen, dass das Polygon gleichseitig ist',
      onClick: () => {
        const { minX, minY, maxX, maxY } = regularPolygon(doc().boundary.sides, doc().boundary.rotation);
        doc().canvas.height = Math.round(((doc().canvas.width * (maxY - minY)) / (maxX - minX)) * 100) / 100;
        app.changed();
        app.commit();
      },
    }], () => doc().boundary.type === 'polygon'),
    segmented(panel, {
      label: 'Löcher müssen …',
      bind: P('boundary.fit'),
      options: [['inside', 'ganz innen liegen'], ['center', 'mit Mitte innen liegen']],
    }),
  );
  root.append(bnd.el);

  // Background image
  const bg = section('Hintergrundbild', { id: 'background', icon: 'image', open: false });
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const img = await createImage(file, () => app.doc, file.name);
      app.setImage(img);
      app.emit('toast', `Bild „${file.name}“ geladen.`);
    } catch (err) {
      app.emit('toast', `Fehler: ${err.message}`);
    }
  });
  const thumb = h('div', { class: 'bg-thumb' });
  bg.body.append(
    fileInput,
    buttonRow(panel, [
      { label: 'Bild laden …', icon: 'open', onClick: () => fileInput.click() },
      { label: 'Entfernen', icon: 'trash', onClick: () => app.setImage(null) },
    ]),
    panel.register(thumb, () => {
      const img = app.image;
      const key = img ? img.dataUrl.length + img.name : '';
      if (thumb.dataset.key === key) return;
      thumb.dataset.key = key;
      thumb.innerHTML = '';
      if (img) {
        const el = h('img', { src: img.dataUrl, alt: img.name });
        thumb.append(el, h('span', {}, img.name));
      }
    }, () => !!app.image),
    note(panel, 'Als Vorlage zum Nachzeichnen oder als Helligkeitskarte für den Modifikator <b>Bildvorlage</b> (Halbton-Muster).', () => !app.image),
    numberField(panel, { label: 'Deckkraft', unit: '%', percent: true, bind: P('background.opacity'), min: 0, max: 1, step: 1, digits: 0, slider: [0, 1], wide: true, visible: () => !!app.image }),
    segmented(panel, {
      label: 'Einpassen',
      bind: P('background.fit'),
      options: [['cover', 'Füllen'], ['contain', 'Einpassen'], ['stretch', 'Strecken']],
      visible: () => !!app.image,
    }),
    toggle(panel, { label: 'Bild anzeigen', bind: P('background.visible'), visible: () => !!app.image }),
  );
  root.append(bg.el);
  return panel;
}

export function buildRightPanel(root, app, { modifiersSection }) {
  const panel = new Panel(app);
  const P = (path) => bindPath(app, path);
  const doc = () => app.doc;

  root.append(modifiersSection);

  // Hole shape
  const shape = section('Lochform', { id: 'shape', icon: 'shape' });
  const shapeType = () => doc().shape.type;
  shape.body.append(
    segmented(panel, {
      bind: P('shape.type'),
      options: [['rect', 'Langloch / Rechteck'], ['ellipse', 'Kreis / Ellipse'], ['polygon', 'Polygon']],
    }),
    grid(
      numberField(panel, { label: 'Breite', unit: 'mm', bind: P('shape.width'), min: 0.05, max: 1000, step: 0.1, title: 'Ausdehnung in X-Richtung (bei Drehung 0°)' }),
      numberField(panel, { label: 'Höhe', unit: 'mm', bind: P('shape.height'), min: 0.05, max: 1000, step: 0.1, title: 'Ausdehnung in Y-Richtung (bei Drehung 0°)' }),
      numberField(panel, { label: 'Ecken', bind: P('shape.sides'), min: 3, max: 64, step: 1, digits: 0, visible: () => shapeType() === 'polygon' }),
      numberField(panel, { label: 'Drehung', unit: '°', bind: P('shape.rotation'), min: -360, max: 360, step: 1 }),
    ),
    numberField(panel, {
      label: 'Eckenrundung',
      unit: '%',
      percent: true,
      bind: P('shape.round'),
      min: 0,
      max: 1,
      step: 1,
      digits: 0,
      slider: [0, 1],
      wide: true,
      title: '100 % = voll gerundet (Langloch)',
      visible: () => shapeType() !== 'ellipse',
    }),
    note(panel, () => {
      const s = doc().shape;
      if (s.type === 'rect' && s.round >= 0.999) return `Langloch ${fmt(s.width)} × ${fmt(s.height)} mm, Radius ${fmt(Math.min(s.width, s.height) / 2)} mm`;
      if (s.type === 'rect') return `Eckenradius ${fmt((s.round * Math.min(s.width, s.height)) / 2)} mm`;
      return '';
    }, () => shapeType() === 'rect'),
    grid(
      colorField(panel, { label: 'Farbe', bind: P('shape.color') }),
      numberField(panel, { label: 'Mindestgröße', unit: 'mm', bind: P('shape.minSize'), min: 0, max: 100, step: 0.1, title: 'Kleinere Löcher (z. B. durch Skalierung) werden weggelassen' }),
    ),
  );
  root.append(shape.el);

  // Arrangement
  const pat = section('Anordnung', { id: 'pattern', icon: 'grid' });
  const pt = () => doc().pattern.type;
  const isGrid = () => pt() === 'grid' || pt() === 'hex';
  pat.body.append(
    selectField(panel, {
      label: 'Typ',
      bind: P('pattern.type'),
      options: [
        ['grid', 'Raster (rechtwinklig)'],
        ['hex', 'Versetzt / Hexagonal'],
        ['radial', 'Ringe (kreisförmig)'],
        ['spiral', 'Spirale (Sonnenblume)'],
        ['random', 'Zufällig (Poisson)'],
      ],
    }),
    grid(
      numberField(panel, { label: 'Abstand X', unit: 'mm', bind: P('pattern.spacingX'), min: 0.1, max: 1000, step: 0.1, visible: isGrid, title: 'Mittenabstand in einer Reihe' }),
      numberField(panel, { label: 'Abstand Y', unit: 'mm', bind: P('pattern.spacingY'), min: 0.1, max: 1000, step: 0.1, visible: isGrid, title: 'Abstand der Reihen' }),
      numberField(panel, { label: 'Reihenversatz', unit: '%', percent: true, bind: P('pattern.rowShift'), min: -1, max: 1, step: 1, digits: 0, visible: () => pt() === 'hex', title: 'Verschiebung jeder zweiten Reihe (50 % = hexagonal)' }),
      numberField(panel, { label: 'Ringabstand', unit: 'mm', bind: P('pattern.ringSpacing'), min: 0.1, max: 1000, step: 0.1, visible: () => pt() === 'radial' }),
      numberField(panel, { label: 'Abstand im Ring', unit: 'mm', bind: P('pattern.itemSpacing'), min: 0.1, max: 1000, step: 0.1, visible: () => pt() === 'radial' && !doc().pattern.ringCount }),
      numberField(panel, { label: 'Anzahl je Ring', bind: P('pattern.ringCount'), min: 0, max: 2000, step: 1, digits: 0, visible: () => pt() === 'radial', title: '0 = automatisch aus dem Abstand' }),
      numberField(panel, { label: 'Abstand', unit: 'mm', bind: P('pattern.spiralSpacing'), min: 0.1, max: 1000, step: 0.1, visible: () => pt() === 'spiral' }),
      numberField(panel, { label: 'Mindestabstand', unit: 'mm', bind: P('pattern.minDistance'), min: 0.1, max: 1000, step: 0.1, visible: () => pt() === 'random' }),
      numberField(panel, { label: 'Seed', bind: P('pattern.seed'), min: 1, max: 99999, step: 1, digits: 0, visible: () => pt() === 'random' }),
      numberField(panel, { label: 'Drehung', unit: '°', bind: P('pattern.rotation'), min: -360, max: 360, step: 1 }),
      numberField(panel, { label: 'Versatz X', unit: 'mm', bind: P('pattern.offsetX'), min: -5000, max: 5000, step: 0.5 }),
      numberField(panel, { label: 'Versatz Y', unit: 'mm', bind: P('pattern.offsetY'), min: -5000, max: 5000, step: 0.5 }),
    ),
    buttonRow(panel, [{
      label: 'Wabenabstand',
      title: 'Abstand Y = Abstand X · √3/2 (gleichmäßige Sechseck-Packung)',
      onClick: () => {
        const p = doc().pattern;
        p.spacingY = Math.round(p.spacingX * (Math.sqrt(3) / 2) * 1000) / 1000;
        p.rowShift = 0.5;
        app.changed();
        app.commit();
      },
    }], () => pt() === 'hex'),
    toggle(panel, { label: 'Ringe abwechselnd versetzen', bind: P('pattern.stagger'), visible: () => pt() === 'radial' }),
    toggle(panel, { label: 'Loch in der Mitte', bind: P('pattern.centerHole'), visible: () => pt() === 'radial' }),
    segmented(panel, {
      label: 'Ausrichtung',
      bind: P('pattern.align'),
      options: [['none', 'Keine'], ['tangent', 'Tangential'], ['radial', 'Radial']],
      visible: () => pt() === 'radial' || pt() === 'spiral',
    }),
    toggle(panel, {
      label: 'Löcher mitdrehen',
      title: 'Bei gedrehtem Raster auch die Löcher drehen',
      bind: P('pattern.rotateHoles'),
      visible: () => isGrid() || pt() === 'random' || doc().pattern.align === 'none',
    }),
  );
  const spinHead = h('h4', { class: 'subhead' }, 'Reihen-Drehung');
  pat.body.append(
    spinHead,
    grid(
      numberField(panel, { label: 'Winkel', unit: '°', bind: P('pattern.spin'), min: -360, max: 360, step: 1, title: 'Zusätzliche Drehung je Reihe/Spalte – z. B. 90° abwechselnd = Fischgrät' }),
      selectField(panel, {
        label: 'Modus',
        wide: false,
        bind: P('pattern.spinMode'),
        options: [['alternate', 'Abwechselnd ±'], ['progressive', 'Fortlaufend']],
      }),
    ),
    segmented(panel, {
      label: 'Bezug',
      bind: P('pattern.spinBy'),
      options: [['row', 'Reihe'], ['column', 'Spalte'], ['checker', 'Schachbrett']],
    }),
  );
  root.append(pat.el);

  // Printability check
  const chk = section('Prüfung (3D-Druck)', { id: 'check', icon: 'check' });
  chk.body.append(
    grid(
      numberField(panel, { label: 'Min. Stegbreite', unit: 'mm', bind: P('check.minWeb'), min: 0, max: 100, step: 0.1, title: 'Dünnere Stege zwischen Löchern werden markiert (0,8 mm ≈ 2 Bahnen bei 0,4-mm-Düse)', onInput: () => app.scheduleAnalysis(0) }),
      h('div'),
    ),
    toggle(panel, { label: 'Problemstellen farbig markieren', bind: P('check.show') }),
    note(panel, () => {
      const a = app.analysis;
      const r = app.result;
      if (!r) return '';
      if (!a) return 'Prüfe …';
      const parts = [];
      if (Number.isFinite(a.minWeb)) parts.push(`Schmalster Steg: <b>${a.minWeb < 0 ? 'Überlappung' : `${fmt(a.minWeb)} mm`}</b>`);
      if (Number.isFinite(r.stats.minRim)) parts.push(`Kleinster Randabstand: <b>${fmt(r.stats.minRim)} mm</b>`);
      if (a.overlap) parts.push(`<span class="danger">${a.overlap} Löcher überlappen</span>`);
      if (a.thin) parts.push(`<span class="warn">${a.thin} Löcher mit zu dünnem Steg</span>`);
      if (!a.overlap && !a.thin && r.holes.length) parts.push('<span class="ok">Alle Stege ausreichend breit.</span>');
      return parts.join('<br>');
    }),
  );
  root.append(chk.el);
  return panel;
}
