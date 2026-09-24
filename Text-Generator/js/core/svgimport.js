// Import of SVG graphics (logos, icons) as outlines.
//
// parseSVG(source) reads the file (own small XML parser, so it also runs in
// Node) and returns the filled and stroked shapes as normalised paths:
//   { name, shapes: [{ d, rule, op, stroke }], w, h, warnings }
// d       path with absolute M, L, C, Z only, y up, centred, 100 units tall
// rule    'nonzero' or 'evenodd'
// op      1 adds to the graphic, -1 cuts away (white shapes painted on top)
// stroke  0 for a filled shape, else the line width (same units)
// The graphic is stored in the document in this form and turned into
// regions at the chosen size by graphicRegion() in blocks.js.

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

// --- XML ---------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Minimal XML parser: { name, attrs, children, text } (namespace prefixes dropped). */
export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset [...].
      let j = lt + 2;
      let depth = 0;
      while (j < n && !(src[j] === '>' && depth === 0)) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']') depth--;
        j++;
      }
      i = j + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = src.slice(lt + 2, end < 0 ? n : end).trim().replace(/^.*:/, '');
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end < 0 ? n : end + 1;
    } else {
      // Start tag with attributes; quotes may contain '>'.
      let j = lt + 1;
      while (j < n && !/[\s/>]/.test(src[j])) j++;
      const node = { name: src.slice(lt + 1, j).replace(/^.*:/, ''), attrs: {}, children: [], text: '' };
      let selfClosing = false;
      while (j < n) {
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === '>') {
          j++;
          break;
        }
        if (src[j] === '/' && src[j + 1] === '>') {
          selfClosing = true;
          j += 2;
          break;
        }
        let k = j;
        while (k < n && !/[\s=/>]/.test(src[k])) k++;
        const key = src.slice(j, k);
        j = k;
        while (j < n && /\s/.test(src[j])) j++;
        let value = '';
        if (src[j] === '=') {
          j++;
          while (j < n && /\s/.test(src[j])) j++;
          const q = src[j];
          if (q === '"' || q === "'") {
            const end = src.indexOf(q, j + 1);
            value = src.slice(j + 1, end < 0 ? n : end);
            j = end < 0 ? n : end + 1;
          } else {
            let e = j;
            while (e < n && !/[\s>]/.test(src[e])) e++;
            value = src.slice(j, e);
            j = e;
          }
        }
        if (key) node.attrs[key.replace(/^(?!xlink:href$).*:/, '')] = decodeEntities(value);
        if (j === k && src[j] !== '=' && !key) j++;
      }
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = j;
    }
  }
  return root;
}

// --- styles ------------------------------------------------------------------

/** Simple CSS: rules with .class, #id, tag and tag.class selectors. */
function parseCSS(text) {
  const rules = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  let order = 0;
  while ((m = re.exec(src))) {
    const decls = {};
    for (const part of m[2].split(';')) {
      const c = part.indexOf(':');
      if (c > 0) decls[part.slice(0, c).trim().toLowerCase()] = part.slice(c + 1).replace(/!important/, '').trim();
    }
    for (const raw of m[1].split(',')) {
      const sel = raw.trim();
      const sm = /^([a-zA-Z][\w-]*)?(?:([.#])([\w-]+))?$/.exec(sel);
      if (!sm || (!sm[1] && !sm[2])) continue;
      const specificity = (sm[2] === '#' ? 100 : sm[2] === '.' ? 10 : 0) + (sm[1] ? 1 : 0);
      rules.push({ tag: sm[1] || null, kind: sm[2] || null, name: sm[3] || null, decls, specificity, order: order++ });
    }
  }
  return rules;
}

function styleOf(node, rules) {
  const out = {};
  // Presentation attributes lose against CSS, CSS against the style attribute.
  for (const key of ['fill', 'fill-rule', 'stroke', 'stroke-width', 'display', 'visibility', 'opacity', 'fill-opacity', 'stroke-opacity', 'color']) {
    if (node.attrs[key] !== undefined) out[key] = node.attrs[key];
  }
  const classes = (node.attrs.class || '').split(/\s+/).filter(Boolean);
  const hits = rules.filter((r) => (!r.tag || r.tag === node.name)
    && (!r.kind || (r.kind === '.' ? classes.includes(r.name) : node.attrs.id === r.name)))
    .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  for (const r of hits) Object.assign(out, r.decls);
  for (const part of (node.attrs.style || '').split(';')) {
    const c = part.indexOf(':');
    if (c > 0) out[part.slice(0, c).trim().toLowerCase()] = part.slice(c + 1).replace(/!important/, '').trim();
  }
  return out;
}

const NAMED = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0], blue: [0, 0, 1], yellow: [1, 1, 0],
  gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5], silver: [0.75, 0.75, 0.75], orange: [1, 0.65, 0], navy: [0, 0, 0.5],
  whitesmoke: [0.96, 0.96, 0.96], snow: [1, 0.98, 0.98], ivory: [1, 1, 0.94], gainsboro: [0.86, 0.86, 0.86],
};

/** Colour as [r, g, b] in 0..1, or null for none/transparent. */
function parseColor(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x) / 255);
    if (p.length >= 4 && parseFloat(p[3]) === 0) return null;
    return [ch(p[0]), ch(p[1]), ch(p[2])].map((x) => (Number.isFinite(x) ? x : 0));
  }
  return NAMED[s] || [0, 0, 0];
}

/** Near-white (all channels light): painted on top it cuts the graphic away. */
const isLight = (rgb) => rgb.every((c) => c >= 0.85);

// --- transforms --------------------------------------------------------------

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** a·b: apply b first, then a. Matrices as [a, b, c, d, e, f] like SVG. */
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function parseTransform(s) {
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s || ''))) {
    const v = (t[2].match(NUM) || []).map(Number);
    let k = IDENTITY;
    const rad = (deg) => (deg * Math.PI) / 180;
    switch (t[1]) {
      case 'matrix':
        if (v.length >= 6) k = v.slice(0, 6);
        break;
      case 'translate':
        k = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
        break;
      case 'scale':
        k = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = rad(v[0] || 0);
        const r = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        k = v.length >= 3 ? multiply(multiply([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]) : r;
        break;
      }
      case 'skewX':
        k = [1, 0, Math.tan(rad(v[0] || 0)), 1, 0, 0];
        break;
      case 'skewY':
        k = [1, Math.tan(rad(v[0] || 0)), 0, 1, 0, 0];
        break;
      default:
    }
    m = multiply(m, k);
  }
  return m;
}

// --- path data -----------------------------------------------------------------

/** Cubic Béziers for an SVG elliptical arc (endpoint parameterisation). */
function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / segs;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  let t = t1;
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = pt(t);
    const [adx, ady] = der(t);
    const tb = t + step;
    const [bx, by] = i === segs - 1 ? [x2, y2] : pt(tb);
    const [bdx, bdy] = der(tb);
    out.push([ax + alpha * adx, ay + alpha * ady, bx - alpha * bdx, by - alpha * bdy, bx, by]);
    t = tb;
  }
  return out;
}

/**
 * Path data to absolute subpaths: [{ start: [x, y], segs: [[x1,y1,x2,y2,x,y] | [x,y]], closed }].
 * Lines are [x, y], curves cubic [x1, y1, x2, y2, x, y].
 */
export function parsePathData(d) {
  const tokens = String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || [];
  const paths = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl = null; // for S/T reflection
  let lastQuad = null;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  const hasNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  // Arc flags may be written without separators ("a1 1 0 00 1 1").
  const flag = () => {
    const t = tokens[i];
    if (t === undefined) return 0;
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    i++;
    return Number(t);
  };
  const begin = (px, py) => {
    cur = { start: [px, py], segs: [], closed: false };
    paths.push(cur);
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (cur) {
        cur.closed = true;
        x = sx;
        y = sy;
        cur = null;
      }
      lastCtrl = lastQuad = null;
      continue;
    }
    if (!hasNum()) continue;
    if (C === 'M') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      sx = x;
      sy = y;
      begin(x, y);
      cmd = rel ? 'l' : 'L';
      lastCtrl = lastQuad = null;
      continue;
    }
    if (!cur) begin(x, y);
    if (C === 'L') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      cur.segs.push([x, y]);
      lastCtrl = lastQuad = null;
    } else if (C === 'H') {
      x = (rel ? x : 0) + num();
      cur.segs.push([x, y]);
      lastCtrl = lastQuad = null;
    } else if (C === 'V') {
      y = (rel ? y : 0) + num();
      cur.segs.push([x, y]);
      lastCtrl = lastQuad = null;
    } else if (C === 'C' || C === 'S') {
      let x1;
      let y1;
      if (C === 'C') {
        x1 = (rel ? x : 0) + num();
        y1 = (rel ? y : 0) + num();
      } else {
        [x1, y1] = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
      }
      const x2 = (rel ? x : 0) + num();
      const y2 = (rel ? y : 0) + num();
      const ex = (rel ? x : 0) + num();
      const ey = (rel ? y : 0) + num();
      cur.segs.push([x1, y1, x2, y2, ex, ey]);
      lastCtrl = [x2, y2];
      lastQuad = null;
      x = ex;
      y = ey;
    } else if (C === 'Q' || C === 'T') {
      let qx;
      let qy;
      if (C === 'Q') {
        qx = (rel ? x : 0) + num();
        qy = (rel ? y : 0) + num();
      } else {
        [qx, qy] = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
      }
      const ex = (rel ? x : 0) + num();
      const ey = (rel ? y : 0) + num();
      // Quadratic to cubic.
      cur.segs.push([x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
      lastQuad = [qx, qy];
      lastCtrl = null;
      x = ex;
      y = ey;
    } else if (C === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = flag();
      const sweep = flag();
      const ex = (rel ? x : 0) + num();
      const ey = (rel ? y : 0) + num();
      for (const c of arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey)) cur.segs.push(c);
      x = ex;
      y = ey;
      lastCtrl = lastQuad = null;
    } else {
      i++;
    }
  }
  return paths.filter((p) => p.segs.length);
}

function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5522847498;
  return [{
    start: [cx + rx, cy],
    segs: [
      [cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry],
      [cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
      [cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry],
      [cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy],
    ],
    closed: true,
  }];
}

function rectPath(x, y, w, h, rx, ry) {
  if (!(w > 0 && h > 0)) return [];
  if (rx === undefined && ry === undefined) rx = ry = 0;
  else if (rx === undefined) rx = ry;
  else if (ry === undefined) ry = rx;
  rx = Math.min(Math.max(rx, 0), w / 2);
  ry = Math.min(Math.max(ry, 0), h / 2);
  if (!rx || !ry) return [{ start: [x, y], segs: [[x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
  const k = 0.5522847498;
  return [{
    start: [x + rx, y],
    segs: [
      [x + w - rx, y],
      [x + w - rx + k * rx, y, x + w, y + ry - k * ry, x + w, y + ry],
      [x + w, y + h - ry],
      [x + w, y + h - ry + k * ry, x + w - rx + k * rx, y + h, x + w - rx, y + h],
      [x + rx, y + h],
      [x + rx - k * rx, y + h, x, y + h - ry + k * ry, x, y + h - ry],
      [x, y + ry],
      [x, y + ry - k * ry, x + rx - k * rx, y, x + rx, y],
    ],
    closed: true,
  }];
}

function pointsPath(s, closed) {
  const v = (String(s || '').match(NUM) || []).map(Number);
  if (v.length < 4) return [];
  const segs = [];
  for (let i = 2; i + 1 < v.length; i += 2) segs.push([v[i], v[i + 1]]);
  return [{ start: [v[0], v[1]], segs, closed }];
}

const len = (a) => {
  const v = parseFloat(a);
  return Number.isFinite(v) ? v : undefined;
};

/** Subpaths of a basic shape element (or null if it is not one). */
function shapePaths(node) {
  const a = node.attrs;
  switch (node.name) {
    case 'path':
      return parsePathData(a.d);
    case 'rect':
      return rectPath(len(a.x) || 0, len(a.y) || 0, len(a.width) || 0, len(a.height) || 0, len(a.rx), len(a.ry));
    case 'circle': {
      const r = len(a.r) || 0;
      return r > 0 ? ellipsePath(len(a.cx) || 0, len(a.cy) || 0, r, r) : [];
    }
    case 'ellipse': {
      const rx = len(a.rx) || 0;
      const ry = len(a.ry) || 0;
      return rx > 0 && ry > 0 ? ellipsePath(len(a.cx) || 0, len(a.cy) || 0, rx, ry) : [];
    }
    case 'polygon':
      return pointsPath(a.points, true);
    case 'polyline':
      return pointsPath(a.points, false);
    case 'line':
      return [{ start: [len(a.x1) || 0, len(a.y1) || 0], segs: [[len(a.x2) || 0, len(a.y2) || 0]], closed: false }];
    default:
      return null;
  }
}

function transformPaths(paths, m) {
  const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return paths.map((p) => ({
    start: T(...p.start),
    segs: p.segs.map((s) => (s.length === 2 ? T(s[0], s[1]) : [...T(s[0], s[1]), ...T(s[2], s[3]), ...T(s[4], s[5])])),
    closed: p.closed,
  }));
}

const NOT_RENDERED = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient',
  'title', 'desc', 'metadata', 'style', 'script', 'filter', 'foreignObject']);

// --- import --------------------------------------------------------------------

/** Reads an SVG file. Throws a German message if it holds no usable shape. */
export function parseSVG(source, { name = '' } = {}) {
  const warnings = new Set();
  const root = parseXML(String(source || ''));
  const svg = root.children.find((c) => c.name === 'svg');
  if (!svg) throw new Error('Das ist keine SVG-Datei.');
  const byId = new Map();
  const rules = [];
  const index = (node) => {
    if (node.attrs && node.attrs.id) byId.set(node.attrs.id, node);
    if (node.name === 'style') rules.push(...parseCSS(node.text));
    for (const c of node.children) index(c);
  };
  index(svg);

  const raw = []; // { paths, fill, stroke, width, rule }
  const walk = (node, m, inherited, depth) => {
    if (depth > 40) return;
    const own = styleOf(node, rules);
    const style = { ...inherited, ...own };
    if (own.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return;
    const mm = node.attrs.transform ? multiply(m, parseTransform(node.attrs.transform)) : m;
    if (node.name === 'use') {
      const ref = (node.attrs['xlink:href'] || node.attrs.href || '').replace(/^#/, '');
      const target = byId.get(ref);
      if (!target || target === node) return;
      const mu = multiply(mm, [1, 0, 0, 1, len(node.attrs.x) || 0, len(node.attrs.y) || 0]);
      if (target.name === 'symbol') for (const c of target.children) walk(c, mu, style, depth + 1);
      else walk(target, mu, style, depth + 1);
      return;
    }
    if (node.name === 'text' || node.name === 'tspan') {
      warnings.add('Text in der SVG wird nicht übernommen – vorher in Pfade umwandeln (Inkscape: Pfad → Objekt in Pfad umwandeln).');
      return;
    }
    if (node.name === 'image') {
      warnings.add('Eingebettete Bilder werden nicht übernommen – nur Vektorformen.');
      return;
    }
    const paths = shapePaths(node);
    if (paths) {
      if (!paths.length) return;
      // currentColor is the inherited "color", black by default.
      const paint = (v) => parseColor(v === 'currentColor' ? (style.color ?? 'black') : v);
      const fillOpacity = parseFloat(style['fill-opacity']);
      const fill = style.fill === undefined ? [0, 0, 0] : (fillOpacity === 0 ? null : paint(style.fill));
      const strokeOpacity = parseFloat(style['stroke-opacity']);
      const stroke = style.stroke === undefined || strokeOpacity === 0 ? null : paint(style.stroke);
      const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
      const width = (len(style['stroke-width']) ?? 1) * scale;
      const tp = transformPaths(paths, mm);
      // Lines (open subpaths) have no fill.
      if (fill && node.name !== 'line') raw.push({ paths: tp, fill, rule: style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero' });
      if (stroke && width > 0) raw.push({ paths: tp, stroke, width });
      return;
    }
    if (NOT_RENDERED.has(node.name)) return;
    for (const c of node.children) walk(c, mm, style, depth + 1);
  };
  // Root svg: x/y ignored; everything is normalised afterwards.
  for (const c of svg.children) walk(c, IDENTITY, styleOf(svg, rules), 0);

  // Bounding box of what adds to the graphic (control points are enough).
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const addBox = (x, y, pad = 0) => {
    box.minX = Math.min(box.minX, x - pad);
    box.maxX = Math.max(box.maxX, x + pad);
    box.minY = Math.min(box.minY, y - pad);
    box.maxY = Math.max(box.maxY, y + pad);
  };
  const shapes = raw.map((r) => ({ ...r, op: isLight(r.fill || r.stroke) ? -1 : 1 }));
  const adding = shapes.some((s) => s.op > 0) ? shapes.filter((s) => s.op > 0) : shapes;
  for (const s of adding) {
    for (const p of s.paths) {
      addBox(p.start[0], p.start[1], (s.width || 0) / 2);
      for (const seg of p.segs) for (let k = 0; k < seg.length; k += 2) addBox(seg[k], seg[k + 1], (s.width || 0) / 2);
    }
  }
  if (!shapes.length || !Number.isFinite(box.minX)) {
    throw new Error(warnings.size ? [...warnings][0] : 'In der SVG-Datei wurden keine Formen gefunden.');
  }
  const bw = box.maxX - box.minX;
  const bh = box.maxY - box.minY;
  const k = 100 / (bh > 1e-9 ? bh : bw || 1);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const f = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  };
  // SVG y points down: flip so y is up.
  const P = (x, y) => `${f((x - cx) * k)} ${f(-(y - cy) * k)}`;
  const out = [];
  for (const s of shapes) {
    const parts = [];
    for (const p of s.paths) {
      parts.push(`M${P(...p.start)}`);
      for (const seg of p.segs) {
        parts.push(seg.length === 2 ? `L${P(seg[0], seg[1])}` : `C${P(seg[0], seg[1])} ${P(seg[2], seg[3])} ${P(seg[4], seg[5])}`);
      }
      if (p.closed || s.fill) parts.push('Z');
    }
    out.push({ d: parts.join(''), rule: s.rule || 'nonzero', op: s.op, stroke: s.width ? Math.round(s.width * k * 1000) / 1000 : 0 });
  }
  return {
    name: String(name || '').replace(/\.svg$/i, '').slice(0, 60),
    shapes: out,
    w: Math.round(bw * k * 1000) / 1000,
    h: Math.round(bh * k * 1000) / 1000 || 100,
    warnings: [...warnings],
  };
}

/** Normalised path data (M, L, C, Z) back to opentype-style commands. */
export function pathCommands(d) {
  const out = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m;
  while ((m = re.exec(d || ''))) {
    const v = (m[2].match(NUM) || []).map(Number);
    if (m[1] === 'M') out.push({ type: 'M', x: v[0], y: v[1] });
    else if (m[1] === 'L') out.push({ type: 'L', x: v[0], y: v[1] });
    else if (m[1] === 'C') out.push({ type: 'C', x1: v[0], y1: v[1], x2: v[2], y2: v[3], x: v[4], y: v[5] });
    else out.push({ type: 'Z' });
  }
  return out;
}
