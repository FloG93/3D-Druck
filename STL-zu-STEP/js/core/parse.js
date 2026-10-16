// Reading a mesh file: binary STL, ASCII STL and OBJ (see docs/SPEC.md 5.1).
// The result is a plain triangle soup; welding points into a shared vertex
// list is the job of weld.js.
//
// Measured in docs/MACHBARKEIT.md: STL files from the wild lie about their
// format (binary files may start with the word "solid"), so the format is
// decided by the length formula 84 + 50·n, never by that word.

/** Bounding box diagonals outside this range hint at inches or metres (SPEC 5.1). */
const UNIT_MIN_DIAGONAL = 1;
const UNIT_MAX_DIAGONAL = 5000;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * parseMesh(buffer, fileName) → { tris: Float64Array(9·n), warnings, unit }
 * Throws an Error with a German message when the file cannot be read at all.
 */
export function parseMesh(buffer, fileName = '') {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) throw new Error('Die Datei ist leer.');
  const warnings = [];
  const isObj = /\.obj$/i.test(fileName) || looksLikeObj(bytes);
  const raw = isObj ? parseObj(bytes) : parseStl(bytes, warnings);
  const tris = clean(raw, warnings);
  if (tris.length === 0) throw new Error('Die Datei enthält kein Dreieck.');
  checkUnit(tris, warnings);
  return { tris, warnings, unit: 'mm' };
}

/** OBJ without the file name: a line starting with "v " and no STL keyword. */
function looksLikeObj(bytes) {
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 4096)));
  if (/^\s*(solid|facet)/i.test(head) || /facet\s+normal/i.test(head)) return false;
  return /^\s*(v|vn|vt|f|o|g|mtllib|usemtl)\s/m.test(head);
}

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 4096, bytes.length)));
  return s;
};

function parseStl(bytes, warnings) {
  if (bytes.length >= 84) {
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (84 + 50 * count === bytes.length) return parseBinaryStl(bytes, count);
    // The length formula is the only reliable test. A file that claims more
    // triangles than it has bytes is truncated – say so instead of guessing.
    const head = latin1(bytes.subarray(0, 512));
    if (!/^\s*solid/i.test(head) && !/facet\s+normal/i.test(head) && count > 0 && 84 + 50 * count > bytes.length) {
      throw new Error(`Die STL-Datei ist abgeschnitten: Sie nennt ${count} Dreiecke, es fehlen ${84 + 50 * count - bytes.length} Bytes.`);
    }
  }
  const text = latin1(bytes);
  if (!/facet|vertex|solid/i.test(text)) throw new Error('Unbekanntes Format: erwartet wird eine STL- oder OBJ-Datei.');
  return parseAsciiStl(text, warnings);
}

function parseBinaryStl(bytes, count) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = new Float64Array(9 * count);
  for (let t = 0; t < count; t++) {
    const base = 84 + 50 * t + 12; // skip the normal, it is recomputed from the points
    for (let k = 0; k < 9; k++) tris[9 * t + k] = view.getFloat32(base + 4 * k, true);
  }
  return tris;
}

function parseAsciiStl(text, warnings) {
  const out = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) out.push(num(m[1]), num(m[2]), num(m[3]));
  if (out.length % 9 !== 0) {
    warnings.push(`Die STL-Datei endet mitten in einem Dreieck; ${plural(Math.floor((out.length % 9) / 3), 'Punkt', 'Punkte')} am Ende bleiben unbenutzt.`);
    out.length -= out.length % 9;
  }
  return Float64Array.from(out);
}

const num = (s) => {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
};

function parseObj(bytes) {
  const text = latin1(bytes);
  const verts = [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s.startsWith('v ')) {
      const p = s.slice(2).trim().split(/\s+/);
      verts.push(num(p[0]), num(p[1]), num(p[2]));
      continue;
    }
    if (!s.startsWith('f ')) continue;
    const idx = s.slice(2).trim().split(/\s+/).map((tok) => {
      const i = Number.parseInt(tok.split('/')[0], 10);
      if (!Number.isFinite(i) || i === 0) return -1;
      return i > 0 ? i - 1 : verts.length / 3 + i; // negative indices count from the end
    });
    // Polygons as a fan; a quad becomes two triangles.
    for (let k = 1; k + 1 < idx.length; k++) {
      for (const i of [idx[0], idx[k], idx[k + 1]]) {
        if (i < 0 || 3 * i + 2 >= verts.length) {
          out.push(NaN, NaN, NaN);
        } else {
          out.push(verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]);
        }
      }
    }
  }
  return Float64Array.from(out);
}

/** Drops triangles with NaN/Inf coordinates and counts them in the report. */
function clean(tris, warnings) {
  const keep = [];
  let dropped = 0;
  for (let i = 0; i < tris.length; i += 9) {
    let ok = true;
    for (let k = 0; k < 9; k++) if (!Number.isFinite(tris[i + k])) ok = false;
    if (ok) for (let k = 0; k < 9; k++) keep.push(tris[i + k]);
    else dropped += 1;
  }
  if (dropped > 0) warnings.push(`${plural(dropped, 'Dreieck', 'Dreiecke')} mit ungültigen Zahlen (NaN/Inf) verworfen.`);
  return Float64Array.from(keep);
}

/** Bounding box diagonal far from millimetres: ask, do not convert silently. */
function checkUnit(tris, warnings) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (tris[i + k] < lo[k]) lo[k] = tris[i + k];
      if (tris[i + k] > hi[k]) hi[k] = tris[i + k];
    }
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (diag < UNIT_MIN_DIAGONAL) {
    warnings.push(`Das Teil ist nur ${diag.toFixed(3)} mm groß. Einheit prüfen – vielleicht sind es Meter oder Zoll.`);
  } else if (diag > UNIT_MAX_DIAGONAL) {
    warnings.push(`Das Teil ist ${Math.round(diag)} mm groß. Einheit prüfen – vielleicht sind es Mikrometer oder Zoll.`);
  }
}

/** Bounding box of a triangle soup: { lo, hi, diagonal } (used by weld and patches). */
export function soupBounds(tris) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (tris[i + k] < lo[k]) lo[k] = tris[i + k];
      if (tris[i + k] > hi[k]) hi[k] = tris[i + k];
    }
  }
  return { lo, hi, diagonal: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}
