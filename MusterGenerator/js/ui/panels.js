// Left and right side panels (document, boundary, 3D body, image, hole
// shape, arrangement, check). The modifier list lives in modifiers-panel.js.

import {
  h, Panel, bindPath, numberField, selectField, segmented, toggle, colorField,
  buttonRow, note, grid, section, formatNumber, textField,
} from './controls.js';
import { regularPolygon } from '../core/boundary.js';
import { MAX_TAPER } from '../core/relief.js';
import { KNURL_DEFAULTS, knurlSettings, twistsShapes } from '../core/knurl.js';
import { CELL_PATTERNS } from '../core/lattice.js';
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

  // Canvas (for a cylinder: the unrolled surface, width = circumference)
  const canvas = section('Arbeitsfläche', { id: 'canvas', icon: 'square' });
  const cyl = () => doc().form.type === 'cylinder';
  const diameter = {
    get: () => doc().canvas.width / Math.PI,
    set: (v) => app.set('canvas.width', Math.min(Math.max(v * Math.PI, 1), 5000)),
  };
  canvas.body.append(
    grid(
      numberField(panel, { label: 'Breite', unit: 'mm', bind: P('canvas.width'), min: 1, max: 5000, step: 1, visible: () => !cyl(), title: 'Breite der Fläche, z. B. des Deckels in Fusion 360' }),
      numberField(panel, { label: 'Durchmesser', unit: 'mm', bind: diameter, min: 0.5, max: 1590, step: 0.5, visible: cyl, title: 'Außendurchmesser des Zylinders – das Muster sitzt auf der Mantelfläche' }),
      numberField(panel, { label: 'Höhe', unit: 'mm', bind: P('canvas.height'), min: 1, max: 5000, step: 1 }),
      numberField(panel, { label: 'Umfang', unit: 'mm', bind: P('canvas.width'), min: 1, max: 5000, step: 1, visible: cyl, title: 'Breite der Abwicklung = π × Durchmesser' }),
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
    ], () => !cyl()),
    buttonRow(panel, [{ label: 'Ansicht einpassen', icon: 'fit', onClick: () => app.emit('fit') }], cyl),
  );
  root.append(canvas.el);

  // Boundary
  const bnd = section('Begrenzung', { id: 'boundary', icon: 'edge' });
  const isPoly = () => !cyl() && ['rect', 'polygon'].includes(doc().boundary.type);
  const isPolygon = () => !cyl() && doc().boundary.type === 'polygon';
  bnd.body.append(
    segmented(panel, {
      bind: P('boundary.type'),
      options: [['none', 'Keine'], ['rect', 'Rechteck'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon']],
      visible: () => !cyl(),
    }),
    note(panel, 'Zylinder: Der Randabstand gilt oben und unten (bzw. über dem Boden) – rundherum läuft das Muster ohne Naht weiter.', cyl),
    grid(
      numberField(panel, { label: 'Eckenradius', unit: 'mm', bind: P('boundary.cornerRadius'), min: 0, max: 5000, step: 0.5, visible: isPoly }),
      numberField(panel, { label: 'Ecken', bind: P('boundary.sides'), min: 3, max: 64, step: 1, digits: 0, visible: isPolygon }),
      numberField(panel, { label: 'Drehung', unit: '°', bind: P('boundary.rotation'), min: -360, max: 360, step: 1, visible: isPolygon }),
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
    }], isPolygon),
    segmented(panel, {
      label: 'Löcher müssen …',
      bind: P('boundary.fit'),
      options: [['inside', 'ganz innen liegen'], ['center', 'mit Mitte innen liegen']],
    }),
  );
  root.append(bnd.el);

  // 3D body: holes through the plate or raised / recessed relief
  const body = section('Körper (3D)', { id: 'body', icon: 'cube' });
  const relief = () => doc().relief.mode;
  body.body.append(
    segmented(panel, {
      label: 'Form',
      bind: P('form.type'),
      onChange: () => app.emit('fit'),
      options: [
        ['plate', 'Platte', null, 'Ebene Platte, Deckel, Blende'],
        ['cylinder', 'Zylinder', null, 'Muster rundherum auf einem Rohr, Becher, Griff oder Lampenschirm'],
      ],
    }),
    segmented(panel, {
      label: 'Muster',
      bind: P('relief.mode'),
      options: [
        ['cut', 'Durchbrüche', null, 'Die Formen werden als Löcher durch die Platte geschnitten'],
        ['emboss', 'Erhaben', null, 'Die Formen stehen als Rippen/Noppen auf der Platte'],
        ['deboss', 'Vertieft', null, 'Die Formen werden als Nuten/Mulden in die Platte eingelassen'],
      ],
    }),
    grid(
      numberField(panel, { label: 'Plattendicke', unit: 'mm', bind: P('export.thickness'), min: 0.1, max: 1000, step: 0.1, visible: () => !cyl(), title: 'Dicke der Grundplatte (3D-Vorschau, STL, STEP)' }),
      numberField(panel, { label: 'Wandstärke', unit: 'mm', bind: P('export.thickness'), min: 0.1, max: 1000, step: 0.1, visible: cyl, title: 'Die Wand geht vom Außendurchmesser nach innen' }),
      numberField(panel, { label: 'Boden', unit: 'mm', bind: P('form.bottom'), min: 0, max: 1000, step: 0.5, visible: cyl, title: '0 = offen (Rohr, Hülse) · sonst geschlossener Boden, z. B. Becher oder Stifthalter' }),
      numberField(panel, { label: 'Höhe', unit: 'mm', bind: P('relief.height'), min: 0.05, max: 1000, step: 0.1, visible: () => relief() === 'emboss', title: 'So weit ragen die Formen über die Platte hinaus' }),
      numberField(panel, { label: 'Tiefe', unit: 'mm', bind: P('relief.height'), min: 0.05, max: 1000, step: 0.1, visible: () => relief() === 'deboss', title: 'So tief werden die Formen in die Platte eingelassen' }),
      numberField(panel, {
        label: 'Flankenwinkel',
        unit: '°',
        bind: P('relief.taper'),
        min: 0,
        max: MAX_TAPER,
        step: 1,
        digits: 1,
        visible: () => relief() !== 'cut',
        title: '0° = senkrechte Wände · 45° = ohne Stützen druckbar · schmale Formen laufen spitz zu (Grat, Pyramide, Kegel)',
      }),
    ),
    note(panel, () => {
      const t = doc().export.thickness;
      const { mode, height, taper } = doc().relief;
      const parts = [];
      if (cyl()) {
        const d = doc().canvas.width / Math.PI;
        parts.push(`Zylinder Ø ${fmt(d, 1)} mm außen (innen ${fmt(Math.max(d - 2 * t, 0), 1)} mm), Umfang ${fmt(doc().canvas.width, 1)} mm.`);
        const wrap = app.result && app.result.wrap;
        if (wrap && wrap.seamless) {
          parts.push(wrap.columns ? `Nahtlos rundherum: ${wrap.columns} Spalten à ${fmt(wrap.spacingX)} mm.` : 'Nahtlos rundherum.');
        } else if (wrap) {
          parts.push('<span class="warn">Diese Anordnung (gedrehtes Raster, Ringe, Spirale) schließt an der Naht nicht exakt – für nahtlose Muster Raster/Versetzt ohne Drehung oder Zufällig wählen.</span>');
        }
        if (doc().form.bottom > 0) parts.push(`Boden ${fmt(doc().form.bottom)} mm – das Muster hält den Randabstand darüber ein.`);
      }
      const where = cyl() ? 'die Wand' : 'die Platte';
      if (mode === 'cut') {
        parts.push(`Die Formen werden als <b>Löcher</b> durch ${where} geschnitten.`);
      } else {
        parts.push(mode === 'emboss'
          ? `Die Formen stehen als <b>Rippen/Noppen</b> ${fmt(height)} mm auf ${cyl() ? 'der Wand' : `der Platte – gesamt ${fmt(t + height)} mm hoch`}.`
          : `Die Formen werden als <b>Nuten/Mulden</b> ${fmt(height)} mm tief eingelassen.`);
        if (mode === 'deboss' && height >= t) parts.push(`<span class="warn">Tiefer als ${where}: es bleibt ${fmt(t * 0.05)} mm stehen. Für Löcher „Durchbrüche“ wählen.</span>`);
        if (taper > 0) parts.push(`Flanken um ${fmt(taper, 1)}° geneigt – schmale Formen laufen spitz zu und werden dann ${mode === 'emboss' ? 'niedriger' : 'flacher'}.`);
      }
      parts.push(cyl()
        ? 'Die 3D-Vorschau und das STL zeigen den fertigen Zylinder; DXF, SVG und Fusion-Skript enthalten die Abwicklung.'
        : 'Wirkt auf 3D-Vorschau, STL und STEP; DXF/SVG enthalten die Konturen.');
      return parts.join(' ');
    }),
    buttonRow(panel, [{ label: '3D-Vorschau', icon: 'cube', title: 'Platte in 3D ansehen', onClick: () => app.emit('view', '3d') }]),
  );
  root.append(body.el);

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
  // QR code and bitmap: the cells define size, position and orientation.
  const cellType = () => CELL_PATTERNS.includes(doc().pattern.type);

  // Hole shape
  const shape = section('Lochform', { id: 'shape', icon: 'shape' });
  const shapeType = () => doc().shape.type;
  shape.body.append(
    segmented(panel, {
      bind: P('shape.type'),
      options: [['rect', 'Langloch / Rechteck'], ['ellipse', 'Kreis / Ellipse'], ['polygon', 'Polygon']],
    }),
    grid(
      numberField(panel, { label: 'Breite', unit: 'mm', bind: P('shape.width'), min: 0.05, max: 1000, step: 0.1, visible: () => !cellType(), title: 'Ausdehnung in X-Richtung (bei Drehung 0°)' }),
      numberField(panel, { label: 'Höhe', unit: 'mm', bind: P('shape.height'), min: 0.05, max: 1000, step: 0.1, visible: () => !cellType(), title: 'Ausdehnung in Y-Richtung (bei Drehung 0°)' }),
      numberField(panel, { label: 'Ecken', bind: P('shape.sides'), min: 3, max: 64, step: 1, digits: 0, visible: () => shapeType() === 'polygon' }),
      numberField(panel, { label: 'Drehung', unit: '°', bind: P('shape.rotation'), min: -360, max: 360, step: 1, visible: () => !cellType() }),
    ),
    note(panel, 'Größe und Lage der Formen kommen aus der Anordnung (QR-Code bzw. Bild). Hier nur Form und Rundung wählen – Rechteck mit 0 % ergibt die klassischen Module.', cellType),
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
        ['qr', 'QR-Code'],
        ['bitmap', 'Bild / Logo (Pixel)'],
      ],
      onChange: (type) => {
        if (!CELL_PATTERNS.includes(type)) return;
        // Codes and logos need plain, unturned cells.
        const d = app.doc;
        Object.assign(d.shape, { type: 'rect', round: 0, rotation: 0 });
        // A dark colour keeps the code scannable right from the screen.
        const rgb = /^#([0-9a-f]{6})$/i.exec(d.shape.color || '');
        const n = rgb ? parseInt(rgb[1], 16) : 0xffffff;
        const luma = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
        if (type === 'qr' && luma > 0.4) d.shape.color = '#264653';
        d.pattern.rotation = 0;
        d.check.minWeb = 0;
        if (d.relief.mode === 'cut') Object.assign(d.relief, { mode: 'emboss', height: 0.8, taper: 0 });
        else d.relief.taper = 0;
        let off = 0;
        for (const m of d.modifiers) {
          if (m.enabled !== false && (type === 'qr' || twistsShapes(m))) {
            m.enabled = false;
            off += 1;
          }
        }
        app.changed(true);
        app.commit();
        if (off) app.emit('toast', `${off} Modifikator${off > 1 ? 'en' : ''} ausgeschaltet – ${type === 'qr' ? 'ein QR-Code muss unverändert bleiben' : 'Drehen/Verschieben passt nicht zu Pixeln'}.`);
      },
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
      numberField(panel, { label: 'Drehung', unit: '°', bind: P('pattern.rotation'), min: -360, max: 360, step: 1, visible: () => !cellType() }),
      numberField(panel, { label: 'Versatz X', unit: 'mm', bind: P('pattern.offsetX'), min: -5000, max: 5000, step: 0.5, visible: () => pt() !== 'bitmap' }),
      numberField(panel, { label: 'Versatz Y', unit: 'mm', bind: P('pattern.offsetY'), min: -5000, max: 5000, step: 0.5, visible: () => pt() !== 'bitmap' }),
    ),
    textField(panel, { label: 'Text oder Link', bind: P('pattern.qrText'), placeholder: 'https://…', maxlength: 2000, visible: () => pt() === 'qr' }),
    segmented(panel, {
      label: 'Fehlerkorrektur',
      bind: P('pattern.qrEcc'),
      options: [['L', 'L 7 %'], ['M', 'M 15 %'], ['Q', 'Q 25 %'], ['H', 'H 30 %']],
      visible: () => pt() === 'qr',
    }),
    grid(
      numberField(panel, { label: 'Modulgröße', unit: 'mm', bind: P('pattern.module'), min: 0.2, max: 100, step: 0.1, visible: () => pt() === 'qr', title: 'Kantenlänge eines QR-Moduls – ab 1 mm gut druck- und scanbar' }),
      numberField(panel, { label: 'Pixelgröße', unit: 'mm', bind: P('pattern.module'), min: 0.2, max: 100, step: 0.1, visible: () => pt() === 'bitmap', title: 'Rastergröße des Bildes – etwa Düsendurchmesser (0,4–0,6 mm) für feine Logos' }),
      numberField(panel, { label: 'Spalt', unit: 'mm', bind: P('pattern.gap'), min: 0, max: 10, step: 0.05, visible: cellType, title: 'Abstand zwischen den Zeilen – hält die Formen getrennt, verschwindet beim Drucken' }),
    ),
    numberField(panel, { label: 'Schwelle', unit: '%', percent: true, bind: P('pattern.threshold'), min: 0, max: 1, step: 1, digits: 0, slider: [0, 1], wide: true, visible: () => pt() === 'bitmap', title: 'Helligkeit, unter der ein Pixel zur Form wird' }),
    toggle(panel, { label: 'Helle Bereiche statt dunkler', bind: P('pattern.invert'), visible: () => pt() === 'bitmap' }),
    toggle(panel, { label: 'Nachbarn einer Zeile zu Balken verbinden', bind: P('pattern.merge'), visible: cellType, title: 'Weniger, längere Formen – aus: einzelne Punkte/Quadrate' }),
    note(panel, () => {
      const r = app.result;
      const info = r && r.info;
      if (!info) return '';
      if (info.error) return `<span class="danger">${info.error}</span>`;
      if (info.kind === 'bitmap') {
        if (info.missing) return 'Zuerst links unter <b>Hintergrundbild</b> ein Logo oder Bild laden – dunkle Bereiche werden zu Formen (transparente zählen als hell).';
        return `${info.cols} × ${info.rows} Pixel à ${fmt(doc().pattern.module)} mm.`;
      }
      const parts = [`QR-Code Version ${info.version}: ${info.size} × ${info.size} Module = ${fmt(info.width, 1)} × ${fmt(info.width, 1)} mm.`];
      const missing = info.expected - r.holes.length;
      if (missing > 0) parts.push(`<span class="danger">${missing} Module passen nicht auf die Fläche – „Fläche an QR-Code anpassen“ oder Modulgröße verkleinern.</span>`);
      if (doc().pattern.module < 1) parts.push('<span class="warn">Unter 1 mm Modulgröße wird das Scannen unsicher.</span>');
      if (doc().relief.mode === 'emboss') parts.push(`Tipp: Im Slicer bei ${fmt(doc().export.thickness)} mm einen Farbwechsel einfügen – dunkle Module auf heller Platte scannen am besten.`);
      return parts.join(' ');
    }, cellType),
    buttonRow(panel, [{
      label: 'Fläche an QR-Code anpassen',
      icon: 'fit',
      title: 'Arbeitsfläche = Code plus 4 Module Ruhezone ringsum',
      onClick: () => {
        const info = app.result && app.result.info;
        if (!info || info.kind !== 'qr' || info.error) return;
        const d = app.doc;
        const size = Math.round((info.size + 8) * d.pattern.module * 100) / 100;
        d.canvas.height = size;
        if (d.form.type !== 'cylinder') {
          d.canvas.width = size;
          Object.assign(d.boundary, { type: 'rect', cornerRadius: Math.round(d.pattern.module * 200) / 100, margin: d.pattern.module });
        }
        d.pattern.offsetX = 0;
        d.pattern.offsetY = 0;
        app.changed();
        app.commit();
        app.emit('fit');
      },
    }], () => pt() === 'qr'),
    buttonRow(panel, [{
      label: 'Seitenverhältnis wie Bild',
      icon: 'fit',
      title: 'Höhe der Arbeitsfläche passend zum Bild setzen',
      onClick: () => {
        const img = app.image;
        if (!img) return;
        app.doc.canvas.height = Math.round(((app.doc.canvas.width * img.height) / img.width) * 100) / 100;
        app.changed();
        app.commit();
        app.emit('fit');
      },
    }], () => pt() === 'bitmap' && !!app.image && doc().form.type !== 'cylinder'),
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
      visible: () => !cellType() && (isGrid() || pt() === 'random' || doc().pattern.align === 'none'),
    }),
  );
  const spinHead = panel.register(h('h4', { class: 'subhead' }, 'Reihen-Drehung'), null, () => !cellType());
  pat.body.append(
    spinHead,
    grid(
      numberField(panel, { label: 'Winkel', unit: '°', bind: P('pattern.spin'), min: -360, max: 360, step: 1, visible: () => !cellType(), title: 'Zusätzliche Drehung je Reihe/Spalte – z. B. 90° abwechselnd = Fischgrät' }),
      selectField(panel, {
        label: 'Modus',
        wide: false,
        bind: P('pattern.spinMode'),
        options: [['alternate', 'Abwechselnd ±'], ['progressive', 'Fortlaufend']],
        visible: () => !cellType(),
      }),
    ),
    segmented(panel, {
      label: 'Bezug',
      bind: P('pattern.spinBy'),
      options: [['row', 'Reihe'], ['column', 'Spalte'], ['checker', 'Schachbrett']],
      visible: () => !cellType(),
    }),
  );
  root.append(pat.el);

  // Knurl assistant: sets shape, arrangement and relief in one step.
  const knurl = { ...KNURL_DEFAULTS };
  const K = (key) => ({
    get: () => knurl[key],
    set: (v) => {
      knurl[key] = v;
      panel.refresh();
    },
  });
  const knurlSec = section('Rändelung', { id: 'knurl', icon: 'grid', open: false });
  knurlSec.body.append(
    note(panel, 'Griffige Rändelung wie an Drehknöpfen und Schrauben – für Platten oder mit Form <b>Zylinder</b> (Körper (3D)) als Rändelknopf.'),
    segmented(panel, { label: 'Art', bind: K('type'), options: [['diamond', 'Kreuz (Rauten)'], ['straight', 'Gerade']] }),
    grid(
      numberField(panel, { label: 'Teilung', unit: 'mm', bind: K('pitch'), min: 0.3, max: 50, step: 0.1, title: 'Abstand paralleler Rillen – 1,5 bis 3 mm lassen sich gut drucken' }),
      numberField(panel, { label: 'Winkel', unit: '°', bind: K('angle'), min: 10, max: 80, step: 1, visible: () => knurl.type === 'diamond', title: 'Winkel der Rillen zur Achse: 30° klassisch, 45° quadratische Rauten' }),
      numberField(panel, { label: 'Profilwinkel', unit: '°', bind: K('profile'), min: 30, max: 150, step: 5, title: 'Öffnungswinkel der Zähne – 90° druckt ohne Stützen' }),
    ),
    segmented(panel, { label: 'Spitzen', bind: K('raised'), options: [[true, 'erhaben (Pyramiden)'], [false, 'vertieft']] }),
    note(panel, () => {
      const s = knurlSettings(knurl, doc());
      const size = knurl.type === 'straight'
        ? `Grate ${fmt(s.shape.width)} mm breit`
        : `Rauten ${fmt(s.shape.width)} × ${fmt(s.shape.height)} mm`;
      const around = doc().form.type === 'cylinder' ? ` · ${Math.round(doc().canvas.width / s.pattern.spacingX)} rundherum` : '';
      return `${size}, ${fmt(s.relief.height)} mm ${knurl.raised ? 'hoch' : 'tief'}${around}.`;
    }),
    buttonRow(panel, [{
      label: 'Rändelung anwenden',
      icon: 'grid',
      primary: true,
      title: 'Setzt Lochform, Anordnung und Körper (3D) passend – Rückgängig mit Strg+Z',
      onClick: () => {
        const s = knurlSettings(knurl, app.doc);
        Object.assign(app.doc.shape, s.shape);
        Object.assign(app.doc.pattern, s.pattern);
        Object.assign(app.doc.relief, s.relief);
        Object.assign(app.doc.check, s.check);
        let disabled = 0;
        for (const m of app.doc.modifiers) {
          if (twistsShapes(m)) {
            m.enabled = false;
            disabled += 1;
          }
        }
        app.changed(true);
        app.commit();
        app.emit('toast', `Rändelung angewendet – Lochform, Anordnung und Körper (3D) wurden angepasst.${disabled ? ` ${disabled} Modifikator${disabled > 1 ? 'en' : ''} mit Drehung/Verschiebung ausgeschaltet.` : ''}`);
      },
    }]),
  );
  root.append(knurlSec.el);

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
