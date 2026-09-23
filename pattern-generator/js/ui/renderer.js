// 2D canvas view: plate, holes, analysis highlights and modifier gizmos.
// World units are mm with y up; the view maps them to CSS pixels.

import { TAU, clamp } from '../core/math.js';
import { attractorPolyline } from '../core/modifiers.js';
import { ellipsePoint } from '../core/shapes.js';
import { FLAG_THIN, FLAG_OVERLAP } from '../core/analysis.js';
import { imagePlacement } from './image.js';

export function addOutlineToPath(path, o) {
  if (o.kind === 'circle') {
    path.moveTo(o.cx + o.r, o.cy);
    path.arc(o.cx, o.cy, o.r, 0, TAU);
  } else if (o.kind === 'ellipse') {
    const [x, y] = ellipsePoint(o, 0);
    path.moveTo(x, y);
    path.ellipse(o.cx, o.cy, o.rx, o.ry, o.rot, 0, TAU);
  } else {
    const s0 = o.segs[0];
    path.moveTo(s0.x0, s0.y0);
    for (const s of o.segs) {
      if (s.type === 'line') path.lineTo(s.x1, s.y1);
      else path.arc(s.cx, s.cy, s.r, s.a0, s.a0 + s.sweep, false);
    }
  }
  path.closePath();
}

function niceStep(target) {
  const p = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}

export class Renderer {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.ctx = canvas.getContext('2d');
    this.scale = 2;
    this.ox = 0;
    this.oy = 0;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.handles = [];
    this.rings = [];
    this.lines = [];
    this.hover = null;
    this.colors = {};
    this.showGizmos = true;
    this._raf = 0;
    this._cache = null;
    this._fitted = false;
    this.readColors();
  }

  readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    this.colors = {
      bg: v('--stage-bg', '#101114'),
      plate: v('--plate', '#2a2e35'),
      plateEdge: v('--plate-edge', '#4a505a'),
      canvasEdge: v('--canvas-edge', 'rgba(255,255,255,0.18)'),
      margin: v('--margin-line', 'rgba(255,255,255,0.22)'),
      gizmo: v('--gizmo', '#e8eaed'),
      gizmoInk: v('--gizmo-ink', '#15171b'),
      accent: v('--accent', '#ff9f43'),
      warn: v('--warn', '#ffb020'),
      danger: v('--danger', '#ff4d4f'),
      text: v('--text-muted', '#9aa0a8'),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(rect.width));
    const hgt = Math.max(1, Math.round(rect.height));
    if (w === this.width && hgt === this.height && dpr === this.dpr) return;
    const prevW = this.width;
    const prevH = this.height;
    this.width = w;
    this.height = hgt;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hgt * dpr);
    if (!this._fitted) this.fit();
    else {
      // Keep the view centred when the stage changes size.
      this.ox += (w - prevW) / 2;
      this.oy += (hgt - prevH) / 2;
    }
    this.draw();
  }

  fit() {
    const { width: W, height: H } = this.app.doc.canvas;
    if (!this.width || !this.height) return;
    // Keep the plate clear of the status bar at the bottom of the stage.
    const availH = Math.max(this.height * 0.5, this.height - (this.insetBottom || 0));
    const pad = Math.min(40, Math.min(this.width, availH) * 0.06);
    this.scale = Math.max(0.01, Math.min((this.width - 2 * pad) / W, (availH - 2 * pad) / H));
    this.ox = this.width / 2;
    this.oy = availH / 2;
    this._fitted = true;
    this.requestDraw();
  }

  toScreen(x, y) {
    return [this.ox + x * this.scale, this.oy - y * this.scale];
  }

  toWorld(sx, sy) {
    return [(sx - this.ox) / this.scale, (this.oy - sy) / this.scale];
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * factor, 0.02, 400);
    this.ox = sx - wx * this.scale;
    this.oy = sy + wy * this.scale;
    this.requestDraw();
  }

  pan(dx, dy) {
    this.ox += dx;
    this.oy += dy;
    this.requestDraw();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.draw();
    });
  }

  /** Builds (and caches) the hole paths for the current result/analysis. */
  holePaths() {
    const { result, analysis, doc } = this.app;
    const show = doc.check.show;
    const c = this._cache;
    if (c && c.result === result && c.analysis === analysis && c.show === show) return c;
    const normal = new Path2D();
    const thin = new Path2D();
    const overlap = new Path2D();
    const flags = show && analysis && analysis.flags.length === result.holes.length ? analysis.flags : null;
    result.holes.forEach((hole, i) => {
      const f = flags ? flags[i] : 0;
      addOutlineToPath(f === FLAG_OVERLAP ? overlap : f === FLAG_THIN ? thin : normal, hole.outline);
    });
    const boundary = new Path2D();
    addOutlineToPath(boundary, result.boundary.outline);
    let margin = null;
    const m = doc.boundary.margin;
    if (m > 0) {
      const off = result.boundary.offsetOutline(m);
      if (off) {
        margin = new Path2D();
        addOutlineToPath(margin, off);
      }
    }
    this._cache = { result, analysis, show, normal, thin, overlap, boundary, margin };
    return this._cache;
  }

  draw() {
    const { ctx, app } = this;
    const { doc, result } = app;
    const dpr = this.dpr;
    const s = this.scale;
    const col = this.colors;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!result) return;

    const W = doc.canvas.width;
    const H = doc.canvas.height;
    const paths = this.holePaths();
    const world = () => ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * this.ox, dpr * this.oy);
    const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Canvas frame
    const [cx0, cy0] = this.toScreen(-W / 2, H / 2);
    screen();
    ctx.strokeStyle = col.canvasEdge;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(Math.round(cx0) + 0.5, Math.round(cy0) + 0.5, Math.round(W * s), Math.round(H * s));
    ctx.setLineDash([]);

    // Plate
    world();
    ctx.fillStyle = col.plate;
    ctx.fill(paths.boundary);
    ctx.lineWidth = 1.2 / s;
    ctx.strokeStyle = col.plateEdge;
    ctx.stroke(paths.boundary);

    // Background image
    const img = app.image;
    if (img && doc.background.visible) {
      const p = imagePlacement(doc, img.width, img.height);
      const [ix, iy] = this.toScreen(p.left, p.top);
      screen();
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx0, cy0, W * s, H * s);
      ctx.clip();
      ctx.globalAlpha = clamp(doc.background.opacity, 0, 1);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.canvas, ix, iy, p.width * s, p.height * s);
      ctx.restore();
    }

    // Margin line
    if (paths.margin) {
      world();
      ctx.setLineDash([5 / s, 4 / s]);
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = col.margin;
      ctx.stroke(paths.margin);
      ctx.setLineDash([]);
    }

    // Holes
    world();
    ctx.fillStyle = doc.shape.color || '#68a6f8';
    ctx.fill(paths.normal);
    ctx.fillStyle = col.warn;
    ctx.fill(paths.thin);
    ctx.fillStyle = col.danger;
    ctx.fill(paths.overlap);

    screen();
    this.handles = [];
    this.rings = [];
    this.lines = [];
    if (this.showGizmos) this.drawGizmos();
    this.drawScaleBar();

    if (result.overflow) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillStyle = col.danger;
      ctx.fillText(`Zu viele Löcher (ca. ${result.overflow.toLocaleString('de-DE')}) – bitte Abstand vergrößern.`,
        this.width / 2, this.height / 2);
      ctx.textAlign = 'start';
    }
  }

  drawScaleBar() {
    const { ctx } = this;
    const len = niceStep(90 / this.scale);
    const px = len * this.scale;
    const x = 16;
    const y = this.height - 44;
    ctx.strokeStyle = this.colors.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.lineTo(x + px, y - 5);
    ctx.stroke();
    ctx.fillStyle = this.colors.text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${len >= 1 ? len : len.toFixed(2)} mm`, x + 4, y - 3);
  }

  handle(id, key, x, y, { shape = 'circle', active = false } = {}) {
    const { ctx } = this;
    const hovered = this.hover && this.hover.id === id && this.hover.key === key;
    const r = hovered ? 7.5 : 6;
    ctx.beginPath();
    if (shape === 'diamond') {
      ctx.moveTo(x, y - r - 1);
      ctx.lineTo(x + r + 1, y);
      ctx.lineTo(x, y + r + 1);
      ctx.lineTo(x - r - 1, y);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fillStyle = active ? this.colors.accent : this.colors.gizmo;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.colors.gizmoInk;
    ctx.stroke();
    this.handles.push({ id, key, x, y, r: 11 });
  }

  drawGizmos() {
    const { ctx, app } = this;
    const s = this.scale;
    for (const m of app.doc.modifiers) {
      const active = m.id === app.selectedId;
      const alpha = m.enabled === false ? 0.35 : 1;
      const stroke = active ? this.colors.accent : this.colors.gizmo;
      ctx.globalAlpha = alpha;
      if (m.type === 'point') {
        const [x, y] = this.toScreen(m.x, m.y);
        const r = Math.max(0, m.radius) * s;
        if (active) {
          ctx.fillStyle = this.colors.accent;
          ctx.globalAlpha = 0.07 * alpha;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = alpha;
        }
        ctx.setLineDash(m.remove ? [] : [6, 5]);
        ctx.lineWidth = active ? 1.8 : 1.3;
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        if (m.remove) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.clip();
          ctx.globalAlpha = 0.25 * alpha;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let k = -r * 2; k < r * 2; k += 9) {
            ctx.moveTo(x + k - r, y + r);
            ctx.lineTo(x + k + r, y - r);
          }
          ctx.stroke();
          ctx.restore();
          ctx.globalAlpha = alpha;
        }
        this.rings.push({ id: m.id, cx: x, cy: y, r });
        if (active) {
          ctx.fillStyle = stroke;
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`R ${+m.radius.toFixed(1)}`, x, y - r - 4);
          ctx.textAlign = 'start';
        }
        this.handle(m.id, 'center', x, y, { active });
      } else if (m.type === 'line') {
        const pts = attractorPolyline(m).map(([px, py]) => this.toScreen(px, py));
        const band = Math.max(0, m.radius) * s * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        if (active) {
          // Influence band (radius on both sides of the line).
          ctx.strokeStyle = this.colors.accent;
          ctx.globalAlpha = 0.08 * alpha;
          ctx.lineWidth = band;
          ctx.stroke();
          ctx.globalAlpha = alpha;
        }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = active ? 2 : 1.5;
        ctx.setLineDash(m.remove ? [] : [6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';
        this.lines.push({ id: m.id, pts });
        if (m.curve) {
          const [x1, y1] = this.toScreen(m.x1, m.y1);
          const [x2, y2] = this.toScreen(m.x2, m.y2);
          const [qx, qy] = this.toScreen(m.cx, m.cy);
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(qx, qy);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          this.handle(m.id, 'ctrl', qx, qy, { shape: 'diamond', active });
        }
        const [x1, y1] = this.toScreen(m.x1, m.y1);
        const [x2, y2] = this.toScreen(m.x2, m.y2);
        this.handle(m.id, 'p1', x1, y1, { active });
        this.handle(m.id, 'p2', x2, y2, { active });
      } else if (m.type === 'linear') {
        const [x1, y1] = this.toScreen(m.x1, m.y1);
        const [x2, y2] = this.toScreen(m.x2, m.y2);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const nx = -Math.sin(ang);
        const ny = Math.cos(ang);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = active ? 2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        for (const [px, py] of [[x1, y1], [x2, y2]]) {
          ctx.moveTo(px - nx * 18, py - ny * 18);
          ctx.lineTo(px + nx * 18, py + ny * 18);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 12 * Math.cos(ang - 0.4), y2 - 12 * Math.sin(ang - 0.4));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 12 * Math.cos(ang + 0.4), y2 - 12 * Math.sin(ang + 0.4));
        ctx.stroke();
        this.lines.push({ id: m.id, pts: [[x1, y1], [x2, y2]] });
        this.handle(m.id, 'p1', x1, y1, { active });
        this.handle(m.id, 'p2', x2, y2, { active });
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Finds the gizmo under a screen position. */
  hitTest(sx, sy) {
    for (let i = this.handles.length - 1; i >= 0; i--) {
      const hd = this.handles[i];
      if (Math.hypot(sx - hd.x, sy - hd.y) <= hd.r) return { type: 'handle', id: hd.id, key: hd.key };
    }
    const sel = this.app.selectedId;
    const rings = [...this.rings].sort((a, b) => (a.id === sel ? -1 : b.id === sel ? 1 : 0));
    for (const rg of rings) {
      if (Math.abs(Math.hypot(sx - rg.cx, sy - rg.cy) - rg.r) <= 6) return { type: 'ring', id: rg.id };
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const ln = this.lines[i];
      for (let k = 0; k < ln.pts.length - 1; k++) {
        const [ax, ay] = ln.pts[k];
        const [bx, by] = ln.pts[k + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        const t = clamp(((sx - ax) * dx + (sy - ay) * dy) / len2, 0, 1);
        if (Math.hypot(sx - ax - dx * t, sy - ay - dy * t) <= 7) return { type: 'line', id: ln.id };
      }
    }
    return null;
  }
}
