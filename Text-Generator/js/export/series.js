// Series export: every name of the list becomes a piece of its own – side
// by side on the bed as separate objects (3MF, STL) or on one sheet (SVG,
// DXF, e.g. for a laser).

import { buildModel } from '../core/model.js';
import { seriesNames, seriesDoc, shelfLayout } from '../core/series.js';
import { developedModel } from '../core/cup.js';
import { transformRegion, regionBounds } from '../core/geometry.js';

/** One model per name: [{ name, model }]. */
export function seriesModels(doc, getFace, opts) {
  return seriesNames(doc).map((name) => ({ name, model: buildModel(seriesDoc(doc, name), getFace, opts) }));
}

/** Label of a name (line breaks as spaces). */
export const seriesLabel = (name) => name.replace(/\n/g, ' ');

function meshBounds(meshes) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const m of meshes) {
    const p = m.positions;
    for (let i = 0; i < m.triangles * 9; i += 3) {
      if (p[i] < b.minX) b.minX = p[i];
      if (p[i] > b.maxX) b.maxX = p[i];
      if (p[i + 1] < b.minY) b.minY = p[i + 1];
      if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
    }
  }
  return b;
}

function translated(m, dx, dy) {
  const n = m.triangles * 9;
  const p = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    p[i] = m.positions[i] + dx;
    p[i + 1] = m.positions[i + 1] + dy;
    p[i + 2] = m.positions[i + 2];
  }
  return { ...m, positions: p };
}

/**
 * Meshes of all pieces, in rows no wider than the bed, centred on the
 * origin; every name is an object of its own (named after it), a stamp's
 * handle stays an object beside its stamp.
 *   prepare(model) → meshes in print orientation (flipped, pieces apart)
 */
export function seriesMeshes(items, { bed, gap, prepare }) {
  const sets = items.map(({ name, model }) => ({ name, meshes: prepare(model).filter((m) => m.triangles) }))
    .filter((s) => s.meshes.length);
  const boxes = sets.map((s) => meshBounds(s.meshes));
  const offsets = shelfLayout(boxes.map((b) => [b.maxX - b.minX, b.maxY - b.minY]), { width: bed - 10, gap });
  // Rows from the back to the front, the whole layout centred.
  let maxX = 0;
  let maxY = 0;
  boxes.forEach((b, i) => {
    maxX = Math.max(maxX, offsets[i][0] + b.maxX - b.minX);
    maxY = Math.max(maxY, offsets[i][1] + b.maxY - b.minY);
  });
  const out = [];
  sets.forEach((s, i) => {
    const b = boxes[i];
    const dx = offsets[i][0] - b.minX - maxX / 2;
    const dy = maxY / 2 - offsets[i][1] - b.maxY;
    const label = seriesLabel(s.name);
    for (const m of s.meshes) {
      const key = m.part.object ?? m.part.piece ?? 0;
      out.push({
        ...translated(m, dx, dy),
        part: { ...m.part, object: `${i + 1}:${key}`, objectName: key ? `${label} – ${m.part.name}` : label },
      });
    }
  });
  return out;
}

/**
 * All pieces on one sheet as a model for SVG and DXF: the flat regions of
 * every name in rows (a cup as its unrolled wall), merged layer by layer.
 */
export function seriesSheet(items, { width, gap }) {
  const models = items.map(({ model }) => developedModel(model)).filter((m) => Number.isFinite(m.bounds.minX));
  if (!models.length) return null;
  const offsets = shelfLayout(models.map((m) => [m.bounds.maxX - m.bounds.minX, m.bounds.maxY - m.bounds.minY]), { width, gap });
  const moved = models.map((m, i) => {
    const t = [1, 0, 0, 1, offsets[i][0] - m.bounds.minX, -offsets[i][1] - m.bounds.maxY];
    const tr = (region) => transformRegion(region, t);
    return {
      base: tr(m.base), plate: tr(m.plate), text: tr(m.text), border: tr(m.border), outline: tr(m.outline),
      backText: tr(m.backText), groups: m.textGroups.map((g) => ({ ...g, region: tr(g.region) })),
    };
  });
  // The regions of the pieces do not overlap: joining the lists is enough.
  const join = (key) => moved.flatMap((m) => m[key]);
  const groups = [];
  for (const m of moved) {
    m.groups.forEach((g, i) => {
      if (!groups[i]) groups[i] = { ...g, region: [] };
      groups[i].region.push(...g.region);
    });
  }
  const sheet = {
    ...models[0],
    developed: true,
    base: join('base'),
    plate: join('plate'),
    text: join('text'),
    border: join('border'),
    outline: join('outline'),
    backText: join('backText'),
    textGroups: groups,
  };
  sheet.bounds = regionBounds([...sheet.plate, ...sheet.base, ...sheet.border, ...sheet.outline, ...sheet.text]);
  return sheet;
}
