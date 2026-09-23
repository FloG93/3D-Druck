# MusterImport – Fusion 360 script for the Muster-Generator
#
# Reads a hole pattern exported from the Muster-Generator web app
# ("Fusion-Skript" export, *.fusion.json), draws it as a connected sketch on a
# planar face or construction plane and optionally cuts the holes (or creates
# tool bodies) in one step.
#
# Installation: Utilities > Add-Ins > Scripts and Add-Ins > "+" next to
# "My Scripts" > choose this folder. Then run "MusterImport".

import json
import math
import os
import traceback

import adsk.core
import adsk.fusion

CMD_ID = 'MusterGeneratorImport'
CMD_NAME = 'Muster importieren'
FORMAT = 'muster-generator/fusion'
CM_PER_MM = 0.1  # the Fusion API works in centimetres
SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'settings.json')

OPERATIONS = ['Löcher ausschneiden', 'Werkzeugkörper erzeugen', 'Nur Skizze']
PLACEMENTS = ['Mitte der Fläche', 'Skizzenursprung']

_app = None
_ui = None
_handlers = []
_data = None
_path = None


# ---------------------------------------------------------------------------
# Settings (last folder and options)
# ---------------------------------------------------------------------------

def load_settings():
    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_settings(values):
    try:
        settings = load_settings()
        settings.update(values)
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Pattern file (pure Python, independent of the Fusion API)
# ---------------------------------------------------------------------------

def load_pattern(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, dict) or data.get('format') != FORMAT:
        raise ValueError('Die Datei ist kein Export des Muster-Generators (Format „Fusion-Skript“).')
    if data.get('units') != 'mm':
        raise ValueError('Unbekannte Einheit: {}'.format(data.get('units')))
    holes = data.get('holes') or []
    if not holes:
        raise ValueError('Die Datei enthält keine Löcher.')
    return data


def plan_outline(item):
    """Converts one outline of the JSON file into drawing primitives (mm).

    Returns ('circle', cx, cy, r), ('ellipse', cx, cy, mx, my, nx, ny) with the
    end point of the major axis (mx, my) and a point on the minor axis (nx, ny),
    or ('path', segments) with segments ('L', x0, y0, x1, y1) and
    ('A', cx, cy, sx, sy, sweep), all counter-clockwise.
    """
    if 'c' in item:
        cx, cy = item['c']
        return ('circle', cx, cy, item['r'])
    if 'e' in item:
        cx, cy, rx, ry, rot = item['e']
        c, s = math.cos(rot), math.sin(rot)
        return ('ellipse', cx, cy, cx + rx * c, cy + rx * s, cx - ry * s, cy + ry * c)
    segments = []
    for seg in item['p']:
        if seg[0] == 'L':
            segments.append(('L', seg[1], seg[2], seg[3], seg[4]))
        else:
            _, cx, cy, r, a0, sweep = seg
            segments.append(('A', cx, cy, cx + r * math.cos(a0), cy + r * math.sin(a0), sweep))
    return ('path', segments)


def outline_extent(item):
    """Largest extent (bounding box diagonal, mm) of an outline."""
    kind = plan_outline(item)
    if kind[0] == 'circle':
        return 2 * kind[3] * math.sqrt(2)
    if kind[0] == 'ellipse':
        _, cx, cy, mx, my, nx, ny = kind
        return 2 * math.hypot(math.hypot(mx - cx, my - cy), math.hypot(nx - cx, ny - cy))
    xs, ys = [], []
    for seg in kind[1]:
        if seg[0] == 'L':
            xs += [seg[1], seg[3]]
            ys += [seg[2], seg[4]]
        else:
            r = math.hypot(seg[3] - seg[1], seg[4] - seg[2])
            xs += [seg[1] - r, seg[1] + r]
            ys += [seg[2] - r, seg[2] + r]
    return math.hypot(max(xs) - min(xs), max(ys) - min(ys))


class Placement:
    """Maps pattern coordinates (mm, centred) to sketch coordinates (cm)."""

    def __init__(self, cx=0.0, cy=0.0, rotation=0.0, dx=0.0, dy=0.0):
        self.cx = cx
        self.cy = cy
        self.dx = dx
        self.dy = dy
        self.cos = math.cos(rotation)
        self.sin = math.sin(rotation)

    def xy(self, x_mm, y_mm):
        x = x_mm * CM_PER_MM
        y = y_mm * CM_PER_MM
        return (self.cx + self.dx + x * self.cos - y * self.sin,
                self.cy + self.dy + x * self.sin + y * self.cos)

    def point(self, x_mm, y_mm):
        x, y = self.xy(x_mm, y_mm)
        return adsk.core.Point3D.create(x, y, 0)


# ---------------------------------------------------------------------------
# Sketch drawing
# ---------------------------------------------------------------------------

def draw_outline(sketch, item, placement, construction=False):
    """Draws one closed outline; consecutive curves share their sketch points."""
    curves = sketch.sketchCurves
    plan = plan_outline(item)
    created = []
    if plan[0] == 'circle':
        _, cx, cy, r = plan
        created.append(curves.sketchCircles.addByCenterRadius(placement.point(cx, cy), r * CM_PER_MM))
    elif plan[0] == 'ellipse':
        _, cx, cy, mx, my, nx, ny = plan
        created.append(curves.sketchEllipses.add(placement.point(cx, cy), placement.point(mx, my), placement.point(nx, ny)))
    else:
        segments = plan[1]
        first_start = None
        prev_end = None
        count = len(segments)
        for i, seg in enumerate(segments):
            last = i == count - 1
            if seg[0] == 'L':
                start = prev_end if prev_end is not None else placement.point(seg[1], seg[2])
                end = first_start if (last and first_start is not None) else placement.point(seg[3], seg[4])
                line = curves.sketchLines.addByTwoPoints(start, end)
                created.append(line)
                if first_start is None:
                    first_start = line.startSketchPoint
                prev_end = line.endSketchPoint
            else:
                _, cx, cy, sx, sy, sweep = seg
                start = prev_end if prev_end is not None else placement.point(sx, sy)
                arc = curves.sketchArcs.addByCenterStartSweep(placement.point(cx, cy), start, sweep)
                created.append(arc)
                if first_start is None:
                    first_start = arc.startSketchPoint
                prev_end = arc.endSketchPoint
                if last and first_start is not None and count > 1:
                    # Close the loop when the outline ends with an arc.
                    try:
                        first_start.merge(prev_end)
                    except Exception:
                        pass
    if construction:
        for c in created:
            c.isConstruction = True
    return created


def sketch_points_of(curve):
    """Sample points (sketch space) of a sketch curve, used for bounding boxes."""
    try:
        ev = curve.geometry.evaluator
        ok, p0, p1 = ev.getParameterExtents()
        if ok:
            params = [p0 + (p1 - p0) * k / 16.0 for k in range(17)]
            ok, pts = ev.getPointsAtParameters(params)
            if ok:
                return [(p.x, p.y) for p in pts]
    except Exception:
        pass
    bb = curve.boundingBox
    return [(bb.minPoint.x, bb.minPoint.y), (bb.maxPoint.x, bb.maxPoint.y)]


def face_frame(sketch, face):
    """Centre and size (cm) of a face's bounding box in sketch coordinates."""
    projected = sketch.project(face)
    xs, ys = [], []
    for i in range(projected.count):
        for x, y in sketch_points_of(projected.item(i)):
            xs.append(x)
            ys.append(y)
    for i in range(projected.count):
        try:
            projected.item(i).deleteMe()
        except Exception:
            pass
    if not xs:
        return 0.0, 0.0, 0.0, 0.0
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(xs) - min(xs), max(ys) - min(ys))


def hole_profiles(sketch, max_extent_cm):
    """Profiles that belong to single holes (one loop, small bounding box)."""
    result = adsk.core.ObjectCollection.create()
    for prof in sketch.profiles:
        if prof.profileLoops.count != 1:
            continue
        bb = prof.boundingBox
        if bb.minPoint.distanceTo(bb.maxPoint) <= max_extent_cm:
            result.add(prof)
    return result


def create_pattern(data, entity, options):
    """Draws the pattern and runs the chosen operation. Returns a summary text."""
    design = adsk.fusion.Design.cast(_app.activeProduct)
    comp = design.activeComponent
    occurrence = design.activeOccurrence
    sketch = comp.sketches.add(entity, occurrence) if occurrence else comp.sketches.add(entity)
    holes = data['holes']
    sketch.name = 'Muster {} ({} Löcher)'.format(data.get('name') or '', len(holes)).replace('  ', ' ')

    cx = cy = 0.0
    face_w = face_h = 0.0
    is_face = adsk.fusion.BRepFace.cast(entity) is not None
    if is_face and options['placement'] == PLACEMENTS[0]:
        cx, cy, face_w, face_h = face_frame(sketch, entity)
    placement = Placement(cx, cy, options['rotation'], options['dx'], options['dy'])

    progress = _ui.createProgressDialog()
    progress.cancelButtonText = 'Abbrechen'
    progress.isBackgroundTranslucent = False
    progress.show('Muster importieren', 'Zeichne Loch %v von %m …', 0, len(holes), 1)
    sketch.isComputeDeferred = True
    max_extent = 0.0
    cancelled = False
    try:
        for i, hole in enumerate(holes):
            draw_outline(sketch, hole, placement)
            max_extent = max(max_extent, outline_extent(hole))
            if i % 25 == 0:
                progress.progressValue = i
                adsk.doEvents()
                if progress.wasCancelled:
                    cancelled = True
                    break
        if options['boundary'] and data.get('boundary'):
            draw_outline(sketch, data['boundary'], placement, construction=True)
    finally:
        sketch.isComputeDeferred = False
        progress.hide()
    if cancelled:
        return 'Abgebrochen – die bereits gezeichneten Löcher bleiben in der Skizze.'

    lines = ['{} Löcher als Skizze „{}“ eingefügt.'.format(len(holes), sketch.name)]
    operation = options['operation']
    if operation != OPERATIONS[2]:
        profiles = hole_profiles(sketch, max_extent * CM_PER_MM * 1.05 + 1e-4)
        if profiles.count == 0:
            lines.append('Keine geschlossenen Loch-Profile gefunden – Extrusion übersprungen.')
        else:
            cut = operation == OPERATIONS[0]
            op = (adsk.fusion.FeatureOperations.CutFeatureOperation if cut
                  else adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
            extrudes = comp.features.extrudeFeatures
            if options['through_all'] and cut:
                extent = adsk.fusion.ThroughAllExtentDefinition.create()
            else:
                extent = adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByReal(options['depth']))
            direction = (adsk.fusion.ExtentDirections.PositiveExtentDirection if options['flip']
                         else adsk.fusion.ExtentDirections.NegativeExtentDirection)

            def extrude(with_participants):
                ext_input = extrudes.createInput(profiles, op)
                ext_input.setOneSideExtent(extent, direction)
                if with_participants:
                    ext_input.participantBodies = [entity.body]
                return extrudes.add(ext_input)

            try:
                try:
                    feature = extrude(cut and is_face)
                except Exception:
                    if not (cut and is_face):
                        raise
                    # Fall back to Fusion's automatic choice of bodies to cut.
                    feature = extrude(False)
                feature.name = 'Muster {}'.format('Ausschnitt' if cut else 'Werkzeugkörper')
                lines.append('{} Profile {}.'.format(profiles.count, 'ausgeschnitten' if cut else 'als Körper extrudiert'))
            except Exception as err:
                lines.append('Extrusion fehlgeschlagen ({}). Tipp: „Richtung umkehren“ aktivieren '
                             'oder „Nur Skizze“ wählen und selbst extrudieren.'.format(err))

    canvas = data.get('canvas') or {}
    cw, ch = canvas.get('width', 0), canvas.get('height', 0)
    if face_w > 0 and cw and ch:
        fw, fh = face_w / CM_PER_MM, face_h / CM_PER_MM
        straight = abs(fw - cw) + abs(fh - ch)
        turned = abs(fw - ch) + abs(fh - cw)
        lines.append('Fläche {:.1f} × {:.1f} mm, Muster {:g} × {:g} mm.'.format(fw, fh, cw, ch))
        if abs(options['rotation']) < 1e-9 and turned + 0.5 < straight:
            lines.append('Hinweis: Das Muster passt gedreht besser – ggf. mit Drehung 90° erneut einfügen.')
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Command dialog
# ---------------------------------------------------------------------------

class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            cmd.isRepeatable = False
            settings = load_settings()
            inputs = cmd.commandInputs

            stats = _data.get('stats') or {}
            canvas = _data.get('canvas') or {}
            info = '<b>{}</b><br>{} Löcher · {:g} × {:g} mm · offene Fläche {:.1f} %'.format(
                os.path.basename(_path), len(_data['holes']), canvas.get('width', 0), canvas.get('height', 0),
                100 * float(stats.get('openRatio', 0)))
            inputs.addTextBoxCommandInput('info', '', info, 2, True)

            sel = inputs.addSelectionInput('target', 'Fläche/Ebene', 'Ebene Fläche oder Konstruktionsebene wählen')
            sel.addSelectionFilter('PlanarFaces')
            sel.addSelectionFilter('ConstructionPlanes')
            sel.setSelectionLimits(1, 1)

            place = inputs.addDropDownCommandInput('placement', 'Position', adsk.core.DropDownStyles.TextListDropDownStyle)
            for name in PLACEMENTS:
                place.listItems.add(name, name == settings.get('placement', PLACEMENTS[0]))
            inputs.addValueInput('rotation', 'Drehung', 'deg', value_input(settings.get('rotation'), '0 deg'))
            inputs.addValueInput('dx', 'Versatz X', 'mm', adsk.core.ValueInput.createByString('0 mm'))
            inputs.addValueInput('dy', 'Versatz Y', 'mm', adsk.core.ValueInput.createByString('0 mm'))

            op = inputs.addDropDownCommandInput('operation', 'Vorgang', adsk.core.DropDownStyles.TextListDropDownStyle)
            for name in OPERATIONS:
                op.listItems.add(name, name == settings.get('operation', OPERATIONS[0]))
            inputs.addValueInput('depth', 'Tiefe', 'mm', value_input(settings.get('depth'), '2 mm'))
            inputs.addBoolValueInput('through_all', 'Durch alles', True, '', bool(settings.get('through_all', False)))
            inputs.addBoolValueInput('flip', 'Richtung umkehren', True, '', False)
            if _data.get('boundary'):
                inputs.addBoolValueInput('boundary', 'Begrenzung als Hilfslinie', True, '', False)
            update_visibility(inputs)

            on_execute = ExecuteHandler()
            cmd.execute.add(on_execute)
            _handlers.append(on_execute)
            on_changed = InputChangedHandler()
            cmd.inputChanged.add(on_changed)
            _handlers.append(on_changed)
            on_destroy = DestroyHandler()
            cmd.destroy.add(on_destroy)
            _handlers.append(on_destroy)
        except Exception:
            _ui.messageBox('Fehler beim Erstellen des Dialogs:\n{}'.format(traceback.format_exc()))


def value_input(expression, default):
    """ValueInput from a saved expression, falling back to the default."""
    if isinstance(expression, str) and expression.strip():
        try:
            return adsk.core.ValueInput.createByString(expression)
        except Exception:
            pass
    return adsk.core.ValueInput.createByString(default)


def update_visibility(inputs):
    op = inputs.itemById('operation').selectedItem.name
    through = inputs.itemById('through_all')
    inputs.itemById('depth').isVisible = op != OPERATIONS[2] and not (through.value and op == OPERATIONS[0])
    through.isVisible = op == OPERATIONS[0]
    inputs.itemById('flip').isVisible = op != OPERATIONS[2]


class InputChangedHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            event = adsk.core.InputChangedEventArgs.cast(args)
            update_visibility(event.inputs)
        except Exception:
            pass


class ExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            inputs = adsk.core.CommandEventArgs.cast(args).command.commandInputs
            sel = inputs.itemById('target')
            if sel.selectionCount != 1:
                _ui.messageBox('Bitte eine ebene Fläche oder Konstruktionsebene wählen.')
                return
            boundary_input = inputs.itemById('boundary')
            options = {
                'placement': inputs.itemById('placement').selectedItem.name,
                'rotation': inputs.itemById('rotation').value,
                'dx': inputs.itemById('dx').value,
                'dy': inputs.itemById('dy').value,
                'operation': inputs.itemById('operation').selectedItem.name,
                'depth': inputs.itemById('depth').value,
                'through_all': inputs.itemById('through_all').value,
                'flip': inputs.itemById('flip').value,
                'boundary': bool(boundary_input and boundary_input.value),
            }
            save_settings({
                'placement': options['placement'],
                'operation': options['operation'],
                'rotation': inputs.itemById('rotation').expression,
                'depth': inputs.itemById('depth').expression,
                'through_all': options['through_all'],
            })
            summary = create_pattern(_data, sel.selection(0).entity, options)
            _ui.messageBox(summary, CMD_NAME)
        except Exception:
            _ui.messageBox('Fehler beim Einfügen des Musters:\n{}'.format(traceback.format_exc()))


class DestroyHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        adsk.terminate()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def choose_file():
    settings = load_settings()
    dialog = _ui.createFileDialog()
    dialog.isMultiSelectEnabled = False
    dialog.title = 'Muster-Datei wählen (Export „Fusion-Skript“)'
    dialog.filter = 'Muster-Generator (*.json);;Alle Dateien (*.*)'
    dialog.filterIndex = 0
    folder = settings.get('folder')
    if folder and os.path.isdir(folder):
        dialog.initialDirectory = folder
    if dialog.showOpen() != adsk.core.DialogResults.DialogOK:
        return None
    save_settings({'folder': os.path.dirname(dialog.filename)})
    return dialog.filename


def run(context):
    global _app, _ui, _data, _path
    try:
        _app = adsk.core.Application.get()
        _ui = _app.userInterface
        if not adsk.fusion.Design.cast(_app.activeProduct):
            _ui.messageBox('Bitte zuerst ein Design im Arbeitsbereich KONSTRUKTION öffnen.', CMD_NAME)
            return
        _path = choose_file()
        if not _path:
            return
        try:
            _data = load_pattern(_path)
        except Exception as err:
            _ui.messageBox('Die Datei konnte nicht gelesen werden:\n{}'.format(err), CMD_NAME)
            return

        cmd_def = _ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()
        cmd_def = _ui.commandDefinitions.addButtonDefinition(
            CMD_ID, CMD_NAME, 'Lochmuster aus dem Muster-Generator einfügen')
        on_created = CommandCreatedHandler()
        cmd_def.commandCreated.add(on_created)
        _handlers.append(on_created)
        cmd_def.execute()
        # Keep the script alive until the dialog is closed.
        adsk.autoTerminate(False)
    except Exception:
        if _ui:
            _ui.messageBox('Fehler:\n{}'.format(traceback.format_exc()), CMD_NAME)
