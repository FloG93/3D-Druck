// Writes DXF/SVG/STEP/Fusion-JSON/STL exports of several test patterns into a
// folder for validation with tests/tools/validate_exports.py (ezdxf, OpenCascade).
// Usage: node tests/tools/generate-exports.mjs <folder>
import fs from 'node:fs';
import { defaultDoc, normalizeDoc } from '../../pattern-generator/js/core/document.js';
import { generate } from '../../pattern-generator/js/core/generator.js';
import { exportDXF } from '../../pattern-generator/js/export/dxf.js';
import { exportSVG } from '../../pattern-generator/js/export/svg.js';
import { exportSTEP } from '../../pattern-generator/js/export/step.js';
import { exportFusionJSON } from '../../pattern-generator/js/export/fusion.js';
import { buildPlateMesh, toBinarySTL } from '../../pattern-generator/js/export/mesh.js';
import { polygonize } from '../../pattern-generator/js/core/shapes.js';
const OUT = process.argv[2] || 'build/exports';
fs.mkdirSync(OUT, { recursive: true });
const cases = {
  swirl: defaultDoc(),
  hexround: normalizeDoc({ canvas: {width: 120, height: 80}, boundary: {type:'polygon', sides: 6, cornerRadius: 5, margin: 4}, shape: {type:'polygon', sides:6, width:8, height:8, round:0.3}, pattern:{type:'hex', spacingX: 9.5, spacingY: 8.227} }),
  ellipses: normalizeDoc({ canvas: {width: 100, height: 70}, boundary: {type:'ellipse', margin: 3}, shape: {type:'ellipse', width:7, height:3}, pattern:{type:'grid', spacingX: 10, spacingY: 8}, modifiers:[{type:'point', x:0, y:0, radius: 40, angle: 90, rotateMode:'tangent'}] }),
  circles: normalizeDoc({ canvas: {width: 80, height: 80}, boundary: {type:'rect', cornerRadius: 0, margin: 3}, shape: {type:'ellipse', width:4, height:4}, pattern:{type:'hex', spacingX: 6, spacingY: 5.196} }),
  rects: normalizeDoc({ canvas: {width: 90, height: 60}, boundary: {type:'rect', cornerRadius: 10, margin: 4}, shape: {type:'rect', width:6, height:4, round:0}, pattern:{type:'grid', spacingX: 8, spacingY: 6, rotation: 15} }),
  rrect: normalizeDoc({ canvas: {width: 90, height: 60}, boundary: {type:'none', margin: 4}, shape: {type:'rect', width:6, height:4, round:0.5}, pattern:{type:'grid', spacingX: 8, spacingY: 6} }),
  tri: normalizeDoc({ canvas: {width: 90, height: 60}, boundary: {type:'rect', cornerRadius: 30, margin: 4}, shape: {type:'polygon', sides:3, width:6, height:6, round:0.2}, pattern:{type:'hex', spacingX: 8, spacingY: 6} }),
};
const summary = {};
for (const [name, doc] of Object.entries(cases)) {
  const r = generate(doc);
  const expectedArea = r.stats.openArea;
  fs.writeFileSync(`${OUT}/${name}.dxf`, exportDXF(r, doc, { origin: 'center', includeBoundary: true }));
  fs.writeFileSync(`${OUT}/${name}.svg`, exportSVG(r, doc, { style: 'fill', includeBoundary: true }));
  fs.writeFileSync(`${OUT}/${name}_plate.svg`, exportSVG(r, doc, { style: 'plate' }));
  fs.writeFileSync(`${OUT}/${name}_tools.step`, exportSTEP(r, doc, { mode: 'tools', thickness: 3, zPlacement: 'center', name }));
  fs.writeFileSync(`${OUT}/${name}_plate.step`, exportSTEP(r, doc, { mode: 'plate', thickness: 3, name }));
  fs.writeFileSync(`${OUT}/${name}.fusion.json`, exportFusionJSON(r, doc, { includeBoundary: true }));
  const mesh = buildPlateMesh(r.boundary.outline, r.holes.map(h => h.outline), 3, 0.015);
  fs.writeFileSync(`${OUT}/${name}.stl`, toBinarySTL(mesh.positions));
  const perimeter = (o) => { const p = polygonize(o, 0.015); return p.reduce((acc, q, i) => acc + Math.hypot(p[(i + 1) % p.length][0] - q[0], p[(i + 1) % p.length][1] - q[1]), 0); };
  summary[name] = { holes: r.holes.length, holeArea: expectedArea, plateArea: r.boundary.area, perimeter: perimeter(r.boundary.outline) + r.holes.reduce((acc, h) => acc + perimeter(h.outline), 0), kinds: [...new Set(r.holes.map(h => h.outline.kind))] };
}
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
