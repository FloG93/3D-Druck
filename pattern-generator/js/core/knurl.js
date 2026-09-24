// Knurling ("Rändelung") built from the regular pattern tools: rhombi in a
// staggered grid become diamond pyramids (cross knurl), long strips become
// ridges (straight knurl) – through sloped relief flanks.
//
// pitch:   distance between parallel grooves (mm)
// angle:   angle of the grooves to the axis y (cross knurl, 30° or 45° usual)
// profile: included angle of the V profile (90° = flanks at 45°)
// raised:  true = points stand up (pyramids), false = points sunk in
// gap:     flat strip left between neighbouring points (keeps them separate)

import { clamp, DEG } from './math.js';

export const KNURL_DEFAULTS = { type: 'diamond', pitch: 2, angle: 30, profile: 90, raised: true, gap: 0.1 };

/**
 * Shape, pattern, relief and check settings for a knurl on the given
 * document (canvas, form, boundary). On a cylinder the pitch is adjusted so
 * that a whole number of points fits around it.
 */
export function knurlSettings(knurl, doc) {
  const k = { ...KNURL_DEFAULTS, ...knurl };
  const cylinder = doc.form && doc.form.type === 'cylinder';
  const U = doc.canvas.width;
  const taper = clamp(k.profile, 20, 160) / 2;
  const snap = (w) => (cylinder ? U / Math.max(1, Math.round(U / w)) : w);
  const relief = (width) => ({
    mode: k.raised ? 'emboss' : 'deboss',
    // Just enough for the flanks to meet in a point or ridge.
    height: Math.round(((width / 2) / Math.tan(taper * DEG)) * 1e4) / 1e4,
    taper,
  });
  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  if (k.type === 'straight') {
    const w = snap(Math.max(k.pitch, 0.2));
    const gap = clamp(k.gap, 0, w / 2);
    const floor = cylinder ? doc.form.bottom || 0 : 0;
    const length = Math.max(doc.canvas.height - floor - 2 * Math.max(doc.boundary.margin || 0, 0) - 0.01, 0.5);
    return {
      shape: { type: 'rect', width: round4(w - gap), height: round4(length), round: 0, rotation: 0, minSize: 0.05 },
      pattern: {
        type: 'grid', spacingX: w, spacingY: round4(doc.canvas.height * 2), rotation: 0, rotateHoles: true,
        offsetX: 0, offsetY: round4(floor / 2), spin: 0,
      },
      relief: relief(w - gap),
      check: { minWeb: 0 },
    };
  }
  const alpha = clamp(k.angle, 10, 80) * DEG;
  // Rhombus with diagonals w (across) and h (along the axis); its opposite
  // edges are one pitch apart: pitch = w cos(alpha), w / h = tan(alpha).
  const w = snap(Math.max(k.pitch, 0.2) / Math.cos(alpha));
  const h = w / Math.tan(alpha);
  const pitch = w * Math.cos(alpha);
  const gap = clamp(k.gap, 0, pitch / 2);
  const s = (pitch - gap) / pitch;
  return {
    shape: { type: 'polygon', sides: 4, width: round4(w * s), height: round4(h * s), round: 0, rotation: 0, minSize: 0.05 },
    pattern: {
      type: 'hex', spacingX: w, spacingY: round4(h / 2), rowShift: 0.5, rotation: 0, rotateHoles: true,
      offsetX: 0, offsetY: 0, spin: 0,
    },
    relief: relief(pitch - gap),
    check: { minWeb: 0 },
  };
}

/**
 * Modifiers that turn or move shapes would break the tiling of a knurl;
 * scaling ones (e.g. fading towards the edge) are fine.
 */
export function twistsShapes(m) {
  if (!m || m.enabled === false) return false;
  if (m.type === 'point' || m.type === 'line') {
    return m.rotateMode === 'tangent' || m.rotateMode === 'normal' || !!m.angle || !!m.push;
  }
  if (m.type === 'linear') return !!m.angleFrom || !!m.angleTo;
  if (m.type === 'noise') return !!m.angle || !!m.jitter;
  return !!m.angle;
}

/** Applies a knurl to a (partial) document and returns it. */
export function withKnurl(doc, knurl) {
  const k = knurlSettings(knurl, {
    canvas: doc.canvas,
    form: doc.form || { type: 'plate' },
    boundary: doc.boundary || { margin: 0 },
  });
  return {
    ...doc,
    shape: { ...(doc.shape || {}), ...k.shape },
    pattern: { ...(doc.pattern || {}), ...k.pattern },
    relief: k.relief,
    check: { ...(doc.check || {}), ...k.check },
  };
}
