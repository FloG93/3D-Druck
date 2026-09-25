// Text layout: turns a text block into glyph outlines in millimetres (y up).
//
// Lines run along a straight baseline or along a circular arc (text on top
// of a circle reads clockwise, text at the bottom counter-clockwise with the
// letters upright). The block's size is the cap height (height of "H").

import { TOLERANCE, union, regionBounds, emptyBounds } from './geometry.js';
import { isModifier } from './fonts.js';

const DEG = Math.PI / 180;

/**
 * Flattens path commands (M, L, Q, C, Z) with the affine map m into polylines:
 * [{ pts: [x0, y0, …], closed }] (closed: the subpath ended with Z).
 */
export function flattenPaths(commands, m, tol = TOLERANCE) {
  const out = [];
  let pts = null;
  let x0 = 0;
  let y0 = 0;
  let sx = 0;
  let sy = 0;
  const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const push = (x, y) => {
    const n = pts.length;
    if (n >= 2 && Math.abs(pts[n - 2] - x) < 1e-9 && Math.abs(pts[n - 1] - y) < 1e-9) return;
    pts.push(x, y);
  };
  const end = (closed) => {
    if (!pts) return;
    const n = pts.length;
    // A closing point equal to the start is implied.
    if (closed && n >= 4 && Math.abs(pts[0] - pts[n - 2]) < 1e-9 && Math.abs(pts[1] - pts[n - 1]) < 1e-9) pts.length = n - 2;
    if (pts.length >= 4) out.push({ pts, closed });
    pts = null;
  };
  for (const c of commands) {
    if (c.type === 'M') {
      end(false);
      [x0, y0] = T(c.x, c.y);
      sx = x0;
      sy = y0;
      pts = [x0, y0];
    } else if (c.type === 'L') {
      if (!pts) pts = [x0, y0];
      const [x, y] = T(c.x, c.y);
      push(x, y);
      x0 = x;
      y0 = y;
    } else if (c.type === 'Q') {
      if (!pts) pts = [x0, y0];
      const [x1, y1] = T(c.x1, c.y1);
      const [x, y] = T(c.x, c.y);
      const dd = Math.hypot(x0 - 2 * x1 + x, y0 - 2 * y1 + y);
      const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(dd / (4 * tol)))));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        push(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
      }
      x0 = x;
      y0 = y;
    } else if (c.type === 'C') {
      if (!pts) pts = [x0, y0];
      const [x1, y1] = T(c.x1, c.y1);
      const [x2, y2] = T(c.x2, c.y2);
      const [x, y] = T(c.x, c.y);
      const dd = Math.max(Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2), Math.hypot(x1 - 2 * x2 + x, y1 - 2 * y2 + y));
      const n = Math.min(96, Math.max(1, Math.ceil(Math.sqrt((3 * dd) / (4 * tol)))));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const d = 3 * u * t * t;
        const e = t * t * t;
        push(a * x0 + b * x1 + d * x2 + e * x, a * y0 + b * y1 + d * y2 + e * y);
      }
      x0 = x;
      y0 = y;
    } else if (c.type === 'Z') {
      end(true);
      x0 = sx;
      y0 = sy;
    }
  }
  end(false);
  return out;
}

/** Flattens path commands (font units) with the affine map m into rings (mm). */
export function flattenCommands(commands, m, tol = TOLERANCE) {
  const rings = [];
  for (const { pts } of flattenPaths(commands, m, tol)) {
    const n = pts.length;
    // Every subpath is a filled ring, closed or not.
    if (n >= 4 && Math.abs(pts[0] - pts[n - 2]) < 1e-9 && Math.abs(pts[1] - pts[n - 1]) < 1e-9) pts.length = n - 2;
    if (pts.length >= 6) rings.push(pts);
  }
  return rings;
}

/** Path commands (font units, y up) of a glyph mapped with m into mm. */
export function transformCommands(commands, m) {
  const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return commands.map((c) => {
    const o = { type: c.type };
    if (c.x !== undefined) [o.x, o.y] = T(c.x, c.y);
    if (c.x1 !== undefined) [o.x1, o.y1] = T(c.x1, c.y1);
    if (c.x2 !== undefined) [o.x2, o.y2] = T(c.x2, c.y2);
    return o;
  });
}

/**
 * Glyphs for a string with the font's ligatures etc.; falls back to plain
 * character mapping when opentype.js cannot apply a substitution table.
 */
function glyphsOf(font, text) {
  try {
    return font.stringToGlyphs(text);
  } catch {
    return [...text].map((ch) => font.charToGlyph(ch));
  }
}

function kerningLookups(font) {
  try {
    const script = font.position.getDefaultScriptName();
    return font.position.getKerningTables(script);
  } catch {
    return null;
  }
}

/**
 * Places the glyphs of one line on a straight baseline starting at x = 0.
 * Returns { items: [{ glyph, font, x, dy, advance, scale, ch }], width, missing }.
 * Symbols get a little space on both sides (their icons fill the advance).
 */
export function shapeLine(line, face, fontSize, spacing = 0, kerning = true) {
  const missing = new Set();
  const runs = [];
  for (const ch of line) {
    // Emoji variation selectors and joiners have no shape of their own.
    if (isModifier(ch)) continue;
    let f = face.fontFor(ch);
    if (!f && /\s/.test(ch)) f = face.fonts[0];
    if (!f) {
      missing.add(ch);
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.font === f) last.text += ch;
    else runs.push({ font: f, text: ch });
  }
  const items = [];
  let x = 0;
  for (const run of runs) {
    const { font } = run;
    const { scale, dy, pad } = face.metricsFor(font, fontSize);
    const glyphs = glyphsOf(font, run.text);
    const lookups = kerning ? kerningLookups(font) : null;
    const chars = [...run.text];
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const advance = (g.advanceWidth || 0) * scale;
      x += pad;
      items.push({ glyph: g, font, x, dy, advance, scale, ch: chars[i] ?? '' });
      x += advance + pad;
      if (kerning && i < glyphs.length - 1) {
        const k = lookups
          ? font.position.getKerningValue(lookups, g.index, glyphs[i + 1].index)
          : font.getKerningValue(g, glyphs[i + 1]);
        x += (k || 0) * scale;
      }
      x += spacing;
    }
  }
  const width = items.length ? x - spacing : 0;
  return { items, width, missing };
}

/**
 * Lays out a text block.
 * block: { text, size, letterSpacing, lineSpacing, align, x, y, rotation,
 *          layout: 'line' | 'bend' | 'arcTop' | 'arcBottom', radius, bend }
 * 'arcTop' / 'arcBottom': on a circle around the block position (radius to
 * the middle of the capitals), readable at the top or at the bottom – like
 * the lettering of a coin. 'bend': bent in place by `bend` degrees (the
 * widest line spans that angle; positive arches up, negative sags).
 * Returns { glyphs: [{ ch, rings, commands }], region, bounds, lines, arc,
 * missing, fontSize } – arc: { cx, cy, r } the circle of the first line.
 */
export function layoutBlock(block, face, { tol = TOLERANCE, keepCurves = false } = {}) {
  const size = Math.max(Number(block.size) || 0, 0.1);
  const fontSize = size / face.capRatio;
  const lineSpacing = Number.isFinite(block.lineSpacing) ? block.lineSpacing : 1.2;
  const pitch = lineSpacing * fontSize;
  const spacing = Number(block.letterSpacing) || 0;
  const lines = String(block.text ?? '').replace(/\r/g, '').split('\n');
  const shaped = lines.map((l) => shapeLine(l, face, fontSize, spacing, block.kerning !== false));
  const missing = new Set();
  for (const s of shaped) for (const ch of s.missing) missing.add(ch);
  const maxWidth = Math.max(0, ...shaped.map((s) => s.width));
  let layout = block.layout || 'line';
  const n = lines.length;
  // Bent text: a circle on which the widest line spans the angle, its
  // centre below (arch) or above (sag) so the text stays where it is.
  const bendAngle = (Number(block.bend) || 0) * DEG;
  let bendR = 0;
  let oy = 0;
  if (layout === 'bend') {
    if (Math.abs(bendAngle) < 0.5 * DEG || !maxWidth) layout = 'line';
    else {
      // An arch keeps room for its inner lines.
      bendR = Math.max(maxWidth / Math.abs(bendAngle), size + (bendAngle > 0 ? (n - 1) * pitch : 0));
      oy = bendAngle > 0 ? -bendR + ((n - 1) * pitch) / 2 : bendR + ((n - 1) * pitch) / 2;
    }
  }
  const rot = (Number(block.rotation) || 0) * DEG;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const bx = Number(block.x) || 0;
  const by = Number(block.y) || 0;
  // Block frame -> world: rotate by `rotation`, then move to (x, y).
  const toWorld = (m) => [
    cosR * m[0] - sinR * m[1], sinR * m[0] + cosR * m[1],
    cosR * m[2] - sinR * m[3], sinR * m[2] + cosR * m[3],
    cosR * m[4] - sinR * m[5] + bx, sinR * m[4] + cosR * m[5] + by,
  ];

  const glyphs = [];
  const lineInfo = [];
  // Straight text: the block is centred on its cap-height box.
  const totalH = (n - 1) * pitch + size;
  const top = layout === 'arcTop' || (layout === 'bend' && bendAngle > 0);
  const R = layout === 'bend' ? bendR : Math.max(Number(block.radius) || 0, size);
  shaped.forEach((s, i) => {
    let start;
    if (block.align === 'left') start = -maxWidth / 2;
    else if (block.align === 'right') start = maxWidth / 2 - s.width;
    else start = -s.width / 2;
    const baseline = totalH / 2 - size - i * pitch;
    // Arc text: radius is the middle of the cap height of the first line;
    // letters are spaced along that middle (the baseline would squeeze the
    // tops of the letters at the bottom of a circle).
    const rMid = top ? R - i * pitch : R + i * pitch;
    const rLine = top ? rMid - size / 2 : rMid + size / 2;
    lineInfo.push({ baseline, start, width: s.width, radius: layout === 'line' ? null : rLine });
    for (const it of s.items) {
      const cmds = it.glyph.path ? it.glyph.path.commands : [];
      if (!cmds.length) continue;
      const k = it.scale;
      let m;
      if (layout === 'line') {
        m = [k, 0, 0, k, start + it.x, baseline + it.dy];
      } else {
        // Glyph centre on the arc, letters upright towards the outside (top)
        // or the inside (bottom).
        const c = start + it.x + it.advance / 2;
        const theta = top ? Math.PI / 2 - c / rMid : -Math.PI / 2 + c / rMid;
        const nx = Math.cos(theta) * (top ? 1 : -1);
        const ny = Math.sin(theta) * (top ? 1 : -1);
        const tx = top ? Math.sin(theta) : -Math.sin(theta);
        const ty = top ? -Math.cos(theta) : Math.cos(theta);
        const ax = Math.cos(theta) * rLine;
        const ay = Math.sin(theta) * rLine;
        m = [k * tx, k * ty, k * nx, k * ny, ax - (it.advance / 2) * tx + it.dy * nx, ay - (it.advance / 2) * ty + it.dy * ny + oy];
      }
      m = toWorld(m);
      const rings = flattenCommands(cmds, m, tol);
      if (!rings.length) continue;
      glyphs.push({ ch: it.ch, rings, commands: keepCurves ? transformCommands(cmds, m) : null });
    }
  });
  // Each glyph on its own first: normalises contour direction (TrueType vs CFF)
  // and overlapping contours, then all glyphs together.
  const region = union(glyphs.map((g) => union(g.rings)));
  const bounds = region.length ? regionBounds(region) : emptyBounds();
  // The circle the first line runs on, in the coordinates of the side.
  const arc = layout === 'line' ? null : { cx: -sinR * oy + bx, cy: cosR * oy + by, r: R };
  return { glyphs, region, bounds, lines: lineInfo, arc, missing, fontSize, size };
}
