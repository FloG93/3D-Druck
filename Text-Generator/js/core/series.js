// Series: one piece for every name of a list – a keychain for each child
// of a class. The first text of the design is replaced by the name; a "|"
// in a name breaks the line ("Familie | Müller").

export const MAX_SERIES = 200;

/** The names of the list (none when the series is switched off). */
export function seriesNames(doc) {
  if (!doc.series?.enabled) return [];
  return doc.series.names.split(/\r?\n/)
    .map((s) => s.trim().replace(/\s*\|\s*/g, '\n'))
    .filter(Boolean)
    .slice(0, MAX_SERIES);
}

/** Index of the text that the names replace (the first plain text). */
export function seriesTarget(doc) {
  return doc.texts.findIndex((t) => t.kind === 'text');
}

/** The design for one name of the series. */
export function seriesDoc(doc, name) {
  const target = seriesTarget(doc);
  return {
    ...doc,
    texts: doc.texts.map((t, i) => (i === target ? { ...t, text: name } : t)),
    series: { ...doc.series, enabled: false },
  };
}

/**
 * Places boxes [w, h] in rows no wider than `width` (row after row, each as
 * high as its highest box): the offset of every box's lower left corner.
 */
export function shelfLayout(sizes, { width, gap }) {
  const out = [];
  let x = 0;
  let y = 0;
  let row = 0;
  for (const [w, h] of sizes) {
    if (x > 0 && x + w > width) {
      x = 0;
      y += row + gap;
      row = 0;
    }
    out.push([x, y]);
    x += w + gap;
    row = Math.max(row, h);
  }
  return out;
}
