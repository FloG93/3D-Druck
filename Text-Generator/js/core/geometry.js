// Polygon geometry in millimetres (y up) on top of Clipper2.
//
// ring:   flat array [x0, y0, x1, y1, …], implicitly closed
// shape:  { outer: ring (counter-clockwise), holes: [ring (clockwise)] }
// region: array of shapes that do not overlap – islands inside holes are
//         shapes of their own
//
// Clipper (Angus Johnson, JS port by Timo) works on integers; SCALE sets the
// resolution (0.1 µm).

import ClipperLib from '../../vendor/clipper.mjs';

const { Clipper, ClipperOffset, ClipType, EndType, JoinType, PolyFillType, PolyTree, PolyType } = ClipperLib;

export const SCALE = 1e4;
// Chord error allowed when curves and arcs become polygons (mm).
export const TOLERANCE = 0.005;

// --- rings ---------------------------------------------------------------------

export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a / 2;
}

export function reverseRing(r) {
  const out = new Array(r.length);
  for (let i = 0, n = r.length; i < n; i += 2) {
    out[n - 2 - i] = r[i];
    out[n - 1 - i] = r[i + 1];
  }
  return out;
}

/** Ring with the requested orientation (ccw = true: counter-clockwise). */
export function orient(r, ccw) {
  return (ringArea(r) > 0) === ccw ? r : reverseRing(r);
}

/** Applies x' = a·x + c·y + e, y' = b·x + d·y + f. */
export function transformRing(r, [a, b, c, d, e, f]) {
  const out = new Array(r.length);
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i];
    const y = r[i + 1];
    out[i] = a * x + c * y + e;
    out[i + 1] = b * x + d * y + f;
  }
  return out;
}

export function emptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function addRingBounds(b, r) {
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < b.minX) b.minX = r[i];
    if (r[i] > b.maxX) b.maxX = r[i];
    if (r[i + 1] < b.minY) b.minY = r[i + 1];
    if (r[i + 1] > b.maxY) b.maxY = r[i + 1];
  }
  return b;
}

/** Number of segments for an arc of radius r and angle sweep (rad). */
export function arcSegments(r, sweep = 2 * Math.PI, tol = TOLERANCE) {
  if (r <= tol) return 4;
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / r));
  return Math.max(4, Math.ceil(Math.abs(sweep) / step));
}

export function circleRing(cx, cy, r, tol = TOLERANCE) {
  const n = Math.max(arcSegments(r, 2 * Math.PI, tol), 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  return out;
}

export function ellipseRing(cx, cy, rx, ry, tol = TOLERANCE) {
  const n = Math.max(arcSegments(Math.max(rx, ry), 2 * Math.PI, tol), 24);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    out.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  }
  return out;
}

/** Axis-aligned rectangle with rounded corners (radius clamped to fit). */
export function roundedRectRing(x0, y0, x1, y1, radius = 0, tol = TOLERANCE) {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2));
  if (r < 1e-6) return [x0, y0, x1, y0, x1, y1, x0, y1];
  const out = [];
  const n = Math.max(2, arcSegments(r, Math.PI / 2, tol));
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const t = a0 + (i / n) * (Math.PI / 2);
      out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  return out;
}

// --- regions ---------------------------------------------------------------------

export function regionRings(region) {
  const out = [];
  for (const s of region) {
    out.push(s.outer);
    for (const h of s.holes) out.push(h);
  }
  return out;
}

export function regionArea(region) {
  let a = 0;
  for (const s of region) {
    a += Math.abs(ringArea(s.outer));
    for (const h of s.holes) a -= Math.abs(ringArea(h));
  }
  return a;
}

export function regionBounds(region, b = emptyBounds()) {
  for (const s of region) addRingBounds(b, s.outer);
  return b;
}

export function transformRegion(region, m) {
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  return region.map((s) => {
    const outer = transformRing(s.outer, m);
    const holes = s.holes.map((h) => transformRing(h, m));
    return mirrored
      ? { outer: reverseRing(outer), holes: holes.map(reverseRing) }
      : { outer, holes };
  });
}

/** The region without its holes (e.g. a base plate under lettering). */
export function fillHoles(region) {
  return union(region.map((s) => ({ outer: s.outer, holes: [] })));
}

// --- Clipper bridge ---------------------------------------------------------------

function toPath(r) {
  const p = [];
  for (let i = 0; i < r.length; i += 2) p.push({ X: Math.round(r[i] * SCALE), Y: Math.round(r[i + 1] * SCALE) });
  return p;
}

function fromPath(p) {
  const r = new Array(p.length * 2);
  for (let i = 0; i < p.length; i++) {
    r[2 * i] = p[i].X / SCALE;
    r[2 * i + 1] = p[i].Y / SCALE;
  }
  return r;
}

/** Accepts regions, shapes or plain rings and returns Clipper paths. */
function toPaths(input) {
  const paths = [];
  const add = (item) => {
    if (!item) return;
    if (Array.isArray(item) && typeof item[0] === 'number') {
      if (item.length >= 6) paths.push(toPath(item));
    } else if (Array.isArray(item)) {
      for (const x of item) add(x);
    } else if (item.outer) {
      add(item.outer);
      for (const h of item.holes) add(h);
    }
  };
  add(input);
  return paths;
}

function treeToRegion(tree) {
  const region = [];
  const visit = (node) => {
    // node: outer polygon; its children are holes, their children islands.
    const contour = node.Contour();
    if (contour.length < 3) return;
    const outer = orient(fromPath(contour), true);
    const holes = [];
    for (const hole of node.Childs()) {
      if (hole.Contour().length >= 3) holes.push(orient(fromPath(hole.Contour()), false));
      for (const island of hole.Childs()) visit(island);
    }
    region.push({ outer, holes });
  };
  for (const child of tree.Childs()) visit(child);
  return region;
}

function boolean(type, subject, clip) {
  return run(type, toPaths(subject), clip ? toPaths(clip) : []);
}

// strict: no touching vertices in the result (clean meshes).
function run(type, s, k, strict = true) {
  if (!s.length) return [];
  const c = new Clipper();
  c.StrictlySimple = strict;
  c.AddPaths(s, PolyType.ptSubject, true);
  if (k.length) c.AddPaths(k, PolyType.ptClip, true);
  const tree = new PolyTree();
  c.Execute(type, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return treeToRegion(tree);
}

/** Round offset on Clipper paths, the result as paths (no tidying). */
function offsetPaths(paths, delta, tolerance) {
  if (!paths.length) return [];
  const co = new ClipperOffset(2, tolerance * SCALE);
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon);
  const out = [];
  co.Execute(out, delta * SCALE);
  return out;
}

/** Region filled by rings with an SVG fill rule ('nonzero' or 'evenodd'). */
export function fillRings(rings, rule = 'nonzero') {
  const s = toPaths(rings);
  if (!s.length) return [];
  const c = new Clipper();
  c.StrictlySimple = true;
  c.AddPaths(s, PolyType.ptSubject, true);
  const tree = new PolyTree();
  const fill = rule === 'evenodd' ? PolyFillType.pftEvenOdd : PolyFillType.pftNonZero;
  c.Execute(ClipType.ctUnion, tree, fill, fill);
  return treeToRegion(tree);
}

/**
 * Area covered by lines of the given width along paths [{ pts, closed }]
 * (round joins and ends, like an SVG stroke with round caps).
 */
export function strokePaths(paths, width, tolerance = TOLERANCE) {
  if (!(width > 0)) return [];
  const co = new ClipperOffset(2, tolerance * SCALE);
  let any = false;
  for (const p of paths) {
    if (p.pts.length < 4) continue;
    co.AddPath(toPath(p.pts), JoinType.jtRound, p.closed ? EndType.etClosedLine : EndType.etOpenRound);
    any = true;
  }
  if (!any) return [];
  const tree = new PolyTree();
  co.Execute(tree, (width / 2) * SCALE);
  return union(treeToRegion(tree));
}

/** Union of everything given (regions, shapes, rings), non-zero winding. */
export function union(...items) {
  return boolean(ClipType.ctUnion, items, null);
}

export function difference(a, b) {
  return boolean(ClipType.ctDifference, a, b);
}

export function intersection(a, b) {
  return boolean(ClipType.ctIntersection, a, b);
}

/** Grows (delta > 0) or shrinks (delta < 0) a region by delta mm. */
export function offset(region, delta, { join = 'round', tolerance = TOLERANCE } = {}) {
  const paths = toPaths(region);
  if (!paths.length) return [];
  if (Math.abs(delta) < 1e-9) return union(region);
  const joinType = join === 'miter' ? JoinType.jtMiter : join === 'square' ? JoinType.jtSquare : JoinType.jtRound;
  const co = new ClipperOffset(2, tolerance * SCALE);
  co.AddPaths(paths, joinType, EndType.etClosedPolygon);
  const tree = new PolyTree();
  co.Execute(tree, delta * SCALE);
  // Offsetting keeps the input's winding; a union makes the result tidy.
  return union(treeToRegion(tree));
}

/** Ring with fewer points (Douglas–Peucker, max. deviation t). */
export function simplifyRing(r, t) {
  const n = r.length / 2;
  if (n < 8) return r;
  const keep = new Uint8Array(n);
  // Split the closed ring at the point farthest from the first one.
  let far = 0;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (r[2 * i] - r[0]) ** 2 + (r[2 * i + 1] - r[1]) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  keep[0] = 1;
  keep[far] = 1;
  keep[n - 1] = 1;
  const stack = [[0, far], [far, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = r[2 * a];
    const ay = r[2 * a + 1];
    const dx = r[2 * b] - ax;
    const dy = r[2 * b + 1] - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let md = -1;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dx * (ay - r[2 * i + 1]) - (ax - r[2 * i]) * dy) / len;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > t) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(r[2 * i], r[2 * i + 1]);
  return out.length >= 6 ? out : r;
}

/**
 * Parts of the region narrower than width (morphological opening). Used to
 * find strokes too thin to print. Leftovers smaller than a width × width
 * square are ignored: corners and pointed stroke ends (which an opening
 * always rounds off) print fine, a thin stroke is longer than that.
 * Outlines are simplified to 0.02 mm first – twice as fast; growing back a
 * little further makes up for that (else long edges leave slivers).
 * Clipper gets slow with many edges side by side, so every shape is done
 * on its own, and big ones with many holes (a stencil) in tiles: what the
 * opening does at a point only depends on the region within width of it.
 */
const THIN_SIMPLIFY = 0.02;
const THIN_TILE = 40;
export function thinParts(region, width) {
  if (!region.length || width <= 0) return [];
  const margin = width + 4 * THIN_SIMPLIFY + TOLERANCE;
  const out = [];
  for (const s of region) {
    const b = addRingBounds(emptyBounds(), s.outer);
    const nx = Math.ceil((b.maxX - b.minX) / THIN_TILE);
    const ny = Math.ceil((b.maxY - b.minY) / THIN_TILE);
    const points = s.holes.reduce((n, h) => n + h.length, s.outer.length) / 2;
    if (nx * ny <= 1 || points < 1500) {
      out.push(...notOpened([s], width));
      continue;
    }
    const tw = (b.maxX - b.minX) / nx;
    const th = (b.maxY - b.minY) / ny;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x0 = b.minX + i * tw;
        const y0 = b.minY + j * th;
        const x1 = i === nx - 1 ? b.maxX : x0 + tw;
        const y1 = j === ny - 1 ? b.maxY : y0 + th;
        const near = (r) => {
          const rb = ringBox(r);
          return rb.maxX >= x0 - margin && rb.minX <= x1 + margin && rb.maxY >= y0 - margin && rb.minY <= y1 + margin;
        };
        const tile = [x0 - margin, y0 - margin, x1 + margin, y0 - margin, x1 + margin, y1 + margin, x0 - margin, y1 + margin];
        const part = intersection([{ outer: s.outer, holes: s.holes.filter(near) }], [tile]);
        out.push(...intersection(notOpened(part, width), [[x0, y0, x1, y0, x1, y1, x0, y1]]));
      }
    }
  }
  return union(out).filter((s) => regionArea([s]) > width * width);
}

/** Region minus its opening with a disc of the given diameter. */
function notOpened(region, width) {
  const t = THIN_SIMPLIFY;
  const simple = toPaths(region.map((s) => ({ outer: simplifyRing(s.outer, t), holes: s.holes.map((h) => simplifyRing(h, t)) })));
  const opened = offsetPaths(offsetPaths(simple, -width / 2, t), width / 2 + 2 * t + TOLERANCE, t);
  return run(ClipType.ctDifference, toPaths(region), opened, false);
}

export function pointInRing(r, x, y) {
  let inside = false;
  for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
    const yi = r[i + 1];
    const yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) inside = !inside;
  }
  return inside;
}

/**
 * base minus inner for an inner region lying strictly inside base. Unlike
 * difference() the result reuses inner's rings exactly (reversed), so
 * surfaces built from both regions share their edges – needed for
 * watertight meshes with pockets.
 */
export function subtractInterior(base, inner) {
  const containers = base.map((s) => ({ outer: s.outer, holes: [], area: Math.abs(ringArea(s.outer)) }));
  // Counters of the inner region (e.g. inside an "O") stay at full height.
  for (const s of inner) {
    for (const h of s.holes) containers.push({ outer: reverseRing(h), holes: [], area: Math.abs(ringArea(h)) });
  }
  // Every ring becomes a hole of the smallest container around it: a hole
  // of base inside a counter of inner (a narrower counter one step lower)
  // belongs to that counter's ledge.
  const place = (ring) => {
    let best = null;
    for (const c of containers) {
      if ((!best || c.area < best.area) && pointInRing(c.outer, ring[0], ring[1])) best = c;
    }
    return best;
  };
  for (const s of base) {
    for (const h of s.holes) {
      const c = place(h);
      if (c) c.holes.push(h);
    }
  }
  for (const s of inner) {
    const c = place(s.outer);
    if (c) c.holes.push(reverseRing(s.outer));
  }
  return containers.map((c) => ({ outer: c.outer, holes: c.holes }));
}

/** Point in region (even-odd over all rings). */
export function containsPoint(region, x, y) {
  let inside = false;
  for (const r of regionRings(region)) {
    for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) inside = !inside;
    }
  }
  return inside;
}

// Bounding boxes of rings, cached (rings are never changed in place).
const ringBoxes = new WeakMap();
function ringBox(r) {
  let b = ringBoxes.get(r);
  if (!b) {
    b = addRingBounds(emptyBounds(), r);
    ringBoxes.set(r, b);
  }
  return b;
}

/**
 * The region inside the rectangle x0..x1 × y0..y1. Rings far away are left
 * out first, which keeps Clipper fast on big regions (a stencil).
 */
export function clipRegion(region, x0, y0, x1, y1) {
  const near = (r) => {
    const b = ringBox(r);
    return b.maxX >= x0 && b.minX <= x1 && b.maxY >= y0 && b.minY <= y1;
  };
  const parts = region.filter((s) => near(s.outer)).map((s) => ({ outer: s.outer, holes: s.holes.filter(near) }));
  return parts.length ? intersection(parts, [[x0, y0, x1, y0, x1, y1, x0, y1]]) : [];
}

/** Point in region (even-odd), fast for many rings. */
export function insideRegion(region, x, y) {
  let inside = false;
  for (const s of region) {
    for (const r of [s.outer, ...s.holes]) {
      const b = ringBox(r);
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (pointInRing(r, x, y)) inside = !inside;
    }
  }
  return inside;
}

/** x positions where the horizontal line y crosses the region's rings, sorted. */
export function crossingsAtY(region, y) {
  const xs = [];
  for (const r of regionRings(region)) {
    const b = ringBox(r);
    if (y < b.minY || y > b.maxY) continue;
    for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      if ((yi > y) !== (yj > y)) xs.push(r[i] + ((r[j] - r[i]) * (y - yi)) / (yj - yi));
    }
  }
  return xs.sort((a, b) => a - b);
}

/** y positions where the vertical line x crosses the region's rings, sorted. */
export function crossingsAtX(region, x) {
  const ys = [];
  for (const r of regionRings(region)) {
    const b = ringBox(r);
    if (x < b.minX || x > b.maxX) continue;
    for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
      const xi = r[i];
      const xj = r[j];
      if ((xi > x) !== (xj > x)) ys.push(r[i + 1] + ((r[j + 1] - r[i + 1]) * (x - xi)) / (xj - xi));
    }
  }
  return ys.sort((a, b) => a - b);
}
