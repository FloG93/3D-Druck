"""Tests for the Fusion 360 script with a small fake of the adsk API.

The real Fusion API is not available outside Fusion 360, so this fake only
checks the script's own logic: loops are closed through shared sketch points,
geometry lands where the web app put it (cm, centred on the face), profiles
are filtered and the extrusion is configured as chosen.

Run: python3 tests/test_fusion_script.py   (needs node for the fixtures)
"""

import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'fusion360', 'MusterImport', 'MusterImport.py')


# ---------------------------------------------------------------------------
# Fake adsk API
# ---------------------------------------------------------------------------

class Point3D:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = x, y, z

    @staticmethod
    def create(x=0.0, y=0.0, z=0.0):
        return Point3D(x, y, z)

    def distanceTo(self, other):
        return math.dist((self.x, self.y, self.z), (other.x, other.y, other.z))


class SketchPoint:
    def __init__(self, p):
        self.geometry = Point3D(p.x, p.y, p.z)
        self.merged_into = None

    def merge(self, other):
        other.merged_into = self
        return True

    def resolve(self):
        return self.merged_into.resolve() if self.merged_into else self


class Collection(list):
    @staticmethod
    def create():
        return Collection()

    def add(self, item):
        self.append(item)
        return True

    def item(self, i):
        return self[i]

    @property
    def count(self):
        return len(self)


class Curve:
    def __init__(self, sketch, kind, start=None, end=None, **geo):
        self.sketch = sketch
        self.kind = kind
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.geo = geo
        self.isConstruction = False
        sketch.curves.append(self)

    def points(self, n=16):
        g = self.geo
        if self.kind == 'line':
            a, b = self.startSketchPoint.geometry, self.endSketchPoint.geometry
            return [(a.x, a.y), (b.x, b.y)]
        if self.kind == 'arc':
            c, r, a0, sw = g['center'], g['r'], g['a0'], g['sweep']
            return [(c.x + r * math.cos(a0 + sw * k / n), c.y + r * math.sin(a0 + sw * k / n)) for k in range(n + 1)]
        if self.kind == 'circle':
            c, r = g['center'], g['r']
            return [(c.x + r * math.cos(2 * math.pi * k / n), c.y + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
        c, m, p = g['center'], g['major'], g['point']
        ax, ay = m.x - c.x, m.y - c.y
        rx = math.hypot(ax, ay)
        ry = math.hypot(p.x - c.x, p.y - c.y)
        ux, uy = ax / rx, ay / rx
        return [(c.x + rx * math.cos(t) * ux - ry * math.sin(t) * uy, c.y + rx * math.cos(t) * uy + ry * math.sin(t) * ux)
                for t in (2 * math.pi * k / n for k in range(n))]


def as_point(sketch, p):
    return p if isinstance(p, SketchPoint) else sketch.new_point(p)


class Lines:
    def __init__(self, sketch):
        self.sketch = sketch

    def addByTwoPoints(self, a, b):
        return Curve(self.sketch, 'line', as_point(self.sketch, a), as_point(self.sketch, b))


class Arcs:
    def __init__(self, sketch):
        self.sketch = sketch

    def addByCenterStartSweep(self, center, start, sweep):
        assert sweep > 0, 'arcs must be counter-clockwise'
        c = center.geometry if isinstance(center, SketchPoint) else center
        s = as_point(self.sketch, start)
        r = math.hypot(s.geometry.x - c.x, s.geometry.y - c.y)
        a0 = math.atan2(s.geometry.y - c.y, s.geometry.x - c.x)
        end = self.sketch.new_point(Point3D(c.x + r * math.cos(a0 + sweep), c.y + r * math.sin(a0 + sweep), 0))
        return Curve(self.sketch, 'arc', s, end, center=c, r=r, a0=a0, sweep=sweep)


class Circles:
    def __init__(self, sketch):
        self.sketch = sketch

    def addByCenterRadius(self, center, r):
        return Curve(self.sketch, 'circle', center=center, r=r)


class Ellipses:
    def __init__(self, sketch):
        self.sketch = sketch

    def add(self, center, major, point):
        return Curve(self.sketch, 'ellipse', center=center, major=major, point=point)


class Profile:
    def __init__(self, loops, pts):
        self.profileLoops = Collection([object()] * loops)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        self.boundingBox = types.SimpleNamespace(minPoint=Point3D(min(xs), min(ys)), maxPoint=Point3D(max(xs), max(ys)))


class ProjectedCurve:
    def __init__(self, a, b):
        self.a, self.b = a, b
        self.deleted = False
        ev = types.SimpleNamespace(
            getParameterExtents=lambda: (True, 0.0, 1.0),
            getPointsAtParameters=lambda ps: (True, [Point3D(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in ps]),
        )
        self.geometry = types.SimpleNamespace(evaluator=ev)

    def deleteMe(self):
        self.deleted = True


class Sketch:
    def __init__(self, entity):
        self.entity = entity
        self.curves = []
        self.points = []
        self.isComputeDeferred = False
        self.name = ''
        self.sketchCurves = types.SimpleNamespace(
            sketchLines=Lines(self), sketchArcs=Arcs(self), sketchCircles=Circles(self), sketchEllipses=Ellipses(self))
        self.projected = []

    def new_point(self, p):
        sp = SketchPoint(p)
        self.points.append(sp)
        return sp

    def project(self, entity):
        (x0, y0), (x1, y1) = entity.frame
        corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        self.projected = Collection(ProjectedCurve(corners[i], corners[(i + 1) % 4]) for i in range(4))
        return self.projected

    @property
    def profiles(self):
        # One profile per closed hole loop plus the face region with holes.
        loops = []
        current = []
        for c in self.curves:
            if c.isConstruction:
                continue
            current.append(c)
            if c.kind in ('circle', 'ellipse'):
                loops.append(current)
                current = []
            elif current[0].startSketchPoint.resolve() is c.endSketchPoint.resolve():
                loops.append(current)
                current = []
        profiles = [Profile(1, [p for c in loop for p in c.points()]) for loop in loops]
        profiles.append(Profile(len(loops) + 1, [(-1000, -1000), (1000, 1000)]))
        return profiles


class ExtrudeInput:
    def __init__(self, profiles, op):
        self.profiles, self.op = profiles, op
        self.participantBodies = None

    def setOneSideExtent(self, extent, direction):
        self.extent, self.direction = extent, direction


class Extrudes:
    def __init__(self):
        self.added = []

    def createInput(self, profiles, op):
        return ExtrudeInput(profiles, op)

    def add(self, inp):
        self.added.append(inp)
        return types.SimpleNamespace(name='')


class Component:
    def __init__(self):
        self.sketch_list = []
        self.features = types.SimpleNamespace(extrudeFeatures=Extrudes())
        self.sketches = types.SimpleNamespace(add=self.add_sketch)

    def add_sketch(self, entity, occurrence=None):
        s = Sketch(entity)
        self.sketch_list.append(s)
        return s


class Face:
    def __init__(self, frame):
        self.frame = frame
        self.body = object()


def install_fake_adsk():
    adsk = types.ModuleType('adsk')
    core = types.ModuleType('adsk.core')
    fusion = types.ModuleType('adsk.fusion')
    core.Point3D = Point3D
    core.ObjectCollection = Collection
    core.ValueInput = types.SimpleNamespace(createByReal=lambda v: ('real', v), createByString=lambda s: ('str', s))
    for name in ('CommandCreatedEventHandler', 'InputChangedEventHandler', 'CommandEventHandler'):
        setattr(core, name, type(name, (), {}))
    fusion.Design = types.SimpleNamespace(cast=lambda x: x)
    fusion.BRepFace = types.SimpleNamespace(cast=lambda x: x if isinstance(x, Face) else None)
    fusion.FeatureOperations = types.SimpleNamespace(CutFeatureOperation='cut', NewBodyFeatureOperation='new')
    fusion.ExtentDirections = types.SimpleNamespace(PositiveExtentDirection='+', NegativeExtentDirection='-')
    fusion.DistanceExtentDefinition = types.SimpleNamespace(create=lambda v: ('distance', v))
    fusion.ThroughAllExtentDefinition = types.SimpleNamespace(create=lambda: ('all',))
    adsk.core = core
    adsk.fusion = fusion
    adsk.doEvents = lambda: None
    adsk.terminate = lambda: None
    adsk.autoTerminate = lambda flag: None
    sys.modules.update({'adsk': adsk, 'adsk.core': core, 'adsk.fusion': fusion})


def load_script():
    install_fake_adsk()
    spec = importlib.util.spec_from_file_location('MusterImport', SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def make_fixtures(folder):
    code = r"""
import fs from 'node:fs';
import { normalizeDoc, defaultDoc } from './pattern-generator/js/core/document.js';
import { generate } from './pattern-generator/js/core/generator.js';
import { exportFusionJSON } from './pattern-generator/js/export/fusion.js';
const cases = {
  swirl: defaultDoc(),
  ellipse: normalizeDoc({ canvas: {width: 60, height: 40}, shape: {type: 'ellipse', width: 6, height: 2.5}, pattern: {type: 'grid', spacingX: 9, spacingY: 6, rotation: 20} }),
  circle: normalizeDoc({ canvas: {width: 50, height: 50}, shape: {type: 'ellipse', width: 3, height: 3}, pattern: {type: 'hex', spacingX: 5, spacingY: 4.33} }),
  hexagon: normalizeDoc({ canvas: {width: 60, height: 50}, boundary: {type: 'polygon', sides: 6}, shape: {type: 'polygon', sides: 6, width: 7, height: 7, round: 0.25}, pattern: {type: 'hex', spacingX: 8.5, spacingY: 7.36} }),
  sharp: normalizeDoc({ canvas: {width: 50, height: 30}, shape: {type: 'rect', width: 5, height: 3, round: 0}, pattern: {type: 'grid', spacingX: 7, spacingY: 5} }),
  stretched: normalizeDoc({ canvas: {width: 50, height: 30}, shape: {type: 'polygon', sides: 5, width: 6, height: 3, round: 1}, pattern: {type: 'grid', spacingX: 9, spacingY: 6} }),
};
const out = process.argv[1];
for (const [name, doc] of Object.entries(cases)) fs.writeFileSync(`${out}/${name}.fusion.json`, exportFusionJSON(generate(doc), doc, { includeBoundary: true }));
"""
    subprocess.run(['node', '--input-type=module', '-e', code, folder], cwd=ROOT, check=True)


class FusionScriptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_script()
        cls.tmp = tempfile.TemporaryDirectory()
        make_fixtures(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_case(self, name, **overrides):
        mod = self.mod
        data = mod.load_pattern(os.path.join(self.tmp.name, name + '.fusion.json'))
        comp = Component()
        messages = []
        progress = types.SimpleNamespace(show=lambda *a: None, hide=lambda: None, progressValue=0, wasCancelled=False,
                                         cancelButtonText='', isBackgroundTranslucent=False)
        mod._ui = types.SimpleNamespace(createProgressDialog=lambda: progress, messageBox=messages.append)
        mod._app = types.SimpleNamespace(activeProduct=types.SimpleNamespace(activeComponent=comp, activeOccurrence=None))
        face = Face(((-9.0, -8.0), (11.0, 12.0)))  # 200 x 200 mm, centre (1, 2) cm
        options = {'placement': mod.PLACEMENTS[0], 'rotation': 0.0, 'dx': 0.0, 'dy': 0.0,
                   'operation': mod.OPERATIONS[0], 'depth': 0.2, 'through_all': False, 'flip': False, 'boundary': True}
        options.update(overrides)
        summary = mod.create_pattern(data, face, options)
        return data, comp, comp.sketch_list[0], summary

    def check_loops(self, data, sketch, center=(1.0, 2.0)):
        curves = [c for c in sketch.curves if not c.isConstruction]
        index = 0
        for hole in data['holes']:
            if 'c' in hole or 'e' in hole:
                c = curves[index]
                index += 1
                ref = hole['c'] if 'c' in hole else hole['e'][:2]
                self.assertAlmostEqual(c.geo['center'].x, center[0] + ref[0] / 10, places=6)
                self.assertAlmostEqual(c.geo['center'].y, center[1] + ref[1] / 10, places=6)
                continue
            segs = hole['p']
            loop = curves[index:index + len(segs)]
            index += len(segs)
            for a, b in zip(loop, loop[1:]):
                self.assertIs(a.endSketchPoint.resolve(), b.startSketchPoint.resolve(), 'curves must share points')
            self.assertIs(loop[-1].endSketchPoint.resolve(), loop[0].startSketchPoint.resolve(), 'loop must be closed')
            for c, seg in zip(loop, segs):
                if seg[0] == 'L':
                    e = c.endSketchPoint.resolve().geometry
                    self.assertAlmostEqual(e.x, center[0] + seg[3] / 10, places=5)
                    self.assertAlmostEqual(e.y, center[1] + seg[4] / 10, places=5)
                else:
                    self.assertAlmostEqual(c.geo['r'], seg[3] / 10, places=5)
        self.assertEqual(index, len(curves))

    def test_all_shapes_draw_closed_loops(self):
        for name in ('swirl', 'ellipse', 'circle', 'hexagon', 'sharp', 'stretched'):
            with self.subTest(name=name):
                data, comp, sketch, summary = self.run_case(name)
                self.check_loops(data, sketch)
                self.assertFalse(sketch.isComputeDeferred)
                ext = comp.features.extrudeFeatures.added
                self.assertEqual(len(ext), 1)
                self.assertEqual(len(ext[0].profiles), len(data['holes']), 'only hole profiles are extruded')
                self.assertEqual(ext[0].op, 'cut')
                self.assertEqual(ext[0].direction, '-')
                self.assertEqual(ext[0].extent, ('distance', ('real', 0.2)))
                self.assertIn('{} Löcher'.format(len(data['holes'])), summary)
                self.assertTrue(all(p.deleted for p in sketch.projected), 'projected face edges are removed')
                construction = [c for c in sketch.curves if c.isConstruction]
                self.assertTrue(construction, 'boundary is drawn as construction geometry')

    def test_rotation_offset_and_options(self):
        data, comp, sketch, _ = self.run_case('circle', rotation=math.pi / 2, dx=0.5, dy=-0.5,
                                              operation=self.mod.OPERATIONS[1], flip=True, boundary=False,
                                              placement=self.mod.PLACEMENTS[1])
        hole = data['holes'][0]
        c = sketch.curves[0].geo['center']
        self.assertAlmostEqual(c.x, 0.5 - hole['c'][1] / 10, places=6)
        self.assertAlmostEqual(c.y, -0.5 + hole['c'][0] / 10, places=6)
        ext = comp.features.extrudeFeatures.added[0]
        self.assertEqual(ext.op, 'new')
        self.assertEqual(ext.direction, '+')
        self.assertIsNone(ext.participantBodies)
        self.assertFalse(any(c.isConstruction for c in sketch.curves))

    def test_through_all_and_sketch_only(self):
        _, comp, _, _ = self.run_case('sharp', through_all=True)
        self.assertEqual(comp.features.extrudeFeatures.added[0].extent, ('all',))
        _, comp, _, summary = self.run_case('sharp', operation=self.mod.OPERATIONS[2])
        self.assertEqual(comp.features.extrudeFeatures.added, [])
        self.assertIn('Skizze', summary)

    def test_rejects_foreign_files(self):
        path = os.path.join(self.tmp.name, 'other.json')
        with open(path, 'w') as f:
            json.dump({'hello': 1}, f)
        with self.assertRaises(ValueError):
            self.mod.load_pattern(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
