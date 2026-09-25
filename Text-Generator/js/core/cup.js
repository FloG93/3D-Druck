// Cups and pen holders. The wall is designed flat – as wide as the
// circumference at half height, as high as the wall measured along its
// surface – and bent around the Z axis for 3D. A conical cup (flower pot)
// widens or narrows upwards; the design then stretches a little towards the
// wide end, the flat pattern for paper or foil is a ring sector.

import { regionBounds } from './geometry.js';

/**
 * Shape of the wall (mm, outside radii): r0 at the bottom, r1 at the top,
 * radius at half height, slope of the wall against the vertical (sin, cos).
 */
export function cupShape(cup) {
  const r0 = cup.diameter / 2;
  const r1 = (cup.conical ? cup.top : cup.diameter) / 2;
  const height = cup.height;
  const slope = Math.atan2(r1 - r0, height);
  const cos = Math.cos(slope);
  const radius = (r0 + r1) / 2;
  return { r0, r1, height, length: height / cos, radius, circumference: 2 * Math.PI * radius, slope, sin: Math.sin(slope), cos };
}

/**
 * Point of the design (u along the middle line, v up the wall, 0 in the
 * middle) in the flat pattern of the wall: a cone unrolls to a ring sector
 * around its apex, a cylinder stays a rectangle. Lengths along the middle
 * line and up the wall are kept, just like on the cup.
 */
export function developer(shape) {
  const k = shape.sin / shape.radius; // curvature of the middle line
  if (Math.abs(k) < 1e-9) return null;
  return (u, v) => {
    const rho = 1 / k + v;
    const phi = u * k;
    return [rho * Math.sin(phi), rho * Math.cos(phi) - 1 / k];
  };
}

/** A region in the flat pattern; long edges become arcs (steps of `step` mm). */
export function developRegion(region, shape, step = 1) {
  const f = developer(shape);
  if (!f) return region;
  const ring = (r) => {
    const out = [];
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const x0 = r[i];
      const y0 = r[i + 1];
      const x1 = r[(i + 2) % n];
      const y1 = r[(i + 3) % n];
      const pieces = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let j = 0; j < pieces; j++) out.push(...f(x0 + ((x1 - x0) * j) / pieces, y0 + ((y1 - y0) * j) / pieces));
    }
    return out;
  };
  return region.map((s) => ({ outer: ring(s.outer), holes: s.holes.map(ring) }));
}

/**
 * The model with all flat regions in the pattern of a conical wall (for SVG
 * and DXF); anything else is returned as it is.
 */
export function developedModel(model) {
  if (model.developed || !model.cup || !developer(model.cup.shape)) return model;
  const d = (region) => developRegion(region, model.cup.shape);
  const out = {
    ...model,
    developed: true,
    base: d(model.base),
    plate: d(model.plate),
    text: d(model.text),
    border: d(model.border),
    outline: d(model.outline),
    backText: d(model.backText),
    textGroups: model.textGroups.map((g) => ({ ...g, region: d(g.region) })),
  };
  out.bounds = regionBounds([...out.plate, ...out.base, ...out.border, ...out.outline, ...out.text]);
  return out;
}
