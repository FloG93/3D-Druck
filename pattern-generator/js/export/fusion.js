// JSON for the Fusion 360 script "MusterImport" (fusion360/MusterImport).
// Coordinates in mm relative to the canvas centre (y up). Path outlines
// start with an arc and end with a line where possible, so the script can
// close every sketch loop through shared sketch points.
//
// holes[i] is one of
//   { "c": [x, y], "r": r }                          circle
//   { "e": [x, y, rx, ry, rot] }                     ellipse (rot in radians)
//   { "p": [["A", cx, cy, r, a0, sweep], ["L", x0, y0, x1, y1], ...] }
// relief tells the script which operation to preselect:
//   { "mode": "cut" | "emboss" | "deboss", "height": mm, "taper": degrees }

import { exportGeometry } from './common.js';
import { RELIEF_MODES } from '../core/relief.js';

const R = (v) => Math.round(v * 1e5) / 1e5 || 0;
const A = (v) => Math.round(v * 1e8) / 1e8 || 0;

function encode(o) {
  if (o.kind === 'circle') return { c: [R(o.cx), R(o.cy)], r: R(o.r) };
  if (o.kind === 'ellipse') return { e: [R(o.cx), R(o.cy), R(o.rx), R(o.ry), A(o.rot)] };
  return {
    p: o.segs.map((s) => (s.type === 'line'
      ? ['L', R(s.x0), R(s.y0), R(s.x1), R(s.y1)]
      : ['A', R(s.cx), R(s.cy), R(s.r), A(s.a0), A(s.sweep)])),
  };
}

export function exportFusionJSON(result, doc, opts = {}) {
  const geo = exportGeometry(result, doc, { origin: 'center', includeBoundary: opts.includeBoundary });
  const data = {
    format: 'muster-generator/fusion',
    version: 1,
    units: 'mm',
    name: doc.name || 'Muster',
    canvas: { width: doc.canvas.width, height: doc.canvas.height },
    stats: {
      holes: result.holes.length,
      openArea: R(result.stats.openArea),
      openRatio: R(result.stats.ratio),
    },
    relief: {
      mode: RELIEF_MODES.includes(doc.relief?.mode) ? doc.relief.mode : 'cut',
      height: R(doc.relief?.height || 0),
      taper: R(doc.relief?.taper || 0),
    },
    boundary: geo.boundary ? encode(geo.boundary) : null,
    holes: geo.holes.map(encode),
  };
  return `${JSON.stringify(data)}\n`;
}
