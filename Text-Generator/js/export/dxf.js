// DXF export of the top view: every outline as a closed POLYLINE in mm
// (AutoCAD R12). Laser and cutting plotter software (LightBurn, Silhouette
// Studio, Cricut Design Space …) and Fusion 360 ("Einfügen → DXF einfügen")
// read it. A stencil has one layer with all cut lines; otherwise every part
// of the sign has its own layer.

import { dxfFile } from '../../../shared/js/dxf.js';

/** [layer, ACI colour, region] for the model, only the ones with lines. */
export function dxfLayers(model) {
  const layers = model.relief === 'cut'
    ? [['SCHNITT', 1, model.plate]]
    : [
      ['PLATTE', 7, model.base],
      ['RAND', 3, model.border],
      ['KONTUR', 6, model.outline],
      ['SCHRIFT', 5, model.text],
      ['RUECKSEITE', 4, model.backText],
    ];
  return layers.filter(([, , region]) => region.length);
}

export function exportDXF(model) {
  const b = model.bounds;
  const bounds = Number.isFinite(b.minX) ? [b.minX, b.minY, b.maxX, b.maxY] : [0, 0, 0, 0];
  const layers = dxfLayers(model);
  return dxfFile({ bounds, layers: [['0', 7], ...layers.map(([name, color]) => [name, color])] }, (w) => {
    for (const [name, , region] of layers) {
      for (const s of region) {
        w.polyline(name, s.outer);
        for (const hole of s.holes) w.polyline(name, hole);
      }
    }
  });
}
